# Autocomplete · Photon

[Photon](https://github.com/komoot/photon) is an OpenStreetMap geocoder built
for **type-ahead / prefix** search (it matches partial words — "Ayer Ten" →
"Ayer Tena" — which Nominatim can't). Its index is built from the Nominatim DB
for **Ethiopia only**, in **`en` and `am`**. Exposed under **`/photon/`**.

> **Full documentation:** <https://github.com/komoot/photon#search-api>

All responses are **GeoJSON** `FeatureCollection`s (coordinates in `lon,lat`).

---

## `GET /photon/api` — forward search

Prefix/fuzzy search as the user types. **This powers the trip planner's
search-in-field.**

| Param | Type | Description |
|---|---|---|
| `q` | string **(required)** | The (partial) query. |
| `limit` | int | Max results (default 15). |
| `lang` | `en` · `am` · `default` | Language of returned names. |
| `lat`, `lon` | float | Bias results toward this point (proximity). |
| `zoom` | int | Proximity zoom (how tight the bias is). |
| `location_bias_scale` | 0–1 | Strength of the proximity bias. |
| `bbox` | `minLon,minLat,maxLon,maxLat` | Restrict to a bounding box. |
| `osm_tag` | e.g. `place:city`, `!highway` | Include/exclude by OSM tag. |
| `layer` | `house`·`street`·`locality`·`district`·`city`·`county`·`state`·`country` | Restrict result types. |

**Use case:** an address box that shows 5 live suggestions, ranked near the map
centre, as the user types.

```bash
curl -s "http://localhost:8000/photon/api?q=bahir&limit=5&lang=en&lat=9.03&lon=38.74"
```

---

## `GET /photon/reverse` — reverse geocode

The nearest named place(s) to a coordinate.

| Param | Type | Description |
|---|---|---|
| `lon`, `lat` | float **(required)** | The point to reverse. |
| `lang` | `en` · `am` · `default` | Result language. |
| `radius` | float (km) | Search radius. |
| `limit` | int | Max results. |
| `layer` | as above | Restrict result types. |
| `query_string_filter` | string | Extra Lucene filter. |

**Use case:** label a long-pressed map point with the closest place name.

```bash
curl -s "http://localhost:8000/photon/reverse?lon=38.7469&lat=9.0307&lang=en"
```

---

## `GET /photon/status` — health

Readiness of the search node and the index import date.

**Use case:** a readiness probe — the app waits for this before enabling search.

```bash
curl -s "http://localhost:8000/photon/status"
# {"status":"Ok","import_date":"…"}
```

---

> This instance was imported with `-country-codes et -languages en,am`, so it
> only knows Ethiopia and answers in English/Amharic. On first boot it builds
> the index from Nominatim; search returns empty until that finishes.

---

## Equivalent in commercial map APIs

| Capability | Google Maps Platform | Azure Maps | Mapbox |
|---|---|---|---|
| Type-ahead place search (`/photon/api`) | **Places API – Autocomplete** | **Search – Fuzzy Search** (`typeahead=true`) | **Search Box API** (Suggest) |
| Reverse geocode (`/photon/reverse`) | Geocoding API (reverse) | Search – Get Reverse Geocoding | Geocoding API (reverse) |

*Rough equivalents — see [Geocoding · Nominatim](geocoding.md) for full
(non-prefix) geocoding.*
