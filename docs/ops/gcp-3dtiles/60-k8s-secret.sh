#!/usr/bin/env bash
# Phase 60 / runbook step I — put the Map Tiles key into a préprod k8s secret. The
# key is piped stdin→kubectl and NEVER echoed/logged. Runs AFTER the owner created
# the key (step H). Requires kubectl access to the préprod cluster (owner or
# k8s-domain). Set K8S_NS to the préprod namespace.
#
# CO-VAL (geo-socle gate): confirm the préprod deployment reads MAPTILES_API_KEY from
# secret ${SECRET_NAME} before relying on it.
source "$(dirname "$0")/env.sh"
: "${K8S_NS:?ns préprod requis}"
: "${SECRET_NAME:=maptiles-3dtiles-key}"

KEY_RES=$(gcloud services api-keys list --project "$PROJECT_ID" \
  --filter="displayName=${KEY_DISPLAY_NAME}" --format="value(name)")
test -n "$KEY_RES" || { echo "clé '${KEY_DISPLAY_NAME}' introuvable — H (création clé) fait ?"; exit 1; }
[[ "$(printf '%s\n' "$KEY_RES" | grep -c .)" -eq 1 ]] \
  || { echo "❌ >1 clé '${KEY_DISPLAY_NAME}' — ambigu, résoudre avant de créer le secret"; exit 1; }

gcloud services api-keys get-key-string "$KEY_RES" --format="value(keyString)" \
  | kubectl create secret generic "$SECRET_NAME" -n "$K8S_NS" --from-file=MAPTILES_API_KEY=/dev/stdin
