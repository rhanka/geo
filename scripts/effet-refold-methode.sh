#!/usr/bin/env bash
# effet-refold-methode.sh — re-plie l'effet densifiant sur les villes deja pliees,
# pour y faire descendre `effet_densifiant_methode`, `densite_avant_source` et
# `densite_apres_source` : trois champs que le fold produisait et jetait.
#
# 80 des 224 deltas des artefacts sont `deduit` (inferes des classes d'habitation
# autorisees) et non `explicit` (lus dans une colonne de grille). Sans la methode
# ni la citation a la page, un consommateur qui annote un proces-verbal ne peut
# ni distinguer les deux, ni citer sa source.
#
# La config par ville N'EST PAS DEVINEE : elle vient des octets servis, recuperee
# par `acquisition/src/_effet-refold-methode-batch.ts`, qui ECARTE toute ville
# dont les quatre valeurs ne sont pas retrouvees de facon unique. Les lignes
# ci-dessous sont sa sortie, figee ici pour etre rejouable et auditable.
#
# saint-raphael et sainte-catherine sont ABSENTES a dessein : leur config servie
# n'est pas unique. Les re-plier avec une config supposee reecrirait un millesime
# faux sur de la donnee servie.
#
# Usage : bash scripts/effet-refold-methode.sh
set -u
cd "$(dirname "$0")/../acquisition" || exit 1

export NODE_OPTIONS=--dns-result-order=ipv4first
export AWS_MAX_ATTEMPTS=10

fold() {
  local slug="$1" oldR="$2" newR="$3" oldM="$4" newM="$5"
  echo "== $slug"
  npx tsx src/fold-effet-densifiant.ts --slug "$slug" \
    --old-reglement "$oldR" --new-reglement "$newR" \
    --old-millesime "$oldM" --new-millesime "$newM" 2>&1 \
    | grep -E '^OK|^old=|rror' || echo "   (aucune ligne OK — verifier)"
}

fold alma                      199-2012      428-2024      2012 2024
fold cowansville               1841          1841-41-2023  2016 2023
fold rimouski                  820-2014      24-018        2014 2024
fold saint-amable              712-00-2013   712-47-2026   2013 2026
fold saint-charles-borromee    2207-2022     2207-5-2024   2022 2024
fold stratford                 1035          1189          2009 2021
fold saint-stanislas-de-kostka 330-2018      451-2025      2018 2025
# coaticook: son `--old-reglement` est une phrase et son `--new-reglement` vaut
# RD-104, qui est un CODE DE ZONE pris pour un numero de reglement. L'artefact 4a
# l'exclut deja pour cette raison; on ne le re-plie pas ici.
