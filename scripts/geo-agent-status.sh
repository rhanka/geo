#!/usr/bin/env bash
# geo-agent-status.sh — read-only status of geo relaunch agents (tmux + processes).
# Committed per memory use-committed-scripts-not-inline-bash (no ad-hoc inline bash).
#
# Usage: bash scripts/geo-agent-status.sh [STAMP]
#   STAMP defaults to 20260709T030635Z (the current relaunch wave).
set -u
STAMP="${1:-20260709T030635Z}"
cd "$(dirname "$0")/.." || exit 1

echo "=== tmux sessions (wave $STAMP) ==="
tmux list-sessions 2>/dev/null | grep -E "tmux-codex55-.*${STAMP}|geo-immo-lots-relaunch-${STAMP}|normes-gpt55-relaunch" || echo "NONE"

echo
echo "=== live codex exec processes ==="
ps -eo pid,etime,stat,cmd --no-headers 2>/dev/null | grep -E "codex(-| )exec" | grep -v grep || echo "NO codex exec process"

echo
echo "=== live qc-lots / lot-zone / lots-enriched processes ==="
ps -eo pid,etime,stat,cmd --no-headers 2>/dev/null | grep -E "qc-lots-backfill|lot-zone-join-run|lots-enriched-run" | grep -v grep || echo "NO qc-lots process"

echo
echo "=== qc-lots backfill progress ==="
prog="work/coverage/qc-lots-relaunch-progress-${STAMP}.json"
if [ -f "$prog" ]; then
  node -e 'const p=require(process.argv[1]); console.log(JSON.stringify({batches_done:p.batches_done,plan_batches:p.plan_batches,enriched:p.enriched?.length,avg_zone_code_pct:p.avg_zone_code_pct,crashed:p.crashed_steps?.length,updated_at:p.updated_at}))' "$PWD/$prog" 2>/dev/null || echo "(progress unreadable)"
else
  echo "(no progress file yet: $prog)"
fi

echo
echo "=== per-agent last log line ==="
for f in work/delegation-mass/zones-tmux-codex55-*-${STAMP}.log \
         work/delegation-mass/normes-tmux-codex55-*-${STAMP}.log \
         work/delegation-mass/pv-tmux-codex55-*-${STAMP}.log; do
  [ -f "$f" ] || continue
  base="$(basename "$f")"
  last="$(tail -n 1 "$f" 2>/dev/null)"
  exit_line="$(grep -m1 'EXIT:' "$f" 2>/dev/null || true)"
  printf '%-46s | %s %s\n' "$base" "${exit_line:-running?}" "${last:0:70}"
done
