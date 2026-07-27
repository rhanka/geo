#!/usr/bin/env bash
# 4a-remeasure.sh — re-mesurer et republier l'artefact 4a, avec une heap suffisante.
#
# Pourquoi ce script existe : `immo-4a-delta-grille-export.ts` relit 871
# collections servies et sortait systématiquement à ~800/871 avec un code 0 et
# AUCUN JSON final — quatre fois de suite, dans mon shell comme dans une session
# tmux d'agent. Un code 0 sans sortie n'est pas une fin normale : le process est
# TUÉ. À ce volume de GeoJSON chargé, la cause probable est la heap V8, dont le
# défaut est bien en dessous de ce que ce balayage demande.
#
# `--dns-result-order=ipv4first` reste obligatoire (happy-eyeballs), et
# AWS_MAX_ATTEMPTS=10 aussi : un ETIMEDOUT S3 est un bug IPv6, pas une panne.
#
# Usage : bash scripts/4a-remeasure.sh <fichier-de-sortie>
set -euo pipefail

out="${1:-}"
if [[ -z "$out" ]]; then
  echo "usage: bash scripts/4a-remeasure.sh <fichier-de-sortie>" >&2
  exit 2
fi

cd "$(dirname "$0")/.."

# `--read-concurrency 2` est ce qui a REELLEMENT debloque ce runner apres six
# echecs. Ni la session (tmux vs shell), ni la heap ne suffisaient : le point de
# rupture se deplacait (800/871 puis 400/871), signe d'une contrainte de
# ressource concurrente et non d'une limite fixe. En lisant deux collections a la
# fois au lieu du defaut, le balayage complet passe. Ne pas remonter cette valeur
# sans la remesurer.
NODE_OPTIONS="--dns-result-order=ipv4first --max-old-space-size=8192" \
AWS_MAX_ATTEMPTS=10 \
  npx tsx ./acquisition/src/immo-4a-delta-grille-export.ts --read-concurrency 2 >"$out" 2>&1
