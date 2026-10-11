# Approach debrief

Stabilized-approach scores for every landing an aircraft makes, built from public ADS-B history. Enter a tail number and each arrival gets checked at the 1,000 ft and 500 ft gates (lined up, on a 3° path, sink under 1,000 fpm, speed within limits), plus threshold crossing, touchdown point and float. Surface wind, gusts, winds aloft, night, IMC and runway length are shown as context for a fast or high arrival. A fleet view shows where you rank against a sample of the same type.

![vertical profile](docs/profile.png)

## How it works

```
ADS-B history ─┐
FAA registry  ─┤   debrief/ (Python, stdlib only)        site/ (static HTML + JS)
OurAirports   ─┼─> detect landings, match runways,  ──>  data/<TAIL>.json  ──> score.js scores
METAR (IEM)   ─┤   measure gates, estimate IAS           data/fleet/<TYPE>.json   at your Vref
Open-Meteo    ─┘
```

Scoring lives only in `site/score.js`, so the Vref slider re-scores everything in the browser and the fleet comparison uses the exact same rules.

## Run it locally

```
python -m debrief N31SF --days 365          # writes site/data/N31SF.json
python -m http.server -d site 8080          # open http://localhost:8080/?tail=N31SF
```

Fleet benchmark (random sample of a type, anonymized):

```
python -m debrief.fleet SF50 --sample 40 --days 45 --exclude N31SF --out site/data/fleet
```

## Two ways to host

**Static on GitHub Pages (free).** `.github/workflows/publish.yml` runs nightly, scores every tail in `tails.txt`, rebuilds the fleet benchmark on Sundays and deploys `site/` to Pages. Add a tail by adding a line to `tails.txt`. In the repo settings, set Pages source to "GitHub Actions".

**On-demand server.** Anyone can type any tail and it is computed on the spot (a first lookup takes a few minutes; then it is cached):

```
pip install -r requirements.txt
uvicorn server.app:app --port 8000
```

or `docker build -t approach-debrief . && docker run -p 8000:8000 -v debrief-data:/data approach-debrief`. Fly.io, Render or Railway will run the Dockerfile as is.

## Data sources and limits

| Source | Used for | Terms |
|---|---|---|
| ADS-B Exchange globe history | Tracks | Fine for following your own aircraft. A public or commercial service needs an ADS-B Exchange data license. |
| adsb.lol open data | Tracks (planned) | ODbL open license; daily bulk archives, so it needs an ingest job. `debrief/sources.py` has the stub. |
| FAA releasable aircraft database | Tail to hex, fleet lists | Public |
| OurAirports | Runway thresholds | Public domain |
| Iowa Environmental Mesonet | METAR history | Free, please be gentle |
| Open-Meteo | Winds aloft | Free tier has a daily request limit; falls back to surface wind |

Accuracy: airspeed is estimated from groundspeed minus modeled wind (about ±5 kt). ADS-B has no flap, gear, power or indicated airspeed. Heights use GPS altitude in 25 ft steps. Coverage often drops below a few hundred feet at small fields; those arrivals are listed, not scored. The aircraft's own avionics data log is the better source when available.

Privacy: ADS-B is public, but a site that publishes someone's landings is still publishing their flying. Track aircraft you own or fly, and leave LADD/PIA aircraft alone.
