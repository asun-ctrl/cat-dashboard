from datetime import datetime, timedelta
from types import SimpleNamespace
import alerts
from quality import assess
from tests.factory import make_rows

NOW = datetime(2026, 11, 10, 6, 0)

def keys(found):
    return {a.key.split(":")[0] for a in found}

def test_quiet_on_normal_data():
    rows, _ = make_rows(now=NOW + timedelta(days=1))
    found = alerts.evaluate(assess(rows), {"waste_drawer_level": 40}, NOW, now=NOW)
    assert keys(found) == set(), [a.title for a in found]

def test_weight_drop():
    rows, _ = make_rows(now=NOW + timedelta(days=1))
    for r in rows:
        if r.cat_name == "Guava" and r.timestamp >= NOW - timedelta(days=7):
            r.weight_grams -= 60   # about 6.7% loss
    found = alerts.evaluate(assess(rows), None, NOW, now=NOW)
    drop = [a for a in found if a.key == "weight_drop:Guava"]
    assert drop and drop[0].severity == "warning"

def test_no_visits_and_stale_sync_and_drawer():
    rows, _ = make_rows(now=NOW + timedelta(days=1))
    rows = [r for r in rows if not (r.cat_name == "Lychee" and r.timestamp >= NOW - timedelta(hours=30))]
    found = alerts.evaluate(assess(rows), {"waste_drawer_level": 90}, NOW - timedelta(hours=3), now=NOW)
    k = {a.key for a in found}
    assert "no_visits:Lychee" in k and "sync_stale" in k and "drawer_full" in k
    assert "no_visits:Guava" not in k

def test_quiet_hours(monkeypatch):
    monkeypatch.setenv("QUIET_HOURS", "22-7")
    # 06:00 UTC is 22:00 PST, inside quiet hours
    assert alerts.in_quiet_hours(datetime(2026, 11, 10, 6, 0))
    assert not alerts.in_quiet_hours(datetime(2026, 11, 10, 20, 0))
