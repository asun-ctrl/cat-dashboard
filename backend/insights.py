"""Plain-language interpretation of the litter data.

Each cat gets an overall status, a headline, a few "vital signs" with normal
ranges, and a list of findings. Every finding says what we saw, why it matters,
and what to do, in words for an owner rather than a vet. This is not a
diagnosis; thresholds come from general veterinary guidance (see SOURCES) and,
where possible, from each cat's own baseline, because a change from her normal
matters more than any textbook number.
"""
from __future__ import annotations

import os
from datetime import date, datetime, timedelta
from statistics import mean, median
from typing import Optional

from quality import Assessed, CATS
from timeutil import local_date, to_local, utc_now

LEVELS = {"good": 0, "info": 0, "watch": 1, "concern": 2}

# Meal times as local HH:MM, used for the after-meal pattern.
FEEDING_TIMES = [t.strip() for t in os.getenv("FEEDING_TIMES", "09:00,21:00").split(",") if t.strip()]
POST_MEAL_HOURS = float(os.getenv("POST_MEAL_HOURS", "2"))
GI_WATCH = [c.strip() for c in os.getenv("GI_WATCH_CATS", "Guava").split(",") if c.strip()]

SOURCES = {
    "pee": {"label": "Hepper (vet reviewed): how often cats pee",
            "url": "https://articles.hepper.com/how-many-times-cats-pee-a-day/"},
    "poop": {"label": "Cats Protection: how often cats should poop and pee",
             "url": "https://cats.org.uk/cats-blog/how-often-should-cats-poop-and-pee"},
    "weight": {"label": "VCA Animal Hospitals: weight loss in cats",
               "url": "https://vcahospitals.com/know-your-pet/abnormal-weight-loss-in-cats"},
    "straining": {"label": "Preventive Vet: a cat that can't pee is an emergency",
                  "url": "https://www.preventivevet.com/cats/what-to-do-if-your-cat-has-a-urinary-obstruction"},
    "baseline": {"label": "Rover (vet quoted): day to day variation is normal",
                 "url": "https://www.rover.com/blog/often-cats-pee/"},
    "appetite": {"label": "VCA Animal Hospitals: hepatic lipidosis (fatty liver) in cats",
                 "url": "https://vcahospitals.com/know-your-pet/hepatic-lipidosis-in-cats"},
}

EMERGENCY = [
    "Straining in the box with little or no pee coming out, or crying while trying to go.",
    "No pee at all in 24 hours. This is most urgent for male cats.",
    "Blood in the pee, or a cat that suddenly stops eating, hides, or is very lethargic.",
]


def _daily(visits: list[Assessed], cat: str, days: list[date], kind: Optional[str] = None,
           include_likely: bool = True) -> list[int]:
    out = []
    for d in days:
        out.append(sum(1 for v in visits
                       if v.counted and local_date(v.ts) == d
                       and (v.cat == cat or (include_likely and v.cat is None and v.likely_cat == cat))
                       and (kind is None or v.waste_type == kind)))
    return out


import re


def _pronouns(text: str, male: bool) -> str:
    if not male:
        return text
    text = re.sub(r"\b([Ww]atch|picking) her\b", r"\1 him", text)
    text = re.sub(r"\bShe\b", "He", text)
    text = re.sub(r"\bshe\b", "he", text)
    text = re.sub(r"\bher\b", "his", text)
    return text


def pronoun_obj(pron: str) -> str:
    return "him" if pron == "he" else "her"


def _pct(a: float, b: float) -> float:
    return (a - b) / b * 100 if b else 0.0


def _fit_slope(points: list[tuple[float, float]]) -> Optional[float]:
    """Least squares slope (y per x)."""
    if len(points) < 5:
        return None
    xs, ys = zip(*points)
    mx, my = mean(xs), mean(ys)
    den = sum((x - mx) ** 2 for x in xs)
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / den if den else None


