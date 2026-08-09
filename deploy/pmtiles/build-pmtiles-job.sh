#!/usr/bin/env bash
# Runs INSIDE a Scaleway Serverless Job (remote) — reads GeoJSON from S3, builds PMTiles
# with modern tippecanoe (bounded tile bytes), writes PMTiles back to S3. Zero local-machine load.
# Env (job): S3_ENDPOINT, S3_BUCKET, S3_REGION, S3_ACCESS_KEY, S3_SECRET_KEY.
set -euo pipefail
# tippecanoe + awscli are BAKED in the image (Scaleway job has no egress to ubuntu archives).
echo "[$(date -u +%H:%M:%S)] tippecanoe $(tippecanoe --version 2>&1 | head -1)"
export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" AWS_DEFAULT_REGION="${S3_REGION:-fr-par}"
B="${S3_BUCKET:-sentropic-geo}"
A=(aws --endpoint-url "$S3_ENDPOINT")
mkdir -p /w/zones /w/lots /w/out

echo "[$(date -u +%H:%M:%S)] ZONES sync"
"${A[@]}" s3 sync "s3://$B/normalized/ca-qc-zonage/" /w/zones/ --exclude '*' --include '*.geojson' --no-progress
echo "[$(date -u +%H:%M:%S)] ZONES tippecanoe ($(find /w/zones -name '*.geojson' | wc -l) files)"
find /w/zones -name '*.geojson' -print0 | xargs -0 tippecanoe \
  -o /w/out/qc-zones.pmtiles -l zones -n "QC zonage" \
  -Z4 -z13 --coalesce-densest-as-needed --drop-densest-as-needed --simplification 8 \
  --maximum-tile-bytes 500000 --force
"${A[@]}" s3 cp /w/out/qc-zones.pmtiles "s3://$B/pmtiles/qc-zones.pmtiles"
echo "[$(date -u +%H:%M:%S)] ZONES done $(stat -c%s /w/out/qc-zones.pmtiles) bytes"
rm -rf /w/zones

# LOTS — bulk sync once (fast/robust) then tile in batches from local, freeing disk progressively.
# Rationale: per-file `aws s3 cp` x~1000 caused "Job run exceeded timeout" (2h). One `aws s3 sync`
# is parallel + retried. Tippecanoe still tiled in batches of N files -> part .pmtiles (bound scratch
# under Scaleway 10Gi), deleting each batch's GeoJSON after tiling. Best run AFTER province-wide
# cadastre clip (clipped input is far smaller -> all-on-disk + scratch fits 10Gi comfortably).
echo "[$(date -u +%H:%M:%S)] LOTS sync (bulk)"
"${A[@]}" s3 sync "s3://$B/normalized/qc-cadastre-lots/" /w/lots/ --exclude '*' --include '*.geojson' --no-progress
find /w/lots -name '*.geojson' > /w/lots_files.txt
NF=$(wc -l < /w/lots_files.txt)
echo "[$(date -u +%H:%M:%S)] LOTS $NF files ($(du -sh /w/lots | cut -f1)) -> batches of ${LOTS_BATCH:=60}"
mkdir -p /w/parts
split -l "$LOTS_BATCH" -d -a 3 /w/lots_files.txt /w/batch_
for bf in /w/batch_*; do
  bn=$(basename "$bf")
  [ -s "$bf" ] || continue
  echo "[$(date -u +%H:%M:%S)] LOTS batch $bn ($(wc -l < "$bf") files) | disk: $(df -h /w | awk 'NR==2{print $4" free"}')"
  xargs -a "$bf" tippecanoe \
    -o "/w/parts/$bn.pmtiles" -l lots -n "QC cadastre lots" \
    -Z11 -z16 --coalesce-densest-as-needed --drop-densest-as-needed --drop-smallest-as-needed \
    --maximum-tile-bytes 500000 --force
  xargs -a "$bf" rm -f   # libère le disque au fur et à mesure
done
NP=$(find /w/parts -name '*.pmtiles' | wc -l)
echo "[$(date -u +%H:%M:%S)] LOTS tile-join $NP parts"
tile-join -o /w/out/qc-lots.pmtiles -pk -n "QC cadastre lots" -l lots --force /w/parts/*.pmtiles
"${A[@]}" s3 cp /w/out/qc-lots.pmtiles "s3://$B/pmtiles/qc-lots.pmtiles"
echo "[$(date -u +%H:%M:%S)] LOTS done $(stat -c%s /w/out/qc-lots.pmtiles) bytes"
rm -rf /w/parts /w/lots_keys.txt /w/batch_*

echo "[$(date -u +%H:%M:%S)] ALL DONE"
"${A[@]}" s3 ls "s3://$B/pmtiles/"
