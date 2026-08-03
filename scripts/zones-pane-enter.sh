#!/usr/bin/env bash
# Envoie une touche Entree (submit) a un ou plusieurs panes worker h2a.
# Usage: bash scripts/zones-pane-enter.sh <session> [<session> ...]
# Sert a soumettre un paste en attente ([Pasted Content]) dans le TUI codex.
set -u
for s in "$@"; do
  if tmux has-session -t "$s" 2>/dev/null; then
    tmux send-keys -t "$s" Enter
    echo "enter -> $s"
  else
    echo "session absente: $s"
  fi
done
