# normes-job — Scaleway Serverless Job that runs the QC zonage-norms pipeline
# REMOTE & DURABLE (survives the laptop being off). Mirrors deploy/pmtiles.
#
# poppler-utils (pdftotext / pdfinfo / pdftoppm) is REQUIRED by the parsers and
# the Mistral-vision page renderer — BAKED in (a Scaleway job may have no apt
# egress). Build with `docker build --network=host` (buildkit DNS is flaky).
#
# This repo has NO npm workspace root: acquisition/ and packages/qc-sources/ are
# independent packages, so we `npm ci` inside acquisition/ and resolve qc-sources
# by relative path (its only runtime dep, zod, is already in acquisition's lock).
FROM node:22-bookworm-slim

# poppler-utils + ca-certificates (TLS to S3 + api.mistral.ai). Retry: archive DNS.
RUN echo 'APT::Sandbox::User "root";' > /etc/apt/apt.conf.d/00no-sandbox \
 && for i in 1 2 3; do apt-get update && apt-get install -y --no-install-recommends \
      poppler-utils ca-certificates && break || { echo "apt retry $i"; sleep 8; }; done \
 && command -v pdftotext && command -v pdfinfo && command -v pdftoppm \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /geo

# packages/qc-sources is source-only (TS run via tsx, no build) — its sole
# runtime dep (zod) is hoisted into acquisition/node_modules at `npm ci` time.
COPY packages/qc-sources/ ./packages/qc-sources/
# `acquisition/tsconfig.json` maps @sentropic/geo to this source module while
# tsx runs the bridge. It must therefore be present in the image even though
# its ignored dist/ output is deliberately rebuilt elsewhere.
COPY packages/geo/src/ ./packages/geo/src/

# Install acquisition deps (tsx, @aws-sdk/client-s3, @dsnp/parquetjs, zod, …)
# from its committed lockfile, then copy its sources.
COPY acquisition/package.json acquisition/package-lock.json ./acquisition/
RUN cd acquisition && npm ci \
 && ln -s acquisition/node_modules /geo/node_modules
COPY acquisition/src/ ./acquisition/src/
COPY acquisition/tsconfig.json ./acquisition/
# Static, non-secret S3 endpoint contract read at module load. Credentials stay
# exclusively in the Kubernetes SecretRef environment.
COPY acquisition/config/s3-target.json ./acquisition/config/s3-target.json

# Regression guard for the captured bridge: its TypeScript source reaches both
# @sentropic/geo (through the acquisition tsconfig paths) and zod (from the
# sibling qc-sources package). Resolve the actual bridge during image build;
# the root node_modules symlink makes ESM upward resolution see the lockfile's
# dependencies from both source trees.
RUN cd acquisition && ./node_modules/.bin/tsx -e 'import { extractCapturedNormes } from "./src/captured-normes-extract.ts"; if (typeof extractCapturedNormes !== "function") process.exit(1)'

# Entrypoint (materialises s3.env from job ENV, runs pull/discover → batch).
COPY deploy/normes-job/run-normes-job.sh /usr/local/bin/run-normes-job.sh
RUN chmod +x /usr/local/bin/run-normes-job.sh

# Resolve `tsx` and node_modules from acquisition/ regardless of cwd.
ENV PATH="/geo/acquisition/node_modules/.bin:${PATH}"
ENV NODE_PATH="/geo/acquisition/node_modules"
WORKDIR /geo/acquisition
ENTRYPOINT ["/usr/local/bin/run-normes-job.sh"]
