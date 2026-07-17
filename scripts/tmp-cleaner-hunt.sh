#!/usr/bin/env bash
# tmp-cleaner-hunt.sh — find what keeps wiping /tmp (and with it /tmp/tmux-$UID).
#
# tmux keeps its socket in $TMUX_TMPDIR or /tmp/tmux-<uid>. Anything that clears
# /tmp strands the tmux server: existing sessions become unreachable and every new
# `h2a run` fails, so the whole fleet dies silently. This lists the plausible
# cleaners so the culprit is named instead of guessed.
#
# Strictly read-only.
set -u

echo "== /tmp now =="
ls -ld /tmp 2>&1
echo "entries: $(ls -A /tmp 2>/dev/null | wc -l)"
echo "tmux socket dir present: $([ -d "/tmp/tmux-$(id -u)" ] && echo yes || echo NO)"

echo
echo "== systemd tmpfiles timers/services =="
systemctl list-timers --all 2>/dev/null | grep -i -E 'tmp|clean' || echo "(none)"
systemctl status systemd-tmpfiles-clean.timer 2>/dev/null | head -6 || true

echo
echo "== tmpfiles.d rules touching /tmp =="
grep -rsE '^\s*[DdRr].*\s/tmp' /usr/lib/tmpfiles.d /etc/tmpfiles.d 2>/dev/null | head -10 || echo "(none)"

echo
echo "== user crontab =="
crontab -l 2>/dev/null | grep -i -E 'tmp|clean' || echo "(no user cron touching tmp)"

echo
echo "== system cron =="
grep -rsi -E 'rm .*(/tmp)|tmpwatch|tmpreaper|clean.*tmp' /etc/cron* /etc/crontab 2>/dev/null | head -10 || echo "(none)"

echo
echo "== live processes mentioning tmp cleanup =="
ps -eo pid,etime,cmd --no-headers 2>/dev/null \
  | grep -iE 'tmpwatch|tmpreaper|systemd-tmpfiles|clean.*/tmp|rm -rf /tmp' \
  | grep -v grep | head -10 || echo "(none right now)"

echo
echo "== recently modified in /tmp (proxy for cleaner activity) =="
find /tmp -maxdepth 1 -mindepth 1 -newermt '-20 minutes' -printf '%TH:%TM %p\n' 2>/dev/null | sort | head -10
