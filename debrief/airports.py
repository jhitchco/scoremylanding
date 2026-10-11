"""Runway and airport geometry from OurAirports (public domain)."""

import csv
import json
import os
import time
import urllib.request

from .geo import bearing, hav, runway_frame, angdiff

BASE = "https://davidmegginson.github.io/ourairports-data"
MAX_AGE = 30 * 86400


def _download(cache_dir, name):
    path = os.path.join(cache_dir, "ourairports", name)
    if not os.path.exists(path) or time.time() - os.path.getmtime(path) > MAX_AGE:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with urllib.request.urlopen(f"{BASE}/{name}", timeout=120) as r:
            data = r.read()
        with open(path + ".tmp", "wb") as f:
            f.write(data)
        os.replace(path + ".tmp", path)
    return path


def _num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


class AirportDB:
    def __init__(self, cache_dir, min_length_ft=2500):
        self.airports = {}
        with open(_download(cache_dir, "airports.csv"), encoding="utf-8") as f:
            for a in csv.DictReader(f):
                self.airports[a["ident"]] = {
                    "ident": a["ident"],
                    "name": a["name"],
                    "city": a["municipality"],
                    "type": a["type"],
                    "elev": _num(a["elevation_ft"]),
                    "lat": _num(a["latitude_deg"]),
                    "lon": _num(a["longitude_deg"]),
                    "airline": a["scheduled_service"] == "yes",
                }
        self.grid = {}
        with open(_download(cache_dir, "runways.csv"), encoding="utf-8") as f:
            for r in csv.DictReader(f):
                if r["closed"] == "1" or (_num(r["length_ft"]) or 0) < min_length_ft:
                    continue
                surf = r["surface"].upper()
                if any(s in surf for s in ("WATER", "TURF", "GRASS", "DIRT", "GRAVEL")):
                    continue
                ends = [_num(r[k]) for k in ("le_latitude_deg", "le_longitude_deg", "he_latitude_deg", "he_longitude_deg")]
                if None in ends:
                    continue
                for e, o in (("le", "he"), ("he", "le")):
                    lat, lon = _num(r[e + "_latitude_deg"]), _num(r[e + "_longitude_deg"])
                    olat, olon = _num(r[o + "_latitude_deg"]), _num(r[o + "_longitude_deg"])
                    rw = {
                        "apt": r["airport_ident"],
                        "rwy": r[e + "_ident"],
                        "lat": lat,
                        "lon": lon,
                        "hdg": bearing(lat, lon, olat, olon),
                        "len": _num(r["length_ft"]),
                        "elev": _num(r[e + "_elevation_ft"]),
                        "dthr": _num(r[e + "_displaced_threshold_ft"]) or 0,
                    }
                    self.grid.setdefault((round(lat * 5), round(lon * 5)), []).append(rw)
        self._apt_grid = {}
        for a in self.airports.values():
            if a["lat"] is None or a["type"] not in ("small_airport", "medium_airport", "large_airport"):
                continue
            self._apt_grid.setdefault((round(a["lat"]), round(a["lon"])), []).append(a)

    def near_runways(self, lat, lon):
        k = (round(lat * 5), round(lon * 5))
        out = []
        for i in (-1, 0, 1):
            for j in (-1, 0, 1):
                out.extend(self.grid.get((k[0] + i, k[1] + j), ()))
        return out

    def match(self, p, max_out_nm=2.0, max_cross_nm=0.3, max_hdg=30):
        """Best runway end for a point flying a final approach or landing roll."""
        best = None
        for r in self.near_runways(p["lat"], p["lon"]):
            x, c = runway_frame(p["lat"], p["lon"], r)
            if -r["len"] / 6076 <= x <= max_out_nm and abs(c) < max_cross_nm:
                dh = abs(angdiff(p["trk"], r["hdg"]))
                if dh < max_hdg:
                    score = abs(c) + dh / 100
                    if best is None or score < best[0]:
                        best = (score, r)
        return best[1] if best else None

    def nearest_airport(self, lat, lon):
        k = (round(lat), round(lon))
        best = None
        for i in (-1, 0, 1):
            for j in (-1, 0, 1):
                for a in self._apt_grid.get((k[0] + i, k[1] + j), ()):
                    d = hav(lat, lon, a["lat"], a["lon"])
                    if best is None or d < best[0]:
                        best = (d, a)
        return best if best else (None, None)

    def airport(self, ident):
        return self.airports.get(ident, {})


def dump_debug(db, path):
    with open(path, "w") as f:
        json.dump({"airports": len(db.airports), "cells": len(db.grid)}, f)
