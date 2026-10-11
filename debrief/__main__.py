"""python -m debrief N31SF [N12345 ...] --days 365 --out site/data"""

import argparse
import json
import os
import sys

from .pipeline import run


def main(argv=None):
    ap = argparse.ArgumentParser(prog="debrief", description="Score stabilized approaches from ADS-B history.")
    ap.add_argument("tails", nargs="*", help="N-numbers or ICAO hex codes")
    ap.add_argument("--tails-file", help="file with one tail per line (# comments ok)")
    ap.add_argument("--days", type=int, default=365, help="how far back to look (default 365)")
    ap.add_argument("--since", help="start date YYYY-MM-DD (overrides --days)")
    ap.add_argument("--out", default="site/data", help="output folder for <TAIL>.json")
    ap.add_argument("--cache", default=".cache", help="cache folder for traces, weather and runways")
    ap.add_argument("--source", default="adsbx", choices=["adsbx", "local", "adsblol"])
    ap.add_argument("--local-dir", help="folder of daily trace files for --source local")
    a = ap.parse_args(argv)

    tails = list(a.tails)
    if a.tails_file:
        with open(a.tails_file) as f:
            tails += [l.split("#")[0].strip() for l in f if l.split("#")[0].strip()]
    if not tails:
        ap.error("give at least one tail number")

    os.makedirs(a.out, exist_ok=True)
    index = []
    idx_path = os.path.join(a.out, "index.json")
    if os.path.exists(idx_path):
        with open(idx_path) as f:
            index = [e for e in json.load(f) if e["tail"].upper() not in {t.upper() for t in tails}]
    ok = True
    for t in tails:
        try:
            res = run(t, days=a.days, cache_dir=a.cache, source=a.source, local_dir=a.local_dir, since=a.since)
        except Exception as e:  # keep going for the other tails
            print(f"{t}: failed: {e}", file=sys.stderr)
            ok = False
            continue
        name = res["meta"]["tail"].upper()
        with open(os.path.join(a.out, f"{name}.json"), "w") as f:
            json.dump(res, f, separators=(",", ":"))
        index.append({"tail": name, "type": res["meta"]["type"], "landings": len(res["landings"]), "generated": res["meta"]["generated"]})
        print(f"{name}: wrote {len(res['landings'])} landings")
    with open(idx_path, "w") as f:
        json.dump(sorted(index, key=lambda e: e["tail"]), f, indent=1)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
