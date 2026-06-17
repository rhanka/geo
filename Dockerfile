# syntax=docker/dockerfile:1
#
# @sentropic/geo — geo-api runtime image (also runs `geo fetch`).
#
# A single image serves two roles in the cluster:
#   1. Default CMD: the OGC API – Features server (`geo serve` semantics via
#      packages/geo/dist/api/server.js) on $PORT, reading normalized GeoJSON
#      from $GEO_DATA_DIR.
#   2. The data-population Job (`geo fetch …`), which needs gdal-bin's
#      `ogr2ogr`/`ogrinfo` to ingest bulk vector formats (Shapefile/GPKG/…).
#      Both roles share this image so fetched data is reproducible and the
#      runtime never drifts from what populated it.
#
# Build context = the monorepo root.
#
#   docker build -t rg.fr-par.scw.cloud/sentropic-geo/geo-api:latest .
#
# Run the API server (default):
#   docker run -p 8787:8787 -v "$PWD/data/normalized:/data/normalized:ro" \
#     rg.fr-par.scw.cloud/sentropic-geo/geo-api:latest
#
# Run a fetch (populate the data volume) — overrides CMD with the `geo` bin:
#   docker run -v "$PWD/data:/data" rg.fr-par.scw.cloud/sentropic-geo/geo-api:latest \
#     geo fetch ca-qc/sda qc-municipalites --out /data/normalized
#
# The `geo` executable is on PATH (symlinked to packages/geo/dist/cli/cli.js),
# so the Job can call `geo fetch …` / `geo licenses build` directly.

# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — build: install the full workspace and compile every package to dist.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Copy the whole monorepo (the .dockerignore prunes node_modules, caches, raw
# data, build artifacts, etc.) and install against the committed lockfile.
COPY . .
RUN npm ci

# Compile all workspace packages to their dist/ outputs (topological order is
# handled by scripts/run-workspaces.mjs).
RUN npm run build

# Produce a production-only dependency tree to copy into the runtime stage.
RUN npm prune --omit=dev

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — runtime: slim Node + gdal-bin, prod deps + built dist only.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8787 \
    GEO_DATA_DIR=/data/normalized

# gdal-bin provides ogr2ogr / ogrinfo, required by `geo fetch` for bulk vector
# formats (see packages/geo/src/acquire/gdal.ts). ca-certificates is needed for
# HTTPS downloads during acquisition.
RUN apt-get update \
 && apt-get install -y --no-install-recommends gdal-bin ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Bring in the production node_modules and the compiled workspace packages.
# Copying the whole tree (minus dev deps, pruned above) keeps the workspace
# symlinks under node_modules/@sentropic/* intact so the `geo` CLI resolves
# geo-core and the continent source libs (geo-sources-americas / -europe) at
# runtime (the latter via the engine's optional dynamic import, ADR-0017).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/packages ./packages

# Expose the `geo` CLI on PATH for the fetch/licenses Job.
RUN ln -sf /app/packages/geo/dist/cli/cli.js /usr/local/bin/geo \
 && chmod +x /app/packages/geo/dist/cli/cli.js

# server.js (packages/geo/dist/api/server.js) reads from a path resolved
# relative to its own location: /app/data/normalized. The entrypoint bridges
# that fixed path to the configurable $GEO_DATA_DIR (default /data/normalized,
# the mounted PVC) by symlinking, so the documented CMD keeps working while the
# data location stays env-driven.
COPY deploy/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Run as the built-in unprivileged `node` user.
USER node

EXPOSE 8787

ENTRYPOINT ["docker-entrypoint.sh"]
# Default role: the geo-api server. Override the CMD (e.g. `geo fetch …`) for
# the data-population Job.
CMD ["node", "packages/geo/dist/api/server.js"]
