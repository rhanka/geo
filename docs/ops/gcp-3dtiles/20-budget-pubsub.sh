#!/usr/bin/env bash
# Phase 20 / runbook steps C+D — Pub/Sub topic + 50€ budget (50/90/100% alerts)
# [couche 1]. No spend (a budget is a CAP). Budget is PROJECT-filtered, NOT
# billing-account-wide. Needs BILLING_ACCOUNT (owner-direct, supplied at exec).
# Run BEFORE phase 30 so any micro-spend of the Function deploy is already capped.
source "$(dirname "$0")/env.sh"
: "${BILLING_ACCOUNT:?owner-direct, non committé}"

gcloud pubsub topics create "$TOPIC" --project "$PROJECT_ID"
gcloud billing budgets create --billing-account="$BILLING_ACCOUNT" \
  --display-name="3dtiles-50eur-hardcap" --filter-projects="projects/${PROJECT_ID}" \
  --budget-amount="$BUDGET_AMOUNT" \
  --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0 \
  --notifications-rule-pubsub-topic="projects/${PROJECT_ID}/topics/${TOPIC}"
