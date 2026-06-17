#!/usr/bin/env node
/**
 * run-cadastre-lots.mjs — LIVE province-wide acquisition of the Québec
 * "cadastre allégé" lot polygons, streamed incrementally to S3 (Scaleway,
 * ADR-0012), resumable, bounded-memory.
 *
 * ── What it does ──────────────────────────────────────────────────────────────
 *   • Reads the priority municipality registry (radar-immobilier
 *     municipalities.qc.json: 1104 non-excluded cities, sorted by priorityRank),
 *     builds a small WGS84 bbox around each city centroid, and crawls the
 *     ArcGIS REST MapServer layer 0 of the cadastre allégé over that bbox using
 *     recursive quad-subdivision (the same strategy as crawlArcgisLayer / the
 *     verified immo per-city recipe). The province-wide layer 404s on a bare
 *     where=1=1, so every request rides a spatial envelope filter.
 *   • Each lot polygon is normalized inline onto the same minimal shape as
 *     cadastreNormalizer (geoId = ca/qc/lot/<slug(NO_LOT)>, name/code/noLot =
 *     NO_LOT verbatim, level=locality, country=CA). NO data is fabricated — only
 *     live features the server returns are emitted.
 *   • Per city, features are de-duplicated by NO_LOT (a lot straddling a tile
 *     boundary is returned by multiple tiles) and STREAMED to a per-city shard
 *     on S3: qc-cadastre-lots/<slug>.geojson  (one valid FeatureCollection).
 *     The runner holds only the current city's NO_LOT set + tile batch in heap.
 *   • A merged, servable collection qc-cadastre-lots.geojson (+ .meta.json) is
 *     assembled incrementally on local disk (features appended, never all held
 *     in JS heap) from the first --serve-cities cities, then uploaded once. This
 *     is the artifact the geo-api StoreProvider serves.
 *   • Checkpoint qc-cadastre-lots/_checkpoint.json on S3 records done cities +
 *     cumulative lot count; a re-run skips done cities (resume).
 *
 * ── Politeness ────────────────────────────────────────────────────────────────
 *   • Honest User-Agent "sentropic-geo/0.1".
 *   • Throttle between tile requests (--throttle-ms, default 250).
 *   • Exponential backoff w/ jitter on HTTP 429/5xx and network errors,
 *     Retry-After respected (--max-retries, default 5).
 *   • Per-request timeout via AbortController (--timeout-ms, default 60000).
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *   node scripts/run-cadastre-lots.mjs [options]
 *     --cities <n>         number of priority cities to acquire (default 5;
 *                          use "all" or 1104 for province-wide priority list)
 *     --serve-cities <n>   cities merged into the servable collection (default
 *                          = --cities; cap to keep the served file loadable)
 *     --radius-km <km>     half-size of the per-city bbox (default 6)
 *     --max-depth <n>      max quad-subdivision depth per tile (default 7)
 *     --page-size <n>      record count per request (server caps at 2000)
 *     --throttle-ms <ms>   pause between tile requests (default 250)
 *     --timeout-ms <ms>    per-request timeout (default 60000)
 *     --max-retries <n>    retry budget per request (default 5)
 *     --prefix <p>         S3 key prefix (default "normalized"); the served
 *                          collection lives at <prefix>/qc-cadastre-lots.geojson
 *     --dry-run            crawl + normalize but do NOT write to S3 (prints stats)
 *     --no-resume          ignore the checkpoint, re-acquire every city
 *     --env <path>         dotenv file with S3_* creds (default
 *                          /home/antoinefa/src/_acquisition-shared/s3.env)
 *
 * Env: S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY.
 */

import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

// ── Config / constants ────────────────────────────────────────────────────────

const SERVICE_URL =
  "https://geo.environnement.gouv.qc.ca/donnees/rest/services/Reference/Cadastre_allege/MapServer";
const LAYER = 0;
const FIELD_NO_LOT = "NO_LOT";
const DATASET_ID = "qc-cadastre-lots";
const SOURCE_ID = "ca-qc/cadastre";
const USER_AGENT = "sentropic-geo/0.1";
const DEFAULT_ENV = "/home/antoinefa/src/_acquisition-shared/s3.env";
const MUNICIPALITIES =
  "/home/antoinefa/src/radar-immobilier/packages/radar-sources/src/geo/municipalities.qc.json";

