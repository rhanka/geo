#!/usr/bin/env bash
# Entrypoint du Job de capture. Les octets ne vivent jamais dans /scratch au-delà
# du pod : capturedFetch les pousse aussitôt en CAS S3; /scratch ne contient que
# le stdout/stderr temporaire, ensuite redigé et déposé en run.log.
set -eu

stamp() { date -u +%Y%m%dT%H%M%SZ; }
clock() { date -u +%H:%M:%S; }
required() {
  name="$1"
  if [ -z "${!name:-}" ]; then
    echo "[$(clock)] FATAL: $name is required" >&2
    exit 2
  fi
}

# cgroup v2 keeps the exact high-water mark for this one-container pod. Record
# it in the durable run log before uploading the log to S3: `kubectl top` is a
# point-in-time sample and would understate a short download spike.
record_memory_peak() {
  if [ -r /sys/fs/cgroup/memory.peak ]; then
    peak_bytes="$(cat /sys/fs/cgroup/memory.peak)"
    printf '[%s] capacity memory_peak_bytes=%s\n' "$(clock)" "$peak_bytes"
  else
    printf '[%s] capacity memory_peak_bytes=unavailable\n' "$(clock)"
  fi
}

required LANE
required WORKLIST
export NODE_OPTIONS="${NODE_OPTIONS:+${NODE_OPTIONS} }--dns-result-order=ipv4first"
export AWS_MAX_ATTEMPTS="${AWS_MAX_ATTEMPTS:-10}"
CAPTURE_RUNNER="${CAPTURE_RUNNER:-src/capture-worklist-run.ts}"
# Le seul autre runner admis est le contrat mono-ville de remplacement ArcGIS.
# Ne jamais évaluer une commande reçue de l'environnement : ce garde conserve
# l'image de capture GET-only et empêche un Job de contourner C-5 par `tsx`.
case "$CAPTURE_RUNNER" in
  src/capture-worklist-run.ts|src/zones-arcgis-replacement-capture-run.ts) ;;
  *)
    echo "[$(clock)] FATAL: CAPTURE_RUNNER is not an approved capture-only entrypoint" >&2
    exit 2
    ;;
esac
SHARD="${SHARD:-0}"
SHARDS="${SHARDS:-1}"
RUN_STAMP="${RUN_STAMP:-$(stamp)}"
# K8s backoff recreates the pod. Ajouter son UID au dernier segment garde chaque
# tentative durable au lieu d'écraser le manifest d'une tentative précédente.
POD_ATTEMPT="${POD_UID:-${HOSTNAME:-manual}}"
RUN_ID="${RUN_ID:-${LANE}-${RUN_STAMP}-${SHARD}-${POD_ATTEMPT}}"
export SHARD SHARDS RUN_ID

mkdir -p /scratch
RUN_LOG_PATH="/scratch/run.log"
export RUN_LOG_PATH
: >"$RUN_LOG_PATH"

for name in S3_ENDPOINT S3_BUCKET S3_REGION S3_ACCESS_KEY S3_SECRET_KEY; do
  if [ -n "${!name:-}" ]; then
    echo "[$(clock)] env $name: set" >>"$RUN_LOG_PATH"
  else
    echo "[$(clock)] env $name: MISSING" >>"$RUN_LOG_PATH"
  fi
done

# Ne pas utiliser tee : un log brut ne doit pas sortir durablement. L'uploader TS
# applique la rédaction C-6 avant l'écriture de capture/_runs/.../run.log.
set +e
tsx "$CAPTURE_RUNNER" >>"$RUN_LOG_PATH" 2>&1
RUNNER_STATUS=$?
set -e

record_memory_peak >>"$RUN_LOG_PATH"

set +e
tsx src/capture-run-log-upload.ts
UPLOAD_STATUS=$?
set -e

if [ "$UPLOAD_STATUS" -ne 0 ]; then
  echo "[$(clock)] FATAL: unable to persist redacted run.log" >&2
  exit "$UPLOAD_STATUS"
fi
exit "$RUNNER_STATUS"
