#!/usr/bin/env bash
# Phase 50 / runbook — WRAPPER owner-bootstrap ALL (le SEUL geste irréductible du pivot GO-only).
#
# ⚠⚠ À LANCER PAR L'OWNER, UNE FOIS, dans SON PROPRE terminal (son login iam-admin + github-admin —
# JAMAIS une session agent/geo-socle/SA/CI ; geo-socle ne manie jamais les creds root). C'est le 1er grant
# = racine de confiance NON-AUTO-GRANTABLE (un système ne peut pas se donner son propre iam-admin). APRÈS
# ce run unique, TOUTES les ops (reattach/clé/deploy/activation) tournent en GitHub Actions keyless (WIF),
# déclenchées par un GO owner = merge OU dispatch approuvé (Environment required-reviewer=owner) — 0
# terminal, à vie.
#
# Ce wrapper CHAÎNE les sous-scripts committés + co-val'd END-TO-END, idempotent + fail-loud (set -e : STOP
# au 1er échec — jamais de bootstrap partiel demi-privilégié) + self-verify. Il n'imprime AUCUN
# secret/keyString ; les sorties porteuses de project-number (BASE_IDENTITY, WIF_PROVIDER) sont posées
# comme GitHub Variables (jamais committées/loggées). 0 littéral secret/project-number/billing-account
# (repo PUBLIC).
#
# Ordre (dépendances i-infra) : 53 (WIF → BASE_IDENTITY) → 52 (executor, consomme BASE_IDENTITY) →
#   54 (kubeconfig ; EXIGE le SA geo-ci-runner = RBAC #327 déjà appliqué) → Environment + gh secret/variable.
#
# Variables : PROJECT_ID (env.sh). GH_REPO (défaut rhanka/geo). WIF_ENV (défaut geo-preprod).
#   GRANT_KEY_CREATION (défaut yes = ARME la CAPACITÉ de créer la clé — PAS la clé, PAS l'activation ; le
#   mint réel reste money-gated derrière le GO activation séparé + la cert i-infra ré-attach+Function-armée).
#   PREPROD_OGC_URL (optionnel : posé comme Variable si fourni).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/env.sh"
GH_REPO="${GH_REPO:-rhanka/geo}"
WIF_ENV="${WIF_ENV:-geo-preprod}"
WIF_POOL="${WIF_POOL:-geo-ci-pool}"
WIF_PROVIDER_ID="${WIF_PROVIDER_ID:-github}"
GRANT_KEY_CREATION="${GRANT_KEY_CREATION:-yes}"
export GH_REPO WIF_ENV WIF_POOL WIF_PROVIDER_ID # les sous-scripts héritent des mêmes noms

echo "=== 50 · owner-bootstrap ALL — projet ${PROJECT_ID}, repo ${GH_REPO} (owner-run, une fois) ==="

# ── 0. Préflight : auth owner (fail-loud, JAMAIS d'auto-login) + outils + prérequis. ──────────────────
for t in gcloud gh kubectl; do command -v "$t" >/dev/null || { echo "❌ ${t} absent"; exit 1; }; done
gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q . \
  || { echo "❌ gcloud non authentifié. Lance d'abord (UNE fois, ton login iam-admin) : gcloud auth login"; exit 1; }
gh auth status >/dev/null 2>&1 \
  || { echo "❌ gh non authentifié. Lance d'abord (UNE fois, ton login github-admin) : gh auth login"; exit 1; }
kubectl -n "$WIF_ENV" get serviceaccount geo-ci-runner >/dev/null 2>&1 \
  || { echo "❌ SA ${WIF_ENV}/geo-ci-runner absent — applique d'abord la RBAC CI (#327, deploy/ci/geo-ci-rbac.yaml)"; exit 1; }
echo "✅ préflight OK (gcloud+gh authentifiés owner, kubectl, RBAC #327 présente)."

# ── 1. WIF pool + provider (53) → produit BASE_IDENTITY. ─────────────────────────────────────────────
bash "$HERE/53-bootstrap-wif.sh"
# Re-dérive les valeurs (mêmes noms/defaults que 53) plutôt que parser l'echo ; project-number = runtime-only.
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
POOL_RES="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL}"
BASE_IDENTITY="principalSet://iam.googleapis.com/${POOL_RES}/attribute.repository/${GH_REPO}"
WIF_PROVIDER="${POOL_RES}/providers/${WIF_PROVIDER_ID}"
CAP_EXECUTOR_SA="geo-cap-executor@${PROJECT_ID}.iam.gserviceaccount.com"

