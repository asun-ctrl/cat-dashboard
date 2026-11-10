"""Time helpers. Timestamps are stored as naive UTC; days and hours are bucketed in local time."""
import os
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

TZ = ZoneInfo(os.getenv("TIMEZONE", "America/Los_Angeles"))


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def local_now(utc_naive: datetime = None) -> datetime:
    return to_local(utc_naive or utc_now())


def to_local(utc_naive: datetime) -> datetime:
    return utc_naive.replace(tzinfo=timezone.utc).astimezone(TZ)


def local_date(utc_naive: datetime) -> date:
    return to_local(utc_naive).date()


def local_midnight_utc(d: date) -> datetime:
    """UTC (naive) instant of local midnight starting day `d`."""
    return datetime.combine(d, time.min, tzinfo=TZ).astimezone(timezone.utc).replace(tzinfo=None)


def fmt_local(utc_naive: datetime) -> str:
    return to_local(utc_naive).strftime("%b %d %-I:%M %p")


def iso_utc(utc_naive: datetime) -> str:
    """ISO string with an explicit Z so browsers convert it to local time."""
    return utc_naive.replace(microsecond=0).isoformat() + "Z" if utc_naive else None


def days_back(today: date, n: int):
    return [today - timedelta(days=i) for i in range(n)]
