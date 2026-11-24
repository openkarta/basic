# Junction-based directions

Street names are rarely used on the ground in Ethiopia — people navigate by
**junction**: *"from Ayer Tena, through Zenebework, then Total"*. The trip
planner therefore narrates every route by the named junctions it runs through
instead of by street:

| Streets (classic turn-by-turn) | Junctions (default) |
|---|---|
| Enter the roundabout, exit 2 onto Smuts Av | At **Tor Hailoch**, take the 2nd exit toward **Coca** |
| Exit roundabout slight right on Uganda Street | Continue through **Molla Maru** |
| Turn right onto General Wingate Street | Arrive at your destination, near **Piassa** |

The **route itself is unchanged**. OSRM already routes over a graph of
intersections; only its *instructions* are street-based. This is a naming layer
on top of the same [`/osrm/route`](routing.md) response — no graph rebuild, no
new service. A **Junctions / Streets** switch above the list flips between the
two (persisted as [`?dir=streets`](app-state.md)).

---

## Where the names come from

In priority order:

1. **Your own names** — `web/junctions.geojson` (see below). Always win.
2. **The junction's own name in OSM** — `junction=yes` + `name`, `place=square`,
   and named roundabouts (OSRM's `rotary_name`).
3. **Whatever stands at the junction** — the nearest of: `place=suburb` /
   `neighbourhood` / `quarter` / `town` / `village` / `hamlet`, minibus
   terminals (`amenity=taxi`, `amenity=bus_station`) and bus stops
   (`highway=bus_stop`).

Sources 2 and 3 are read live from the stack's own Photon, so they follow the
OSM data with no extra build step. After a route is computed the app asks
Photon what is named along it — one lookup roughly every 600 m (at most ~30 per
route, wider and sparser on long intercity routes):

```bash
curl -s "http://localhost:8000/photon/reverse?lon=38.7331&lat=9.0200&radius=0.6&limit=50&lang=en\
&osm_tag=place&osm_tag=junction&osm_tag=amenity:taxi&osm_tag=amenity:bus_station&osm_tag=highway:bus_stop"
```

A feature names an intersection when it lies within its reach of it:

| Feature | Reach | Named when |
|---|---|---|
| `web/junctions.geojson` entry | `radius`, default 100 m | turning or passing |
| `junction=yes` | 80 m | turning or passing |
| `place=square` | 120 m | turning or passing |
| `place=suburb` · `neighbourhood` · `quarter` | 150 m | turning or passing |
| `place=town` / `village` / `hamlet` | 500 / 300 / 200 m | turning or passing |
| `amenity=taxi` · `bus_station` | 90 m | turning or passing |
| `highway=bus_stop` | 70 m | turning and arrival only (too many to list in passing) |

Names are tidied on the way in: `Tor Hailoch (Mini Bus Station)` → **Tor
Hailoch**; taxi-line descriptions such as `Piassa to Megenagna` are ignored;
bilingual names (`ጎማ ተራ / Goma Tera`) show the half matching the UI language;
and spelling variants of one place (`Zenebework` / `Zenbwork`, `Abnet Square` /
`Abinet`) are treated as the same junction.

> Hover a junction name in the list to see where it came from
> (e.g. `OSM place=suburb · 14 m`) — useful when deciding what to curate.

---

## Naming junctions yourself

`web/junctions.geojson` is a plain GeoJSON `FeatureCollection` of points. Add
one feature per junction; it overrides anything OSM says there, and the name
becomes searchable in every stop field (so *"Ayer Tena → Zenebework → Total"*
can be typed as three stops).

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [38.71692, 8.99269] },
      "properties": { "name": "Total", "name:am": "ቶታል", "radius": 120 }
    }
  ]
}
```

| Property | Required | Meaning |
|---|---|---|
| `name` | yes | Shown when no language-specific name matches. |
| `name:en` / `name:am` | no | Shown for the English / Amharic UI. |
| `alt_name` | no | Extra spelling matched by search only. |
| `radius` | no | Reach in metres (default `100`). Use ~120–150 for a large roundabout or square. |

Place the point at the centre of the junction (`lon, lat` order). The file is
served straight from `web/`, so an edit is live on the next page load — no
restart. An empty or missing file simply means "no curated names".

**Better still, put the name in OpenStreetMap** (`junction=yes` + `name`,
`name:am` on the junction node): it then reaches this view *and* search, the
map labels and every other OSM user after the next data refresh.

---

## Limits

- **Flyovers.** Matching is by distance, so a road passing *over* a junction
  without connecting to it can be listed as passing through it.
- **Back streets.** Turns that are not at a named junction stay plain
  ("Turn left · 160 m"); OSRM's fastest path sometimes prefers such streets.
- **Long routes.** The lookups are capped, so intercity routes name towns and
  major junctions rather than every neighbourhood.
- **Language.** A name is shown in the UI language only where OSM has
  `name:en` / `name:am` for it; roundabout names from the routing graph are in
  OSM's default `name`.
