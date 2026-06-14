/**
 * Produce normalized data for @sentropic/geo-source-fr.
 *
 * The IGN ADMIN EXPRESS bulk archive is a `.7z`, which `@sentropic/geo-acquire`'s
 * built-in GDAL path (ZIP-only `/vsizip/`) cannot open. This script therefore
 * mirrors that pipeline locally, while reusing the package's normalizers and
 * geo-acquire's `writeNormalized` so the on-disk output is identical in shape:
 *
 *   1. download the `.7z` (cached under .cache/geo-fr-raw/, gitignored) if absent,
 *   2. extract the inner GeoPackage (gitignored),
 *   3. for each produced dataset, `ogr2ogr` the layer → WGS84 GeoJSON (RFC 7946)
 *      with the manifest's per-dataset `simplify` tolerance,
 *   4. run the dataset's normalizer → AdminFeatureCollection,
 *   5. assemble CollectionMeta (license/attribution/checksum) and
 *      writeNormalized() to data/normalized/<sourceSlug>/.
 *
 * fr-communes is intentionally skipped (see manifest.ts): its GeoJSON exceeds
 * the ~25 MB target even at aggressive simplification.
 *
 * Usage:  tsx scripts/produce.ts [--out <dir>] [--communes]
 */

import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  WGS84,
  attributionLine,
  getDataset,
  resolveManifestLicense,
  type AdminFeatureCollection,
  type CollectionMeta,
  type DatasetManifest,
  type NormalizedDataset,
} from "@sentropic/geo-core";
import { writeNormalized } from "@sentropic/geo/acquire";
import type { NormalizeContext } from "@sentropic/geo-core";

import {
  ADMIN_EXPRESS_7Z_URL,
  ADMIN_EXPRESS_INNER_GPKG,
  DATASET_COMMUNES,
  DATASET_DEPARTEMENTS,
  DATASET_REGIONS,
  manifest,
} from "../src/manifest.js";
import { normalizers } from "../src/index.js";

const execFileAsync = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");

const RAW_DIR = join(repoRoot, ".cache", "geo-fr-raw");
const ARCHIVE_PATH = join(RAW_DIR, "admin-express-fra.7z");
const GPKG_PATH = join(RAW_DIR, "ade-cog-carto-fra.gpkg");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const includeCommunes = process.argv.includes("--communes");
const outDir = arg("--out") ?? join(repoRoot, "data", "normalized");

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureArchive(): Promise<void> {
  if (await exists(ARCHIVE_PATH)) {
    console.log(`[fr] archive cached: ${ARCHIVE_PATH}`);
    return;
  }
  await mkdir(RAW_DIR, { recursive: true });
  console.log(`[fr] downloading ${ADMIN_EXPRESS_7Z_URL}`);
  const res = await fetch(ADMIN_EXPRESS_7Z_URL);
  if (!res.ok || !res.body) {
    throw new Error(`download failed: HTTP ${res.status}`);
  }
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(ARCHIVE_PATH));
  console.log(`[fr] saved ${ARCHIVE_PATH}`);
}

async function ensureGpkg(): Promise<void> {
  if (await exists(GPKG_PATH)) {
    console.log(`[fr] gpkg extracted: ${GPKG_PATH}`);
    return;
  }
  console.log(`[fr] extracting GeoPackage from archive…`);
  // 7z `e` flattens; extract just the inner .gpkg to a temp dir then rename.
  const tmp = join(RAW_DIR, "_extract");
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  await execFileAsync("7z", ["e", "-y", `-o${tmp}`, ARCHIVE_PATH, ADMIN_EXPRESS_INNER_GPKG], {
    maxBuffer: 64 * 1024 * 1024,
  });
  const extracted = join(tmp, ADMIN_EXPRESS_INNER_GPKG.split("/").pop()!);
  await execFileAsync("mv", [extracted, GPKG_PATH]);
  await rm(tmp, { recursive: true, force: true });
  console.log(`[fr] saved ${GPKG_PATH}`);
}

function simplifyOf(dataset: DatasetManifest): number {
  const s = dataset.query?.["simplify"];
  return typeof s === "number" ? s : 0.0008;
}

async function ogrToGeoJson(layer: string, tolerance: number): Promise<unknown> {
  const out = join(RAW_DIR, `_layer_${layer}.geojson`);
  await rm(out, { force: true });
  await execFileAsync(
    "ogr2ogr",
    [
      "-f",
      "GeoJSON",
      "-t_srs",
      "EPSG:4326",
      "-simplify",
      String(tolerance),
      "-lco",
      "RFC7946=YES",
      "-lco",
      "COORDINATE_PRECISION=6",
      out,
      GPKG_PATH,
      layer,
    ],
    { maxBuffer: 256 * 1024 * 1024 },
  );
  const json = JSON.parse(await readFile(out, "utf8")) as unknown;
  await rm(out, { force: true });
  return json;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const rec = v as Record<string, unknown>;
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(rec).sort()) sorted[k] = rec[k];
      return sorted;
    }
    return v;
  });
}

async function produceDataset(datasetId: string): Promise<void> {
  const dataset = getDataset(manifest, datasetId);
  if (!dataset) throw new Error(`unknown dataset ${datasetId}`);
  const layer = dataset.layer;
  if (typeof layer !== "string") throw new Error(`dataset ${datasetId} has no string layer`);

  console.log(`[fr] ${datasetId}: ogr2ogr layer "${layer}" simplify ${simplifyOf(dataset)}`);
  const raw = await ogrToGeoJson(layer, simplifyOf(dataset));

  const ctx: NormalizeContext = { manifest, dataset };
  const collection: AdminFeatureCollection = normalizers[datasetId]!(raw, ctx);

  const license = resolveManifestLicense(manifest);
  const meta: CollectionMeta = {
    sourceId: manifest.id,
    datasetId: dataset.id,
    title: dataset.title,
    license,
    attribution: attributionLine(manifest.provider.name, license),
    crs: WGS84,
    fetchedAt: new Date().toISOString(),
    count: collection.features.length,
    checksum: {
      algo: "sha256",
      value: createHash("sha256").update(canonicalJson(collection)).digest("hex"),
    },
  };

  const normalized: NormalizedDataset = { meta, collection };
  const { geojsonPath } = await writeNormalized(normalized, outDir);
  const { size } = await stat(geojsonPath);
  console.log(
    `[fr] ${datasetId}: ${collection.features.length} features → ${geojsonPath} ` +
      `(${(size / 1_000_000).toFixed(2)} MB)`,
  );
}

async function main(): Promise<void> {
  await ensureArchive();
  await ensureGpkg();

  await produceDataset(DATASET_REGIONS);
  await produceDataset(DATASET_DEPARTEMENTS);

  if (includeCommunes) {
    await produceDataset(DATASET_COMMUNES);
  } else {
    console.log(`[fr] ${DATASET_COMMUNES}: skipped (declared in manifest, data not produced).`);
  }

  console.log("[fr] done.");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
