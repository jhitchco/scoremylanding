"""Find landings in an ADS-B track and measure each approach at fixed gates."""

import math
import statistics
from collections import defaultdict

from . import weather
from .geo import FT_PER_NM, angdiff, hav, runway_frame, sun_elevation, utc

TAN3 = math.tan(math.radians(3))


# --------------------------------------------------------------------------- detection

def detect_landings(pts, db):
    """Air-to-ground transitions matched to a runway end."""
    out = []
    for i in range(2, len(pts)):
        a, b = pts[i - 1], pts[i]
        if not (b["gnd"] and not a["gnd"] and b["t"] - a["t"] < 120):
            continue
        fast = [q for q in pts[max(0, i - 60):i] if not q["gnd"] and q["gs"] > 60 and b["t"] - q["t"] < 90]
        rw = (db.match(fast[-1]) if fast else None) or db.match(a)
        if not rw:
            continue
        if out and b["t"] - pts[out[-1][0]]["t"] < 300:
            continue
        out.append((i, rw))
    return out


def detect_go_arounds(pts, db):
    """Descents to a local minimum near a runway, then a climb of 400+ ft with no ground contact."""
    out = []
    for i in range(5, len(pts) - 5):
        p = pts[i]
        if p["gnd"] or p["geom"] is None:
            continue
        rw = db.match(p, max_out_nm=1.5)
        if not rw:
            continue
        win = [q for q in pts[max(0, i - 60):i + 60] if abs(q["t"] - p["t"]) < 90 and not q["gnd"] and q["geom"] is not None]
        if p["geom"] > min(q["geom"] for q in win):
            continue
        prev = [q for q in pts[max(0, i - 200):i] if p["t"] - q["t"] < 240]
        nxt = [q for q in pts[i:i + 120] if q["t"] - p["t"] < 240]
        if any(q["gnd"] for q in prev + nxt):
            continue
        if not any((q["geom"] or -9e9) - p["geom"] > 400 for q in prev):
            continue
        if max((q["geom"] or -9e9) for q in nxt) - p["geom"] < 400:
            continue
        if any(abs(pts[j]["t"] - p["t"]) < 300 for j, _ in out):
            continue
        out.append((i, rw))
    return out


def detect_coverage_gaps(pts, db, landed_idx=()):
    """Arrivals the track doesn't show completely: the airplane drops out while airborne
    and is next seen on the ground (or not seen for 20+ minutes) near an airport."""
    out = []
    landed = set(landed_idx)
    for i in range(1, len(pts)):
        a, b = pts[i - 1], pts[i]
        gap = b["t"] - a["t"]
        if a["gnd"] or i in landed:
            continue
        if not ((b["gnd"] and gap >= 120) or gap >= 1200):
            continue
        alt = a["geom"] if a["geom"] is not None else a["baro"]
        if alt is None:
            continue
        if b["gnd"]:  # it landed somewhere; name the field it was found on
            d, apt = db.nearest_airport(b["lat"], b["lon"])
            if not apt or d > 3:
                continue
        else:
            d, apt = db.nearest_airport(a["lat"], a["lon"])
            if not apt or d > 12:
                continue
        agl = alt - (apt["elev"] or 0)
        if agl > 3500 and not b["gnd"]:
            continue  # cruising out of coverage, not an arrival
        if agl < 250:
            why = "Coverage lost on short final, below about 250 ft"
        elif agl < 3500:
            dd = hav(a["lat"], a["lon"], apt["lat"], apt["lon"])
            why = f"Coverage lost about {dd:.0f} nm out, roughly {round(agl, -2):,.0f} ft above the field"
        else:
            why = f"Coverage lost at about {round(alt, -2):,.0f} ft; next seen on the ground here"
        out.append({"t": int(a["t"]), "apt": apt["ident"], "name": apt["name"], "why": why})
    return out


# --------------------------------------------------------------------------- metrics

def _interp(seq, key, val):
    for a, b in zip(seq, seq[1:]):
        ka, kb = a.get(key), b.get(key)
        if ka is None or kb is None or ka == kb:
            continue
        if (ka - val) * (kb - val) <= 0:
            f = (val - ka) / (kb - ka)
            out = {}
            for k, va in a.items():
                vb = b.get(k)
                if isinstance(va, (int, float)) and isinstance(vb, (int, float)) and not isinstance(va, bool):
                    out[k] = va + f * (vb - va)
            return out
    return None


def _airborne_segment(pts, i, T):
    seg, j = [], i - 1
    while j > 0 and T - pts[j]["t"] < 1200 and not pts[j]["gnd"]:
        seg.append(pts[j])
        j -= 1
    seg.reverse()
    return seg


