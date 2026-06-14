/**
 * HTTP download with a content-addressed on-disk cache and SHA-256 checksums.
 *
 * The cache key is `sha256(url)`, so repeated acquisitions of the same URL are
 * served from disk. A `fetchImpl` can be injected to keep tests fully hermetic
 * (no network). The body is always hashed so callers can pin/verify checksums.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Default cache directory, relative to the current working directory. */
export const DEFAULT_CACHE_DIR = ".cache/geo";

export interface DownloadOptions {
  /** Directory holding the content-addressed cache. Default {@link DEFAULT_CACHE_DIR}. */
  cacheDir?: string;
  /** Bypass the cache and re-fetch over the network, refreshing the entry. */
  force?: boolean;
  /** Injected fetch implementation; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Extra request headers. */
  headers?: Record<string, string>;
}

export interface DownloadResult {
  /** The URL that was downloaded. */
  url: string;
  /** Raw response body. */
  body: ArrayBuffer;
  /** Decode the body as UTF-8 text. */
  text(): string;
  /** SHA-256 of {@link body}, hex-encoded. */
  sha256: string;
  /** True when the body was served from the on-disk cache. */
  fromCache: boolean;
  /** Absolute-or-relative path of the cache entry on disk. */
  cachePath: string;
}

/** SHA-256 of a string, hex-encoded. Used for cache keys and the like. */
export function sha256Hex(input: string | ArrayBuffer | Uint8Array): string {
  const hash = createHash("sha256");
  if (typeof input === "string") {
    hash.update(input, "utf8");
  } else {
    hash.update(input instanceof Uint8Array ? input : new Uint8Array(input));
  }
  return hash.digest("hex");
}

function buildResult(
  url: string,
  body: ArrayBuffer,
  cachePath: string,
  fromCache: boolean,
): DownloadResult {
  return {
    url,
    body,
    text: () => new TextDecoder().decode(body),
    sha256: sha256Hex(body),
    fromCache,
    cachePath,
  };
}

async function readCache(cachePath: string): Promise<ArrayBuffer | null> {
  try {
    const buffer = await readFile(cachePath);
    // Return a tight ArrayBuffer slice (Buffer may share a larger pool).
    return buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    );
  } catch {
    return null;
  }
}

/**
 * Download `url`, caching the body by `sha256(url)` under `cacheDir`.
 *
 * On a cache hit (and unless `force`), the body is read from disk and
 * `fromCache` is `true`; otherwise it is fetched, persisted, and `fromCache`
 * is `false`. The body's SHA-256 is always computed.
 */
export async function download(
  url: string,
  opts: DownloadOptions = {},
): Promise<DownloadResult> {
  const cacheDir = opts.cacheDir ?? DEFAULT_CACHE_DIR;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const cachePath = join(cacheDir, sha256Hex(url));

  if (!opts.force) {
    const cached = await readCache(cachePath);
    if (cached !== null) {
      return buildResult(url, cached, cachePath, true);
    }
  }

  const requestInit = opts.headers ? { headers: opts.headers } : undefined;
  const response = await fetchImpl(url, requestInit);
  if (!response.ok) {
    throw new Error(`download failed: ${response.status} ${response.statusText} for ${url}`);
  }
  const body = await response.arrayBuffer();

  await mkdir(cacheDir, { recursive: true });
  await writeFile(cachePath, new Uint8Array(body));

  return buildResult(url, body, cachePath, false);
}
