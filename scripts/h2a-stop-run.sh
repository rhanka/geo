#!/usr/bin/env bash
# h2a-stop-run.sh — arrête un run h2a nommé.
#
# Pourquoi ce script existe : un agent qui écrit sur la donnée SERVIE et dont la
# sortie a été rejetée doit pouvoir être arrêté. Sans ça, retirer un dépôt fautif
# ne sert à rien — l'agent le réécrit derrière, et la production porte une
# affirmation qu'on a déjà jugée infondée.
#
# N'agit que sur la session tmux `remote-<nom>` créée par h2a_run, jamais sur un
# processus arbitraire : le nom est le seul paramètre et il est vérifié.
#
# Usage : bash scripts/h2a-stop-run.sh <nom-du-run>
set -euo pipefail

name="${1:-}"
if [[ -z "$name" ]]; then
  echo "usage: bash scripts/h2a-stop-run.sh <nom-du-run>" >&2
  exit 2
fi
if [[ ! "$name" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "nom de run invalide: $name" >&2
  exit 2
fi

session="remote-${name}"
if ! tmux has-session -t "$session" 2>/dev/null; then
  echo "session absente (deja terminee): $session"
  exit 0
fi

tmux kill-session -t "$session"
echo "session arretee: $session"
