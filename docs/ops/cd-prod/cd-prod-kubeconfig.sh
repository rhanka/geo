#!/usr/bin/env bash
# cd-prod setup — PART poc-k8s (OVH). GÉNÈRE le secret GitHub `KUBE_CONFIG_DATA` (kubeconfig du SA
# least-priv qui déploie geo-api en PROD, ns `geo`, cluster live hlhedx). Analogue à l'atomic 54 du §5.
#
# ⚠ À LANCER PAR poc-k8s (admin cluster OVH + admin repo GitHub), APRÈS que l'owner ait créé l'Environment
# geo-prod (cd-prod-owner-setup.sh). Lit le token NON-EXPIRANT du SA depuis le Secret
# `kubernetes.io/service-account-token` lié au SA (défaut geo/geo-cd-deployer-token, manifeste poc-k8s
# tenants/geo/11-cd-deployer-token.yaml), assemble un kubeconfig minimal (token SA seul, AUCUNE cred admin),
# le pousse en secret GitHub ENV-scopé geo-prod, puis shred. Token JAMAIS imprimé (mktemp+chmod600+trap ;
# pas de echo ; pas de set -x). Atomic (lecture+pose en 1 session, pas de handoff de token). Idempotent +
# self-verify + fail-loud.
#
# Owner 2026-11-07 : « le token du ci cd doit pas avoir une durée limitée ». L'ancien mint borné
# (`kubectl create token`, TTL 720h) expirait entre deux déploiements espacés (cd-prod 42370436908 en échec
# « provide credentials »). NE PAS revenir à un token borné.
# Révocation / rotation : poc-k8s supprime puis recrée le Secret (le token est invalidé immédiatement), puis
# relance ce script. Procédure : runbook poc-k8s docs/runbooks/preprod-cred-governance.md, « Geo prod CD deployer ».
#
# PRÉREQUIS poc-k8s : le SA (défaut geo-cd-deployer) EXISTE dans ns geo AVEC un RBAC least-priv DEPLOY
# (get/patch deployments + apply des ressources de l'overlay prod ; rollout), ET le Secret token du SA existe
# et est peuplé. poc-k8s pose ces ressources (domaine cluster prod), comme geo-ci-rbac.yaml pour le §5 preprod.
#
# Variables : SA (défaut geo-cd-deployer). NS (défaut geo). GH_REPO (défaut rhanka/geo). TOKEN_SECRET (défaut
# geo-cd-deployer-token). CLUSTER_NAME (défaut geo-prod). SECRET_ENV (défaut geo-prod). SECRET_NAME
# (défaut KUBE_CONFIG_DATA).
set -euo pipefail
SA="${SA:-geo-cd-deployer}"
NS="${NS:-geo}"
GH_REPO="${GH_REPO:-rhanka/geo}"
TOKEN_SECRET="${TOKEN_SECRET:-geo-cd-deployer-token}"
CLUSTER_NAME="${CLUSTER_NAME:-geo-prod}"
SECRET_ENV="${SECRET_ENV:-geo-prod}"      # ENV-scope le secret (derrière required-reviewer=owner) — PAS repo-scopé
SECRET_NAME="${SECRET_NAME:-KUBE_CONFIG_DATA}"

command -v kubectl >/dev/null || { echo "❌ kubectl absent"; exit 1; }
command -v gh >/dev/null || { echo "❌ gh CLI absent"; exit 1; }
kubectl -n "$NS" get serviceaccount "$SA" >/dev/null 2>&1 \
  || { echo "❌ SA ${NS}/${SA} absent — pose d'abord le SA + RBAC least-priv deploy (domaine poc-k8s, cf. geo-ci-rbac.yaml §5)"; exit 1; }

KCFG="$(mktemp)"; chmod 600 "$KCFG"
trap 'rm -f "$KCFG"' EXIT

# Serveur API + CA depuis le kubeconfig admin courant de poc-k8s (contexte actif = hlhedx).
SERVER="$(kubectl config view --minify --raw -o jsonpath='{.clusters[0].cluster.server}')"
CADATA="$(kubectl config view --minify --raw -o jsonpath='{.clusters[0].cluster.certificate-authority-data}')"
[ -n "$SERVER" ] && [ -n "$CADATA" ] || { echo "❌ server/CA introuvables dans le kubeconfig courant"; exit 1; }

# Le Secret DOIT être un token de SA lié à CE SA (sinon on publierait le token d'une autre identité).
TS_TYPE="$(kubectl -n "$NS" get secret "$TOKEN_SECRET" -o jsonpath='{.type}' 2>/dev/null || true)"
TS_SA="$(kubectl -n "$NS" get secret "$TOKEN_SECRET" -o jsonpath='{.metadata.annotations.kubernetes\.io/service-account\.name}' 2>/dev/null || true)"
[ "$TS_TYPE" = "kubernetes.io/service-account-token" ] && [ "$TS_SA" = "$SA" ] \
  || { echo "❌ Secret ${NS}/${TOKEN_SECRET} absent ou pas un token du SA ${SA} (type='${TS_TYPE}', sa='${TS_SA}') — poc-k8s le pose d'abord (tenants/geo/11-cd-deployer-token.yaml)"; exit 1; }

