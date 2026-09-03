#!/usr/bin/env bash
# Phase 30 / runbook steps E+F — least-priv service account
# (roles/billing.projectManager, PROJECT-scope) + deploy the cap-billing Cloud
# Function [couche 2 = the REAL hard-cap: detaches billing at threshold]. BEFORE
# the key. Needs billing ACTIVE (owner step A done first). Source = ../cap-billing.
source "$(dirname "$0")/env.sh"

gcloud iam service-accounts create cap-billing-sa --project "$PROJECT_ID" 2>/dev/null || true
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" --role="roles/billing.projectManager"
gcloud functions deploy cap-billing --gen2 --runtime=nodejs20 --region="$REGION" \
  --project "$PROJECT_ID" --trigger-topic="$TOPIC" --entry-point=capBilling \
  --service-account="$SA_EMAIL" --source="$(dirname "$0")/../cap-billing"
gcloud functions describe cap-billing --region="$REGION" --project "$PROJECT_ID" \
  --format="value(state,eventTrigger.pubsubTopic)"
