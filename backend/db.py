"""Database setup.

The SQLite file lives in DATA_DIR. On Railway, DATA_DIR should point at a
mounted volume (for example /data) so history survives redeploys.
"""
import os
from sqlalchemy import (
    create_engine, Column, Integer, String, Float, DateTime, Text,
    UniqueConstraint, inspect, text,
)
from sqlalchemy.orm import declarative_base, sessionmaker

DATA_DIR = os.getenv("DATA_DIR", ".")
os.makedirs(DATA_DIR, exist_ok=True)
DATABASE_URL = os.getenv("DATABASE_URL") or f"sqlite:///{os.path.join(DATA_DIR, 'cat_health.db')}"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False, "timeout": 30})

if DATABASE_URL.startswith("sqlite"):
    from sqlalchemy import event

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(conn, _):
        # WAL lets readers keep working while a sync writes; busy_timeout waits instead of failing.
        cur = conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA busy_timeout=30000")
        cur.close()
Base = declarative_base()
SessionLocal = sessionmaker(bind=engine)


class LitterVisit(Base):
    __tablename__ = "litter_visits"
    id = Column(Integer, primary_key=True, index=True)
    cat_name = Column(String, index=True)        # name reported by Whisker ("Unknown" if untagged)
    pet_id = Column(String, nullable=True)
    timestamp = Column(DateTime, index=True)     # UTC, naive
    waste_type = Column(String)
    duration_seconds = Column(Integer, nullable=True)
    weight_grams = Column(Float, nullable=True)  # legacy name: raw Whisker petWeight (hundredths of a lb)
    waste_weight_grams = Column(Float, nullable=True)  # raw Whisker wasteWeight
    event_id = Column(String, nullable=True)     # Whisker eventId, needed to send corrections back
    raw_json = Column(Text, nullable=True)       # full activity record, kept for future features

    __table_args__ = (UniqueConstraint("timestamp", "cat_name", name="uq_visit_ts_cat"),)


class VisitOverride(Base):
    """Manual decision on a visit: exclude it, or reassign it to a cat."""
    __tablename__ = "visit_overrides"
    id = Column(Integer, primary_key=True)
    visit_id = Column(Integer, unique=True, index=True)
    action = Column(String)            # "exclude" | "include" | "assign"
    assign_to = Column(String, nullable=True)
    note = Column(String, nullable=True)
    created_at = Column(DateTime)
    whisker_status = Column(String, nullable=True)     # sending | sent | failed | skipped
    whisker_prev_pet = Column(String, nullable=True)   # pet id the robot had before our correction
    whisker_prev_cat = Column(String, nullable=True)


class PetProfile(Base):
    """Per-cat profile: photo and details mirrored from Whisker."""
    __tablename__ = "pet_profiles"
    cat = Column(String, primary_key=True)
    pet_id = Column(String, nullable=True)
    photo_file = Column(String, nullable=True)        # uploaded photo filename under DATA_DIR/photos
    photo_updated = Column(DateTime, nullable=True)
    whisker_image_url = Column(Text, nullable=True)
    gender = Column(String, nullable=True)
    birthday = Column(String, nullable=True)
    age = Column(Integer, nullable=True)
    breeds = Column(String, nullable=True)
    diet = Column(String, nullable=True)
    is_fixed = Column(Integer, nullable=True)
    updated_at = Column(DateTime, nullable=True)


class WeightHistory(Base):
    """Weight readings from the Whisker pet profile (can predate stored visits)."""
    __tablename__ = "weight_history"
    id = Column(Integer, primary_key=True)
    cat = Column(String, index=True)
    timestamp = Column(DateTime, index=True)
    weight_lbs = Column(Float)
    __table_args__ = (UniqueConstraint("cat", "timestamp", name="uq_weight_cat_ts"),)


class Observation(Base):
    """Something you saw in the box, logged from the dashboard."""
    __tablename__ = "observations"
    id = Column(Integer, primary_key=True)
    cat = Column(String, index=True)
    kind = Column(String)          # normal_stool | soft_stool | diarrhea | blood | constipated | vomit | hairball | note
    visit_id = Column(Integer, nullable=True)
    note = Column(String, nullable=True)
    created_at = Column(DateTime, index=True)


class KeyValue(Base):
    __tablename__ = "kv"
    key = Column(String, primary_key=True)
    value = Column(Text)


class PetlibroDevice(Base):
    __tablename__ = "petlibro_devices"
    sn = Column(String, primary_key=True)
    name = Column(String, nullable=True)
    product = Column(String, nullable=True)
    kind = Column(String, nullable=True)       # feeder | fountain | other
    cat = Column(String, nullable=True)
    online = Column(Integer, nullable=True)
    raw_list = Column(Text, nullable=True)
    updated_at = Column(DateTime, nullable=True)


class PetlibroDaily(Base):
    """Latest response of each kind per device per local day (the last sync of a day is that day's total)."""
    __tablename__ = "petlibro_daily"
    id = Column(Integer, primary_key=True)
    device_sn = Column(String, index=True)
    day = Column(String, index=True)
    kind = Column(String)
    data = Column(Text)
    updated_at = Column(DateTime)
    __table_args__ = (UniqueConstraint("device_sn", "day", "kind", name="uq_pl_daily"),)


class PetlibroEvent(Base):
    __tablename__ = "petlibro_events"
    id = Column(Integer, primary_key=True)
    device_sn = Column(String, index=True)
    timestamp = Column(DateTime, index=True)
    type = Column(String)
    data = Column(Text)
    __table_args__ = (UniqueConstraint("device_sn", "timestamp", "type", name="uq_pl_event"),)


class Note(Base):
    """Something that happened, pinned to a day: diet change, medication, vet visit."""
    __tablename__ = "notes"
    id = Column(Integer, primary_key=True)
    cat = Column(String, nullable=True, index=True)   # None means both cats
    kind = Column(String)                              # diet | med | vet | other
    text = Column(String)
    day = Column(String, index=True)                   # local date YYYY-MM-DD
    created_at = Column(DateTime)


class RobotStatus(Base):
    __tablename__ = "robot_status"
    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime)
    waste_drawer_level = Column(Float, nullable=True)
    litter_level = Column(String, nullable=True)
    is_online = Column(Integer, default=1)


class SyncLog(Base):
    __tablename__ = "sync_log"
    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime)
    status = Column(String)
    message = Column(String)


class AlertLog(Base):
    __tablename__ = "alert_log"
    id = Column(Integer, primary_key=True)
    key = Column(String, index=True)       # dedupe key, e.g. "weight_drop:Guava"
    severity = Column(String)              # "info" | "warning" | "critical"
    cat_name = Column(String, nullable=True)
    title = Column(String)
    message = Column(Text)
    created_at = Column(DateTime, index=True)
    delivered = Column(String, nullable=True)  # comma list of channels that accepted it


def init_db():
    Base.metadata.create_all(bind=engine)
    # Lightweight migration for databases created by the old single-file version.
    insp = inspect(engine)
    cols = {c["name"] for c in insp.get_columns("litter_visits")}
    with engine.begin() as conn:
        for name, ddl in (("pet_id", "VARCHAR"), ("event_id", "VARCHAR"), ("raw_json", "TEXT")):
            if name not in cols:
                conn.execute(text(f"ALTER TABLE litter_visits ADD COLUMN {name} {ddl}"))
        ocols = {c["name"] for c in insp.get_columns("visit_overrides")}
        for name in ("whisker_status", "whisker_prev_pet", "whisker_prev_cat"):
            if name not in ocols:
                conn.execute(text(f"ALTER TABLE visit_overrides ADD COLUMN {name} VARCHAR"))
