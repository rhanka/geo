/**
 * Vector-tile build CLI (T0 prototype, SPEC_VECTOR_TILES.md). Read-only on its
 * sources; writes one PMTiles archive to a LOCAL path (`--out`) or nothing.
 * Serving and publication-time builds are T1/T2.
 *
 *   node packages/geo/dist/tiles/build-cli.js --collection qc-lots-rawdon \
 *        (--api https://api.geo.sent-tech.ca | --store s3://<bucket>/normalized [--source-key k] | --file x.geojson) \
 *        [--out rawdon-lots.pmtiles] [--min-zoom 12] [--max-zoom 16] [--tolerance 1] \
 *        [--max-zoom-tolerance 0] [--buffer 64] [--no-shared-borders] [--border-check]
 *
 * `--api` reads `?profile=display` (one request; geometry rounded to 6
 * decimals, ≈ 5 cm, by the display mirror). `--store` reads the exact served
 * source. Prints one JSON report: build time, peak RSS, archive size, and per
 * zoom tile count, max tile size and the no-drop / border checks.
 */

import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { createStore } from "../storage/index.js";
import { listDisplaySources } from "../display/prewarm.js";

import { buildLayerTiles, layerTilesToPmtiles, type SourceFeature } from "./build.js";
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
    minZoom: 12,
    maxZoom: 16,
    tolerance: 1,
    maxZoomTolerance: 0,
    buffer: 64,
    sharedBorders: true,
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

async function loadFeatures(args: TilesCliArgs): Promise<SourceFeature[]> {
  let text: string;
  if (args.file !== undefined) {
    text = await readFile(args.file, "utf8");
  } else if (args.api !== undefined) {
    const url = `${args.api.replace(/\/+$/, "")}/collections/${encodeURIComponent(args.collection)}/items?profile=display`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
    text = await res.text();
  } else {
    const store = createStore(args.store!);
    let key = args.sourceKey;
    if (key === undefined) {
      const sources = await listDisplaySources(store, { filter: (c) => c === args.collection });
      key = sources[0]?.sourceKey;
      if (key === undefined) throw new Error(`not a served collection: ${args.collection}`);
    }
    const bytes = await store.get(key);
    if (bytes === undefined) throw new Error(`source not found: ${key}`);
    text = new TextDecoder().decode(bytes);
  }
  const fc = JSON.parse(text) as { features?: SourceFeature[] };
  if (!Array.isArray(fc.features)) throw new Error("source is not a FeatureCollection");
  return fc.features;
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
  const features = await loadFeatures(args);
  const loadMs = Math.round(performance.now() - tLoad);
  const t0 = performance.now();
  const built = buildLayerTiles(features, profile, {
    minZoom: args.minZoom,
    maxZoom: args.maxZoom,
    tolerance: args.tolerance,
    maxZoomTolerance: args.maxZoomTolerance,
    buffer: args.buffer,
    sharedBorders: args.sharedBorders,
    borderCheck: args.borderCheck,
    citySlug: citySlugFromCollection(args.collection, profile),
  });
  const archive = layerTilesToPmtiles(built, { name: args.collection });
  const buildMs = Math.round(performance.now() - t0);
  if (args.out !== undefined) await writeFile(args.out, archive);
  const report = {
    collection: args.collection,
    layer: built.layer,
    features: built.features,
    skippedNonPolygon: built.skippedNonPolygon,
    options: { minZoom: args.minZoom, maxZoom: args.maxZoom, tolerance: args.tolerance, maxZoomTolerance: args.maxZoomTolerance, buffer: args.buffer, sharedBorders: args.sharedBorders },
    loadMs,
    buildMs,
    peakRssMB: Math.round(process.resourceUsage().maxRSS / 1024),
    archiveBytes: archive.length,
    tiles: built.tiles.length,
    fields: built.fields,
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
