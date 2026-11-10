from datetime import datetime, timedelta
from types import SimpleNamespace
from quality import assess, to_lbs
from tests.factory import make_rows

NOW = datetime(2026, 11, 10, 6, 0)

def add(rows, i, **kw):
    base = dict(id=i, cat_name="Lychee", pet_id=None, timestamp=NOW - timedelta(days=2),
                waste_type="Urine", duration_seconds=60, weight_grams=1150, waste_weight_grams=50.0)
    base.update(kw)
    rows.append(SimpleNamespace(**base))

def by_id(vs):
    return {v.id: v for v in vs}

def test_units_hundredths_of_lb():
    assert to_lbs(1142) == 11.42
    assert to_lbs(0) is None and to_lbs(None) is None

def test_clean_data_mostly_untouched():
    rows, _ = make_rows()
    vs = assess(rows)
    tagged = [v for v in vs if v.reported_cat in ("Lychee", "Guava")]
    assert all(v.cat == v.reported_cat for v in tagged)
    assert sum(v.use_weight for v in tagged) / len(tagged) > 0.98

def test_mislabeled_partial_inferred_and_waste_outlier():
    rows, i = make_rows()
    add(rows, i + 1, cat_name="Lychee", weight_grams=902)                 # really Guava
    add(rows, i + 2, cat_name="Unknown", weight_grams=387)                # partial step-in
    add(rows, i + 3, cat_name="Unknown", weight_grams=1146)               # untagged Lychee
    add(rows, i + 4, cat_name="Guava", weight_grams=890, waste_weight_grams=950.0)  # waste spike
    add(rows, i + 5, cat_name="Guava", weight_grams=330)                  # partial on Guava
    add(rows, i + 6, cat_name="Lychee", duration_seconds=1)               # brief visit
    v = by_id(assess(rows))

    m = v[i + 1]
    assert m.cat is None and m.likely_cat == "Guava" and "matches_other_cat" in m.flags

    p = v[i + 2]
    assert p.cat is None and p.likely_cat is None and not p.use_weight

    u = v[i + 3]
    assert u.cat is None and u.likely_cat == "Lychee" and "inferred_by_weight" in u.flags

    w = v[i + 4]
    assert w.cat == "Guava" and "waste_outlier" in w.flags and not w.use_waste and w.use_weight

    g = v[i + 5]
    assert g.cat == "Guava" and "weight_partial" in g.flags and not g.use_weight

    b = v[i + 6]
    assert "brief_visit" in b.flags and not b.use_duration and b.cat == "Lychee"

def test_bad_readings_do_not_shift_baseline():
    rows, i = make_rows()
    for k in range(6):  # a cluster of bad Lychee readings on one day
        add(rows, i + 1 + k, weight_grams=600, timestamp=NOW - timedelta(days=3, minutes=k))
    vs = assess(rows)
    bad = [v for v in vs if v.id > i]
    assert all(not v.use_weight for v in bad)

def test_overrides():
    rows, i = make_rows()
    add(rows, i + 1, cat_name="Lychee", weight_grams=902)
    O = lambda **kw: SimpleNamespace(**kw)
    v = by_id(assess(rows, {i + 1: O(action="assign", assign_to="Lychee")}))
    assert v[i + 1].cat == "Lychee"
    v = by_id(assess(rows, {1: O(action="exclude", assign_to=None)}))
    assert v[1].counted is False and v[1].cat is None
