import asyncio
import csv
import io
import json
import os
from datetime import datetime, timedelta, timezone
from statistics import median
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

load_dotenv()

import alerts as alerting  # noqa: E402
from db import (AlertLog, LitterVisit, Observation, PetProfile, RobotStatus,  # noqa: E402
                SessionLocal, SyncLog, VisitOverride, WeightHistory, init_db, DATA_DIR)
from insights import build_insights, possible_loose_stool  # noqa: E402
import petlibro  # noqa: E402
from quality import CATS, FLAG_TEXT, assess, quality_report  # noqa: E402
from timeutil import (days_back, iso_utc, local_date, local_midnight_utc,  # noqa: E402
                      to_local, utc_now)

init_db()

app = FastAPI(title="Cat Health Monitor")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

PET_ID_MAP = {"PET-4bb19424-5bff-430a-a82d-58121d25838f": "Guava"}
LYCHEE_ID_SUFFIX = "2219d03e"
HISTORY_DAYS = int(os.getenv("HISTORY_DAYS", "400"))


# ── Whisker sync ─────────────────────────────────────────────────────────────

async def build_pet_map(account):
    try:
        for pet in getattr(account, "pets", None) or []:
            pid = getattr(pet, "id", None) or getattr(pet, "petId", None)
            name = getattr(pet, "name", None)
            if pid and name:
                PET_ID_MAP[pid] = name
    except Exception as e:
        print(f"[PET MAP] {e}")


async def cache_whisker_photos(db):
    """Keep a local copy of each Whisker profile photo. Whisker's links expire within
    an hour and carry temporary AWS keys, so the dashboard serves its own copy instead.
    A photo uploaded from the dashboard always wins."""
    import httpx
    for prof in db.query(PetProfile).all():
        if not prof.whisker_image_url or (prof.photo_file and not prof.photo_file.endswith("_whisker.jpg")):
            continue
        name = f"{prof.cat.lower()}_whisker.jpg"
        path = os.path.join(PHOTO_DIR, name)
        fresh = os.path.exists(path) and (utc_now() - datetime.utcfromtimestamp(os.path.getmtime(path))).days < 7
        if fresh and prof.photo_file == name:
            continue
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                r = await client.get(prof.whisker_image_url)
            if r.status_code != 200:
                continue
            from PIL import Image, ImageOps
            img = ImageOps.exif_transpose(Image.open(io.BytesIO(r.content))).convert("RGB")
            img.thumbnail((900, 900))
            img.save(path, "JPEG", quality=86)
            prof.photo_file, prof.photo_updated = name, utc_now()
            db.commit()
        except Exception as e:
            print(f"[PHOTO] {prof.cat}: {e}")


def save_pet_profiles(db, account):
    """Mirror photo, details, and weight history from the Whisker pet profile."""
    for pet in getattr(account, "pets", None) or []:
        try:
            data = getattr(pet, "_data", {}) or {}
            name = data.get("name") or getattr(pet, "name", None)
            if name not in CATS:
                continue
            prof = db.get(PetProfile, name) or PetProfile(cat=name)
            prof.pet_id = data.get("petId")
            prof.whisker_image_url = data.get("s3ImageURL")
            prof.gender = data.get("gender")
            prof.birthday = data.get("birthday")
            prof.age = data.get("age")
            prof.breeds = ", ".join(data.get("breeds") or []) or None
            prof.diet = data.get("diet")
            prof.is_fixed = 1 if data.get("isFixed") else 0 if data.get("isFixed") is not None else None
            prof.updated_at = utc_now()
            db.add(prof)
            for entry in data.get("weightHistory") or []:
                ts = parse_ts(entry.get("timestamp"))
                w = entry.get("weight")
                if ts is None or not w:
                    continue
                if not db.query(WeightHistory.id).filter(WeightHistory.cat == name, WeightHistory.timestamp == ts).first():
                    db.add(WeightHistory(cat=name, timestamp=ts, weight_lbs=float(w)))
            db.commit()
        except Exception as e:
            db.rollback()
            print(f"[PROFILE] {e}")


