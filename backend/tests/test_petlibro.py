import asyncio, json, os
from datetime import datetime, timezone
import httpx
import petlibro
from db import SessionLocal, PetlibroDevice, PetlibroEvent

NOW_MS = int(datetime.now(timezone.utc).timestamp() * 1000)

def fake_api(calls):
    now_ms = NOW_MS
    def handler(request: httpx.Request):
        path = request.url.path
        body = json.loads(request.content or b"{}")
        calls.append((path, request.headers.get("token")))
        ok = lambda data: httpx.Response(200, json={"code": 0, "data": data})
        if path == "/member/auth/login":
            assert len(body["password"]) == 32  # md5, never plain text
            return ok({"token": "T1"})
        if path == "/device/device/list":
            return ok([
                {"deviceSn": "AF1", "productName": "One RFID Smart Feeder", "name": "Feeder L"},
                {"deviceSn": "AF2", "productName": "One RFID Smart Feeder", "name": "Guava's bowl"},
                {"deviceSn": "WF1", "productName": "Dockstream Smart RFID Fountain", "name": "Fountain"},
            ])
        if path == "/device/devicePetRelation/getBoundPets":
            return ok([{"name": "Lychee"}] if body["deviceSn"] == "AF1" else [])
        if path == "/device/feedingPlan/list":
            return ok([{"id": 1, "executionTime": "08:30", "grainNum": 2, "enable": True},
                       {"id": 2, "executionTime": "20:30", "grainNum": 2, "enable": True},
                       {"id": 3, "executionTime": "13:00", "grainNum": 1, "enable": False}])
        if path == "/device/data/grainStatus":
            return ok({"todayFeedingQuantity": 4, "todayFeedingTimes": 2, "todayEatingTimes": 5, "petEatingTime": 410})
        if path == "/device/device/realInfo":
            return ok({"online": True, "surplusGrain": True, "weightPercent": 62, "weight": 980})
        if path == "/device/workRecord/list":
            if not (body["startTime"] <= now_ms - 3600_000 < body["endTime"]):
                return ok([])
            recs = {"AF1": [{"type": "GRAIN_OUTPUT_SUCCESS", "recordTime": now_ms - 3600_000, "actualGrainNum": 2},
                            {"type": "DETECTION_EVENT", "recordTime": now_ms - 3500_000, "petName": "Lychee",
                             "content": "Lychee came to eat and ate for 01m20s."},
                            {"type": "DETECTION_EVENT", "recordTime": now_ms - 3400_000, "petName": "Lychee",
                             "content": "Lychee came to eat and ate for 11s."}],
                    "WF1": [{"type": "DRINK", "recordTime": now_ms - 3300_000, "petName": "Guava", "totalMl": 12, "drinkTime": 34},
                            {"type": "DRINK", "recordTime": now_ms - 3200_000, "petName": "Lychee", "totalMl": 20, "drinkTime": 40}]}
            return ok([{"workRecords": recs.get(body["deviceSn"], [])}])
        return ok({})
    return handler

def test_sync_and_summary(monkeypatch):
    monkeypatch.setenv("PETLIBRO_EMAIL", "x@example.com")
    monkeypatch.setenv("PETLIBRO_PASSWORD", "secret")
    calls = []
    real_client = httpx.AsyncClient
    monkeypatch.setattr(petlibro.httpx, "AsyncClient", lambda **kw: real_client(transport=httpx.MockTransport(fake_api(calls)), **kw))
    db = SessionLocal()
    msg = asyncio.run(petlibro.sync(db))
    assert "3 devices" in msg
    cats = {d.sn: d.cat for d in db.query(PetlibroDevice).all()}
    assert cats["AF1"] == "Lychee" and cats["AF2"] == "Guava" and cats["WF1"] is None
    assert db.query(PetlibroEvent).count() == 5
    assert petlibro.meal_times(db) == {"Lychee": ["08:30", "20:30"], "Guava": ["08:30", "20:30"]}
    s = petlibro.summary(db)
    stats = petlibro.daily_stats(db)
    lday = list(stats["Lychee"].values())[0]
    assert lday["eat_sessions"] == 2 and lday["eat_seconds"] == 91 and lday["drink_ml"] == 20 and lday["portions"] == 2
    assert list(stats["Guava"].values())[0]["drink_ml"] == 12
    assert s["cats"]["Lychee"]["today"]["eating_seconds"] == 91
    assert "Lychee" in petlibro.last_seen(db)
    assert [m["time"] for m in s["cats"]["Lychee"]["meals"]] == ["08:30", "20:30"]
    fountain = [d for d in s["devices"] if d["kind"] == "fountain"][0]
    assert fountain["water_percent"] == 62
    assert all(tok == "T1" for p, tok in calls if p != "/member/auth/login")
    shapes = petlibro.debug_shapes(db)
    assert any("GRAIN_OUTPUT_SUCCESS" in v["event_types"] for v in shapes.values())
    # second sync reuses the stored token and doesn't duplicate events
    n = db.query(PetlibroEvent).count(); calls.clear()
    asyncio.run(petlibro.sync(db))
    assert not any(p == "/member/auth/login" for p, _ in calls)
    assert db.query(PetlibroEvent).count() == n
