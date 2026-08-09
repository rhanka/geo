# acquisition-job — k8s Job that runs ONE shard of the QC mass-acquisition.
# REMOTE & DURABLE (survives the laptop being off). Adapted from
# deploy/normes-job/Dockerfile; the orchestrator fans this image out across N
# shards as parallel/serialised k8s Jobs (acquisition/src/k8s-shard-run.ts).
#
# poppler-utils (pdftotext / pdfinfo / pdftoppm) is REQUIRED by the parsers and
# the Mistral-vision page renderer — BAKED in (the pod has no apt egress).
# Build with `docker build --network=host` (buildkit DNS is flaky).
#
# This repo has NO npm workspace root: acquisition/ and packages/qc-sources/ are
# independent packages, so we `npm ci` inside acquisition/ and resolve qc-sources
# by relative path (its only runtime dep, zod, is already in acquisition's lock).
FROM node:22-bookworm-slim

# poppler-utils + ca-certificates (TLS to S3 + api.mistral.ai + municipal sites).
RUN echo 'APT::Sandbox::User "root";' > /etc/apt/apt.conf.d/00no-sandbox \
 && for i in 1 2 3; do apt-get update && apt-get install -y --no-install-recommends \
      poppler-utils ca-certificates && break || { echo "apt retry $i"; sleep 8; }; done \
 && command -v pdftotext && command -v pdfinfo && command -v pdftoppm \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /geo

# packages/qc-sources is source-only (TS run via tsx, no build) — its sole
# runtime dep (zod) is hoisted into acquisition/node_modules at `npm ci` time.
# It provides ALL_PV_CITIES (the canonical muni list the orchestrator shards).
COPY packages/qc-sources/ ./packages/qc-sources/

# Install acquisition deps (tsx, @aws-sdk/client-s3, @dsnp/parquetjs, zod, …)
# from its committed lockfile, then copy its sources.
COPY acquisition/package.json acquisition/package-lock.json ./acquisition/
RUN cd acquisition && npm ci
COPY acquisition/src/ ./acquisition/src/
COPY acquisition/tsconfig.json ./acquisition/

# Entrypoint: discover|extract|all over a SLUGS shard, deposit norms to S3.
COPY deploy/acquisition-job/run-acquisition-job.sh /usr/local/bin/run-acquisition-job.sh
RUN chmod +x /usr/local/bin/run-acquisition-job.sh

# Resolve `tsx` and node_modules from acquisition/ regardless of cwd.
ENV PATH="/geo/acquisition/node_modules/.bin:${PATH}"
ENV NODE_PATH="/geo/acquisition/node_modules"
WORKDIR /geo/acquisition
ENTRYPOINT ["/usr/local/bin/run-acquisition-job.sh"]
