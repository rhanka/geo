#!/usr/bin/env bash
# Capture le tail d'un ou plusieurs panes de worker h2a par nom de session.
# Usage: bash scripts/zones-pane-tail.sh <session-name> [<session-name> ...]
# Lecture seule ; sert à remonter l'état d'un worker quand l'inbox est cassé.
set -u
LINES="${LINES_TAIL:-45}"
for s in "$@"; do
  echo "==== session: $s ===="
  if tmux has-session -t "$s" 2>/dev/null; then
    tmux capture-pane -p -t "$s" 2>/dev/null | tail -n "$LINES"
  else
    echo "(no such tmux session)"
  fi
  echo
done
