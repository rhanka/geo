#!/usr/bin/env bash
# Phase 50 / runbook step J — TEST-KILL : prove the hard-cap DETACHES billing,
# BEFORE any key. Publishes a simulated over-budget event; the cap-billing Function
# must detach billing. Fails LOUD (exit 1) if the cap does not cut → the key must
# NOT be created. Re-attach is OWNER-DIRECT, off-script (a billing-link = money gate).
#
# GATE NOTE (geo-socle): the draft used a fixed `sleep 30` + one check; replaced with
# a bounded poll (≤8×15s, breaks as soon as detached) so slow propagation cannot yield
# a FALSE "cap ne coupe pas" that would wrongly block the key. Owner-terminal, bounded,
# one-shot — not a session-blocking watch.
source "$(dirname "$0")/env.sh"

gcloud pubsub topics publish "$TOPIC" --project "$PROJECT_ID" \
  --message='{"costAmount":51,"budgetAmount":50}'
echo "over-budget simulé publié ; attente du détachement billing par cap-billing…"

STATE=""
for attempt in $(seq 1 8); do
  sleep 15
  STATE=$(gcloud billing projects describe "$PROJECT_ID" --format="value(billingEnabled)" || true)
  echo "  tentative ${attempt}: billingEnabled=${STATE:-<vide>}"
  [[ "${STATE,,}" == "false" ]] && break
done

if [[ "${STATE,,}" != "false" ]]; then
  echo "❌ le cap n'a PAS détaché le billing (~120s) — NE PAS créer la clé (H). Investiguer la Function."
  exit 1
fi

echo "✅ hard-cap PROUVÉ (billing détaché au seuil)."
echo "   RÉ-ATTACH = OWNER-DIRECT, hors-script :"
echo "   gcloud billing projects link $PROJECT_ID --billing-account=<BILLING_ACCOUNT>"