const LICENSE = {
  id: "cc-by-4.0",
  title: "Creative Commons Attribution 4.0 International",
  url: "https://creativecommons.org/licenses/by/4.0/",
  redistributable: true,
  attributionRequired: true,
};
const ATTRIBUTION = "© Gouvernement du Québec — Cadastre allégé (MRNF/BDGQ), CC-BY 4.0";

// ── Tiny arg parser ───────────────────────────────────────────────────────────

function parseArgs(argv) {
  const a = {
    cities: 5,
    serveCities: undefined,
    radiusKm: 6,
    maxDepth: 7,
    pageSize: 2000,
    throttleMs: 250,
    timeoutMs: 60000,
    maxRetries: 5,
    prefix: "normalized",
    dryRun: false,
    resume: true,
    env: DEFAULT_ENV,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const k = argv[i];
    const v = argv[i + 1];
    switch (k) {
      case "--cities": a.cities = v === "all" ? Infinity : Number(v); i += 1; break;
      case "--serve-cities": a.serveCities = v === "all" ? Infinity : Number(v); i += 1; break;
      case "--radius-km": a.radiusKm = Number(v); i += 1; break;
      case "--max-depth": a.maxDepth = Number(v); i += 1; break;
      case "--page-size": a.pageSize = Number(v); i += 1; break;
      case "--throttle-ms": a.throttleMs = Number(v); i += 1; break;
      case "--timeout-ms": a.timeoutMs = Number(v); i += 1; break;
      case "--max-retries": a.maxRetries = Number(v); i += 1; break;
      case "--prefix": a.prefix = v; i += 1; break;
      case "--env": a.env = v; i += 1; break;
      case "--dry-run": a.dryRun = true; break;
      case "--no-resume": a.resume = false; break;
      default:
        if (k.startsWith("--")) throw new Error(`unknown flag ${k}`);
    }
  }
  if (a.serveCities === undefined) a.serveCities = a.cities;
  return a;
}

// ── dotenv (minimal) ──────────────────────────────────────────────────────────

async function loadEnv(path) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return; // rely on already-present process.env
  }
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim();
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

// ── HTTP with backoff + timeout ───────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function backoffDelay(attempt, baseMs) {
  return Math.floor(Math.random() * baseMs * 2 ** attempt) + 1;
}

async function fetchWithBackoff(url, { maxRetries, timeoutMs }) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: ac.signal,
      });
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
    if (res) {
      if (res.ok) return res;
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable) {
        throw new Error(`non-retryable HTTP ${res.status} ${res.statusText} for ${url}`);
      }
      lastErr = new Error(`HTTP ${res.status} ${res.statusText}`);
      if (attempt < maxRetries) {
        const ra = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(ra) && ra >= 0 ? ra * 1000 : backoffDelay(attempt, 500));
        continue;
      }
    } else if (attempt < maxRetries) {
      await sleep(backoffDelay(attempt, 500));
      continue;
    }
  }
  throw new Error(`exhausted ${maxRetries} retries for ${url} (last: ${lastErr?.message})`);
}

async function fetchTile(extent, { pageSize, maxRetries, timeoutMs }) {
  const [w, s, e, n] = extent;
  const params = new URLSearchParams({
    where: "1=1",
    geometry: `${w},${s},${e},${n}`,
    geometryType: "esriGeometryEnvelope",
    spatialRel: "esriSpatialRelIntersects",
    inSR: "4326",
    outSR: "4326",
    outFields: FIELD_NO_LOT,
    returnGeometry: "true",
    f: "geojson",
    resultRecordCount: String(pageSize),
  });
  const url = `${SERVICE_URL}/${LAYER}/query?${params.toString()}`;
  const res = await fetchWithBackoff(url, { maxRetries, timeoutMs });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`bad JSON from tile ${url}: ${text.slice(0, 200)}`);
  }
  if (json?.error) {
    throw new Error(`ArcGIS error for tile: ${JSON.stringify(json.error).slice(0, 200)}`);
  }
  if (json?.type !== "FeatureCollection" || !Array.isArray(json.features)) {
    throw new Error(`expected FeatureCollection from ${url}, got ${typeof json}`);
  }
  return json.features;
}

