# Optimization · VROOM

[VROOM](https://github.com/VROOM-Project/vroom) solves **vehicle-routing
problems** (VRP): given vehicles and a set of jobs/shipments, it returns the
optimal visiting order, per-vehicle routes, timings and (optionally) geometry.
It is wired to the **OSRM driver** pointed at our [routing engine](routing.md)
(profile `car`) for the cost matrix. Exposed under **`/vroom/`**.

> **Full documentation:** the VROOM API spec is at
> <https://github.com/VROOM-Project/vroom/blob/master/docs/API.md> (server
> wrapper: <https://github.com/VROOM-Project/vroom-express>).

---

## `POST /vroom/` — solve a routing problem

Send a JSON problem; get an optimized solution. **All coordinates are
`[lon, lat]`** (GeoJSON order).

| Field | Description |
|---|---|
| `vehicles` *(required)* | Array of `{ id, start?, end?, capacity?, skills?, time_window?, breaks? }`. `start`/`end` are `[lon,lat]`. |
| `jobs` | Array of `{ id, location:[lon,lat], service?, delivery?, pickup?, skills?, priority?, time_windows? }`. |
| `shipments` | Array of `{ pickup:{…}, delivery:{…}, amount?, skills? }` for pickup→delivery pairs. |
| `options` | e.g. `{ "g": true }` to return route geometry (this stack enables it by default). |

**Use case:** a courier in Addis Ababa with one vehicle and several drop-offs —
get the **optimal stop order**, total drive time, and the route geometry to draw
on the map.

```bash
curl -s -X POST http://localhost:8000/vroom/ \
  -H 'Content-Type: application/json' \
  -d '{
    "vehicles": [{ "id": 1, "start": [38.74, 9.03], "end": [38.74, 9.03] }],
    "jobs": [
      { "id": 1, "location": [38.80, 9.01] },
      { "id": 2, "location": [38.76, 8.99] },
      { "id": 3, "location": [38.71, 9.05] }
    ]
  }'
```

**Response** (trimmed):

```json
{
  "code": 0,
  "summary": { "cost": 2426, "routes": 1, "unassigned": 0, "duration": 2426 },
  "routes": [{
    "vehicle": 1,
    "steps": [
      { "type": "start", "location": [38.74, 9.03] },
      { "type": "job", "id": 3, "arrival": 712 },
      { "type": "job", "id": 1, "arrival": 1503 },
      { "type": "job", "id": 2, "arrival": 2010 },
      { "type": "end",  "location": [38.74, 9.03] }
    ],
    "geometry": "…encoded polyline…"
  }],
  "unassigned": []
}
```

- `code: 0` means success; `summary.duration` is total seconds.
- `routes[].steps[]` give the **optimized order** (the `job` ids in sequence).
- `routes[].geometry` is present because geometry is enabled.

**Limits (this instance):** up to **1000** job/shipment locations and **200**
vehicles per request (OSRM's table size is raised to 10000 to match).

---

## `GET /vroom/health`

Liveness of the VROOM server.

**Use case:** readiness/health monitoring.

```bash
curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:8000/vroom/health"
```

> `POST /vroom` (no trailing slash) `308`-redirects to `/vroom/`, preserving the
> method and body. The gateway answers the CORS `OPTIONS` preflight for
> `/vroom/`, so cross-origin browser calls work too. VROOM needs OSRM's `table`
> service to be up; on first boot it won't solve until the routing graph is
> ready.

---

## Equivalent in commercial map APIs

| Capability | Google Maps Platform | Azure Maps | Mapbox |
|---|---|---|---|
| Fleet / vehicle-routing optimization (`/vroom/`) | **Route Optimization API** (formerly Cloud Fleet Routing) | — *no native VRP*; limited waypoint reorder via Route Directions `computeBestOrder` | **Optimization API** (v1 / v2) |

*Rough equivalents — Google's Route Optimization and Mapbox's Optimization API
are the closest full VRP solvers; Azure Maps only reorders waypoints within a
single route.*
