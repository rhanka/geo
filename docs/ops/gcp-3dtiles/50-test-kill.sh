#!/usr/bin/env bash
# Phase 50 / runbook step J — TEST-KILL : prove the hard-cap CUTS the billable spend, BEFORE any
# key. Publishes a simulated over-budget event; the cap-billing Function must set the CONSUMER
# QUOTA to 0 on the 4 charged Map Tiles metrics. Fails LOUD (exit 1) if any charged metric is not
# capped at 0 → the key must NOT be created. Restoring service (raising the quota back) is a HUMAN
# project-scoped step, off-script — the SA sets ONLY 0, by committed code.
#
# GATE NOTE (geo-socle): a bounded poll (≤8×15s, breaks as soon as all 4 are 0) so slow
# propagation cannot yield a FALSE "cap ne coupe pas". Owner-terminal, bounded, one-shot.
source "$(dirname "$0")/env.sh"

METRICS="twodtiles threedtiles_renderer_request threedtiles_root_tileset streetviewtiles"

gcloud pubsub topics publish "$TOPIC" --project "$PROJECT_ID" \
  --message='{"costAmount":51,"budgetAmount":50}'
echo "over-budget simulé publié ; attente du cap quota=0 sur les 4 métriques tile par cap-billing…"

ALL_ZERO="no"
for attempt in $(seq 1 8); do
  sleep 15
  # `services quota list --format=json` exposes only the override NAME per bucket, NOT its value
  # (measured, k8s), and there is no simple get-by-name. The Function hardcodes overrideValue "0"
  # (OVERRIDE_VALUE), so a PRESENT consumerOverride on a charged metric = capped at 0. Assert on
  # presence (i-infra re-reads the same list JSON independently).
  QUOTA_JSON=$(gcloud alpha services quota list --service=tile.googleapis.com \
    --consumer="projects/${PROJECT_ID}" --project "$PROJECT_ID" --format=json 2>/dev/null || echo "[]")
  MISSING=$(printf '%s' "$QUOTA_JSON" | METRICS="$METRICS" node -e '
    const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const want = process.env.METRICS.split(/\s+/).map((m) => "tile.googleapis.com/" + m);
    const capped = new Set();
    for (const item of (Array.isArray(data) ? data : [])) {
      for (const lim of (item.consumerQuotaLimits || [])) {
        for (const b of (lim.quotaBuckets || [])) {
          if (b.consumerOverride && b.consumerOverride.name) capped.add(item.metric);
        }
      }
    }
    process.stdout.write(want.filter((m) => !capped.has(m)).join(","));
  ')
  echo "  tentative ${attempt}: métriques non-cappées = ${MISSING:-<aucune>}"
  if [ -z "$MISSING" ]; then ALL_ZERO="yes"; break; fi
done

if [ "$ALL_ZERO" != "yes" ]; then
  echo "❌ le cap n'a PAS mis toutes les métriques tile à 0 (~120s) — NE PAS créer la clé (H). Investiguer la Function."
  exit 1
fi

echo "✅ hard-cap PROUVÉ (quota consumer=0 sur les 4 métriques billables ; spend tile coupé)."
echo "   RÉ-ENABLE = HUMAIN, hors-script (remonter le quota, project-scoped, PAS un gate billing ; la SA ne pose que 0)."
