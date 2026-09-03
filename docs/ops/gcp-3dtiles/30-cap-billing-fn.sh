#!/usr/bin/env bash
# Phase 30 / runbook steps E+F — least-priv service account + deploy the cap-billing Cloud
# Function [couche 2 = the REAL hard-cap]. BEFORE the key. Needs billing ACTIVE (owner step A
# done first). Source = ../cap-billing.
#
# HARD-CAP MECHANISM (path C1 — project-scoped): paths A (detach billing) and B (disable API) are
# dead (A needed a billing-account grant we refuse; B — a SA cannot disable tile even with
# serviceUsageAdmin). C1: at the cap the Function sets the CONSUMER QUOTA to 0 on the charged Map
# Tiles metrics (proven: a SA CAN — k8s probe rc=0). The SA needs only:
#  - a PROJECT-scoped CUSTOM role with serviceusage.quotas.update + .get (the consumerOverrides
#    grain — measured PASS with serviceusage.* alone; cloudquotas.* is NOT required, k8s). ⚠ quotas.update
#    is BIDIRECTIONAL (the MINIMAL grain — GCP has no decrease-only): kill-only is enforced in the
#    COMMITTED Function (hardcoded overrideValue "0"), NOT by the permission. See cap-billing/index.js.
#  - roles/run.invoker on the deployed Cloud Run service (gen2 = Cloud Run).
source "$(dirname "$0")/env.sh"

gcloud iam service-accounts create cap-billing-sa --project "$PROJECT_ID" 2>/dev/null || true

# Least-priv PROJECT-scoped custom role: set/read consumer quota overrides ONLY. Idempotent AND
# CONVERGENT (create-or-update) so an already-existing role is realigned to THIS permission set —
# state=script, no drift (any ad-hoc grant is replaced by ROLE_PERMS on update). This convergence is
# the real fix: the #318 role already had the right perms; its runtime failure was OPERATIONAL (IAM
# propagation + a stale Cloud Run instance started before the binding propagated, never redeployed) —
# resolved by re-apply (settled propagation) + a FRESH Function redeploy, NOT by changing perms. The
# grain is serviceusage.quotas.* (the consumerOverrides create/list the Function makes): measured PASS
# with serviceusage.* alone, cloudquotas.* NOT required (k8s narrow+final tests). quotas.update is
# BIDIRECTIONAL (MINIMAL grain — GCP has no decrease-only): kill-only is enforced in the COMMITTED
# Function (hardcoded overrideValue "0"), not by the perm.
ROLE_ID="capBillingQuotaCapper"
ROLE_PERMS="serviceusage.quotas.get,serviceusage.quotas.update"
if ! gcloud iam roles describe "$ROLE_ID" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam roles create "$ROLE_ID" --project "$PROJECT_ID" \
    --title="Cap-billing quota capper" \
    --description="Least-priv: set consumer quota overrides to cut billable spend at the budget cap (project-scoped)." \
    --permissions="$ROLE_PERMS" --stage=GA
else
  gcloud iam roles update "$ROLE_ID" --project "$PROJECT_ID" \
    --permissions="$ROLE_PERMS" --stage=GA
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

# gen2 does NOT auto-inject GOOGLE_CLOUD_PROJECT (gen1-only) — pin it EXPLICITLY so the Function's
# serviceusage quota-project lands on THIS project (measured k8s: without it the client attributed the
# quotas.update check to a WRONG default project → PERMISSION_DENIED; index.js fails closed if unset).
gcloud functions deploy cap-billing --gen2 --runtime=nodejs20 --region="$REGION" \
  --project "$PROJECT_ID" --trigger-topic="$TOPIC" --entry-point=capBilling \
  --service-account="$SA_EMAIL" --source="$(dirname "$0")/../cap-billing" \
  --set-env-vars="CAP_PROJECT_ID=${PROJECT_ID}"
# gen2 Function = Cloud Run under the hood: the trigger's SA needs run.invoker on the service,
# else the Function is deployed but NEVER invoked. Granted AFTER deploy (the service must exist).
gcloud run services add-iam-policy-binding cap-billing --region="$REGION" --project "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" --role="roles/run.invoker"
gcloud functions describe cap-billing --region="$REGION" --project "$PROJECT_ID" \
  --format="value(state,eventTrigger.pubsubTopic)"
