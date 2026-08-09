#!/usr/bin/env bash
# Entrypoint of the QC mass-acquisition k8s Job (REMOTE, DURABLE).
#
# ONE shard per pod. The orchestrator (acquisition/src/k8s-shard-run.ts) injects:
#   SLUGS   csv of this shard's muni slugs        (REQUIRED)
#   MODE    discover | extract | all              (default: all)
#   OUT     manifest path written by discover      (default: shard-local under WORK)
# plus the S3 creds (envFrom geo-s3-credentials) and MISTRAL_API_KEY
# (envFrom mistral-credentials). lib/s3.ts reads S3_* straight from the env when
# no s3.env file exists (we materialise NOTHING to disk — secrets stay in env).
#
# Modes:
#   discover  Run grille-discovery for SLUGS (needs OUTBOUND egress to muni sites):
#             confirm + download the grille PDFs + route-guess, write OUT manifest.
#             Does NOT call Mistral; deposits nothing to the norms registry.
#   extract   Assume PDFs already discovered+downloaded under WORK (or staged); run
#             the norms batch (Mistral) over OUT and deposit registry/qc-zonage-norms/.
#   all       discover THEN extract, in one pod. Default. Self-contained shard.
#
# A secret value is NEVER printed (presence-only checks). Idempotent: the batch
# HEAD-skips any slug already deposited in registry/qc-zonage-norms/, so re-runs
# never redo a paid vision pass.
set -euo pipefail

ts() { date -u +%H:%M:%S; }
MODE="${MODE:-all}"
WORK="/geo/work/zonage-norms"
OUT="${OUT:-$WORK/discovered-shard.json}"
DELAY_MS="${DELAY_MS:-2000}"

echo "[$(ts)] acquisition-job MODE=$MODE node=$(node -v) pdftoppm=$(pdftoppm -v 2>&1 | head -1)"
if [ -z "${SLUGS:-}" ]; then
  echo "[$(ts)] FATAL: SLUGS env is empty — nothing to do" >&2
  exit 2
fi
# Count slugs without printing site URLs/secrets; SLUGS itself is public muni names.
N_SLUGS=$(echo "$SLUGS" | tr ',' '\n' | grep -c . || true)
echo "[$(ts)] shard slugs=$N_SLUGS out=$OUT"

# Presence-only checks — NEVER echo a secret value.
for v in S3_ENDPOINT S3_BUCKET S3_REGION S3_ACCESS_KEY S3_SECRET_KEY; do
  [ -n "${!v:-}" ] && echo "[$(ts)] env $v: set" || echo "[$(ts)] env $v: MISSING"
done
[ -n "${MISTRAL_API_KEY:-}" ] && echo "[$(ts)] env MISTRAL_API_KEY: set" \
  || echo "[$(ts)] env MISTRAL_API_KEY: MISSING (vision/multizone deposits will fail)"

cd /geo/acquisition
mkdir -p "$WORK"

run_discover() {
  echo "[$(ts)] discover (slugs=$N_SLUGS delay=${DELAY_MS}ms) → $OUT"
  # robots ON by default; politeness delay honoured. Downloads each confirmed
  # grille PDF to work/zonage-norms/<slug>/grille.pdf and writes OUT manifest.
  tsx src/grille-discovery-run.ts \
    --slugs "$SLUGS" \
    --2hop --download --route-guess \
    --delay-ms "$DELAY_MS" \
    --out "$OUT"
}

run_extract() {
  if [ ! -f "$OUT" ]; then
    echo "[$(ts)] FATAL: manifest $OUT not found (run MODE=discover/all first)" >&2
    exit 3
  fi
  # Filter route!=auto: drop rows discovery could not route to a real extractor.
  FILTERED="$WORK/_shard-manifest.json"
  node -e '
    const fs=require("fs");
    const raw=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    const munis=Array.isArray(raw)?raw:(raw.munis||Object.values(raw));
    const kept=munis.filter(m=>m&&m.slug&&(m.route??"auto")!=="auto");
    fs.writeFileSync(process.argv[2],JSON.stringify({munis:kept},null,2));
    console.error(`[filter] route!=auto kept=${kept.length}/${munis.length}`);
  ' "$OUT" "$FILTERED"

  echo "[$(ts)] batch extract+deposit (manifest=$FILTERED budget=\$${NORMS_BUDGET_USD:-4}/muni)"
  # The batch logs '=== FIN BATCH NORMES (ok=.. fail=.. skip=..) ===' and each
  # per-muni deposit JSON. Idempotent S3 HEAD-skips. Reads MISTRAL_API_KEY/S3_*
  # straight from the pod env (no file on disk).
  tsx src/zonage-norms-batch.ts "$FILTERED"
}

case "$MODE" in
  discover) run_discover ;;
  extract)  run_extract ;;
  all)      run_discover; run_extract ;;
  *) echo "[$(ts)] FATAL: unknown MODE=$MODE (want discover|extract|all)" >&2; exit 4 ;;
esac

echo "[$(ts)] ALL DONE (shard slugs=$N_SLUGS mode=$MODE)"
