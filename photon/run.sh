#!/bin/sh
# ==========================================================================
#  Photon — OSM type-ahead (prefix) autocomplete geocoder.
#  On first start it WAITS for Nominatim's import to finish, then builds an
#  embedded-OpenSearch index from the Nominatim PostgreSQL DB (Ethiopia only)
#  and serves /api on :2322 with CORS enabled. The index persists in the
#  `photon-index` named volume (mounted at /photon); a partial/empty import is
#  never marked ready, so it retries until real data is available.
# ==========================================================================
set -u

JAR=/opt/photon/photon-1.1.0.jar
cd /photon                                   # photon_data/ index is created here

NOMINATIM_HOST="${NOMINATIM_HOST:-ok_geocoder}"
NOMINATIM_PASSWORD="${NOMINATIM_PASSWORD:?NOMINATIM_PASSWORD must be set}"

if [ ! -f /photon/.ready ]; then
  # depends_on only waits for the Nominatim CONTAINER to start, not for its PBF
  # import (tens of minutes on first boot). Importing against a half-loaded DB
  # builds an EMPTY index and then marks it ready forever — search silently
  # returns nothing. So wait until Nominatim reports the import is complete
  # (/status -> {"status":0}) before reading from it.
  echo "[photon] waiting for Nominatim import to finish (${NOMINATIM_HOST}:8080/status)..."
  until curl -fsS "http://${NOMINATIM_HOST}:8080/status?format=json" 2>/dev/null | grep -q '"status":0'; do
    echo "[photon]   Nominatim not ready yet; checking again in 20s"
    sleep 20
  done
  echo "[photon] Nominatim ready — importing Ethiopia index from ${NOMINATIM_HOST}:5432 ..."

  if java -jar "$JAR" -nominatim-import \
        -host "$NOMINATIM_HOST" -port 5432 \
        -database nominatim -user nominatim -password "$NOMINATIM_PASSWORD" \
        -languages en,am -country-codes et; then
    # Belt-and-suspenders: the import returns success even on an empty DB, which
    # would yield a tiny empty index. Only accept (and mark ready) an index that
    # actually holds data; otherwise discard and retry.
    SIZE_MB=$(du -sm /photon/photon_data 2>/dev/null | cut -f1)
    if [ "${SIZE_MB:-0}" -ge 5 ]; then
      touch /photon/.ready
      echo "[photon] import complete (${SIZE_MB}MB index)."
    else
      echo "[photon] index is empty (${SIZE_MB:-0}MB) — Nominatim data not ready; clearing and retrying"
      rm -rf /photon/photon_data
      sleep 30
      exit 1
    fi
  else
    echo "[photon] import FAILED (is Nominatim finished importing?); clearing partial index and exiting for restart"
    rm -rf /photon/photon_data
    sleep 15
    exit 1
  fi
fi

echo "[photon] serving on 0.0.0.0:2322 (cors-any)"
exec java -jar "$JAR" -cors-any -listen-ip 0.0.0.0 -listen-port 2322
