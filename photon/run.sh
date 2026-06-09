#!/bin/sh
# ==========================================================================
#  Photon — OSM type-ahead (prefix) autocomplete geocoder.
#  On first start it builds an embedded-OpenSearch index from the Nominatim
#  PostgreSQL DB (Ethiopia only), then serves /api on :2322 with CORS enabled.
#  The index persists in the `photon-index` named volume (mounted at /photon).
# ==========================================================================
set -u

JAR=/opt/photon/photon-1.1.0.jar
cd /photon                                   # photon_data/ index is created here

NOMINATIM_HOST="${NOMINATIM_HOST:-ok_geocoder}"
NOMINATIM_PASSWORD="${NOMINATIM_PASSWORD:?NOMINATIM_PASSWORD must be set}"

if [ ! -f /photon/.ready ]; then
  echo "[photon] no index yet — importing Ethiopia from Nominatim @ ${NOMINATIM_HOST}:5432 ..."
  if java -jar "$JAR" -nominatim-import \
        -host "$NOMINATIM_HOST" -port 5432 \
        -database nominatim -user nominatim -password "$NOMINATIM_PASSWORD" \
        -languages en,am -country-codes et; then
    touch /photon/.ready
    echo "[photon] import complete."
  else
    echo "[photon] import FAILED (is Nominatim finished importing?); clearing partial index and exiting for restart"
    rm -rf /photon/photon_data
    sleep 15
    exit 1
  fi
fi

echo "[photon] serving on 0.0.0.0:2322 (cors-any)"
exec java -jar "$JAR" -cors-any -listen-ip 0.0.0.0 -listen-port 2322
