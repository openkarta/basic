# Geocoding · Nominatim

[Nominatim](https://nominatim.org/) is the full OpenStreetMap geocoder — forward
and reverse geocoding, OSM-id lookup, place details and status. It is the data
source Photon's autocomplete index is built from. Exposed under
**`/nominatim/`**. Data is the **Ethiopia** extract only.

> **Full documentation:** <https://nominatim.org/release-docs/latest/api/Overview/>

Coordinates here use named **`lat`/`lon`** params. `format=jsonv2` is a good
default.

---

## `GET /nominatim/search` — forward geocoding

Find places by free-form text **or** structured fields.

| Param | Type | Description |
|---|---|---|
| `q` | string | Free-form query (mutually exclusive with structured params). |
| `street`,`city`,`county`,`state`,`country`,`postalcode` | string | Structured query. |
| `format` | `jsonv2`·`json`·`geojson`·`geocodejson`·`xml` | Response format. |
| `limit` | int | Max results (default 10). |
| `addressdetails` | `0`·`1` | Break the result into address parts. |
| `extratags`,`namedetails` | `0`·`1` | Extra OSM tags / all name variants. |
| `countrycodes` | e.g. `et` | Restrict to countries. |
| `viewbox`,`bounded` | bbox, `0`·`1` | Prefer / restrict to a bounding box. |
| `polygon_geojson` | `0`·`1` | Return the place's polygon. |
| `dedupe`,`layer`,`featureType` | — | De-dupe / filter result classes. |
| `accept-language` | `en`,`am`,… | Preferred result language. |

**Use case:** a "search this address" box that resolves "Bole, Addis Ababa" to a
point with a structured address.

```bash
curl -s "http://localhost:8000/nominatim/search?q=lalibela&format=jsonv2&addressdetails=1&limit=3"
```

---

## `GET /nominatim/reverse` — reverse geocoding

Address for a coordinate.

| Param | Type | Description |
|---|---|---|
| `lat`, `lon` | float **(required)** | The point. |
| `format` | `jsonv2`·`geojson`·`xml`·… | Response format. |
| `zoom` | `0`–`18` | Address granularity (18 = building). |
| `addressdetails`,`extratags`,`namedetails` | `0`·`1` | Detail toggles. |
| `polygon_geojson` | `0`·`1` | Include the matched polygon. |
| `accept-language` | `en`,`am` | Result language. |

**Use case:** "what's here?" — turn a clicked map coordinate into a full
postal-style address.

```bash
curl -s "http://localhost:8000/nominatim/reverse?lat=9.0307&lon=38.7469&format=jsonv2&zoom=16"
```

---

## `GET /nominatim/lookup` — look up OSM objects

Addresses for known OSM ids.

| Param | Type | Description |
|---|---|---|
| `osm_ids` | `N…,W…,R…` **(required)** | Comma-separated, prefixed Node/Way/Relation ids. |
| `format`,`addressdetails`,`extratags`,`namedetails` | — | As `search`. |

**Use case:** you already have OSM ids (e.g. from a vector tile feature) and want
their human addresses.

```bash
curl -s "http://localhost:8000/nominatim/lookup?osm_ids=R8060085&format=jsonv2"
```

---

## `GET /nominatim/details` — full place detail

Everything Nominatim knows about one place: address hierarchy, keywords, linked
places, child geometries.

| Param | Type | Description |
|---|---|---|
| `osmtype`+`osmid` | `N`·`W`·`R` + id | Identify the place (or use `place_id`). |
| `format` | `json` | Response format. |
| `addressdetails`,`keywords`,`linkedplaces`,`hierarchy`,`group_hierarchy`,`polygon_geojson` | `0`·`1` | Detail toggles. |
| `accept-language` | `en`,`am` | Result language. |

**Use case:** an admin/debug view that inspects how a place is classified and
what it contains.

```bash
curl -s "http://localhost:8000/nominatim/details?osmtype=R&osmid=8060085&format=json&addressdetails=1"
```

---

## `GET /nominatim/status` — service status

Whether the DB is up and how fresh the data is.

| Param | Type | Description |
|---|---|---|
| `format` | `text`·`json` | `text` → `OK`; `json` → status object. |

**Use case:** monitoring / readiness checks; `data_updated` tells you the import
timestamp.

```bash
curl -s "http://localhost:8000/nominatim/status?format=json"
# {"status":0,"message":"OK","data_updated":"…"}
```

> Nominatim also exposes debug endpoints (`/deletable`, `/polygons`) — see the
> [official docs](https://nominatim.org/release-docs/latest/api/Overview/). On
> first boot the PBF import takes tens of minutes; queries return empty until
> it completes.

---

## Equivalent in commercial map APIs

| Capability | Google Maps Platform | Azure Maps | Mapbox |
|---|---|---|---|
| Forward geocode (`/search`) | **Geocoding API** | **Search – Get Geocoding** | **Geocoding API** (forward) |
| Reverse geocode (`/reverse`) | Geocoding API (reverse) | **Search – Get Reverse Geocoding** | Geocoding API (reverse) |
| Lookup / details (`/lookup`, `/details`) | **Place Details API** | — | — |
| Type-ahead / prefix | Places API – Autocomplete | Search – Fuzzy Search (`typeahead`) | Search Box API |

*Rough equivalents — for the type-ahead box this stack uses [Photon](autocomplete.md).*
