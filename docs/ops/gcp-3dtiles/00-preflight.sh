#!/usr/bin/env bash
# §5 3D-Tiles GCP guardrail — phase 00: PREFLIGHT (read-only).
#
# Confirms gcloud is available and reports the active account/project BEFORE any
# state-changing phase (10+). Creates / spends / configures NOTHING. Part of the
# committed per-phase capitalisation of docs/ops/GCP_BUDGET_GUARDRAIL_3DTILES.md
# — no ad-hoc gcloud, no account-id / secret in the repo (this phase takes none).
#
# Run: bash docs/ops/gcp-3dtiles/00-preflight.sh
set -euo pipefail

echo "== gcloud version =="
gcloud version

echo "== authed accounts (the ACTIVE one is what every phase runs AS) =="
gcloud auth list

echo "== active config (project expected UNSET or radar-3dtiles-preprod) =="
gcloud config list
