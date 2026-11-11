"""Weekly story, vet report, and the activity feed.

All three are read-only views over the same cleaned data the insights use.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from statistics import mean, median
from typing import Optional

from quality import Assessed, CATS
from timeutil import iso_utc, local_date, local_midnight_utc, to_local, utc_now

METRICS = [
    # key, label, unit, decimals
    ("weight", "Weight", "lbs", 2),
    ("pee", "Pees", "a day", 1),
    ("poop", "Poops", "a day", 1),
    ("eat_min", "Eating", "min a day", 0),
    ("water", "Water", "mL a day", 0),
]
OBS_LABEL = {"normal_stool": "Normal poop", "soft_stool": "Soft poop", "diarrhea": "Diarrhea",
             "constipated": "Hard or straining", "blood": "Blood", "vomit": "Vomit or hairball", "note": "Note"}
NOTE_LABEL = {"diet": "Diet", "med": "Medication", "vet": "Vet", "other": "Note"}


def day_table(visits: list[Assessed], feeder_stats: dict, cat: str, days: list[date]) -> list[dict]:
    """One row of metrics per local day for a cat."""
    by_day: dict = {}
    for v in visits:
        if v.counted and (v.cat == cat or (v.cat is None and v.likely_cat == cat)):
            by_day.setdefault(local_date(v.ts), []).append(v)
    fs = feeder_stats.get(cat, {})
    rows = []
    for d in days:
        vs = by_day.get(d, [])
        w = [v.weight_lbs for v in vs if v.use_weight and v.cat == cat]
        f = fs.get(str(d))
        rows.append({
            "day": str(d),
            "weight": round(median(w), 2) if w else None,
            "pee": sum(1 for v in vs if v.waste_type == "Urine"),
            "poop": sum(1 for v in vs if v.waste_type == "Feces"),
            "trips": len(vs),
            "eat_min": round(f["eat_seconds"] / 60, 1) if f else None,
            "eat_visits": f["eat_sessions"] if f else None,
            "water": f["drink_ml"] if f else None,
            "drinks": f["drinks"] if f else None,
        })
    return rows


def _avg(rows: list[dict], key: str) -> Optional[float]:
    vals = [r[key] for r in rows if r.get(key) is not None]
    if not vals:
        return None
    return median(vals) if key == "weight" else mean(vals)


def _change(cur: Optional[float], prev: Optional[float]) -> Optional[float]:
    if cur is None or prev is None or prev == 0:
        return None
    return (cur - prev) / prev * 100


def _fmt(v: Optional[float], decimals: int) -> str:
    if v is None:
        return "--"
    return f"{v:.{decimals}f}"


def _compare_phrase(pct: Optional[float], small: float = 10) -> str:
    if pct is None:
        return ""
    if abs(pct) < small:
        return "about the same as the week before"
    return f"{'up' if pct > 0 else 'down'} {abs(pct):.0f}% from the week before"


def _weekday(d: str) -> str:
    return date.fromisoformat(d).strftime("%A")


def week_story(visits: list[Assessed], feeder_stats: dict, profiles: dict, observations: list, notes: list,
               alerts: list, offset: int = 0, now: Optional[datetime] = None) -> dict:
    """The last 7 full days (or `offset` weeks before that) compared with the 7 days before."""
    now = now or utc_now()
    today = local_date(now)
    end = today - timedelta(days=1 + 7 * offset)          # last day of the week
    days = [end - timedelta(days=i) for i in range(6, -1, -1)]
    prev_days = [d - timedelta(days=7) for d in days]
    first_data = min((local_date(v.ts) for v in visits), default=today)
    start_utc, end_utc = local_midnight_utc(days[0]), local_midnight_utc(end + timedelta(days=1))

    cats_out = []
    for cat in CATS:
        male = ((profiles.get(cat) or {}).get("gender") or "").upper() == "MALE"
        he, his = ("He", "his") if male else ("She", "her")
        rows = day_table(visits, feeder_stats, cat, days)
        prev = day_table(visits, feeder_stats, cat, [d for d in prev_days if d >= first_data])
        stats = {}
        for key, label, unit, dec in METRICS:
            cur, pv = _avg(rows, key), _avg(prev, key) if prev else None
            stats[key] = {"label": label, "unit": unit, "value": round(cur, dec) if cur is not None else None,
                          "prev": round(pv, dec) if pv is not None else None,
                          "change_pct": round(_change(cur, pv), 1) if _change(cur, pv) is not None else None,
                          "daily": [r[key] for r in rows]}

        paras = []
        flags = 0
        # Weight
        w = stats["weight"]
        if w["value"] is not None:
            if w["change_pct"] is None:
                paras.append({"topic": "Weight", "level": "info", "text": f"{cat} weighed about {w['value']:.2f} lbs."})
            elif abs(w["change_pct"]) < 2:
                paras.append({"topic": "Weight", "level": "good",
                              "text": f"{cat} held steady at {w['value']:.2f} lbs. That's within normal day to day wobble."})
            else:
                oz = abs(w["value"] - w["prev"]) * 16
                lvl = "watch" if w["change_pct"] <= -3 else "info"
                flags += lvl == "watch"
                paras.append({"topic": "Weight", "level": lvl,
                              "text": f"{cat} weighed {w['value']:.2f} lbs, {'up' if w['change_pct'] > 0 else 'down'} "
                                      f"{oz:.1f} oz ({abs(w['change_pct']):.1f}%) from the week before."
                                      + (" A drop like that is worth watching for another week." if lvl == "watch" else "")})
        # Eating
        e = stats["eat_min"]
        if e["value"] is not None:
            visits_day = _avg(rows, "eat_visits")
            txt = f"{he} spent about {e['value']:.0f} minutes a day at the bowl"
            txt += f" over {visits_day:.0f} visits" if visits_day else ""
            cp = e["change_pct"]
            lvl = "good"
            if cp is not None and cp <= -30:
                lvl, flags = "watch", flags + 1
                txt += f", {_compare_phrase(cp)}. A drop in appetite is one of the first signs a cat isn't feeling well."
            else:
                txt += f", {_compare_phrase(cp)}." if cp is not None else "."
            eat_rows = [r for r in rows if r["eat_min"] is not None]
            if len(eat_rows) >= 4:
                lo = min(eat_rows, key=lambda r: r["eat_min"])
                if e["value"] and lo["eat_min"] < e["value"] * 0.6:
                    txt += f" {_weekday(lo['day'])} was the lightest day ({lo['eat_min']:.0f} minutes)."
            paras.append({"topic": "Eating", "level": lvl, "text": txt})
        # Water
        wa = stats["water"]
        if wa["value"] is not None and wa["value"] > 0:
            cp = wa["change_pct"]
            lvl = "good"
            txt = f"{he} drank about {wa['value']:.0f} mL a day from the fountain"
            if cp is not None and cp >= 30:
                lvl, flags = "watch", flags + 1
                txt += f", {_compare_phrase(cp)}. More drinking can be an early sign of kidney, thyroid, or blood sugar changes."
            elif cp is not None and cp <= -40:
                lvl, flags = "watch", flags + 1
                txt += f", {_compare_phrase(cp)}. Check that the fountain is clean and full."
            else:
                txt += f", {_compare_phrase(cp)}." if cp is not None else "."
            paras.append({"topic": "Drinking", "level": lvl, "text": txt})
        # Litter box
        pee, poop = stats["pee"], stats["poop"]
        if pee["value"] is not None:
            total = (pee["value"] or 0) + (poop["value"] or 0)
            txt = (f"{he} used the litter box about {total:.1f} times a day "
                   f"({pee['value']:.1f} logged as pee, {poop['value']:.1f} as poop). Most cats go 3 to 6 times.")
            lvl = "good"
            cp = pee["change_pct"]
            if cp is not None and cp >= 40 and pee["value"] - (pee["prev"] or 0) >= 1:
                lvl, flags = "watch", flags + 1
                txt += f" Pee visits were {_compare_phrase(cp)}."
            if (poop["value"] or 0) < 0.7 and 3 <= total <= 6.5:
                txt += " The low poop count is probably the robot labelling some poops as pee."
            busy = max(rows, key=lambda r: r["trips"])
            if busy["trips"] >= total * 1.6 and busy["trips"] >= 6:
                txt += f" {_weekday(busy['day'])} was the busiest day with {busy['trips']} trips."
            paras.append({"topic": "Litter box", "level": lvl, "text": txt})

        in_week = lambda ts: start_utc <= ts < end_utc
        obs = [o for o in observations if o.cat == cat and in_week(o.created_at)]
        bad = [o for o in obs if o.kind in ("soft_stool", "diarrhea", "blood", "constipated", "vomit")]
        if obs:
            kinds = {}
            for o in obs:
                kinds[OBS_LABEL.get(o.kind, o.kind)] = kinds.get(OBS_LABEL.get(o.kind, o.kind), 0) + 1
            lvl = "concern" if any(o.kind == "blood" for o in obs) else "watch" if len(bad) >= 2 else "info"
            flags += lvl != "info"
            paras.append({"topic": "What you saw", "level": lvl,
                          "text": "You logged " + ", ".join(f"{k.lower()} {'once' if n == 1 else f'{n} times'}" for k, n in kinds.items()) + "."})
        week_notes = [n for n in notes if (n.cat in (None, cat)) and str(days[0]) <= n.day <= str(end)]
        if week_notes:
            paras.append({"topic": "Notes", "level": "info",
                          "text": " ".join(f"{_weekday(n.day)}: {n.text}" + ("" if n.text.endswith(".") else ".") for n in week_notes)})
        cat_alerts = [a for a in alerts if a.cat_name == cat and in_week(a.created_at)]

        has_data = any(s["value"] is not None for s in stats.values())
        if not has_data:
            headline = f"No data for {cat} this week"
        elif flags == 0:
            headline = f"A steady week for {cat}"
        elif flags == 1:
            headline = f"A mostly normal week for {cat}, with one change"
        else:
            headline = f"A few changes for {cat} this week"
        cats_out.append({"cat": cat, "headline": headline, "level": "good" if flags == 0 else "watch",
                         "stats": stats, "paragraphs": paras,
                         "alerts": [{"title": a.title, "at": iso_utc(a.created_at)} for a in cat_alerts]})

    return {"start": str(days[0]), "end": str(end), "days": [str(d) for d in days], "offset": offset,
            "has_previous": (days[0] - timedelta(days=1)) >= first_data, "cats": cats_out}


def story_headline(story: dict) -> str:
    return " ".join(c["headline"] + "." for c in story["cats"])


# ── Vet report ───────────────────────────────────────────────────────────────

def vet_report(visits: list[Assessed], feeder_stats: dict, profile: dict, insights_cat: dict, observations: list,
               notes: list, alerts: list, cat: str, days: int = 30, now: Optional[datetime] = None) -> dict:
    now = now or utc_now()
    today = local_date(now)
    first_data = min((local_date(v.ts) for v in visits), default=today)
    period = [today - timedelta(days=i) for i in range(days, 0, -1) if today - timedelta(days=i) >= first_data]
    before = [d - timedelta(days=days) for d in period if d - timedelta(days=days) >= first_data]
    rows = day_table(visits, feeder_stats, cat, period)
    prev = day_table(visits, feeder_stats, cat, before) if len(before) >= 7 else []

    summary = []
    for key, label, unit, dec in METRICS:
        vals = [r[key] for r in rows if r.get(key) is not None]
        cur, pv = _avg(rows, key), _avg(prev, key) if prev else None
        summary.append({"key": key, "label": label, "unit": unit,
                        "value": round(cur, dec) if cur is not None else None,
                        "low": round(min(vals), dec) if vals else None, "high": round(max(vals), dec) if vals else None,
                        "prev": round(pv, dec) if pv is not None else None,
                        "change_pct": round(_change(cur, pv), 1) if _change(cur, pv) is not None else None,
                        "days_with_data": len(vals)})

    weeks = []
    for i in range(0, len(rows), 7):
        chunk = rows[i:i + 7]
        if len(chunk) < 4:
            continue
        weeks.append({"start": chunk[0]["day"], "end": chunk[-1]["day"],
                      **{key: (round(_avg(chunk, key), dec) if _avg(chunk, key) is not None else None)
                         for key, _, _, dec in METRICS}})

    start_utc = local_midnight_utc(period[0]) if period else now
    month_visits = [v for v in visits if v.ts >= start_utc]
    return {
        "cat": cat, "generated": iso_utc(now),
        "period": {"start": str(period[0]) if period else None, "end": str(period[-1]) if period else None, "days": len(period)},
        "profile": {k: profile.get(k) for k in ("gender", "breeds", "is_fixed", "diet", "birthday")},
        "status": insights_cat.get("headline"),
        "summary": summary, "weeks": weeks, "daily": rows,
        "findings": [{"topic": f["topic"], "level": f["level"], "title": f["title"], "detail": f["detail"]}
                     for f in insights_cat.get("findings", [])],
        "observations": [{"day": str(local_date(o.created_at)), "label": OBS_LABEL.get(o.kind, o.kind), "note": o.note}
                         for o in sorted(observations, key=lambda o: o.created_at) if o.cat == cat and o.created_at >= start_utc],
        "notes": [{"day": n.day, "kind": NOTE_LABEL.get(n.kind, "Note"), "text": n.text}
                  for n in sorted(notes, key=lambda n: n.day) if n.cat in (None, cat) and period and n.day >= str(period[0])],
        "alerts": [{"day": str(local_date(a.created_at)), "title": a.title}
                   for a in sorted(alerts, key=lambda a: a.created_at) if a.cat_name == cat and a.created_at >= start_utc],
        "data_notes": [
            "Weight, visit counts and durations come from a Litter-Robot 5 Pro. Eating and drinking come from PetLibro RFID "
            "feeders and an RFID fountain, which identify each cat by tag.",
            "The litter robot classifies waste automatically and can log loose stool as urine, so pee and poop counts are "
            "approximate. Total trips are more reliable.",
            f"In this period {sum(1 for v in month_visits if v.cat == cat)} visits were tagged to {cat} by the robot and "
            f"{sum(1 for v in month_visits if v.cat is None and v.likely_cat == cat)} untagged visits were matched by weight. "
            "Weight readings far from the cat's rolling baseline were excluded.",
            "Fountain volumes exclude water from wet food.",
        ],
    }


# ── Activity feed ────────────────────────────────────────────────────────────

def activity_feed(visits: list[Assessed], pl_events: list[dict], observations: list, notes: list,
                  since: datetime, loose: frozenset = frozenset()) -> list[dict]:
    """Everything that happened since `since`, newest first. Eating and drinking are
    grouped into sittings (events by the same cat less than 30 minutes apart)."""
    items = []
    for v in visits:
        if v.ts < since or not v.counted:
            continue
        who = v.cat or v.likely_cat
        what = "pee" if v.waste_type == "Urine" else "poop" if v.waste_type == "Feces" else "visit"
        items.append({"ts": v.ts, "kind": "litter", "cat": who, "sure": bool(v.cat), "what": what,
                      "seconds": v.duration, "weight_lbs": v.weight_lbs if v.use_weight else None,
                      "maybe_loose": v.id in loose, "visit_id": v.id})
    groups: dict = {}
    for e in pl_events:
        if e["ts"] < since:
            continue
        if e["kind"] == "meal":
            items.append({"ts": e["ts"], "kind": "meal", "cat": e["cat"], "portions": e["portions"]})
            continue
        key = (e["cat"], e["kind"])
        g = groups.get(key)
        if g and (e["ts"] - g["last"]).total_seconds() <= 1800:
            g["count"] += 1
            g["seconds"] += e.get("seconds", 0)
            g["ml"] += e.get("ml", 0)
            g["last"] = e["ts"]
        else:
            g = {"ts": e["ts"], "last": e["ts"], "kind": e["kind"], "cat": e["cat"], "count": 1,
                 "seconds": e.get("seconds", 0), "ml": e.get("ml", 0)}
            groups[key] = g
            items.append(g)
    for o in observations:
        if o.created_at >= since:
            items.append({"ts": o.created_at, "kind": "checkin", "cat": o.cat, "label": OBS_LABEL.get(o.kind, o.kind)})
    for n in notes:
        if n.created_at and n.created_at >= since and n.day >= str(local_date(since)):
            items.append({"ts": n.created_at, "kind": "note", "cat": n.cat, "label": NOTE_LABEL.get(n.kind, "Note"), "text": n.text})
    items.sort(key=lambda x: x["ts"], reverse=True)
    out = []
    for it in items:
        it = {k: v for k, v in it.items() if k != "last"}
        it["day"] = str(local_date(it["ts"]))
        it["ts"] = iso_utc(it["ts"])
        out.append(it)
    return out
