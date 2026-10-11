"""ADS-B trace sources.

A source returns a list of daily trace dicts in readsb "trace_full" format:
{"icao", "r", "t", "desc", "ownOp", "timestamp", "trace": [[dt, lat, lon, alt, gs, trk, flags, rate, details, type, geom, geom_rate, ...], ...]}

adsbx      ADS-B Exchange globe history. Fine for tracking your own aircraft;
           a public or commercial service needs an ADS-B Exchange data license.
adsblol    adsb.lol open data (ODbL). Published as whole-day archives, so it
           needs a bulk ingest job rather than per-tail requests. Not built yet.
local      A folder of trace_full_<hex>.json files you already have, one per day
           named YYYY-MM-DD.json (or .json.gz).
"""

import datetime as dt
import gzip
import json
import os
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

UA = "approach-debrief/0.1 (+https://github.com/jhitchco/approach-debrief)"


def _load_json_bytes(raw):
    try:
        return json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return json.loads(gzip.decompress(raw))


class AdsbxHistory:
    name = "adsbx"
    base = "https://globe.adsbexchange.com/globe_history"

    def __init__(self, cache_dir, workers=6):
        self.cache_dir = cache_dir
        self.workers = workers

    def _day(self, hex_, day, today):
        path = os.path.join(self.cache_dir, "traces", hex_, f"{day:%Y-%m-%d}.json")
        miss = path + ".none"
        recent = (today - day).days <= 2  # history files fill in for a day or two
        if os.path.exists(path):
            with open(path, "rb") as f:
                return _load_json_bytes(f.read())
        if os.path.exists(miss) and not recent:
            return None
        url = f"{self.base}/{day:%Y/%m/%d}/traces/{hex_[-2:]}/trace_full_{hex_}.json"
        req = urllib.request.Request(url, headers={
            "User-Agent": UA,
            "Referer": f"https://globe.adsbexchange.com/?icao={hex_}",
        })
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    raw = r.read()
                data = _load_json_bytes(raw)
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, "w") as f:
                    json.dump(data, f, separators=(",", ":"))
                return data
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    os.makedirs(os.path.dirname(path), exist_ok=True)
                    open(miss, "w").close()
                    return None
                if e.code in (429, 503):
                    time.sleep(2 * (attempt + 1))
                    continue
                raise
            except urllib.error.URLError:
                time.sleep(2 * (attempt + 1))
        return None

    def fetch(self, hex_, start, end):
        today = dt.datetime.now(dt.timezone.utc).date()
        days = [start + dt.timedelta(d) for d in range((end - start).days + 1)]
        with ThreadPoolExecutor(self.workers) as ex:
            out = list(ex.map(lambda d: self._day(hex_, d, today), days))
        return [d for d in out if d]


class LocalFolder:
    name = "local"

    def __init__(self, folder):
        self.folder = folder

    def fetch(self, hex_, start, end):
        out = []
        for fn in sorted(os.listdir(self.folder)):
            stem = fn.split(".")[0]
            try:
                day = dt.date.fromisoformat(stem)
            except ValueError:
                continue
            if start <= day <= end:
                with open(os.path.join(self.folder, fn), "rb") as f:
                    d = _load_json_bytes(f.read())
                if d.get("icao", hex_).lower() == hex_:
                    out.append(d)
        return out


class AdsbLolOpenData:
    name = "adsblol"

    def __init__(self, *a, **k):
        pass

    def fetch(self, hex_, start, end):
        raise NotImplementedError(
            "adsb.lol publishes whole-day archives (several GB each). Use it through a nightly "
            "ingest job that extracts the tails you track, then point the 'local' source at the output."
        )


def get_source(name, cache_dir, local_dir=None):
    if name == "adsbx":
        return AdsbxHistory(cache_dir)
    if name == "local":
        return LocalFolder(local_dir)
    if name == "adsblol":
        return AdsbLolOpenData()
    raise ValueError(f"unknown source {name}")


def flatten(days):
    """Merge daily traces into one time-sorted list of point dicts."""
    pts = []
    meta = {}
    for d in days:
        base = d["timestamp"]
        for k in ("r", "t", "desc", "ownOp", "year"):
            if d.get(k):
                meta[k] = d[k]
        owner = d.get("ownOp")
        for p in d["trace"]:
            alt = p[3]
            pts.append({
                "t": base + p[0],
                "lat": p[1],
                "lon": p[2],
                "gnd": alt == "ground",
                "baro": None if alt == "ground" else alt,
                "gs": p[4] if p[4] is not None else 0.0,
                "trk": p[5] if p[5] is not None else 0.0,
                "vr": p[7],
                "geom": p[10] if len(p) > 10 else None,
                "gvr": p[11] if len(p) > 11 else None,
                "owner": owner,
            })
    pts.sort(key=lambda x: x["t"])
    return pts, meta
