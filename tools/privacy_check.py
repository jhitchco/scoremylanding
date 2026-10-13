"""Fail the deploy if anything identifying reaches the public site.

    python tools/privacy_check.py data/public --type SF50 --cache .cache

Checks every public JSON file for: any ICAO address or N-number from the FAA registry,
owner-style names, exact timestamps, raw METARs, and airport fields on LADD/PIA aircraft.
"""

import argparse
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from debrief.fleet import fleet_registry  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("public")
    ap.add_argument("--type", default="SF50")
    ap.add_argument("--cache", default=".cache")
    a = ap.parse_args()
    reg = fleet_registry(a.cache, a.type)
    problems = []
    files = glob.glob(os.path.join(a.public, "**", "*.json"), recursive=True)
    for f in files:
        text = open(f).read()
        low = text.lower()
        for h, tail in reg.items():
            if h in low:
                problems.append(f"{f}: ICAO address {h}")
            if re.search(r"(?<![A-Za-z0-9])" + re.escape(tail) + r"(?![A-Za-z0-9])", text):
                problems.append(f"{f}: tail {tail}")
        for pat, what in ((r'"t":\s*1[0-9]{9}', "exact timestamp"), (r'"metar"\s*:\s*"', "raw METAR"),
                          (r'"(owner|ownOp|owners|hex|tail)"\s*:', "identity field")):
            if re.search(pat, text):
                problems.append(f"{f}: {what}")
        if os.path.basename(os.path.dirname(f)) == "ac":
            d = json.loads(text)
            if d.get("restricted"):
                for L in d["landings"]:
                    if L.get("apt") or L.get("rwy") or L.get("fe"):
                        problems.append(f"{f}: airport on a LADD/PIA aircraft")
                        break
    if problems:
        print("\n".join(problems[:50]))
        print(f"privacy check FAILED: {len(problems)} problems")
        return 1
    print(f"privacy check passed: {len(files)} files, {len(reg)} registry entries")
    return 0


if __name__ == "__main__":
    sys.exit(main())
