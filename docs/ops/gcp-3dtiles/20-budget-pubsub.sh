#!/usr/bin/env bash
# Phase 20 / runbook steps C+D — Pub/Sub topic + budget hard-cap (50/90/100% alerts)
# [couche 1]. No spend (a budget is a CAP). BUDGET_AMOUNT (env.sh) is in the billing
# ACCOUNT's currency (default 50; ~34€ on the CAD account — owner sets the headroom).
# Budget is PROJECT-filtered, NOT billing-account-wide. Needs BILLING_ACCOUNT
# (owner-direct, supplied at exec). Run BEFORE phase 30 so any micro-spend of the
# Function deploy is already capped.
source "$(dirname "$0")/env.sh"
: "${BILLING_ACCOUNT:?owner-direct, non committé}"

gcloud pubsub topics create "$TOPIC" --project "$PROJECT_ID"
gcloud billing budgets create --billing-account="$BILLING_ACCOUNT" \
  --display-name="3dtiles-budget-hardcap" --filter-projects="projects/${PROJECT_ID}" \
  --budget-amount="$BUDGET_AMOUNT" \
  --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0 \
  --notifications-rule-pubsub-topic="projects/${PROJECT_ID}/topics/${TOPIC}"
