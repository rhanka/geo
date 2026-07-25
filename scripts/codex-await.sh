#!/usr/bin/env bash
# codex-await.sh — block until a detached Codex companion task finishes, then print its result.
#
# The codex-rescue agent forwards a task and returns immediately; the real task runs
# detached and only `codex-companion.mjs status` reveals its state. Polling that by hand
# every turn is the session's biggest time sink. This waits, then surfaces the result once.
#
# Usage: bash scripts/codex-await.sh <task-id> [poll-seconds] [max-seconds]
set -u
COMP="$HOME/.claude/plugins/cache/openai-codex/codex/1.0.2/scripts/codex-companion.mjs"
TASK="${1:?usage: codex-await.sh <task-id> [poll] [max]}"
POLL="${2:-15}"
MAX="${3:-1800}"
elapsed=0
while [ "$elapsed" -lt "$MAX" ]; do
  # A task still working shows under "Active jobs" as "running"; once done it moves out.
  line="$(node "$COMP" status 2>/dev/null | grep -F "$TASK")"
  case "$line" in
    *"| running |"*|*"| queued |"*) : ;;   # still going
    "") echo "[await] task $TASK not found (maybe already reaped)"; break ;;
    *) echo "[await] task $TASK left running after ${elapsed}s"; break ;;
  esac
  sleep "$POLL"
  elapsed=$((elapsed + POLL))
done
echo "===== codex result $TASK ====="
node "$COMP" result "$TASK" 2>&1
