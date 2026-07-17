#!/usr/bin/env bash
# tmux-crash-diag.sh — find why the tmux server refuses to start.
#
# Symptom: `tmux new-session` prints "server exited unexpectedly" and exits 1, so
# every `h2a run` fails and the whole agent fleet is unlaunchable. This captures the
# facts instead of blaming the last thing that changed: free space on the filesystem
# backing /tmp, socket-dir ownership/mode, a stray config, and the server's own -vv
# crash log.
#
# Read-only apart from the tmux server log it writes under the repo scratch.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
LOGDIR="${GEO_TMPDIR:-$REPO/.h2a/tmp}/tmux-diag"
mkdir -p "$LOGDIR"

echo "== free space on the fs backing /tmp (a full disk kills the server) =="
df -h /tmp / 2>&1
echo
echo "-- inodes (exhausted inodes look like a full disk):"
df -i /tmp / 2>&1

echo
echo "== socket dir =="
ls -ld "/tmp/tmux-$(id -u)" 2>&1
echo "expected: drwx------ owned by $(id -un)"

echo
echo "== stray tmux config (a bad line kills the server at startup) =="
for f in ~/.tmux.conf ~/.config/tmux/tmux.conf /etc/tmux.conf; do
  [ -e "$f" ] && { echo "--- $f"; head -20 "$f"; } || echo "(absent) $f"
done

echo
echo "== tmux version =="
tmux -V 2>&1

echo
echo "== server start with verbose logging =="
rm -f "$LOGDIR"/tmux-server-*.log 2>/dev/null || true
( cd "$LOGDIR" && tmux -vv new-session -d -s geo-crashtest "sleep 30" 2>&1; echo "new-session exit=$?" )
echo
echo "-- server log tail:"
tail -n 30 "$LOGDIR"/tmux-server-*.log 2>/dev/null || echo "(no server log written — server died before logging)"
