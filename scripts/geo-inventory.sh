#!/usr/bin/env bash
# geo-inventory.sh — read-only inventory of ALL geo acquisition workers.
# Committed per memory use-committed-scripts-not-inline-bash (no ad-hoc inline bash).
# Usage: bash scripts/geo-inventory.sh
set -u
cd "$(dirname "$0")/.." || exit 1

echo "=========================================================="
echo "== 1. tmux sessions (geo / codex / normes / pv / immo)   =="
echo "=========================================================="
tmux list-sessions 2>/dev/null | grep -iE 'geo|codex|normes|norme|zones|zone|pv-|immo|cadence|recalage|mistral|feynman|ampere|euclid|boole|halley|socrates' || echo "(none matched)"

echo
echo "=========================================================="
echo "== 2. codex exec processes (SHOULD BE STOPPED)           =="
echo "=========================================================="
ps -eo pid,etime,stat,cmd --no-headers 2>/dev/null | grep -E 'codex(-| )exec' | grep -v grep || echo "NO codex exec process"

echo
echo "=========================================================="
echo "== 3. deterministic TS runners (Mistral norms / lots)    =="
echo "=========================================================="
ps -eo pid,etime,stat,cmd --no-headers 2>/dev/null \
  | grep -E 'zonage-norms-(schema-ingest|reocr-keepbest|2engine-keepbest|batch|run|native-sweep|autogrid)|qc-lots-backfill|lot-zone-join-run|lots-enriched-run|grille-discovery-run' \
  | grep -v grep || echo "(none)"

echo
echo "=========================================================="
echo "== 4. claude CLI / remote-delegate workers               =="
echo "=========================================================="
ps -eo pid,etime,stat,cmd --no-headers 2>/dev/null | grep -E 'claude .*(-p|--print|--headless)|remote delegate' | grep -v grep || echo "(none)"

echo
echo "=========================================================="
echo "== 5. remote jobs (last 40)                              =="
echo "=========================================================="
remote jobs ls 2>/dev/null | head -40 || echo "(remote jobs unavailable)"

echo
echo "=========================================================="
echo "== 6. codex auth / token status                          =="
echo "=========================================================="
if [ -f "$HOME/.codex/auth.json" ]; then
  node -e 'const a=require(process.argv[1]); console.log("auth_mode="+(a.auth_mode||"?"))' "$HOME/.codex/auth.json" 2>/dev/null || echo "(auth.json unreadable)"
else
  echo "(no ~/.codex/auth.json)"
fi
