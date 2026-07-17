#!/usr/bin/env bash
# h2a-run-diag.sh — show why `h2a run` fails to create a worker session.
#
# geo-worker.sh launches agents with `h2a run ... >/dev/null 2>&1`, so a failure
# surfaces only as "no pane for remote-<name>". This runs the same call with the
# error visible, and reports the tmux server/socket state around it — tmux keeps
# its socket under $TMUX_TMPDIR or /tmp/tmux-<uid>, so wiping or remounting /tmp
# orphans a running server and silently strands every session on it.
#
# Read-only apart from the one diagnostic session it starts (named geo-diag-1).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
WORKTMP="${GEO_TMPDIR:-$REPO/.h2a/tmp}"

echo "== tmux socket context =="
echo "TMUX_TMPDIR=${TMUX_TMPDIR:-(unset -> default /tmp/tmux-\$UID)}"
echo "uid=$(id -u)"
echo "-- /tmp itself (needs mode 1777 + sticky, or no user can create its socket dir):"
ls -ld /tmp 2>&1
stat -c '%A %U:%G %n' /tmp 2>&1
echo "-- can this user write in /tmp ?"
if touch /tmp/.geo-write-probe 2>/dev/null; then echo "WRITABLE"; rm -f /tmp/.geo-write-probe; else echo "NOT WRITABLE by uid $(id -u)"; fi
ls -la "/tmp/tmux-$(id -u)" 2>&1 | head -5

echo
echo "== tmux sessions seen from this shell =="
tmux list-sessions 2>&1 | head -10

echo
echo "== tmux server PIDs alive on the host =="
pgrep -a -f 'tmux.*server|tmux new-session' 2>/dev/null | head -5 || echo "(none)"

echo
echo "== h2a run, stderr visible =="
h2a run claude "$REPO" --name geo-diag-1 --no-attach --no-gw
echo "EXIT=$?"

echo
echo "== tmux sessions after =="
tmux list-sessions 2>&1 | head -10
