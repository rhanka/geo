#!/usr/bin/env bash
# regl-pdftext-full.sh — extrait le texte (layout) de TOUTES les pages (cap N)
# de chaque PDF <slug>.pdf du dossier, en ignorant les retry-*.pdf (pages 404).
# But: capturer les EN-TÊTES/PIEDS de grille qui nomment le règlement de base.
# Usage: bash scripts/regl-pdftext-full.sh <dir> [maxPages]
set -u
dir="$1"
max="${2:-60}"
for f in "$dir"/*.pdf; do
  [ -e "$f" ] || continue
  case "$f" in *"/retry-"*) continue;; esac
  head5=$(head -c 5 "$f" 2>/dev/null)
  [ "$head5" = "%PDF-" ] || { echo "SKIP-NOTPDF $f"; continue; }
  base="${f%.pdf}"
  pdftotext -layout -f 1 -l "$max" "$f" "$base.full.txt" 2>/dev/null || echo "FAIL $f"
done
echo "done full extract -> $dir/*.full.txt"
