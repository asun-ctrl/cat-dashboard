import io
from datetime import datetime, timedelta
from types import SimpleNamespace
from fastapi.testclient import TestClient
from PIL import Image
import main
from insights import build_insights, possible_loose_stool
from quality import assess
from tests.factory import make_rows
from timeutil import utc_now

NOW = datetime(2026, 11, 10, 20, 0)

def run(rows, **kw):
    return {c["cat"]: c for c in build_insights(assess(rows), kw.get("profiles", {}), {}, kw.get("obs", []), now=NOW)["cats"]}

def test_healthy_cats_read_well():
    rows, _ = make_rows(now=NOW, days=40)
    out = run(rows)
    for cat in ("Lychee", "Guava"):
        assert out[cat]["status"] == "good", [(f["id"], f["level"], f["title"]) for f in out[cat]["findings"]]
        assert out[cat]["headline"].endswith("doing well")
        assert 2 <= out[cat]["vitals"]["urine"]["value"] <= 5
        assert "lbs" in out[cat]["summary"] and "a day" in out[cat]["summary"]

def test_weight_loss_is_a_concern_with_plain_language():
    rows, _ = make_rows(now=NOW, days=40)
    for r in rows:
        if r.cat_name == "Lychee" and r.timestamp >= NOW - timedelta(days=7):
            r.weight_grams -= 75   # about 6.5%
    f = {x["id"]: x for x in run(rows)["Lychee"]["findings"]}["weight"]
    assert f["level"] == "concern" and "lost" in f["title"] and "vet" in f["action"].lower()

def test_more_pee_than_her_normal_is_flagged():
    rows, i = make_rows(now=NOW, days=40)
    for d in range(1, 8):
        for k in range(4):
            i += 1
            rows.append(SimpleNamespace(id=i, cat_name="Lychee", pet_id=None,
                timestamp=NOW - timedelta(days=d, hours=k * 3 + 1, minutes=20), waste_type="Urine",
                duration_seconds=60, weight_grams=1150, waste_weight_grams=40.0))
    f = {x["id"]: x for x in run(rows)["Lychee"]["findings"]}["urine"]
    assert f["level"] in ("watch", "concern") and "more often" in f["title"]

def test_male_pronouns():
    rows, _ = make_rows(now=NOW, days=40)
    c = run(rows, profiles={"Lychee": {"gender": "MALE"}})["Lychee"]
    assert "He pees" in c["summary"]
    assert all(" she " not in (f["action"] + f["detail"]) for f in c["findings"])

def test_loose_stool_hint():
    rows, i = make_rows(now=NOW, days=10)
    # 9:20 and 9:40 PST on Nov 8 = 17:20 / 17:40 UTC, right after the 9:00 meal
    for m in (20, 40):
        i += 1
        rows.append(SimpleNamespace(id=i, cat_name="Guava", pet_id=None, timestamp=datetime(2026, 11, 8, 17, m),
            waste_type="Urine", duration_seconds=90, weight_grams=900, waste_weight_grams=60.0))
    assert {i - 1, i} <= possible_loose_stool(assess(rows), "Guava")

def test_photo_and_observations_api():
    c = TestClient(main.app)
    img = Image.new("RGB", (1600, 1200), (200, 120, 140))
    buf = io.BytesIO(); img.save(buf, "JPEG"); buf.seek(0)
    r = c.post("/api/pets/Guava/photo", files={"file": ("g.jpg", buf, "image/jpeg")})
    assert r.status_code == 200, r.text
    pets = c.get("/api/pets").json()
    assert pets["Guava"]["photo"].startswith("/api/pets/Guava/photo")
    got = c.get("/api/pets/Guava/photo")
    assert got.status_code == 200
    small = Image.open(io.BytesIO(got.content)); assert max(small.size) <= 900 and not small.getexif()
    assert c.post("/api/pets/Guava/photo", files={"file": ("x.txt", io.BytesIO(b"hello"), "text/plain")}).status_code == 400
    oid = c.post("/api/observations", json={"cat": "Guava", "kind": "soft_stool"}).json()["id"]
    assert any(o["id"] == oid for o in c.get("/api/observations").json())
    assert c.delete(f"/api/observations/{oid}").json()["ok"]
    ins = c.get("/api/insights").json()
    assert ins["emergency"] and ins["sources"] and len(ins["cats"]) == 2
