# Cat Health Monitor

Litter-Robot 5 Pro dashboard for Lychee and Guava. FastAPI backend, React frontend, both on Railway.

## How the data works

- The backend syncs with Whisker every 30 minutes and stores every pet visit in SQLite.
- Raw visits are never deleted. A quality pass (`backend/quality.py`) decides how each visit is used:
  - **Weight outliers** that fall outside a cat's rolling baseline (median and MAD over +/- 10 days) are left out of weight stats.
  - **Mislabeled visits**, tagged as one cat but weighing like the other, are not counted for the tagged cat and are shown as "likely" the other cat.
  - **Untagged visits** that match exactly one cat's weight are shown as likely that cat, but are never merged into confirmed counts.
  - **Waste weight outliers** and zero readings are left out of waste stats.
  - You can override any visit from the dashboard (IS LYCHEE / IS GUAVA, KEEP, DROP, UNDO).
- Whisker reports pet weight in hundredths of a pound (1142 = 11.42 lbs).
- Days and hours are bucketed in Pacific time (`TIMEZONE`).

## Railway settings (backend service)

| Variable | Purpose |
|---|---|
| `WHISKER_EMAIL`, `WHISKER_PASSWORD` | Whisker login |
| `DATA_DIR` | Set to the volume mount path (`/data`) so history persists |
| `RAILPACK_PYTHON_VERSION` | `3.12` |
| `NTFY_TOPIC` | Push alerts through the ntfy app. Subscribe to the same topic on your phone |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `ALERT_SMS_TO` | Optional SMS alerts |
| `QUIET_HOURS` | For example `22-7`. Only critical alerts go out in this window |
| `DIGEST_HOUR` | For example `20` for a daily summary at 8 PM |
| `DASHBOARD_URL` | Tapping a push notification opens this URL |

Alert thresholds can be tuned with `WEIGHT_DROP_WARN_PCT` (4), `WEIGHT_DROP_CRIT_PCT` (7), `NO_VISIT_HOURS` (24), `URINE_DAILY_MAX` (7), `FECES_DAILY_MAX` (4), `DRAWER_ALERT_PCT` (85), and `LONG_VISIT_SECONDS` (240).

## Alerts

| Alert | Trigger |
|---|---|
| Weight down | Last 7 days median is 4% or more below the prior 30 days (critical at 7%) |
| No visits | No confirmed visits from a cat in 24 hours |
| High urine or feces count | 7+ urine or 4+ feces visits in a day |
| Visit spike | Last 24 hours well above that cat's 14-day normal |
| Repeated long visits | 2+ unusually long visits in 12 hours |
| Untagged visits | 4+ untagged visits in 24 hours (pet ID may need recalibrating) |
| Drawer full | Waste drawer at 85% or more |
| Not receiving data | No successful sync in 2 hours |

Each alert has a cooldown, so one problem sends one notification.

## Local development

```
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
pytest -q

cd frontend
npm install
npm start
```

The frontend reads `REACT_APP_API_URL` (your backend URL plus `/api`).