def _fmt(n: float, unit: str = "time") -> str:
    n = round(n, 1)
    if unit == "time":
        if n == 1:
            return "once"
        if n == 2:
            return "twice"
        return f"{n:g} times"
    return f"{n:g} {unit}" + ("" if n == 1 else "s")


_MEALS = {"times": FEEDING_TIMES}


def _meal_minutes() -> list[int]:
    out = []
    for t in _MEALS["times"]:
        try:
            h, m = t.split(":")
            out.append(int(h) * 60 + int(m))
        except ValueError:
            pass
    return out


def _meal_words() -> str:
    words = []
    for m in _meal_minutes():
        h, mm = divmod(m, 60)
        suffix = "AM" if h < 12 else "PM"
        h12 = h % 12 or 12
        words.append(f"{h12}{':%02d' % mm if mm else ''} {suffix}")
    return " and ".join(words)


def _after_meal(ts: datetime) -> bool:
    lt = to_local(ts)
    minute = lt.hour * 60 + lt.minute
    for m in _meal_minutes():
        delta = (minute - m) % 1440
        if delta <= POST_MEAL_HOURS * 60:
            return True
    return False


def possible_loose_stool(visits: list[Assessed], cat: str) -> set[int]:
    """Urine-labelled visits that look more like loose stool.

    The robot labels waste from what it detects, and liquid stool can be logged
    as urine. A visit is flagged when it is labelled urine, happens soon after a
    meal, and is part of a back-to-back cluster (another visit by the same cat
    within 45 minutes). This is a pattern hint, not a certainty.
    """
    mine = sorted([v for v in visits if v.counted and (v.cat == cat or v.likely_cat == cat)], key=lambda v: v.ts)
    flagged = set()
    for i, v in enumerate(mine):
        if v.waste_type != "Urine" or not _after_meal(v.ts):
            continue
        near = [w for w in mine[max(0, i - 3): i + 4]
                if w is not v and abs((w.ts - v.ts).total_seconds()) <= 45 * 60]
        if near:
            flagged.add(v.id)
    return flagged