def get_cat_name(ad):
    pet_ids = ad.get("petIds") or []
    if not pet_ids:
        return "Unknown", None
    pid = pet_ids[0]
    if pid in PET_ID_MAP:
        return PET_ID_MAP[pid], pid
    if pid.endswith(LYCHEE_ID_SUFFIX):
        PET_ID_MAP[pid] = "Lychee"
        return "Lychee", pid
    return f"Cat-{pid[-8:]}", pid


def parse_ts(value) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        try:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


_sync_lock = asyncio.Lock()


async def sync_litter_robot(historical: bool = False):
    async with _sync_lock:
        db = SessionLocal()
        try:
            from pylitterbot import Account, LitterRobot5
            email, password = os.getenv("WHISKER_EMAIL"), os.getenv("WHISKER_PASSWORD")
            if not email or not password:
                raise RuntimeError("Whisker credentials are not set")

            account = Account(robot_types=[LitterRobot5])
            await account.connect(username=email, password=password, load_robots=True, load_pets=True)
            await build_pet_map(account)
            save_pet_profiles(db, account)
            await cache_whisker_photos(db)

            limit = 1000 if historical else 200
            new_count = pet_visits = 0
            for robot in account.robots:
                try:
                    level = getattr(robot, "waste_drawer_level", None)
                    litter = getattr(robot, "litter_level", None)
                    online = getattr(robot, "is_online", True)
                    db.add(RobotStatus(timestamp=utc_now(), waste_drawer_level=level,
                                       litter_level=str(litter) if litter is not None else None,
                                       is_online=1 if online else 0))
                    db.commit()
                except Exception as e:
                    print(f"[STATUS] {e}")
                    db.rollback()

                for activity in await robot.get_activities(limit=limit):
                    ad = activity if isinstance(activity, dict) else (vars(activity) if hasattr(activity, "__dict__") else {})
                    if ad.get("type") != "PET_VISIT":
                        continue
                    pet_visits += 1
                    ts = parse_ts(ad.get("timestamp"))
                    if ts is None:
                        continue
                    cat, pid = get_cat_name(ad)
                    event_id = ad.get("eventId") or ad.get("id")
                    exists = db.query(LitterVisit).filter(
                        LitterVisit.timestamp == ts, LitterVisit.cat_name == cat).first()
                    if exists:
                        if exists.raw_json is None:
                            exists.event_id = str(event_id) if event_id else None
                            exists.raw_json = json.dumps(ad, default=str)
                        continue
                    db.add(LitterVisit(
                        cat_name=cat, pet_id=pid, timestamp=ts,
                        waste_type=ad.get("wasteType") or "Unknown",
                        duration_seconds=ad.get("duration"),
                        weight_grams=ad.get("petWeight"),
                        waste_weight_grams=ad.get("wasteWeight"),
                        event_id=str(event_id) if event_id else None,
                        raw_json=json.dumps(ad, default=str),
                    ))
                    new_count += 1
            db.commit()
            await account.disconnect()

            msg = f"Sync successful: {new_count} new visits ({pet_visits} pet visits checked)"
            db.add(SyncLog(timestamp=utc_now(), status="success", message=msg))
            db.commit()
            print(f"[SYNC] {msg}")
        except Exception as e:
            import traceback
            print(f"[SYNC] error: {e}\n{traceback.format_exc()}")
            db.rollback()
            db.add(SyncLog(timestamp=utc_now(), status="error", message=str(e)[:500]))
            db.commit()
        finally:
            db.close()

    await sync_petlibro()
    await run_alerts()


_petlibro_lock = asyncio.Lock()


async def sync_petlibro():
    if not petlibro.configured():
        return
    if _petlibro_lock.locked():
        return          # a sync is already running
    async with _petlibro_lock:
        await _sync_petlibro()


async def _sync_petlibro():
    db = SessionLocal()
    try:
        msg = await petlibro.sync(db)
        db.add(SyncLog(timestamp=utc_now(), status="petlibro", message=msg[:500]))
        db.commit()
        print(f"[PETLIBRO] {msg}")
    except Exception as e:
        db.rollback()
        db.add(SyncLog(timestamp=utc_now(), status="petlibro_error", message=str(e)[:500]))
        db.commit()
        print(f"[PETLIBRO] error: {e}")
    finally:
        db.close()


# ── Shared data loading ──────────────────────────────────────────────────────

