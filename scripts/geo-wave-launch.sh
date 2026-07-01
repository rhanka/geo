#!/usr/bin/env bash
# geo-wave-launch.sh — lance UNE vague de shards (12 local + 12 remote) Claude 4.8
# (opus-4-8, effort xhigh) pour la couverture QC. Script committé = commande
# unique, pas de chaîne bash inline à chaque tick /loop.
#
# Modèle : claude-opus-4-8 (4.8xhigh) — la méthode zonage (T1 GeoPDF, OCR-labels)
# est validée en 4.8. Comptes : pool `remote account` (claude-max/claude-local).
#
# Idempotence : ne relance PAS si ≥2 shards LOCAUX geo running/pending. Draine le
# remote via conductor. Régénère les prompts de shard (T1 GeoPDF inclus) à chaque
# vague depuis la source ci-dessous.
#
# Usage : bash scripts/geo-wave-launch.sh
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
REPO="$(pwd)"
PROMPTS="$REPO/work/delegation-mass/agent-prompts"
mkdir -p "$PROMPTS"
TOTAL=24
TS="$(date -u +%Y%m%dT%H%M%SZ)"
MODEL="claude-opus-4-8"
EFFORT="xhigh"

# 1. Vague locale déjà en cours ? (locaux fiables ; remote best-effort)
busy="$(remote jobs ls 2>/dev/null | grep -Ec 'geo-local-shard.*(running|pending)')"
if [ "${busy:-0}" -ge 2 ]; then
  echo "[wave] $busy shard(s) LOCAUX encore actifs → PAS de relance (vague en cours)."
  exit 3
fi

# 2. Prompt de shard (SHARD/TOTAL substitués). Leviers: normes (grille-discovery
# + batch), ZONES avec T1 GeoPDF per-city PRIORITAIRE (georef embarqué → cadastre),
# puis AGOL/WFS/obscura, et pv. Anti-invention dans le CODE (gates).
read -r -d '' BASE <<'PROMPT'
Repo geo. Modèle 4.8xhigh, méthode zonage validée. Objectif: progresser la couverture QC (zones/normes/pv) sur TON shard SHARD/TOTAL, sans modifier loop-supervise.ts, sans secrets, sans commit sur main.
0) Commence par: npx tsx acquisition/src/loop-supervise.ts
1) Calcule tes slugs candidats manquants depuis work/coverage/coverage-matrix.json (couches status!=done), garde ceux dont index%TOTAL==SHARD.
2) ZONES (prioriser le lever T1 GeoPDF per-city — c'est la méthode, cf docs/spec/zonage-georeferencement-gcp.md): pour chaque slug zones=to-research, tente de récupérer le plan de zonage PDF officiel de la muni; détecte le géoréférencement EMBARQUÉ (/VP /Measure /GPTS via lib t1-georef); si T1-éligible → build géométrie par ligne-de-vue cadastre + labels pdftotext (t1-build.ts) → dépôt qc-zonage-<slug>. Sinon, si vecteur sans géoréf → note T2 (ne force pas). En complément: zones-agol-owner-harvest.ts (gate spatial QC), zones-wfs-discover/run, zones-obscura-run — seulement si plausible.
3) NORMES: grille-discovery-run.ts --slugs <tonShard> --download --route-guess --2hop --delay-ms 1500 --timeout-ms 15000 --out work/zonage-norms/discovered-shard-SHARD.json; puis zonage-norms-run.ts --no-manifest --auto-grid-page par grille trouvée (ou zonage-norms-batch.ts sur le manifest). Gates: ≥3 zone_codes réels verbatim, overlap!=0, publishedFieldPct!=0.
4) PV: scripts pv existants (pv-livehost-run / pv-gonet-run / pv-obscura-run) sur ton shard; isRealPv + HEAD live 200.
ANTI-INVENTION STRICTE: n'accepte QUE les dépôts produits par les gates du code (verbatim, ≥3 codes, gate spatial, rejet séquentiel/affectation/bbox-stretch). Jamais inventer URL/code. NE bloque pas >4min/slug.
Fin: npx tsx acquisition/src/loop-supervise.ts; git status --short; résume le delta PAR COUCHE (jamais sommer) + fichiers/logs produits. Ne commit pas.
PROMPT

# 3. Génère les prompts par shard (0..23) et délègue.
echo "[wave] lancement vague $TS (12 local + 12 remote) modèle=$MODEL/$EFFORT"
for i in $(seq 0 11); do
  printf '%s' "$BASE" | sed "s/SHARD/$i/g; s/TOTAL/$TOTAL/g" > "$PROMPTS/local-$i.txt"
  remote delegate claude --model "$MODEL" --effort "$EFFORT" --headless \
    --name "geo-local-shard-$i-$TS" "$(cat "$PROMPTS/local-$i.txt")" >/dev/null 2>&1 &
done
wait
for i in $(seq 12 23); do
  printf '%s' "$BASE" | sed "s/SHARD/$i/g; s/TOTAL/$TOTAL/g" > "$PROMPTS/remote-$i.txt"
  remote delegate claude --model "$MODEL" --effort "$EFFORT" --remote --headless \
    --name "geo-remote-shard-$i-$TS" "$(cat "$PROMPTS/remote-$i.txt")" >/dev/null 2>&1 &
done
wait

# 4. Conductor pour drainer les pending remote.
if ! tmux has-session -t geo-remote-conductor 2>/dev/null; then
  tmux new-session -d -s geo-remote-conductor "cd $REPO && remote jobs conduct --watch 1" 2>/dev/null || true
fi

echo "[wave] vague $TS lancée."
remote jobs ls 2>/dev/null | grep -Ec 'geo-(local|remote)-shard.*(running|pending)' | sed 's/^/[wave] shards actifs: /'
