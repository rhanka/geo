/**
 * {@link S3Store} — a {@link Store} backed by S3-compatible object storage
 * (Scaleway Object Storage by default, per ADR-0012). Keys are placed under an
 * optional `prefix`. An {@link S3Client} may be injected so tests stay hermetic
 * (mock `client.send`); otherwise one is built from the supplied connection
 * settings.
 */

import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { ovhSafeS3ClientOptions } from "./s3-client-config.js";
import type { ByteStream, PutOptions, Store } from "./store.js";

/** Connection + addressing settings for an {@link S3Store}. */
export interface S3StoreConfig {
  /** Target bucket. */
  bucket: string;
  /** Key prefix prepended to every store key (e.g. `normalized`). */
  prefix?: string;
  /** Pre-built client; when present, the connection fields are ignored. */
  client?: S3Client;
  /** Endpoint URL (Scaleway, e.g. `https://s3.fr-par.scw.cloud`). */
  endpoint?: string;
  /** Region (Scaleway, e.g. `fr-par`). */
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** Use path-style addressing. Defaults to `false` (virtual-hosted). */
  forcePathStyle?: boolean;
}

/** A {@link Store} backed by S3-compatible object storage. */
export class S3Store implements Store {
  readonly bucket: string;
  readonly prefix: string;
  private readonly client: S3Client;

  constructor(config: S3StoreConfig) {
    this.bucket = config.bucket;
    this.prefix = normalizePrefix(config.prefix);
    this.client = config.client ?? buildClient(config);
  }

  /** Map a store key to the full S3 object key (prefix-joined). */
  private objectKey(key: string): string {
    return this.prefix.length > 0 ? `${this.prefix}/${key}` : key;
  }

  async put(key: string, body: Uint8Array | string, opts?: PutOptions): Promise<void> {
    const input: {
      Bucket: string;
      Key: string;
      Body: Uint8Array | string;
      ContentType?: string;
    } = {
      Bucket: this.bucket,
      Key: this.objectKey(key),
      Body: body,
    };
    if (opts?.contentType !== undefined) input.ContentType = opts.contentType;
    await this.client.send(new PutObjectCommand(input));
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    try {
      const out = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }),
      );
      if (out.Body === undefined) return undefined;
      return await bodyToBytes(out.Body);
    } catch (err) {
      if (isNotFound(err)) return undefined;
      throw err;
    }
  }

  /**
   * Open an object as an SDK byte stream. Unlike {@link get}, this never
   * concatenates the body, which is required by geo-api for large GeoJSON.
   */
  async getStream(key: string): Promise<ByteStream | undefined> {
    try {
      const out = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }),
      );
      if (out.Body === undefined) return undefined;
      return bodyToStream(out.Body);
    } catch (err) {
      if (isNotFound(err)) return undefined;
      throw err;
    }
  }

  async has(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }),
      );
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }

  async list(prefix?: string): Promise<string[]> {
    const fullPrefix = this.objectKey(prefix ?? "");
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const input: { Bucket: string; Prefix?: string; ContinuationToken?: string } = {
        Bucket: this.bucket,
      };
      if (fullPrefix.length > 0) input.Prefix = fullPrefix;
      if (token !== undefined) input.ContinuationToken = token;
      const out = await this.client.send(new ListObjectsV2Command(input));
      for (const obj of out.Contents ?? []) {
        if (typeof obj.Key === "string") keys.push(this.stripPrefix(obj.Key));
      }
      token = out.IsTruncated === true ? out.NextContinuationToken : undefined;
    } while (token !== undefined);
    keys.sort();
    return keys;
  }

  async delete(key: string): Promise<void> {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }),
    );
  }

  /** Remove the store prefix from a full object key to recover the store key. */
  private stripPrefix(objectKey: string): string {
    if (this.prefix.length === 0) return objectKey;
    const lead = `${this.prefix}/`;
    return objectKey.startsWith(lead) ? objectKey.slice(lead.length) : objectKey;
  }
}

/** Build an {@link S3Client} from connection settings (Scaleway-friendly). */
function buildClient(config: S3StoreConfig): S3Client {
  const opts: {
    endpoint?: string;
    region?: string;
    forcePathStyle: boolean;
    credentials?: { accessKeyId: string; secretAccessKey: string };
  } = {
    forcePathStyle: config.forcePathStyle ?? false,
  };
  if (config.endpoint !== undefined) opts.endpoint = config.endpoint;
  if (config.region !== undefined) opts.region = config.region;
  if (config.accessKeyId !== undefined && config.secretAccessKey !== undefined) {
    opts.credentials = {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    };
  }
  // OVH/Scaleway rejettent l'aws-chunked que le SDK v3 active par défaut →
  // options sûres partagées (write-safe). Cf. s3-client-config.ts.
  return new S3Client({ ...opts, ...ovhSafeS3ClientOptions() });
}

/** Trim leading/trailing slashes from a prefix; `undefined` → empty. */
function normalizePrefix(prefix: string | undefined): string {
  if (prefix === undefined) return "";
  return prefix.replace(/^\/+|\/+$/g, "");
}

/** Is this error a "no such key/object" (404 / NotFound / NoSuchKey)? */
function isNotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as {
    name?: unknown;
    Code?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  if (e.name === "NotFound" || e.name === "NoSuchKey") return true;
  if (e.Code === "NoSuchKey") return true;
  return e.$metadata?.httpStatusCode === 404;
}

/**
 * Coerce an S3 `GetObject` body — a web `ReadableStream`, a Node stream, a
 * byte array, or a value exposing `transformToByteArray` (the AWS SDK's
 * `SdkStream` mixin) — into a `Uint8Array`.
 */
async function bodyToBytes(body: unknown): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of bodyToStream(body)) chunks.push(chunk);
  return concat(chunks);
}

/**
 * Coerce the Node SDK body to a stream without retaining its chunks. The
 * `transformToByteArray` fallback is for small test doubles; the production
 * Node SDK body is an async-iterable Readable.
 */
function bodyToStream(body: unknown): ByteStream {
  if (body instanceof Uint8Array) return oneChunk(body);
  if (isAsyncIterable(body)) return asByteStream(body);
  if (hasTransformToByteArray(body)) return transformedBody(body);
  throw new Error("unsupported S3 GetObject Body type");
}

async function* oneChunk(bytes: Uint8Array): ByteStream {
  yield bytes;
}

async function* transformedBody(body: ByteArrayTransformable): ByteStream {
  yield await body.transformToByteArray();
}

async function* asByteStream(body: AsyncIterable<Uint8Array>): ByteStream {
  for await (const chunk of body) {
    yield chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBufferLike);
  }
}

interface ByteArrayTransformable {
  transformToByteArray(): Promise<Uint8Array>;
}

function hasTransformToByteArray(value: unknown): value is ByteArrayTransformable {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { transformToByteArray?: unknown }).transformToByteArray === "function"
  );
}

function isAsyncIterable(value: unknown): value is AsyncIterable<Uint8Array> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function"
  );
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
