"""On-demand server: anyone types a tail number, the server pulls and scores it.

    pip install -r requirements.txt
    uvicorn server.app:app --port 8000

Serves the same front end as the static site, plus GET /api/debrief/{tail}.
Results are cached for CACHE_HOURS; traces and weather are cached on disk.
"""

import json
import os
import threading
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from debrief import nnumber
from debrief.pipeline import run

ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = os.environ.get("DEBRIEF_CACHE", str(ROOT / ".cache"))
RESULTS = Path(CACHE_DIR) / "results"
DAYS = int(os.environ.get("DEBRIEF_DAYS", "180"))
CACHE_HOURS = float(os.environ.get("DEBRIEF_CACHE_HOURS", "6"))
SOURCE = os.environ.get("DEBRIEF_SOURCE", "adsbx")

app = FastAPI(title="Approach debrief")
_locks: dict[str, threading.Lock] = {}
_guard = threading.Lock()


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
    return {"ok": True}


# Static front end (and any precomputed data/ files) last, so /api wins.
app.mount("/", StaticFiles(directory=ROOT / "site", html=True), name="site")
