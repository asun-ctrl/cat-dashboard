from fastapi.testclient import TestClient
import main

def test_passcode(monkeypatch):
    c = TestClient(main.app)
    main._failures.clear()
    assert c.get("/api/pets").status_code == 200          # no passcode set: open
    monkeypatch.setenv("DASHBOARD_PASSCODE", "lychee123")
    assert c.get("/api/pets").status_code == 401
    assert c.get("/api/health").status_code == 200
    assert c.get("/api/pets", headers={"X-Passcode": "lychee123"}).status_code == 200
    assert c.get("/api/pets?k=lychee123").status_code == 200
    assert c.post("/api/auth/check", headers={"X-Passcode": "nope"}).status_code == 401
    assert c.post("/api/auth/check", headers={"X-Passcode": "lychee123"}).json()["ok"]
    for _ in range(11):
        c.get("/api/pets", headers={"X-Passcode": "wrong"})
    assert c.get("/api/pets", headers={"X-Passcode": "lychee123"}).status_code == 429   # locked out for 10 min
    main._failures.clear()
