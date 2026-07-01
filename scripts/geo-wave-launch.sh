#!/usr/bin/env bash
# geo-wave-launch.sh — lance UNE vague de shards (12 local + 12 remote) pour la
# couverture QC, à partir des prompts committés work/delegation-mass/agent-prompts/.
# Script committé = commande unique, pas de chaîne bash inline à chaque tick /loop.
#
# Idempotence de vague : ne relance PAS si une vague est déjà en cours (≥2 shards
# geo running). Sinon délègue codex headless (local 0..11, remote 12..23) + arme
# le conductor remote pour drainer les pending.
#
# Usage : bash scripts/geo-wave-launch.sh
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
REPO="$(pwd)"
PROMPTS="$REPO/work/delegation-mass/agent-prompts"
TOTAL=24
TS="$(date -u +%Y%m%dT%H%M%SZ)"

# 1. En cours ? On ne compte que les LOCAUX (fiables) : le remote est fragile
# (auth pod) et best-effort, il ne doit pas bloquer la relance des locaux.
busy="$(remote jobs ls 2>/dev/null | grep -Ec 'geo-local-shard.*(running|pending)')"
if [ "${busy:-0}" -ge 2 ]; then
  echo "[wave] $busy shard(s) LOCAUX encore actifs → PAS de relance (vague en cours)."
  exit 3
fi

# 2. Les prompts doivent exister (générés au premier lancement).
if [ ! -f "$PROMPTS/local-0.txt" ]; then
  echo "[wave] prompts absents dans $PROMPTS — abort."
  exit 2
fi

echo "[wave] lancement vague $TS (12 local + 12 remote)"
for i in $(seq 0 11); do
  remote delegate codex --headless --name "geo-local-shard-$i-$TS" "$(cat "$PROMPTS/local-$i.txt")" >/dev/null 2>&1 &
done
wait
for i in $(seq 12 23); do
  remote delegate codex --remote --headless --name "geo-remote-shard-$i-$TS" "$(cat "$PROMPTS/remote-$i.txt")" >/dev/null 2>&1 &
done
wait

# 3. Conductor pour drainer les pending remote (si pas déjà là).
if ! tmux has-session -t geo-remote-conductor 2>/dev/null; then
  tmux new-session -d -s geo-remote-conductor "cd $REPO && remote jobs conduct --watch 1" 2>/dev/null || true
fi

echo "[wave] vague $TS lancée."
remote jobs ls 2>/dev/null | grep -Ec 'geo-(local|remote)-shard.*(running|pending)' | sed 's/^/[wave] shards actifs: /'
