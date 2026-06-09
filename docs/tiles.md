# Vector tiles · Martin

[Martin](https://maplibre.org/martin/) serves the OpenMapTiles-schema vector
tiles that Planetiler built from the Ethiopia OSM extract. The app uses the
uncompressed **`/tiles/`** path; Martin's full management API is exposed under
**`/martin/`**.

> **Full documentation:** <https://maplibre.org/martin/>

---

## `GET /tiles/{z}/{x}/{y}`

A single Mapbox Vector Tile (MVT / PBF) in the XYZ scheme — served
**uncompressed** and same-origin (the form the MapLibre app consumes).

| Param | Type | Description |
|---|---|---|
| `z` | int | Zoom (`0`–`14`; over-zoom past 14 is client-side). |
| `x` | int | Tile column. |
| `y` | int | Tile row (origin top-left). |

**Use case:** render the interactive basemap in a MapLibre/Mapbox GL style.

```bash
curl -s "http://localhost:8000/tiles/9/311/243" -o tile.pbf -w '%{http_code} %{size_download}B\n'
```

```json
"sources": {
  "openmaptiles": {
    "type": "vector",
    "tiles": ["http://localhost:8000/tiles/{z}/{x}/{y}"],
    "minzoom": 0, "maxzoom": 14
  }
}
```

---

## `GET /martin/catalog`

Lists every tile source Martin is serving, with metadata.

**Use case:** discover the source ID and its layers programmatically instead of
hardcoding them.

```bash
curl -s "http://localhost:8000/martin/catalog"
```

---

## `GET /martin/{source}` — TileJSON

TileJSON 3.0.0 for a source (here the source is **`ethiopia-latest`**): the tile
URL template, `bounds`, `minzoom`/`maxzoom` and the `vector_layers`.

**Use case:** point a map client at the source so it auto-discovers zoom range
and the tile template.

```bash
curl -s "http://localhost:8000/martin/ethiopia-latest"
```

---

## `GET /martin/{source}/{z}/{x}/{y}` — raw tile

The same vector tile as `/tiles/…` but straight from Martin (gzip-encoded, no
same-origin Accept-Encoding rewrite).

**Use case:** fetch tiles for a non-browser consumer (a tiler, a cache warmer)
that handles gzip itself.

```bash
curl -s --compressed "http://localhost:8000/martin/ethiopia-latest/9/311/243" -o tile.pbf
```

---

## `GET /martin/health`

Liveness probe — `200 OK` once Martin has loaded the mbtiles.

**Use case:** readiness/health monitoring.

```bash
curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:8000/martin/health"
```

---

## Layers (OpenMapTiles schema)

Each tile carries the standard OpenMapTiles layers: `water`, `waterway`,
`landcover`, `landuse`, `park`, `boundary`, `transportation`,
`transportation_name`, `building`, `water_name`, `place`, `housenumber`, `poi`,
`aerodrome_label`. Names are bilingual — `name`, `name:en`, `name:am`,
`name:latin` — which powers the app's English/Amharic label switch.

Attribution: © OpenMapTiles © OpenStreetMap contributors. Tiles are served
identity-encoded on `/tiles/` on purpose — see [the gateway](gateway.md).

---

## Equivalent in commercial map APIs

| Capability | Google Maps Platform | Azure Maps | Mapbox |
|---|---|---|---|
| Vector basemap tiles | **Map Tiles API** (Vector Tiles) | **Render – Get Map Tile** (vector tilesets) | **Vector Tiles API** (e.g. `mapbox.mapbox-streets-v8`) |

*Rough equivalents — tile schemas, layers and styling differ across providers.*
