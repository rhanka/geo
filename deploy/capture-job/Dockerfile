# geo-capture — generic, durable capture runner (SPEC_CAPTURE_ON_CLUSTER §5.2).
#
# It contains only Node/TS plus CA certificates: this direct-HTTP job never
# performs extraction or writes served data. Chromium/Tor remain a distinct
# obscura variant because adding them here would falsely imply that a generic
# GET worklist can drive a CDP source safely.
FROM node:22-bookworm-slim

RUN echo 'APT::Sandbox::User "root";' > /etc/apt/apt.conf.d/00no-sandbox \
 && apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /geo

# The file dependency @sentropic/geo must exist BEFORE `npm ci`; all source
# packages resolve ESM `zod` through /geo/node_modules (a symlink to the only
# installed dependency tree), since ESM deliberately ignores NODE_PATH.
COPY packages/geo/ ./packages/geo/
COPY packages/qc-sources/ ./packages/qc-sources/
# @sentropic/s3-dag is imported by the s3-dag reconciler/worker entrypoints via a
# relative source path (../../../packages/s3-dag/src/...), like qc-sources — not a
# package.json dep. Its runtime deps (@aws-sdk) already resolve through
# acquisition/node_modules; the entrypoints import submodules only (never the hono
# barrel), so no extra dependency is pulled in.
COPY packages/s3-dag/ ./packages/s3-dag/
COPY acquisition/package.json acquisition/package-lock.json ./acquisition/
RUN cd acquisition && npm ci \
 && ln -s /geo/acquisition/node_modules /geo/node_modules
COPY acquisition/src/ ./acquisition/src/
COPY acquisition/tsconfig.json ./acquisition/

# La CIBLE S3 est declaree dans le depot (commit 0ea922ac) et `s3Client()` REFUSE
# de demarrer sans elle — c'est precisement ce qu'on veut: lire le mauvais cloud
# etait totalement silencieux. Mais l'image ne copiait que `src/`, donc le premier
# Job epingle par digest est mort en `ENOENT .../config/s3-target.json` avant tout
# appel reseau. Le garde a fait son travail; c'est l'image qui etait incomplete.
# Ce fichier SEUL, pas `config/` entier: les 2 179 fichiers de config sont des
# plans et worklists que le Job recoit par WORKLIST, il n'en lit aucun au demarrage.
COPY acquisition/config/s3-target.json ./acquisition/config/s3-target.json
COPY acquisition/config/k8s-target.json ./acquisition/config/k8s-target.json

COPY deploy/capture-job/run-capture-job.sh /usr/local/bin/run-capture-job.sh
RUN chmod +x /usr/local/bin/run-capture-job.sh

# The Job runs with runAsNonRoot.  The entrypoint writes only to the fsGroup-
# owned /scratch EmptyDir supplied by Kubernetes; repository files stay read-only.
RUN chown -R 1000:1000 /geo
USER 1000:1000

ENV PATH="/geo/acquisition/node_modules/.bin:${PATH}"
ENV NODE_PATH="/geo/acquisition/node_modules"
WORKDIR /geo/acquisition
ENTRYPOINT ["/usr/local/bin/run-capture-job.sh"]