def load_assessed(db, days: int = HISTORY_DAYS):
    since = utc_now() - timedelta(days=days)
    rows = db.query(LitterVisit).filter(LitterVisit.timestamp >= since).all()
    overrides = {o.visit_id: o for o in db.query(VisitOverride).all()}
    return assess(rows, overrides)


def latest_robot(db) -> Optional[dict]:
    s = db.query(RobotStatus).order_by(RobotStatus.timestamp.desc()).first()
    if not s:
        return None
    return {"waste_drawer_level": s.waste_drawer_level, "litter_level": s.litter_level,
            "is_online": s.is_online, "last_checked": iso_utc(s.timestamp)}


def last_success(db) -> Optional[datetime]:
    s = db.query(SyncLog).filter(SyncLog.status == "success").order_by(SyncLog.timestamp.desc()).first()
    return s.timestamp if s else None


async def run_alerts():
    db = SessionLocal()
    try:
        visits = load_assessed(db, days=60)
        found = alerting.evaluate(visits, latest_robot(db), last_success(db))
        found += alerting.feeder_alerts(petlibro.last_seen(db), petlibro.device_alerts(db)) if petlibro.configured() else []
        logged = await alerting.process(db, found)
        if logged:
            print(f"[ALERTS] {logged}")
    except Exception as e:
        print(f"[ALERTS] error: {e}")
    finally:
        db.close()


# ── Summary ──────────────────────────────────────────────────────────────────

def _counts(vs):
    return {"urine": sum(1 for v in vs if v.waste_type == "Urine"),
            "feces": sum(1 for v in vs if v.waste_type == "Feces"),
            "total": len(vs)}


def build_summary(visits, now: Optional[datetime] = None) -> dict:
    now = now or utc_now()
    today = local_date(now)
    by_day = {}
    for v in visits:
        by_day.setdefault(local_date(v.ts), []).append(v)

    def possible_for(cat, vs):
        """Unattributed visits that could belong to `cat` (not clearly the other cat)."""
        return [v for v in vs if v.counted and v.cat is None and (v.likely_cat in (None, cat))]

    results = {}
    for cat in CATS:
        mine = [v for v in visits if v.cat == cat and v.counted]

        def day_entry(d, with_unknown=True):
            vs = by_day.get(d, [])
            c = _counts([v for v in vs if v.cat == cat and v.counted])
            if with_unknown:
                pos = possible_for(cat, vs)
                c["unknown"] = len(pos)
                c["likely"] = sum(1 for v in pos if v.likely_cat == cat)
            return c

        today_c = day_entry(today)
        today_pos = possible_for(cat, by_day.get(today, []))

        urine_status = "red" if today_c["urine"] > 6 else "yellow" if today_c["urine"] > 4 else "green"
        feces_status = ("red" if today_c["feces"] > 3 else
                        "yellow" if today_c["feces"] == 0 and to_local(now).hour > 14 else "green")

        week_trend = {str(d): day_entry(d) for d in days_back(today, 7)}
        month_trend = {str(d): day_entry(d) for d in days_back(today, 30)}

        def weekly(n_weeks):
            out = {}
            for i in range(n_weeks):
                end = today - timedelta(weeks=i)
                start = end - timedelta(days=6)
                vs = [v for v in mine if start <= local_date(v.ts) <= end]
                out[str(start)] = _counts(vs)
            return out

        # Weight: daily median of trusted readings, in lbs.
        weight_trend, duration_trend, waste_trend = {}, {}, {}
        for d in days_back(today, 90):
            vs = [v for v in by_day.get(d, []) if v.cat == cat and v.counted]
            w = [v.weight_lbs for v in vs if v.use_weight]
            if w:
                weight_trend[str(d)] = round(median(w), 2)
            if d >= today - timedelta(days=29):
                du = [v.duration for v in vs if v.use_duration]
                if du:
                    duration_trend[str(d)] = round(sum(du) / len(du), 1)
                ww = [v.waste for v in vs if v.use_waste]
                if ww:
                    waste_trend[str(d)] = round(sum(ww), 1)

        recent90 = [v for v in mine if local_date(v.ts) >= today - timedelta(days=89)]
        hour_pattern = {str(h): {"urine": 0, "feces": 0} for h in range(24)}
        for v in recent90:
            h = str(to_local(v.ts).hour)
            if v.waste_type == "Urine":
                hour_pattern[h]["urine"] += 1
            elif v.waste_type == "Feces":
                hour_pattern[h]["feces"] += 1

        span_days = (today - min(local_date(v.ts) for v in recent90)).days + 1 if recent90 else 0
        trusted = [v.weight_lbs for v in sorted(mine, key=lambda v: v.ts) if v.use_weight]
        latest_w = round(median(trusted[-5:]), 2) if trusted else None
        base_w = [v.weight_lbs for v in mine if v.use_weight and v.ts >= now - timedelta(days=30)]
        base_w = round(median(base_w), 2) if base_w else None

        results[cat] = {
            "today": {
                **{k: today_c[k] for k in ("urine", "feces", "total")},
                "urine_status": urine_status, "feces_status": feces_status,
                "unknown_urine": sum(1 for v in today_pos if v.waste_type == "Urine"),
                "unknown_feces": sum(1 for v in today_pos if v.waste_type == "Feces"),
                "unknown_total": len(today_pos),
                "likely_total": today_c["likely"],
            },
            "averages": {
                "daily_urine": round(sum(1 for v in recent90 if v.waste_type == "Urine") / max(span_days, 1), 1),
                "daily_feces": round(sum(1 for v in recent90 if v.waste_type == "Feces") / max(span_days, 1), 1),
                "days_tracked": span_days,
                "total_days_tracked": (today - min(local_date(v.ts) for v in mine)).days + 1 if mine else 0,
                "latest_weight_lbs": latest_w,
                "baseline_weight_lbs": base_w,
            },
            "week_trend": week_trend,
            "month_trend": month_trend,
            "quarter_trend": weekly(13),
            "year_trend": weekly(52),
            "hour_pattern": hour_pattern,
            "weight_trend": weight_trend,
            "duration_trend": duration_trend,
            "waste_trend": waste_trend,
        }
    return results


