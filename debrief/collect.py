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
# Bump when analysis changes what is stored per event; older days are re-queued behind new ones.
# 2: go-arounds measured like approaches (gates, decision height), practice-session counts.
ANALYSIS_VERSION = 2


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

def _priority_days(path, done):
    """Days listed in priority_days.txt that haven't been processed, oldest first."""
    try:
        with open(path) as f:
            days = {l.split("#")[0].strip() for l in f}
    except FileNotFoundError:
        return []
    out = []
    for d in sorted(x for x in days if x):
        try:
            day = dt.date.fromisoformat(d)
        except ValueError:
            continue
        if d not in done and day < dt.datetime.now(dt.timezone.utc).date():
            out.append(day)
    return out


def _days_to_do(done, since, max_days, priority=()):
    """Priority days first (all of them), then the newest unprocessed days, then days
    processed under an older ANALYSIS_VERSION (newest first) to fill the budget."""
    today = dt.datetime.now(dt.timezone.utc).date()
    out = list(priority)
    max_days = max_days + len(out)
    d = today - dt.timedelta(days=1)
    while d >= since and len(out) < max_days:
        if str(d) not in done and d not in out:
            out.append(d)
        d -= dt.timedelta(days=1)
    stale = sorted((k for k, v in done.items() if (v or {}).get("v", 1) < ANALYSIS_VERSION), reverse=True)
    for k in stale:
        if len(out) >= max_days:
            break
        day = dt.date.fromisoformat(k)
        if day not in out:
            out.append(day)
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
    stats = {"tag": tag, "aircraft": found, "landings": 0, "go_arounds": 0, "lowcov": 0, "at": int(time.time()), "v": ANALYSIS_VERSION}
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
            g["og"] = _owner_index(rec, g.pop("owner", None) or meta.get("ownOp"))
            gid = anon.landing_id(key, hex_, g["t"])
            g["id"] = gid
            rec["go_arounds"][gid] = g
            stats["go_arounds"] += g["ga"]["kind"] == "go-around"
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


AFTER_S = 3600


def link_after(rec):
    """For each go-around, what came next for this airplane within an hour: landed back at
    the same airport, went around again, or landed somewhere else (diverted)."""
    events = [("L", lid, L) for lid, L in rec["landings"].items()] + [("G", gid, G) for gid, G in rec["go_arounds"].items()]
    events.sort(key=lambda e: e[2]["t"])
    out = {}
    for k, (typ, gid, G) in enumerate(events):
        if typ != "G":
            continue
        nxt = next((e for e in events[k + 1:] if 0 < e[2]["t"] - G["t"] <= AFTER_S), None)
        if not nxt:
            out[gid] = {"kind": "unseen"}
            continue
        same = nxt[2].get("apt") == G.get("apt")
        kind = ("landed" if same else "diverted") if nxt[0] == "L" else ("again" if same else "diverted")
        out[gid] = {"kind": kind, "id": nxt[1], "min": round((nxt[2]["t"] - G["t"]) / 60)}
    return out


def _day(t):
    return dt.datetime.fromtimestamp(t, dt.timezone.utc).strftime("%Y-%m-%d")


def public_go_around(gid, G, restricted):
    """Measured go-arounds publish like landings. Ones stored before ANALYSIS_VERSION 2
    carry only time, runway and low point until their day is reprocessed."""
    if "gates" in G:
        return public_landing(dict(G, id=gid), restricted)
    d = {"id": gid, "d": dt.datetime.fromtimestamp(G["t"], dt.timezone.utc).strftime("%Y-%m-%d"),
         "legacy": True, "after": G.get("after"), "ga": {"low_ft": G.get("low_ft"), "low_x": None, "kind": "go-around"}}
    if not restricted:
        d.update({"apt": G.get("apt"), "rwy": G.get("rwy")})
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
    current = {k for k, v in days_meta.items() if (v or {}).get("v", 1) >= ANALYSIS_VERSION}
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
            "go_arounds": [],  # filled below, after the runway fix
            "unscored": [_public_event(e, restricted) for e in sorted(rec["unscored"].values(), key=lambda e: e["t"])],
        }
        for G in rec["go_arounds"].values():
            B = fixes.get((G.get("apt"), G.get("rwy")))
            if B and "gates" in G:
                G.update(_apply_fix(G, B))
        # an unmeasured go-around on a day that has since been reprocessed wasn't detected again: drop it
        gas = {gid: G for gid, G in rec["go_arounds"].items() if "gates" in G or _day(G["t"]) not in current}
        after = link_after({"landings": rec["landings"], "go_arounds": gas})
        gas = {gid: dict(G, after=after.get(gid)) for gid, G in gas.items()}
        doc["go_arounds"] = [public_go_around(gid, G, restricted) for gid, G in sorted(gas.items(), key=lambda kv: kv[1]["t"])]
        _write_json(os.path.join(pub, "ac", f"{rec['pid']}.json"), doc)
        # the owner-only file the site decrypts: tail plus everything withheld above
        detail = {
            "tail": rec.get("tail"), "hex": rec.get("hex"), "year": rec.get("year"), "owners": rec.get("owners"),
            "landings": {L["id"]: {k: L.get(k) for k in ("t", "apt", "rwy", "apt_name", "metar", "fe", "airline")} for L in Ls},
            "go_arounds": {gid: {k: G.get(k) for k in ("t", "apt", "rwy", "apt_name", "metar", "fe", "airline")} for gid, G in gas.items()},
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
        "analysis_version": ANALYSIS_VERSION,
        # days whose go-arounds are measured; go-around rates only use landings from these days
        "current_days": sorted(current),
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
    ap.add_argument("--priority", default="priority_days.txt", help="file of days to process before the queue")
    ap.add_argument("--publish-only", action="store_true")
    a = ap.parse_args(argv)

    key = anon.secret()
    t_start = time.time()
    days_meta = _read_json(os.path.join(a.data, "meta", "days.json"), {})
    geoid = _read_json(os.path.join(a.data, "meta", "geoid.json"), {})
    if not a.publish_only:
        reg = fleet_registry(a.cache, a.type)
        print(f"{a.type}: {len(reg)} US registrations")
        prio = _priority_days(a.priority, days_meta)
        if prio:
            print(f"priority days first: {len(prio)}")
        todo = [dt.date.fromisoformat(d) for d in a.day] if a.day else _days_to_do(days_meta, dt.date.fromisoformat(a.since), a.max_days, prio)
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