// ── Normalization (mirror of cadastreNormalizer, minimal) ─────────────────────

function slugify(s) {
  return String(s)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeFeature(feature, index) {
  const props = feature?.properties && typeof feature.properties === "object" ? feature.properties : {};
  let noLot = props[FIELD_NO_LOT];
  noLot = typeof noLot === "string" && noLot.trim() ? noLot.trim() : (feature.id != null ? String(feature.id) : `lot-${index}`);
  const geoId = `ca/qc/lot/${slugify(noLot)}`;
  return {
    type: "Feature",
    geometry: feature.geometry ?? null,
    properties: {
      ...props,
      geoId,
      name: noLot,
      code: noLot,
      level: "locality",
      country: "CA",
      noLot,
    },
  };
}

// ── BBox helpers ──────────────────────────────────────────────────────────────

function cityBbox(lat, lon, radiusKm) {
  const dLat = radiusKm / 111.32;
  const dLon = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}

function quadrants([w, s, e, n]) {
  const mx = (w + e) / 2;
  const my = (s + n) / 2;
  return [
    [w, s, mx, my],
    [mx, s, e, my],
    [w, my, mx, n],
    [mx, my, e, n],
  ];
}

// ── Crawl one city by recursive bbox subdivision, streaming unique lots ───────
//
// onFeature(normFeature) is called once per UNIQUE NO_LOT in this city. Returns
// { lots, tiles }. Memory held: a Set of NO_LOT strings for this city + the
// current tile batch only.

async function crawlCity(extent, opts, onFeature) {
  const seen = new Set();
  let tiles = 0;
  let lots = 0;
  const queue = [{ extent, depth: 0 }];
  while (queue.length > 0) {
    const tile = queue.shift();
    const batch = await fetchTile(tile.extent, opts);
    tiles += 1;
    if (batch.length >= opts.pageSize && tile.depth < opts.maxDepth) {
      for (const child of quadrants(tile.extent)) queue.push({ extent: child, depth: tile.depth + 1 });
    } else {
      for (let i = 0; i < batch.length; i += 1) {
        const f = batch[i];
        const noLot = f?.properties?.[FIELD_NO_LOT];
        const key = typeof noLot === "string" && noLot.trim() ? noLot.trim() : `__idx_${tiles}_${i}`;
        if (seen.has(key)) continue;
        seen.add(key);
        lots += 1;
        await onFeature(normalizeFeature(f, lots));
      }
    }
    if (opts.throttleMs > 0 && queue.length > 0) await sleep(opts.throttleMs);
  }
  return { lots, tiles };
}

// ── A GeoJSON FeatureCollection writer that streams to a file ─────────────────
//
// Writes `{"type":"FeatureCollection","features":[` then comma-separated
// features then `]}` so the produced file is one valid FeatureCollection
// without ever holding all features in memory.

class GeoJsonFileWriter {
  constructor(path) {
    this.path = path;
    this.stream = createWriteStream(path, { encoding: "utf8" });
    this.count = 0;
    this.opened = false;
  }
  async #write(chunk) {
    if (!this.stream.write(chunk)) {
      await new Promise((res) => this.stream.once("drain", res));
    }
  }
  async open() {
    await this.#write('{"type":"FeatureCollection","features":[');
    this.opened = true;
  }
  async add(feature) {
    if (!this.opened) await this.open();
    await this.#write((this.count === 0 ? "" : ",") + JSON.stringify(feature));
    this.count += 1;
  }
  async close() {
    if (!this.opened) await this.open();
    await this.#write("]}");
    await new Promise((res, rej) => this.stream.end((err) => (err ? rej(err) : res())));
  }
}

// ── S3 helpers ────────────────────────────────────────────────────────────────

function makeS3() {
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION ?? "fr-par";
  const accessKeyId = process.env.S3_ACCESS_KEY;
  const secretAccessKey = process.env.S3_SECRET_KEY;
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error("S3_BUCKET not set");
  const client = new S3Client({
    endpoint,
    region,
    forcePathStyle: false,
    credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
  });
  return { client, bucket };
}

async function s3PutFile({ client, bucket }, key, filePath, contentType) {
  const Body = createReadStream(filePath);
  const { size } = await stat(filePath);
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body, ContentLength: size, ContentType: contentType }),
  );
  return size;
}

