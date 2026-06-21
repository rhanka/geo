#!/usr/bin/env bash
# Corrige les 6 PARTIAL: résolution par code géo, ambiguës tranchées au join%, upload sous clé cadastre.
set -uo pipefail
cd /home/antoinefa/src/geo
ENVF=/home/antoinefa/src/_acquisition-shared/s3.env
mkdir -p /tmp/fix
LOG=/tmp/role_fix6.log; : > "$LOG"

run_one(){ # slug code -> /tmp/fix/<slug>__<code>.parquet ; renvoie join% sur stdout
  local slug="$1" code="$2"
  local out
  out=$(timeout 150 python3 acquisition/role_foncier.py "$code" --lots "/tmp/lots/$slug.geojson" --output "/tmp/fix/${slug}__${code}.parquet" 2>&1)
  echo "$out" | grep -iE "jointure|join|%|matricule|Erreur|Error" >> "$LOG"
  # capture le dernier pourcentage de jointure
  echo "$out" | grep -oiE "[0-9]+(\.[0-9]+)?%" | tail -1
}

upload(){ # localparquet  s3key
  ENVF="$ENVF" SRC="$1" KEY="$2" node --input-type=module -e '
import {S3Client,PutObjectCommand} from "@aws-sdk/client-s3"; import fs from "fs";
const e=Object.fromEntries(fs.readFileSync(process.env.ENVF,"utf8").split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const s3=new S3Client({endpoint:e.S3_ENDPOINT,region:e.S3_REGION||"fr-par",forcePathStyle:true,credentials:{accessKeyId:e.S3_ACCESS_KEY,secretAccessKey:e.S3_SECRET_KEY}});
await s3.send(new PutObjectCommand({Bucket:"sentropic-geo",Key:process.env.KEY,Body:fs.readFileSync(process.env.SRC),ContentType:"application/octet-stream"}));
console.log("UPLOADED "+process.env.KEY);
' 2>>"$LOG"
}

# --- 4 sans ambiguïté ---
declare -A SINGLE=( [rosemere]=73020 [saint-charles-borromee]=61035 [saint-come-liniere]=29057 [petite-riviere-saint-francois]=16005 )
for slug in rosemere saint-charles-borromee saint-come-liniere petite-riviere-saint-francois; do
  code=${SINGLE[$slug]}
  echo "--- $slug (code $code) ---" | tee -a "$LOG"
  pct=$(run_one "$slug" "$code")
  if [ -f "/tmp/fix/${slug}__${code}.parquet" ]; then
    upload "/tmp/fix/${slug}__${code}.parquet" "registry/role-foncier/${slug}.parquet"
    echo "OK $slug code=$code join=$pct" | tee -a "$LOG"
  else echo "FAIL $slug code=$code (pas de parquet)" | tee -a "$LOG"; fi
done

# --- 2 ambiguës : essayer les 2 candidats, garder le meilleur join% ---
pick_best(){ # slug c1 c2
  local slug="$1" c1="$2" c2="$3"
  echo "--- $slug (ambigu $c1 vs $c2) ---" | tee -a "$LOG"
  local p1 p2; p1=$(run_one "$slug" "$c1"); p2=$(run_one "$slug" "$c2")
  local n1=${p1%\%}; n2=${p2%\%}; n1=${n1:-0}; n2=${n2:-0}
  echo "  $c1 join=$p1 | $c2 join=$p2" | tee -a "$LOG"
  local best bestp
  if awk "BEGIN{exit !($n1>=$n2)}"; then best=$c1; bestp=$p1; else best=$c2; bestp=$p2; fi
  if [ -f "/tmp/fix/${slug}__${best}.parquet" ]; then
    upload "/tmp/fix/${slug}__${best}.parquet" "registry/role-foncier/${slug}.parquet"
    echo "OK $slug code=$best join=$bestp (gagnant)" | tee -a "$LOG"
  else echo "FAIL $slug (pas de parquet)" | tee -a "$LOG"; fi
}
pick_best "notre-dame-de-lourdes--lerable" 32080 61045
pick_best "hemmingford--les-jardins-de-napierville--2" 68010 68015
echo "=== FIN FIX6 ===" | tee -a "$LOG"
