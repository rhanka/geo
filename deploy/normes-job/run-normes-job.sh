#!/usr/bin/env bash
# Entrypoint of the QC zonage-norms Scaleway Serverless Job (REMOTE, DURABLE).
#
# Reads ITS creds from the job ENV (NEVER printed):
#   S3_ENDPOINT, S3_BUCKET, S3_REGION, S3_ACCESS_KEY, S3_SECRET_KEY  (S3 access)
#   MISTRAL_API_KEY                                                  (vision/multizone routes)
# lib/s3.ts now reads S3_* straight from process.env when no s3.env file exists
# (we deliberately materialise NOTHING to disk — secrets stay in env only).
# zonage-norms-batch.ts reads MISTRAL_API_KEY from process.env the same way.
#
# Two modes (MODE env, default extract):
#   extract  EXTRACT-ONLY — pull staged PDFs from s3://$S3_BUCKET/sources/
#            qc-zonage-grilles/ (+ its manifest) then extract+deposit. NO egress
#            to municipal sites needed → robust default.
#   full     FULL — run grille discovery (needs OUTBOUND egress to muni sites),
#            then extract+deposit. Use only if Scaleway egress is confirmed.
#
# Tunables (ENV): LIMIT (discovery cap), NORMS_BUDGET_USD (per-muni $ cap),
#   DELAY_MS (discovery politeness), NORMS_MANIFEST (override manifest path).
# Idempotent: the batch HEAD-skips any slug already deposited in
#   registry/qc-zonage-norms/, so re-runs never redo paid vision passes.
set -euo pipefail

ts() { date -u +%H:%M:%S; }
MODE="${MODE:-extract}"
echo "[$(ts)] normes-job MODE=$MODE node=$(node -v) pdftoppm=$(pdftoppm -v 2>&1 | head -1)"
# Presence-only checks — NEVER echo a secret value.
for v in S3_ENDPOINT S3_BUCKET S3_REGION S3_ACCESS_KEY S3_SECRET_KEY; do
  [ -n "${!v:-}" ] && echo "[$(ts)] env $v: set" || echo "[$(ts)] env $v: MISSING"
done
[ -n "${MISTRAL_API_KEY:-}" ] && echo "[$(ts)] env MISTRAL_API_KEY: set" \
  || echo "[$(ts)] env MISTRAL_API_KEY: MISSING (vision/multizone will fail)"

cd /geo/acquisition

if [ "$MODE" = "full" ]; then
  # FULL: province-wide (or LIMIT-capped) discovery + download + route-guess.
  # robots ON by default; politeness delay honoured. Writes work/zonage-norms/
  # discovered.json + the per-slug grille.pdf the batch consumes.
  echo "[$(ts)] discovery (limit=${LIMIT:-all} delay=${DELAY_MS:-2000}ms)"
  tsx src/grille-discovery-run.ts \
    ${LIMIT:+--limit "$LIMIT"} \
    --2hop --download --route-guess --delay-ms "${DELAY_MS:-2000}"
  # The batch reads work/zonage-norms/munis.json by default; discovery wrote
  # discovered.json. Point the batch at it (route!=auto already set by route-guess;
  # the batch + per-muni runner skip the 'auto' rows that found no extractable grille).
  MANIFEST="${NORMS_MANIFEST:-/geo/work/zonage-norms/discovered.json}"
else
  # EXTRACT-ONLY: pull staged PDFs + manifest from S3 (no muni egress).
  echo "[$(ts)] pull staged grilles from s3://$S3_BUCKET/sources/qc-zonage-grilles/"
  tsx src/pull-grilles-s3.ts
  MANIFEST="${NORMS_MANIFEST:-/geo/work/zonage-norms/munis.json}"
fi

# Filter route!=auto: drop rows discovery could not route to a real extractor
# (an 'auto' row = no grille located → the runner would deposit 0 zones). This
# keeps the batch focused on native/vision/multizone work. Pure node, no deps.
FILTERED="/geo/work/zonage-norms/_job-manifest.json"
node -e '
  const fs=require("fs");
  const raw=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
  const munis=Array.isArray(raw)?raw:(raw.munis||Object.values(raw));
  const kept=munis.filter(m=>m&&m.slug&&(m.route??"auto")!=="auto");
  fs.writeFileSync(process.argv[2],JSON.stringify({munis:kept},null,2));
  console.error(`[filter] route!=auto kept=${kept.length}/${munis.length}`);
' "$MANIFEST" "$FILTERED"

echo "[$(ts)] batch extract+deposit (manifest=$FILTERED budget=\$${NORMS_BUDGET_USD:-4}/muni)"
# The batch logs '=== FIN BATCH NORMES (ok=.. fail=.. skip=..) ===' and each
# per-muni deposit JSON (rows, uniqueZoneCodes, visionUsd). Idempotent skips.
tsx src/zonage-norms-batch.ts "$FILTERED"

echo "[$(ts)] ALL DONE"
