#!/usr/bin/env bash
# h2a-runs-status.sh — read-only status of the codex agents launched via `h2a run`.
#
# The drumbeat loop needs, at every beat: which agents are still running, which
# finished, and what the finished ones concluded. Doing that with ad-hoc
# `ls -t | head` + `tail` is exactly what the bash gate forbids (and what makes a
# beat unreproducible), so the lookup lives here.
#
# An h2a run leaves .h2a/runs/<name>/ with output.log (the codex transcript) and,
# when the agent completed, result.json. A run with no result.json is either still
# going or died — the log tail is the only way to tell, so it is always printed.
#
# Usage:
#   bash scripts/h2a-runs-status.sh              # 8 most recent runs, 25-line tails
#   bash scripts/h2a-runs-status.sh 12 60        # 12 most recent, 60-line tails
#   bash scripts/h2a-runs-status.sh --name <run> # one run, 200-line tail
set -u
cd "$(dirname "$0")/.." || exit 1
RUNS=".h2a/runs"

[ -d "$RUNS" ] || { echo "no $RUNS directory"; exit 0; }

if [ "${1:-}" = "--name" ]; then
  d="$RUNS/${2:?usage: --name <run-name>}"
  [ -d "$d" ] || { echo "unknown run: ${2}"; exit 1; }
  echo "== $2"
  echo "-- model / start:"
  head -6 "$d/output.log" 2>/dev/null
  echo "-- result.json:"
  cat "$d/result.json" 2>/dev/null || echo "(absent — still running or died)"
  echo "-- output.log tail:"
  tail -n "${3:-200}" "$d/output.log" 2>/dev/null
  exit 0
fi

COUNT="${1:-8}"
TAIL="${2:-25}"

# Most recently touched first; mtime of the dir moves as the agent writes.
find "$RUNS" -mindepth 1 -maxdepth 1 -type d -printf '%T@\t%p\n' 2>/dev/null \
  | sort -rn | head -n "$COUNT" | cut -f2 \
  | while read -r d; do
      name="$(basename "$d")"
      if [ -f "$d/result.json" ]; then state="DONE"; else state="RUNNING?"; fi
      model="$(grep -m1 '^model:' "$d/output.log" 2>/dev/null || echo 'model: ?')"
      printf '\n===== %s [%s] (%s) =====\n' "$name" "$state" "$model"
      if [ -f "$d/result.json" ]; then
        echo "-- result.json:"
        head -c 4000 "$d/result.json"
        echo
      fi
      echo "-- output.log tail ($TAIL):"
      tail -n "$TAIL" "$d/output.log" 2>/dev/null || echo "(no output.log)"
    done
