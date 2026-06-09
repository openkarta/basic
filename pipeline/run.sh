#!/bin/sh
# ==========================================================================
#  Open Karta — data pipeline & orchestrator
# ==========================================================================
#  Runs inside an alpine container with the host docker socket mounted. Every
#  $INTERVAL seconds it:
#    1. Ingests the Ethiopia OSM extract (time-conditional, bandwidth-saving).
#    2. Builds OpenMapTiles vector tiles with Planetiler.
#    3. Builds the OSRM routing graph (car profile, MLD: extract/partition/customize).
#    4. Hot-reloads the tile + routing servers (only what actually rebuilt).
#
#  Every dynamically-launched build container uses --rm to avoid host pollution.
#  Sentinel files (.tiles_ready / .osrm_ready) let the engine containers wait
#  for valid data instead of crash-looping on first boot.
# ==========================================================================
set -u

PBF="/data/ethiopia-latest.osm.pbf"
MBTILES="/data/ethiopia-latest.mbtiles"
OSRM="/data/ethiopia-latest.osrm"
INTERVAL="${INTERVAL:-86400}"
XMX="${PLANETILER_XMX:-4g}"
PBF_URL="${PBF_URL:-https://download.geofabrik.de/africa/ethiopia-latest.osm.pbf}"

# Absolute HOST path to ./data — required for sibling-container bind mounts.
: "${HOST_DATA_DIR:?HOST_DATA_DIR must be set to the absolute host path of ./data}"

echo "[pipeline] installing dependencies (curl, docker-cli)..."
apk add --no-cache curl docker-cli >/dev/null 2>&1 || apk add --no-cache curl docker-cli

mkdir -p /data

while true; do
  echo "[pipeline] ============================================================"
  echo "[pipeline] cycle start: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
  echo "[pipeline] HOST_DATA_DIR=${HOST_DATA_DIR}"

  TILES_OK=0
  OSRM_OK=0

  # --- Task 1: Ingest (conditional download) --------------------------------
  echo "[pipeline] [1/4] downloading OSM extract (conditional)..."
  if curl -fL -z "$PBF" -o "$PBF" "$PBF_URL"; then
    echo "[pipeline]       download OK (or upstream unchanged)"
  else
    echo "[pipeline]       WARN: download failed; will reuse existing file if present"
  fi

  if [ ! -s "$PBF" ]; then
    echo "[pipeline]       no PBF available yet; retrying in ${INTERVAL}s"
    sleep "$INTERVAL"
    continue
  fi

  # --- Task 2: Vector tiles (Planetiler -> OpenMapTiles mbtiles) ------------
  # Planetiler downloads auxiliary data (water polygons, natural earth, lake
  # centerlines) from third-party hosts; those fetches are occasionally flaky
  # (e.g. a truncated GitHub release-asset CDN response). Successfully fetched
  # files in /data/sources are reused, so we just retry the whole build a few
  # times — a fresh attempt almost always gets the missing file.
  echo "[pipeline] [2/4] building vector tiles with Planetiler (Xmx=${XMX})..."
  PT_ATTEMPT=1; PT_MAX=4
  while [ "$PT_ATTEMPT" -le "$PT_MAX" ]; do
    echo "[pipeline]       Planetiler attempt ${PT_ATTEMPT}/${PT_MAX}..."
    if docker run --rm \
          -e JAVA_TOOL_OPTIONS="-Xmx${XMX}" \
          -v "${HOST_DATA_DIR}":/data \
          ghcr.io/onthegomap/planetiler:latest \
          --osm-path=/data/ethiopia-latest.osm.pbf \
          --output=/data/ethiopia-latest.mbtiles \
          --download --download-dir=/data/sources \
          --force; then
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
  echo "[pipeline] [3/4] building OSRM routing graph (car profile, MLD)..."
  if docker run --rm -v "${HOST_DATA_DIR}":/data osrm/osrm-backend osrm-extract   -p /opt/car.lua /data/ethiopia-latest.osm.pbf \
  && docker run --rm -v "${HOST_DATA_DIR}":/data osrm/osrm-backend osrm-partition  /data/ethiopia-latest.osrm \
  && docker run --rm -v "${HOST_DATA_DIR}":/data osrm/osrm-backend osrm-customize  /data/ethiopia-latest.osrm; then
    touch /data/.osrm_ready
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

  echo "[pipeline] cycle done; sleeping ${INTERVAL}s"
  sleep "$INTERVAL"
done
