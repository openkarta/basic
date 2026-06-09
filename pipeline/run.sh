#!/bin/sh
# ==========================================================================
#  Open Karta — data pipeline & orchestrator
# ==========================================================================
#  Runs inside the pinned pipeline image (alpine + curl + docker-cli baked in,
#  see pipeline/Dockerfile) with the host docker socket mounted. Every
#  $INTERVAL seconds it:
#    1. Ingests the Ethiopia OSM extract (time-conditional, bandwidth-saving).
#    2. Builds OpenMapTiles vector tiles with Planetiler — into a temp file.
#    3. Builds the OSRM routing graph in a scratch dir (car profile, MLD).
#    4. Atomically swaps in whatever rebuilt, hot-reloads those engines, and
#       triggers a Photon reindex when its snapshot of Nominatim is stale.
#
#  Atomicity: the live engines keep the OLD inodes open across each rename, so
#  they serve consistent data right up to their restart, and a failed build
#  never disturbs what is currently being served. .osrm_ready is dropped only
#  for the millisecond burst of multi-file renames, so an engine that happens
#  to restart mid-swap waits instead of loading a half-swapped graph.
#
#  Every dynamically-launched build container uses --rm to avoid host pollution.
#  Sentinel files (.tiles_ready / .osrm_ready) let the engine containers wait
#  for valid data instead of crash-looping on first boot.
# ==========================================================================
set -u

PBF="/data/ethiopia-latest.osm.pbf"
MBTILES="/data/ethiopia-latest.mbtiles"
OSRM="/data/ethiopia-latest.osrm"
OSRM_BUILD="/data/osrm-build"                 # graph scratch dir (same volume)
INTERVAL="${INTERVAL:-86400}"
XMX="${PLANETILER_XMX:-4g}"
PBF_URL="${PBF_URL:-https://download.geofabrik.de/africa/ethiopia-latest.osm.pbf}"
# Pinned builder images (compose sets these). OSRM_IMAGE must match the
# routing-engine service image — the graph format is version-specific.
PLANETILER_IMAGE="${PLANETILER_IMAGE:-ghcr.io/onthegomap/planetiler:0.8.2}"
OSRM_IMAGE="${OSRM_IMAGE:-osrm/osrm-backend:v5.27.1}"
PHOTON_REINDEX_DAYS="${PHOTON_REINDEX_DAYS:-7}"

# Absolute HOST path to ./data — required for sibling-container bind mounts.
: "${HOST_DATA_DIR:?HOST_DATA_DIR must be set to the absolute host path of ./data}"

mkdir -p /data