def build_insights(visits: list[Assessed], profiles: dict, weight_history: dict,
                   observations: list, now: Optional[datetime] = None, meal_times: Optional[dict] = None,
                   feeder_stats: Optional[dict] = None) -> dict:
    meal_times = meal_times or {}
    feeder_stats = feeder_stats or {}
    now = now or utc_now()
    today = local_date(now)
    recent_days = [today - timedelta(days=i) for i in range(1, 8)]          # last 7 full days
    base_days = [today - timedelta(days=i) for i in range(8, 31)]           # the 23 days before
    first_day = min((local_date(v.ts) for v in visits), default=today)
    base_days = [d for d in base_days if d >= first_day]
    recent_days = [d for d in recent_days if d >= first_day]

    cats_out = []
    for cat in CATS:
        prof = profiles.get(cat) or {}
        _MEALS["times"] = meal_times.get(cat) or FEEDING_TIMES   # real feeder schedule when known
        pron = "he" if (prof.get("gender") or "").upper() == "MALE" else "she"
        poss = "his" if pron == "he" else "her"
        findings = []
        vitals = {}

        # ── Weight ─────────────────────────────────────────────────────────
        readings = [(v.ts, v.weight_lbs) for v in visits if v.use_weight and v.cat == cat]
        readings += [(ts, w) for ts, w in weight_history.get(cat, [])]
        readings.sort()
        recent_w = [w for ts, w in readings if ts >= now - timedelta(days=7)]
        base_w = [w for ts, w in readings if now - timedelta(days=37) <= ts < now - timedelta(days=7)]
        if recent_w:
            cur = round(median(recent_w), 2)
            vitals["weight"] = {"value": cur, "unit": "lbs", "baseline": None, "change_pct": None, "level": "good"}
        if len(recent_w) >= 5 and len(base_w) >= 10:
            cur, base = median(recent_w), median(base_w)
            ch = _pct(cur, base)
            by_day = {}
            for ts, w in readings:
                if ts >= now - timedelta(days=30):
                    by_day.setdefault(local_date(ts), []).append(w)
            slope = _fit_slope([((d - today).days, median(ws)) for d, ws in by_day.items()])
            per_month = round(slope * 30, 2) if slope is not None else None
            vitals["weight"] = {"value": round(cur, 2), "unit": "lbs", "baseline": round(base, 2),
                                "change_pct": round(ch, 1), "per_month": per_month}
            lost = base - cur
            if ch <= -5:
                lvl = "concern"
                title = f"{cat} has lost {abs(ch):.1f}% of {poss} weight"
                action = (f"Book a vet visit and bring this chart. Unplanned loss is worth checking even if {pron} seems fine. "
                          "Vets consider a 10% drop clinically significant, and catching it earlier is better.")
            elif ch <= -3:
                lvl = "watch"
                title = f"{cat}'s weight is drifting down"
                action = "Nothing urgent. Keep watching for another week or two. If it keeps falling, mention it to your vet."
            elif ch >= 5:
                lvl = "watch"
                title = f"{cat} has gained {ch:.1f}%"
                action = "Usually diet or portion related. Worth checking portions, and asking your vet about a target weight."
            elif ch >= 3:
                lvl = "info"
                title = f"{cat} has put on a little weight"
                action = ("Nothing urgent. A small gain is often just portions or a change in food. If it keeps climbing, "
                          "check portions or ask your vet about a target weight.")
            else:
                lvl = "good"
                title = f"{cat}'s weight is steady"
                action = "Nothing to do. Steady weight is one of the best signs a cat is healthy."
            vitals["weight"]["level"] = lvl
            if abs(lost) * 16 < 0.5:
                detail = f"About {cur:.2f} lbs this week, essentially unchanged from {base:.2f} lbs over the month before."
            else:
                detail = (f"About {cur:.2f} lbs this week, compared with {base:.2f} lbs over the month before "
                          f"({'down' if lost > 0 else 'up'} {abs(lost) * 16:.1f} oz, {ch:+.1f}%).")
            if per_month is not None and abs(per_month) >= 0.05:
                detail += f" The 30-day trend is {per_month:+.2f} lbs per month."
            findings.append({
                "id": "weight", "topic": "Weight", "level": lvl, "title": title, "detail": detail,
                "why": ("Cats hide illness well, and slow weight loss is often the earliest visible sign that something "
                        "is off, sometimes before any other symptom. The robot weighs every visit, so it can spot a change "
                        "of a few ounces that you would never notice by picking her up."),
                "action": action, "sources": ["weight"],
            })
        elif recent_w:
            findings.append({
                "id": "weight", "topic": "Weight", "level": "info",
                "title": f"Building {cat}'s weight baseline",
                "detail": f"About {median(recent_w):.2f} lbs this week. Trends need about five weeks of readings.",
                "why": "Weight changes only mean something compared with her own normal.",
                "action": "Nothing to do. This fills in on its own.", "sources": ["weight"],
            })

        # ── Pee frequency ───────────────────────────────────────────────────
        r_u = _daily(visits, cat, recent_days, "Urine")
        b_u = _daily(visits, cat, base_days, "Urine")
        r_f = _daily(visits, cat, recent_days, "Feces")
        b_f = _daily(visits, cat, base_days, "Feces")
        r_all = _daily(visits, cat, recent_days)
        # The robot can call poop "pee". When poop is rare but total trips are normal,
        # treat that as a labelling problem rather than two separate health signals.
        mislabel_suspected = bool(r_f and r_u and mean(r_f) < 0.7 and 3 <= mean(r_all) <= 6.5)
        gi_note = (f" The robot can log loose stool as pee, so some of {cat}'s pee visits may really be stool."
                   if cat in GI_WATCH else "")
        if r_u:
            ru = mean(r_u)
            bu = mean(b_u) if len(b_u) >= 7 else None
            vitals["urine"] = {"value": round(ru, 1), "unit": "per day", "typical": [2, 4],
                               "baseline": round(bu, 1) if bu is not None else None}
            if ru > 6 or (bu and ru >= bu * 1.5 and ru - bu >= 1.5 and not mislabel_suspected):
                lvl = "watch" if ru <= 8 else "concern"
                title = f"{cat} is peeing more often than usual"
                action = ("If she is also straining, crying, or leaving only small spots, call a vet today. "
                          "Otherwise, mention it at the next visit, especially if she's drinking more too.")
            elif bu and ru - bu >= 1 and mislabel_suspected:
                lvl = "info"
                title = f"{cat}'s pee count is up, but some of it is probably poop"
                action = ("Check the box for a few days and tap what you find below. If you see lots of small pee clumps, "
                          "or she's straining, call your vet.")
            elif ru < 1.5 or (bu and ru <= bu * 0.5):
                lvl = "concern"
                title = f"{cat} is peeing less than usual"
                action = "Check the box for clumps and watch her in the box. Straining with little output is an emergency."
            else:
                lvl = "good"
                title = f"{cat}'s pee frequency is normal"
                action = "Nothing to do."
            vitals["urine"]["level"] = lvl
            detail = f"About {_fmt(ru)} a day over the last week"
            detail += f", compared with {bu:.1f} before." if bu is not None else "."
            detail += " Most healthy cats pee 2 to 4 times a day."
            if lvl == "good" and ru > 4.5 and (bu is None or abs(ru - bu) < 0.75):
                detail += (f" {cat} is above that range but steady, and a change from {poss} own normal matters more "
                           "than the textbook number.")
            detail += gi_note
            why = ("A change from a cat's own normal matters more than the exact number. Peeing more can go with "
                   "drinking more (kidney or thyroid issues, diabetes) or bladder irritation. Frequent trips with "
                   "little coming out can mean a blockage, which is an emergency.")
            if pron == "he":
                why += (f" {cat} is male. Males have a narrower urethra and are much more likely to get blocked, "
                        "so repeated trips with little output, straining, or crying in the box means going to a vet "
                        "or emergency clinic right away, not waiting.")
            findings.append({
                "id": "urine", "topic": "Peeing", "level": lvl, "title": title, "detail": detail,
                "why": why,
                "action": action, "sources": ["pee", "baseline", "straining"],
            })

        # ── Poop frequency ──────────────────────────────────────────────────
        if r_f:
            rf = mean(r_f)
            vitals["stool"] = {"value": round(rf, 1), "unit": "per day", "typical": [1, 2]}
            last_poop = max((v.ts for v in visits if v.counted and v.waste_type == "Feces"
                             and (v.cat == cat or v.likely_cat == cat)), default=None)
            hours_since = (now - last_poop).total_seconds() / 3600 if last_poop else None
            if mislabel_suspected:
                lvl = "watch"
                title = f"The robot is logging very little poop for {cat}"
                action = ("Take a quick look in the box or drawer and tap what you find below. A few check-ins tell us whether "
                          "the robot is mislabelling or she really isn't going. Call your vet if you find no stool for 2 to 3 days "
                          "or she's straining.")
            elif hours_since is not None and hours_since >= 48:
                lvl, title = "watch", f"No stool logged for {cat} in {int(hours_since // 24)} days"
                action = ("Check the box yourself. If she's straining or hasn't pooped in 3 days, call your vet. "
                          "The robot can miss or mislabel stool, so a look is worth it.")
            elif rf > 3:
                lvl, title = "watch", f"{cat} is pooping more often than usual"
                action = "Look at the stool. Loose or watery stool for more than a day or two is worth a vet call."
            elif rf < 0.5 and cat not in GI_WATCH:
                lvl, title = "watch", f"{cat} isn't pooping much"
                action = "Could be mild constipation. More water or wet food helps. Call your vet if it continues."
            else:
                lvl, title = "good", f"{cat}'s stool frequency looks normal"
                action = "Nothing to do."
            vitals["stool"]["level"] = lvl
            detail = f"About {_fmt(rf)} a day over the last week. Healthy adult cats usually go once or twice a day."
            if mislabel_suspected:
                detail = (f"Only {_fmt(rf)} a day logged as poop this week, but {cat}'s total trips ({mean(r_all):.1f} a day) "
                          "are normal. That pattern usually means the robot is calling some poops \"pee\", not that "
                          f"{cat} isn't going.")
            if cat in GI_WATCH and not mislabel_suspected:
                detail += f" For {cat}, the robot may undercount because loose stool can be logged as pee."
            findings.append({
                "id": "stool", "topic": "Pooping", "level": lvl, "title": title, "detail": detail,
                "why": "Changes in how often a cat poops are often the first sign of a stomach or bowel problem, or of constipation.",
                "action": action, "sources": ["poop"],
            })

        # ── Visit length ────────────────────────────────────────────────────
        mine = [v for v in visits if v.cat == cat and v.counted and v.use_duration]
        r_d = [v.duration for v in mine if local_date(v.ts) in recent_days]
        b_d = [v.duration for v in mine if local_date(v.ts) in base_days]
        if len(r_d) >= 10 and len(b_d) >= 15:
            rm, bm = median(r_d), median(b_d)
            vitals["duration"] = {"value": round(rm), "unit": "sec", "baseline": round(bm)}
            if rm >= bm * 1.4 and rm - bm >= 20:
                lvl, title = "watch", f"{cat} is spending longer in the box"
                action = "Watch a visit or two. If she's straining or crying, call a vet the same day."
            else:
                lvl, title = "good", f"{cat}'s time in the box is normal"
                action = "Nothing to do."
            vitals["duration"]["level"] = lvl
            findings.append({
                "id": "duration", "topic": "Time in the box", "level": lvl, "title": title,
                "detail": f"A typical visit lasted about {round(rm)} seconds this week, compared with {round(bm)} seconds before.",
                "why": "Longer visits can mean a cat is straining to pee or poop, which is uncomfortable and sometimes urgent.",
                "action": action, "sources": ["straining"],
            })

        # ── After-meal pattern (gut watch) ──────────────────────────────────
        if cat in GI_WATCH and _meal_minutes():
            window = [v for v in visits if v.counted and (v.cat == cat or v.likely_cat == cat)
                      and v.ts >= now - timedelta(days=14)]
            if len(window) >= 20:
                share = sum(1 for v in window if _after_meal(v.ts)) / len(window)
                expected = min(1.0, len(_meal_minutes()) * POST_MEAL_HOURS / 24)
                loose = possible_loose_stool(visits, cat)
                loose_wk = sum(1 for v in window if v.id in loose and v.ts >= now - timedelta(days=7))
                logged = [o for o in observations if o.cat == cat and o.created_at >= now - timedelta(days=14)]
                bad = [o for o in logged if o.kind in ("diarrhea", "soft_stool", "blood")]
                lvl = "watch" if (share >= expected * 2 or loose_wk >= 3 or len(bad) >= 2) else "good"
                if any(o.kind == "blood" for o in logged):
                    lvl = "concern"
                vitals["after_meal"] = {"value": round(share * 100), "unit": "%", "expected": round(expected * 100)}
                detail = (f"{round(share * 100)}% of {cat}'s visits in the last two weeks happened within "
                          f"{POST_MEAL_HOURS:g} hours of a meal (meals at {_meal_words()}). By chance you'd expect about "
                          f"{round(expected * 100)}%.")
                if loose_wk:
                    detail += (f" {loose_wk} pee-labelled visit{'s' if loose_wk != 1 else ''} this week look more like "
                               "loose stool: right after a meal, in back-to-back trips.")
                if logged:
                    detail += f" You logged {len(logged)} box check{'s' if len(logged) != 1 else ''} in that time."
                if any(o.kind == "blood" for o in logged):
                    title = f"You logged blood for {cat}"
                elif share >= expected * 2:
                    title = f"{cat}'s visits cluster after meals"
                elif loose_wk >= 3:
                    title = f"Some of {cat}'s pee visits look like loose stool"
                elif len(bad) >= 2:
                    title = f"You've logged loose stool for {cat} recently"
                else:
                    title = f"{cat}'s digestion pattern looks settled"
                findings.append({
                    "id": "after_meal", "topic": "Digestion", "level": lvl,
                    "title": title,
                    "detail": detail,
                    "why": ("Eating triggers the gut to move (the gastrocolic reflex), so some after-meal visits are normal. "
                            "A strong cluster, especially with loose stool, can point to a food sensitivity, eating too "
                            "fast, or an inflamed gut. It's a useful pattern to show your vet."),
                    "action": ("Log what you find in the box for a week (the buttons below). Two or more loose stools in a "
                               "week, or any blood, is worth a vet call. Ask whether a diet trial or a fecal test makes sense."),
                    "sources": ["poop"],
                })

        # ── Eating and drinking (PetLibro) ──────────────────────────────────
        fs = feeder_stats.get(cat, {})
        def per_day(days, key):
            vals = [fs[str(d)][key] for d in days if str(d) in fs]
            return vals
        pl_recent = [today - timedelta(days=i) for i in range(1, 8)]
        pl_base = [today - timedelta(days=i) for i in range(8, 31)]
        r_eat, b_eat = per_day(pl_recent, "eat_seconds"), per_day(pl_base, "eat_seconds")
        r_ses = per_day(pl_recent, "eat_sessions")
        if len(r_eat) >= 4:
            re_min = mean(r_eat) / 60
            be_min = mean(b_eat) / 60 if len(b_eat) >= 7 else None
            vitals["eating"] = {"value": round(re_min, 1), "unit": "min a day", "baseline": round(be_min, 1) if be_min else None,
                                "sessions": round(mean(r_ses), 1) if r_ses else None}
            lvl, title = "good", f"{cat} is eating normally"
            action = "Nothing to do."
            if be_min and be_min > 0:
                ratio = re_min / be_min
                if ratio <= 0.5:
                    lvl, title = "concern", f"{cat} is eating much less than usual"
                    action = ("Call your vet. A cat that eats much less for more than a day or two can get seriously ill, "
                              "even if it seems otherwise fine.")
                elif ratio <= 0.7:
                    lvl, title = "watch", f"{cat} is eating less than usual"
                    action = ("Check the bowl and watch a meal or two. If it continues for another day or two, or "
                              f"{pron} also seems quiet or is hiding, call your vet.")
                elif ratio >= 1.5:
                    lvl, title = "info", f"{cat} is spending more time eating"
                    action = "Usually fine. Combined with weight loss or more drinking, it's worth mentioning to your vet."
            detail = (f"About {re_min:.0f} minutes at the bowl a day over the last week, across "
                      f"{mean(r_ses):.0f} visits a day.") if r_ses else f"About {re_min:.0f} minutes at the bowl a day."
            if be_min:
                detail += f" Before that it was about {be_min:.0f} minutes a day."
            vitals["eating"]["level"] = lvl
            findings.append({
                "id": "eating", "topic": "Eating", "level": lvl, "title": title, "detail": detail,
                "why": ("A drop in appetite is one of the most common early signs that a cat isn't feeling well. Cats "
                        "that stop eating for even a few days can develop fatty liver disease, which is serious. Time "
                        f"at the bowl comes from {poss} RFID feeder, which only opens for {pronoun_obj(pron)}."),
                "action": action, "sources": ["appetite"],
            })

        r_ml, b_ml = per_day(pl_recent, "drink_ml"), per_day(pl_base, "drink_ml")
        if len(r_ml) >= 4 and sum(r_ml) > 0:
            rm_ml = mean(r_ml)
            bm_ml = mean(b_ml) if len(b_ml) >= 7 and sum(b_ml) > 0 else None
            vitals["water"] = {"value": round(rm_ml), "unit": "mL a day", "baseline": round(bm_ml) if bm_ml else None}
            lvl, title, action = "good", f"{cat}'s water intake is steady", "Nothing to do."
            if bm_ml:
                ratio = rm_ml / bm_ml
                if ratio >= 1.5 and rm_ml - bm_ml >= 20:
                    lvl, title = "watch", f"{cat} is drinking more than usual"
                    action = ("Keep an eye on it for a few days. Drinking noticeably more, especially with peeing more, "
                              "is worth a vet visit and a simple blood and urine test.")
                elif ratio <= 0.5:
                    lvl, title = "watch", f"{cat} is drinking less from the fountain"
                    action = ("Check that the fountain is full and running. If wet food hasn't changed and it continues, "
                              "mention it to your vet.")
            detail = f"About {rm_ml:.0f} mL a day from the fountain over the last week"
            detail += f", compared with {bm_ml:.0f} mL before." if bm_ml else "."
            detail += " Wet food supplies a lot of a cat's water too, so the trend matters more than the number."
            vitals["water"]["level"] = lvl
            findings.append({
                "id": "water", "topic": "Drinking", "level": lvl, "title": title, "detail": detail,
                "why": ("Drinking a lot more than usual is an early sign of kidney disease, diabetes, or an overactive "
                        "thyroid, which are all common in cats. The RFID fountain records which cat drank and how much."),
                "action": action, "sources": ["baseline"],
            })

        # ── Data confidence ─────────────────────────────────────────────────
        month = [v for v in visits if v.ts >= now - timedelta(days=30)]
        tagged = sum(1 for v in month if v.cat == cat)
        maybe = sum(1 for v in month if v.cat is None and v.likely_cat == cat)
        conf = {"tagged": tagged, "matched_by_weight": maybe,
                "untagged_total": sum(1 for v in month if v.cat is None)}

        worst = max((f["level"] for f in findings), key=lambda l: LEVELS.get(l, 0), default="info")
        n_watch = sum(1 for f in findings if f["level"] in ("watch", "concern"))
        if worst == "concern":
            headline = f"{cat} could use a vet's eyes"
        elif worst == "watch":
            headline = f"{cat} is mostly fine, with {'one thing' if n_watch == 1 else 'a few things'} to watch"
        elif findings:
            headline = f"{cat} is doing well"
        else:
            headline = f"Getting to know {cat}"

        parts = []
        if "weight" in vitals:
            w = vitals["weight"]
            if w.get("level") == "good" and w.get("baseline"):
                parts.append(f"Weight is holding steady at {w['value']:.1f} lbs.")
            else:
                parts.append(f"Weighs about {w['value']:.1f} lbs.")
        habits = []
        if "urine" in vitals:
            habits.append(f"pees about {_fmt(vitals['urine']['value'])} a day")
        if "stool" in vitals:
            habits.append(f"poops about {_fmt(vitals['stool']['value'])} a day")
        if habits:
            parts.append(f"{pron.capitalize()} " + " and ".join(habits) + ".")
        summary = " ".join(parts)

        male = pron == "he"
        for f in findings:
            for k in ("title", "detail", "why", "action"):
                f[k] = _pronouns(f[k], male)
        findings.sort(key=lambda f: -LEVELS.get(f["level"], 0))
        cats_out.append({"cat": cat, "status": "good" if worst == "info" else worst, "headline": headline,
                         "summary": summary, "vitals": vitals, "findings": findings, "confidence": conf,
                         "profile": prof})

    _MEALS["times"] = FEEDING_TIMES
    return {"generated_at": now.isoformat() + "Z", "cats": cats_out, "emergency": EMERGENCY,
            "sources": SOURCES, "feeding_times": FEEDING_TIMES,
            "meal_times": {c: meal_times.get(c) or FEEDING_TIMES for c in CATS},
            "meal_source": {c: "feeder" if meal_times.get(c) else "assumed" for c in CATS},
            "disclaimer": ("These notes compare your cats with general veterinary guidance and with their own history. "
                           "They are not a diagnosis. When in doubt, call your vet.")}
