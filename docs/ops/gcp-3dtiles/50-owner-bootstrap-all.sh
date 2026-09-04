#!/usr/bin/env bash
# Phase 50 / runbook — WRAPPER owner-bootstrap (part OWNER du SPLIT : GCP + GitHub SEULEMENT).
#
# ⚠⚠ À LANCER PAR L'OWNER, UNE FOIS, dans SON PROPRE terminal (son login iam-admin GCP + github-admin —
# JAMAIS une session agent/geo-socle/SA/CI ; geo-socle ne manie jamais les creds root). C'est le 1er grant
# = racine de confiance NON-AUTO-GRANTABLE. APRÈS, TOUTES les ops (reattach/clé/deploy/activation) tournent
# en GitHub Actions keyless (WIF), déclenchées par un GO owner = merge OU dispatch approuvé — 0 terminal.
#
# ⚠ SPLIT (mesuré : l'owner n'a PAS d'accès kubectl OVH ; le cluster preprod = OVH poc-ca/bhs5, tenant
# poc-k8s). Ce wrapper fait UNIQUEMENT ce que l'owner PEUT : GCP (WIF + executor) + GitHub
# (Environment/Variables/GEO_S3_ENV). Les parts K8S (RBAC §5 geo-ci-runner + Role activation ; KUBE_CONFIG_GEO
# via 54 ; secret geo-tile-key VIDE) = HAND-OFF poc-k8s (OVH admin) — cf OWNER-BOOTSTRAP.md §hand-off. Modèle
# repo « socle construit ; poc-k8s applique ». Split ratifié geo-archi + i-infra. « Poser ≠ activer ».
#
# CHAÎNE END-TO-END, idempotent + fail-loud (set -e) + self-verify. 0 secret/keyString imprimé ; les sorties
# porteuses de project-number (WIF_PROVIDER) → GitHub Variables (jamais committées). 0 littéral (repo PUBLIC).
#
# Ordre : préflight (gcloud+gh auth owner) → Environment (le GATE) → 53 (WIF) → 52 (executor) → Variables →
#   GEO_S3_ENV guidé → self-verify.
#
# Variables : PROJECT_ID (env.sh). GH_REPO (défaut rhanka/geo). WIF_ENV (défaut geo-preprod = nom de
#   l'Environment GitHub — DISTINCT du ns k8s homonyme sur OVH). EXPECT_OWNER (défaut rhanka). GRANT_KEY_CREATION
#   (défaut yes = ARME la capacité clé, PAS la clé/activation). PREPROD_OGC_URL (optionnel).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/env.sh"
GH_REPO="${GH_REPO:-rhanka/geo}"
WIF_ENV="${WIF_ENV:-geo-preprod}"
WIF_POOL="${WIF_POOL:-geo-ci-pool}"
WIF_PROVIDER_ID="${WIF_PROVIDER_ID:-github}"
EXPECT_OWNER="${EXPECT_OWNER:-rhanka}"
GRANT_KEY_CREATION="${GRANT_KEY_CREATION:-yes}"
export GH_REPO WIF_ENV WIF_POOL WIF_PROVIDER_ID

echo "=== 50 · owner-bootstrap (GCP + GitHub) — projet ${PROJECT_ID}, repo ${GH_REPO} (owner-run, une fois) ==="

# ── 0. Préflight : auth owner (fail-loud, JAMAIS d'auto-login). PAS de kubectl (les parts k8s = poc-k8s/OVH). ──
for t in gcloud gh; do command -v "$t" >/dev/null || { echo "❌ ${t} absent"; exit 1; }; done
gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q . \
  || { echo "❌ gcloud non authentifié. Lance d'abord (UNE fois, ton login iam-admin) : gcloud auth login"; exit 1; }
gh auth status >/dev/null 2>&1 \
  || { echo "❌ gh non authentifié. Lance d'abord (UNE fois, ton login github-admin) : gh auth login"; exit 1; }

# ── 0b. Assert que le login gh EST l'owner attendu (le wrapper POSE le gate — ne pas viser la mauvaise personne). ──
AUTHED_LOGIN="$(gh api user --jq '.login')"
[ "$AUTHED_LOGIN" = "$EXPECT_OWNER" ] \
  || { echo "❌ gh authentifié comme '${AUTHED_LOGIN}', attendu '${EXPECT_OWNER}' — refus (le reviewer pointerait la mauvaise personne)"; exit 1; }
OWNER_ID="$(gh api user --jq '.id')"
echo "✅ préflight OK (gcloud+gh authentifiés owner=${AUTHED_LOGIN})."

# ── 1. Environment GitHub geo-preprod : required-reviewer=owner (LE GATE) — AVANT tout secret env-scopé. ──
gh api --method PUT "repos/${GH_REPO}/environments/${WIF_ENV}" --input - >/dev/null <<EOF
{"reviewers":[{"type":"User","id":${OWNER_ID}}]}
EOF

