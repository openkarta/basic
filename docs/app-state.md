# Shareable URL state

The showcase app (`http://localhost:8000`) keeps its entire state in the URL, so
any view is a copyable link. This isn't a backend endpoint — it's how the
frontend encodes state.

| Part | Where | Example | Meaning |
|---|---|---|---|
| Camera | `#hash` | `#9.94/8.78/38.87` | MapLibre's built-in `zoom/lat/lng`. |
| `base` | query | `?base=satellite` | Basemap: `street` (default) or `satellite`. |
| `lang` | query | `?lang=am` | Map + UI language: `default` · `en` · `am`. |
| `route` | query | `?route=38.74,9.03;38.95,8.85;39.27,8.54` | Ordered trip stops, `lon,lat` separated by `;` (2+ = origin…waypoints…destination). Restores the markers and recomputes the route. |

**Use case:** share a planned multi-stop trip, on the satellite basemap with
Amharic labels, framed exactly where you left it:

```
http://localhost:8000/?base=satellite&lang=am&route=38.74,9.03;38.95,8.85;39.27,8.54#9/8.8/38.9
```

The `route` coordinate order matches OSRM's [`/osrm/route`](routing.md) — drop
the same `;`-joined `lon,lat` list straight into a routing request.
