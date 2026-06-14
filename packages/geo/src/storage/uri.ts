/**
 * Store URI parsing + factory. A `--out` value (or any storage target) can be:
 *
 * - `s3://<bucket>/<prefix...>`  → an {@link S3Store} on the named bucket/prefix
 * - `fs:<path>` or a bare path   → an {@link FsStore} rooted at the path
 *
 * {@link createStore} builds the matching {@link Store}; for S3 it pulls
 * connection settings from the supplied options or, failing that, the
 * environment (`S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`).
 */

import type { S3Client } from "@aws-sdk/client-s3";

import { FsStore } from "./fs-store.js";
import { S3Store, type S3StoreConfig } from "./s3-store.js";
import type { Store } from "./store.js";

/** A parsed store target. */
export type ParsedStoreUri =
  | { kind: "s3"; bucket: string; prefix?: string }
  | { kind: "fs"; path: string };

/**
 * Parse a store URI into its kind + addressing. `s3://bucket/a/b` →
 * `{kind:'s3', bucket, prefix:'a/b'}`; `fs:./data` and a bare `./data` both →
 * `{kind:'fs', path}`.
 *
 * @throws Error for an `s3://` URI with no bucket.
 */
export function parseStoreUri(uri: string): ParsedStoreUri {
  if (uri.startsWith("s3://")) {
    const rest = uri.slice("s3://".length);
    const slash = rest.indexOf("/");
    const bucket = slash === -1 ? rest : rest.slice(0, slash);
    if (bucket.length === 0) {
      throw new Error(`invalid s3 URI (missing bucket): ${uri}`);
    }
    const prefix = slash === -1 ? "" : rest.slice(slash + 1).replace(/^\/+|\/+$/g, "");
    return prefix.length > 0 ? { kind: "s3", bucket, prefix } : { kind: "s3", bucket };
  }

  if (uri.startsWith("fs:")) {
    return { kind: "fs", path: uri.slice("fs:".length) };
  }

  return { kind: "fs", path: uri };
}

/** Options for {@link createStore}: S3 credentials/connection + client injection. */
export interface CreateStoreOptions {
  /** Pre-built client (S3 only); makes construction hermetic for tests. */
  client?: S3Client;
  endpoint?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
}

/**
 * Build the {@link Store} addressed by `uri`. For S3 targets, connection
 * settings come from `opts` first, then the environment.
 */
export function createStore(uri: string, opts: CreateStoreOptions = {}): Store {
  const parsed = parseStoreUri(uri);
  if (parsed.kind === "fs") {
    return new FsStore(parsed.path);
  }

  const config: S3StoreConfig = { bucket: parsed.bucket };
  if (parsed.prefix !== undefined) config.prefix = parsed.prefix;

  if (opts.client !== undefined) {
    config.client = opts.client;
    return new S3Store(config);
  }

  const endpoint = opts.endpoint ?? process.env["S3_ENDPOINT"];
  const region = opts.region ?? process.env["S3_REGION"];
  const accessKeyId = opts.accessKeyId ?? process.env["S3_ACCESS_KEY"];
  const secretAccessKey = opts.secretAccessKey ?? process.env["S3_SECRET_KEY"];
  if (endpoint !== undefined) config.endpoint = endpoint;
  if (region !== undefined) config.region = region;
  if (accessKeyId !== undefined) config.accessKeyId = accessKeyId;
  if (secretAccessKey !== undefined) config.secretAccessKey = secretAccessKey;
  if (opts.forcePathStyle !== undefined) config.forcePathStyle = opts.forcePathStyle;

  return new S3Store(config);
}