def touchdown_reference(pts, i):
    """GPS (HAE) altitude at touchdown: lowest geometric altitude in the last 45 s airborne."""
    T = pts[i]["t"]
    fin = [p["geom"] for p in pts[max(0, i - 40):i] if not p["gnd"] and p["geom"] is not None and T - p["t"] < 45]
    return min(fin) if fin else None


def measure(pts, i, rw, db, cache_dir, ref, lowcov):
    T = pts[i]["t"]
    apt = db.airport(rw["apt"])
    fe = apt.get("elev") or rw["elev"] or 0
    seg = _airborne_segment(pts, i, T)
    gnd = [p for p in pts[i:i + 80] if p["gnd"] and p["t"] - T < 120]

    m = weather.metar(cache_dir, rw["apt"], T)
    al = weather.winds_aloft(cache_dir, rw["lat"], rw["lon"], T)
    if m is None and al:
        m = {"dir": al["sfc"][1] or 0, "spd": al["sfc"][0] or 0, "gust": None, "tempC": None, "vis": None, "ceil": 99999, "raw": None}
    m = m or {"dir": 0, "spd": 0, "gust": None, "tempC": None, "vis": None, "ceil": 99999, "raw": None}
    wd, ws = m["dir"], m["spd"]
    hw = ws * math.cos(math.radians(wd - rw["hdg"]))
    xw = ws * math.sin(math.radians(wd - rw["hdg"]))
    tC = m["tempC"] if m["tempC"] is not None else 15

    rows = []
    for p in seg:
        x, c = runway_frame(p["lat"], p["lon"], rw)
        hat = (p["geom"] - ref) if p["geom"] is not None else None
        msl = hat + fe if hat is not None else fe
        u, v = weather.wind_uv_at(msl, fe, ws, wd, al["levels"] if al else None)
        tr = math.radians(p["trk"])
        tas = math.hypot(p["gs"] * math.sin(tr) - u, p["gs"] * math.cos(tr) - v)
        pa = p["baro"] if p["baro"] is not None else msl
        Tk = tC + 273.15 - 1.98 * (msl - fe) / 1000
        sigma = (1 - 6.8756e-6 * pa) ** 5.2559 * 288.15 / Tk
        vs = p["gvr"] if p["gvr"] is not None else p["vr"]
        rows.append({
            "t": p["t"] - T, "x": x, "c": c * FT_PER_NM, "r": math.hypot(x, c), "hat": hat,
            "gs": p["gs"], "ias": tas * math.sqrt(max(sigma, 0.3)), "vs": vs,
            "trkdev": angdiff(p["trk"], rw["hdg"]),
            "gp": (hat - (50 + TAN3 * x * FT_PER_NM)) if hat is not None and x > 0 else None,
            "ang": math.degrees(math.atan2(hat - 50, x * FT_PER_NM)) if hat is not None and x > 0.15 else None,
            "lat": p["lat"], "lon": p["lon"],
        })

    appr = [q for q in rows if q["x"] > -0.05]
    rev = list(reversed(appr))
    gates = {f"{nm}nm": _interp(rev, "r", nm) for nm in (5, 3, 1)}
    gates["1000ft"] = _interp(rev, "hat", 1000)
    gates["500ft"] = _interp(rev, "hat", 500)
    thr = _interp(list(reversed([q for q in rows if abs(q["c"]) < 1500])), "x", 0.0)

    td = None
    if not lowcov:
        for q in rows:
            if q["t"] > (thr["t"] if thr else -60) and q["hat"] is not None and q["hat"] <= 0:
                td = q
                break
        if td is None and gnd:
            x, _ = runway_frame(gnd[0]["lat"], gnd[0]["lon"], rw)
            td = {"x": x, "t": 0, "gs": gnd[0]["gs"]}
    stop = None
    if td:
        tail = [q for q in rows if q["t"] >= td["t"]] + [
            {"x": runway_frame(p["lat"], p["lon"], rw)[0], "gs": p["gs"], "t": p["t"] - T} for p in gnd]
        stop = next((q for q in tail if q["gs"] < 35), None)

    align = 0.0
    for q in rev:
        if abs(q["trkdev"]) <= 12 and abs(q["c"]) <= 0.4 * FT_PER_NM:
            align = q["x"]
        else:
            break

    # track miles to the threshold, for the vertical profile
    cum = [0.0] * len(rows)
    for k in range(len(rows) - 2, -1, -1):
        cum[k] = cum[k + 1] + hav(rows[k]["lat"], rows[k]["lon"], rows[k + 1]["lat"], rows[k + 1]["lon"])
    t_thr = thr["t"] if thr else 0
    k0 = min(range(len(rows)), key=lambda k: abs(rows[k]["t"] - t_thr)) if rows else 0
    c0 = cum[k0] if rows else 0

    def g(d):
        if not d:
            return None
        o = {}
        for k in ("x", "r", "c", "hat", "gs", "ias", "vs", "trkdev", "gp", "ang", "t"):
            v = d.get(k)
            o[k] = None if v is None else round(v, 2 if k in ("x", "r", "ang") else 0)
        if rows and d.get("t") is not None:
            kk = min(range(len(rows)), key=lambda k: abs(rows[k]["t"] - d["t"]))
            o["dtg"] = round(cum[kk] - c0, 2)
        return o

    tdft = round(-td["x"] * FT_PER_NM) if td else None
    stopft = round(-stop["x"] * FT_PER_NM) if stop else None
    return {
        "id": f"{rw['apt']}-{rw['rwy']}-{int(T)}",
        "t": int(T),
        "apt": rw["apt"], "rwy": rw["rwy"], "rlen": rw["len"], "fe": fe,
        "apt_name": apt.get("name"), "airline": apt.get("airline", False), "apt_type": apt.get("type"),
        "wind": {"dir": wd, "spd": ws, "gust": m["gust"], "hw": round(hw, 1), "xw": round(xw, 1)},
        "tempC": round(tC), "ceil": m["ceil"], "vis": m["vis"], "metar": m["raw"],
        "sun": round(sun_elevation(T, rw["lat"], rw["lon"]), 1),
        "align": round(align, 1), "lowcov": lowcov, "aloft": al is not None,
        "owner": pts[i].get("owner"),
        "gates": {k: g(v) for k, v in gates.items()},
        "thr": g(thr),
        "td": {"ft": tdft, "float": round(td["t"] - thr["t"]) if (thr and "t" in td) else None, "gs": round(td["gs"])} if td else None,
        "stop": {"ft": stopft, "remain": round(rw["len"] - stopft)} if stopft is not None else None,
        "prof": [[round(cq - c0, 3), q["hat"], round(q["ias"], 1), round(q["c"]), q["gs"], q["vs"], round(q["trkdev"], 1), round(q["x"], 3)]
                 for q, cq in zip(rows, cum) if cq - c0 <= 7 and q["hat"] is not None and q["hat"] < 2600],
        "plan": [[round(q["x"], 3), round(q["c"] / FT_PER_NM, 3)] for q in rows if -1 < q["x"] < 7 and abs(q["c"]) < 3.5 * FT_PER_NM],
    }


