/**
 * Vector-tile build CLI (measurement tool, SPEC_VECTOR_TILES.md). Read-only on
 * its sources; writes one PMTiles archive to a LOCAL path (`--out`) or nothing.
 * Publication (`_tiles/` on the store) is `archive.ts` (writer hook, prewarm).
 *
 *   node packages/geo/dist/tiles/build-cli.js --collection qc-lots-rawdon \
 *        (--api https://api.geo.sent-tech.ca | --store s3://<bucket>/normalized [--source-key k] | --file x.geojson) \
 *        [--out rawdon-lots.pmtiles] [--min-zoom 12] [--max-zoom 15] [--tolerance 1] \
 *        [--max-zoom-tolerance 0] [--buffer 64] [--no-shared-borders] [--border-check]
 *
 * `--api` reads `?profile=display` (one request; geometry rounded to 6
 * decimals, ≈ 5 cm, by the display mirror). `--store` reads the exact served
 * source. Prints one JSON report: build time, peak RSS, archive size, and per
 * zoom tile count, max tile size and the no-drop / border checks.
 */

import { closeSync, createReadStream, openSync, writeSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { parseFeatureCollectionStream } from "../api/providers/collection-loader.js";
import { createStore } from "../storage/index.js";
import { listDisplaySources } from "../display/prewarm.js";

import { LayerTilesBuilder, TILE_DEFAULTS, writeSpooledPmtiles, type SourceFeature, type SpooledLayer } from "./build.js";
import { FileSpool } from "./spool.js";
import { citySlugFromCollection, profileForCollection } from "./profiles.js";

export interface TilesCliArgs {
  collection: string;
  api?: string;
  store?: string;
  sourceKey?: string;
  file?: string;
  out?: string;
  minZoom: number;
  maxZoom: number;
  tolerance: number;
  maxZoomTolerance: number;
  buffer: number;
  sharedBorders: boolean;
  borderCheck: boolean;
}

export function parseTilesArgs(argv: readonly string[]): TilesCliArgs {
  const args: Partial<TilesCliArgs> & Pick<TilesCliArgs, "minZoom" | "maxZoom" | "tolerance" | "maxZoomTolerance" | "buffer" | "sharedBorders" | "borderCheck"> = {
    minZoom: TILE_DEFAULTS.minZoom,
    maxZoom: TILE_DEFAULTS.maxZoom,
    tolerance: TILE_DEFAULTS.tolerance,
    maxZoomTolerance: TILE_DEFAULTS.maxZoomTolerance,
    buffer: TILE_DEFAULTS.buffer,
    sharedBorders: TILE_DEFAULTS.sharedBorders,
    borderCheck: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = (): string => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
      return v;
    };
    const num = (): number => {
      const n = Number(value());
      if (!Number.isFinite(n) || n < 0) throw new Error(`${a} must be a non-negative number`);
      return n;
    };
    if (a === "--collection") args.collection = value();
    else if (a === "--api") args.api = value();
    else if (a === "--store") args.store = value();
    else if (a === "--source-key") args.sourceKey = value();
    else if (a === "--file") args.file = value();
    else if (a === "--out") args.out = value();
    else if (a === "--min-zoom") args.minZoom = num();
    else if (a === "--max-zoom") args.maxZoom = num();
    else if (a === "--tolerance") args.tolerance = num();
    else if (a === "--max-zoom-tolerance") args.maxZoomTolerance = num();
    else if (a === "--buffer") args.buffer = num();
    else if (a === "--no-shared-borders") args.sharedBorders = false;
    else if (a === "--border-check") args.borderCheck = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!args.collection) throw new Error("--collection is required");
  const sources = [args.api, args.store, args.file].filter((s) => s !== undefined).length;
  if (sources !== 1) throw new Error("exactly one of --api, --store or --file is required");
  return args as TilesCliArgs;
}

