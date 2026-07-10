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

  peek)
    # Ground-truth per worker. h2a agents ("remote-<name>") show work in the tmux
    # pane; bg jobs ("<name>") write to worker-logs/<name>.log. Report both.
    glob="${1:-*}"
    printf '%-30s | %-4s | %s\n' "SESSION" "UP" "LAST LINE"
    while IFS= read -r name; do
      case "$name" in
        $glob | remote-$glob) : ;;
        *) continue ;;
      esac
      case "$name" in
        remote-*)
          # h2a agent: work is in the tmux pane, not a log file.
          last="$(tmux capture-pane -t "$name" -p 2>/dev/null | grep -v '^[[:space:]]*$' | tail -n 1)" ;;
        *)
          f="$LOGDIR/$name.log"
          if [ -f "$f" ]; then
            last="$(grep -v '^[[:space:]]*$' "$f" 2>/dev/null | tail -n 1)"
          else
            last="$(tmux capture-pane -t "$name" -p 2>/dev/null | grep -v '^[[:space:]]*$' | tail -n 1)"
          fi ;;
      esac
      printf '%-30s | %-4s | %s\n' "$name" "up" "${last:0:88}"
    done < <(tmux list-sessions -F '#{session_name}' 2>/dev/null)
    echo "(sessions not listed = down/exited)" ;;

  msg)
    # Send a follow-up instruction into a live agent's tmux pane.
    session="${1:-}"; shift || true
    text="$*"
    [ -n "$session" ] && [ -n "$text" ] || { echo "msg needs <session> <text...>"; exit 2; }
    case "$session" in remote-*) remote="$session" ;; *) remote="remote-$session" ;; esac
    pane="$(tmux list-panes -t "$remote" -F '#{pane_id}' 2>/dev/null | head -1)"
    [ -n "$pane" ] || { echo "no pane for $remote"; exit 1; }
    tmux set-buffer -- "$text"
    tmux paste-buffer -t "$pane" -p
    tmux send-keys -t "$pane" Enter
    sleep 1
    tmux send-keys -t "$pane" Enter
    echo "sent to $remote ($pane)" ;;

  tail)
    session="${1:-}"; n="${2:-40}"
    [ -n "$session" ] || { echo "tail needs <session> [n]"; exit 2; }
    case "$session" in
      remote-*) tmux capture-pane -t "$session" -p -S -"$n" 2>/dev/null ;;
      *)
        if tmux has-session -t "remote-$session" 2>/dev/null; then
          tmux capture-pane -t "remote-$session" -p -S -"$n" 2>/dev/null
        else
          tail -n "$n" "$LOGDIR/$session.log" 2>/dev/null || echo "(no pane/log for $session)"
        fi ;;
    esac ;;

  stop)
    glob="${1:-}"; [ -n "$glob" ] || { echo "stop needs <tmux-name-glob>"; exit 2; }
    n=0
    while IFS= read -r name; do
      case "$name" in
        $glob | remote-$glob)
          base="${name#remote-}"
          h2a stop "$base" >/dev/null 2>&1 || true
          tmux kill-session -t "$name" 2>/dev/null && { echo "killed $name"; n=$((n+1)); } ;;
      esac
    done < <(tmux list-sessions -F '#{session_name}' 2>/dev/null)
    echo "stopped $n session(s) matching: $glob" ;;

  agent)
    # Delegate to a REAL agent session via `h2a run <engine>` (NO gateway). h2a owns
    # the auth (claude → subscription login, codex → its creds), so the engine is
    # just a parameter. The prompt file is injected into the session's tmux pane.
    engine="${1:-}"; session="${2:-}"; prompt="${3:-}"; shift 3 2>/dev/null || true
    shard=""; model=""
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --shard) shard="${2:-}"; shift 2 ;;
        --model) model="${2:-}"; shift 2 ;;
        *) shift ;;
      esac
    done
    [ -n "$engine" ] && [ -n "$session" ] && [ -n "$prompt" ] || { echo "agent needs <engine> <session> <prompt-file> [--shard i/n]"; exit 2; }
    [ -f "$prompt" ] || { echo "prompt file not found: $prompt"; exit 2; }
    remote="remote-$session"
    h2a stop "$session" >/dev/null 2>&1 || true
    tmux kill-session -t "$remote" 2>/dev/null || true
    h2a run "$engine" "$REPO" --name "$session" --no-attach --no-gw >/dev/null 2>&1 || {
      echo "h2a run failed for engine=$engine session=$session"; exit 1; }
    # wait for the session pane, let the CLI boot its input, then inject the prompt.
    pane=""
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      pane="$(tmux list-panes -t "$remote" -F '#{pane_id}' 2>/dev/null | head -1)"
      [ -n "$pane" ] && break
      sleep 1
    done
    [ -n "$pane" ] || { echo "no pane for $remote (h2a run did not create a session)"; exit 1; }
    sleep 6
    # optional model switch before the task (e.g. --model claude-opus-4-8 for archi/meta)
    if [ -n "$model" ]; then
      tmux send-keys -t "$pane" -l "/model $model"
      tmux send-keys -t "$pane" Enter
      sleep 3
    fi
    body="$(cat "$prompt")"
    if [ -n "$shard" ]; then
      rem="${shard%%/*}"; tot="${shard##*/}"
      body="SHARD $shard : traite UNIQUEMENT les slugs dont (index dans la liste triée) % $tot == $rem. Ignore les autres (un autre agent les prend). Ne bloque pas >6 min/slug.
$body"
    fi
    tmux set-buffer -- "$body"
    tmux paste-buffer -t "$pane" -p
    tmux send-keys -t "$pane" Enter
    sleep 1
    tmux send-keys -t "$pane" Enter
    echo "launched agent session=$session (tmux $remote pane $pane) engine=$engine shard=${shard:-none} prompt=$prompt" ;;

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
