import datetime as dt
import time

from . import aircraft, nnumber
from .airports import AirportDB
from .analyze import analyze
from .sources import flatten, get_source

_DB = {}


def airport_db(cache_dir):
    if cache_dir not in _DB:
        _DB[cache_dir] = AirportDB(cache_dir)
    return _DB[cache_dir]


def run(query, days=365, cache_dir=".cache", source="adsbx", local_dir=None, since=None, log=print):
    hex_ = nnumber.resolve(query)
    end = dt.datetime.now(dt.timezone.utc).date()
    start = dt.date.fromisoformat(since) if since else end - dt.timedelta(days=days)
    log(f"{query}: ICAO {hex_}, {start} to {end}, source {source}")
    src = get_source(source, cache_dir, local_dir)
    traces = src.fetch(hex_, start, end)
    log(f"  {len(traces)} days with data")
    pts, meta = flatten(traces)
    db = airport_db(cache_dir)
    landings, gas, gaps, fixes = analyze(pts, db, cache_dir, log=log) if pts else ([], [], [], [])
    owners = []
    for L in landings:
        if L["owner"] and L["owner"] not in owners:
            owners.append(L["owner"])
    ac = aircraft.info(meta.get("t"))
    return {
        "meta": {
            "query": query.upper(),
            "hex": hex_,
            "tail": meta.get("r") or query.upper(),
            "type": meta.get("t"),
            "desc": meta.get("desc"),
            "year": meta.get("year"),
            "owner": meta.get("ownOp"),
            "owners": owners,
            "from": str(start),
            "to": str(end),
            "days_with_data": len(traces),
            "generated": int(time.time()),
            "source": source,
            "vref": ac,
            "runway_fixes": fixes,
        },
        "landings": landings,
        "go_arounds": gas,
        "unscored": gaps,
    }
