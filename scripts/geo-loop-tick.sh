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
  "geo-zn-recal-1|$P/zones-recalage-1.txt||"
  "geo-zn-recal-2|$P/zones-recalage-2.txt||"
  "geo-zn-recal-3|$P/zones-recalage-3.txt||"
  "geo-zn-recal-4|$P/zones-recalage-4.txt||"
  "geo-pv-a|$P/pv-base.txt|0/4|"
  "geo-pv-b|$P/pv-base.txt|1/4|"
  "geo-pv-c|$P/pv-base.txt|2/4|"
  "geo-pv-d|$P/pv-base.txt|3/4|"
  "geo-nm-a|$P/normes-mistral-base.txt|0/4|"
  "geo-nm-b|$P/normes-mistral-base.txt|1/4|"
  "geo-nm-c|$P/normes-mistral-base.txt|2/4|"
  "geo-nm-d|$P/normes-mistral-base.txt|3/4|"
  "geo-port-npm|$P/port-to-npm.txt||claude-opus-4-8"
  "geo-harness-analysis|$P/harness-analysis.txt||claude-opus-4-8"
)

# an agent is "dead" if its remote-<name> tmux is absent, OR its pane last line is
# a bare shell prompt (dropped out of the CLI), OR shows a hard usage-limit exit.
agent_dead() {
  local name="$1" remote="remote-$1" last
  tmux has-session -t "$remote" 2>/dev/null || return 0
  last="$(tmux capture-pane -t "$remote" -p 2>/dev/null | grep -v '^[[:space:]]*$' | tail -n 1)"
  case "$last" in
    *'$') return 0 ;;                       # shell prompt (ends with $)
    *'usage limit'*|*'429'*) return 0 ;;    # hit a limit
    *) return 1 ;;
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

# deterministic immo backfill: keep one running against the live gap.
if ! tmux has-session -t geo-immo-gap-loop 2>/dev/null; then
  echo "RELAUNCH geo-immo-gap-loop (deterministic backfill --gap-limit 300)"
  bash "$W" bg geo-immo-gap-loop -- npx tsx acquisition/src/qc-lots-backfill.ts \
    --gap-limit 300 --gap-batch 4 --workers 4 --enrich-no-role \
    --progress work/coverage/qc-lots-loop-progress.json --log work/coverage/qc-lots-loop.log >/dev/null 2>&1 || true
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
