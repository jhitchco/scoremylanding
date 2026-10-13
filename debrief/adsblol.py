"""Ingest one day of adsb.lol open data (ODbL) and keep only the aircraft we track.

adsb.lol publishes each day as a GitHub release of split tar files (about 3.5 GB).
We stream the tar straight from the release, never writing the whole thing to disk,
and copy out trace_full_<hex>.json for the hex codes in our fleet list.

    python -m debrief.adsblol 2026-10-03 --hexes fleet_hexes.txt --out .cache/lol
"""

import argparse
import datetime as dt
import gzip
import io
import json
import os
import sys
import tarfile
import time
import urllib.request

REPO = "adsblol/globe_history_{year}"
PREFERRED = ("prod", "staging")  # prod is the main feed; staging is the fallback replica


def release_tags(day):
    """Release tag candidates for a day, preferred first."""
    return [f"v{day:%Y.%m.%d}-planes-readsb-{kind}-0" for kind in PREFERRED]


def part_urls(day, tag):
    base = f"https://github.com/{REPO.format(year=day.year)}/releases/download/{tag}/{tag}"
    return [base + f".tar.{s}" for s in ("aa", "ab", "ac", "ad", "ae", "af")]


def _exists(url):
    req = urllib.request.Request(url, method="HEAD")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status == 200
    except Exception:
        return False


def find_parts(day):
    for tag in release_tags(day):
        urls = [u for u in part_urls(day, tag) if _exists(u)]
        if urls:
            return tag, urls
    return None, []


class _Concat(io.RawIOBase):
    """Read several large HTTP files back to back as one stream.

    Connections to the release CDN sometimes drop partway through a 2 GB part, so
    each part is read with Range requests and resumed from the last byte received."""

    def __init__(self, urls, retries=20):
        self.urls = list(urls)
        self.retries = retries
        self.resp = None
        self.url = None
        self.pos = 0
        self.size = None

    def readable(self):
        return True

    def _open(self):
        headers = {"User-Agent": "scoremylanding"}
        if self.pos:
            headers["Range"] = f"bytes={self.pos}-"
        for attempt in range(self.retries):
            try:
                r = urllib.request.urlopen(urllib.request.Request(self.url, headers=headers), timeout=120)
                if self.pos and r.status != 206:
                    raise IOError("server ignored the range request")
                if self.size is None:
                    self.size = int(r.headers.get("Content-Length") or 0)
                return r
            except Exception:
                if attempt == self.retries - 1:
                    raise
                time.sleep(min(60, 3 * (attempt + 1)))

    def readinto(self, b):
        fails = 0
        while True:
            if self.resp is None:
                if not self.urls:
                    return 0
                if self.url is None:
                    self.url, self.pos, self.size = self.urls.pop(0), 0, None
                self.resp = self._open()
            try:
                n = self.resp.readinto(b)
            except Exception:
                n = -1
            if n and n > 0:
                self.pos += n
                return n
            self.resp.close()
            self.resp = None
            if n == 0 and self.size and self.pos >= self.size:
                self.url = None  # part finished; move to the next one
                continue
            fails += 1  # dropped connection: reopen at self.pos
            if fails > self.retries:
                raise IOError(f"download kept failing at byte {self.pos} of {self.url}")
            time.sleep(min(30, 2 * fails))


def _load(raw):
    try:
        return json.loads(gzip.decompress(raw))
    except OSError:
        return json.loads(raw)


def ingest_day(day, hexes, out_dir, log=print):
    """Write <out_dir>/<hex>/<YYYY-MM-DD>.json for every tracked hex seen that day.
    Returns (tag, number_of_aircraft_found) or (None, 0) when the day isn't published yet."""
    marker = os.path.join(out_dir, "_done", str(day))
    if os.path.exists(marker):  # already streamed in this cache
        with open(marker) as f:
            tag, found = f.read().split()
        return tag, int(found)
    tag, urls = find_parts(day)
    if not urls:
        return None, 0
    log(f"{day}: streaming {tag} ({len(urls)} parts)")
    hexes = {h.lower() for h in hexes}
    found = 0
    stream = io.BufferedReader(_Concat(urls), buffer_size=4 << 20)
    with tarfile.open(fileobj=stream, mode="r|") as tar:
        for m in tar:
            name = m.name.rsplit("/", 1)[-1]
            if not (m.isfile() and name.startswith("trace_full_")):
                continue
            hex_ = name[len("trace_full_"):].split(".")[0].lower()
            if hex_ not in hexes:
                continue
            data = _load(tar.extractfile(m).read())
            path = os.path.join(out_dir, hex_, f"{day:%Y-%m-%d}.json")
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w") as f:
                json.dump(data, f, separators=(",", ":"))
            found += 1
    log(f"{day}: {found} tracked aircraft had data")
    os.makedirs(os.path.dirname(marker), exist_ok=True)
    with open(marker, "w") as f:
        f.write(f"{tag} {found}")
    return tag, found


def main(argv=None):
    ap = argparse.ArgumentParser(prog="debrief.adsblol")
    ap.add_argument("day")
    ap.add_argument("--hexes", required=True, help="file with one ICAO hex per line")
    ap.add_argument("--out", default=".cache/lol")
    a = ap.parse_args(argv)
    with open(a.hexes) as f:
        hexes = [l.strip() for l in f if l.strip()]
    tag, n = ingest_day(dt.date.fromisoformat(a.day), hexes, a.out)
    if not tag:
        print("not published yet", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
