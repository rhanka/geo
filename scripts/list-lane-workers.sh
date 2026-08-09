#!/usr/bin/env bash
# list-lane-workers.sh — liste (NON destructif) les workers h2a MCP d'une lane.
#
# Pourquoi : le conducteur doit pouvoir vérifier la LIVENESS d'un worker codex
# (lancé via mcp h2a_run, qui vit dans une session tmux `h2a-<lane>-*`) SANS le
# reaper. `h2a_run` peut renvoyer `state:"unknown"` (timeout de confirmation au
# lancement) alors même que le worker n'a pas démarré — ce helper tranche.
# Pendant du reap `stop-lane-workers.sh` : même filtre de nom, aucune action.
#
# N'agit sur RIEN : lecture seule (tmux list-sessions). Filtre `^h2a-<lane>-`.
#
# Usage :
#   bash scripts/list-lane-workers.sh geo-reglement
set -uo pipefail

lane="${1:-}"
if [[ -z "$lane" ]]; then
  echo "usage: bash scripts/list-lane-workers.sh <lane>" >&2
  exit 2
fi

mapfile -t sessions < <(tmux list-sessions -F '#{session_name} #{session_created} #{session_attached}' 2>/dev/null | grep -E "^h2a-${lane}-" || true)
count=0
for s in "${sessions[@]}"; do
  [[ -z "$s" ]] && continue
  echo "live: $s"
  count=$((count + 1))
done
echo "live_total=${count}"
