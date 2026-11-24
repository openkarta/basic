/* ======================================================================
   Open Karta — junction-based directions
   ----------------------------------------------------------------------
   Ethiopian directions are given by junction, not by street: "from Ayer
   Tena, through Zenebework, then Total". The router (OSRM) already works
   on a graph of intersections — only its *instructions* are street-based.
   This module re-reads an OSRM route as a list of named junctions:

     corridor(route)            where to look for names along the route
     fromPhoton(features, lang) names the stack already knows (OSM, via Photon)
     fromCustom(geojson, lang)  names you curate yourself (web/junctions.geojson)
     searchCustom(geojson, q)   …and finding those by name in the stop search box
     itinerary(route, entries)  the route as junction rows, ready to render

   Pure functions, no DOM and no network — index.html does the fetching and
   the wording. Loads as a plain <script> (window.OKJunctions) or in Node.
   ====================================================================== */
(function (root) {
  "use strict";

  /* ------------------------------ geometry ------------------------------- */
  const EARTH = 6371000, RAD = Math.PI / 180;
  // Metres between two [lng,lat] pairs (equirectangular — exact enough at junction scale).
  function dist(a, b) {
    const x = (b[0] - a[0]) * RAD * Math.cos((a[1] + b[1]) * 0.5 * RAD);
    const y = (b[1] - a[1]) * RAD;
    return Math.sqrt(x * x + y * y) * EARTH;
  }

  /* ----------------------------- what names what -------------------------- */
  /* r    — how far (m) from an intersection the feature may sit and still name it.
     rank — 0: curated, always wins · 1: the junction's own name · 2: borrowed from
            what stands next to it (the nearest one wins).
     q    — whose spelling to show when two features name the same junction (lower wins):
            a place name reads better than the bus stop named after it.
     turnsOnly — too numerous to list while driving past; only names a turn or the arrival. */
  const KINDS = {
    custom:   { r: 100, rank: 0, q: 0 },                    // web/junctions.geojson
    junction: { r: 80,  rank: 1, q: 1 },                    // junction=yes + name
    square:   { r: 120, rank: 1, q: 1 },                    // place=square
    area:     { r: 150, rank: 2, q: 2 },                    // place=suburb|neighbourhood|quarter
    town:     { r: 500, rank: 2, q: 2 },                    // place=town
    village:  { r: 300, rank: 2, q: 2 },                    // place=village
    hamlet:   { r: 200, rank: 2, q: 2 },                    // place=hamlet
    transit:  { r: 90,  rank: 2, q: 3 },                    // amenity=taxi|bus_station (minibus terminals)
    stop:     { r: 70,  rank: 2, q: 4, turnsOnly: true }    // highway=bus_stop
  };
  const PLACE_KIND = { square: "square", suburb: "area", neighbourhood: "area", quarter: "area",
                       town: "town", village: "village", hamlet: "hamlet" };
  function kindOf(key, value) {
    if (key === "junction") return "junction";
    if (key === "place") return PLACE_KIND[value] || null;
    if (key === "amenity" && (value === "taxi" || value === "bus_station")) return "transit";
    if (key === "highway" && value === "bus_stop") return "stop";
    return null;
  }
  // The Photon filter that returns exactly the features kindOf() understands.
  const PHOTON_TAGS = ["place", "junction", "amenity:taxi", "amenity:bus_station", "highway:bus_stop"];

  /* ------------------------------- names ---------------------------------- */
  const ETHIOPIC = /[ሀ-᎟ⶀ-⷟]/;
  const LATIN = /[A-Za-z]/;
  // OSM names here are often bilingual in one tag ("ጎማ ተራ / Goma Tera") — keep the
  // half that matches the UI language.
  function byScript(name, lang) {
    if (!ETHIOPIC.test(name) || !LATIN.test(name)) return name;
    const want = lang === "am" ? ETHIOPIC : LATIN, drop = lang === "am" ? LATIN : ETHIOPIC;
    const kept = name.split(/\s+/).filter((w) => want.test(w) || !drop.test(w)).join(" ");
    return kept.replace(/^[\s\/|·,\-–]+|[\s\/|·,\-–]+$/g, "") || name;
  }
  // Turn a raw OSM name into what people call the place; "" when it isn't a place name.
  function cleanName(raw, kind, lang) {
    let n = String(raw == null ? "" : raw).replace(/\s*\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
    n = byScript(n, lang);
    if (kind === "transit" || kind === "stop") {
      // "Piassa to Megenagna", "Bole and 4 kilo" describe taxi lines, not places.
      if (/(^|\s)(to|and|ወደ|እና)(\s|$)/i.test(n) || /[,&\/→↔]|\s-\s/.test(n)) return "";
      // "Zenbwork taxi terminal" / "ዘነበወርቅ ታክሲ ተራ" -> the place the stand is named after.
      // (A bare "ተራ" stays: it is part of market names such as "ጭድ ተራ".)
      n = n.replace(/(^|\s+)(long[- ]distance\s+)?(mini\s?bus|bus|taxi)\s+(station|stop|stand|terminal|rank)$/i, "")
           .replace(/(^|\s+)(አገር አቋራጭ\s+)?(ታክሲ|አውቶብስ|አውቶቡስ|ሚኒባስ)\s+(ተራ|ማቆሚያ|መቆሚያ|ጣቢያ)$/, "").trim();
    }
    n = n.replace(/\s+(አካባቢ|area)$/i, "").trim();                    // "ፒያሳ አካባቢ" = "Piassa area"
    return n.length < 2 || /^\d+$/.test(n) ? "" : n;                 // (a bare "taxi stop" is empty by now)
  }
  // Spelling-tolerant identity. Amharic names are romanised many ways ("Zenebework" /
  // "Zenbwork", "Ayer Tena" / "Ayertena", "Abnet Square" / "Abinet") — so two names are
  // the same junction when their consonant skeletons match.
  function keyOf(name) {
    const s = name.toLowerCase().replace(/\b(square|roundabout|adebabay)\b|አደባባይ/g, "")
                  .replace(/[^a-z0-9\u1200-\u139f\u2d80-\u2ddf]/g, "");
    if (!/[a-z]/.test(s)) return s || name.toLowerCase();
    return s[0] + s.slice(1).replace(/[aeiouy]/g, "").replace(/(.)\1+/g, "$1");
  }

  function entry(lng, lat, rawName, kind, lang, src, radius) {
    if (!KINDS[kind] || !isFinite(lng) || !isFinite(lat)) return null;
    const name = cleanName(rawName, kind, lang);
    if (!name) return null;
    return { lng, lat, name, key: keyOf(name), kind, rank: KINDS[kind].rank,
             r: radius > 0 ? radius : KINDS[kind].r, src };
  }

  /* Photon features -> entries. Photon localises `name` to the `lang` it was asked
     for (name:en / name:am) — but many features carry one script only. Pass the
     same features as fetched in the OTHER language (`others`) and such a name
     borrows the right script from a neighbour named after the same place: the
     taxi stand "Tor Hailoch" reads "ጦር ሃይሎች" in Amharic because the suburb
     beside it carries both spellings. */
  function fromPhoton(features, lang, others) {
    const script = lang === "am" ? ETHIOPIC : LATIN, otherLang = lang === "am" ? "en" : "am";
    const idOf = (p) => p.osm_type + "" + p.osm_id;
    const otherName = new Map();
    for (const f of others || []) { const p = f.properties || {}; if (p.name) otherName.set(idOf(p), p.name); }

    const out = [], seen = new Set(), alias = new Map();        // alias: other-language key -> name in `lang`
    for (const f of features || []) {
      const p = f.properties || {}, g = f.geometry || {};
      if (g.type !== "Point" || !g.coordinates) continue;
      const id = idOf(p), kind = kindOf(p.osm_key, p.osm_value);
      if (seen.has(id)) continue;
      seen.add(id);
      const e = entry(g.coordinates[0], g.coordinates[1], p.name, kind, lang, "OSM " + p.osm_key + "=" + p.osm_value);
      if (!e) continue;
      out.push(e);
      const twin = script.test(e.name) && otherName.has(id) ? cleanName(otherName.get(id), kind, otherLang) : "";
      if (twin && !script.test(twin)) {
        const k = keyOf(twin), had = alias.get(k);
        if (!had || KINDS[kind].q < had.q) alias.set(k, { name: e.name, q: KINDS[kind].q });
      }
    }
    for (const e of out) {
      const a = !script.test(e.name) && alias.get(e.key);
      if (a) { e.name = a.name; e.key = keyOf(a.name); }
    }
    return out;
  }

  /* Curated junctions (web/junctions.geojson): Point features with `name` and
     optionally `name:en`, `name:am`, `radius` (m). They outrank everything else. */
  function fromCustom(geojson, lang) {
    const out = [];
    for (const f of (geojson && geojson.features) || []) {
      const p = f.properties || {}, g = f.geometry || {};
      if (g.type !== "Point" || !g.coordinates) continue;
      const raw = (lang === "am" ? p["name:am"] : p["name:en"]) || p.name || p["name:en"] || p["name:am"];
      const e = entry(+g.coordinates[0], +g.coordinates[1], raw, "custom", lang, "junctions.geojson", +p.radius);
      if (e) out.push(e);
    }
    return out;
  }

  // Curated junctions whose name (in any language) contains `query` — for the stop search box.
  function searchCustom(geojson, query, lang) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return [];
    const hits = ((geojson && geojson.features) || []).filter((f) => {
      const p = f.properties || {};
      return [p.name, p["name:en"], p["name:am"], p.alt_name].some((n) => n && String(n).toLowerCase().includes(q));
    });
    return fromCustom({ features: hits }, lang);
  }

  /* --------------------------- spatial lookup ----------------------------- */
  const CELL = 0.01;                                   // ~1.1 km — wider than any (scaled) radius
  const cellOf = (v) => Math.floor(v / CELL);
  function buildIndex(entries) {
    const grid = new Map();
    for (const e of entries || []) {
      const k = cellOf(e.lng) + ":" + cellOf(e.lat);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(e);
    }
    return grid;
  }
  // The entry that names the intersection made of `points` — or null. Lower rank
  // wins; within a rank, the nearest. `scale` loosens every radius (used on arrival).
  function pick(grid, points, turn, scale) {
    let best = null;
    for (const pt of points) {
      const cx = cellOf(pt[0]), cy = cellOf(pt[1]);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const bucket = grid.get((cx + dx) + ":" + (cy + dy));
        if (!bucket) continue;
        for (const e of bucket) {
          if (KINDS[e.kind].turnsOnly && !turn) continue;
          const d = dist(pt, [e.lng, e.lat]);
          if (d > e.r * (scale || 1)) continue;
          if (!best || e.rank < best.e.rank || (e.rank === best.e.rank && d < best.d)) best = { e, d };
        }
      }
    }
    return best && { name: best.e.name, key: best.e.key, kind: best.e.kind, src: best.e.src,
                     d: Math.round(best.d), lng: best.e.lng, lat: best.e.lat, r: best.e.r };
  }

  /* ------------------------------ corridor -------------------------------- */
  /* Sample points along the route plus the search radius around each, sized so
     the discs overlap and every intersection on the route is covered. Capped at
     ~30 lookups: long intercity routes get wider, sparser discs. */
  function corridor(route) {
    const c = (route.geometry && route.geometry.coordinates) || [];
    if (c.length < 2) return { points: c.slice(0, 1), radiusKm: 0.5 };
    const spacing = Math.max(600, (route.distance || 0) / 30);
    const points = [c[0]];
    let need = spacing;
    for (let i = 1; i < c.length; i++) {
      let a = c[i - 1], seg = dist(a, c[i]);
      while (seg >= need && seg > 0) {
        const t = need / seg;
        a = [a[0] + (c[i][0] - a[0]) * t, a[1] + (c[i][1] - a[1]) * t];
        points.push(a);
        seg -= need; need = spacing;
      }
      need -= seg;
    }
    points.push(c[c.length - 1]);
    return { points, radiusKm: +((spacing / 2 + 300) / 1000).toFixed(2) };
  }

  /* ------------------------------ itinerary ------------------------------- */
  const RING = { roundabout: 1, rotary: 1 };                     // step that drives the ring itself
  const RING_EXIT = { "exit roundabout": 1, "exit rotary": 1 };   // folded into the ring row
  // Steps that announce nothing a driver acts on once street names are dropped.
  function isSilent(m) {
    return m.type === "new name" || m.type === "notification" ||
           (m.type === "continue" && (!m.modifier || m.modifier === "straight"));
  }

  /* ----------------------- roundabouts by direction ------------------------ */
  /* "Take the 3rd exit" makes the driver count arms. People say which WAY to
     leave — left, right or straight — reading the roundabout as a plain
     crossroads (Waze does this for regular roundabouts; TomTom classes every
     roundabout exit as straight / left / right / back). The way is the angle
     between the road you arrive on and the road you leave on, measured a little
     back from the ring: at the ring itself both roads flare, which skews OSRM's
     own bearings by 30-40 degrees (its "3rd exit" is often simply straight on). */
  function bearing(a, b) {
    const x = (b[0] - a[0]) * RAD * Math.cos((a[1] + b[1]) * 0.5 * RAD), y = (b[1] - a[1]) * RAD;
    return (Math.atan2(x, y) / RAD + 360) % 360;
  }
  const turnOf = (deg) => (((deg % 360) + 540) % 360) - 180;      // -180..180, right is positive
  // The nearest of the four ways a crossroads offers.
  const wayOf = (t) => (Math.abs(t) <= 45 ? "straight" : Math.abs(t) >= 135 ? "back" : t > 0 ? "right" : "left");
  // Heading of `line` — which starts at the ring and leads away from it — taken
  // over 20-70 m so the flare at the ring does not count. null when too short to tell.
  function headingAway(line) {
    const cum = [0];
    for (let k = 1; k < line.length; k++) cum.push(cum[k - 1] + dist(line[k - 1], line[k]));
    const len = cum[cum.length - 1];
    if (!(len >= 8)) return null;
    const at = (d) => {
      let k = 1;
      while (k < line.length - 1 && cum[k] < d) k++;
      const t = cum[k] > cum[k - 1] ? Math.min(1, Math.max(0, (d - cum[k - 1]) / (cum[k] - cum[k - 1]))) : 0;
      return [line[k - 1][0] + (line[k][0] - line[k - 1][0]) * t, line[k - 1][1] + (line[k][1] - line[k - 1][1]) * t];
    };
    return bearing(at(len > 40 ? 20 : 0), at(Math.min(len, 70)));
  }
  /* How the ring step steps[i] leaves the roundabout:
       { dir: "straight" | "left" | "right" | "back", exit: OSRM's exit number,
         unclear: an exit passed earlier points the same way, so the word alone
                  would send the driver out too early, side: driving side }
     null when the route does not leave the ring (it ends on it). */
  function ringTurn(steps, i) {
    const st = steps[i], m = st.maneuver, out = steps[i + 1];
    if (!out || !out.maneuver || !RING_EXIT[out.maneuver.type]) return null;
    const line = (s) => (s && s.geometry && s.geometry.coordinates) || [];
    const back = headingAway(line(steps[i - 1]).slice().reverse());   // from the ring, back down the approach
    const away = headingAway(line(out));
    const hin = back == null ? m.bearing_before : (back + 180) % 360;
    const hout = away == null ? out.maneuver.bearing_after : away;
    if (!isFinite(hin) || !isFinite(hout)) return null;
    const dir = wayOf(turnOf(hout - hin));
    const left = st.driving_side === "left";
    const lean = left ? -15 : 15;                                // an exit's first metres still follow the ring
    let unclear = false;
    for (const x of st.intersections || []) {
      (x.bearings || []).forEach((b, k) => {                     // arms we drive past: not our way in, not the ring
        if (k === x.in || k === x.out || !(x.entry || [])[k]) return;
        if (wayOf(turnOf(b - hin + lean)) === dir) unclear = true;
      });
    }
    return { dir, exit: m.exit || null, unclear, side: left ? "left" : "right" };
  }

  /* An OSRM route (steps=true, geometries=geojson) -> ordered rows (`lang` only
     picks the script of a bilingual roundabout name):
       { type: "depart" | "maneuver" | "pass" | "arrive",
         maneuver,            OSRM StepManeuver (absent on "pass")
         turn,                roundabouts only: which way to leave it (see ringTurn)
         junction,            { name, alt, kind, src, d, lng, lat } or null when unnamed
         toward,              name of the next named junction, when worth saying
         at: [lng,lat], dist  metres to the next row (null on arrival) }             */
  function itinerary(route, entries, lang) {
    const grid = buildIndex(entries);
    const events = [];
    let s0 = 0;                                                  // metres travelled at the step's start
    for (const leg of route.legs || []) {
      const steps = leg.steps || [];
      for (let i = 0; i < steps.length; i++) {
        const st = steps[i], m = st.maneuver || {}, ix = st.intersections || [];
        const ring = !!RING[m.type], silent = isSilent(m) || !!RING_EXIT[m.type];

        if (!silent) {
          let junction = null, pts = [m.location];
          if (m.type === "arrive") {
            junction = pick(grid, pts, true, 2);                 // "near …": looser than a junction match
          } else if (m.type !== "depart") {
            if (ring) {                                          // the whole ring is one junction
              pts = ix.map((x) => x.location);
              const exit = steps[i + 1] && steps[i + 1].maneuver;
              if (exit && RING_EXIT[exit.type]) pts.push(exit.location);
            }
            junction = pick(grid, pts, true, 1);
            // A named roundabout (OSRM rotary_name) beats anything merely standing next to
            // it — but that neighbour is often the name people use, so keep it as `alt`.
            const own = st.rotary_name && cleanName(st.rotary_name, "square", lang);
            if (own && !(junction && KINDS[junction.kind].rank <= 1)) {
              const alt = junction && junction.key !== keyOf(own) ? junction : null;
              junction = { name: own, key: keyOf(own), kind: "square", src: "OSM roundabout name",
                           d: 0, lng: m.location[0], lat: m.location[1],
                           alt: alt ? alt.name : null, altKey: alt ? alt.key : null };
            }
          }
          events.push({ type: m.type === "depart" || m.type === "arrive" ? m.type : "maneuver",
                        maneuver: m, turn: ring ? ringTurn(steps, i) : null, junction, at: m.location, pts, s: s0 });
        }

        // Named junctions driven straight through. (Not on the ring: it is one junction.)
        const g = st.geometry && st.geometry.coordinates;
        if (!ring && g && g.length > 1 && m.type !== "arrive") {
          const cum = [0];
          for (let k = 1; k < g.length; k++) cum.push(cum[k - 1] + dist(g[k - 1], g[k]));
          const total = cum[cum.length - 1] || 1;
          for (let j = silent ? 0 : 1; j < ix.length; j++) {
            const loc = ix[j].location;
            const hit = pick(grid, [loc], false, 1);
            if (!hit) continue;
            let v = 0, bd = Infinity;                            // the intersection's vertex on the step line
            for (let k = 0; k < g.length; k++) { const d = dist(g[k], loc); if (d < bd) { bd = d; v = k; } }
            events.push({ type: "pass", junction: hit, at: loc, s: s0 + (st.distance || 0) * (cum[v] / total) });
          }
        }
        s0 += st.distance || 0;
      }
    }

    // One row per junction: keep the closest approach, and never announce a
    // junction just before/after the row that already names it.
    const same = (j, key) => !!j && (j.key === key || j.altKey === key);
    // Two features naming one junction: show the better spelling (see KINDS.q).
    const adopt = (keep, other) => {
      if (keep.key === other.key && KINDS[other.kind].q < KINDS[keep.kind].q) {
        keep.name = other.name; keep.kind = other.kind; keep.src = other.src;
      }
    };
    // A feature in range of a junction that is already named (it lost to a better
    // name there) is that same junction — not a second one to drive through.
    const covers = (row, j) => row.type !== "pass" && !!row.junction &&
                               row.pts.some((pt) => dist(pt, [j.lng, j.lat]) <= j.r);
    const forward = [];
    for (const ev of events) {
      const last = forward[forward.length - 1];
      if (ev.type === "pass" && last && same(last.junction, ev.junction.key)) {
        if (last.type === "pass" && ev.junction.d < last.junction.d) { adopt(ev.junction, last.junction); forward[forward.length - 1] = ev; }
        else adopt(last.junction, ev.junction);
        continue;
      }
      if (ev.type === "pass" && last && covers(last, ev.junction)) continue;
      forward.push(ev);
    }
    const rows = [];                                             // …and the same looking ahead
    for (let i = forward.length - 1; i >= 0; i--) {
      const r = forward[i], next = rows[0];
      if (r.type === "pass" && next) {
        if (same(next.junction, r.junction.key)) { adopt(next.junction, r.junction); continue; }
        if (covers(next, r.junction)) continue;
      }
      rows.unshift(r);
    }

    // "…toward <next junction>": the next named junction where you act (or arrive),
    // else the next one you pass. Said once per target, on the rows where you act.
    let said = null;
    rows.forEach((r, i) => {
      r.dist = rows[i + 1] && r.type !== "arrive" ? Math.max(0, rows[i + 1].s - r.s) : null;
      if (r.type !== "depart" && r.type !== "maneuver") return;
      const ahead = rows.slice(i + 1).filter((n) => n.junction && !same(r.junction, n.junction.key));
      const next = ahead.find((n) => n.type !== "pass") || ahead[0];
      if (next && next.junction.key !== said) { r.toward = next.junction.name; said = next.junction.key; }
    });
    return rows;
  }

  const api = { KINDS, PHOTON_TAGS, corridor, fromPhoton, fromCustom, searchCustom, itinerary, cleanName, dist };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OKJunctions = api;
})(typeof self !== "undefined" ? self : this);
