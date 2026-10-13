"""Fleet collector: score every landing by every aircraft of a type, day by day.

    SML_SECRET=... python -m debrief.collect --type SF50 --data data --max-days 8

Each run processes the newest unprocessed days first (yesterday, then backfill toward
--since), up to --max-days. State lives in <data>/ (the repo's `data` branch):

  state/<pid>.bin      encrypted, gzip'd full record per aircraft (canonical)
  state/index.bin      encrypted {pid: tail}
  meta/days.json       days processed, with counts
  meta/geoid.json      HAE minus field elevation per airport, learned from full-coverage landings
  public/              derived each run: anonymized per-aircraft files + index (see publish())
"""

import argparse
import copy
import datetime as dt
import glob
import json
import os
import shutil
import statistics
import time
from collections import defaultdict

from . import aircraft, anon
from .adsblol import ingest_day
from .analyze import analyze
from .fleet import fleet_registry
from .pipeline import airport_db
from .sources import flatten

FT_PER_NM = 6076.1


# --------------------------------------------------------------------------- state io

def _read_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def _write_json(path, obj, indent=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, separators=(",", ":") if indent is None else None, indent=indent)
    os.replace(tmp, path)


_seal = anon.seal
_open = anon.unseal


def load_state(key, data_dir, pid):
    path = os.path.join(data_dir, "state", f"{pid}.bin")
    if not os.path.exists(path):
        return None
    with open(path) as f:
        return _open(key, f.read())


def save_state(key, data_dir, pid, rec):
    path = os.path.join(data_dir, "state", f"{pid}.bin")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(_seal(key, rec))


# --------------------------------------------------------------------------- collection

def _days_to_do(done, since, max_days):
    today = dt.datetime.now(dt.timezone.utc).date()
    d = today - dt.timedelta(days=1)
    out = []
    while d >= since and len(out) < max_days:
        if str(d) not in done:
            out.append(d)
        d -= dt.timedelta(days=1)
    return out


def _owner_index(rec, owner):
    owners = rec.setdefault("owners", [])
    if owner not in owners:
        owners.append(owner)
    return owners.index(owner)


def collect_day(key, day, reg, type_code, data_dir, cache_dir, geoid, log=print):
    raw_dir = os.path.join(cache_dir, "lol")
    tag, found = ingest_day(day, list(reg), raw_dir, log=log)
    if not tag:
        return None
    db = airport_db(cache_dir)
    t0 = dt.datetime.combine(day, dt.time(), dt.timezone.utc).timestamp()
    window = (t0, t0 + 86400)
    stats = {"tag": tag, "aircraft": found, "landings": 0, "lowcov": 0, "at": int(time.time())}
    for path in sorted(glob.glob(os.path.join(raw_dir, "*", f"{day}.json"))):
        hex_ = os.path.basename(os.path.dirname(path))
        if hex_ not in reg:
            continue
        days = []
        prev = os.path.join(raw_dir, hex_, f"{day - dt.timedelta(days=1)}.json")
        if os.path.exists(prev):  # approaches that started before 00:00Z
            days.append(_read_json(prev, None))
        days.append(_read_json(path, None))
        pts, meta = flatten([d for d in days if d])
        pts = [p for p in pts if p["t"] >= t0 - 3600]
        if not pts:
            continue
        landings, gas, gaps, _ = analyze(pts, db, cache_dir, log=lambda *a: None, geoid_table=geoid, window=window)
        if not (landings or gas or gaps):
            continue
        pid = anon.pseudonym(key, hex_, type_code)
        rec = load_state(key, data_dir, pid) or {"pid": pid, "hex": hex_, "type": type_code, "landings": {}, "go_arounds": {}, "unscored": {}}
        rec["tail"] = reg[hex_]
        rec["db_flags"] = days[-1].get("dbFlags", 0)
        rec["desc"] = meta.get("desc")
        rec["year"] = meta.get("year")
        for L in landings:
            L["og"] = _owner_index(rec, L.pop("owner", None) or meta.get("ownOp"))
            lid = anon.landing_id(key, hex_, L["t"])
            L["id"] = lid
            rec["landings"][lid] = L
            stats["landings"] += 1
            stats["lowcov"] += bool(L["lowcov"])
            if L.get("hae_off") is not None:
                geoid.setdefault("_obs", {}).setdefault(L["apt"], []).append(L["hae_off"])
        for g in gas:
            rec["go_arounds"][anon.landing_id(key, hex_, g["t"])] = g
        for g in gaps:
            rec["unscored"][anon.landing_id(key, hex_, g["t"])] = g
        save_state(key, data_dir, pid, rec)
    # keep only the last two days of raw traces in the cache
    keep = {str(day), str(day - dt.timedelta(days=1)), str(day + dt.timedelta(days=1))}
    for f in glob.glob(os.path.join(raw_dir, "*", "*.json")) + glob.glob(os.path.join(raw_dir, "_done", "*")):
        if os.path.basename(f)[:10] not in keep:
            os.remove(f)
    return stats


