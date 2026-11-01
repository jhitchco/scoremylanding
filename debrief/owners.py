"""Owner-change dates: where one pilot's landings stop counting and the next one's start.

    SML_SECRET=... python -m debrief.owners set N31SF 2026-05-01
    SML_SECRET=... python -m debrief.owners clear N31SF
    SML_SECRET=... python -m debrief.owners list

ADS-B owner fields lag real sales by months, so an owner can set the date directly.
Landings before the date count as an earlier owner: left out of the leaderboard, the
trend and the fleet comparison unless "Include earlier owners" is ticked.
The dates are kept encrypted in owner_since.bin, since a tail plus a date identifies
an airplane.
"""

import argparse
import copy
import datetime as dt
import os
import sys

from . import anon

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, "owner_since.bin")


def load(key, path=PATH):
    if not os.path.exists(path):
        return {}
    try:
        with open(path) as f:
            return anon.unseal(key, f.read())
    except Exception:  # sealed with another secret (local tests); ignore rather than fail a publish
        print("owner dates: could not open owner_since.bin with this secret; ignoring it")
        return {}


def save(key, data, path=PATH):
    with open(path, "w") as f:
        f.write(anon.seal(key, data))


def _day(t):
    return dt.datetime.fromtimestamp(t, dt.timezone.utc).strftime("%Y-%m-%d")


def apply(rec, overrides):
    """A copy of an aircraft record with og (owner index) set from the owner's date, if
    there is one: 0 before it, 1 from it on. Records without a date come back unchanged."""
    since = overrides.get((rec.get("tail") or "").upper())
    if not since:
        return rec
    rec = copy.copy(rec)
    for k in ("landings", "go_arounds"):
        rec[k] = {i: dict(e, og=0 if _day(e["t"]) < since else 1) for i, e in rec.get(k, {}).items()}
    rec["owners"] = [f"Before {since}", f"From {since}"]
    return rec


def main(argv=None):
    ap = argparse.ArgumentParser(prog="debrief.owners")
    ap.add_argument("cmd", choices=["set", "clear", "list"])
    ap.add_argument("tail", nargs="?")
    ap.add_argument("date", nargs="?", help="YYYY-MM-DD, first day of the new owner")
    a = ap.parse_args(argv)
    key = anon.secret()
    data = load(key)
    if a.cmd == "list":
        for t, d in sorted(data.items()):
            print(t, d)
        return 0
    tail = (a.tail or "").upper()
    if not tail:
        ap.error("tail required")
    if a.cmd == "set":
        dt.date.fromisoformat(a.date)
        data[tail] = a.date
    else:
        data.pop(tail, None)
    save(key, data)
    print(f"{len(data)} owner date(s) saved")
    return 0


if __name__ == "__main__":
    sys.exit(main())
