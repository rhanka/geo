#!/usr/bin/env bash
# Phase 54 / runbook — GÉNÈRE le secret GitHub KUBE_CONFIG_GEO (kubeconfig du SA CI geo-ci-runner).
#
# ⚠ À LANCER PAR L'OWNER (admin cluster + admin repo GitHub), APRÈS que l'Environment geo-preprod existe ([c]).
# Mint un token BORNÉ (TokenRequest — PAS un token éternel, boundary i-infra) pour le SA k8s
# geo-ci-runner (ns geo-preprod, RBAC #327), assemble un kubeconfig minimal (token SA seul, AUCUNE
# cred admin), le pousse en secret GitHub, puis SHRED le fichier. Le token n'est JAMAIS imprimé
# (mktemp + chmod 600 + trap-cleanup ; pas de echo ; pas de set -x). Idempotent + self-verify + fail-loud.
#
# ⚠ Token BORNÉ ⇒ il EXPIRE (TTL demandé ci-dessous, plafonné par le max cluster). Re-lancer ce script
# AVANT expiry = rotation (rien d'éternel). La CI échoue loud à expiry (pas de dégradation silencieuse).
#
# Variables : SA (défaut geo-ci-runner). NS (défaut geo-preprod). GH_REPO (défaut rhanka/geo).
#   TOKEN_TTL (défaut 720h ; plafonné cluster). CLUSTER_NAME (défaut geo-preprod).
#   SECRET_ENV (défaut geo-preprod) = l'Environment GitHub qui SCOPE le secret (gate required-reviewer).
set -euo pipefail
SA="${SA:-geo-ci-runner}"
NS="${NS:-geo-preprod}"
GH_REPO="${GH_REPO:-rhanka/geo}"
TOKEN_TTL="${TOKEN_TTL:-720h}"
CLUSTER_NAME="${CLUSTER_NAME:-geo-preprod}"
SECRET_ENV="${SECRET_ENV:-geo-preprod}" # ENV-scope le secret (derrière required-reviewer=owner) — PAS repo-scopé (sinon lisible hors-gate sur repo public, MUST i-infra)

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

# ⚠ L'Environment DOIT exister AVEC required-reviewer=owner AVANT de poser le secret ENV-scopé (flag geo-archi,
# enforcement DURE). Sinon `gh secret set --env` pourrait AUTO-CRÉER un Environment SANS reviewer → KUBE_CONFIG_GEO
# sur un gate ABSENT = lisible hors-gate = BYPASS. Fail-closed si l'env manque OU n'a pas de required-reviewer.
# (50 crée l'env AVEC le reviewer AVANT ce script — ordre A→B ; ce guard = défense-en-profondeur contre B-avant-A.)
gh api "repos/${GH_REPO}/environments/${SECRET_ENV}" >/dev/null 2>&1 \
  || { echo "❌ Environment ${SECRET_ENV} absent — crée-le d'abord AVEC required-reviewer=owner (50-owner-bootstrap-all.sh, ou runbook [c])"; exit 1; }
REQ_REVIEWERS="$(gh api "repos/${GH_REPO}/environments/${SECRET_ENV}" \
  --jq '[.protection_rules[]? | select(.type=="required_reviewers") | .reviewers[]?] | length' 2>/dev/null || echo 0)"
[ "${REQ_REVIEWERS:-0}" -ge 1 ] 2>/dev/null \
  || { echo "❌ Environment ${SECRET_ENV} SANS required-reviewer — refus (secret env-scopé sur un gate absent = BYPASS ; flag geo-archi). Pose le reviewer d'abord (50, ou runbook [c])."; exit 1; }
# Pousse le secret GitHub ENV-scopé (contenu du fichier, jamais echo) + shred (le trap couvre aussi les erreurs).
# base64 -w0 : le workflow (basemap-activate.yml step 5) fait `base64 -d` du secret → il ATTEND du base64
# (cohérent avec le pattern cd-preprod). Poser le YAML EN CLAIR → `base64: invalid input` côté workflow
# (mesuré run 33963774228). Le kubeconfig temp reste en clair pour le self-verify `auth can-i` ci-dessous.
base64 -w0 < "$KCFG" | gh secret set KUBE_CONFIG_GEO -R "$GH_REPO" --env "$SECRET_ENV"

# self-verify : le secret existe (env-scopé) + le kubeconfig est fonctionnel (RBAC #327 = list jobs dans le ns).
gh secret list -R "$GH_REPO" --env "$SECRET_ENV" | grep -q '^KUBE_CONFIG_GEO' || { echo "❌ secret KUBE_CONFIG_GEO (env-scopé) non posé"; exit 1; }
kubectl --kubeconfig "$KCFG" -n "$NS" auth can-i list jobs >/dev/null \
  || { echo "❌ le kubeconfig généré ne peut pas list jobs dans ${NS} (RBAC #327 ?)"; exit 1; }

# Expiry RÉELLEMENT accordé (note i-infra) : --duration est PLAFONNÉ par l'apiserver
# (--service-account-max-token-expiration, souvent 24-48h en managed) → le TTL accordé peut être < TOKEN_TTL.
# Best-effort : décoder l'exp du JWT pour une rotation exacte (le token n'est JAMAIS imprimé — il passe par
# le pipe, seul l'exp numérique en ressort).
GRANTED_EXP=""
if command -v python3 >/dev/null 2>&1; then
  GRANTED_EXP="$(kubectl --kubeconfig "$KCFG" config view --raw -o jsonpath='{.users[0].user.token}' \
    | python3 -c 'import sys,base64,json;t=sys.stdin.read().strip().split(".")[1];t+="="*(-len(t)%4);print(json.loads(base64.urlsafe_b64decode(t)).get("exp",""))' 2>/dev/null || true)"
fi
echo "✅ KUBE_CONFIG_GEO posé (SA ${NS}/${SA}, cred admin JAMAIS incluse)."
if [ -n "$GRANTED_EXP" ]; then
  echo "   Rotation : expiry ACCORDÉ (epoch)=${GRANTED_EXP} (TTL demandé=${TOKEN_TTL}, plafonné apiserver). Re-lancer AVANT."
else
  echo "   ⚠ Rotation : TTL demandé=${TOKEN_TTL} mais PLAFONNÉ par l'apiserver (souvent 24-48h en managed) →"
  echo "     expiry réel peut être <. Vérifier l'expiry accordé et re-lancer AVANT (la CI échoue loud à expiry)."
fi
