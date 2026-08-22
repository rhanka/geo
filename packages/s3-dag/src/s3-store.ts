/**
 * S3-backed {@link DagStore} — the production adapter behind the pure engine.
 * Immutable objects use unconditional PUT; the one mutable pointer per run uses
 * conditional PUT (`If-Match` / `If-None-Match`) for compare-and-set.
 *
 * OVH Object Storage caveat (learned the hard way, geo #236): the AWS SDK v3
 * default flexible-checksum adds an `aws-chunked` content-encoding OVH rejects
 * (InvalidChunkSizeError) — which would make a CAS write fail for the WRONG
 * reason. We therefore force checksum calculation/validation to WHEN_REQUIRED so
 * `If-Match`/412/read-after-write is proven on its own merits.
 */

import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

import type { DagStore } from "./ports.js";

export interface S3DagStoreConfig {
  bucket: string;
  /** Key prefix under which all run state lives (e.g. `preprod-runs`). */
  prefix?: string;
  endpoint?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** Inject a pre-built client (tests / custom credentials chains). */
  client?: S3Client;
}

/** OVH/Scaleway-safe client options — never let aws-chunked mask a CAS result. */
function buildClient(cfg: S3DagStoreConfig): S3Client {
  if (cfg.client) return cfg.client;
  const opts: {
    endpoint?: string;
    region?: string;
    forcePathStyle: boolean;
    credentials?: { accessKeyId: string; secretAccessKey: string };
    requestChecksumCalculation: "WHEN_REQUIRED";
    responseChecksumValidation: "WHEN_REQUIRED";
  } = {
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  };
  if (cfg.endpoint !== undefined) opts.endpoint = cfg.endpoint;
  if (cfg.region !== undefined) opts.region = cfg.region;
  if (cfg.accessKeyId !== undefined && cfg.secretAccessKey !== undefined) {
    opts.credentials = { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey };
  }
  return new S3Client(opts);
}

function isPreconditionFailed(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: unknown; Code?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return (
    e.name === "PreconditionFailed" ||
    e.Code === "PreconditionFailed" ||
    e.$metadata?.httpStatusCode === 412
  );
}

function isNotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: unknown; Code?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return e.name === "NoSuchKey" || e.name === "NotFound" || e.$metadata?.httpStatusCode === 404;
}

async function bodyToString(body: unknown): Promise<string> {
  if (body && typeof (body as { transformToString?: unknown }).transformToString === "function") {
    return (body as { transformToString(): Promise<string> }).transformToString();
  }
  const chunks: Uint8Array[] = [];
  for await (const c of body as AsyncIterable<Uint8Array>) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

export class S3DagStore implements DagStore {
  readonly #client: S3Client;
  readonly #bucket: string;
  readonly #prefix: string;

  constructor(cfg: S3DagStoreConfig) {
    this.#client = buildClient(cfg);
    this.#bucket = cfg.bucket;
    this.#prefix = (cfg.prefix ?? "").replace(/^\/+|\/+$/g, "");
  }

  #key(key: string): string {
    return this.#prefix ? `${this.#prefix}/${key}` : key;
  }

  async get(key: string): Promise<{ body: string; etag: string } | undefined> {
    try {
      const out = await this.#client.send(new GetObjectCommand({ Bucket: this.#bucket, Key: this.#key(key) }));
      if (out.Body === undefined || out.ETag === undefined) return undefined;
      return { body: await bodyToString(out.Body), etag: out.ETag };
    } catch (err) {
      if (isNotFound(err)) return undefined;
      throw err;
    }
  }

  async put(key: string, body: string): Promise<{ etag: string }> {
    const out = await this.#client.send(
      new PutObjectCommand({ Bucket: this.#bucket, Key: this.#key(key), Body: body, ContentType: "application/json" }),
    );
    return { etag: out.ETag ?? "" };
  }

  async putIfMatch(
    key: string,
    body: string,
    etag: string | null,
  ): Promise<{ ok: true; etag: string } | { ok: false }> {
    const input: {
      Bucket: string;
      Key: string;
      Body: string;
      ContentType: string;
      IfMatch?: string;
      IfNoneMatch?: string;
    } = { Bucket: this.#bucket, Key: this.#key(key), Body: body, ContentType: "application/json" };
    if (etag === null) input.IfNoneMatch = "*"; // create-only
    else input.IfMatch = etag; // advance-only-if-unchanged
    try {
      const out = await this.#client.send(new PutObjectCommand(input));
      return { ok: true, etag: out.ETag ?? "" };
    } catch (err) {
      if (isPreconditionFailed(err)) return { ok: false }; // the CAS lost — no throw
      throw err;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const full = this.#key(prefix);
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const input: { Bucket: string; Prefix?: string; ContinuationToken?: string } = { Bucket: this.#bucket };
      if (full.length > 0) input.Prefix = full;
      if (token !== undefined) input.ContinuationToken = token;
      const out = await this.#client.send(new ListObjectsV2Command(input));
      for (const o of out.Contents ?? []) {
        if (typeof o.Key === "string") {
          keys.push(this.#prefix && o.Key.startsWith(`${this.#prefix}/`) ? o.Key.slice(this.#prefix.length + 1) : o.Key);
        }
      }
      token = out.IsTruncated === true ? out.NextContinuationToken : undefined;
    } while (token !== undefined);
    keys.sort();
    return keys;
  }

  /** HEAD probe — used by a live CAS smoke test (read-after-write on OVH). */
  async head(key: string): Promise<{ etag: string } | undefined> {
    try {
      const out = await this.#client.send(new HeadObjectCommand({ Bucket: this.#bucket, Key: this.#key(key) }));
      return out.ETag === undefined ? undefined : { etag: out.ETag };
    } catch (err) {
      if (isNotFound(err)) return undefined;
      throw err;
    }
  }
}
