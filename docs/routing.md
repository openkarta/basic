# Routing · OSRM

[OSRM](https://project-osrm.org/) computes driving routes, matrices, snapping,
map-matching and stop-ordering over the Ethiopia road graph (car profile, MLD
algorithm). Exposed through the gateway under **`/osrm/`**.

> **Full documentation:** <https://project-osrm.org/docs/v5.24.0/api/>

**Request shape:** `GET /osrm/{service}/v1/{profile}/{coordinates}?{options}`
where `profile` is **`driving`** and `coordinates` are `lon,lat` pairs separated
by `;` (GeoJSON order — longitude first).

---

## `route` — directions A → B (→ C …)

The fastest route through 2+ coordinates, with geometry and optional
turn-by-turn steps. **This is what the trip planner calls.**

| Option | Values | Description |
|---|---|---|
| `overview` | `full` · `simplified` · `false` | Detail of the returned geometry. |
| `geometries` | `geojson` · `polyline` · `polyline6` | Geometry encoding. |
| `steps` | `true` · `false` | Per-maneuver turn-by-turn instructions. |
| `alternatives` | `true` · `false` · *n* | Return alternative routes. |
| `annotations` | `true` · `nodes` · `distance` · `duration` · … | Per-segment metadata. |
| `continue_straight` | `default` · `true` · `false` | Force/allow U-turns at waypoints. |

**Use case:** "Directions from Addis Ababa to Adama, via Bishoftu, with
turn-by-turn." (Intermediate coordinates become waypoints.)

```bash
curl -s "http://localhost:8000/osrm/route/v1/driving/\
38.7469,9.0307;38.95,8.85;39.27,8.54?overview=full&geometries=geojson&steps=true"
```

Returns `routes[]` (each with `distance` m, `duration` s, `geometry`, and
`legs[].steps[].maneuver`).

---

## `nearest` — snap to the road network

Snaps a coordinate to the nearest road segment(s).

| Option | Values | Description |
|---|---|---|
| `number` | int (default `1`) | How many nearest matches to return. |

**Use case:** validate a user-dropped pin, or snap it to a routable point before
requesting a route.

```bash
curl -s "http://localhost:8000/osrm/nearest/v1/driving/38.74,9.03?number=1"
```

---

## `table` — duration / distance matrix

A matrix of travel times (and optionally distances) among many coordinates.

| Option | Values | Description |
|---|---|---|
| `sources` | `all` · indices | Which inputs are matrix rows. |
| `destinations` | `all` · indices | Which inputs are matrix columns. |
| `annotations` | `duration` · `distance` · `duration,distance` | What to compute. |

**Use case:** a delivery/dispatch app computing the cost matrix between a depot
and many drop-offs to feed a route optimizer.

```bash
curl -s "http://localhost:8000/osrm/table/v1/driving/\
38.74,9.03;38.80,9.01;38.76,8.99?annotations=duration,distance"
```

---

## `match` — map matching (snap a GPS trace)

Snaps a noisy sequence of GPS points to the most plausible path on the road
network.

| Option | Values | Description |
|---|---|---|
| `geometries`, `overview`, `steps`, `annotations` | as `route` | Output detail. |
| `timestamps` | `t1;t2;…` | UNIX timestamps per point. |
| `radiuses` | `r1;r2;…` | GPS accuracy per point (m). |
| `gaps` | `split` · `ignore` | How to treat large gaps. |
| `tidy` | `true` · `false` | Pre-clean the trace. |

**Use case:** clean up a recorded vehicle GPS track into road-aligned geometry
for display or mileage.

> The points must lie **along the road network** — a trace that can't be matched
> returns `400 { "code": "NoMatch" }`. The example below uses points sampled
> from a real route.

```bash
curl -s "http://localhost:8000/osrm/match/v1/driving/\
38.746912,9.030734;38.769205,9.039859;38.795034,9.042151?overview=simplified&geometries=geojson"
```

---

## `trip` — optimal stop ordering (TSP)

Solves the Traveling Salesman Problem for a set of stops (roundtrip by default).

| Option | Values | Description |
|---|---|---|
| `roundtrip` | `true` · `false` | Return to the start. |
| `source` | `any` · `first` | Fix the start. |
| `destination` | `any` · `last` | Fix the end. |
| `steps`, `geometries`, `overview` | as `route` | Output detail. |

**Use case:** a courier with 6 packages — order the stops to minimise total
drive time.

```bash
curl -s "http://localhost:8000/osrm/trip/v1/driving/\
38.74,9.03;38.80,9.05;38.76,8.99;38.71,9.02?roundtrip=true&source=first"
```

---

## `tile` — routing-graph debug tiles

`GET /osrm/tile/v1/driving/tile({x},{y},{z}).mvt` — an MVT of the routing graph
(edges, speeds) for the given tile. **OSRM only serves these at zoom ≥ 12.**

**Use case:** debugging — visualise the network and per-edge speeds over the
basemap.

```bash
curl -s "http://localhost:8000/osrm/tile/v1/driving/tile(2489,1980,12).mvt" -o graph.mvt
```

---

## General options (all services)

`bearings`, `radiuses`, `hints`, `generate_hints`, `skip_waypoints`,
`approaches`, `exclude`, `snapping`. See the
[OSRM API reference](https://project-osrm.org/docs/v5.24.0/api/#general-options).

> Only the **`driving`** (car) profile is built. Requests before the graph is
> ready (first boot) return an error until `.osrm_ready` is written.

---

## Equivalent in commercial map APIs

| OSRM service | Google Maps Platform | Azure Maps | Mapbox |
|---|---|---|---|
| `route` (directions) | **Directions API** / **Routes API** | **Route – Get Route Directions** | **Directions API** |
| `table` (matrix) | **Distance Matrix API** / Routes API (Compute Route Matrix) | **Route – Get/Post Route Matrix** | **Matrix API** |
| `match` (map matching) | **Roads API – Snap to Roads** | — | **Map Matching API** |
| `nearest` (snap point to road) | **Roads API – Nearest Roads** | — | — |
| `trip` (stop ordering / TSP) | Routes API (optimize waypoint order) | Route Directions (`computeBestOrder=true`) | **Optimization API** |

*Rough equivalents — parameters, limits and travel-mode coverage differ. For
full fleet optimisation see [VROOM](optimization.md).*
