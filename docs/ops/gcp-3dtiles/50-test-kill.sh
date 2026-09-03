#!/usr/bin/env bash
# Phase 50 / runbook step J — TEST-KILL : prove the hard-cap CUTS the billable spend,
# BEFORE any key. Publishes a simulated over-budget event; the cap-billing Function must
# DISABLE the billable Map Tiles API (tile.googleapis.com). Fails LOUD (exit 1) if the API
# stays enabled → the key must NOT be created. Re-enable is a HUMAN step, off-script
# (project-scoped `gcloud services enable tile.googleapis.com` after proof — NOT a billing gate;
# the SA can kill but never re-enable, by least-priv design).
#
# GATE NOTE (geo-socle): a bounded poll (≤8×15s, breaks as soon as disabled) so slow propagation
# cannot yield a FALSE "cap ne coupe pas" that would wrongly block the key. Owner-terminal,
# bounded, one-shot — not a session-blocking watch.
source "$(dirname "$0")/env.sh"

BILLABLE_SERVICE="tile.googleapis.com"

gcloud pubsub topics publish "$TOPIC" --project "$PROJECT_ID" \
  --message='{"costAmount":51,"budgetAmount":50}'
echo "over-budget simulé publié ; attente de la désactivation de ${BILLABLE_SERVICE} par cap-billing…"

ENABLED="unknown"
for attempt in $(seq 1 8); do
  sleep 15
  # `services list --enabled` lists ENABLED services; the billable API must be ABSENT after the cut.
  OUT=$(gcloud services list --enabled --project "$PROJECT_ID" \
        --filter="config.name:${BILLABLE_SERVICE}" --format="value(config.name)" || true)
  if [ -z "$OUT" ]; then ENABLED="false"; else ENABLED="true"; fi
  echo "  tentative ${attempt}: ${BILLABLE_SERVICE} enabled=${ENABLED}"
  [[ "$ENABLED" == "false" ]] && break
done

if [[ "$ENABLED" != "false" ]]; then
  echo "❌ le cap n'a PAS désactivé ${BILLABLE_SERVICE} (~120s) — NE PAS créer la clé (H). Investiguer la Function."
  exit 1
fi

echo "✅ hard-cap PROUVÉ (${BILLABLE_SERVICE} désactivé au seuil ; spend billable coupé)."
echo "   RÉ-ENABLE = HUMAIN, hors-script (project-scoped, PAS un gate billing) :"
echo "   gcloud services enable ${BILLABLE_SERVICE} --project ${PROJECT_ID}"