async function s3PutString({ client, bucket }, key, body, contentType) {
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
}

async function s3GetJson({ client, bucket }, key) {
  try {
    const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const text = await out.Body.transformToString();
    return JSON.parse(text);
  } catch (e) {
    if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) return undefined;
    throw e;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  await loadEnv(args.env);

  const munis = JSON.parse(await readFile(MUNICIPALITIES, "utf8"))
    .filter((m) => !m.excluded && m.priorityRank != null)
    .sort((a, b) => a.priorityRank - b.priorityRank);

  const cities = munis.slice(0, Number.isFinite(args.cities) ? args.cities : munis.length);
  const serveCount = Number.isFinite(args.serveCities) ? args.serveCities : cities.length;

  const keyPrefix = args.prefix ? `${args.prefix.replace(/\/+$/, "")}/` : "";
  const checkpointKey = `${keyPrefix}${DATASET_ID}/_checkpoint.json`;
  const shardKey = (slug) => `${keyPrefix}${DATASET_ID}/${slug}.geojson`;
  const shardMetaKey = (slug) => `${keyPrefix}${DATASET_ID}/${slug}.meta.json`;
  const servedKey = `${keyPrefix}${DATASET_ID}.geojson`;
  const servedMetaKey = `${keyPrefix}${DATASET_ID}.meta.json`;

  console.log(
    `[run-cadastre-lots] cities=${cities.length} serveCities=${serveCount} radiusKm=${args.radiusKm} ` +
      `maxDepth=${args.maxDepth} pageSize=${args.pageSize} throttleMs=${args.throttleMs} ` +
      `prefix="${args.prefix}" dryRun=${args.dryRun} resume=${args.resume}`,
  );

  let s3;
  let checkpoint = { done: {}, totalLots: 0, startedAt: new Date().toISOString() };
  if (!args.dryRun) {
    s3 = makeS3();
    if (args.resume) {
      const existing = await s3GetJson(s3, checkpointKey);
      if (existing && typeof existing === "object") {
        checkpoint = { done: existing.done ?? {}, totalLots: existing.totalLots ?? 0, startedAt: existing.startedAt ?? checkpoint.startedAt };
        console.log(`[run-cadastre-lots] resumed checkpoint: ${Object.keys(checkpoint.done).length} cities done, ${checkpoint.totalLots} lots so far`);
      }
    }
  }

  const work = await mkdtemp(join(tmpdir(), "qc-lots-"));
  const fetchedAt = new Date().toISOString();

  // The merged servable collection is assembled incrementally on local disk.
  const servedPath = join(work, "served.geojson");
  const servedWriter = new GeoJsonFileWriter(servedPath);

  let grandTotal = 0;
  let citiesAcquired = 0;
  const perCity = [];

  for (let idx = 0; idx < cities.length; idx += 1) {
    const m = cities[idx];
    const inServed = idx < serveCount;
    if (args.resume && checkpoint.done[m.slug]) {
      const prev = checkpoint.done[m.slug];
      grandTotal += prev.lots ?? 0;
      perCity.push({ slug: m.slug, lots: prev.lots ?? 0, tiles: prev.tiles ?? 0, skipped: true });
      // If this city should be in the served file, pull its shard back and append.
      if (inServed && !args.dryRun) {
        const shard = await s3GetJson(s3, shardKey(m.slug));
        if (shard?.features) {
          for (const f of shard.features) await servedWriter.add(f);
        }
      }
      console.log(`[${idx + 1}/${cities.length}] ${m.slug}: SKIP (checkpoint, ${prev.lots ?? 0} lots)`);
      continue;
    }

    const extent = cityBbox(m.lat, m.lon, args.radiusKm);
    const shardPath = join(work, `${m.slug}.geojson`);
    const shardWriter = new GeoJsonFileWriter(shardPath);

    const onFeature = async (f) => {
      await shardWriter.add(f);
      if (inServed) await servedWriter.add(f);
    };

    const t0 = Date.now();
    let result;
    try {
      result = await crawlCity(extent, args, onFeature);
    } catch (e) {
      await shardWriter.close().catch(() => {});
      console.error(`[${idx + 1}/${cities.length}] ${m.slug}: ERROR ${e.message}`);
      perCity.push({ slug: m.slug, error: e.message });
      // Persist checkpoint progress so a re-run resumes after this city's failure.
      if (!args.dryRun) await s3PutString(s3, checkpointKey, JSON.stringify(checkpoint), "application/json").catch(() => {});
      continue;
    }
    await shardWriter.close();

    grandTotal += result.lots;
    citiesAcquired += 1;
    perCity.push({ slug: m.slug, lots: result.lots, tiles: result.tiles });

    if (!args.dryRun) {
      const size = await s3PutFile(s3, shardKey(m.slug), shardPath, "application/geo+json");
      const shardMeta = {
        sourceId: SOURCE_ID,
        datasetId: `qc-lots-${m.slug}`,
        title: `Lots cadastraux - ${m.name ?? m.slug} (cadastre allege du Quebec)`,
        description: `Shard municipal des lots cadastraux alleges pour ${m.name ?? m.slug}.`,
        license: "See source metadata",
        attribution: "Gouvernement du Quebec - cadastre du Quebec",
        crs: "EPSG:4326",
        municipalitySlug: m.slug,
        municipalityName: m.name ?? null,
        fetchedAt: new Date().toISOString(),
        count: result.lots,
        bytes: size,
      };
      if (m.mamhCode) shardMeta.mamhCode = m.mamhCode;
      await s3PutString(s3, shardMetaKey(m.slug), JSON.stringify(shardMeta, null, 2) + "\n", "application/json");
      checkpoint.done[m.slug] = { lots: result.lots, tiles: result.tiles, bytes: size, at: new Date().toISOString() };
      checkpoint.totalLots = grandTotal;
      await s3PutString(s3, checkpointKey, JSON.stringify(checkpoint), "application/json");
    }

    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(
      `[${idx + 1}/${cities.length}] ${m.slug}: ${result.lots} lots, ${result.tiles} tiles, ${secs}s` +
        (inServed ? " (in served)" : ""),
    );
    await rm(shardPath, { force: true }).catch(() => {});
  }

  await servedWriter.close();

  // Build + upload the servable collection + its meta.
  const servedCount = servedWriter.count;
  if (!args.dryRun) {
    await s3PutFile(s3, servedKey, servedPath, "application/geo+json");
    const meta = {
      sourceId: SOURCE_ID,
      datasetId: DATASET_ID,
      title: "Lots cadastraux — cadastre allégé du Québec (NO_LOT)",
      license: LICENSE,
      attribution: ATTRIBUTION,
      crs: "EPSG:4326",
      fetchedAt,
      count: servedCount,
    };
    await s3PutString(s3, servedMetaKey, JSON.stringify(meta, null, 2), "application/json");
  }

  const servedSize = (await stat(servedPath)).size;
  await rm(work, { recursive: true, force: true }).catch(() => {});

  console.log("──────────────────────────────────────────────────────────────");
  console.log(`[run-cadastre-lots] DONE`);
  console.log(`  cities acquired (this run): ${citiesAcquired}`);
  console.log(`  total unique lots across all cities: ${grandTotal}`);
  console.log(`  served collection "${DATASET_ID}": ${servedCount} features, ${(servedSize / 1e6).toFixed(2)} MB`);
  if (!args.dryRun) {
    console.log(`  S3 served key:   s3://${process.env.S3_BUCKET}/${servedKey}`);
    console.log(`  S3 meta key:     s3://${process.env.S3_BUCKET}/${servedMetaKey}`);
    console.log(`  S3 shard prefix: s3://${process.env.S3_BUCKET}/${keyPrefix}${DATASET_ID}/`);
    console.log(`  serve with: geo serve --data s3://${process.env.S3_BUCKET}/${args.prefix} --port 8787`);
  } else {
    console.log(`  DRY RUN — nothing written to S3.`);
  }
  // Machine-readable summary line for the conductor.
  console.log(
    `RESULT_JSON ${JSON.stringify({
      citiesAcquired,
      citiesTotal: cities.length,
      totalLots: grandTotal,
      servedFeatures: servedCount,
      servedBytes: servedSize,
      dryRun: args.dryRun,
      perCity,
    })}`,
  );
}

main().catch((e) => {
  console.error("[run-cadastre-lots] FATAL", e);
  process.exit(1);
});
