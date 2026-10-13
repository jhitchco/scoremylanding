# Notes for Claude

Repo: jhitchco/scoremylanding (public). Site: https://jhitchco.github.io/scoremylanding/
Owner: Jeremy Hitchcock. His aircraft is N31SF (SF50, on LADD); it is anonymized like every other aircraft.
He works on Windows PowerShell 5.1: give him `;` between commands, never `&&`.

## Layout
- `debrief/collect.py` fleet collector: day queue, adsb.lol ingest, per-aircraft encrypted state, `publish()` writes anonymized `data/public`.
- `debrief/adsblol.py` streams a day's adsb.lol release (split tar, resumable range requests) and extracts tracked ICAO addresses.
- `debrief/anon.py` pseudonyms (HMAC of ICAO with SML_SECRET), AES-GCM seal/unseal (gzip inside), LADD/PIA flags.
- `debrief/analyze.py` landing / go-around / coverage-gap detection, gate measurement. Profile rows are `[track nm, height, est IAS, cross-track ft, track error deg, along-track nm]`.
- `debrief/fleet.py` FAA registry (`fleet_registry(cache, "SF50")` returns {hex: tail}).
- `site/` static front end. `score.js` is the only scoring implementation; `app.js` is the leaderboard, detail view and owner unlock (WebCrypto).
- `tools/summarize.js` fleet.json (per-aircraft averages at every Vref). `tools/privacy_check.py` deploy gate.
- `.github/workflows/collect.yml` every 3 h; state on the `data` branch (force-pushed single commit).
- `server/` + Docker: private on-demand lookup by tail from ADS-B Exchange. Not used by the public site.

## Rules
- Never use em dashes in copy, comments or UI text.
- Nothing identifying may reach `data/public`: no tail, ICAO, owner, exact time, METAR; no airport/runway/elevation for LADD/PIA aircraft. Extend `tools/privacy_check.py` when adding fields.
- Landing JSON is a contract between `analyze.measure()`, `collect.public_landing()`, `site/score.js` and `site/app.js`. Change them together; keep tests passing.
- Never print or commit SML_SECRET.
- Run `python -m unittest discover -s tests` and `node tests/score.test.js` before committing.

## Ideas not built yet
- Non-US SF50s (needs a type lookup beyond the FAA registry, e.g. the tar1090 aircraft database).
- Other types (`--type` works if aircraft.py has a Vref table), with a type switcher on the site.
- Baro altitude plus METAR altimeter as the touchdown reference when coverage ends early.
- Avionics data-log import for real IAS, flaps and gear.
