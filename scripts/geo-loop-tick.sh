#!/usr/bin/env bash
# geo-loop-tick.sh — ONE autonomous tick of the geo acquisition objective loop.
# Relaunches any dead/exited agent from the fleet registry (via geo-worker agent,
# h2a run, NO gateway), refreshes the deterministic immo backfill, reconciles
# coverage + track, and prints the 5 key numbers. Idempotent: a live agent is
# left alone; a session dropped back to a shell prompt is relaunched.
#
#   bash scripts/geo-loop-tick.sh            # one tick
# Run autonomously via scripts/geo-loop-run.sh (detached tmux, sleeps between ticks).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
cd "$REPO" || exit 1
W="$HERE/geo-worker.sh"
P="work/delegation-mass/agent-prompts"

# ── fleet registry: name | prompt | shard | model  (shard/model empty = none) ──
FLEET=(
  "geo-zn-recal-1|$P/zones-recalage-base.txt|0/4|"
  "geo-zn-recal-2|$P/zones-recalage-base.txt|1/4|"
  "geo-zn-recal-3|$P/zones-recalage-base.txt|2/4|"
  "geo-zn-recal-4|$P/zones-recalage-base.txt|3/4|"
  "geo-pv-a|$P/pv-base.txt|0/4|"
  "geo-pv-b|$P/pv-base.txt|1/4|"
  "geo-pv-c|$P/pv-base.txt|2/4|"
  "geo-pv-d|$P/pv-base.txt|3/4|"
  "geo-nm-a|$P/normes-mistral-base.txt|0/4|"
  "geo-nm-b|$P/normes-mistral-base.txt|1/4|"
  "geo-nm-c|$P/normes-mistral-base.txt|2/4|"
  "geo-nm-d|$P/normes-mistral-base.txt|3/4|"
  "geo-port-npm|$P/port-to-npm.txt||claude-opus-4-8"
  "geo-immo-clean|$P/immo-clean.txt||"
)
# NOTE: geo-harness-analysis retiré du registre — livrable one-shot TERMINÉ
# (HARNESS-GAP-ANALYSIS.md + envelope h2a livrés). Ne pas auto-relancer.

# an agent is ALIVE only while it is actively working: the h2a/claude CLI shows
# "esc to interrupt" in its status bar throughout processing. Anything else — no
# session, idle at the "❯" prompt, spend/usage-limit banner, finished+context-full
# ("new task?") — means it has stopped grinding and must be relaunched.
# (Prior version only inspected the LAST non-empty line, which is always the status
#  bar "⏸ manual mode…" and hid the idle/spend-limit state → agents sat dead-but-
#  counted-alive. Inspect the WHOLE pane for the working marker instead.)
agent_dead() {
  local name="$1" remote="remote-$1" pane
  tmux has-session -t "$remote" 2>/dev/null || return 0   # no session → dead
  pane="$(tmux capture-pane -t "$remote" -p 2>/dev/null)"
  case "$pane" in
    *'esc to interrupt'*) return 1 ;;   # actively working → alive
    *) return 0 ;;                      # idle / limit / finished → relaunch
  esac
}

echo "=== geo-loop tick $(date -u +%FT%TZ) ==="
relaunched=0
for row in "${FLEET[@]}"; do
  IFS='|' read -r name prompt shard model <<<"$row"
  [ -f "$prompt" ] || { echo "MISS $name (prompt $prompt absent)"; continue; }
  if agent_dead "$name"; then
    args=(agent claude "$name" "$prompt")
    [ -n "$shard" ] && args+=(--shard "$shard")
    [ -n "$model" ] && args+=(--model "$model")
    echo "RELAUNCH $name shard=${shard:-none} model=${model:-default}"
    bash "$W" "${args[@]}" >/dev/null 2>&1 && relaunched=$((relaunched+1))
  else
    echo "ALIVE    $name"
  fi
done

# deterministic immo backfill: keep it GRINDING the live gap. Check the PROCESS
# (the bg tmux lingers with sleep after a pass finishes), not just the session,
# so a finished pass is re-kicked while producible gap remains. Idempotent.
if ! pgrep -f 'qc-lots-backfill.ts' >/dev/null 2>&1; then
  echo "RELAUNCH geo-immo-gap-loop (backfill process not running — grind the gap)"
  tmux kill-session -t geo-immo-gap-loop 2>/dev/null || true
  bash "$W" bg geo-immo-gap-loop -- npx tsx acquisition/src/qc-lots-backfill.ts \
    --gap-limit 300 --gap-batch 4 --workers 4 --enrich-no-role \
    --progress work/coverage/qc-lots-loop-progress.json --log work/coverage/qc-lots-loop.log >/dev/null 2>&1 || true
else
  echo "ALIVE    geo-immo-gap-loop (backfill process running)"
fi

echo "--- reconcile ---"
board="$(npx tsx acquisition/src/coverage-reconcile.ts 2>&1 | grep -E 'SCOREBOARD' | tail -1)"
echo "${board:-(reconcile: no scoreboard line)}"
npx tsx acquisition/src/sync-track-from-coverage.ts --apply >/dev/null 2>&1 || true

# Engage the h2a objective loop so it is visibly driven (tick + progress note).
LOOP_ID="${GEO_LOOP_ID:-loop-mre4avom}"
h2a loop tick "$LOOP_ID" >/dev/null 2>&1 || true
h2a loop report "$LOOP_ID" --note "tick $(date -u +%FT%TZ): relaunched=$relaunched | ${board:-no-scoreboard}" >/dev/null 2>&1 || true
echo "=== tick done (relaunched=$relaunched, h2a loop $LOOP_ID ticked) ==="
