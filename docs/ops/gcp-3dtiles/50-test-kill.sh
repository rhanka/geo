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
  # Assert the REAL enforced cap, not just an override's presence: each quotaBucket carries
  # `effectiveLimit` — the limit enforced AFTER overrides, always in the list JSON — and an
  # override=0 lowers it to the string "0" (measured, i-infra). Stronger than presence/overrideValue,
  # and it subsumes the LIMIT_ID de-risk (a metric lacking the exact /min/project limit → no match →
  # fail-loud). i-infra validates the same effectiveLimit=0 independently at re-test-kill.
  QUOTA_JSON=$(gcloud alpha services quota list --service=tile.googleapis.com \
    --consumer="projects/${PROJECT_ID}" --project "$PROJECT_ID" --format=json 2>/dev/null || echo "[]")
  MISSING=$(printf '%s' "$QUOTA_JSON" | METRICS="$METRICS" node -e '
    const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const want = process.env.METRICS.split(/\s+/).map((m) => "tile.googleapis.com/" + m);
    const items = Array.isArray(data) ? data : [];
    const capped = new Set();
    for (const m of want) {
      const item = items.find((i) => i.metric === m);
      if (!item) continue; // metric absent from list → not capped → stays in MISSING (fail-loud)
      // The Function caps the per-project-per-minute limit (LIMIT_ID /min/project). Its `unit` is
      // exactly "1/min/{project}" — the consumerQuotaLimit carries no `name` in CLI JSON, so `unit`
      // is the selector (measured, i-infra). Unit forms vary (1/{project}, 1/{project}/{region},
      // 1/min/{project}/{region}), so the exact match also CATCHES the LIMIT_ID de-risk: a metric
      // lacking exactly this unit → no limit → not capped → fail-loud (no false PASS).
      const lim = (item.consumerQuotaLimits || []).find((l) => l.unit === "1/min/{project}");
      if (!lim) continue;
      // The default (project-wide) bucket carries NO `dimensions` key (regional buckets have
      // dimensions={region:...}); it is the one the dimensionless override caps. effectiveLimit is
      // a STRING → compare === "0".
      const b = (lim.quotaBuckets || []).find((x) => !x.dimensions || Object.keys(x.dimensions).length === 0);
      if (b && b.effectiveLimit === "0") capped.add(m);
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
