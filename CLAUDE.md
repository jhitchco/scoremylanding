# Notes for Claude

Owner: Jeremy Hitchcock (GitHub jhitchco). Started from scoring his Cirrus SF50, N31SF (ICAO a3460e, home base KASH).
He works on a Windows desktop in PowerShell 5.1: give him `;` between commands, never `&&`.

## Layout
- `debrief/` Python pipeline, standard library only. `pipeline.run(tail)` returns the JSON the site reads.
  - `nnumber.py` N-number to ICAO hex (arithmetic, tested).
  - `sources.py` trace sources. `adsbx` works; `adsblol` is a stub that needs a bulk ingest job.
  - `airports.py` OurAirports runways, matching a point to a runway end.
  - `weather.py` IEM METAR + Open-Meteo winds aloft (has a quota breaker on HTTP 429).
  - `analyze.py` landing / go-around / coverage-gap detection and gate measurement.
  - `fleet.py` anonymized fleet sample from the FAA registry.
- `site/` static front end. `score.js` is the only scoring implementation (browser, fleet, tests).
- `server/app.py` FastAPI on-demand API at `/api/debrief/{tail}`, serves `site/` too.
- `.github/workflows/publish.yml` nightly scoring of `tails.txt` and GitHub Pages deploy.

## Conventions
- Never use em dashes in copy, comments or UI text.
- Landing JSON shape is a contract between `analyze.measure()` and `site/score.js` / `site/app.js`. Change both together and keep `tests/score.test.js` passing.
- Fleet files must stay anonymized: no tails, timestamps, airports or METARs (see `fleet.KEEP`).
- Run `python -m unittest discover -s tests` and `node tests/score.test.js` before committing.

## Ideas not built yet
- adsb.lol ingest so a public version doesn't depend on ADS-B Exchange terms.
- G3000 / avionics data-log import (real IAS, flaps, gear, N1) to replace estimated speeds.
- Per-type stabilized criteria and per-pilot Vref saved in the browser.
- Monthly email summary alongside the Cirrus IQ engine-hours read.