# ── 2. Executor least-priv (52), consomme BASE_IDENTITY. ─────────────────────────────────────────────
BASE_IDENTITY="$BASE_IDENTITY" GRANT_KEY_CREATION="$GRANT_KEY_CREATION" bash "$HERE/52-bootstrap-geo-executor.sh"

# ── 3. Kubeconfig CI borné (54) → pose le secret KUBE_CONFIG_GEO (token borné, cred admin jamais incluse). ──
bash "$HERE/54-gen-kubeconfig.sh"

# ── 4. Environment GitHub geo-preprod : required-reviewer=owner (gate owner par dispatch) + Variables WIF. ──
OWNER_ID="$(gh api user --jq '.id')"
gh api --method PUT "repos/${GH_REPO}/environments/${WIF_ENV}" --input - >/dev/null <<EOF
{"reviewers":[{"type":"User","id":${OWNER_ID}}]}
EOF
# WIF_PROVIDER / CAP_EXECUTOR_SA contiennent le project-number → Variables (jamais committées).
gh variable set WIF_PROVIDER    -R "$GH_REPO" --env "$WIF_ENV" --body "$WIF_PROVIDER"
gh variable set CAP_EXECUTOR_SA -R "$GH_REPO" --env "$WIF_ENV" --body "$CAP_EXECUTOR_SA"
if [ -n "${PREPROD_OGC_URL:-}" ]; then gh variable set PREPROD_OGC_URL -R "$GH_REPO" --env "$WIF_ENV" --body "$PREPROD_OGC_URL"; fi

# ── 5. GEO_S3_ENV (Scaleway RO) : cred owner-fournie (console IAM), guidée, jamais capturée ici. ──────
if gh secret list -R "$GH_REPO" --env "$WIF_ENV" 2>/dev/null | grep -q '^GEO_S3_ENV'; then
  echo "  (GEO_S3_ENV déjà posé — laissé tel quel)"
else
  echo "  ↳ GEO_S3_ENV absent. Mint une clé Scaleway RO (OWNER-BOOTSTRAP.md [c], recette i-infra 2-couches),"
  echo "    écris les 5 lignes S3_ENDPOINT/S3_REGION/S3_BUCKET/S3_ACCESS_KEY/S3_SECRET_KEY dans un .env, puis :"
  echo "    gh secret set GEO_S3_ENV -R ${GH_REPO} --env ${WIF_ENV} < ce.env && shred -u ce.env"
fi
[ -n "${PREPROD_OGC_URL:-}" ] || echo "  ↳ PREPROD_OGC_URL non fourni : gh variable set PREPROD_OGC_URL -R ${GH_REPO} --env ${WIF_ENV} --body '<ingress geo-api preprod>' (quand il existe)."

# ── 6. Self-verify end-to-end (fail-loud). ───────────────────────────────────────────────────────────
gcloud iam service-accounts describe "$CAP_EXECUTOR_SA" >/dev/null || { echo "❌ executor SA absent"; exit 1; }
gh secret list -R "$GH_REPO" | grep -q '^KUBE_CONFIG_GEO' || { echo "❌ KUBE_CONFIG_GEO non posé"; exit 1; }
gh variable list -R "$GH_REPO" --env "$WIF_ENV" | grep -q '^WIF_PROVIDER' || { echo "❌ WIF_PROVIDER non posé"; exit 1; }

echo ""
echo "✅ BOOTSTRAP COMPLET (idempotent, self-verified). Accès keyless armé :"
echo "   • Environment ${WIF_ENV} : required-reviewer=owner (gate owner par dispatch)."
echo "   • Variables : WIF_PROVIDER, CAP_EXECUTOR_SA (portent le project-number — Variables, jamais committées)."
echo "   • Secret : KUBE_CONFIG_GEO (token borné). GEO_S3_ENV / PREPROD_OGC_URL : voir ci-dessus si non posés."
echo "   ⇒ Désormais : TOUT (reattach/clé/deploy/activation) = GO-pur (merge OU dispatch approuvé), 0 terminal."
echo "   ⚠ GRANT_KEY_CREATION=${GRANT_KEY_CREATION} = capacité de créer la clé ARMÉE (PAS la clé, PAS l'activation ;"
echo "     mint réel money-gated derrière le GO activation séparé + la cert i-infra ré-attach+Function-armée)."
