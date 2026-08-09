#!/usr/bin/env bash
# geo-reap-finished-workers.sh — reape les sessions tmux de workers geo TERMINÉS.
#
# Pourquoi ce script existe : h2a_run laisse fuir une session tmux par worker
# après la sortie du processus (la session persiste et retient de la mémoire).
# scripts/h2a-stop-run.sh ne gère que le nommage `remote-<nom>` ; la flotte geo
# actuelle nomme ses workers `h2a-<label>`. Ce script reape CES sessions-là, mais
# seulement les nôtres (geo) et seulement si elles sont réellement inactives —
# jamais un conducteur de lane vivant ni un worker encore en vol.
#
# Trois gardes, toutes obligatoires (une session doit passer les trois) :
#   1. nom passé EXPLICITEMENT en argument (liste blanche du conducteur) ;
#   2. nom = worker geo `h2a-…` et PAS un conducteur de lane `h2a-geo-<lane>` ;
#   3. inactivité tmux > MIN_IDLE secondes (défaut 5400 = 90 min) — filet qui
#      épargne tout worker redevenu actif entre le snapshot et l'exécution.
#
# Usage : bash scripts/geo-reap-finished-workers.sh <session…>
#         MIN_IDLE=7200 bash scripts/geo-reap-finished-workers.sh <session…>
set -euo pipefail

MIN_IDLE="${MIN_IDLE:-5400}"
now="$(date +%s)"

if [[ $# -eq 0 ]]; then
  echo "usage: bash scripts/geo-reap-finished-workers.sh <session…>" >&2
  exit 2
fi

reaped=0 skipped=0
for name in "$@"; do
  # garde 2a : préfixe geo attendu
  if [[ ! "$name" =~ ^h2a- ]]; then
    echo "SKIP  $name — pas un préfixe h2a-"; skipped=$((skipped+1)); continue
  fi
  # garde 2b : NE JAMAIS toucher un conducteur de lane h2a-geo-<lane> (suffixe unique)
  if [[ "$name" =~ ^h2a-geo-[a-z]+[0-9]*$ ]]; then
    echo "SKIP  $name — conducteur de lane (protégé)"; skipped=$((skipped+1)); continue
  fi
  # nom bien formé (sécurité tmux)
  if [[ ! "$name" =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "SKIP  $name — nom invalide"; skipped=$((skipped+1)); continue
  fi
  if ! tmux has-session -t "$name" 2>/dev/null; then
    echo "SKIP  $name — session absente (déjà terminée)"; skipped=$((skipped+1)); continue
  fi
  # garde 3 : inactivité
  act="$(tmux display-message -p -t "$name" '#{session_activity}' 2>/dev/null || echo 0)"
  idle=$(( now - act ))
  if (( idle < MIN_IDLE )); then
    echo "SKIP  $name — actif (idle ${idle}s < ${MIN_IDLE}s)"; skipped=$((skipped+1)); continue
  fi
  tmux kill-session -t "$name"
  echo "REAP  $name — idle ${idle}s"
  reaped=$((reaped+1))
done

echo "---"
echo "reaped=${reaped} skipped=${skipped}"