def _refresh_geoid(geoid):
    obs = geoid.pop("_obs", {})
    hist = geoid.setdefault("_hist", {})
    for apt, vals in obs.items():
        hist[apt] = (hist.get(apt, []) + vals)[-25:]
    for apt, vals in hist.items():
        if len(vals) >= 2:
            geoid[apt] = statistics.median(vals)
    all_vals = [geoid[a] for a in hist if a in geoid]
    geoid["_default"] = statistics.median(all_vals) if all_vals else -100
    return geoid


# --------------------------------------------------------------------------- publishing

def _light(sun):
    if sun is None:
        return None
    return "night" if sun < -6 else "dusk" if sun < 0 else "day"


def _runway_fixes(records, min_n=5):
    """Fleet-wide lateral correction for runway thresholds that the database has a few hundred feet off."""
    by = defaultdict(list)
    for rec in records:
        for L in rec["landings"].values():
            if L.get("thr") and L["thr"].get("c") is not None:
                by[(L["apt"], L["rwy"])].append(L["thr"]["c"])
    fixes = {}
    for k, v in by.items():
        if len(v) >= min_n:
            m = statistics.median(v)
            spread = statistics.median([abs(x - m) for x in v])
            if abs(m) > 100 and spread < 60:
                fixes[k] = m
    return fixes


def _apply_fix(L, B):
    L = copy.deepcopy(L)
    L["dbfix"] = round(B)
    for gate in list(L["gates"].values()) + [L.get("thr")]:
        if gate and gate.get("c") is not None:
            gate["c"] = round(gate["c"] - B)
    for p in L["prof"]:
        p[3] = round(p[3] - B)
    return L


DROP_ALWAYS = ("t", "metar", "owner", "apt_name", "sun", "hae_off", "id")
DROP_RESTRICTED = ("apt", "rwy", "fe", "airline", "apt_type", "dbfix")
PROFILE_DAYS = 400  # older landings keep their scores but drop the drawn profile, to bound site size


def public_landing(L, restricted):
    d = {k: v for k, v in L.items() if k not in DROP_ALWAYS}
    d["id"] = L["id"]
    d["d"] = dt.datetime.fromtimestamp(L["t"], dt.timezone.utc).strftime("%Y-%m-%d")
    d["light"] = _light(L.get("sun"))
    if L["t"] < time.time() - PROFILE_DAYS * 86400:
        d["prof"] = []
    if restricted:
        for k in DROP_RESTRICTED:
            d[k] = None
        d["rlen"] = round((L.get("rlen") or 0) / 500) * 500
    return d


def _public_event(e, restricted):
    out = {"d": dt.datetime.fromtimestamp(e["t"], dt.timezone.utc).strftime("%Y-%m-%d"), "why": e.get("why")}
    if not restricted:
        out.update({"apt": e.get("apt"), "name": e.get("name"), "rwy": e.get("rwy")})
    return out


