#!/usr/bin/env bash
# stop-lane-reglement-workers.sh — arrête les workers h2a MCP de la lane reglement.
#
# Pourquoi : sous pression mémoire hôte (SWAP épuisé), il faut pouvoir reaper les
# workers codex de CETTE lane sans toucher aux autres. Les workers lancés via
# mcp h2a_run vivent dans des sessions tmux `h2a-geo-reglement-*` (le helper
# partagé h2a-stop-run.sh ne cible QUE `remote-*`, donc ne les voit pas).
#
# N'agit QUE sur les sessions dont le nom matche `^h2a-geo-reglement-` : jamais
# un process arbitraire, jamais une autre lane.
#
# Usage :
#   bash scripts/stop-lane-reglement-workers.sh            # arrête TOUS les workers de la lane
#   bash scripts/stop-lane-reglement-workers.sh <keepName> # garde h2a-<keepName> vivant
set -uo pipefail

keep="${1:-}"
killed=0
mapfile -t sessions < <(tmux list-sessions -F '#{session_name}' 2>/dev/null | grep -E '^h2a-geo-reglement-' || true)
for s in "${sessions[@]}"; do
  [[ -z "$s" ]] && continue
  if [[ -n "$keep" && "$s" == "h2a-${keep}" ]]; then
    echo "kept: $s"
    continue
  fi
  if tmux kill-session -t "$s" 2>/dev/null; then
    echo "stopped: $s"
    killed=$((killed + 1))
  fi
done
echo "stopped_total=${killed}"
