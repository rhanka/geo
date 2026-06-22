// Build PMTiles for QC zones + lots — node @aws-sdk/client-s3 (reliable; the broken aws CLI is bypassed)
// + tippecanoe via docker (klokantech/tippecanoe). ADR-0022. Zones first (quick win), then lots (heavy).
import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs";
import { pipeline } from "stream/promises";
import { execSync } from "child_process";

const W = "/tmp/pmtiles-work";
const LOG = "/home/antoinefa/src/_acquisition-shared/pmtiles-build.log";
const IMG = "klokantech/tippecanoe";
fs.mkdirSync(W + "/zones", { recursive: true });
fs.mkdirSync(W + "/lots", { recursive: true });
fs.mkdirSync(W + "/out", { recursive: true });
fs.writeFileSync(LOG, "");
const log = (m) => { const l = `[${new Date().toISOString().slice(11, 19)}] ${m}`; console.log(l); fs.appendFileSync(LOG, l + "\n"); };

const env = Object.fromEntries(
  fs.readFileSync("/home/antoinefa/src/_acquisition-shared/s3.env", "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const Bucket = env.S3_BUCKET || "sentropic-geo";
const s3 = new S3Client({ endpoint: env.S3_ENDPOINT, region: env.S3_REGION || "fr-par", forcePathStyle: true,
  credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY } });

async function listKeys(prefix, filter) {
  let token, keys = [];
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 }));
    for (const o of r.Contents || []) if (o.Key.endsWith(".geojson") && filter(o.Key)) keys.push(o.Key);
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return keys;
}
async function download(key, destDir) {
  const r = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
  await pipeline(r.Body, fs.createWriteStream(destDir + "/" + key.split("/").pop()));
}
async function pool(items, n, fn) {
  let i = 0, done = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const idx = i++; try { await fn(items[idx]); } catch (e) { log("ERR " + items[idx] + ": " + e.message); } if (++done % 200 === 0) log("  …" + done + "/" + items.length); }
  }));
}
function tippecanoe(layer, srcDir, outName, zopts) {
  execSync(`docker run --rm -v ${W}:/data --entrypoint sh ${IMG} -c 'tippecanoe -o /data/out/${outName} -l ${layer} -n "${layer}" ${zopts} --drop-densest-as-needed --maximum-tile-bytes 500000 --force /data/${srcDir}/*.geojson'`, { stdio: "inherit" });
}
async function upload(localPath, key) {
  await s3.send(new PutObjectCommand({ Bucket, Key: key, Body: fs.readFileSync(localPath), ContentType: "application/octet-stream" }));
}

log("START node pmtiles build");
try { execSync(`docker pull ${IMG}`, { stdio: "ignore" }); log("image pulled"); } catch (e) { log("pull warn: " + e.message); }

// ---- ZONES (small, first) ----
log("list zones"); const zk = await listKeys("normalized/ca-qc-zonage/", () => true); log("zones keys: " + zk.length);
log("download zones"); await pool(zk, 12, (k) => download(k, W + "/zones"));
log("tippecanoe zones"); tippecanoe("zones", "zones", "qc-zones.pmtiles", "-Z4 -z13 --coalesce-densest-as-needed --simplification 8");
log("upload qc-zones.pmtiles"); await upload(W + "/out/qc-zones.pmtiles", "pmtiles/qc-zones.pmtiles");
log("ZONES DONE size=" + fs.statSync(W + "/out/qc-zones.pmtiles").size);

// ---- LOTS (heavy, second) ----
log("list lots"); const lk = await listKeys("normalized/", (k) => k.includes("cadastre-lots")); log("lots keys: " + lk.length);
log("download lots (heavy ~2.6GB)"); await pool(lk, 16, (k) => download(k, W + "/lots"));
log("tippecanoe lots"); tippecanoe("lots", "lots", "qc-lots.pmtiles", "-Z11 -z16 --coalesce-densest-as-needed --drop-smallest-as-needed");
log("upload qc-lots.pmtiles"); await upload(W + "/out/qc-lots.pmtiles", "pmtiles/qc-lots.pmtiles");
log("LOTS DONE size=" + fs.statSync(W + "/out/qc-lots.pmtiles").size);
log("ALL DONE");
