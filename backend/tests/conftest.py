import os, sys, tempfile
os.environ.setdefault("DATA_DIR", tempfile.mkdtemp())
os.environ["DISABLE_STARTUP_SYNC"] = "1"
for k in ("NTFY_TOPIC", "TWILIO_ACCOUNT_SID", "QUIET_HOURS"):
    os.environ.pop(k, None)
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
