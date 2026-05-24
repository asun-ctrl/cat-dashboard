import asyncio
import os
from datetime import datetime, timedelta
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime
from sqlalchemy.orm import declarative_base, sessionmaker
import uvicorn

load_dotenv()

DATABASE_URL = "sqlite:///./cat_health.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
Base = declarative_base()
SessionLocal = sessionmaker(bind=engine)

class LitterVisit(Base):
    __tablename__ = "litter_visits"
    id = Column(Integer, primary_key=True, index=True)
    cat_name = Column(String)
    timestamp = Column(DateTime)
    waste_type = Column(String)
    duration_seconds = Column(Integer, nullable=True)
    weight_grams = Column(Float, nullable=True)
    waste_weight_grams = Column(Float, nullable=True)

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

Base.metadata.create_all(bind=engine)

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PET_ID_MAP = {
    "PET-4bb19424-5bff-430a-a82d-58121d25838f": "Guava"
}
LYCHEE_ID_SUFFIX = "2219d03e"

async def build_pet_map(account):
    try:
        if hasattr(account, 'pets') and account.pets:
            for pet in account.pets:
                pet_id = getattr(pet, 'id', None) or getattr(pet, 'petId', None)
                pet_name = getattr(pet, 'name', None)
                if pet_id and pet_name:
                    PET_ID_MAP[pet_id] = pet_name
    except Exception as e:
        print(f"[PET MAP] {e}")

def get_cat_name(activity_dict):
    pet_ids = activity_dict.get('petIds', [])
    if pet_ids:
        pet_id = pet_ids[0]
        if pet_id in PET_ID_MAP:
            return PET_ID_MAP[pet_id]
        if pet_id.endswith(LYCHEE_ID_SUFFIX):
            PET_ID_MAP[pet_id] = "Lychee"
            return "Lychee"
        return f"Cat-{pet_id[-8:]}"
    return "Unknown"

async def sync_litter_robot(historical=False):
    db = SessionLocal()
    try:
        from pylitterbot import Account, LitterRobot5
        email = os.getenv("WHISKER_EMAIL")
        password = os.getenv("WHISKER_PASSWORD")
        if not email or not password:
            raise Exception("Whisker credentials not found in .env file")

        account = Account(robot_types=[LitterRobot5])
        await account.connect(username=email, password=password, load_robots=True)
        await build_pet_map(account)

        limit = 1000 if historical else 200
        new_count = 0
        total_activities = 0
        pet_visits_found = 0

        for robot in account.robots:
            # Save robot status
            try:
                waste_level = None
                litter_level = None
                if hasattr(robot, 'waste_drawer_level'):
                    waste_level = robot.waste_drawer_level
                elif hasattr(robot, 'wasteDrwrLvl'):
                    waste_level = robot.wasteDrwrLvl
                if hasattr(robot, 'litter_level'):
                    litter_level = str(robot.litter_level)

                status = RobotStatus(
                    timestamp=datetime.now(),
                    waste_drawer_level=waste_level,
                    litter_level=litter_level,
                    is_online=1
                )
                db.add(status)
                db.commit()
            except Exception as e:
                print(f"[STATUS] Could not save robot status: {e}")

            activities = await robot.get_activities(limit=limit)
            total_activities = len(activities)

            for activity in activities:
                if isinstance(activity, dict):
                    ad = activity
                elif hasattr(activity, '__dict__'):
                    ad = vars(activity)
                else:
                    ad = {}

                if ad.get('type', '') != 'PET_VISIT':
                    continue

                pet_visits_found += 1
                cat_name = get_cat_name(ad)

                waste_type = ad.get('wasteType', 'Unknown')
                if waste_type is None:
                    waste_type = 'Unknown'

                timestamp_str = ad.get('timestamp', None)
                timestamp = datetime.now()
                if timestamp_str:
                    try:
                        timestamp = datetime.fromisoformat(
                            timestamp_str.replace('Z', '+00:00')
                        ).replace(tzinfo=None)
                    except:
                        pass

                duration = ad.get('duration', None)
                weight = ad.get('petWeight', None)
                waste_weight = ad.get('wasteWeight', None)

                existing = db.query(LitterVisit).filter(
                    LitterVisit.cat_name == cat_name,
                    LitterVisit.timestamp == timestamp
                ).first()

                if not existing:
                    visit = LitterVisit(
                        cat_name=cat_name,
                        timestamp=timestamp,
                        waste_type=waste_type,
                        duration_seconds=duration,
                        weight_grams=weight,
                        waste_weight_grams=waste_weight
                    )
                    db.add(visit)
                    new_count += 1

        db.commit()
        await account.disconnect()

        msg = f"Sync successful - {new_count} new visits added ({pet_visits_found} pet visits in {total_activities} activities)"
        log = SyncLog(timestamp=datetime.now(), status="success", message=msg)
        db.add(log)
        db.commit()
        print(f"[{datetime.now()}] {msg}")

    except Exception as e:
        import traceback
        error_msg = str(e)
        print(f"[{datetime.now()}] Sync error: {error_msg}")
        print(traceback.format_exc())
        log = SyncLog(timestamp=datetime.now(), status="error", message=error_msg)
        db.add(log)
        db.commit()
    finally:
        db.close()

