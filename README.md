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

Without Docker:

```
python -m debrief N31SF --days 365          # writes site/data/N31SF.json
python -m http.server -d site 8080          # open http://localhost:8080/?tail=N31SF
```

Fleet benchmark (random sample of a type, anonymized):

```
python -m debrief.fleet SF50 --sample 40 --days 45 --exclude N31SF --out site/data/fleet
```

## Hosting

**Docker (recommended).** One container serves the page, answers on-demand lookups for any tail, rescores the tails in `tails.txt` nightly and rebuilds the SF50 fleet benchmark weekly. Everything it downloads lives in the `/data` volume.

```
docker compose up -d
# open http://localhost:8000/?tail=N31SF
```

Or pull the prebuilt image that `.github/workflows/docker.yml` publishes on every push to `main`:

```
docker run -d -p 8000:8000 -v debrief-data:/data ghcr.io/jhitchco/approach-debrief:latest
```

Settings are environment variables (see `docker-compose.yml`): history window, refresh interval, which fleet benchmarks to build and how big. Any host that runs a container works (a home server, a NAS, Fly.io, Render, a small VPS); put it behind HTTPS before sharing the link.

| Endpoint | What it returns |
|---|---|
| `/` | The web page |
| `/api/debrief/{tail}` | Scores for any N-number or ICAO hex, computed on demand (first lookup takes a minute or two, then cached) |
| `/data/{TAIL}.json`, `/data/fleet/{TYPE}.json` | Nightly results for tracked tails and the fleet benchmark |
| `/api/health` | Status, tracked tails, last refresh |

**Static on GitHub Pages (no server).** `.github/workflows/publish.yml` does the same nightly scoring in GitHub Actions and deploys `site/` to Pages. Lookups are limited to the tails in `tails.txt`. To use it, set Pages source to "GitHub Actions" in the repo settings.

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
