import random
from datetime import datetime, timedelta
from types import SimpleNamespace

def make_rows(now=None, days=40, seed=1):
    """Synthetic visits shaped like the real data (raw weights in hundredths of a lb)."""
    rnd = random.Random(seed)
    now = now or datetime(2026, 11, 10, 6, 0)
    rows, i = [], 0
    for d in range(days, 0, -1):
        for cat, base, n in (("Lychee", 1150, 4), ("Guava", 900, 5)):
            for k in range(n):
                i += 1
                ts = now - timedelta(days=d, hours=k * 4 + rnd.random())
                wt = "Feces" if k == 0 else "Urine"
                rows.append(SimpleNamespace(id=i, cat_name=cat, pet_id=None, timestamp=ts, waste_type=wt,
                    duration_seconds=rnd.randint(40, 120), weight_grams=base + rnd.randint(-12, 12),
                    waste_weight_grams=rnd.choice([0.0, rnd.randint(20, 120)])))
    return rows, i
