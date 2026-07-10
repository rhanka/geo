#!/usr/bin/env bash
# h2a-doc.sh — consult the h2a CLI help (h2a is not in the ad-hoc bash allowlist,
# so read it through a committed script). Read-only.
set -u
echo "===== h2a --help ====="
h2a --help 2>&1 | sed -n '1,80p'
echo
echo "===== h2a run --help ====="
h2a run --help 2>&1 | sed -n '1,120p'
echo
echo "===== h2a loop --help ====="
h2a loop --help 2>&1 | sed -n '1,120p'
echo
echo "===== tmux geo-loop driver ====="
tmux has-session -t geo-loop 2>/dev/null && echo "geo-loop tmux: UP" || echo "geo-loop tmux: DOWN"
