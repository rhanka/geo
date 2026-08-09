#!/usr/bin/env bash
# geo-loop-tick.sh — thin shim. The fleet pilot is now TypeScript and config-driven:
#   fleet         → acquisition/config/fleet.json   (lanes/shards/prompts/models = DATA)
#   policy + logs → acquisition/src/geo-fleet.ts     (liveness/relaunch/reconcile/timeline)
# This entry point is kept for cron/back-compat; it just delegates to the TS pilot.
# Resize a lane without editing anything:  geo-loop-tick.sh --lane geo-nm=10
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
cd "$REPO" || exit 1
exec npx tsx acquisition/src/geo-fleet.ts tick "$@"