/** The source as a byte stream: never held whole (a > 512 MB source cannot be one string). */
async function openSource(args: TilesCliArgs): Promise<AsyncIterable<Uint8Array>> {
  if (args.file !== undefined) return createReadStream(args.file);
  if (args.api !== undefined) {
    const url = `${args.api.replace(/\/+$/, "")}/collections/${encodeURIComponent(args.collection)}/items?profile=display`;
    // fetch negotiates and inflates gzip/br itself.
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`GET ${url} → ${res.status}`);
    return res.body as unknown as AsyncIterable<Uint8Array>;
  }
  const store = createStore(args.store!);
  let key = args.sourceKey;
  if (key === undefined) {
    const sources = await listDisplaySources(store, { filter: (c) => c === args.collection });
    key = sources[0]?.sourceKey;
    if (key === undefined) throw new Error(`not a served collection: ${args.collection}`);
  }
  const stream = store.getStream ? await store.getStream(key) : undefined;
  if (stream === undefined) throw new Error(`source not found: ${key}`);
  return stream;
}

export async function runTilesCli(argv: readonly string[], out: (line: string) => void = (l) => console.log(l)): Promise<number> {
  let args: TilesCliArgs;
  try {
    args = parseTilesArgs(argv);
  } catch (error) {
    console.error(`tiles-build: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const profile = profileForCollection(args.collection);
  if (!profile) {
    console.error(`tiles-build: no tile profile for ${args.collection}`);
    return 2;
  }
  const tLoad = performance.now();
  const builder = new LayerTilesBuilder(profile, {
    minZoom: args.minZoom,
    maxZoom: args.maxZoom,
    tolerance: args.tolerance,
    maxZoomTolerance: args.maxZoomTolerance,
    buffer: args.buffer,
    sharedBorders: args.sharedBorders,
    borderCheck: args.borderCheck,
    citySlug: citySlugFromCollection(args.collection, profile),
  });
  // Same path as publication: tiles spooled to a temporary file, archive
  // written from the spool; the directory is removed at the end.
  const dir = await mkdtemp(join(process.env["TILES_TMPDIR"] ?? tmpdir(), "geo-tiles-cli-"));
  let built: SpooledLayer;
  let archiveBytes: number;
  let loadMs: number;
  let buildMs: number;
  let compactMB: number;
  try {
    for await (const feature of parseFeatureCollectionStream(await openSource(args))) builder.add(feature as SourceFeature);
    loadMs = Math.round(performance.now() - tLoad);
    compactMB = Math.round(builder.compactBytes / 2 ** 20);
    const t0 = performance.now();
    const spool = new FileSpool(join(dir, "tiles.spool"));
    try {
      built = await builder.buildToSpool(spool);
      const fd = openSync(args.out ?? join(dir, "archive.pmtiles"), "w");
      try {
        archiveBytes = writeSpooledPmtiles(built, spool, (chunk) => {
          let written = 0;
          while (written < chunk.length) written += writeSync(fd, chunk, written, chunk.length - written);
        }, { name: args.collection });
      } finally {
        closeSync(fd);
      }
    } finally {
      spool.close();
    }
    buildMs = Math.round(performance.now() - t0);
  } finally {
    builder.release();
    await rm(dir, { recursive: true, force: true });
  }
  const report = {
    collection: args.collection,
    layer: built.layer,
    features: built.features,
    skippedNonPolygon: built.skippedNonPolygon,
    options: { minZoom: args.minZoom, maxZoom: args.maxZoom, tolerance: args.tolerance, maxZoomTolerance: args.maxZoomTolerance, buffer: args.buffer, sharedBorders: args.sharedBorders },
    loadMs,
    buildMs,
    compactMB,
    peakRssMB: Math.round(process.resourceUsage().maxRSS / 1024),
    archiveBytes,
    tiles: built.tileCount,
    fields: built.fields,
    ids: built.ids,
    zooms: built.zooms,
  };
  out(JSON.stringify(report));
  return built.zooms.some((z) => z.missing > 0) ? 1 : 0;
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  runTilesCli(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error("tiles-build: fatal", error);
      process.exit(1);
    },
  );
}
