#!/usr/bin/env bash
# regl-curl-retry.sh — re-télécharge via curl (UA navigateur + referer) les URL
# de règlement qui ont fait 404 via fetch. Sort dans <dir>/retry-<slug>.pdf.
# Usage: bash scripts/regl-curl-retry.sh <dir>
set -u
dir="$1"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
retry() {
  local slug="$1" url="$2"
  local out="$dir/retry-$slug.pdf"
  local code
  code=$(curl -sL -A "$UA" -e "https://www.google.com/" -o "$out" -w "%{http_code}" "$url")
  local sz
  sz=$(wc -c < "$out" 2>/dev/null || echo 0)
  printf '%s -> HTTP %s size=%s\n' "$slug" "$code" "$sz"
}
retry kirkland "https://www.ville.kirkland.qc.ca/wp-content/uploads/reglements/90-58-codification.pdf"
retry mont-laurier "https://www.villemontlaurier.qc.ca/storage/app/media/134-94-zonage.pdf"
retry mont-saint-michel "https://www.montsaintmichel.ca/sites/www.montsaintmichel.ca/files/Grilles_specifications_R257.pdf"
retry saint-patrice-de-sherrington "https://st-patrice-sherrington.com/wp-content/uploads/2022/04/308-zonage-fevrier-2016.pdf"
retry saint-hugues "https://saint-hugues.com/fichiersUpload/fichiers/annexeA.pdf"
retry notre-dame-du-sacre-coeur-dissoudun "http://www.issoudun.qc.ca/wp-content/uploads/2026/04/Grille-de-zonage.pdf"
retry saint-andre-dargenteuil "https://www.saint-andre-argenteuil.ca/storage/app/media/uploads/files/RUP/Annexe-B-Tableau-spec.pdf"
retry lange-gardien--la-cote-de-beaupre "https://municipalitedelangegardien.com/wp-content/uploads/2025/05/20240517-Annexe-3-Grilles-zonage.pdf"
retry lisle-aux-coudres "https://www.municipaliteiac.ca/lile-aux-coudres-grille-des-usages.pdf"
