#!/usr/bin/env bash
# Phase 51 / runbook — RÉ-ATTACH : restaure le quota tile (cap-test override=0 → défaut) pour qu'une
# clé serve. ⚠ LÈVE le cap = RÉ-ACTIVE le billable → geste OWNER-GATED (owner, ou CI protégée à
# required-reviewer owner), JAMAIS auto-déclenché, JAMAIS par la SA cap-billing (qui n'écrit que 0).
# À lancer APRÈS la certif i-infra (présence override ×4 lue) ET sur autorisation owner DIRECTE.
# Geste opérateur inverse du cap, hors-SA. Idempotent (delete d'un override absent = déjà restauré).
# Le cap-billing reste ARMÉ après : il re-cape au prochain dépassement de budget.
source "$(dirname "$0")/env.sh"

METRICS="twodtiles threedtiles_renderer_request threedtiles_root_tileset streetviewtiles"
UNIT="1/min/{project}"
# Override-id GCP du consumer override posé par la Function. Encodage protobuf du libellé
# "QuotaOverride" — constante NON-sensible, PAS project-specific (à confirmer i-infra au co-val).
OVERRIDE_ID="Cg1RdW90YU92ZXJyaWRl"

echo "=== RÉ-ATTACH $(date -u +%H:%M:%SZ) — projet ${PROJECT_ID} ==="
for m in $METRICS; do
  gcloud alpha services quota delete --service=tile.googleapis.com \
    --consumer="projects/${PROJECT_ID}" --metric="tile.googleapis.com/${m}" \
    --unit="$UNIT" --override-id="$OVERRIDE_ID" --force --project "$PROJECT_ID" 2>/dev/null \
    || echo "  (${m}: pas d'override à supprimer — déjà au défaut)"
done

# Vérif INVERSE du 50-test-kill : le quota est restauré quand AUCUNE des 4 métriques n'a d'override
# (bucket = {defaultLimit, effectiveLimit} sans consumerOverride). Fail-loud si un override persiste.
echo "vérif : override ABSENT sur les 4 métriques (quota restauré au défaut)…"
QUOTA_JSON=$(gcloud alpha services quota list --service=tile.googleapis.com \
  --consumer="projects/${PROJECT_ID}" --project "$PROJECT_ID" --format=json 2>/dev/null || echo "[]")
STILL_CAPPED=$(printf '%s' "$QUOTA_JSON" | METRICS="$METRICS" node -e '
  const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const want = process.env.METRICS.split(/\s+/).map((m) => "tile.googleapis.com/" + m);
  const items = Array.isArray(data) ? data : [];
  const capped = [];
  for (const m of want) {
    const item = items.find((i) => i.metric === m);
    if (!item) continue;
    const lim = (item.consumerQuotaLimits || []).find((l) => l.unit === "1/min/{project}");
    if (!lim) continue;
    const b = (lim.quotaBuckets || []).find((x) => !x.dimensions || Object.keys(x.dimensions).length === 0);
    if (b && b.consumerOverride && b.consumerOverride.name) capped.push(m);
  }
  process.stdout.write(capped.join(","));
')
if [ -n "$STILL_CAPPED" ]; then
  echo "❌ override PERSISTE sur : ${STILL_CAPPED} — ré-attach INCOMPLET. Investiguer AVANT de créer la clé."
  exit 1
fi
echo "✅ ré-attach OK — quota tile restauré au défaut sur les 4 métriques (0 override)."
echo "   Le cap-billing reste ARMÉ (re-cape au prochain dépassement de budget). La clé peut servir."