# Token NON-EXPIRANT lu depuis le Secret (jamais imprimé — écrit direct dans le kubeconfig temp).
{
  kubectl --kubeconfig "$KCFG" config set-cluster "$CLUSTER_NAME" --server="$SERVER" >/dev/null
  kubectl --kubeconfig "$KCFG" config set "clusters.${CLUSTER_NAME}.certificate-authority-data" "$CADATA" >/dev/null
  TOKEN="$(kubectl -n "$NS" get secret "$TOKEN_SECRET" -o jsonpath='{.data.token}' | base64 -d)"
  [ -n "$TOKEN" ] || { echo "❌ Secret ${NS}/${TOKEN_SECRET} sans token (pas encore peuplé par le token controller ?)"; exit 1; }
  kubectl --kubeconfig "$KCFG" config set-credentials "$SA" --token="$TOKEN" >/dev/null
  unset TOKEN
  kubectl --kubeconfig "$KCFG" config set-context cd-prod \
    --cluster="$CLUSTER_NAME" --user="$SA" --namespace="$NS" >/dev/null
  kubectl --kubeconfig "$KCFG" config use-context cd-prod >/dev/null
}

# ⚠ L'Environment DOIT exister AVEC required-reviewer AVANT de poser le secret ENV-scopé (sinon
# `gh secret set --env` pourrait AUTO-CRÉER un Environment SANS reviewer → secret sur un gate ABSENT =
# lisible hors-gate = BYPASS). Fail-closed si l'env manque OU n'a pas de required-reviewer.
gh api "repos/${GH_REPO}/environments/${SECRET_ENV}" >/dev/null 2>&1 \
  || { echo "❌ Environment ${SECRET_ENV} absent — l'owner doit d'abord le créer AVEC required-reviewer (cd-prod-owner-setup.sh)"; exit 1; }
REQ_REVIEWERS="$(gh api "repos/${GH_REPO}/environments/${SECRET_ENV}" \
  --jq '[.protection_rules[]? | select(.type=="required_reviewers") | .reviewers[]?] | length' 2>/dev/null || echo 0)"
[ "${REQ_REVIEWERS:-0}" -ge 1 ] 2>/dev/null \
  || { echo "❌ Environment ${SECRET_ENV} SANS required-reviewer — refus (secret env-scopé sur un gate absent = BYPASS). L'owner pose le reviewer d'abord (cd-prod-owner-setup.sh)."; exit 1; }

# Pousse le secret GitHub ENV-scopé (jamais echo) + shred (le trap couvre les erreurs).
# FORMAT = kubeconfig ENCODÉ BASE64 sur une ligne : cd-prod.yml fait `printf '%s' "$KUBE_CONFIG_DATA" | base64 -d`.
# (Incident 2026-09-28 : le kubeconfig poussé en clair a fait échouer cd-prod sur « base64: invalid input ».)
# Contrôle aller-retour AVANT de pousser : le décodage doit redonner exactement le fichier.
KCFG_B64="$(base64 -w0 < "$KCFG")"
printf '%s' "$KCFG_B64" | base64 -d | cmp -s - "$KCFG" \
  || { echo "❌ encodage base64 du kubeconfig incohérent — rien poussé"; exit 1; }
printf '%s' "$KCFG_B64" | gh secret set "$SECRET_NAME" -R "$GH_REPO" --env "$SECRET_ENV"
unset KCFG_B64

# self-verify : le secret existe (env-scopé) + le kubeconfig peut DÉPLOYER les 3 KINDS de l'overlay prod
# (Deployment+Service+Ingress). On valide le RBAC COMPLET au provisioning (co-val i-infra) : un check
# `patch deployments` SEUL passerait même si services/ingresses manquent au RBAC → le deploy échouerait
# alors à l'apply, pas ici. Les 3 checks couvrent `kubectl apply -k overlays/prod`.
gh secret list -R "$GH_REPO" --env "$SECRET_ENV" | grep -q "^${SECRET_NAME}" || { echo "❌ secret ${SECRET_NAME} (env-scopé) non posé"; exit 1; }
for CHECK in "patch deployments" "patch services" "create ingresses.networking.k8s.io"; do
  # shellcheck disable=SC2086
  kubectl --kubeconfig "$KCFG" -n "$NS" auth can-i $CHECK >/dev/null \
    || { echo "❌ le kubeconfig généré ne peut pas '${CHECK}' dans ${NS} — RBAC deploy least-priv INCOMPLET (les 3 kinds Deployment/Service/Ingress sont requis pour apply -k overlays/prod)"; exit 1; }
done

echo "✅ ${SECRET_NAME} posé (SA ${NS}/${SA}, cred admin JAMAIS incluse, env-scopé ${SECRET_ENV})."
echo "   Token NON-EXPIRANT (Secret ${NS}/${TOKEN_SECRET}). Rotation/révocation : poc-k8s recrée le Secret, puis re-lancer ce script."
echo "   ⇒ cd-prod peut désormais déployer sur GO owner (dispatch + approbation environment ${SECRET_ENV})."
