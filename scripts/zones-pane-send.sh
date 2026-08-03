#!/usr/bin/env bash
# Injecte un message (une ligne) dans le pane d'un worker h2a idle, puis soumet.
# Usage: bash scripts/zones-pane-send.sh <session> <message-file>
# Le fichier message peut être multi-ligne ; les sauts de ligne sont aplatis en
# espaces (le TUI codex soumet sur Entrée, un newline = soumission prématurée).
# Sert à re-cadrer un worker warm quand l'inbox est cassé.
set -euo pipefail
session="${1:-}"; file="${2:-}"
[[ -z "$session" || -z "$file" ]] && { echo "usage: zones-pane-send.sh <session> <message-file>" >&2; exit 2; }
tmux has-session -t "$session" 2>/dev/null || { echo "session absente: $session" >&2; exit 1; }
[[ -f "$file" ]] || { echo "fichier absent: $file" >&2; exit 1; }
msg="$(tr '\n' ' ' < "$file")"
tmux send-keys -t "$session" -l "$msg"
sleep 0.3
tmux send-keys -t "$session" Enter
echo "envoyé à $session (${#msg} chars)"
