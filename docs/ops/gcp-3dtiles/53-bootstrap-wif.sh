#!/usr/bin/env bash
# Phase 53 / runbook — BOOTSTRAP Workload Identity Federation (WIF) pour l'exécuteur geo §5.
#
# ⚠⚠ À LANCER PAR L'OWNER (iam-admin), UNE FOIS. Ne s'exécute jamais auto / SA / CI / geo-socle
# (authoring only, committé pour être reviewable + rejouable). Crée le WIF Pool + Provider qui laisse
# les GitHub Actions du repo rhanka/geo (depuis l'ENVIRONMENT PROTÉGÉ) s'authentifier à GCP en KEYLESS
# (OIDC fédéré) → impersoner geo-cap-executor (52-bootstrap-geo-executor.sh). PRODUIT le principalSet
# = BASE_IDENTITY de #328.
#
# ⚠ TRUST SCOPÉ ÉTROITEMENT (note i-infra — le boundary qui manque sinon) : la condition d'attribut
# limite au repo rhanka/geo ET à l'environment protégé (PAS repo-only : sinon n'importe quel workflow
# du repo pourrait fédérer → impersoner l'exécuteur). Idempotent + self-verifying + fail-loud.
# project-scope (radar-3dtiles-preprod) ; 0 billing-account.
#
# Variables : PROJECT_ID (env.sh). WIF_POOL (défaut geo-ci-pool). WIF_PROVIDER_ID (défaut github).
#   WIF_ENV = le GitHub Environment protégé attendu (défaut geo-preprod). GH_REPO (défaut rhanka/geo).
set -euo pipefail
source "$(dirname "$0")/env.sh"
WIF_POOL="${WIF_POOL:-geo-ci-pool}"
WIF_PROVIDER_ID="${WIF_PROVIDER_ID:-github}"
WIF_ENV="${WIF_ENV:-geo-preprod}"
GH_REPO="${GH_REPO:-rhanka/geo}"
EXECUTOR_SA="geo-cap-executor@${PROJECT_ID}.iam.gserviceaccount.com"
COND="assertion.repository=='${GH_REPO}' && assertion.environment=='${WIF_ENV}'"

echo "=== BOOTSTRAP WIF — projet ${PROJECT_ID} (owner/iam-admin, une fois) ==="

# 1. Pool (idempotent).
gcloud iam workload-identity-pools create "$WIF_POOL" --project "$PROJECT_ID" --location=global \
  --display-name="geo CI WIF pool" 2>/dev/null || echo "  (pool ${WIF_POOL} déjà présent)"

# 2. Provider OIDC GitHub — TRUST SCOPÉ (repo + environment protégé), attribute-mapping.
#    attribute-condition = LA garde: seul rhanka/geo depuis l'env protégé peut fédérer (pas repo-only).
if gcloud iam workload-identity-pools providers describe "$WIF_PROVIDER_ID" --project "$PROJECT_ID" \
     --location=global --workload-identity-pool="$WIF_POOL" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers update-oidc "$WIF_PROVIDER_ID" --project "$PROJECT_ID" \
    --location=global --workload-identity-pool="$WIF_POOL" --attribute-condition="$COND"
else
  gcloud iam workload-identity-pools providers create-oidc "$WIF_PROVIDER_ID" --project "$PROJECT_ID" \
    --location=global --workload-identity-pool="$WIF_POOL" --display-name="GitHub Actions (${GH_REPO})" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.environment=assertion.environment,attribute.ref=assertion.ref" \
    --attribute-condition="$COND"
fi

# 3. Résout le principalSet (= BASE_IDENTITY de #328) + les noms de ressources. Ils CONTIENNENT le
#    PROJECT_NUMBER → ce sont des GitHub Variables (jamais committées), affichées ici au RUNTIME.
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
POOL_RES="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL}"
PRINCIPAL_SET="principalSet://iam.googleapis.com/${POOL_RES}/attribute.repository/${GH_REPO}"
PROVIDER_RES="${POOL_RES}/providers/${WIF_PROVIDER_ID}"

# 4. self-verify + fail-loud.
gcloud iam workload-identity-pools describe "$WIF_POOL" --project "$PROJECT_ID" --location=global >/dev/null \
  || { echo "❌ WIF pool absent"; exit 1; }
gcloud iam workload-identity-pools providers describe "$WIF_PROVIDER_ID" --project "$PROJECT_ID" \
  --location=global --workload-identity-pool="$WIF_POOL" --format='value(attributeCondition)' \
  | grep -q "assertion.environment" || { echo "❌ provider sans condition environment (trust trop large)"; exit 1; }

echo "✅ WIF prêt (trust: repo=${GH_REPO} + environment=${WIF_ENV} — PAS repo-only)."
echo "   → BASE_IDENTITY (pour 52-bootstrap-geo-executor.sh) = ${PRINCIPAL_SET}"
echo "   → GitHub Variable WIF_PROVIDER (jamais committée, contient le project-number) = ${PROVIDER_RES}"
echo "   → GitHub Variable CAP_EXECUTOR_SA = ${EXECUTOR_SA}"
echo "   SUIVANT: 52-bootstrap-geo-executor.sh avec BASE_IDENTITY='${PRINCIPAL_SET}' (+ GRANT_KEY_CREATION=yes si option-A clé)."
