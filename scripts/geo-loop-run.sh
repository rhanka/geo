#!/usr/bin/env bash
# geo-loop-run.sh — autonomous driver for the geo acquisition objective loop.
# Runs geo-loop-tick.sh on an interval, forever, in a detached tmux session so it
# keeps driving (relaunch dead agents + reconcile + Δ) WITHOUT manual relance —
# even if the conductor session closes. Stop with: tmux kill-session -t geo-loop.
#
#   bash scripts/geo-loop-run.sh [interval_seconds]   (default 900 = 15 min)
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
INT="${1:-900}"
LOG="$REPO/work/coverage/geo-loop.log"
SESSION="geo-loop"

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "geo-loop already running (tmux $SESSION). tail: $LOG"
  exit 0
fi
tmux new-session -d -s "$SESSION" \
  "cd '$REPO'; while :; do bash scripts/geo-loop-tick.sh >> '$LOG' 2>&1; sleep $INT; done"
echo "geo-loop driver started (tmux $SESSION, interval ${INT}s). tail: $LOG"