@app.get("/api/health")
def health_check():
    return {"status": "ok", "timestamp": datetime.now().isoformat()}

@app.get("/api/robot/status")
def get_robot_status():
    db = SessionLocal()
    try:
        latest = db.query(RobotStatus).order_by(RobotStatus.timestamp.desc()).first()
        if latest:
            return {
                "waste_drawer_level": latest.waste_drawer_level,
                "litter_level": latest.litter_level,
                "is_online": latest.is_online,
                "last_checked": latest.timestamp.isoformat()
            }
        return {"waste_drawer_level": None, "litter_level": None, "is_online": None}
    finally:
        db.close()

@app.get("/api/litter/summary")
def get_litter_summary():
    db = SessionLocal()
    try:
        today = datetime.now().date()
        week_ago = datetime.now() - timedelta(days=7)
        month_ago = datetime.now() - timedelta(days=30)
        ninety_ago = datetime.now() - timedelta(days=90)

        today_unknown = db.query(LitterVisit).filter(
            LitterVisit.cat_name == "Unknown",
            LitterVisit.timestamp >= datetime.combine(today, datetime.min.time())
        ).all()
        unknown_urine = sum(1 for v in today_unknown if v.waste_type == "Urine")
        unknown_feces = sum(1 for v in today_unknown if v.waste_type == "Feces")
        unknown_total = len(today_unknown)

        results = {}
        for cat in ["Lychee", "Guava"]:
            today_v = db.query(LitterVisit).filter(
                LitterVisit.cat_name == cat,
                LitterVisit.timestamp >= datetime.combine(today, datetime.min.time())
            ).all()

            week_v = db.query(LitterVisit).filter(
                LitterVisit.cat_name == cat,
                LitterVisit.timestamp >= week_ago
            ).all()

            month_v = db.query(LitterVisit).filter(
                LitterVisit.cat_name == cat,
                LitterVisit.timestamp >= month_ago
            ).all()

            all_v = db.query(LitterVisit).filter(
                LitterVisit.cat_name == cat,
                LitterVisit.timestamp >= ninety_ago
            ).order_by(LitterVisit.timestamp).all()

            today_urine = sum(1 for v in today_v if v.waste_type == "Urine")
            today_feces = sum(1 for v in today_v if v.waste_type == "Feces")
            today_total = len(today_v)

            urine_status = "green"
            if today_urine > 6: urine_status = "red"
            elif today_urine > 4: urine_status = "yellow"

            feces_status = "green"
            if today_feces == 0 and datetime.now().hour > 14: feces_status = "yellow"
            elif today_feces > 3: feces_status = "red"

            # Weight trend (30 days, daily avg)
            weight_trend = {}
            for i in range(30):
                day = (datetime.now() - timedelta(days=i)).date()
                day_v = [v for v in month_v if v.timestamp.date() == day and v.weight_grams]
                if day_v:
                    weight_trend[str(day)] = round(sum(v.weight_grams for v in day_v) / len(day_v), 1)

            # Duration trend (30 days, avg seconds)
            duration_trend = {}
            for i in range(30):
                day = (datetime.now() - timedelta(days=i)).date()
                day_v = [v for v in month_v if v.timestamp.date() == day and v.duration_seconds]
                if day_v:
                    duration_trend[str(day)] = round(sum(v.duration_seconds for v in day_v) / len(day_v), 1)

            # Waste weight trend (30 days)
            waste_trend = {}
            for i in range(30):
                day = (datetime.now() - timedelta(days=i)).date()
                day_v = [v for v in month_v if v.timestamp.date() == day and v.waste_weight_grams is not None]
                if day_v:
                    waste_trend[str(day)] = round(sum(v.waste_weight_grams for v in day_v), 1)

            # Visit trend
            week_trend = {}
            for i in range(7):
                day = (datetime.now() - timedelta(days=i)).date()
                day_v2 = [v for v in week_v if v.timestamp.date() == day]
                day_unk = db.query(LitterVisit).filter(
                    LitterVisit.cat_name == "Unknown",
                    LitterVisit.timestamp >= datetime.combine(day, datetime.min.time()),
                    LitterVisit.timestamp < datetime.combine(day + timedelta(days=1), datetime.min.time())
                ).all()
                week_trend[str(day)] = {
                    "urine": sum(1 for v in day_v2 if v.waste_type == "Urine"),
                    "feces": sum(1 for v in day_v2 if v.waste_type == "Feces"),
                    "total": len(day_v2),
                    "unknown": len(day_unk)
                }

            month_trend = {}
            for i in range(30):
                day = (datetime.now() - timedelta(days=i)).date()
                day_v2 = [v for v in month_v if v.timestamp.date() == day]
                month_trend[str(day)] = {
                    "urine": sum(1 for v in day_v2 if v.waste_type == "Urine"),
                    "feces": sum(1 for v in day_v2 if v.waste_type == "Feces"),
                    "total": len(day_v2)
                }

            quarter_trend = {}
            for i in range(13):
                ws = datetime.now().date() - timedelta(weeks=i+1)
                we = datetime.now().date() - timedelta(weeks=i)
                wv = [v for v in all_v if ws <= v.timestamp.date() <= we]
                quarter_trend[str(ws)] = {
                    "urine": sum(1 for v in wv if v.waste_type == "Urine"),
                    "feces": sum(1 for v in wv if v.waste_type == "Feces"),
                    "total": len(wv)
                }

            hour_pattern = {str(h): {"urine": 0, "feces": 0} for h in range(24)}
            for v in all_v:
                h = str(v.timestamp.hour)
                if v.waste_type == "Urine": hour_pattern[h]["urine"] += 1
                elif v.waste_type == "Feces": hour_pattern[h]["feces"] += 1

            total_days = len(set(v.timestamp.date() for v in all_v))
            avg_urine = round(sum(1 for v in all_v if v.waste_type == "Urine") / max(total_days, 1), 1)
            avg_feces = round(sum(1 for v in all_v if v.waste_type == "Feces") / max(total_days, 1), 1)

            # Latest weight
            latest_weight = None
            weight_visits = [v for v in all_v if v.weight_grams]
            if weight_visits:
                latest_weight = weight_visits[-1].weight_grams

            results[cat] = {
                "today": {
                    "urine": today_urine,
                    "feces": today_feces,
                    "total": today_total,
                    "urine_status": urine_status,
                    "feces_status": feces_status,
                    "unknown_urine": unknown_urine,
                    "unknown_feces": unknown_feces,
                    "unknown_total": unknown_total
                },
                "averages": {
                    "daily_urine": avg_urine,
                    "daily_feces": avg_feces,
                    "days_tracked": total_days,
                    "latest_weight_grams": latest_weight
                },
                "week_trend": week_trend,
                "month_trend": month_trend,
                "quarter_trend": quarter_trend,
                "hour_pattern": hour_pattern,
                "weight_trend": weight_trend,
                "duration_trend": duration_trend,
                "waste_trend": waste_trend
            }

        return results
    finally:
        db.close()

