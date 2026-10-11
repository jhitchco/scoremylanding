"""Surface weather (Iowa Environmental Mesonet METAR archive) and model winds aloft (Open-Meteo)."""

import csv
import datetime as dt
import io
import json
import math
import os
import urllib.error
import urllib.request

from .geo import utc

LEVELS = (1000, 975, 950, 925, 900, 850)


def _get(url, path):
    if os.path.exists(path):
        with open(path) as f:
            return f.read()
    with urllib.request.urlopen(url, timeout=60) as r:
        text = r.read().decode()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(text)
    return text


def _num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def metar(cache_dir, ident, ts):
    """Latest METAR at or just before ts (within 5 min after, to catch the report you heard)."""
    station = ident[1:] if len(ident) == 4 and ident.startswith("K") else ident
    t = utc(ts)
    a, b = t - dt.timedelta(hours=2), t + dt.timedelta(hours=1)
    url = (
        "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?"
        f"station={station}&data=drct&data=sknt&data=gust&data=tmpf&data=vsby"
        "&data=skyc1&data=skyl1&data=skyc2&data=skyl2&data=skyc3&data=skyl3&data=metar"
        f"&year1={a.year}&month1={a.month}&day1={a.day}&hour1={a.hour}&minute1=0"
        f"&year2={b.year}&month2={b.month}&day2={b.day}&hour2={b.hour}&minute2=59"
        "&tz=Etc/UTC&format=onlycomma&latlon=no&missing=M&trace=T&direct=no&report_type=3&report_type=4"
    )
    path = os.path.join(cache_dir, "wx", ident, f"{t:%Y%m%d%H%M}_metar.csv")
    try:
        text = _get(url, path)
    except Exception:
        return None
    best = None
    for r in csv.DictReader(io.StringIO(text)):
        try:
            vt = dt.datetime.strptime(r["valid"], "%Y-%m-%d %H:%M").replace(tzinfo=dt.timezone.utc).timestamp()
        except (KeyError, ValueError):
            continue
        if vt <= ts + 300 and (best is None or vt > best[0]):
            best = (vt, r)
    if not best:
        return None
    r = best[1]
    ceil = 99999
    for i in (1, 2, 3):
        c, l = r.get(f"skyc{i}"), _num(r.get(f"skyl{i}"))
        if c in ("BKN", "OVC", "VV") and l:
            ceil = min(ceil, l)
    return {
        "dir": _num(r["drct"]) or 0,
        "spd": _num(r["sknt"]) or 0,
        "gust": _num(r["gust"]),
        "tempC": (_num(r["tmpf"]) - 32) * 5 / 9 if _num(r["tmpf"]) is not None else None,
        "vis": _num(r["vsby"]),
        "ceil": ceil,
        "raw": r.get("metar"),
    }


_ALOFT_OFF = False  # set when Open-Meteo says the daily quota is used up


def winds_aloft(cache_dir, lat, lon, ts):
    """Model wind profile [(msl_ft, kt, deg)] nearest the hour, plus 10 m wind.
    Returns None when unavailable; callers fall back to the surface wind."""
    global _ALOFT_OFF
    if _ALOFT_OFF:
        return None
    t = utc(ts)
    d = f"{t:%Y-%m-%d}"
    hourly = ",".join(
        f"wind_speed_{l}hPa,wind_direction_{l}hPa,geopotential_height_{l}hPa" for l in LEVELS
    ) + ",wind_speed_10m,wind_direction_10m,wind_gusts_10m"
    url = (
        "https://historical-forecast-api.open-meteo.com/v1/forecast?"
        f"latitude={lat:.3f}&longitude={lon:.3f}&start_date={d}&end_date={d}"
        f"&hourly={hourly}&wind_speed_unit=kn&timezone=GMT"
    )
    path = os.path.join(cache_dir, "wx", "aloft", f"{lat:.2f}_{lon:.2f}_{d}.json")
    try:
        h = json.loads(_get(url, path))["hourly"]
    except urllib.error.HTTPError as e:
        if e.code == 429:
            _ALOFT_OFF = True
        return None
    except Exception:
        return None
    hrs = [dt.datetime.strptime(x, "%Y-%m-%dT%H:%M").replace(tzinfo=dt.timezone.utc).timestamp() for x in h["time"]]
    j = min(range(len(hrs)), key=lambda k: abs(hrs[k] - ts))
    prof = []
    for l in LEVELS:
        z, s, w = h[f"geopotential_height_{l}hPa"][j], h[f"wind_speed_{l}hPa"][j], h[f"wind_direction_{l}hPa"][j]
        if None not in (z, s, w):
            prof.append((z * 3.28084, s, w))
    return {"levels": prof, "sfc": (h["wind_speed_10m"][j], h["wind_direction_10m"][j], h["wind_gusts_10m"][j])}


def _uv(spd, deg):
    r = math.radians(deg)
    return -spd * math.sin(r), -spd * math.cos(r)


def wind_uv_at(msl_ft, field_elev, sfc_spd, sfc_dir, levels):
    """Wind vector (u east, v north, kt) at an altitude, blending the METAR wind into the model profile."""
    prof = sorted([(field_elev + 33, sfc_spd, sfc_dir)] + [(z, s, w) for z, s, w in (levels or []) if z > field_elev + 50])
    if msl_ft <= prof[0][0]:
        return _uv(prof[0][1], prof[0][2])
    for a, b in zip(prof, prof[1:]):
        if a[0] <= msl_ft <= b[0]:
            f = (msl_ft - a[0]) / (b[0] - a[0])
            ua, va = _uv(a[1], a[2])
            ub, vb = _uv(b[1], b[2])
            return ua + f * (ub - ua), va + f * (vb - va)
    return _uv(prof[-1][1], prof[-1][2])
