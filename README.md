# Open Karta — Ethiopia Geospatial Stack

A complete, self-hosted, open-source geospatial stack for **Ethiopia**. One
`docker compose up` gives you vector basemap tiles, turn-by-turn routing,
address search, and a polished web showcase — all from the daily
[Geofabrik](https://download.geofabrik.de/africa/ethiopia.html) OpenStreetMap
extract, kept fresh automatically.

> ⚠️ **Heads up:** this is a **vibe-coded, simplified setup** for basic local
> use and experimentation — a friendly starting point, **not** a hardened
> production deployment. Expect rough edges; pin versions, lock down secrets and
> add real monitoring before relying on it.

Everything is fronted by a **single nginx gateway** on `:8000` — the app, the
API docs at `/docs`, and a reverse proxy to every backend. The individual
engines aren't published to the host.

```
                    ┌──────────────────────────────────────────────────┐
  Geofabrik OSM ──► │  data-pipeline  (alpine + docker-cli)            │
  (ethiopia.pbf)    │   1 ingest → 2 Planetiler → 3 OSRM → 4 reload    │
                    └──────┬───────────────┬───────────────────────────┘
                           │ mbtiles        │ osrm graph
    internal-only:  ┌───▼────┐ ┌────▼───┐ ┌──────────┐ ┌────────┐ ┌───────┐
                    │ Martin │ │  OSRM  │◄─┤ Nominatim│ │ Photon │ │ VROOM │
                    │ tiles  │ │routing │  │ geocoder │ │ search │ │ optim.│
                    └───┬────┘ └──┬──┬──┘  └────┬─────┘ └───┬────┘ └───┬───┘
                        │         │  └────────────────(OSRM driver)────┘
                        └─────────┴────────┬───┴───────────┴──────────┘
                       ┌──────────────────▼─────────────────────────────┐
                       │  web-showcase · nginx gateway :8000             │  http://localhost:8000
                       │  app + /docs + reverse proxy:                   │
                       │  /tiles/ /osrm/ /photon/ /nominatim/ /vroom/    │
                       └────────────────────────────────────────────────┘
```

## Quick start

> **Run from this directory** so `$PWD` resolves correctly — the pipeline needs
> the absolute host path to bind-mount `./data` into the build containers it
> launches via the Docker socket.

```bash
docker compose up -d
docker compose logs -f data-pipeline      # watch the first build
open http://localhost:8000
```

The **first** boot does a heavy one-time build: Planetiler tiles (a few
minutes) + OSRM graph + the Nominatim import (the slowest — tens of minutes for
a country). The tile and routing servers **wait** for the pipeline (sentinel
files) instead of crash-looping, then come online as each build finishes. After
that it refreshes every 24h.

Everything is reached through the **`:8000` gateway** (no backend is published to
the host):

| Path (`http://localhost:8000`) | Engine | Notes |
|---|---|---|
| `/` | — | MapLibre GL showcase app |
| `/docs` | — | docsify API reference (every endpoint) |
| `/tiles/{z}/{x}/{y}` | Martin | vector tiles, same-origin, uncompressed |
| `/martin/…` | Martin | full Martin API (`/catalog`, TileJSON, `/health`) |
| `/osrm/…` | OSRM | `/osrm/route/v1/driving/…`, `nearest`, `table`, `match`, `trip` |
| `/nominatim/…` | Nominatim | `/nominatim/search`, `reverse`, `lookup`, `details`, `status` |
| `/photon/…` | Photon | `/photon/api?q=…`, `reverse`, `status` (type-ahead) |
| `/vroom/` (POST) | VROOM | vehicle-routing optimization (uses OSRM); `/vroom/health` |

> **Full API reference:** open **<http://localhost:8000/docs>** — every endpoint
> with a description, example use case and a link to the engine's own docs. The
> source lives in [`docs/`](docs/).

## Setup guide

### 1. Prerequisites

| Requirement | Why / notes |
|---|---|
| **Docker Engine 24+** and **Compose v2** (`docker compose`, not `docker-compose`) | Orchestrates the whole stack. The pipeline talks to the host Docker socket to launch transient build containers. |
| **~15 GB free disk** | OSM extract + mbtiles + OSRM graph + the Nominatim PostgreSQL DB + Photon index (all under `./data` and named volumes). |
| **≥ 8 GB RAM** (12 GB+ comfortable) | Planetiler (`PLANETILER_XMX=4g`), Nominatim import, and Photon (`-Xmx4g`) each want headroom. |
| **Linux host with `vm.max_map_count ≥ 262144`** | Photon's embedded OpenSearch refuses to start below this. |
| **A clone of this repo, run from its root** | The pipeline bind-mounts `./data` by **host** path via `HOST_DATA_DIR=${PWD}/data`, so `$PWD` must be the project dir. |

### 2. One-time host prep

```bash
# Photon's OpenSearch needs a high mmap limit (Linux):
sudo sysctl -w vm.max_map_count=262144
echo 'vm.max_map_count=262144' | sudo tee /etc/sysctl.d/99-opensearch.conf   # persist across reboots

# The Photon jar (96 MB) is gitignored — fetch it once before the first `up`:
curl -L -o photon/photon-1.1.0.jar \
  https://github.com/komoot/photon/releases/download/1.1.0/photon-1.1.0.jar
```

### 3. Launch

```bash
cd /path/to/openkarta.et/basic         # MUST run from the project root
docker compose up -d                   # start everything (detached)
docker compose ps                      # see the 7 services
docker compose logs -f data-pipeline   # follow the first build
```

### 4. What happens on first boot

The build is **one-time and sequential**; later boots reuse the volumes.

1. **Ingest** — `data-pipeline` downloads `ethiopia-latest.osm.pbf` from Geofabrik (conditional `curl -z`, so re-runs are free).
2. **Planetiler** (~minutes) — builds `ethiopia-latest.mbtiles`, then writes the `.tiles_ready` sentinel → **Martin** starts serving.
3. **OSRM** (~minutes) — extract → partition → customize (car/MLD), writes `.osrm_ready` → **OSRM** starts serving.
4. **Nominatim** (slowest — tens of minutes) — imports the PBF into PostgreSQL.
5. **Photon** — once Nominatim is up, imports an Ethiopia-only type-ahead index from it (~seconds), persisted in the `photon-index` volume.

The tile and routing servers **wait** on the sentinels instead of crash-looping, so an empty `./data` on first `up` is handled gracefully. Open <http://localhost:8000> any time — basemap tiles light up first, routing/search follow as their builds finish.

### 5. Verify each service

```bash
curl -s  http://localhost:8000/                  | head -c 80                     # app HTML
curl -s  http://localhost:8000/martin/ethiopia-latest | head -c 120               # Martin TileJSON
curl -s "http://localhost:8000/osrm/route/v1/driving/38.74,9.03;38.76,8.54?overview=false"
curl -s "http://localhost:8000/nominatim/search?q=lalibela&format=jsonv2&limit=1" # Nominatim
curl -s "http://localhost:8000/photon/api?q=bahir&limit=1"                        # Photon
curl -s -X POST http://localhost:8000/vroom/ -H 'Content-Type: application/json' \
  -d '{"vehicles":[{"id":1,"start":[38.74,9.03]}],"jobs":[{"id":1,"location":[38.80,9.01]},{"id":2,"location":[38.76,8.99]}]}'  # VROOM
```

### 6. Day-2 operations

```bash
docker compose logs -f <service>        # tail logs (data-pipeline, geocoder, photon, …)
docker compose restart web-showcase     # reload after editing web/ or proxy/web.conf
docker compose down                      # stop (keeps data + DB volumes)
docker compose down -v                   # stop AND wipe volumes (next up re-imports everything)
docker volume rm open-karta_photon-index # rebuild only the Photon autocomplete index
```

Data auto-refreshes every `INTERVAL` seconds (default `86400` = 24h).

### 7. Troubleshooting

| Symptom | Fix |
|---|---|
| `ok_photon` restart-loops / "max virtual memory areas too low" | Host `vm.max_map_count` too low — see step 2. |
| Photon exits "import FAILED" | Nominatim isn't finished importing yet; Photon retries automatically. Watch `docker compose logs -f geocoder`. |
| Map loads but **tiles are blank** | Ensure you're hitting the app at `:8000` (tiles are proxied same-origin & uncompressed via `/tiles/`). Direct `:3000` gzipped MVT can trip a MapLibre worker bug in some Chromium builds. |
| `/route` returns `NoRoute` / errors | OSRM graph still building — wait for `.osrm_ready` (`docker compose logs -f routing-engine`). |
| Search box empty / no suggestions | Photon index still building, or `:2322` unreachable — verify with the curl in step 5. |
| Port `:8000` already in use | It's the only published port — stop the conflicting process or remap it in `docker-compose.yml`. |
| A backend endpoint 404s right after editing `proxy/web.conf` | nginx single-file bind-mounts pin the inode; **recreate** (not just restart) the gateway: `docker compose up -d --force-recreate web-showcase`. |
| Pipeline can't bind-mount `./data` | You didn't run `docker compose` from the project root — `$PWD` must resolve to it. |

## What the showcase does

- **Basemaps** — a **top-right toggle** between **Streets** and **Satellite**.
  Streets is OSM-Bright rewired to our Martin vector tiles; **Satellite** is a
  *hybrid* built from it (same roads + labels, recolored for imagery) layered over
  **ESRI World Imagery**, so both share our self-hosted tiles, glyphs and sprite.
  Switching preserves an active route.
- **Language (full localization)** — a **top-right toggle** (Default / English /
  አማርኛ) re-labels the map (`name:en` / `name:am` OpenMapTiles fields) **and**
  localizes the whole **overlay UI and the turn-by-turn directions** into Amharic
  (natural, polite እርስዎ phrasing). A self-hosted **Noto Sans Ethiopic** webfont
  renders the Amharic UI; map glyphs cover Latin, Ethiopic and Arabic ranges. The
  choice persists in the URL (`?lang=`) and biases Photon search.
- **Map controls** — standard MapLibre controls: **NavigationControl** (zoom +
  compass + pitch visualization), **GeolocateControl** (high-accuracy, tracks
  the user — needs https or localhost), and **FullscreenControl**, all top-right.
- **Multi-stop trip planner** — one guided flow with an ordered list of stops
  (origin → optional waypoints → destination). Every field is a **type-ahead
  search** backed by Photon (so "Ayer Ten" → "Ayer Tena"; ≥2 chars, 5 live
  suggestions biased to the view, ↑/↓ + Enter). Fill any stop three ways —
  **search**, **click the map** (focusing a field "arms" it), or **⊙ my
  location** (geolocation). **Add stop** inserts a waypoint; each waypoint has a
  remove (✕). **Drag any pin** on the map to move that stop and it re-routes
  live. **Swap** reverses the whole route, and Clear resets it. With every stop
  set it auto-routes via OSRM (multi-leg), showing distance, drive-time and a
  collapsible **turn-by-turn** list (icons + connector rail). The full stop list
  is shareable in the URL (`?route=lng,lat;lng,lat;…`).
- **Shareable URLs** — the whole app state lives in the URL: camera
  (zoom/lat/lng) in the `#hash` (MapLibre's built-in hash), and `base`, `lang`,
  `place` (+`plabel`) and `route` (origin;destination) as query params. Copy the
  link to reproduce the exact view, basemap, label language, dropped pin and
  computed route. Example: `?base=satellite&lang=am&route=38.7,9.0;37.4,11.6#8/10.3/37.8`
- **Collapsible panel** — the overlay collapses to a compact brand bar to free the map.
- **Fully self-hosted assets** — MapLibre GL JS/CSS, UI fonts, map glyphs
  (Noto Sans, incl. Amharic/Ethiopic ranges), and sprites are all served from
  this origin. The browser makes **no external asset requests**; the only
  off-host traffic is ESRI imagery (when the Satellite basemap is selected).
  Tiles are proxied **same-origin and uncompressed** via nginx `/tiles/` — Martin
  serves gzipped MVT and MapLibre's worker mishandles gzip in some Chromium
  builds, so stripping `Accept-Encoding` upstream avoids blank tiles.

## Notable deviations from a naïve reading of the spec

These were required to make the stack actually run out of the box:

1. **Vector-only (no MapProxy).** MapProxy cannot consume vector (MVT/PBF) tiles
   and rasterize them — it only proxies *raster* sources. Rather than bolt on a
   renderer, the web app renders Martin's vector tiles client-side with a
   hand-tuned OpenMapTiles style, so `mapproxy.yaml` / the raster proxy are
   intentionally omitted.
2. **Sibling-container host paths.** A container using the host Docker socket
   has bind-mount sources resolved on the *host*, so `$(pwd)/data` from inside
   the pipeline would point nowhere. The pipeline uses `HOST_DATA_DIR=${PWD}/data`
   (set by Compose) for every `docker run -v …` it issues.
3. **Single same-origin gateway.** Every backend is reverse-proxied through the
   `:8000` nginx (`/tiles/ /martin/ /osrm/ /photon/ /nominatim/`) and is **not**
   published to the host. Because the app is same-origin, no CORS shim is needed;
   each proxied location still strips any upstream `Access-Control-Allow-Origin`
   and adds a single `*` (so the endpoints stay usable cross-origin without the
   duplicate-`*, *` value browsers reject). Nominatim imports the shared PBF via
   `PBF_PATH`; its PostgreSQL volume mounts at `/var/lib/postgresql` (version-agnostic).
4. **Graceful empty state.** Martin and OSRM block on `.tiles_ready` /
   `.osrm_ready` sentinels written by the pipeline, instead of restart-looping
   on an empty `./data`.

## Layout

```
.
├── docker-compose.yml          # orchestration (7 services, karta-network)
├── pipeline/run.sh             # ingest → Planetiler → OSRM → hot reload
├── photon/run.sh               # Photon: import index from Nominatim DB, then serve :2322
├── vroom/config.yml            # VROOM optimiser → OSRM driver (ok_routing_engine:5000)
├── proxy/
│   └── web.conf                # gateway: static app + /docs + reverse proxy to every backend
├── docs/                       # docsify API reference (every endpoint) — served at :8000/docs
├── web/
│   ├── index.html              # MapLibre GL showcase (single file)
│   ├── styles/                 # Bright + Satellite-Hybrid (built from Bright, → our /tiles/)
│   ├── vendor/                 # self-hosted maplibre-gl (js + css); search uses Photon directly
│   ├── fonts/                  # self-hosted map glyphs (Noto Sans, incl. Ethiopic)
│   ├── fonts-ui/               # self-hosted UI webfonts (Fraunces/Archivo/JetBrains Mono)
│   ├── sprites/                # self-hosted style sprites
│   └── logos/                  # brand logos (light/dark) — drive the UI palette
└── data/                       # shared volume (PBF, mbtiles, osrm graph) — gitignored
```

## Operating notes

- **Resources:** Planetiler RAM is tunable via `PLANETILER_XMX` (default `4g`).
  Nominatim import is CPU/IO heavy and uses `shm_size: 1gb`.
- **Photon (autocomplete):** on first start it builds an embedded-OpenSearch
  index from the Nominatim DB for Ethiopia only (`-country-codes et`,
  `-languages en,am`) — ~50k docs in seconds — persisted in the `photon-index`
  volume. Heap via `JAVA_TOOL_OPTIONS=-Xmx4g`; needs host `vm.max_map_count ≥ 262144`.
  Re-run the import by removing the volume: `docker compose down && docker volume rm open-karta_photon-index`.
  The Photon jar is gitignored (96 MB); on a fresh clone fetch it once before `up`:
  `curl -L -o photon/photon-1.1.0.jar https://github.com/komoot/photon/releases/download/1.1.0/photon-1.1.0.jar`
- **Refresh cadence:** `INTERVAL` (default `86400`s). Re-downloads are
  time-conditional (`curl -z`), so unchanged upstream data costs no bandwidth.
- **Reset everything:** `docker compose down -v` (the `-v` also drops the
  Nominatim DB volume; the next `up` re-imports).
- **Production:** consider pinning `osrm/osrm-backend` and `planetiler` to fixed
  versions (currently `:latest` per the brief) for reproducible builds.
