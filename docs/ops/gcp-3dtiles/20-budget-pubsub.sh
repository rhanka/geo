#!/usr/bin/env bash
# Phase 20 / runbook steps C+D — Pub/Sub topic + budget hard-cap (50/90/100% alerts)
# [couche 1]. No spend (a budget is a CAP). BUDGET_AMOUNT (env.sh) is in the billing
# ACCOUNT's currency (default 50; ~34€ on the CAD account — owner sets the headroom).
# Budget is PROJECT-filtered, NOT billing-account-wide. Needs BILLING_ACCOUNT
# (owner-direct, supplied at exec). Run BEFORE phase 30 so any micro-spend of the
# Function deploy is already capped.
source "$(dirname "$0")/env.sh"
: "${BILLING_ACCOUNT:?owner-direct, non committé}"

# Idempotent + retry-on-propagation: skip if the topic already exists (re-run safe); else create
# with a bounded retry — on a JUST-created project the org-policy `resourceLocations` can still be
# propagating and the first create transiently fails (measured on the real test-kill, k8s).
if ! gcloud pubsub topics describe "$TOPIC" --project "$PROJECT_ID" >/dev/null 2>&1; then
  for attempt in 1 2 3 4 5; do
    if gcloud pubsub topics create "$TOPIC" --project "$PROJECT_ID"; then break; fi
    if [ "$attempt" -eq 5 ]; then echo "pubsub topics create failed after 5 attempts" >&2; exit 1; fi
    echo "topics create attempt $attempt failed (org-policy propagation?); retry in 6s" >&2
    sleep 6
  done
fi
gcloud billing budgets create --billing-account="$BILLING_ACCOUNT" \
  --display-name="3dtiles-budget-hardcap" --filter-projects="projects/${PROJECT_ID}" \
  --budget-amount="$BUDGET_AMOUNT" \
  --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0 \
  --notifications-rule-pubsub-topic="projects/${PROJECT_ID}/topics/${TOPIC}"
