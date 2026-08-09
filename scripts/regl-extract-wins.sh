#!/usr/bin/env bash
# regl-extract-wins.sh — extrait le texte (layout) des corps LOCAUX candidats-gain
# (work/zonage-norms/<slug>/*.pdf) vers un dossier de sortie, pour lecture verbatim.
# Usage: bash scripts/regl-extract-wins.sh <outdir>
set -u
out="$1"
C="work/zonage-norms"
ext() { # slug relpath firstlast
  local name="$1" rel="$2" f="$3" l="$4"
  pdftotext -layout -f "$f" -l "$l" "$C/$rel" "$out/$name.txt" 2>/dev/null \
    && echo "OK $name -> $out/$name.txt" || echo "FAIL $name ($rel)"
}
ext langegardien "lange-gardien--la-cote-de-beaupre/corps-zonage.pdf" 1 6
ext stpatrice "saint-patrice-de-sherrington/grille.pdf" 1 6
ext saintemartine "sainte-martine/grille.pdf" 1 5
ext plaisance "plaisance/grille.pdf" 1 6
ext soreltracy "sorel-tracy/grille.pdf" 1 2
