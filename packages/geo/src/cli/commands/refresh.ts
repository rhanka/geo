/**
 * `geo refresh [--stale]` — replay `acquire` for ledger entries that are due.
 *
 * The ledger lives at `data/requests/<source>__<dataset>.json` (ADR-0004) with
 * `{ requestedBy, requestedAt, manifestRef, lastFetchedAt, checksum,
 * updateCadence, status }`. An entry is "stale" when
 * `now - lastFetchedAt > updateCadence`. `refresh` re-fetches stale entries (or,
 * without `--stale`, every entry) via {@link fetchSource}, then updates the
 * ledger's `lastFetchedAt`/`checksum`/`status`.
 *
 * `manifestRef` is `"<sourceId>#<datasetId>"`.
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import { fetchSource as defaultFetchSource, type FetchDeps, type FetchResult } from "./fetch.js";

export const DEFAULT_REQUESTS_DIR = "data/requests";

/** A freshness ledger entry (ADR-0004). */
export interface LedgerEntry {
  requestedBy?: string;
  requestedAt?: string;
  /** `"<sourceId>#<datasetId>"`. */
  manifestRef: string;
  /** ISO 8601 timestamp of the last successful acquisition. */
  lastFetchedAt?: string;
  checksum?: string;
  /** ISO 8601 duration (e.g. `P1Y`) or free text; non-duration → always due. */
  updateCadence?: string;
  status?: string;
}

export interface RefreshOptions {
  /** Only refresh entries judged stale by their cadence. */
  stale?: boolean;
  /** Requests-ledger directory; resolved relative to cwd. */
  requestsDir?: string;
  /** Output dir for normalized data, forwarded to fetch. */
  out?: string;
  force?: boolean;
  cwd?: string;
  /** Clock injection for deterministic tests. */
  now?: Date;
}

export interface RefreshDeps extends FetchDeps {
  fetchSource?: typeof defaultFetchSource;
}

export interface RefreshedEntry {
  ledgerPath: string;
  manifestRef: string;
  sourceId: string;
  datasetId?: string;
  stale: boolean;
  refreshed: boolean;
  count?: number;
}

export interface RefreshResult {
  requestsDir: string;
  entries: RefreshedEntry[];
}

/** Parse an ISO 8601 duration (date+time, no week form) into milliseconds. */
export function parseIso8601Duration(value: string): number | null {
  const m = value
    .trim()
    .match(/^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m || value.trim() === "P") return null;
  const [, y, mo, d, h, mi, s] = m;
  const n = (x: string | undefined): number => (x ? Number(x) : 0);
  const days = n(y) * 365 + n(mo) * 30 + n(d);
  const seconds = n(h) * 3600 + n(mi) * 60 + n(s);
  return days * 86_400_000 + seconds * 1000;
}

/** Whether a ledger entry is stale relative to `now`. */
export function isStale(entry: LedgerEntry, now: Date): boolean {
  if (!entry.lastFetchedAt) return true; // never fetched → due.
  const last = Date.parse(entry.lastFetchedAt);
  if (Number.isNaN(last)) return true;
  const cadenceMs = entry.updateCadence ? parseIso8601Duration(entry.updateCadence) : null;
  if (cadenceMs === null) return true; // unknown/non-duration cadence → always due.
  return now.getTime() - last > cadenceMs;
}

function splitRef(manifestRef: string): { sourceId: string; datasetId?: string } {
  const hash = manifestRef.indexOf("#");
  if (hash < 0) return { sourceId: manifestRef };
  const sourceId = manifestRef.slice(0, hash);
  const datasetId = manifestRef.slice(hash + 1);
  return datasetId.length > 0 ? { sourceId, datasetId } : { sourceId };
}

function isLedgerEntry(value: unknown): value is LedgerEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { manifestRef?: unknown }).manifestRef === "string"
  );
}

/**
 * Scan the requests ledger and re-`fetch` due entries. Updates each refreshed
 * entry's `lastFetchedAt`/`checksum`/`status` in place on disk.
 */
export async function refresh(
  options: RefreshOptions = {},
  deps: RefreshDeps = {},
): Promise<RefreshResult> {
  const cwd = options.cwd ?? process.cwd();
  const dirOpt = options.requestsDir ?? DEFAULT_REQUESTS_DIR;
  const requestsDir = isAbsolute(dirOpt) ? dirOpt : resolve(cwd, dirOpt);
  const now = options.now ?? new Date();
  const runFetch = deps.fetchSource ?? defaultFetchSource;

  const fetchDeps: FetchDeps = {};
  if (deps.registry !== undefined) fetchDeps.registry = deps.registry;
  if (deps.acquire !== undefined) fetchDeps.acquire = deps.acquire;
  if (deps.writeNormalized !== undefined) fetchDeps.writeNormalized = deps.writeNormalized;
  if (deps.fetchImpl !== undefined) fetchDeps.fetchImpl = deps.fetchImpl;
  if (deps.cwd !== undefined) fetchDeps.cwd = deps.cwd;
  else fetchDeps.cwd = cwd;

  let fileNames: string[];
  try {
    fileNames = (await readdir(requestsDir)).filter((n) => n.endsWith(".json")).sort();
  } catch {
    return { requestsDir, entries: [] };
  }

  const entries: RefreshedEntry[] = [];
  for (const fileName of fileNames) {
    const ledgerPath = join(requestsDir, fileName);
    let entry: LedgerEntry;
    try {
      const raw = JSON.parse(await readFile(ledgerPath, "utf8")) as unknown;
      if (!isLedgerEntry(raw)) continue;
      entry = raw;
    } catch {
      continue;
    }

    const stale = isStale(entry, now);
    const { sourceId, datasetId } = splitRef(entry.manifestRef);
    const result: RefreshedEntry = {
      ledgerPath,
      manifestRef: entry.manifestRef,
      sourceId,
      stale,
      refreshed: false,
    };
    if (datasetId !== undefined) result.datasetId = datasetId;

    const shouldFetch = options.stale ? stale : true;
    if (shouldFetch) {
      const fetchOpts: { out?: string; force?: boolean } = {};
      if (options.out !== undefined) fetchOpts.out = options.out;
      if (options.force !== undefined) fetchOpts.force = options.force;

      const fetched: FetchResult = await runFetch(sourceId, datasetId, fetchOpts, fetchDeps);
      const total = fetched.datasets.reduce((sum, d) => sum + d.count, 0);
      result.refreshed = true;
      result.count = total;

      const updated: LedgerEntry = {
        ...entry,
        lastFetchedAt: now.toISOString(),
        status: "fetched",
      };
      await writeFile(ledgerPath, `${JSON.stringify(updated, null, 2)}\n`);
    }

    entries.push(result);
  }

  return { requestsDir, entries };
}

/** Render a refresh result as human-readable lines. */
export function formatRefreshResult(result: RefreshResult): string {
  if (result.entries.length === 0) {
    return `No ledger entries in ${result.requestsDir}.`;
  }
  const lines = [`Ledger ${result.requestsDir}:`];
  for (const e of result.entries) {
    const state = e.refreshed
      ? `refreshed (${e.count ?? 0} features)`
      : e.stale
        ? "stale (skipped)"
        : "fresh (skipped)";
    lines.push(`  ${e.manifestRef} — ${state}`);
  }
  return lines.join("\n");
}
