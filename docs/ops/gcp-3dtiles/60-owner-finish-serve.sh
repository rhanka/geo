#!/usr/bin/env bash
# Phase 60 / runbook — FINISH RAPIDE (option B) : mettre la carte tile EN LIGNE. Owner-run, turnkey.
#
# ⚠⚠ À LANCER PAR L'OWNER, UNE FOIS, avec SA PROPRE connexion gcloud + kubectl (owner-full — l'option B
# n'a besoin NI de WIF NI de l'exécuteur #328 : l'owner fait tout directement). ~5min. Ce script ne
# s'exécute JAMAIS automatiquement, jamais par une SA/CI, jamais par geo-socle (authoring-only, committé
# pour être reviewable + rejouable). CRÉE UNE CLÉ BILLABLE → à lancer APRÈS que le cap est prouvé (certif
# i-infra) + la décision owner. Le cap-billing reste ARMÉ (re-cape au dépassement de budget).
# Idempotent (réutilise la clé/secret existants) + self-verifying + fail-loud. Le keyString n'est
# JAMAIS imprimé (fichier temp 600 + trap-cleanup ; wiré directement dans le secret k8s).
#
# Variables : PROJECT_ID (env.sh). KEY_DISPLAY_NAME (défaut "geo tile serve key").
#   KEY_SECRET_NS / KEY_SECRET_NAME = où le front lit la clé tile (défauts geo-preprod / geo-tile-key —
#   À CONFIRMER contre la conso réelle du front). ALLOWED_REFERRERS = referrer autorisé du navigateur.
set -euo pipefail
source "$(dirname "$0")/env.sh"
KEY_DISPLAY_NAME="${KEY_DISPLAY_NAME:-geo tile serve key}"
KEY_SECRET_NS="${KEY_SECRET_NS:-geo-preprod}"
KEY_SECRET_NAME="${KEY_SECRET_NAME:-geo-tile-key}"
ALLOWED_REFERRERS="${ALLOWED_REFERRERS:-https://*.sent-tech.ca/*}"

echo "=== FINISH-B (owner-run, une fois) — projet ${PROJECT_ID} — carte tile en ligne ==="

# 1. Ré-attach le quota (restaure le default pour qu'une clé serve). Réutilise le script committé.
echo "[1/4] ré-attach quota (51-reattach-quota.sh)…"
bash "$(dirname "$0")/51-reattach-quota.sh"

# 2. Clé API RESTREINTE (API=tile.googleapis.com SEULE + referrer navigateur). Idempotent : réutilise
#    une clé au même display-name si présente (list-after-create pour un nom robuste).
find_key() {
  gcloud services api-keys list --project "$PROJECT_ID" \
    --filter="displayName='${KEY_DISPLAY_NAME}'" --format="value(name)" | head -1
}
echo "[2/4] clé restreinte (tile.googleapis.com + referrer ${ALLOWED_REFERRERS})…"
KEY_NAME="$(find_key)"
if [ -z "$KEY_NAME" ]; then
  gcloud services api-keys create --project "$PROJECT_ID" \
    --display-name="$KEY_DISPLAY_NAME" \
    --api-target=service=tile.googleapis.com \
    --allowed-referrers="$ALLOWED_REFERRERS"
  KEY_NAME="$(find_key)"
  echo "  clé créée : ${KEY_NAME}"
else
  echo "  clé existante réutilisée : ${KEY_NAME}"
fi
test -n "$KEY_NAME" || { echo "❌ clé introuvable après création"; exit 1; }

# 3. keyString → secret k8s SANS l'imprimer (fichier temp 600, newline strippée, trap-cleanup).
echo "[3/4] wire le keyString dans le secret ${KEY_SECRET_NS}/${KEY_SECRET_NAME} (jamais imprimé)…"
TMP_KEY="$(mktemp)"; chmod 600 "$TMP_KEY"; trap 'rm -f "$TMP_KEY"' EXIT
gcloud services api-keys get-key-string "$KEY_NAME" --project "$PROJECT_ID" \
  --format="value(keyString)" | tr -d '\n\r' > "$TMP_KEY"
test -s "$TMP_KEY" || { echo "❌ keyString vide"; exit 1; }
kubectl create secret generic "$KEY_SECRET_NAME" -n "$KEY_SECRET_NS" \
  --from-file=key="$TMP_KEY" --dry-run=client -o yaml | kubectl apply -f -
rm -f "$TMP_KEY"; trap - EXIT

# 4. self-verify + prochaines étapes (test A borné).
echo "[4/4] vérif…"
kubectl get secret "$KEY_SECRET_NAME" -n "$KEY_SECRET_NS" >/dev/null \
  || { echo "❌ secret ${KEY_SECRET_NS}/${KEY_SECRET_NAME} non créé"; exit 1; }
echo "✅ carte tile prête : clé RESTREINTE (tile-only + referrer ${ALLOWED_REFERRERS}) + secret"
echo "   ${KEY_SECRET_NS}/${KEY_SECRET_NAME} wiré (keyString jamais imprimé). Cap-billing ARMÉ."
echo "   PROCHAINE ÉTAPE (test A, ≤2 requêtes = centimes) : charger 1-2 tuiles depuis le front"
echo "   (https://*.sent-tech.ca), vérifier le rendu + le coût ~centimes. Jamais une boucle, jamais près du budget."
