#!/usr/bin/env bash
# deposit-job — INERT SKELETON (LOT-1 "vraies zones" served-zonage deposit). NOT WIRED FOR REAL.
#
# Wraps a PROVEN acquisition/src/zones-*-replace.ts runner to REPLACE a served qc-zonage collection with an
# in-force provider layer (ArcGIS / WFS / …), re-stamping proof v2 in the SAME pass (putServedZoneGeojson).
# It writes ONLY the served-zonage prefix `normalized/ca-qc-zonage/` (the runner's contract).
#
# ⚠ A′ ISOLATION (i-infra): the S3 cred MUST be the DEDICATED secret scoped to `normalized/ca-qc-zonage/*`
#   ONLY (envFrom in job-deposit.yaml = a PLACEHOLDER secret name, provisioned by the owner at LOT-1 go-line)
#   — NEVER the broad `geo-s3-credentials`, which would re-introduce the capture→served blast-radius A′ isolates.
# ⚠ INERT: MODE defaults to `inspect` → the runner writes NOTHING (validates gates + prints layout/recoupement).
#   A real deposit (MODE=deposit) is owner-gated (go-line + A′ secret provisioned) + i-infra co-val (least-priv).
#   A secret value is NEVER printed (presence-only). Backup/idempotency/anti-invention gates are the runner's.
set -euo pipefail
ts() { date -u +%H:%M:%S; }

RUNNER="${RUNNER:-zones-arcgis-replace.ts}"  # any committed proven acquisition/src/zones-*-replace.ts
MODE="${MODE:-inspect}"                        # inspect (default, NO write) | deposit (owner-gated)
RUNNER_ARGS="${RUNNER_ARGS:-}"                 # runner-specific flags, e.g. "--slug x --layer <url> --zone-field f"

echo "[$(ts)] deposit-job RUNNER=$RUNNER MODE=$MODE node=$(node -v)"
case "$MODE" in
  inspect|deposit) ;;
  *) echo "[$(ts)] FATAL: MODE=$MODE (want inspect|deposit)" >&2; exit 2 ;;
esac

# Presence-only checks of the DEDICATED A′ S3 cred (envFrom the placeholder secret) — NEVER echo a value.
for v in S3_ENDPOINT S3_BUCKET S3_REGION S3_ACCESS_KEY S3_SECRET_KEY; do
  [ -n "${!v:-}" ] && echo "[$(ts)] env $v: set" \
    || echo "[$(ts)] env $v: MISSING (A′ secret not provisioned — expected pre-go-line)"
done

if [ ! -f "/geo/acquisition/src/$RUNNER" ]; then
  echo "[$(ts)] FATAL: runner src/$RUNNER not found (want a committed zones-*-replace.ts)" >&2
  exit 3
fi

cd /geo/acquisition
echo "[$(ts)] run: tsx src/$RUNNER $RUNNER_ARGS --$MODE"
# RUNNER_ARGS is intentionally word-split (the orchestrator/operator supplies the exact runner flags; it must
# NOT itself carry --inspect/--deposit). --inspect writes nothing; --deposit backs up each served layout then
# putServedZoneGeojson (proof v2), readback-verified. S3 runs prefix ipv4first + AWS_MAX_ATTEMPTS (memory).
# shellcheck disable=SC2086
NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 tsx "src/$RUNNER" $RUNNER_ARGS "--$MODE"

echo "[$(ts)] deposit-job DONE (mode=$MODE)"