while true; do
  echo "[pipeline] ============================================================"
  echo "[pipeline] cycle start: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
  echo "[pipeline] HOST_DATA_DIR=${HOST_DATA_DIR}"

  TILES_OK=0
  OSRM_OK=0

  # --- Task 1: Ingest (follow redirects, validate, atomic replace) ----------
  # Geofabrik's *-latest.osm.pbf 302-redirects to a dated file, so -L is
  # required. We download to a TEMP file and only replace the live PBF once it
  # validates as a real OSM PBF — so a redirect/error page or a half-finished
  # transfer can never overwrite the known-good data the engines rebuild from.
  # The conditional (-z) is only trusted when a previously *validated* full PBF
  # exists (the .pbf_ok marker); a missing/partial file always forces a fresh,
  # complete download.
  echo "[pipeline] [1/4] downloading OSM extract (follow redirects, validated)..."
  TMP="${PBF}.part"
  rm -f "$TMP"
  ZOPT=""
  [ -f /data/.pbf_ok ] && [ -s "$PBF" ] && ZOPT="-z $PBF"
  if curl -fL --no-progress-meter --retry 3 --retry-delay 5 --retry-connrefused --connect-timeout 30 \
          $ZOPT -o "$TMP" "$PBF_URL"; then
    if [ -s "$TMP" ] && head -c 64 "$TMP" | grep -aq OSMHeader; then
      mv -f "$TMP" "$PBF" && touch /data/.pbf_ok
      echo "[pipeline]       download OK -> $(wc -c < "$PBF") bytes"
    elif [ ! -s "$TMP" ]; then
      echo "[pipeline]       upstream unchanged (304); keeping existing PBF"
      rm -f "$TMP"
    else
      echo "[pipeline]       ERROR: download is not a valid OSM PBF ($(wc -c < "$TMP") bytes); discarding"
      rm -f "$TMP"
    fi
  else
    echo "[pipeline]       WARN: download failed; reusing existing PBF if present"
    rm -f "$TMP"
  fi

  # Only ever build from a PBF that passed validation (the .pbf_ok marker) — so
  # a failed download leaving a stale partial behind can never feed the build.
  if [ ! -s "$PBF" ] || [ ! -f /data/.pbf_ok ]; then
    echo "[pipeline]       no validated PBF yet; keeping existing engine data, retrying in ${INTERVAL}s"
    sleep "$INTERVAL"
    continue
  fi

  # --- Task 2: Vector tiles (Planetiler -> OpenMapTiles mbtiles) ------------
  # Planetiler downloads auxiliary data (water polygons, natural earth, lake
  # centerlines) from third-party hosts; those fetches are occasionally flaky
  # (e.g. a truncated GitHub release-asset CDN response). Successfully fetched
  # files in /data/sources are reused, so we just retry the whole build a few
  # times — a fresh attempt almost always gets the missing file.
  # The build lands in $MBT_NEW and is renamed over the live file only on
  # success: Martin keeps the old inode open until its restart, so a failed or
  # partial build can never be served.
  echo "[pipeline] [2/4] building vector tiles with Planetiler (Xmx=${XMX})..."
  MBT_NEW="${MBTILES}.new"
  rm -f "$MBT_NEW" "${MBT_NEW}-journal"
  PT_ATTEMPT=1; PT_MAX=4
  while [ "$PT_ATTEMPT" -le "$PT_MAX" ]; do
    echo "[pipeline]       Planetiler attempt ${PT_ATTEMPT}/${PT_MAX}..."
    if docker run --rm \
          -e JAVA_TOOL_OPTIONS="-Xmx${XMX}" \
          -v "${HOST_DATA_DIR}":/data \
          "$PLANETILER_IMAGE" \
          --osm-path=/data/ethiopia-latest.osm.pbf \
          --output=/data/ethiopia-latest.mbtiles.new \
          --download --download-dir=/data/sources \
          --force; then
      mv -f "$MBT_NEW" "$MBTILES"
      touch /data/.tiles_ready
      echo "[pipeline]       Planetiler OK -> ${MBTILES}"
      TILES_OK=1
      break
    fi
    echo "[pipeline]       Planetiler attempt ${PT_ATTEMPT} failed (likely a flaky aux download); backing off 30s"
    PT_ATTEMPT=$((PT_ATTEMPT + 1))
    sleep 30
  done
  [ "$TILES_OK" = "1" ] || echo "[pipeline]       ERROR: Planetiler failed after ${PT_MAX} attempts (tile server keeps serving old data)"

  # --- Task 3: Routing graph (OSRM car profile, MLD) ------------------------
  # Built in a scratch dir, then renamed into place: building in place would
  # truncate the very files the live osrm-routed has mmap'd. The PBF is
  # hardlinked into the scratch dir (same filesystem -> free; cp fallback) so
  # osrm-extract's outputs land there too.
  echo "[pipeline] [3/4] building OSRM routing graph (car profile, MLD)..."
  rm -rf "$OSRM_BUILD"
  mkdir -p "$OSRM_BUILD"
  ln -f "$PBF" "$OSRM_BUILD/ethiopia-latest.osm.pbf" 2>/dev/null \
    || cp -f "$PBF" "$OSRM_BUILD/ethiopia-latest.osm.pbf"
  if docker run --rm -v "${HOST_DATA_DIR}":/data "$OSRM_IMAGE" osrm-extract   -p /opt/car.lua /data/osrm-build/ethiopia-latest.osm.pbf \
  && docker run --rm -v "${HOST_DATA_DIR}":/data "$OSRM_IMAGE" osrm-partition  /data/osrm-build/ethiopia-latest.osrm \
  && docker run --rm -v "${HOST_DATA_DIR}":/data "$OSRM_IMAGE" osrm-customize  /data/osrm-build/ethiopia-latest.osrm; then
    # The graph is ~20 files, so the swap can't be a single rename. Hold the
    # sentinel down for the (millisecond) rename burst: a server restarting
    # mid-swap waits instead of mmap'ing a half-swapped graph. The RUNNING
    # server is untouched either way — it holds the old inodes.
    rm -f /data/.osrm_ready
    mv -f "$OSRM_BUILD"/ethiopia-latest.osrm* /data/
    touch /data/.osrm_ready
    rm -rf "$OSRM_BUILD"
    echo "[pipeline]       OSRM OK -> ${OSRM}.*"
    OSRM_OK=1
  else
    echo "[pipeline]       ERROR: OSRM build failed (routing engine keeps serving old data)"
  fi

  # --- Task 4: Zero-downtime hot reload (restart only what rebuilt) ---------
  echo "[pipeline] [4/4] hot-reloading updated engines..."
  if [ "$TILES_OK" = "1" ]; then
    docker restart ok_tile_server   >/dev/null 2>&1 && echo "[pipeline]       restarted ok_tile_server"   || echo "[pipeline]       WARN: ok_tile_server not running"
  fi
  if [ "$OSRM_OK" = "1" ]; then
    docker restart ok_routing_engine >/dev/null 2>&1 && echo "[pipeline]       restarted ok_routing_engine" || echo "[pipeline]       WARN: ok_routing_engine not running"
  fi

  # Photon's index is a point-in-time snapshot of the Nominatim DB (which keeps
  # itself fresh via replication — see docker-compose.yml). Rebuild the snapshot
  # when older than PHOTON_REINDEX_DAYS (0 disables): dropping /photon/.ready
  # makes photon/run.sh reimport on the restart that follows (expect a brief
  # search outage while it rebuilds).
  if [ "$PHOTON_REINDEX_DAYS" -gt 0 ] 2>/dev/null \
     && docker exec ok_photon find /photon/.ready -mtime +"$((PHOTON_REINDEX_DAYS - 1))" 2>/dev/null | grep -q .; then
    echo "[pipeline]       Photon index older than ${PHOTON_REINDEX_DAYS}d; rebuilding it from Nominatim"
    if docker exec ok_photon rm -f /photon/.ready && docker restart ok_photon >/dev/null 2>&1; then
      echo "[pipeline]       restarted ok_photon (reimports on boot)"
    else
      echo "[pipeline]       WARN: could not trigger the Photon reindex"
    fi
  fi

  echo "[pipeline] cycle done; sleeping ${INTERVAL}s"
  sleep "$INTERVAL"
done
