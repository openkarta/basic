# Open Karta — API Reference

A self-hosted, open-source geospatial stack for **Ethiopia**: vector basemap
tiles, turn-by-turn routing, address search and type-ahead autocomplete — all
built from the daily [Geofabrik](https://download.geofabrik.de/africa/ethiopia.html)
OpenStreetMap extract.

Every backend is reachable through **one same-origin gateway** — the
web-showcase nginx on **`http://localhost:8000`**. The individual services
(Martin, OSRM, Photon, Nominatim) are **not** published to the host; you reach
them only through their proxied path prefixes.

| Capability | Engine | Base path | Page |
|---|---|---|---|
| Vector basemap tiles | **Martin** | `/tiles/` | [Vector tiles](tiles.md) |
| Driving routes & directions | **OSRM** | `/osrm/` | [Routing](routing.md) |
| Type-ahead / prefix search | **Photon** | `/photon/` | [Autocomplete](autocomplete.md) |
| Full address geocoding | **Nominatim** | `/nominatim/` | [Geocoding](geocoding.md) |
| Vehicle-routing optimization | **VROOM** | `/vroom/` | [Optimization](optimization.md) |

> All examples below assume the gateway at `http://localhost:8000`. These docs
> are served by the same gateway at `http://localhost:8000/docs`.

## Conventions

- **Method:** every endpoint here is `GET`.
- **CORS:** the gateway normalises CORS on every proxied path (a single
  `Access-Control-Allow-Origin: *`), so endpoints are usable cross-origin too.
- **Coordinates:** OSRM and Photon use **`lon,lat`** order (GeoJSON); Nominatim
  uses **`lat`/`lon`** named params. Watch the order.
- **Coverage:** data is the **Ethiopia** extract only. Queries outside Ethiopia
  return empty results.
- **Languages:** `en` and `am` (Amharic) are indexed for search.

## Quick smoke test

```bash
curl -s "http://localhost:8000/tiles/9/311/243" -o /dev/null -w 'tiles  %{http_code}\n'
curl -s "http://localhost:8000/osrm/route/v1/driving/38.74,9.03;38.76,8.54?overview=false" -o /dev/null -w 'osrm   %{http_code}\n'
curl -s "http://localhost:8000/photon/api?q=bahir&limit=1"          -o /dev/null -w 'photon %{http_code}\n'
curl -s "http://localhost:8000/nominatim/search?q=lalibela&limit=1" -o /dev/null -w 'nomi   %{http_code}\n'
curl -s -X POST "http://localhost:8000/vroom/" -H 'Content-Type: application/json' \
  -d '{"vehicles":[{"id":1,"start":[38.74,9.03]}],"jobs":[{"id":1,"location":[38.80,9.01]},{"id":2,"location":[38.76,8.99]}]}' \
  -o /dev/null -w 'vroom  %{http_code}\n'
```
