"""Post-flight email: after each collect run, send subscribers their new landings and go-arounds.

    SML_SECRET=... SML_SUBSCRIBERS="N31SF=me@example.com" SMTP_USER=... SMTP_PASS=... \
        python -m debrief.notify --data data --cache .cache

SML_SUBSCRIBERS: entries separated by ";" or newlines, each TAIL[:VREF]=EMAIL[,EMAIL].
    N31SF=jeremy@example.com            scored at the type's default Vref
    N31SF:84=jeremy@example.com         scored at Vref 84
SMTP_HOST (default smtp.gmail.com), SMTP_PORT (465), SMTP_USER, SMTP_PASS (a Gmail app
password works), SMTP_FROM (defaults to SMTP_USER), NOTIFY_TZ (default America/New_York).

Only flights from the last few days are sent, so reprocessing old days never mails anyone.
What has been sent is tracked in state/notify.bin (encrypted, on the data branch).
Without SMTP settings it renders the emails to --out for a look and sends nothing.
"""

import argparse
import json
import os
import smtplib
import subprocess
import sys
import tempfile
import time
from email.message import EmailMessage

from . import aircraft, anon, owners
from .collect import load_state, _open, _seal
from .fleet import fleet_registry

RECENT_S = 4 * 86400          # never mail anything older than this
FIRST_LOOKBACK_S = 36 * 3600  # a new subscriber gets the last day and a half
SITE = "https://jhitchco.github.io/scoremylanding/"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def parse_subscribers(text):
    """'N31SF:84=a@x.com,b@y.com; N2=c@z.com' -> [{'tail','vref','to'}]"""
    out = []
    for part in (text or "").replace("\n", ";").split(";"):
        if "=" not in part:
            continue
        who, to = part.split("=", 1)
        tail, _, vref = who.strip().upper().partition(":")
        emails = [e.strip() for e in to.split(",") if "@" in e]
        if tail and emails:
            out.append({"tail": tail, "vref": int(vref) if vref.isdigit() else None, "to": emails})
    return out


def pending(rec, last_t, now):
    """Landings and go-arounds newer than what was last sent, and recent enough to matter."""
    floor = max(last_t, now - RECENT_S)
    ev = [L for L in rec["landings"].values() if L["t"] > floor]
    ev += [G for G in rec.get("go_arounds", {}).values() if G["t"] > floor and "gates" in G
           and G.get("ga", {}).get("kind") != "touch"]
    return sorted(ev, key=lambda e: e["t"])


def render(payload):
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(payload, f)
        path = f.name
    try:
        out = subprocess.run(["node", os.path.join(ROOT, "tools", "notify_render.js"), path],
                             check=True, capture_output=True, text=True).stdout
    finally:
        os.remove(path)
    return json.loads(out)


def send(msg_parts, to, cfg):
    m = EmailMessage()
    m["Subject"], m["From"], m["To"] = msg_parts["subject"], cfg["from"], ", ".join(to)
    m.set_content(msg_parts["text"])
    m.add_alternative(msg_parts["html"], subtype="html")
    with smtplib.SMTP_SSL(cfg["host"], cfg["port"], timeout=30) as s:
        s.login(cfg["user"], cfg["pass"])
        s.send_message(m)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="debrief.notify")
    ap.add_argument("--type", default="SF50")
    ap.add_argument("--data", default="data")
    ap.add_argument("--cache", default=".cache")
    ap.add_argument("--out", default="notify_out", help="where rendered emails go when SMTP isn't set")
    ap.add_argument("--now", type=float, help="pretend time (testing)")
    a = ap.parse_args(argv)

    subs = parse_subscribers(os.environ.get("SML_SUBSCRIBERS"))
    if not subs:
        print("post-flight email: no subscribers")
        return 0
    cfg = {"host": os.environ.get("SMTP_HOST") or "smtp.gmail.com", "port": int(os.environ.get("SMTP_PORT") or 465),
           "user": os.environ.get("SMTP_USER"), "pass": os.environ.get("SMTP_PASS")}
    cfg["from"] = os.environ.get("SMTP_FROM") or cfg["user"]
    live = bool(cfg["user"] and cfg["pass"])
    key = anon.secret()
    now = a.now or time.time()
    tz = os.environ.get("NOTIFY_TZ") or "America/New_York"
    by_tail = {t.upper(): h for h, t in fleet_registry(a.cache, a.type).items()}
    sent_path = os.path.join(a.data, "state", "notify.bin")
    sent = {}
    if os.path.exists(sent_path):
        with open(sent_path) as f:
            sent = _open(key, f.read())
    ac = aircraft.info(a.type.upper())
    fleet = os.path.join(a.data, "public", "fleet.json")
    n_mail = 0
    for sub in subs:
        tail = sub["tail"]
        hex_ = by_tail.get(tail) or by_tail.get(tail.lstrip("N")) or by_tail.get("N" + tail.lstrip("N"))
        if not hex_:
            print("post-flight email: a subscribed tail isn't in the registry")
            continue
        pid = anon.pseudonym(key, hex_, a.type.upper())
        rec = load_state(key, a.data, pid)
        if not rec:
            continue
        rec = owners.apply(rec, owners.load(key))
        last = sent.get(tail, {}).get("last_t") or now - FIRST_LOOKBACK_S
        ev = pending(rec, last, now)
        if not ev:
            continue
        cur = len(rec.get("owners", [])) - 1
        recent = [L for L in rec["landings"].values() if L.get("og") == cur and now - L["t"] < 365 * 86400]
        msg = render({"tail": rec.get("tail") or tail, "pid": pid, "vref": sub["vref"] or ac.get("default", 81), "tz": tz,
                      "site": SITE, "events": ev, "recent": recent, "fleet": fleet})
        if live:
            try:
                send(msg, sub["to"], cfg)
            except Exception as e:  # one bad address shouldn't stop the others
                print(f"post-flight email: send failed ({type(e).__name__})")
                continue
            print(f"post-flight email: sent {len(ev)} event(s)")
        else:
            os.makedirs(a.out, exist_ok=True)
            with open(os.path.join(a.out, f"{pid}.html"), "w") as f:
                f.write(msg["html"])
            print(f"post-flight email: SMTP not set; rendered {len(ev)} event(s) to {a.out}")
            continue
        sent[tail] = {"last_t": max(e["t"] for e in ev), "at": int(now)}
        n_mail += 1
    if live:
        os.makedirs(os.path.dirname(sent_path), exist_ok=True)
        with open(sent_path, "w") as f:
            f.write(_seal(key, sent))
    return 0


if __name__ == "__main__":
    sys.exit(main())
