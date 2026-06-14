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
  writeNormalizedToStore as defaultWriteNormalizedToStore,
  type AcquireOptions,
  type CommandRunner,
} from "@sentropic/geo-acquire";
import type {
  AdminFeatureCollection,
  NormalizedDataset,
  ReferentialFeatureCollection,
} from "@sentropic/geo-core";
import {
  createStore as defaultCreateStore,
  parseStoreUri,
  type Store,
} from "@sentropic/geo-storage";

import { defaultRegistry, getSource, type RegisteredSource } from "../registry.js";
import { resolveDataDir } from "../paths.js";

export interface FetchDeps {
  registry?: Map<string, RegisteredSource>;
  acquire?: typeof defaultAcquire;
  writeNormalized?: typeof defaultWriteNormalized;
  /** Persist a normalized dataset to a {@link Store} (ADR-0012 object storage path). */
  writeNormalizedToStore?: typeof defaultWriteNormalizedToStore;
  /** Build a {@link Store} from a URI; overridable so tests skip real S3/network. */
  createStore?: typeof defaultCreateStore;
  /** Inject a {@link Store} directly, bypassing `createStore` (hermetic tests). */
  store?: Store;
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
  const writeNormalizedToStore = deps.writeNormalizedToStore ?? defaultWriteNormalizedToStore;
  const createStore = deps.createStore ?? defaultCreateStore;

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

  // Resolve the write target. A store URI (`s3://…`, `fs:…`) — or an injected
  // `store` — routes through the {@link Store} write path (ADR-0012). A bare
  // `--out` path keeps the legacy local-fs behavior (`writeNormalized`).
  const target = resolveTarget(options.out, deps, createStore);

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

    let geojsonPath: string;
    let metaPath: string;
    if (target.kind === "store") {
      const prefixArg = target.prefix;
      const keys =
        prefixArg !== undefined
          ? await writeNormalizedToStore(normalized, target.store, prefixArg)
          : await writeNormalizedToStore(normalized, target.store);
      geojsonPath = keys.geojsonKey;
      metaPath = keys.metaKey;
    } else {
      const paths = await writeNormalized(normalized, target.outDir);
      geojsonPath = paths.geojsonPath;
      metaPath = paths.metaPath;
    }

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

  return { outDir: target.label, datasets };
}

/** Where `fetchSource` writes: a local fs dir, or a {@link Store} (+ prefix). */
type WriteTarget =
  | { kind: "fs"; outDir: string; label: string }
  | { kind: "store"; store: Store; prefix?: string; label: string };

/**
 * Decide the write target from `--out` + deps. An injected `deps.store` always
 * wins. Otherwise an `s3://…`/`fs:…` URI builds a {@link Store}; a bare path
 * (or no `--out`) resolves to a local fs directory (existing behavior).
 */
function resolveTarget(
  out: string | undefined,
  deps: FetchDeps,
  createStore: typeof defaultCreateStore,
): WriteTarget {
  if (deps.store !== undefined) {
    const target: WriteTarget = { kind: "store", store: deps.store, label: out ?? "(store)" };
    return target;
  }

  if (out !== undefined && (out.startsWith("s3://") || out.startsWith("fs:"))) {
    const parsed = parseStoreUri(out);
    const store = createStore(out);
    const target: WriteTarget = { kind: "store", store, label: out };
    if (parsed.kind === "s3" && parsed.prefix !== undefined) target.prefix = parsed.prefix;
    return target;
  }

  const outDir = resolveDataDir(out, deps.cwd);
  return { kind: "fs", outDir, label: outDir };
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