@app.get("/api/litter/recent")
def get_recent_visits():
    db = SessionLocal()
    try:
        visits = db.query(LitterVisit).order_by(LitterVisit.timestamp.desc()).limit(50).all()
        return [{
            "id": v.id,
            "cat_name": v.cat_name,
            "timestamp": v.timestamp.isoformat(),
            "waste_type": v.waste_type,
            "duration_seconds": v.duration_seconds,
            "weight_grams": v.weight_grams,
            "waste_weight_grams": v.waste_weight_grams
        } for v in visits]
    finally:
        db.close()

@app.post("/api/sync")
async def manual_sync():
    await sync_litter_robot(historical=False)
    db = SessionLocal()
    try:
        last = db.query(SyncLog).order_by(SyncLog.timestamp.desc()).first()
        return {"status": last.status, "message": last.message} if last else {"status": "unknown"}
    finally:
        db.close()

@app.post("/api/sync/historical")
async def historical_sync():
    asyncio.create_task(sync_litter_robot(historical=True))
    return {"status": "started", "message": "Historical sync started."}

@app.get("/api/sync/status")
def get_sync_status():
    db = SessionLocal()
    try:
        last = db.query(SyncLog).order_by(SyncLog.timestamp.desc()).first()
        total = db.query(LitterVisit).count()
        if last:
            return {
                "last_sync": last.timestamp.isoformat(),
                "status": last.status,
                "message": last.message,
                "total_visits_stored": total
            }
        return {"last_sync": None, "status": "never", "message": "No sync yet", "total_visits_stored": 0}
    finally:
        db.close()

scheduler = AsyncIOScheduler()

@app.on_event("startup")
async def startup_event():
    scheduler.add_job(sync_litter_robot, 'interval', minutes=30, id='litter_sync')
    scheduler.start()
    asyncio.create_task(sync_litter_robot(historical=True))

@app.on_event("shutdown")
async def shutdown_event():
    scheduler.shutdown()

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