def correct_runway_offsets(landings, min_n=3):
    """Some database thresholds are a few hundred feet off. If one aircraft crosses the
    same threshold with the same lateral offset every time, treat it as a database error."""
    by = defaultdict(list)
    for L in landings:
        if L["thr"]:
            by[(L["apt"], L["rwy"])].append(L["thr"]["c"])
    fixes = {}
    for k, v in by.items():
        if len(v) >= min_n and abs(statistics.median(v)) > 100 and statistics.pstdev(v) < 40:
            fixes[k] = statistics.median(v)
    for L in landings:
        B = fixes.get((L["apt"], L["rwy"]))
        if B is None:
            continue
        L["dbfix"] = round(B)
        for gate in list(L["gates"].values()) + [L["thr"]]:
            if gate and gate.get("c") is not None:
                gate["c"] = round(gate["c"] - B)
        for p in L["prof"]:
            p[3] = round(p[3] - B)
        for p in L["plan"]:
            p[1] = round(p[1] - B / FT_PER_NM, 3)
    return [{"apt": k[0], "rwy": k[1], "ft": round(v)} for k, v in fixes.items()]


def analyze(pts, db, cache_dir, log=print):
    events = detect_landings(pts, db)
    log(f"  {len(events)} landings detected")
    refs = {i: touchdown_reference(pts, i) for i, _ in events}
    # geoid separation + touchdown height, learned from this aircraft's own landings
    offs = [refs[i] - (db.airport(rw["apt"]).get("elev") or rw["elev"] or 0) for i, rw in events if refs[i] is not None]
    geoid = statistics.median(offs) if offs else -100
    landings = []
    for n, (i, rw) in enumerate(events, 1):
        ref, low = refs[i], False
        if ref is None:
            ref, low = (db.airport(rw["apt"]).get("elev") or rw["elev"] or 0) + geoid, True
        log(f"  [{n}/{len(events)}] {utc(pts[i]['t']):%Y-%m-%d} {rw['apt']} {rw['rwy']}")
        landings.append(measure(pts, i, rw, db, cache_dir, ref, low))
    fixes = correct_runway_offsets(landings)
    gas = []
    for i, rw in detect_go_arounds(pts, db):
        fe = db.airport(rw["apt"]).get("elev") or rw["elev"] or 0
        gas.append({"t": int(pts[i]["t"]), "apt": rw["apt"], "rwy": rw["rwy"], "low_ft": round(pts[i]["geom"] - geoid - fe)})
    gaps = detect_coverage_gaps(pts, db, [i for i, _ in events])
    return landings, gas, gaps, fixes
