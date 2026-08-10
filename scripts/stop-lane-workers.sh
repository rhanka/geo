#!/usr/bin/env bash
# stop-lane-workers.sh — reap les workers h2a MCP d'UNE lane (générique, flotte).
#
# Pourquoi : les workers lancés via `mcp h2a_run` vivent dans des sessions tmux
# `h2a-<lane>-*` et NE NETTOIENT PAS leur session après exit (fuite constatée le
# 2026-08-02 : 11 sessions mortes sur une seule lane = grosse part de la pression
# mémoire hôte). Le helper partagé h2a-stop-run.sh ne cible QUE `remote-*` (runs
# CLI), donc ne voit pas ces sessions MCP. Ce script reape les sessions mortes
# d'une lane sans jamais toucher un process arbitraire ni une autre lane.
#
# N'agit QUE sur les sessions dont le nom matche `^h2a-<lane>-` (préfixe vérifié).
#
# Usage :
#   bash scripts/stop-lane-workers.sh <lane>            # arrête TOUS les workers de la lane
#   bash scripts/stop-lane-workers.sh <lane> <keepName> # garde h2a-<keepName> vivant
set -uo pipefail

lane="${1:-}"
keep="${2:-}"
if [[ -z "$lane" || ! "$lane" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "usage: bash scripts/stop-lane-workers.sh <lane> [keepName]" >&2
  exit 2
fi

killed=0
mapfile -t sessions < <(tmux list-sessions -F '#{session_name}' 2>/dev/null | grep -E "^h2a-${lane}-" || true)
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
echo "lane=${lane} stopped_total=${killed}"
