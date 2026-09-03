#!/usr/bin/env bash
# Phase 30 / runbook steps E+F — least-priv service account + deploy the cap-billing Cloud
# Function [couche 2 = the REAL hard-cap]. BEFORE the key. Needs billing ACTIVE (owner step A
# done first). Source = ../cap-billing.
#
# HARD-CAP MECHANISM (path C1 — project-scoped): paths A (detach billing) and B (disable API) are
# dead (A needed a billing-account grant we refuse; B — a SA cannot disable tile even with
# serviceUsageAdmin). C1: at the cap the Function sets the CONSUMER QUOTA to 0 on the charged Map
# Tiles metrics (proven: a SA CAN — k8s probe rc=0). The SA needs only:
#  - a PROJECT-scoped CUSTOM role with serviceusage.quotas.update + .get. ⚠ quotas.update is
#    BIDIRECTIONAL (the MINIMAL grain — GCP has no decrease-only): kill-only is enforced in the
#    COMMITTED Function (hardcoded overrideValue "0"), NOT by the permission. See cap-billing/index.js.
#  - roles/run.invoker on the deployed Cloud Run service (gen2 = Cloud Run).
source "$(dirname "$0")/env.sh"

gcloud iam service-accounts create cap-billing-sa --project "$PROJECT_ID" 2>/dev/null || true

# Least-priv PROJECT-scoped custom role: set/read consumer quota overrides ONLY. Idempotent.
ROLE_ID="capBillingQuotaCapper"
if ! gcloud iam roles describe "$ROLE_ID" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam roles create "$ROLE_ID" --project "$PROJECT_ID" \
    --title="Cap-billing quota capper" \
    --description="Least-priv: set consumer quota overrides to cut billable spend at the budget cap (project-scoped)." \
    --permissions=serviceusage.quotas.update,serviceusage.quotas.get --stage=GA
fi
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" --role="projects/${PROJECT_ID}/roles/${ROLE_ID}"

# State != script: a MIGRATED live SA must end least-priv with {capBillingQuotaCapper, run.invoker}
# ONLY. Idempotently remove BOTH dead-mechanism residues (no-op || true if absent):
#  - path-A roles/billing.projectManager;
#  - path-B custom role capBillingApiDisabler {services.disable,.get} — unbind it AND delete its
#    now-orphaned role definition (dead mechanism — no lingering role).
gcloud projects remove-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" --role="roles/billing.projectManager" 2>/dev/null || true
gcloud projects remove-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" --role="projects/${PROJECT_ID}/roles/capBillingApiDisabler" 2>/dev/null || true
gcloud iam roles delete capBillingApiDisabler --project "$PROJECT_ID" 2>/dev/null || true

gcloud functions deploy cap-billing --gen2 --runtime=nodejs20 --region="$REGION" \
  --project "$PROJECT_ID" --trigger-topic="$TOPIC" --entry-point=capBilling \
  --service-account="$SA_EMAIL" --source="$(dirname "$0")/../cap-billing"
# gen2 Function = Cloud Run under the hood: the trigger's SA needs run.invoker on the service,
# else the Function is deployed but NEVER invoked. Granted AFTER deploy (the service must exist).
gcloud run services add-iam-policy-binding cap-billing --region="$REGION" --project "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" --role="roles/run.invoker"
gcloud functions describe cap-billing --region="$REGION" --project "$PROJECT_ID" \
  --format="value(state,eventTrigger.pubsubTopic)"
