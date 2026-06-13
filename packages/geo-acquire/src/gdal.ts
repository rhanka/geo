/**
 * GDAL-backed acquisition for bulk vector formats (`gpkg` / `shp` / `fgdb`).
 *
 * The ArcGIS REST `query` path is impractical for large layers (paging,
 * timeouts, server limits), so bulk sources publish a single archive (often a
 * GeoPackage inside a `.zip`). This module shells out to GDAL's `ogrinfo` /
 * `ogr2ogr` (no extra npm dependency) to:
 *
 *   1. discover the inner dataset + layers inside the (cached) archive via
 *      GDAL's `/vsizip/` virtual filesystem, then
 *   2. reproject the requested layer to WGS84 GeoJSON (RFC 7946) with
 *      Douglas–Peucker simplification, emitted to a temp file.
 *
 * The caller ({@link acquire}) parses that GeoJSON, runs the dataset's
 * {@link Normalizer}, and assembles provenance — identical plumbing to the
 * `arcgis-rest` path. The temp GeoJSON is always cleaned up.
 *
 * GDAL's `/vsizip/` detects archives by a `.zip` suffix on the path, but the
 * content-addressed cache stores the body under a sha256 filename with no
 * extension. We therefore expose the cache entry to GDAL through a temporary
 * `.zip` symlink (the raw 105 MB body is never copied).
 */

import { execFile } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Default Douglas–Peucker tolerance (in source-SRS units) when unspecified. */
export const DEFAULT_SIMPLIFY_TOLERANCE = 0.0008;

/** Bulk vector formats handled via GDAL rather than an HTTP `query` endpoint. */
export type GdalFormat = "gpkg" | "shp" | "fgdb";

/** A runnable external command: argv[0] is the program, the rest are args. */
export interface CommandResult {
  stdout: string;
  stderr: string;
}

/**
 * Injectable command runner. Defaults to {@link execFile} (no shell — args are
 * passed as an array, so there is no shell-injection surface). Tests inject a
 * fake to stay hermetic and to exercise the ENOENT branch.
 */
export type CommandRunner = (
  file: string,
  args: readonly string[],
) => Promise<CommandResult>;

const defaultRunner: CommandRunner = async (file, args) => {
  // 256 MB buffer: a reprojected provincial layer's GeoJSON is tens of MB and
  // ogr2ogr writes to a file, but stdout from ogrinfo stays tiny.
  const { stdout, stderr } = await execFileAsync(file, [...args], {
    maxBuffer: 256 * 1024 * 1024,
  });
  return { stdout, stderr };
};

/** Re-thrown with actionable guidance when the GDAL binary is missing. */
function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function gdalMissingError(binary: string, cause: unknown): Error {
  return new Error(
    `GDAL/${binary} required for bulk formats (apt-get install gdal-bin). ` +
      `Could not execute "${binary}".`,
    { cause },
  );
}

/**
 * Build the `/vsizip/` virtual path for a file inside a zip archive. When
 * `inner` is omitted, the path refers to the archive root (GDAL will open the
 * sole dataset it contains).
 */
export function vsizipPath(zipPath: string, inner?: string): string {
  return inner ? `/vsizip/${zipPath}/${inner}` : `/vsizip/${zipPath}`;
}

/** Default emitted-coordinate precision (decimal places). 6 ≈ 0.1 m at this latitude. */
export const DEFAULT_COORDINATE_PRECISION = 6;

/**
 * Build the `ogr2ogr` argument vector that reprojects `layer` from `source`
 * (a real path or a `/vsizip/...` virtual path) to WGS84 GeoJSON at `outPath`,
 * applying Douglas–Peucker simplification with `tolerance` (in source-SRS
 * units). `-lco RFC7946=YES` yields lon/lat 2D coordinates and right-hand-rule
 * winding; `-lco COORDINATE_PRECISION` trims coordinate noise to keep the
 * emitted file lean; `-skipfailures` is intentionally NOT set so geometry
 * errors surface.
 */
export function buildOgr2OgrArgs(opts: {
  source: string;
  layer: string;
  outPath: string;
  tolerance: number;
  coordinatePrecision?: number;
}): string[] {
  const precision = opts.coordinatePrecision ?? DEFAULT_COORDINATE_PRECISION;
  return [
    "-f",
    "GeoJSON",
    "-t_srs",
    "EPSG:4326",
    "-simplify",
    String(opts.tolerance),
    "-lco",
    "RFC7946=YES",
    "-lco",
    `COORDINATE_PRECISION=${precision}`,
    opts.outPath,
    opts.source,
    opts.layer,
  ];
}

/** A layer discovered inside a bulk dataset via `ogrinfo`. */
export interface DiscoveredLayer {
  name: string;
  geometryType?: string;
}

/**
 * Parse `ogrinfo -ro -so <source>` summary output into a list of layers.
 * Lines look like `1: regio_s (3D Multi Polygon)` or `1: regio_s`.
 */