def visit_json(v, loose=frozenset()):
    return {
        "possible_loose_stool": v.id in loose,
        "id": v.id, "cat_name": v.cat or ("Unknown" if v.reported_cat not in CATS else v.reported_cat),
        "reported_cat": v.reported_cat, "counted_as": v.cat, "likely_cat": v.likely_cat,
        "timestamp": iso_utc(v.ts), "waste_type": v.waste_type, "duration_seconds": v.duration,
        "weight_lbs": v.weight_lbs, "waste_weight": v.waste,
        "use_weight": v.use_weight, "use_waste": v.use_waste, "counted": v.counted,
        "flags": v.flags, "reason": v.reason, "override": v.override,
    }


# ── Routes ───────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health_check():
    return {"status": "ok", "timestamp": iso_utc(utc_now()), "data_dir": DATA_DIR}


@app.get("/api/robot/status")
def get_robot_status():
    db = SessionLocal()
    try:
        return latest_robot(db) or {"waste_drawer_level": None, "litter_level": None, "is_online": None}
    finally:
        db.close()


@app.get("/api/litter/summary")
def get_litter_summary():
    db = SessionLocal()
    try:
        return build_summary(load_assessed(db))
    finally:
        db.close()


@app.get("/api/litter/recent")
def get_recent_visits(limit: int = 50, flagged_only: bool = False):
    db = SessionLocal()
    try:
        vs = sorted(load_assessed(db, days=60), key=lambda v: v.ts, reverse=True)
        if flagged_only:
            vs = [v for v in vs if not v.counted or v.cat is None or not v.use_weight
                  or "waste_outlier" in v.flags or v.override]
        loose = set()
        for c in CATS:
            loose |= possible_loose_stool(vs, c)
        return [visit_json(v, loose) for v in vs[:max(1, min(limit, 500))]]
    finally:
        db.close()


@app.get("/api/quality")
def get_quality(days: int = 30):
    db = SessionLocal()
    try:
        vs = load_assessed(db)
        report = quality_report(vs, utc_now() - timedelta(days=days))
        report["days"] = days
        report["flag_text"] = FLAG_TEXT
        return report
    finally:
        db.close()


