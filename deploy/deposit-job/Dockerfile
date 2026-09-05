# deposit-job — INERT SKELETON. k8s Job image for the LOT-1 served-zonage deposit (wraps a proven
# acquisition/src/zones-*-replace.ts runner). NO Mistral/poppler (deposit renders no PDFs — it reads a
# provider layer + writes S3 with proof v2). NOT BUILT for real yet: job-deposit.yaml's image tag is a
# placeholder; the real build+push happens at LOT-1 go-line. Build with `docker build --network=host`.
FROM node:22-bookworm-slim

# ca-certificates only (TLS to S3 + the provider FeatureServer/WFS). No poppler.
RUN echo 'APT::Sandbox::User "root";' > /etc/apt/apt.conf.d/00no-sandbox \
 && for i in 1 2 3; do apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates && break || { echo "apt retry $i"; sleep 8; }; done \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /geo

# qc-sources is source-only (its sole runtime dep, zod, is hoisted into acquisition/node_modules at npm ci).
COPY packages/qc-sources/ ./packages/qc-sources/

# Install acquisition deps (tsx, @aws-sdk/client-s3, …) from its committed lockfile, then copy its sources.
COPY acquisition/package.json acquisition/package-lock.json ./acquisition/
RUN cd acquisition && npm ci
COPY acquisition/src/ ./acquisition/src/
COPY acquisition/tsconfig.json ./acquisition/

# Entrypoint: wrap a proven zones-*-replace.ts runner (inspect|deposit) — see run-deposit-job.sh.
COPY deploy/deposit-job/run-deposit-job.sh /usr/local/bin/run-deposit-job.sh
RUN chmod +x /usr/local/bin/run-deposit-job.sh

# Resolve `tsx` + node_modules from acquisition/ regardless of cwd.
ENV PATH="/geo/acquisition/node_modules/.bin:${PATH}"
ENV NODE_PATH="/geo/acquisition/node_modules"
WORKDIR /geo/acquisition
ENTRYPOINT ["/usr/local/bin/run-deposit-job.sh"]
