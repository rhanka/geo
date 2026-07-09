#!/usr/bin/env bash
# geo-worker.sh — parameterized conductor for geo acquisition workers.
# ONE committed tool, driven only by arguments (memory: committed scripts, no per-wave edits).
#
# Subcommands:
#   inventory
#       Broad read-only inventory (delegates to geo-inventory.sh).
#
#   stop <TMUX_NAME_GLOB>
#       Kill every tmux session whose name matches the glob (cascades to child
#       claude/codex/tsx). Example: stop 'geo-*-20260709T030635Z'
#
#   agent <engine> <session> <prompt-file> [model]
#       Launch ONE LLM agent in a detached tmux session, reading the prompt from
#       <prompt-file> on stdin. engine ∈ claude | codex.
#       Default model for claude: claude-sonnet-4-6.
#       Log: work/delegation-mass/worker-logs/<session>.log
#
#   bg <session> -- <committed command...>
#       Run ONE deterministic committed command (npx tsx …, env VAR=… allowed) in a
#       detached tmux session. For Mistral norms / lots backfill — no LLM agent.
#       Log: work/delegation-mass/worker-logs/<session>.log
#
# Notes: workers NEVER write .track (the conductor reconciles centrally). The tmux
# session lingers ~1h after the job for log inspection, then exits.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
LOGDIR="$REPO/work/delegation-mass/worker-logs"
mkdir -p "$LOGDIR"

usage() { sed -n '2,40p' "$0"; exit "${1:-2}"; }

cmd="${1:-}"; shift || true
case "$cmd" in
  inventory)
    exec bash "$HERE/geo-inventory.sh" ;;

  stop)
    glob="${1:-}"; [ -n "$glob" ] || { echo "stop needs <tmux-name-glob>"; exit 2; }
    n=0
    while IFS= read -r line; do
      name="${line%%:*}"
      case "$name" in
        $glob)
          tmux kill-session -t "$name" 2>/dev/null && { echo "killed $name"; n=$((n+1)); } ;;
      esac
    done < <(tmux list-sessions 2>/dev/null)
    echo "stopped $n session(s) matching: $glob" ;;

  agent)
    engine="${1:-}"; session="${2:-}"; prompt="${3:-}"; model="${4:-claude-sonnet-4-6}"
    [ -n "$engine" ] && [ -n "$session" ] && [ -n "$prompt" ] || { echo "agent needs <engine> <session> <prompt-file> [model]"; exit 2; }
    [ -f "$prompt" ] || { echo "prompt file not found: $prompt"; exit 2; }
    log="$LOGDIR/$session.log"
    case "$engine" in
      claude) runner="claude -p --model $model --dangerously-skip-permissions" ;;
      codex)  runner="codex exec" ;;
      *) echo "unknown engine: $engine (claude|codex)"; exit 2 ;;
    esac
    tmux kill-session -t "$session" 2>/dev/null || true
    tmux new-session -d -s "$session" \
      "cd '$REPO'; $runner < '$prompt' > '$log' 2>&1; echo \"EXIT:\$? \$(date -u +%FT%TZ)\" >> '$log'; sleep 3600"
    echo "launched agent session=$session engine=$engine model=$model prompt=$prompt log=$log" ;;

  bg)
    session="${1:-}"; shift || true
    [ "${1:-}" = "--" ] && shift || true
    [ -n "$session" ] && [ "$#" -gt 0 ] || { echo "bg needs <session> -- <command...>"; exit 2; }
    log="$LOGDIR/$session.log"
    # Re-quote the command so env-assignments and args survive into tmux.
    q=""; for a in "$@"; do q="$q $(printf '%q' "$a")"; done
    tmux kill-session -t "$session" 2>/dev/null || true
    tmux new-session -d -s "$session" \
      "cd '$REPO';$q > '$log' 2>&1; echo \"EXIT:\$? \$(date -u +%FT%TZ)\" >> '$log'; sleep 3600"
    echo "launched bg session=$session log=$log cmd:$q" ;;

  *) usage 2 ;;
esac
