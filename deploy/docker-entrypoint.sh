#!/bin/sh
# Entrypoint for the @sentropic/geo image.
#
# Bridges the fixed data path that packages/geo-api/dist/server.js expects
# (/app/data/normalized, resolved relative to the compiled server module) to the
# configurable $GEO_DATA_DIR (default /data/normalized — the mounted PVC). This
# lets the documented server CMD work unchanged while the data location stays
# env-driven, without modifying package source.
#
# For non-server commands (e.g. `geo fetch … --out /data/normalized`) the
# symlink is harmless; those commands target $GEO_DATA_DIR explicitly.
set -e

GEO_DATA_DIR="${GEO_DATA_DIR:-/data/normalized}"
EXPECTED_DIR="/app/data/normalized"

# Only set up the bridge when the data lives somewhere other than the path the
# server resolves by default, and only if /app/data is writable by this user.
if [ "$GEO_DATA_DIR" != "$EXPECTED_DIR" ]; then
  if mkdir -p /app/data 2>/dev/null; then
    # Replace any stale link/dir, then point the expected path at the real data.
    rm -rf "$EXPECTED_DIR" 2>/dev/null || true
    ln -sfn "$GEO_DATA_DIR" "$EXPECTED_DIR" 2>/dev/null || true
  fi
fi

exec "$@"