def publish(key, data_dir, type_code, days_meta):
    """Regenerate data/public from the encrypted state."""
    pub = os.path.join(data_dir, "public")
    if os.path.isdir(pub):
        shutil.rmtree(pub)
    records = []
    for path in sorted(glob.glob(os.path.join(data_dir, "state", f"{type_code.lower()}-*.bin"))):
        with open(path) as f:
            records.append(_open(key, f.read()))
    fixes = _runway_fixes(records)
    index, names = [], {}
    ac = aircraft.info(type_code)
    for rec in records:
        restricted = anon.restricted(rec.get("db_flags"))
        Ls = sorted(rec["landings"].values(), key=lambda L: L["t"])
        out = []
        for L in Ls:
            B = fixes.get((L["apt"], L["rwy"]))
            out.append(public_landing(_apply_fix(L, B) if B else L, restricted))
        cur = len(rec.get("owners", [])) - 1
        doc = {
            "pid": rec["pid"], "type": rec["type"], "desc": rec.get("desc"),
            "restricted": restricted, "current_owner": cur,
            "landings": out,
            "go_arounds": [_public_event(e, restricted) for e in sorted(rec["go_arounds"].values(), key=lambda e: e["t"])],
            "unscored": [_public_event(e, restricted) for e in sorted(rec["unscored"].values(), key=lambda e: e["t"])],
        }
        _write_json(os.path.join(pub, "ac", f"{rec['pid']}.json"), doc)
        # the owner-only file the site decrypts: tail plus everything withheld above
        detail = {
            "tail": rec.get("tail"), "hex": rec.get("hex"), "year": rec.get("year"), "owners": rec.get("owners"),
            "landings": {L["id"]: {k: L.get(k) for k in ("t", "apt", "rwy", "apt_name", "metar", "fe", "airline")} for L in Ls},
            "go_arounds": [{k: e.get(k) for k in ("t", "apt", "rwy")} for e in rec["go_arounds"].values()],
            "unscored": [{k: e.get(k) for k in ("t", "apt", "name", "why")} for e in rec["unscored"].values()],
        }
        with open(os.path.join(pub, "ac", f"{rec['pid']}.bin"), "w") as f:
            f.write(_seal(key, detail))
        names[rec["pid"]] = rec.get("tail")
        last = out[-1]["d"] if out else None
        index.append({"pid": rec["pid"], "n": len(out), "last": last, "restricted": restricted})
    with open(os.path.join(pub, "names.bin"), "w") as f:
        f.write(_seal(key, names))
    done = sorted(days_meta)
    meta = {
        "type": type_code, "desc": ac.get("desc"), "vref": ac,
        "generated": int(time.time()),
        "days": len(done), "first_day": done[0] if done else None, "last_day": done[-1] if done else None,
        "aircraft_seen": len(records), "landings": sum(e["n"] for e in index),
        "restricted": sum(e["restricted"] for e in index),
        "source": "adsb.lol open data (ODbL)",
    }
    _write_json(os.path.join(pub, "index.json"), {"meta": meta, "aircraft": sorted(index, key=lambda e: e["pid"])})
    # key check so the site can tell a wrong secret from a broken file
    with open(os.path.join(pub, "keycheck.bin"), "w") as f:
        f.write(_seal(key, {"ok": True}))
    return meta


# --------------------------------------------------------------------------- main

def main(argv=None):
    ap = argparse.ArgumentParser(prog="debrief.collect")
    ap.add_argument("--type", default="SF50")
    ap.add_argument("--data", default="data")
    ap.add_argument("--cache", default=".cache")
    ap.add_argument("--since", default="2025-10-13", help="earliest day to backfill to")
    ap.add_argument("--max-days", type=int, default=6, help="days to process this run")
    ap.add_argument("--max-minutes", type=float, default=150, help="stop starting new days after this")
    ap.add_argument("--day", action="append", help="process this day (repeatable), ignoring the queue")
    ap.add_argument("--publish-only", action="store_true")
    a = ap.parse_args(argv)

    key = anon.secret()
    t_start = time.time()
    days_meta = _read_json(os.path.join(a.data, "meta", "days.json"), {})
    geoid = _read_json(os.path.join(a.data, "meta", "geoid.json"), {})
    if not a.publish_only:
        reg = fleet_registry(a.cache, a.type)
        print(f"{a.type}: {len(reg)} US registrations")
        todo = [dt.date.fromisoformat(d) for d in a.day] if a.day else _days_to_do(days_meta, dt.date.fromisoformat(a.since), a.max_days)
        print("days to process:", ", ".join(map(str, todo)) or "none")
        for day in todo:
            if (time.time() - t_start) / 60 > a.max_minutes:
                print("time budget reached")
                break
            stats = collect_day(key, day, reg, a.type.upper(), a.data, a.cache, geoid)
            if stats is None:
                print(f"{day}: not published yet")
                continue
            days_meta[str(day)] = stats
            _refresh_geoid(geoid)
            _write_json(os.path.join(a.data, "meta", "days.json"), days_meta, indent=0)
            _write_json(os.path.join(a.data, "meta", "geoid.json"), geoid)
            print(f"{day}: {stats['landings']} landings from {stats['aircraft']} aircraft")
    meta = publish(key, a.data, a.type.upper(), days_meta)
    print(f"published {meta['landings']} landings from {meta['aircraft_seen']} aircraft over {meta['days']} days")


if __name__ == "__main__":
    main()
