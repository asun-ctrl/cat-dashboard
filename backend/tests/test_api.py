from datetime import timedelta
from fastapi.testclient import TestClient
import main
from db import SessionLocal, LitterVisit, AlertLog
from timeutil import utc_now
from tests.factory import make_rows
import alerts, asyncio

def seed():
    db = SessionLocal()
    db.query(LitterVisit).delete()
    rows, i = make_rows(now=utc_now() + timedelta(hours=1), days=20)
    for r in rows:
        db.add(LitterVisit(cat_name=r.cat_name, timestamp=r.timestamp, waste_type=r.waste_type,
            duration_seconds=r.duration_seconds, weight_grams=r.weight_grams, waste_weight_grams=r.waste_weight_grams))
    db.add(LitterVisit(cat_name="Lychee", timestamp=utc_now() - timedelta(hours=2), waste_type="Urine",
        duration_seconds=50, weight_grams=899, waste_weight_grams=40))
    db.commit(); db.close()

def test_endpoints():
    seed()
    c = TestClient(main.app)
    s = c.get("/api/litter/summary").json()
    lw = s["Lychee"]["averages"]["latest_weight_lbs"]
    assert 11.2 < lw < 11.8, lw
    assert 8.8 < s["Guava"]["averages"]["latest_weight_lbs"] < 9.2
    assert "year_trend" in s["Lychee"]
    recent = c.get("/api/litter/recent?limit=5").json()
    assert recent[0]["timestamp"].endswith("Z")
    flagged = c.get("/api/litter/recent?flagged_only=true").json()
    mis = [v for v in flagged if "matches_other_cat" in v["flags"]]
    assert mis and mis[0]["likely_cat"] == "Guava"
    vid = mis[0]["id"]
    assert c.post(f"/api/visits/{vid}/override", json={"action": "assign", "assign_to": "Lychee"}).json()["ok"]
    after = {v["id"]: v for v in c.get("/api/litter/recent?limit=500").json()}
    assert after[vid]["counted_as"] == "Lychee"
    assert c.delete(f"/api/visits/{vid}/override").json()["ok"]
    q = c.get("/api/quality").json()
    assert q["mislabeled"] >= 1
    assert c.get("/api/export.csv").status_code == 200
    assert "channels" in c.get("/api/alerts").json()

def test_alert_dedupe():
    db = SessionLocal()
    db.query(AlertLog).delete(); db.commit()
    a = [alerts.Alert(key="drawer_full", severity="warning", title="t", message="m")]
    asyncio.run(alerts.process(db, a))
    asyncio.run(alerts.process(db, a))
    assert db.query(AlertLog).filter(AlertLog.key == "drawer_full").count() == 1
    db.close()
