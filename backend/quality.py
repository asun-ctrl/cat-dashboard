"""Data quality: flag outliers and likely misidentified visits.

Nothing is deleted. Every raw visit stays in the database. This module decides,
at read time, how each visit should be used:

  counted       counts toward its cat's visit totals
  use_weight    goes into weight stats and charts
  use_waste     goes into waste weight stats
  use_duration  goes into duration stats

Baselines are per cat and robust (median and MAD), so a handful of bad readings
cannot drag the baseline toward themselves.
"""
from __future__ import annotations

import os
from bisect import bisect_left, bisect_right
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from statistics import median
from typing import Iterable, Optional

CATS = [c.strip() for c in os.getenv("CATS", "Lychee,Guava").split(",") if c.strip()]

# Whisker reports petWeight in hundredths of a pound (1142 means 11.42 lbs).
WEIGHT_DIVISOR = float(os.getenv("PET_WEIGHT_DIVISOR", "100"))
MIN_WEIGHT_TOL_LBS = float(os.getenv("MIN_WEIGHT_TOL_LBS", "0.5"))
WEIGHT_WINDOW_DAYS = int(os.getenv("WEIGHT_WINDOW_DAYS", "10"))
BRIEF_VISIT_SECONDS = int(os.getenv("BRIEF_VISIT_SECONDS", "10"))
MIN_WASTE_TOL = float(os.getenv("MIN_WASTE_TOL", "50"))
WASTE_HARD_MAX = float(os.getenv("WASTE_HARD_MAX", "500"))

MAD_SCALE = 1.4826  # converts MAD to a standard-deviation equivalent
K_SIGMA = 4.0


@dataclass
class Assessed:
    id: int
    reported_cat: str
    ts: datetime                     # UTC, naive
    waste_type: str
    duration: Optional[int]
    weight_lbs: Optional[float]
    waste: Optional[float]
    pet_id: Optional[str] = None
    cat: Optional[str] = None        # confirmed cat used for counts, None if unattributed
    likely_cat: Optional[str] = None # best guess by weight for unattributed visits
    counted: bool = True
    use_weight: bool = False
    use_waste: bool = False
    use_duration: bool = False
    flags: list = field(default_factory=list)
    override: Optional[str] = None

    @property
    def reason(self) -> str:
        return "; ".join(FLAG_TEXT.get(f, f) for f in self.flags)


FLAG_TEXT = {
    "unidentified": "No cat tag from the robot",
    "weight_missing": "No weight reading",
    "weight_partial": "Weight far below normal (partial step-in)",
    "weight_outlier": "Weight outside this cat's normal range",
    "matches_other_cat": "Weight matches the other cat, likely mislabeled",
    "inferred_by_weight": "Untagged, but weight matches this cat",
    "brief_visit": "Very short visit",
    "waste_missing": "No waste weight",
    "waste_outlier": "Waste weight outside normal range",
    "manual_exclude": "Excluded by you",
    "manual_assign": "Assigned by you",
    "manual_include": "Kept by you",
}


def to_lbs(raw) -> Optional[float]:
    if raw is None:
        return None
    try:
        raw = float(raw)
    except (TypeError, ValueError):
        return None
    if raw <= 0:
        return None
    return round(raw / WEIGHT_DIVISOR, 2)


def _mad(values: list[float], center: float) -> float:
    return median(abs(v - center) for v in values) if values else 0.0


class _CatSeries:
    """Sorted weight readings for one cat, for windowed robust baselines."""

    def __init__(self, points: list[tuple[datetime, float]]):
        points.sort()
        self.ts = [p[0] for p in points]
        self.w = [p[1] for p in points]
        self.global_median = median(self.w) if self.w else None

    def baseline(self, at: datetime, exclude_index: Optional[int] = None):
        """Median and tolerance of readings within +/- WEIGHT_WINDOW_DAYS of `at`."""
        if not self.w:
            return None, None
        lo = bisect_left(self.ts, at - timedelta(days=WEIGHT_WINDOW_DAYS))
        hi = bisect_right(self.ts, at + timedelta(days=WEIGHT_WINDOW_DAYS))
        window = [self.w[i] for i in range(lo, hi) if i != exclude_index]
        if len(window) < 5:
            window = [w for i, w in enumerate(self.w) if i != exclude_index]
        if not window:
            return None, None
        med = median(window)
        tol = max(MIN_WEIGHT_TOL_LBS, K_SIGMA * MAD_SCALE * _mad(window, med))
        return med, tol