export function parseOgrinfoLayers(stdout: string): DiscoveredLayer[] {
  const layers: DiscoveredLayer[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/^\s*\d+:\s+(\S+)(?:\s+\(([^)]*)\))?\s*$/);
    if (match?.[1]) {
      const layer: DiscoveredLayer = { name: match[1] };
      if (match[2]) layer.geometryType = match[2];
      layers.push(layer);
    }
  }
  return layers;
}

/**
 * List the layers in a bulk dataset (e.g. a GeoPackage) via `ogrinfo`.
 *
 * @throws Error (with stderr) on a non-zero exit; a clear "GDAL required"
 *   error when the `ogrinfo` binary is absent.
 */
export async function listLayers(
  source: string,
  runner: CommandRunner = defaultRunner,
): Promise<DiscoveredLayer[]> {
  let result: CommandResult;
  try {
    result = await runner("ogrinfo", ["-ro", "-so", source]);
  } catch (error) {
    if (isEnoent(error)) throw gdalMissingError("ogrinfo", error);
    const stderr = (error as { stderr?: string }).stderr ?? "";
    throw new Error(
      `ogrinfo failed for "${source}": ${stderr || (error as Error).message}`,
      { cause: error },
    );
  }
  return parseOgrinfoLayers(result.stdout);
}

/**
 * Reproject `layer` from `source` to WGS84 GeoJSON at `outPath` via `ogr2ogr`.
 *
 * @throws Error (with stderr) on a non-zero exit; a clear "GDAL required"
 *   error when the `ogr2ogr` binary is absent.
 */
export async function runOgr2Ogr(
  opts: { source: string; layer: string; outPath: string; tolerance: number },
  runner: CommandRunner = defaultRunner,
): Promise<void> {
  const args = buildOgr2OgrArgs(opts);
  try {
    await runner("ogr2ogr", args);
  } catch (error) {
    if (isEnoent(error)) throw gdalMissingError("ogr2ogr", error);
    const stderr = (error as { stderr?: string }).stderr ?? "";
    throw new Error(
      `ogr2ogr failed for layer "${opts.layer}" of "${opts.source}": ` +
        `${stderr || (error as Error).message}`,
      { cause: error },
    );
  }
}

/** Result of extracting a layer: the parsed GeoJSON and the discovered layers. */
export interface ExtractResult {
  /** Parsed WGS84 GeoJSON FeatureCollection (as `unknown`, to be normalized). */
  geojson: unknown;
  /** Layers discovered in the archive (for diagnostics). */
  layers: DiscoveredLayer[];
}

/** Options for {@link extractLayerToGeoJson}. */
export interface ExtractOptions {
  /** Path to the (cached) archive on disk. Expected to be a `.zip`. */
  archivePath: string;
  /** Layer name to extract (e.g. `"regio_s"`). */
  layer: string;
  /** Douglas–Peucker tolerance in source-SRS units. */
  tolerance: number;
  /**
   * Inner dataset path within the zip (e.g. `"SDA.gpkg"`). When omitted, the
   * archive root is opened and GDAL picks the sole contained dataset.
   */
  inner?: string;
  /** Injected command runner (tests). */
  runner?: CommandRunner;
  /** Injected JSON reader for the emitted file (tests); defaults to reading `outPath`. */
  readJson?: (outPath: string) => Promise<unknown>;
}

/**
 * Extract one layer from a zipped bulk dataset to WGS84 GeoJSON and parse it.
 *
 * Exposes the cache entry to GDAL via a temporary `.zip` symlink (so the
 * `/vsizip/` driver recognizes it regardless of the cache's extension-less
 * filename), runs `ogrinfo` (discovery) + `ogr2ogr` (reprojection), parses the
 * emitted GeoJSON, and cleans up the temp directory. The raw archive body is
 * never copied.
 */
export async function extractLayerToGeoJson(
  opts: ExtractOptions,
): Promise<ExtractResult> {
  const runner = opts.runner ?? defaultRunner;
  const work = await mkdtemp(join(tmpdir(), "geo-gdal-"));
  try {
    // GDAL's /vsizip/ sniffs a `.zip` suffix; the cache filename has none, so
    // expose it through a `.zip` symlink (no copy of the 105 MB body). The
    // symlink target must be absolute (the link lives in a temp dir, while the
    // cache path is often relative to the caller's cwd).
    const zipLink = join(work, "archive.zip");
    await symlink(resolve(opts.archivePath), zipLink);

    const source = vsizipPath(zipLink, opts.inner);
    const layers = await listLayers(source, runner);

    const outPath = join(work, "out.geojson");
    await runOgr2Ogr(
      { source, layer: opts.layer, outPath, tolerance: opts.tolerance },
      runner,
    );

    const readJson =
      opts.readJson ??
      (async (p: string): Promise<unknown> => {
        const { readFile } = await import("node:fs/promises");
        return JSON.parse(await readFile(p, "utf8")) as unknown;
      });
    const geojson = await readJson(outPath);

    return { geojson, layers };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