# ── 2. WIF pool + provider (53) → produit BASE_IDENTITY. ─────────────────────────────────────────────
bash "$HERE/53-bootstrap-wif.sh"
# Re-dérive les valeurs (mêmes noms/defaults que 53) plutôt que parser l'echo ; project-number = runtime-only.
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
POOL_RES="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL}"
BASE_IDENTITY="principalSet://iam.googleapis.com/${POOL_RES}/attribute.repository/${GH_REPO}"
WIF_PROVIDER="${POOL_RES}/providers/${WIF_PROVIDER_ID}"
CAP_EXECUTOR_SA="geo-cap-executor@${PROJECT_ID}.iam.gserviceaccount.com"

# ── 3. Executor least-priv (52), consomme BASE_IDENTITY. ─────────────────────────────────────────────
BASE_IDENTITY="$BASE_IDENTITY" GRANT_KEY_CREATION="$GRANT_KEY_CREATION" bash "$HERE/52-bootstrap-geo-executor.sh"

# ── 4. Variables GitHub env-scopées : WIF_PROVIDER / CAP_EXECUTOR_SA (portent le project-number → Variables). ──
gh variable set WIF_PROVIDER    -R "$GH_REPO" --env "$WIF_ENV" --body "$WIF_PROVIDER"
gh variable set CAP_EXECUTOR_SA -R "$GH_REPO" --env "$WIF_ENV" --body "$CAP_EXECUTOR_SA"
if [ -n "${PREPROD_OGC_URL:-}" ]; then gh variable set PREPROD_OGC_URL -R "$GH_REPO" --env "$WIF_ENV" --body "$PREPROD_OGC_URL"; fi

# ── 5. GEO_S3_ENV (Scaleway RO) : cred owner-fournie (console IAM), guidée, jamais capturée ici. ──────
if gh secret list -R "$GH_REPO" --env "$WIF_ENV" 2>/dev/null | grep -q '^GEO_S3_ENV'; then
  echo "  (GEO_S3_ENV déjà posé — laissé tel quel)"
else
  echo "  ↳ GEO_S3_ENV absent. Mint une clé Scaleway RO (OWNER-BOOTSTRAP.md [d], recette i-infra 2-couches),"
  echo "    écris les 5 lignes S3_ENDPOINT/S3_REGION/S3_BUCKET/S3_ACCESS_KEY/S3_SECRET_KEY dans un .env, puis :"
  echo "    gh secret set GEO_S3_ENV -R ${GH_REPO} --env ${WIF_ENV} < ce.env && shred -u ce.env"
fi
[ -n "${PREPROD_OGC_URL:-}" ] || echo "  ↳ PREPROD_OGC_URL non fourni : gh variable set PREPROD_OGC_URL -R ${GH_REPO} --env ${WIF_ENV} --body '<ingress geo-api preprod>' (quand il existe)."

# ── 6. Self-verify end-to-end (fail-loud) — GCP executor + le GATE lui-même (required-reviewer). ──────
gcloud iam service-accounts describe "$CAP_EXECUTOR_SA" >/dev/null || { echo "❌ executor SA absent"; exit 1; }
gh variable list -R "$GH_REPO" --env "$WIF_ENV" | grep -q '^WIF_PROVIDER' || { echo "❌ WIF_PROVIDER non posé"; exit 1; }
gh api "repos/${GH_REPO}/environments/${WIF_ENV}" --jq '.protection_rules[].reviewers[].reviewer.id' | grep -qx "$OWNER_ID" \
  || { echo "❌ required-reviewer=owner ABSENT sur l'Environment ${WIF_ENV} — le GATE n'est pas en place"; exit 1; }

echo ""
echo "✅ BOOTSTRAP OWNER (GCP + GitHub) COMPLET (idempotent, self-verified, gate vérifié)."
echo "   • Environment ${WIF_ENV} : required-reviewer=owner (gate owner par dispatch) — RE-LU + confirmé."
echo "   • Variables ENV-scopées : WIF_PROVIDER (porte le project-number), CAP_EXECUTOR_SA. GEO_S3_ENV : voir ci-dessus si absent."
echo "   ⚠ HAND-OFF poc-k8s (OVH — cf OWNER-BOOTSTRAP.md §hand-off) pour COMPLÉTER le bootstrap :"
echo "       applique deploy/ci/geo-ci-rbac.yaml (SA §5 geo-ci-runner + Role activation) + lance 54-gen-kubeconfig.sh"
echo "       (pose KUBE_CONFIG_GEO --env ${WIF_ENV}, ATOMIQUE même session) + pré-crée le secret geo-tile-key VIDE."
echo "       poc-k8s pose l'identité INERTE ; l'ACTIVATION reste owner-GO (merge #335 ODbL + approve #334 dispatch)."
echo "   ⚠ GRANT_KEY_CREATION=${GRANT_KEY_CREATION} = capacité de créer la clé ARMÉE (PAS la clé/activation ; mint réel money-gated)."