def assess(rows: Iterable, overrides: Optional[dict] = None) -> list[Assessed]:
    """Assess raw LitterVisit rows. `overrides` maps visit_id -> VisitOverride."""
    overrides = overrides or {}
    visits = [
        Assessed(
            id=r.id,
            reported_cat=r.cat_name or "Unknown",
            ts=r.timestamp,
            waste_type=r.waste_type or "Unknown",
            duration=r.duration_seconds,
            weight_lbs=to_lbs(r.weight_grams),
            waste=r.waste_weight_grams,
            pet_id=getattr(r, "pet_id", None),
        )
        for r in rows
    ]
    visits.sort(key=lambda v: v.ts)

    # Pass 1: two-stage weight baselines per cat. Stage one uses every tagged
    # reading; stage two rebuilds the baseline from only the readings that
    # stage one accepted, so mislabeled visits do not widen the tolerance.
    def build_series(accept) -> dict[str, _CatSeries]:
        out = {}
        for cat in CATS:
            pts = [(v.ts, v.weight_lbs) for v in visits
                   if v.reported_cat == cat and v.weight_lbs and accept(v)]
            out[cat] = _CatSeries(pts)
        return out

    stage1 = build_series(lambda v: True)

    def plausible(v: Assessed) -> bool:
        med, tol = stage1[v.reported_cat].baseline(v.ts)
        return med is None or abs(v.weight_lbs - med) <= tol

    series = build_series(plausible)

    for v in visits:
        tagged = v.reported_cat in CATS
        v.cat = v.reported_cat if tagged else None
        if not tagged:
            v.flags.append("unidentified")

        # Weight
        if v.weight_lbs is None:
            v.flags.append("weight_missing")
        else:
            baselines = {c: series[c].baseline(v.ts) for c in CATS}
            fits = {c: (m is not None and abs(v.weight_lbs - m) <= t) for c, (m, t) in baselines.items()}
            if tagged:
                med, tol = baselines[v.reported_cat]
                if med is None or fits[v.reported_cat]:
                    v.use_weight = True
                else:
                    others = [c for c in CATS if c != v.reported_cat and fits[c]]
                    if others and _cats_separable(baselines, v.reported_cat, others[0]):
                        v.flags.append("matches_other_cat")
                        v.likely_cat = others[0]
                        v.cat = None          # do not count it for the tagged cat
                    elif v.weight_lbs < 0.5 * med:
                        v.flags.append("weight_partial")
                    else:
                        v.flags.append("weight_outlier")
            else:
                matches = [c for c, ok in fits.items() if ok]
                if len(matches) == 1:
                    v.likely_cat = matches[0]
                    v.flags.append("inferred_by_weight")

        # Duration
        if v.duration is not None and v.duration > 0:
            if v.duration < BRIEF_VISIT_SECONDS:
                v.flags.append("brief_visit")
            else:
                v.use_duration = True

        if not v.waste or v.waste <= 0:
            v.flags.append("waste_missing")

    # Pass 2: waste outliers per (cat, waste type), using confirmed visits only.
    groups: dict[tuple, list[float]] = {}
    for v in visits:
        if v.cat and v.waste and v.waste > 0:
            groups.setdefault((v.cat, v.waste_type), []).append(v.waste)
    limits = {}
    for key, vals in groups.items():
        if len(vals) >= 8:
            med = median(vals)
            limits[key] = min(WASTE_HARD_MAX, med + max(MIN_WASTE_TOL, K_SIGMA * MAD_SCALE * _mad(vals, med)))
    for v in visits:
        if v.waste and v.waste > 0:
            limit = limits.get((v.cat, v.waste_type), WASTE_HARD_MAX)
            if v.waste > limit:
                v.flags.append("waste_outlier")
            elif v.cat:
                v.use_waste = True

    # Pass 3: manual overrides win over automatic decisions.
    for v in visits:
        o = overrides.get(v.id)
        if not o:
            continue
        v.override = o.action
        if o.action == "exclude":
            v.flags.append("manual_exclude")
            v.counted = False
            v.cat = None
            v.likely_cat = None
            v.use_weight = v.use_waste = v.use_duration = False
        elif o.action == "assign" and o.assign_to in CATS:
            v.flags.append("manual_assign")
            v.cat = o.assign_to
            v.likely_cat = None
            v.use_weight = v.weight_lbs is not None
            v.use_waste = bool(v.waste and v.waste > 0)
        elif o.action == "include":
            v.flags.append("manual_include")
            if v.reported_cat in CATS:
                v.cat = v.reported_cat
                v.likely_cat = None
                v.use_weight = v.weight_lbs is not None
                v.use_waste = bool(v.waste and v.waste > 0)

    return visits


def _cats_separable(baselines, a: str, b: str) -> bool:
    """Only call a visit mislabeled if the two cats' weights are clearly distinct."""
    (ma, ta), (mb, tb) = baselines[a], baselines[b]
    if ma is None or mb is None:
        return False
    return abs(ma - mb) > (ta + tb)


def quality_report(visits: list[Assessed], since: datetime) -> dict:
    recent = [v for v in visits if v.ts >= since]
    def n(flag):
        return sum(1 for v in recent if flag in v.flags)
    return {
        "visits": len(recent),
        "weight_outliers": n("weight_outlier") + n("weight_partial"),
        "mislabeled": n("matches_other_cat"),
        "inferred": n("inferred_by_weight"),
        "unidentified": n("unidentified"),
        "waste_outliers": n("waste_outlier"),
        "brief_visits": n("brief_visit"),
        "manual": sum(1 for v in recent if v.override),
    }