class OverrideIn(BaseModel):
    action: str                    # exclude | include | assign
    assign_to: Optional[str] = None
    note: Optional[str] = None


@app.post("/api/visits/{visit_id}/override")
def set_override(visit_id: int, body: OverrideIn):
    if body.action not in ("exclude", "include", "assign"):
        raise HTTPException(400, "action must be exclude, include, or assign")
    if body.action == "assign" and body.assign_to not in CATS:
        raise HTTPException(400, f"assign_to must be one of {CATS}")
    db = SessionLocal()
    try:
        if not db.get(LitterVisit, visit_id):
            raise HTTPException(404, "visit not found")
        o = db.query(VisitOverride).filter(VisitOverride.visit_id == visit_id).first() or VisitOverride(visit_id=visit_id)
        o.action, o.assign_to, o.note, o.created_at = body.action, body.assign_to, body.note, utc_now()
        db.add(o)
        db.commit()
        return {"ok": True}
    finally:
        db.close()


@app.delete("/api/visits/{visit_id}/override")
def clear_override(visit_id: int):
    db = SessionLocal()
    try:
        db.query(VisitOverride).filter(VisitOverride.visit_id == visit_id).delete()
        db.commit()
        return {"ok": True}
    finally:
        db.close()


@app.get("/api/alerts")
def get_alerts(limit: int = 20):
    db = SessionLocal()
    try:
        rows = db.query(AlertLog).order_by(AlertLog.created_at.desc()).limit(min(limit, 200)).all()
        return {
            "channels": alerting.channels_configured(),
            "alerts": [{"id": a.id, "severity": a.severity, "cat": a.cat_name, "title": a.title,
                        "message": a.message, "created_at": iso_utc(a.created_at),
                        "delivered": a.delivered} for a in rows],
        }
    finally:
        db.close()


_last_test = {"at": None}


@app.post("/api/alerts/test")
async def test_alert():
    now = utc_now()
    if _last_test["at"] and (now - _last_test["at"]).total_seconds() < 60:
        raise HTTPException(429, "Wait a minute between test alerts")
    _last_test["at"] = now
    delivered = await alerting.send("Cat dashboard test", "Alerts are working.", "info")
    return {"delivered": delivered, "channels": alerting.channels_configured()}


@app.get("/api/export.csv")
def export_csv():
    db = SessionLocal()
    try:
        vs = sorted(load_assessed(db, days=3650), key=lambda v: v.ts)
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["local_time", "reported_cat", "counted_as", "likely_cat", "waste_type",
                    "duration_s", "weight_lbs", "waste_weight", "weight_used", "notes"])
        for v in vs:
            w.writerow([to_local(v.ts).strftime("%Y-%m-%d %H:%M"), v.reported_cat, v.cat or "",
                        v.likely_cat or "", v.waste_type, v.duration or "", v.weight_lbs or "",
                        v.waste or "", "yes" if v.use_weight else "no", v.reason])
        buf.seek(0)
        return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                                 headers={"Content-Disposition": "attachment; filename=litter_visits.csv"})
    finally:
        db.close()


# ── Insights, profiles, photos, check-ins ───────────────────────────────────

def _profiles(db) -> dict:
    out = {}
    for p in db.query(PetProfile).all():
        photo = None
        if p.photo_file and os.path.exists(os.path.join(PHOTO_DIR, p.photo_file)):
            v = int(p.photo_updated.timestamp()) if p.photo_updated else 0
            photo = f"/api/pets/{p.cat}/photo?v={v}"
        out[p.cat] = {"cat": p.cat, "photo": photo, "photo_source": ("whisker" if (p.photo_file or "").endswith("_whisker.jpg") else "upload") if photo else None,
                      "gender": p.gender, "birthday": p.birthday, "age": p.age, "breeds": p.breeds,
                      "diet": p.diet, "is_fixed": p.is_fixed}
    for c in CATS:
        out.setdefault(c, {"cat": c, "photo": None})
    return out


def _weight_history(db, days: int = 400) -> dict:
    since = utc_now() - timedelta(days=days)
    out = {}
    for w in db.query(WeightHistory).filter(WeightHistory.timestamp >= since).all():
        out.setdefault(w.cat, []).append((w.timestamp, w.weight_lbs))
    return out


