#!/usr/bin/env bash
# Batch rôle foncier en main-loop — idempotent (skip si parquet déjà sur S3), checkpoint par ville.
set -uo pipefail
cd /home/antoinefa/src/geo
ENVF=/home/antoinefa/src/_acquisition-shared/s3.env
mkdir -p /tmp/lots
LOG=/tmp/role_batch.log; : > "$LOG"

REMAINING="alma champlain coaticook cowansville la-sarre mont-saint-hilaire neuville plaisance rosemere saint-amable saint-boniface saint-charles-borromee saint-come-liniere saint-gilbert saint-mathieu-de-beloeil saint-stanislas-de-kostka sainte-catherine stratford sutton hemmingford--les-jardins-de-napierville--2 notre-dame-de-lourdes--lerable petite-riviere-saint-francois"

# Déjà déposés sur S3 (skip)
DONE=$(ENVF="$ENVF" node --input-type=module -e '
import {S3Client,ListObjectsV2Command} from "@aws-sdk/client-s3"; import fs from "fs";
const e=Object.fromEntries(fs.readFileSync(process.env.ENVF,"utf8").split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const s3=new S3Client({endpoint:e.S3_ENDPOINT,region:e.S3_REGION||"fr-par",forcePathStyle:true,credentials:{accessKeyId:e.S3_ACCESS_KEY,secretAccessKey:e.S3_SECRET_KEY}});
const r=await s3.send(new ListObjectsV2Command({Bucket:"sentropic-geo",Prefix:"registry/role-foncier/"}));
console.log((r.Contents||[]).map(o=>o.Key.split("/").pop().replace(".parquet","")).join(" "));
' 2>/dev/null)

dl_lots () { # slug -> /tmp/lots/<slug>.geojson ; exit 1 si absent
  local slug="$1"
  ENVF="$ENVF" SLUG="$slug" node --input-type=module -e '
import {S3Client,GetObjectCommand} from "@aws-sdk/client-s3"; import fs from "fs";
const e=Object.fromEntries(fs.readFileSync(process.env.ENVF,"utf8").split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const s3=new S3Client({endpoint:e.S3_ENDPOINT,region:e.S3_REGION||"fr-par",forcePathStyle:true,credentials:{accessKeyId:e.S3_ACCESS_KEY,secretAccessKey:e.S3_SECRET_KEY}});
const slug=process.env.SLUG;
try{ const r=await s3.send(new GetObjectCommand({Bucket:"sentropic-geo",Key:"normalized/qc-cadastre-lots/"+slug+".geojson"}));
  const ws=fs.createWriteStream("/tmp/lots/"+slug+".geojson"); await new Promise((res,rej)=>{r.Body.pipe(ws);ws.on("finish",res);ws.on("error",rej);});
  process.exit(0);}catch(err){ console.error("NO_LOTS "+slug); process.exit(1);}
' 2>>"$LOG"
}

for slug in $REMAINING; do
  if echo " $DONE " | grep -q " $slug "; then echo "SKIP(déjà) $slug" | tee -a "$LOG"; continue; fi
  echo "--- $slug ---" | tee -a "$LOG"
  if ! dl_lots "$slug"; then echo "FAIL-NOLOTS $slug" | tee -a "$LOG"; continue; fi
  out=$(timeout 150 python3 acquisition/role_foncier.py "$slug" --lots "/tmp/lots/$slug.geojson" --s3 2>&1)
  echo "$out" | grep -iE "join|jointure|%|parquet|S3|upload|Erreur|Error|Traceback" | tail -3 | tee -a "$LOG"
  echo "$out" | grep -qiE "upload|s3://|parquet.*écrit|déposé" && echo "OK $slug" | tee -a "$LOG" || echo "PARTIAL $slug" | tee -a "$LOG"
done
echo "=== FIN BATCH ===" | tee -a "$LOG"
