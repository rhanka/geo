#!/usr/bin/env bash
# Phase 30 / runbook steps E+F — least-priv service account + deploy the cap-billing Cloud
# Function [couche 2 = the REAL hard-cap]. BEFORE the key. Needs billing ACTIVE (owner step A
# done first). Source = ../cap-billing.
#
# HARD-CAP MECHANISM (i-infra redesign — PROJECT-scoped, refuses the billing-account scope that
# GCP would otherwise require to detach billing): at the cap the Function DISABLES the billable
# Map Tiles API (tile.googleapis.com) — cutting the billable spend WITHOUT touching the billing
# account. So the SA needs only:
#  - a PROJECT-scoped CUSTOM role with serviceusage.services.disable + .get (least-priv — NO
#    billing permission, NO billing-account grant, NO owner scope ratification);
#  - roles/run.invoker on the deployed Cloud Run service (a gen2 Function is Cloud Run under the
#    hood; without it the eventarc trigger can never invoke it — measured on the test-kill, k8s).
source "$(dirname "$0")/env.sh"

gcloud iam service-accounts create cap-billing-sa --project "$PROJECT_ID" 2>/dev/null || true

# Least-priv PROJECT-scoped custom role: disable/get services ONLY (no billing perms). Idempotent
# (create only if absent) so the phase is re-runnable.
ROLE_ID="capBillingApiDisabler"
if ! gcloud iam roles describe "$ROLE_ID" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam roles create "$ROLE_ID" --project "$PROJECT_ID" \
    --title="Cap-billing API disabler" \
    --description="Least-priv: disable/get services to cut billable spend at the budget cap (project-scoped)." \
    --permissions=serviceusage.services.disable,serviceusage.services.get --stage=GA
fi
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" --role="projects/${PROJECT_ID}/roles/${ROLE_ID}"
# Remove any OLD project-scope roles/billing.projectManager a prior (path-A) run granted this SA, so
# a MIGRATED live SA ends with ONLY the least-priv custom role — not just a fresh replay. This is a
# project-scope REMOVE (never a billing-account grant); idempotent — a no-op (|| true) if absent.
gcloud projects remove-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" --role="roles/billing.projectManager" 2>/dev/null || true

gcloud functions deploy cap-billing --gen2 --runtime=nodejs20 --region="$REGION" \
  --project "$PROJECT_ID" --trigger-topic="$TOPIC" --entry-point=capBilling \
  --service-account="$SA_EMAIL" --source="$(dirname "$0")/../cap-billing"
# gen2 Function = Cloud Run under the hood: the trigger's SA needs run.invoker on the service,
# else the Function is deployed but NEVER invoked. Granted AFTER deploy (the service must exist).
gcloud run services add-iam-policy-binding cap-billing --region="$REGION" --project "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" --role="roles/run.invoker"
gcloud functions describe cap-billing --region="$REGION" --project "$PROJECT_ID" \
  --format="value(state,eventTrigger.pubsubTopic)"
