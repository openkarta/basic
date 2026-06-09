# The gateway (`:8000`)

The **web-showcase** nginx is the single public entry point. It serves the
static MapLibre app and reverse-proxies every backend so the browser only ever
talks to one origin. The backend containers expose their ports **inside** the
Docker network only — nothing but `:8000` is published to the host (these docs
are served by the same gateway at `/docs`).

## Path map

| Public path (`:8000`) | Proxied to (internal) | Engine |
|---|---|---|
| `/` | static files (`index.html`, `styles/`, `vendor/`, `fonts/`, …) | — |
| `/tiles/{z}/{x}/{y}` | `ok_tile_server:3000/ethiopia-latest/{z}/{x}/{y}` | Martin |
| `/osrm/…` | `ok_routing_engine:5000/…` | OSRM |
| `/photon/…` | `ok_photon:2322/…` | Photon |
| `/nominatim/…` | `ok_geocoder:8080/…` | Nominatim |
| `/vroom/` (POST) | `ok_vroom:3000/` | VROOM |

## Why a single gateway?

- **One origin, zero CORS friction.** The app makes only same-origin requests.
  Each proxied location still strips any upstream `Access-Control-Allow-Origin`
  and adds a single `*`, so the endpoints stay usable from other origins without
  duplicate-header errors.
- **Uncompressed tiles.** Martin serves gzip-encoded MVT, which MapLibre's web
  worker mishandles in some Chromium builds (blank map). The `/tiles/` location
  strips `Accept-Encoding` upstream so Martin returns identity (plain PBF).
- **Smaller attack surface.** Routing/search/tiles aren't exposed on the host;
  they're only reachable through the proxy.

## Notes

- All methods are `GET`.
- A backend that is still building (first boot) returns `502`/`503` through the
  proxy until its data is ready — the app surfaces this as a friendly message.
- The proxy uses fixed container names (`ok_tile_server`, `ok_routing_engine`,
  `ok_photon`, `ok_geocoder`) resolved by Docker's embedded DNS.