@app.get("/api/insights")
def get_insights():
    db = SessionLocal()
    try:
        visits = load_assessed(db, days=120)
        obs = db.query(Observation).filter(Observation.created_at >= utc_now() - timedelta(days=60)).all()
        return build_insights(visits, _profiles(db), _weight_history(db), obs, meal_times=petlibro.meal_times(db),
                              feeder_stats=petlibro.daily_stats(db, days=40))
    finally:
        db.close()


@app.get("/api/petlibro")
def get_petlibro():
    db = SessionLocal()
    try:
        return petlibro.summary(db)
    finally:
        db.close()


@app.get("/api/debug/petlibro")
def debug_petlibro():
    db = SessionLocal()
    try:
        return petlibro.debug_shapes(db)
    finally:
        db.close()


@app.post("/api/petlibro/sync")
async def petlibro_sync_now():
    await sync_petlibro()
    return get_sync_status()["petlibro"]


@app.get("/api/pets")
def get_pets():
    db = SessionLocal()
    try:
        return _profiles(db)
    finally:
        db.close()


PHOTO_DIR = os.path.join(DATA_DIR, "photos")
os.makedirs(PHOTO_DIR, exist_ok=True)


@app.post("/api/pets/{cat}/photo")
async def upload_photo(cat: str, file: UploadFile = File(...)):
    if cat not in CATS:
        raise HTTPException(404, "Unknown cat")
    data = await file.read()
    if len(data) > 15 * 1024 * 1024:
        raise HTTPException(413, "Photo is too large (15 MB max)")
    try:
        from PIL import Image, ImageOps
        try:
            from pillow_heif import register_heif_opener
            register_heif_opener()
        except ImportError:
            pass
        img = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
        img.thumbnail((900, 900))
    except Exception:
        raise HTTPException(400, "That file isn't a photo we can read. Try a JPG, PNG, or HEIC.")
    name = f"{cat.lower()}.jpg"
    img.save(os.path.join(PHOTO_DIR, name), "JPEG", quality=86)  # re-encoding drops EXIF, including location
    db = SessionLocal()
    try:
        prof = db.get(PetProfile, cat) or PetProfile(cat=cat)
        prof.photo_file, prof.photo_updated = name, utc_now()
        db.add(prof)
        db.commit()
    finally:
        db.close()
    return {"ok": True}


@app.get("/api/pets/{cat}/photo")
def get_photo(cat: str):
    db = SessionLocal()
    try:
        prof = db.get(PetProfile, cat)
        if not prof or not prof.photo_file:
            raise HTTPException(404, "No photo")
        path = os.path.join(PHOTO_DIR, prof.photo_file)
        if not os.path.exists(path):
            raise HTTPException(404, "No photo")
        return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})
    finally:
        db.close()


OBS_KINDS = {"normal_stool", "soft_stool", "diarrhea", "blood", "constipated", "vomit", "hairball", "note"}


class ObservationIn(BaseModel):
    cat: str
    kind: str
    visit_id: Optional[int] = None
    note: Optional[str] = None


@app.get("/api/observations")
def list_observations(days: int = 30):
    db = SessionLocal()
    try:
        rows = db.query(Observation).filter(Observation.created_at >= utc_now() - timedelta(days=days)) \
            .order_by(Observation.created_at.desc()).all()
        return [{"id": o.id, "cat": o.cat, "kind": o.kind, "visit_id": o.visit_id, "note": o.note,
                 "created_at": iso_utc(o.created_at)} for o in rows]
    finally:
        db.close()


@app.post("/api/observations")
def add_observation(body: ObservationIn):
    if body.cat not in CATS or body.kind not in OBS_KINDS:
        raise HTTPException(400, "Unknown cat or observation type")
    db = SessionLocal()
    try:
        o = Observation(cat=body.cat, kind=body.kind, visit_id=body.visit_id,
                        note=(body.note or "")[:500] or None, created_at=utc_now())
        db.add(o)
        db.commit()
        return {"ok": True, "id": o.id}
    finally:
        db.close()


@app.delete("/api/observations/{obs_id}")
def delete_observation(obs_id: int):
    db = SessionLocal()
    try:
        db.query(Observation).filter(Observation.id == obs_id).delete()
        db.commit()
        return {"ok": True}
    finally:
        db.close()


