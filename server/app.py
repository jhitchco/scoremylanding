"""Approach debrief server.

    uvicorn server.app:app --port 8000          (or: docker compose up -d)

- GET /                     the web page
- GET /api/debrief/{tail}   score any tail on demand (cached DEBRIEF_CACHE_HOURS)
- GET /data/...             precomputed results for the tracked tails and the fleet benchmark
- GET /api/health           status, including the last refresh

A background thread rescores the tails in DEBRIEF_TAILS (or tails.txt) every
DEBRIEF_REFRESH_HOURS, and rebuilds the fleet benchmark every DEBRIEF_FLEET_DAYS.
"""

import json
import logging
import os
import threading
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from debrief import nnumber
from debrief import fleet as fleet_mod
from debrief.__main__ import main as score_tails
from debrief.pipeline import run

ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = os.environ.get("DEBRIEF_CACHE", str(ROOT / ".cache"))
OUT_DIR = Path(os.environ.get("DEBRIEF_OUT", str(ROOT / "site" / "data")))
RESULTS = Path(CACHE_DIR) / "results"
DAYS = int(os.environ.get("DEBRIEF_DAYS", "365"))
CACHE_HOURS = float(os.environ.get("DEBRIEF_CACHE_HOURS", "6"))
SOURCE = os.environ.get("DEBRIEF_SOURCE", "adsbx")
REFRESH_HOURS = float(os.environ.get("DEBRIEF_REFRESH_HOURS", "24"))
FLEET_TYPES = [t for t in os.environ.get("DEBRIEF_FLEET", "SF50").replace(",", " ").split() if t]
FLEET_SAMPLE = int(os.environ.get("DEBRIEF_FLEET_SAMPLE", "40"))
FLEET_DAYS = float(os.environ.get("DEBRIEF_FLEET_DAYS", "7"))

log = logging.getLogger("debrief")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
app = FastAPI(title="Approach debrief")
_locks: dict[str, threading.Lock] = {}
_guard = threading.Lock()
_status = {"last_refresh": None, "last_fleet": None, "refreshing": False}


def tracked_tails():
    env = os.environ.get("DEBRIEF_TAILS")
    if env:
        return [t for t in env.replace(",", " ").split() if t]
    path = Path(os.environ.get("DEBRIEF_TAILS_FILE", str(ROOT / "tails.txt")))
    if not path.exists():
        return []
    return [l.split("#")[0].strip() for l in path.read_text().splitlines() if l.split("#")[0].strip()]


def _lock(key):
    with _guard:
        return _locks.setdefault(key, threading.Lock())


@app.get("/api/debrief/{tail}")
def debrief(tail: str, refresh: bool = False):
    try:
        hex_ = nnumber.resolve(tail)
    except ValueError:
        raise HTTPException(400, f"{tail} is not a US N-number or ICAO hex code")
    RESULTS.mkdir(parents=True, exist_ok=True)
    path = RESULTS / f"{hex_}.json"
    with _lock(hex_):  # one computation per aircraft at a time
        if not refresh and path.exists() and time.time() - path.stat().st_mtime < CACHE_HOURS * 3600:
            return JSONResponse(json.loads(path.read_text()))
        res = run(tail, days=DAYS, cache_dir=CACHE_DIR, source=SOURCE, log=lambda *a: None)
        path.write_text(json.dumps(res, separators=(",", ":")))
        return JSONResponse(res)


@app.get("/api/health")
def health():
    return {"ok": True, "tracked": tracked_tails(), **_status}


def _refresh_loop():
    time.sleep(5)
    while True:
        tails = tracked_tails()
        _status["refreshing"] = True
        try:
            if tails:
                log.info("refreshing %s", ", ".join(tails))
                score_tails(tails + ["--days", str(DAYS), "--out", str(OUT_DIR), "--cache", CACHE_DIR, "--source", SOURCE])
                _status["last_refresh"] = int(time.time())
            for t in FLEET_TYPES:
                f = OUT_DIR / "fleet" / f"{t.upper()}.json"
                if not f.exists() or time.time() - f.stat().st_mtime > FLEET_DAYS * 86400:
                    log.info("building %s fleet benchmark", t)
                    fleet_mod.main([t, "--sample", str(FLEET_SAMPLE), "--days", "45", "--cache", CACHE_DIR,
                                    "--out", str(OUT_DIR / "fleet"), "--exclude", *tails])
                    _status["last_fleet"] = int(time.time())
        except Exception:
            log.exception("refresh failed")
        finally:
            _status["refreshing"] = False
        time.sleep(REFRESH_HOURS * 3600)


@app.on_event("startup")
def _start():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if REFRESH_HOURS > 0:
        threading.Thread(target=_refresh_loop, daemon=True, name="refresh").start()


# Precomputed results first, then the page itself, so /api and /data win over the static site.
OUT_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/data", StaticFiles(directory=OUT_DIR), name="data")
app.mount("/", StaticFiles(directory=ROOT / "site", html=True), name="site")
