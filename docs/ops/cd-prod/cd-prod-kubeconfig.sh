#!/usr/bin/env bash
# cd-prod setup — PART poc-k8s (OVH). GÉNÈRE le secret GitHub `KUBE_CONFIG_DATA` (kubeconfig du SA
# least-priv qui déploie geo-api en PROD, ns `geo`, cluster live hlhedx). Analogue à l'atomic 54 du §5.
#
# ⚠ À LANCER PAR poc-k8s (admin cluster OVH + admin repo GitHub), APRÈS que l'owner ait créé l'Environment
# geo-prod (cd-prod-owner-setup.sh). Mint un token BORNÉ (TokenRequest — rien d'éternel) pour le SA, assemble
# un kubeconfig minimal (token SA seul, AUCUNE cred admin), le pousse en secret GitHub ENV-scopé geo-prod,
# puis shred. Token JAMAIS imprimé (mktemp+chmod600+trap ; pas de echo ; pas de set -x). Atomic (mint+pose
# en 1 session, pas de handoff de token). Idempotent + self-verify + fail-loud.
#
# ⚠ Token BORNÉ ⇒ EXPIRE (TTL, plafonné cluster). Re-lancer AVANT expiry = rotation. La CI échoue loud à
# expiry (pas de dégradation silencieuse).
#
# PRÉREQUIS poc-k8s : le SA (défaut geo-cd-deployer) EXISTE dans ns geo AVEC un RBAC least-priv DEPLOY
# (get/patch deployments + apply des ressources de l'overlay prod ; rollout). poc-k8s pose ce RBAC (domaine
# cluster prod), comme geo-ci-rbac.yaml pour le §5 preprod.
#
# Variables : SA (défaut geo-cd-deployer). NS (défaut geo). GH_REPO (défaut rhanka/geo). TOKEN_TTL (défaut
# 720h ; plafonné cluster). CLUSTER_NAME (défaut geo-prod). SECRET_ENV (défaut geo-prod). SECRET_NAME
# (défaut KUBE_CONFIG_DATA).
set -euo pipefail
SA="${SA:-geo-cd-deployer}"
NS="${NS:-geo}"
GH_REPO="${GH_REPO:-rhanka/geo}"
TOKEN_TTL="${TOKEN_TTL:-720h}"
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

# Token BORNÉ via TokenRequest (jamais imprimé — écrit direct dans le kubeconfig temp).
{
  kubectl --kubeconfig "$KCFG" config set-cluster "$CLUSTER_NAME" --server="$SERVER" >/dev/null
  kubectl --kubeconfig "$KCFG" config set "clusters.${CLUSTER_NAME}.certificate-authority-data" "$CADATA" >/dev/null
  kubectl --kubeconfig "$KCFG" config set-credentials "$SA" \
    --token="$(kubectl -n "$NS" create token "$SA" --duration="$TOKEN_TTL")" >/dev/null
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

# Pousse le secret GitHub ENV-scopé (contenu du fichier, jamais echo) + shred (le trap couvre les erreurs).
gh secret set "$SECRET_NAME" -R "$GH_REPO" --env "$SECRET_ENV" < "$KCFG"

# self-verify : le secret existe (env-scopé) + le kubeconfig peut DÉPLOYER (patch deployments ns geo).
gh secret list -R "$GH_REPO" --env "$SECRET_ENV" | grep -q "^${SECRET_NAME}" || { echo "❌ secret ${SECRET_NAME} (env-scopé) non posé"; exit 1; }
kubectl --kubeconfig "$KCFG" -n "$NS" auth can-i patch deployments >/dev/null \
  || { echo "❌ le kubeconfig généré ne peut pas patch deployments dans ${NS} (RBAC deploy least-priv ?)"; exit 1; }

echo "✅ ${SECRET_NAME} posé (SA ${NS}/${SA}, cred admin JAMAIS incluse, env-scopé ${SECRET_ENV})."
echo "   Rotation : token BORNÉ (TTL demandé=${TOKEN_TTL}, PLAFONNÉ par l'apiserver) → re-lancer AVANT expiry."
echo "   ⇒ cd-prod peut désormais déployer sur GO owner (dispatch + approbation environment ${SECRET_ENV})."
