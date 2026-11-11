from fastapi.testclient import TestClient
import main

def test_passcode(monkeypatch):
    c = TestClient(main.app)
    main._failures.clear()
    assert c.get("/api/pets").status_code == 200          # no passcode set: open
    monkeypatch.setenv("DASHBOARD_PASSCODE", "lychee123")
    # Opening the page with no saved code fires many requests: none count as wrong tries
    for _ in range(20):
        assert c.get("/api/pets").status_code == 401
    assert c.get("/api/health").status_code == 200
    assert c.get("/api/pets", headers={"X-Passcode": "lychee123"}).status_code == 200
    assert c.get("/api/pets?k=lychee123").status_code == 200
    # The same stale code sent by many parallel requests counts once
    for _ in range(8):
        c.get("/api/pets", headers={"X-Passcode": "old-code"})
    r = c.post("/api/auth/check", headers={"X-Passcode": "typo1"})
    assert r.status_code == 401 and "1 try left" in r.json()["detail"]
    assert c.post("/api/auth/check", headers={"X-Passcode": "typo2"}).status_code == 429   # 3rd distinct wrong code
    assert c.get("/api/pets", headers={"X-Passcode": "lychee123"}).status_code == 429
    main._failures.clear()
    r = c.post("/api/auth/check", headers={"X-Passcode": "typo"})
    assert "2 tries left" in r.json()["detail"]
    assert c.post("/api/auth/check", headers={"X-Passcode": "lychee123"}).json()["ok"]    # success clears the count
    assert c.post("/api/auth/check", headers={"X-Passcode": "typo"}).json()["detail"].endswith("2 tries left.")
    main._failures.clear()
