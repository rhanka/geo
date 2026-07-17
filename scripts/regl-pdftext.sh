#!/usr/bin/env bash
# regl-pdftext.sh — extrait le texte (layout) des premières pages de chaque PDF
# de règlement téléchargé, pour lecture VERBATIM du numéro/millésime.
# Usage: bash scripts/regl-pdftext.sh <pdf_dir> [firstPage] [lastPage]
set -eu
dir="$1"
first="${2:-1}"
last="${3:-4}"
for f in "$dir"/*.pdf; do
  [ -e "$f" ] || continue
  base="${f%.pdf}"
  pdftotext -layout -f "$first" -l "$last" "$f" "$base.p${first}-${last}.txt" 2>/dev/null || echo "PDFTOTEXT-FAIL $f"
  echo "TXT $base.p${first}-${last}.txt"
done
