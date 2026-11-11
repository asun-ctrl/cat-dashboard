"""Health alerts and notifications.

Rules run after every sync against the quality-filtered data. Each alert has a
dedupe key and a cooldown so you get one notification per problem, not one
every 30 minutes.

Channels (all optional, configured with Railway variables):
  ntfy push:   NTFY_TOPIC (plus NTFY_SERVER, NTFY_TOKEN if self-hosted or protected)
  Twilio SMS:  TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM, ALERT_SMS_TO
Other settings:
  QUIET_HOURS  e.g. "22-7" (local time). Only critical alerts go out then.
  DIGEST_HOUR  e.g. "20" for a daily summary at 8 PM local. Unset to disable.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timedelta
from statistics import mean, median, pstdev
from typing import Optional

import httpx

from quality import Assessed, CATS
from timeutil import fmt_local, local_date, local_now, utc_now

WEIGHT_DROP_WARN = float(os.getenv("WEIGHT_DROP_WARN_PCT", "4"))
WEIGHT_DROP_CRIT = float(os.getenv("WEIGHT_DROP_CRIT_PCT", "7"))
NO_VISIT_HOURS = int(os.getenv("NO_VISIT_HOURS", "24"))
URINE_DAILY_MAX = int(os.getenv("URINE_DAILY_MAX", "7"))
FECES_DAILY_MAX = int(os.getenv("FECES_DAILY_MAX", "4"))
DRAWER_ALERT_PCT = float(os.getenv("DRAWER_ALERT_PCT", "85"))
SYNC_STALE_HOURS = float(os.getenv("SYNC_STALE_HOURS", "2"))
UNIDENTIFIED_DAILY_MAX = int(os.getenv("UNIDENTIFIED_DAILY_MAX", "4"))
LONG_VISIT_SECONDS = int(os.getenv("LONG_VISIT_SECONDS", "240"))

SEVERITY_RANK = {"info": 0, "warning": 1, "critical": 2}


@dataclass
class Alert:
    key: str
    severity: str
    title: str
    message: str
    cat: Optional[str] = None
    cooldown_hours: float = 12


# ── Rules ────────────────────────────────────────────────────────────────────

def evaluate(visits: list[Assessed], robot: Optional[dict], last_success: Optional[datetime],
             now: Optional[datetime] = None) -> list[Alert]:
    now = now or utc_now()
    today = local_date(now)
    alerts: list[Alert] = []

    for cat in CATS:
        mine = [v for v in visits if v.cat == cat and v.counted]
        if not mine:
            continue

        # Weight drop: last 7 days vs the 30 days before that.
        recent_w = [v.weight_lbs for v in mine if v.use_weight and v.ts >= now - timedelta(days=7)]
        base_w = [v.weight_lbs for v in mine if v.use_weight
                  and now - timedelta(days=37) <= v.ts < now - timedelta(days=7)]
        if len(recent_w) >= 5 and len(base_w) >= 10:
            r, b = median(recent_w), median(base_w)
            drop = (b - r) / b * 100
            if drop >= WEIGHT_DROP_WARN:
                sev = "critical" if drop >= WEIGHT_DROP_CRIT else "warning"
                alerts.append(Alert(
                    key=f"weight_drop:{cat}", severity=sev, cat=cat, cooldown_hours=72,
                    title=f"{cat} weight down {drop:.1f}%",
                    message=f"{cat} is averaging {r:.2f} lbs this week, down from {b:.2f} lbs over the prior month. Steady loss is worth a vet call."))

        # No confirmed visits.
        last_visit = max(v.ts for v in mine)
        hours_since = (now - last_visit).total_seconds() / 3600
        if hours_since >= NO_VISIT_HOURS:
            unid = sum(1 for v in visits if v.cat is None and v.counted and v.ts >= last_visit)
            extra = f" There were {unid} untagged visits in that time, so the pet ID may be missing {cat}." if unid else ""
            alerts.append(Alert(
                key=f"no_visits:{cat}", severity="critical", cat=cat, cooldown_hours=12,
                title=f"No visits from {cat} in {int(hours_since)}h",
                message=f"{cat} has no confirmed litter box visits since {fmt_local(last_visit)}.{extra}"))

        # Daily counts (local day).
        today_v = [v for v in mine if local_date(v.ts) == today]
        urine = sum(1 for v in today_v if v.waste_type == "Urine")
        feces = sum(1 for v in today_v if v.waste_type == "Feces")
        if urine >= URINE_DAILY_MAX:
            note = " The robot can log loose stool as urine, so check the box." if cat == "Guava" else ""
            alerts.append(Alert(
                key=f"urine_high:{cat}:{today}", severity="warning", cat=cat, cooldown_hours=24,
                title=f"{cat}: {urine} urine visits today",
                message=f"{cat} has {urine} urine-classified visits today (alert at {URINE_DAILY_MAX}).{note}"))
        if feces >= FECES_DAILY_MAX:
            alerts.append(Alert(
                key=f"feces_high:{cat}:{today}", severity="warning", cat=cat, cooldown_hours=24,
                title=f"{cat}: {feces} bowel movements today",
                message=f"{cat} has {feces} feces visits today (alert at {FECES_DAILY_MAX})."))

        # Visit spike vs her own 14 day baseline.
        last24 = sum(1 for v in mine if v.ts >= now - timedelta(hours=24))
        daily = []
        for d in range(1, 15):
            start = now - timedelta(days=d + 1)
            end = now - timedelta(days=d)
            daily.append(sum(1 for v in mine if start <= v.ts < end))
        if sum(daily) >= 14:
            mu, sd = mean(daily), pstdev(daily)
            if last24 >= max(mu * 1.75, mu + 3 * sd, mu + 3):
                alerts.append(Alert(
                    key=f"visit_spike:{cat}", severity="warning", cat=cat, cooldown_hours=24,
                    title=f"{cat} visit spike",
                    message=f"{cat} made {last24} visits in the last 24h. Normal for {cat} is about {mu:.1f} per day."))

        # Repeated long visits (possible straining).
        durs = sorted(v.duration for v in mine if v.use_duration and v.ts >= now - timedelta(days=30))
        if len(durs) >= 20:
            p95 = durs[int(0.95 * (len(durs) - 1))]
            limit = max(LONG_VISIT_SECONDS, p95)
            long_recent = [v for v in mine if v.use_duration and v.ts >= now - timedelta(hours=12) and v.duration > limit]
            if len(long_recent) >= 2:
                alerts.append(Alert(
                    key=f"long_visits:{cat}", severity="warning", cat=cat, cooldown_hours=12,
                    title=f"{cat}: repeated long visits",
                    message=f"{cat} had {len(long_recent)} visits over {limit // 60}m {limit % 60}s in the last 12h. That can mean straining."))

    # Untagged visits piling up.
    unid24 = sum(1 for v in visits if v.cat is None and "unidentified" in v.flags and v.ts >= now - timedelta(hours=24))
    if unid24 >= UNIDENTIFIED_DAILY_MAX:
        alerts.append(Alert(
            key="unidentified", severity="info", cooldown_hours=24,
            title=f"{unid24} untagged visits in 24h",
            message="The robot is not identifying one of the cats. Pet ID may need recalibrating in the Whisker app."))

    # Robot and pipeline health.
    if robot and robot.get("waste_drawer_level") is not None and robot["waste_drawer_level"] >= DRAWER_ALERT_PCT:
        alerts.append(Alert(
            key="drawer_full", severity="warning", cooldown_hours=24,
            title=f"Waste drawer {robot['waste_drawer_level']:.0f}% full",
            message="Empty the Litter-Robot drawer."))
    if last_success is None or (now - last_success).total_seconds() / 3600 >= SYNC_STALE_HOURS:
        alerts.append(Alert(
            key="sync_stale", severity="warning", cooldown_hours=12,
            title="Dashboard is not receiving data",
            message="No successful Whisker sync in over two hours. The robot may be offline or the login may have expired."))

    return alerts


def feeder_alerts(last_seen: dict, device_issues: list, now: Optional[datetime] = None) -> list[Alert]:
    now = now or utc_now()
    out = []
    for cat in CATS:
        ate = (last_seen.get(cat) or {}).get("ate")
        if ate and (now - ate).total_seconds() / 3600 >= int(os.getenv("NO_EATING_HOURS", "24")):
            out.append(Alert(key=f"no_eating:{cat}", severity="critical", cat=cat, cooldown_hours=12,
                             title=f"{cat} hasn't eaten in {int((now - ate).total_seconds() // 3600)}h",
                             message=f"{cat}'s feeder hasn't seen {cat} since {fmt_local(ate)}. Check on {cat} and the feeder. "
                                     "A cat that stops eating needs a vet soon."))
    for issue in device_issues:
        out.append(Alert(key=issue["key"], severity="warning", cooldown_hours=24, title=issue["title"],
                         message="Reported by PetLibro."))
    return out


# ── Delivery ─────────────────────────────────────────────────────────────────

def channels_configured() -> dict:
    return {
        "ntfy": bool(os.getenv("NTFY_TOPIC")),
        "sms": all(os.getenv(k) for k in ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM", "ALERT_SMS_TO")),
        "quiet_hours": os.getenv("QUIET_HOURS") or None,
        "digest_hour": os.getenv("DIGEST_HOUR") or None,
    }


def in_quiet_hours(now_utc: datetime) -> bool:
    spec = os.getenv("QUIET_HOURS")
    if not spec:
        return False
    try:
        start, end = (int(x) for x in spec.split("-"))
    except ValueError:
        return False
    h = local_now(now_utc).hour
    return (start <= h or h < end) if start > end else (start <= h < end)


async def send(title: str, message: str, severity: str = "warning") -> list[str]:
    delivered = []
    async with httpx.AsyncClient(timeout=10) as client:
        topic = os.getenv("NTFY_TOPIC")
        if topic:
            server = os.getenv("NTFY_SERVER", "https://ntfy.sh").rstrip("/")
            headers = {
                "Title": title,
                "Priority": {"critical": "urgent", "warning": "high"}.get(severity, "default"),
                "Tags": {"critical": "rotating_light", "warning": "warning"}.get(severity, "cat"),
            }
            if os.getenv("NTFY_TOKEN"):
                headers["Authorization"] = f"Bearer {os.getenv('NTFY_TOKEN')}"
            if os.getenv("DASHBOARD_URL"):
                headers["Click"] = os.getenv("DASHBOARD_URL")
            try:
                r = await client.post(f"{server}/{topic}", content=message.encode(), headers=headers)
                if r.status_code < 300:
                    delivered.append("ntfy")
            except httpx.HTTPError as e:
                print(f"[ALERT] ntfy failed: {e}")

        if channels_configured()["sms"]:
            sid = os.getenv("TWILIO_ACCOUNT_SID")
            try:
                r = await client.post(
                    f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json",
                    auth=(sid, os.getenv("TWILIO_AUTH_TOKEN")),
                    data={"From": os.getenv("TWILIO_FROM"), "To": os.getenv("ALERT_SMS_TO"),
                          "Body": f"{title}\n{message}"[:1500]},
                )
                if r.status_code < 300:
                    delivered.append("sms")
            except httpx.HTTPError as e:
                print(f"[ALERT] SMS failed: {e}")
    return delivered


async def process(db, alerts: list[Alert], now: Optional[datetime] = None) -> list[dict]:
    """Dedupe, respect quiet hours, send, and log. Returns what was logged."""
    from db import AlertLog
    now = now or utc_now()
    quiet = in_quiet_hours(now)
    logged = []
    for a in alerts:
        since = now - timedelta(hours=a.cooldown_hours)
        q = db.query(AlertLog).filter(AlertLog.key == a.key, AlertLog.created_at >= since)
        held_now = quiet and a.severity != "critical"
        if held_now:
            if q.first():
                continue
        elif q.filter(AlertLog.delivered != "held").first():
            continue

        delivered = "held" if held_now else ",".join(await send(a.title, a.message, a.severity))
        row = AlertLog(key=a.key, severity=a.severity, cat_name=a.cat, title=a.title,
                       message=a.message, created_at=now, delivered=delivered)
        db.add(row)
        db.commit()
        logged.append({"title": a.title, "severity": a.severity, "delivered": delivered})
    return logged


def digest_text(summary: dict) -> str:
    lines = []
    for cat, d in summary.items():
        if not isinstance(d, dict) or "today" not in d:
            continue
        t, a = d["today"], d["averages"]
        w = a.get("latest_weight_lbs")
        wtxt = f", {w:.2f} lbs" if w else ""
        lines.append(f"{cat}: {t['urine']} urine, {t['feces']} feces today "
                     f"(avg {a['daily_urine']}u / {a['daily_feces']}f){wtxt}")
    return "\n".join(lines) or "No data today."
