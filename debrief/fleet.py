"""Fleet benchmark: score a random sample of one aircraft type and publish the
results anonymized (no tail numbers, dates or airports) so any pilot can see
where they fall.

python -m debrief.fleet SF50 --sample 40 --days 45 --out site/data/fleet
"""

import argparse
import csv
import io
import json
import os
import random
import sys
import time
import urllib.request
import zipfile

from .pipeline import run

FAA_URL = "https://registry.faa.gov/database/ReleasableAircraft.zip"
KEEP = ("rlen", "wind", "tempC", "ceil", "vis", "sun", "align", "lowcov", "airline", "aloft", "gates", "thr", "td", "stop")


def faa_registry(cache_dir, max_age=7 * 86400):
    path = os.path.join(cache_dir, "faa", "ReleasableAircraft.zip")
    if not os.path.exists(path) or time.time() - os.path.getmtime(path) > max_age:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        req = urllib.request.Request(FAA_URL, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=300) as r, open(path + ".tmp", "wb") as f:
            f.write(r.read())
        os.replace(path + ".tmp", path)
    return zipfile.ZipFile(path)


def fleet_hexes(cache_dir, model):
    """ICAO hex codes of every valid US registration whose FAA model name matches."""
    return sorted(fleet_registry(cache_dir, model))


def fleet_registry(cache_dir, model):
    """{icao_hex: tail} for every valid US registration whose FAA model name matches."""
    z = faa_registry(cache_dir)
    codes = set()
    with z.open("ACFTREF.txt") as f:
        for r in csv.reader(io.TextIOWrapper(f, encoding="utf-8-sig")):
            if len(r) > 2 and r[2].strip().upper() == model.upper():
                codes.add(r[0].strip())
    out = {}
    with z.open("MASTER.txt") as f:
        for r in csv.reader(io.TextIOWrapper(f, encoding="utf-8-sig")):
            if len(r) > 33 and r[2].strip() in codes and r[20].strip() == "V" and r[33].strip():
                out[r[33].strip().lower()] = "N" + r[0].strip()
    return out


def anonymize(landings, idx):
    out = []
    for L in landings:
        d = {k: L.get(k) for k in KEEP}
        d["ac"] = idx
        out.append(d)
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(prog="debrief.fleet")
    ap.add_argument("model", help="FAA model name, e.g. SF50")
    ap.add_argument("--sample", type=int, default=40)
    ap.add_argument("--days", type=int, default=45)
    ap.add_argument("--seed", type=int, default=50)
    ap.add_argument("--exclude", nargs="*", default=[], help="tails or hex to leave out (e.g. your own)")
    ap.add_argument("--cache", default=".cache")
    ap.add_argument("--out", default="site/data/fleet")
    a = ap.parse_args(argv)

    hexes = fleet_hexes(a.cache, a.model)
    from .nnumber import resolve
    skip = {resolve(x) for x in a.exclude}
    pool = [h for h in hexes if h not in skip]
    random.Random(a.seed).shuffle(pool)
    print(f"{a.model}: {len(hexes)} registered, sampling up to {a.sample}")

    landings, flew, tried = [], 0, 0
    for h in pool:
        if flew >= a.sample:
            break
        tried += 1
        try:
            res = run(h, days=a.days, cache_dir=a.cache, log=lambda *x: None)
        except Exception as e:
            print(f"  skip {h}: {e}", file=sys.stderr)
            continue
        n = len(res["landings"])
        print(f"  aircraft {tried}: {n} landings")
        if n:
            landings += anonymize(res["landings"], flew)
            flew += 1

    os.makedirs(a.out, exist_ok=True)
    out = {
        "model": a.model.upper(),
        "registered": len(hexes),
        "aircraft": flew,
        "checked": tried,
        "days": a.days,
        "generated": int(time.time()),
        "landings": landings,
    }
    with open(os.path.join(a.out, f"{a.model.upper()}.json"), "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"wrote {len(landings)} landings from {flew} aircraft")


if __name__ == "__main__":
    main()