@app.get("/api/debug/activity-keys")
def activity_keys():
    """Field names (not values) of the newest stored Whisker activity."""
    db = SessionLocal()
    try:
        v = db.query(LitterVisit).filter(LitterVisit.raw_json.isnot(None)).order_by(LitterVisit.timestamp.desc()).first()
        def shape(x, depth=0):
            if isinstance(x, dict):
                return {k: shape(val, depth + 1) for k, val in list(x.items())[:25]} if depth < 4 else "dict"
            if isinstance(x, list):
                return [shape(x[0], depth + 1)] if x else []
            if isinstance(x, str):
                return "url" if x.startswith("http") else "str"
            return type(x).__name__
        latest = db.query(LitterVisit).filter(LitterVisit.raw_json.isnot(None)).order_by(LitterVisit.timestamp.desc()).limit(50).all()
        with_cam = next((json.loads(r.raw_json) for r in latest if json.loads(r.raw_json).get("cameraEvents")), None)
        raw = json.loads(v.raw_json) if v else {}
        return {"keys": sorted(raw.keys()), "has_event_id": bool(v and v.event_id),
                "cameraEvents_shape": shape(with_cam.get("cameraEvents")) if with_cam else None,
                "categories_shape": shape(raw.get("categories")), "subtype": raw.get("subtype"),
                "waste_weight_valid_false": sum(1 for r in latest if json.loads(r.raw_json).get("isWasteWeightValid") is False)}
    finally:
        db.close()


@app.post("/api/sync")
async def manual_sync():
    await sync_litter_robot(historical=False)
    db = SessionLocal()
    try:
        last = db.query(SyncLog).order_by(SyncLog.timestamp.desc()).first()
        return {"status": last.status, "message": last.message} if last else {"status": "unknown"}
    finally:
        db.close()


@app.post("/api/sync/historical")
async def historical_sync():
    asyncio.create_task(sync_litter_robot(historical=True))
    return {"status": "started", "message": "Historical sync started."}


@app.get("/api/sync/status")
def get_sync_status():
    db = SessionLocal()
    try:
        last = db.query(SyncLog).filter(SyncLog.status.in_(["success", "error"])).order_by(SyncLog.timestamp.desc()).first()
        pl = db.query(SyncLog).filter(SyncLog.status.like("petlibro%")).order_by(SyncLog.timestamp.desc()).first()
        total = db.query(LitterVisit).count()
        first = db.query(LitterVisit).order_by(LitterVisit.timestamp).first()
        base = {"total_visits_stored": total, "first_visit": iso_utc(first.timestamp) if first else None,
                "persistent": DATA_DIR not in (".", ""),
                "petlibro": {"configured": petlibro.configured(), "status": pl.status if pl else None,
                             "message": pl.message if pl else None, "at": iso_utc(pl.timestamp) if pl else None}}
        if last:
            return {**base, "last_sync": iso_utc(last.timestamp), "status": last.status, "message": last.message}
        return {**base, "last_sync": None, "status": "never", "message": "No sync yet"}
    finally:
        db.close()


# ── Scheduler ────────────────────────────────────────────────────────────────

scheduler = AsyncIOScheduler()


async def send_digest():
    db = SessionLocal()
    try:
        text = alerting.digest_text(build_summary(load_assessed(db, days=120)))
    finally:
        db.close()
    await alerting.send("Daily cat summary", text, "info")


@app.on_event("startup")
async def startup_event():
    scheduler.add_job(sync_litter_robot, "interval", minutes=int(os.getenv("SYNC_MINUTES", "30")), id="litter_sync")
    digest_hour = os.getenv("DIGEST_HOUR")
    if digest_hour:
        from timeutil import TZ
        scheduler.add_job(send_digest, "cron", hour=int(digest_hour), minute=0, timezone=TZ, id="digest")
    scheduler.start()
    if os.getenv("DISABLE_STARTUP_SYNC") != "1":
        asyncio.create_task(sync_litter_robot(historical=True))


@app.on_event("shutdown")
async def shutdown_event():
    scheduler.shutdown()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", 8000)))
