/**
 * `geo fetch <sourceId> [datasetId]` — acquire one or all datasets of a source
 * and persist them under `data/normalized`. The license gate runs inside
 * `acquire`; a non-redistributable source makes `acquire` throw a `LicenseError`
 * which the CLI surfaces as a non-zero exit.
 *
 * `acquire`/`writeNormalized` are injectable so the command is fully testable
 * without network or real disk writes.
 */

import {
  acquire as defaultAcquire,
  writeNormalized as defaultWriteNormalized,
  type AcquireOptions,
  type CommandRunner,
} from "@sentropic/geo-acquire";
import type {
  AdminFeatureCollection,
  NormalizedDataset,
  ReferentialFeatureCollection,
} from "@sentropic/geo-core";

import { defaultRegistry, getSource, type RegisteredSource } from "../registry.js";
import { resolveDataDir } from "../paths.js";

export interface FetchDeps {
  registry?: Map<string, RegisteredSource>;
  acquire?: typeof defaultAcquire;
  writeNormalized?: typeof defaultWriteNormalized;
  /** Injected fetch implementation forwarded to `acquire` (tests pass a stub). */
  fetchImpl?: typeof fetch;
  /**
   * Override the acquisition cache directory forwarded to `acquire`. Tests MUST
   * pass an isolated temp dir so a real download never writes the default
   * `.cache/geo` and poisons subsequent fetches (ADR-0007).
   */
  cacheDir?: string;
  /** Injected GDAL command runner forwarded to `acquire` for bulk formats (tests). */
  gdalRunner?: CommandRunner;
  /** Override the current working directory used to resolve the out dir. */
  cwd?: string;
}

export interface FetchOptions {
  /** Output dir for normalized data; resolved relative to cwd. Default `./data/normalized`. */
  out?: string;
  /** Re-fetch over the network, bypassing the cache. */
  force?: boolean;
}

export interface FetchedDataset {
  sourceId: string;
  datasetId: string;
  count: number;
  license: string;
  attribution: string;
  geojsonPath: string;
  metaPath: string;
}

export interface FetchResult {
  outDir: string;
  datasets: FetchedDataset[];
}

/**
 * Acquire `datasetId` (or every dataset when omitted) from `sourceId`, writing
 * normalized output under the resolved data dir. Throws on unknown source or
 * dataset, or `LicenseError` when the source is not redistributable.
 */
export async function fetchSource(
  sourceId: string,
  datasetId: string | undefined,
  options: FetchOptions = {},
  deps: FetchDeps = {},
): Promise<FetchResult> {
  const registry = deps.registry ?? defaultRegistry();
  const acquire = deps.acquire ?? defaultAcquire;
  const writeNormalized = deps.writeNormalized ?? defaultWriteNormalized;

  const source = getSource(registry, sourceId);

  const datasetIds = datasetId
    ? [datasetId]
    : source.manifest.datasets.map((d) => d.id);

  if (datasetId && !source.manifest.datasets.some((d) => d.id === datasetId)) {
    const known = source.manifest.datasets.map((d) => d.id).join(", ") || "none";
    throw new Error(
      `unknown dataset "${datasetId}" for source "${sourceId}" (available: ${known})`,
    );
  }

  const outDir = resolveDataDir(options.out, deps.cwd);

  const datasets: FetchedDataset[] = [];
  for (const id of datasetIds) {
    const acquireOpts: AcquireOptions = {};
    const normalizer = source.normalizers[id];
    if (normalizer) acquireOpts.normalizer = normalizer;
    if (options.force !== undefined) acquireOpts.force = options.force;
    if (deps.fetchImpl !== undefined) acquireOpts.fetchImpl = deps.fetchImpl;
    if (deps.cacheDir !== undefined) acquireOpts.cacheDir = deps.cacheDir;
    if (deps.gdalRunner !== undefined) acquireOpts.gdalRunner = deps.gdalRunner;

    const normalized: NormalizedDataset<
      AdminFeatureCollection | ReferentialFeatureCollection
    > = await acquire(source.manifest, id, acquireOpts);
    const { geojsonPath, metaPath } = await writeNormalized(normalized, outDir);

    datasets.push({
      sourceId: source.manifest.id,
      datasetId: normalized.meta.datasetId,
      count: normalized.meta.count,
      license: normalized.meta.license.id,
      attribution: normalized.meta.attribution,
      geojsonPath,
      metaPath,
    });
  }

  return { outDir, datasets };
}

/** Render a fetch result as human-readable lines. */
export function formatFetchResult(result: FetchResult): string {
  const lines: string[] = [`Wrote ${result.datasets.length} dataset(s) to ${result.outDir}:`];
  for (const d of result.datasets) {
    lines.push(
      `  ${d.sourceId}#${d.datasetId} — ${d.count} features [${d.license}]`,
      `    attribution: ${d.attribution}`,
      `    ${d.geojsonPath}`,
      `    ${d.metaPath}`,
    );
  }
  return lines.join("\n");
}
