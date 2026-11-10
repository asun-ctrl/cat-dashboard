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

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
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
    if "pet_id" not in cols:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE litter_visits ADD COLUMN pet_id VARCHAR"))
