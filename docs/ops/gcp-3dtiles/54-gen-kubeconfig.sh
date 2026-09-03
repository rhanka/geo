#!/usr/bin/env bash
# Phase 54 / runbook — GÉNÈRE le secret GitHub KUBE_CONFIG_GEO (kubeconfig du SA CI geo-ci-runner).
#
# ⚠ À LANCER PAR L'OWNER (admin cluster + admin repo GitHub), après [c] du OWNER-BOOTSTRAP.md.
# Mint un token BORNÉ (TokenRequest — PAS un token éternel, boundary i-infra) pour le SA k8s
# geo-ci-runner (ns geo-preprod, RBAC #327), assemble un kubeconfig minimal (token SA seul, AUCUNE
# cred admin), le pousse en secret GitHub, puis SHRED le fichier. Le token n'est JAMAIS imprimé
# (mktemp + chmod 600 + trap-cleanup ; pas de echo ; pas de set -x). Idempotent + self-verify + fail-loud.
#
# ⚠ Token BORNÉ ⇒ il EXPIRE (TTL demandé ci-dessous, plafonné par le max cluster). Re-lancer ce script
# AVANT expiry = rotation (rien d'éternel). La CI échoue loud à expiry (pas de dégradation silencieuse).
#
# Variables : SA (défaut geo-ci-runner). NS (défaut geo-preprod). GH_REPO (défaut rhanka/geo).
#   TOKEN_TTL (défaut 720h = 30j ; honoré jusqu'au plafond du cluster). CLUSTER_NAME (défaut geo-preprod).
set -euo pipefail
SA="${SA:-geo-ci-runner}"
NS="${NS:-geo-preprod}"
GH_REPO="${GH_REPO:-rhanka/geo}"
TOKEN_TTL="${TOKEN_TTL:-720h}"
CLUSTER_NAME="${CLUSTER_NAME:-geo-preprod}"

command -v kubectl >/dev/null || { echo "❌ kubectl absent"; exit 1; }
command -v gh >/dev/null || { echo "❌ gh CLI absent"; exit 1; }
kubectl -n "$NS" get serviceaccount "$SA" >/dev/null 2>&1 \
  || { echo "❌ SA ${NS}/${SA} absent — applique d'abord la RBAC CI (#327, deploy/ci/geo-ci-rbac.yaml)"; exit 1; }

KCFG="$(mktemp)"; chmod 600 "$KCFG"
trap 'rm -f "$KCFG"' EXIT

# Serveur API + CA depuis le kubeconfig admin courant de l'owner (contexte actif).
SERVER="$(kubectl config view --minify --raw -o jsonpath='{.clusters[0].cluster.server}')"
CADATA="$(kubectl config view --minify --raw -o jsonpath='{.clusters[0].cluster.certificate-authority-data}')"
[ -n "$SERVER" ] && [ -n "$CADATA" ] || { echo "❌ server/CA introuvables dans le kubeconfig courant"; exit 1; }

# Token BORNÉ via TokenRequest (jamais imprimé — écrit direct dans le kubeconfig temp via --token=@).
# kubectl >=1.24 : `create token`. Le token part sur stdin de la substitution, capté hors log.
{
  kubectl --kubeconfig "$KCFG" config set-cluster "$CLUSTER_NAME" \
    --server="$SERVER" >/dev/null
  # CA injectée en clair (déjà base64 dans le kubeconfig admin) sans la ré-encoder.
  kubectl --kubeconfig "$KCFG" config set "clusters.${CLUSTER_NAME}.certificate-authority-data" "$CADATA" >/dev/null
  kubectl --kubeconfig "$KCFG" config set-credentials "$SA" \
    --token="$(kubectl -n "$NS" create token "$SA" --duration="$TOKEN_TTL")" >/dev/null
  kubectl --kubeconfig "$KCFG" config set-context geo-ci \
    --cluster="$CLUSTER_NAME" --user="$SA" --namespace="$NS" >/dev/null
  kubectl --kubeconfig "$KCFG" config use-context geo-ci >/dev/null
}

# Pousse le secret GitHub (contenu du fichier, jamais echo) + shred (le trap couvre aussi les sorties d'erreur).
gh secret set KUBE_CONFIG_GEO -R "$GH_REPO" < "$KCFG"

# self-verify : le secret existe côté GitHub + le kubeconfig est fonctionnel (RBAC #327 = list jobs dans le ns).
gh secret list -R "$GH_REPO" | grep -q '^KUBE_CONFIG_GEO' || { echo "❌ secret KUBE_CONFIG_GEO non posé"; exit 1; }
kubectl --kubeconfig "$KCFG" -n "$NS" auth can-i list jobs >/dev/null \
  || { echo "❌ le kubeconfig généré ne peut pas list jobs dans ${NS} (RBAC #327 ?)"; exit 1; }

echo "✅ KUBE_CONFIG_GEO posé (SA ${NS}/${SA}, token borné ${TOKEN_TTL}, cred admin JAMAIS incluse)."
echo "   Rotation : re-lancer ce script avant expiry du token (${TOKEN_TTL})."
