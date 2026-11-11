import asyncio
from datetime import timedelta
from fastapi.testclient import TestClient
import main
from db import SessionLocal, LitterVisit, PetProfile, VisitOverride, Note
from timeutil import utc_now, local_date
from tests.factory import make_rows


def seed():
    db = SessionLocal()
    db.query(LitterVisit).delete(); db.query(VisitOverride).delete(); db.query(Note).delete()
    rows, _ = make_rows(now=utc_now() + timedelta(hours=1), days=30)
    for r in rows:
        db.add(LitterVisit(cat_name=r.cat_name, timestamp=r.timestamp, waste_type=r.waste_type,
                           duration_seconds=r.duration_seconds, weight_grams=r.weight_grams, waste_weight_grams=r.waste_weight_grams))
    db.add(LitterVisit(cat_name="Unknown", pet_id=None, timestamp=utc_now() - timedelta(hours=3), waste_type="Urine",
                       duration_seconds=50, weight_grams=1148, waste_weight_grams=40, event_id="EV1", raw_json='{"serial": "S1"}'))
    for c, pid in (("Lychee", "PET-L"), ("Guava", "PET-G")):
        p = db.get(PetProfile, c) or PetProfile(cat=c)
        p.pet_id = pid; db.add(p)
    db.commit(); db.close()


def test_notes_story_report_feed():
    seed()
    c = TestClient(main.app)
    day = str(local_date(utc_now()) - timedelta(days=2))
    n = c.post("/api/notes", json={"cat": "Guava", "kind": "diet", "text": "Switched to rabbit kibble", "day": day}).json()
    assert n["id"] and c.get("/api/notes").json()[0]["text"].startswith("Switched")
    assert c.post("/api/notes", json={"kind": "nope", "text": "x"}).status_code == 400
    s = c.get("/api/story").json()
    g = [x for x in s["cats"] if x["cat"] == "Guava"][0]
    assert len(s["days"]) == 7 and g["headline"] and len(g["stats"]["pee"]["daily"]) == 7
    assert any(p["topic"] == "Notes" and "rabbit" in p["text"] for p in g["paragraphs"])
    assert any(p["topic"] == "Weight" for p in g["paragraphs"])
    assert c.get("/api/story?offset=1").json()["offset"] == 1
    r = c.get("/api/report?cat=Guava").json()
    assert r["summary"][0]["key"] == "weight" and r["summary"][0]["value"] and r["weeks"] and r["notes"][0]["kind"] == "Diet"
    assert c.get("/api/report?cat=Nobody").status_code == 404
    f = c.get("/api/feed").json()
    assert f and f[0]["ts"].endswith("Z") and any(i["kind"] == "litter" for i in f)
    assert c.delete(f"/api/notes/{n['id']}").json()["ok"]


class FakeRobot:
    serial = "S1"
    calls = []
    async def reassign_pet_visit(self, event_id, *, from_pet_id=None, to_pet_id=None):
        FakeRobot.calls.append((event_id, from_pet_id, to_pet_id))
        return {"eventId": event_id}

class FakeAccount:
    async def disconnect(self): pass


def test_whisker_writeback(monkeypatch):
    seed()
    async def fake(serial=None):
        return FakeAccount(), FakeRobot()
    monkeypatch.setattr(main, "_whisker_robot", fake)
    db = SessionLocal()
    vid = db.query(LitterVisit).filter(LitterVisit.event_id == "EV1").first().id
    db.add(VisitOverride(visit_id=vid, action="assign", assign_to="Lychee", whisker_status="sending")); db.commit(); db.close()
    FakeRobot.calls.clear()
    asyncio.run(main.whisker_reassign(vid, "Lychee"))
    assert FakeRobot.calls == [("EV1", None, "PET-L")]
    db = SessionLocal()
    v = db.get(LitterVisit, vid); o = db.query(VisitOverride).filter(VisitOverride.visit_id == vid).first()
    assert v.cat_name == "Lychee" and v.pet_id == "PET-L" and o.whisker_status == "sent" and o.whisker_prev_cat == "Unknown"
    db.close()
    asyncio.run(main.whisker_reassign(vid, None, undo=True, prev_pet=None, prev_cat="Unknown"))
    assert FakeRobot.calls[-1] == ("EV1", "PET-L", None)
    db = SessionLocal(); assert db.get(LitterVisit, vid).cat_name == "Unknown"; db.close()
