#!/usr/bin/env bash
# §5 3D-Tiles GCP guardrail — shared env (sourced by every phase script).
#
# ONE ${PROJECT_ID} sourced by ALL → the guard-rail AND the spend are the SAME
# project BY CONSTRUCTION (prevents a prod/preprod divergence). 0 secret in the
# repo: BILLING_ACCOUNT is owner-direct at exec time, NEVER committed.
# Canonical runbook: docs/ops/GCP_BUDGET_GUARDRAIL_3DTILES.md
set -euo pipefail

: "${PROJECT_ID:=radar-3dtiles-preprod}"   # préprod-first : CE projet = garde-fou ET dépense
: "${REGION:=europe-west1}"
: "${TOPIC:=billing-guardrail}"
: "${REFERRER:=https://*.sent-tech.ca/*}"
# BUDGET_AMOUNT is a PLAIN number in the BILLING ACCOUNT's OWN currency — NO currency
# suffix (a hardcoded currency suffix on a non-matching account = INVALID_ARGUMENT; the
# billing account here is CAD). Default 50 (account currency); the owner overrides for the
# intended headroom (e.g. ~75 on a CAD account for a ~50 EUR cap). Stays a hard CAP (no spend).
: "${BUDGET_AMOUNT:=50}"
: "${KEY_DISPLAY_NAME:=3dtiles-preprod-key}"
SA_EMAIL="cap-billing-sa@${PROJECT_ID}.iam.gserviceaccount.com"
# BILLING_ACCOUNT : owner-direct au moment de l'exec, JAMAIS committé.
