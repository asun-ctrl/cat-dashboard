"""PetLibro feeders and fountain.

PetLibro has no public API. This follows the endpoints the app uses, as documented
by the community Home Assistant integration (github.com/jjjonesjr33/petlibro).
It logs in with a dedicated shared account (PETLIBRO_EMAIL / PETLIBRO_PASSWORD).
A PetLibro login can sign that same account out elsewhere, which is why it should
be an account used only by the dashboard.

Everything is device-scoped: per-pet history endpoints return little for shared
accounts, but each cat has their own RFID feeder, so device data is per cat anyway.
Raw responses are kept so new fields can be used later without re-fetching.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from hashlib import md5
from typing import Any, Optional

import httpx

from db import KeyValue, PetlibroDaily, PetlibroDevice, PetlibroEvent
from quality import CATS
from timeutil import TZ, local_date, utc_now

BASE = os.getenv("PETLIBRO_BASE", "https://api.us.petlibro.com")
APP_ID = 1
APP_SN = "c35772530d1041699c87fe62348507a8"


def configured() -> bool:
    return bool(os.getenv("PETLIBRO_EMAIL") and os.getenv("PETLIBRO_PASSWORD"))


class PetlibroError(Exception):
    pass


class Client:
    def __init__(self, db):
        self.db = db
        self.token = self._kv("petlibro_token")
        self.headers = {"source": "ANDROID", "language": "EN", "timezone": str(TZ), "version": "1.3.45",
                        "Content-Type": "application/json"}
        self.http = httpx.AsyncClient(base_url=BASE, timeout=25)

    def _kv(self, key, value=None):
        row = self.db.get(KeyValue, key)
        if value is None:
            return row.value if row else None
        row = row or KeyValue(key=key)
        row.value = value
        self.db.add(row)
        self.db.commit()

    async def close(self):
        await self.http.aclose()

    async def login(self):
        body = {"appId": APP_ID, "appSn": APP_SN, "country": "US", "email": os.getenv("PETLIBRO_EMAIL"),
                "password": md5(os.getenv("PETLIBRO_PASSWORD", "").encode()).hexdigest(),
                "phoneBrand": "", "phoneSystemVersion": "", "timezone": str(TZ), "thirdId": None, "type": None}
        r = await self.http.post("/member/auth/login", json=body, headers=self.headers)
        data = r.json()
        if data.get("code") == 1102:
            raise PetlibroError("PetLibro rejected the email or password.")
        token = (data.get("data") or {}).get("token")
        if not token:
            raise PetlibroError(f"Login failed (code {data.get('code')}: {data.get('msg')})")
        self.token = token
        self._kv("petlibro_token", token)

    async def post(self, path: str, body: Optional[dict] = None, retry: bool = True) -> Any:
        if not self.token:
            await self.login()
        r = await self.http.post(path, json=body or {}, headers={**self.headers, "token": self.token})
        if r.status_code >= 500:
            raise PetlibroError(f"{path}: server error {r.status_code}")
        data = r.json()
        if data.get("code") == 1009 and retry:   # token expired
            self.token = None
            return await self.post(path, body, retry=False)
        if data.get("code") not in (0, None):
            raise PetlibroError(f"{path}: code {data.get('code')} {data.get('msg')}")
        return data.get("data")


def _kind(product: str) -> str:
    p = (product or "").lower()
    if "fountain" in p or "dockstream" in p:
        return "fountain"
    if "feeder" in p:
        return "feeder"
    return "other"


def _match_cat(device: dict, bound: list) -> Optional[str]:
    override = os.getenv("PETLIBRO_DEVICE_CATS", "")
    for pair in override.split(","):
        if ":" in pair:
            sn, cat = pair.split(":", 1)
            if sn.strip() == device.get("deviceSn") and cat.strip() in CATS:
                return cat.strip()
    names = [str(p.get("name") or p.get("petName") or "") for p in (bound or []) if isinstance(p, dict)]
    hits = [c for c in CATS if any(c.lower() in n.lower() for n in names)]
    if len(hits) == 1:
        return hits[0]
    label = f"{device.get('name') or ''}"
    hits = [c for c in CATS if c.lower() in label.lower()]
    return hits[0] if len(hits) == 1 else None


def _save_daily(db, sn: str, kind: str, payload: Any):
    today = str(local_date(utc_now()))
    row = db.query(PetlibroDaily).filter(PetlibroDaily.device_sn == sn, PetlibroDaily.day == today,
                                         PetlibroDaily.kind == kind).first()
    row = row or PetlibroDaily(device_sn=sn, day=today, kind=kind)
    row.data = json.dumps(payload, default=str)
    row.updated_at = utc_now()
    db.add(row)


def _save_events(db, sn: str, work_record: Any) -> int:
    new = 0
    days = work_record if isinstance(work_record, list) else (work_record or {}).get("list", []) if isinstance(work_record, dict) else []
    for day in days:
        records = day.get("workRecords", []) if isinstance(day, dict) else []
        for rec in records:
            ms = rec.get("recordTime")
            if not ms:
                continue
            ts = datetime.fromtimestamp(ms / 1000, tz=timezone.utc).replace(tzinfo=None)
            typ = rec.get("type") or "UNKNOWN"
            if db.query(PetlibroEvent.id).filter(PetlibroEvent.device_sn == sn, PetlibroEvent.timestamp == ts,
                                                 PetlibroEvent.type == typ).first():
                continue
            db.add(PetlibroEvent(device_sn=sn, timestamp=ts, type=typ, data=json.dumps(rec, default=str)))
            new += 1
    return new


async def sync(db) -> str:
    if not configured():
        return "PetLibro login not set"
    client = Client(db)
    try:
        devices = await client.post("/device/device/list") or []
        now = utc_now()
        new_events = 0
        for d in devices:
            sn = d.get("deviceSn")
            if not sn:
                continue
            kind = _kind(d.get("productName"))
            dev = db.get(PetlibroDevice, sn) or PetlibroDevice(sn=sn)
            dev.name, dev.product, dev.kind = d.get("name"), d.get("productName"), kind
            dev.raw_list = json.dumps(d, default=str)

            async def grab(label, path, body=None):
                try:
                    data = await client.post(path, body or {"id": sn, "deviceSn": sn})
                    _save_daily(db, sn, label, data)
                    return data
                except Exception as e:      # one failing endpoint should not stop the rest
                    print(f"[PETLIBRO] {sn} {label}: {e}")
                    return None

            bound = await grab("bound_pets", "/device/devicePetRelation/getBoundPets", {"deviceSn": sn})
            real = await grab("real_info", "/device/device/realInfo")
            await grab("data_real_info", "/data/data/realInfo")
            if kind == "feeder":
                await grab("grain_status", "/device/data/grainStatus")
                await grab("feeding_plan", "/device/feedingPlan/list")
                await grab("feeding_plan_today", "/device/feedingPlan/todayNew")
            if kind == "fountain":
                await grab("drink_today", "/data/deviceDrinkWater/todayDrinkData")
            # The log returns at most 100 records per request, so fetch one day at a time:
            # 30 days back the first time, then the last 2 days on each sync.
            backfilled = client._kv(f"petlibro_backfilled:{sn}")
            days_back = 2 if backfilled else int(os.getenv("PETLIBRO_BACKFILL_DAYS", "30"))
            for i in range(days_back):
                day_end = now - timedelta(days=i)
                day_start = day_end - timedelta(days=1)
                body = {"deviceSn": sn, "size": 100,
                        "startTime": int(day_start.replace(tzinfo=timezone.utc).timestamp() * 1000),
                        "endTime": int(day_end.replace(tzinfo=timezone.utc).timestamp() * 1000)}
                try:
                    work = await client.post("/device/workRecord/list", body)
                except Exception as e:
                    print(f"[PETLIBRO] {sn} log day -{i}: {e}")
                    continue
                if i == 0:
                    _save_daily(db, sn, "work_record", work)
                new_events += _save_events(db, sn, work)
                db.commit()
            if not backfilled:
                client._kv(f"petlibro_backfilled:{sn}", utc_now().isoformat())

            dev.cat = _match_cat(d, bound if isinstance(bound, list) else [])
            dev.online = 1 if (real or {}).get("online", d.get("online", True)) else 0
            dev.updated_at = now
            db.add(dev)
            db.commit()
        return f"PetLibro: {len(devices)} devices, {new_events} new log entries"
    finally:
        await client.close()


# ── Read side ───────────────────────────────────────────────────────────────

import re

_DUR = re.compile(r"(?:(\d+)\s*m)?\s*(\d+)\s*s", re.I)


def _seconds_from(text: str) -> Optional[int]:
    """'ate for 01m20s' -> 80, 'ate for 11s' -> 11."""
    m = _DUR.search(text or "")
    if not m:
        return None
    return int(m.group(1) or 0) * 60 + int(m.group(2))


def daily_stats(db, days: int = 60) -> dict:
    """{cat: {local_date_str: {...}}} built from the per-event feeder and fountain log."""
    since = utc_now() - timedelta(days=days)
    devs = {d.sn: d for d in db.query(PetlibroDevice).all()}
    out: dict = {}
    for e in db.query(PetlibroEvent).filter(PetlibroEvent.timestamp >= since).all():
        d = json.loads(e.data or "{}")
        dev = devs.get(e.device_sn)
        cat = d.get("petName") if d.get("petName") in CATS else (dev.cat if dev else None)
        if not cat:
            continue
        day = out.setdefault(cat, {}).setdefault(str(local_date(e.timestamp)), {
            "eat_sessions": 0, "eat_seconds": 0, "drinks": 0, "drink_ml": 0, "drink_seconds": 0,
            "meals": 0, "portions": 0})
        if e.type == "DETECTION_EVENT":
            day["eat_sessions"] += 1
            day["eat_seconds"] += _seconds_from(d.get("content")) or 0
        elif e.type == "DRINK":
            day["drinks"] += 1
            day["drink_ml"] += d.get("totalMl") or 0
            day["drink_seconds"] += d.get("drinkTime") or 0
        elif e.type == "GRAIN_OUTPUT_SUCCESS":
            day["meals"] += 1
            day["portions"] += d.get("actualGrainNum") or 0
    return out


def last_seen(db) -> dict:
    """Most recent eating and drinking event per cat (UTC naive)."""
    devs = {d.sn: d for d in db.query(PetlibroDevice).all()}
    out: dict = {}
    for e in db.query(PetlibroEvent).filter(PetlibroEvent.type.in_(["DETECTION_EVENT", "DRINK"]),
                                            PetlibroEvent.timestamp >= utc_now() - timedelta(days=7)).all():
        d = json.loads(e.data or "{}")
        dev = devs.get(e.device_sn)
        cat = d.get("petName") if d.get("petName") in CATS else (dev.cat if dev else None)
        if not cat:
            continue
        key = "ate" if e.type == "DETECTION_EVENT" else "drank"
        if e.timestamp > out.setdefault(cat, {}).get(key, datetime.min):
            out[cat][key] = e.timestamp
    return out


def device_alerts(db) -> list[dict]:
    out = []
    for dev in db.query(PetlibroDevice).all():
        real = _latest(db, dev.sn, "real_info") or {}
        if dev.online == 0:
            out.append({"key": f"pl_offline:{dev.sn}", "title": f"{dev.cat + chr(39) + 's ' if dev.cat else ''}{'feeder' if dev.kind == 'feeder' else 'fountain'} is offline"})
        if dev.kind == "feeder" and real.get("surplusGrain") is False:
            out.append({"key": f"pl_food_low:{dev.sn}", "title": f"{dev.cat or 'A'}{chr(39) + 's' if dev.cat else ''} feeder is running low on food"})
        if dev.kind == "feeder" and real.get("grainOutletState") is False:
            out.append({"key": f"pl_outlet:{dev.sn}", "title": f"{dev.cat or 'A'}{chr(39) + 's' if dev.cat else ''} feeder outlet looks blocked"})
        if dev.kind == "fountain":
            pct = _num(real, "weightPercent")
            if pct is not None and pct < 20:
                out.append({"key": "pl_water_low", "title": f"Fountain water is low ({pct:.0f}%)"})
    return out

def _latest(db, sn, kind):
    row = db.query(PetlibroDaily).filter(PetlibroDaily.device_sn == sn, PetlibroDaily.kind == kind) \
        .order_by(PetlibroDaily.day.desc()).first()
    return json.loads(row.data) if row and row.data else None


def _num(d: Any, *keys) -> Optional[float]:
    if not isinstance(d, dict):
        return None
    for k in keys:
        v = d.get(k)
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return float(v)
    return None


def meal_times(db) -> dict:
    """Enabled feeding-plan times per cat, local 'HH:MM'."""
    out = {}
    for dev in db.query(PetlibroDevice).filter(PetlibroDevice.kind == "feeder").all():
        plans = _latest(db, dev.sn, "feeding_plan") or []
        times = sorted({p.get("executionTime") for p in plans if isinstance(p, dict)
                        and p.get("enable") and ":" in str(p.get("executionTime", ""))})
        if dev.cat and times:
            out[dev.cat] = times
    return out


def summary(db) -> dict:
    devices = db.query(PetlibroDevice).all()
    out = {"configured": configured(), "devices": [], "cats": {}}
    for dev in devices:
        real = _latest(db, dev.sn, "real_info") or {}
        item = {"sn": dev.sn[-4:], "name": dev.name, "product": dev.product, "kind": dev.kind, "cat": dev.cat,
                "online": bool(dev.online), "updated": dev.updated_at.isoformat() + "Z" if dev.updated_at else None}
        if dev.kind == "feeder":
            item["food_low"] = real.get("surplusGrain") is False
            item["outlet_blocked"] = real.get("grainOutletState") is False
        if dev.kind == "fountain":
            item["water_percent"] = _num(real, "weightPercent")
            item["water_grams"] = _num(real, "weight")
            drink = _latest(db, dev.sn, "drink_today")
            item["drink_today"] = drink
        out["devices"].append(item)

        if dev.kind == "feeder" and dev.cat:
            plans = _latest(db, dev.sn, "feeding_plan") or []
            meals = [{"time": p.get("executionTime"), "portions": p.get("grainNum"), "label": p.get("label")}
                     for p in plans if isinstance(p, dict) and p.get("enable")]
            meals.sort(key=lambda m: str(m["time"]))
            out["cats"].setdefault(dev.cat, {})["meals"] = meals

    stats = daily_stats(db, days=60)
    today = str(local_date(utc_now()))
    for cat in CATS:
        days = stats.get(cat, {})
        history = [{"day": d, "eating_sessions": v["eat_sessions"], "eating_seconds": v["eat_seconds"],
                    "drinks": v["drinks"], "drink_ml": v["drink_ml"], "meals": v["meals"], "portions": v["portions"]}
                   for d, v in sorted(days.items())]
        c = out["cats"].setdefault(cat, {"meals": []})
        c["history"] = history
        c["today"] = next((h for h in history if h["day"] == today), None)
    return out


def debug_shapes(db) -> dict:
    """Field names and types of the latest stored responses (no values)."""
    def shape(x, depth=0):
        if isinstance(x, dict):
            return {k: shape(v, depth + 1) for k, v in list(x.items())[:40]} if depth < 3 else "dict"
        if isinstance(x, list):
            return [shape(x[0], depth + 1)] if x else []
        return type(x).__name__
    out = {}
    for dev in db.query(PetlibroDevice).all():
        kinds = {}
        for kind in ("bound_pets", "real_info", "data_real_info", "grain_status", "feeding_plan",
                     "feeding_plan_today", "drink_today", "work_record"):
            v = _latest(db, dev.sn, kind)
            if v is not None:
                kinds[kind] = shape(v)
        events = db.query(PetlibroEvent).filter(PetlibroEvent.device_sn == dev.sn).order_by(PetlibroEvent.timestamp.desc()).all()
        samples = {}
        for e in events:
            if e.type not in samples:
                d = json.loads(e.data or "{}")
                samples[e.type] = {k: (v if k in ("type", "petName", "petId", "petIds", "content", "title", "dataType")
                                       or isinstance(v, (int, float, bool)) and k not in ("recordTime",) else type(v).__name__)
                                   for k, v in d.items()}
        out[f"{dev.product} ({dev.cat or 'unmatched'})"] = {"responses": kinds, "event_types": sorted(samples),
                                                              "event_samples": samples,
                                                              "event_counts": {t: sum(1 for e in events if e.type == t) for t in samples}}
    return out
