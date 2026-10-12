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
import type { ByteStream, GetStreamOptions, PutOptions, Store } from "./store.js";

/** Connection + addressing settings for an {@link S3Store}. */
export interface S3StoreConfig {
  /** Target bucket. */
  bucket: string;
  /** Key prefix prepended to every store key (e.g. `normalized`). */
  prefix?: string;
  /** Pre-built client; when present, the connection fields are ignored. */
  client?: S3Client;
  /** S3-compatible endpoint URL (OVH in production). */
  endpoint?: string;
  /** Region (Scaleway, e.g. `fr-par`). */
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** Use path-style addressing. Defaults to `false` (virtual-hosted). */
  forcePathStyle?: boolean;
  /**
   * HTTP timeouts of the built client (ignored with an injected `client`).
   * Opt-in: `requestTimeoutMs` runs until the response headers, which for a
   * `PutObject` arrive only after the whole upload — so it is set by read-only
   * servers (geo-api), never by default for writers.
   */
  httpTimeouts?: S3HttpTimeouts;
  /**
   * Destroy a body that is never iterated, or from which S3 sends nothing, for
   * this long, releasing its pooled socket. Defaults to
   * {@link DEFAULT_BODY_IDLE_TIMEOUT_MS}; `0` disables the guard.
   */
  bodyIdleTimeoutMs?: number;
  /**
   * Destroy a body whose consumer holds one chunk this long without asking for
   * the next (a client that stopped reading without disconnecting). Much
   * larger than {@link bodyIdleTimeoutMs} so slow but live clients are never
   * cut. Defaults to {@link DEFAULT_BODY_HOLD_TIMEOUT_MS}; `0` disables it.
   */
  bodyHoldTimeoutMs?: number;
}

/** HTTP timeouts for the S3 client's request handler. */
export interface S3HttpTimeouts {
  /** TCP/TLS connect bound. */
  connectionTimeoutMs?: number;
  /**
   * Bound from send to response headers, including the wait for a free pooled
   * socket — an exhausted pool fails instead of queueing forever.
   */
  requestTimeoutMs?: number;
}

/**
 * Default idle bound for an unread {@link S3Store.getStream} body. The SDK pool
 * holds at most 50 sockets and a body that is neither drained nor destroyed
 * keeps its socket forever (no default socket timeout covers the body phase),
 * so an abandoned stream would otherwise leak a socket for the process lifetime.
 */
export const DEFAULT_BODY_IDLE_TIMEOUT_MS = 120_000;

/**
 * Default bound on a single chunk held by the consumer (downstream
 * backpressure). A live client drains a chunk in far less; a client that stops
 * reading without disconnecting would otherwise pin the socket forever.
 */
export const DEFAULT_BODY_HOLD_TIMEOUT_MS = 600_000;

/** Pool size of the built client (the SDK default, made explicit). */
const MAX_SOCKETS = 50;

/** A {@link Store} backed by S3-compatible object storage. */
export class S3Store implements Store {
  readonly bucket: string;
  readonly prefix: string;
  private readonly client: S3Client;
  private readonly bodyGuard: BodyGuard;

  constructor(config: S3StoreConfig) {
    this.bucket = config.bucket;
    this.prefix = normalizePrefix(config.prefix);
    this.client = config.client ?? buildClient(config);
    this.bodyGuard = {
      idleMs: config.bodyIdleTimeoutMs ?? DEFAULT_BODY_IDLE_TIMEOUT_MS,
      holdMs: config.bodyHoldTimeoutMs ?? DEFAULT_BODY_HOLD_TIMEOUT_MS,
    };
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
      // Same release guarantee as getStream: a body that stalls after its
      // headers is destroyed instead of pinning its socket forever.
      return await bodyToBytes(idleGuardedStream(out.Body, this.bodyGuard));
    } catch (err) {
      if (isNotFound(err)) return undefined;
      throw err;
    }
  }

  /**
   * Open an object as an SDK byte stream. Unlike {@link get}, this never
   * concatenates the body, which is required by geo-api for large GeoJSON.
   */
  async getStream(key: string, opts?: GetStreamOptions): Promise<ByteStream | undefined> {
    try {
      // The SDK keeps its abort listener until the request closes, so an abort
      // after the headers also destroys the open body.
      const out = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }),
        opts?.signal ? { abortSignal: opts.signal } : {},
      );
      if (out.Body === undefined) return undefined;
      return idleGuardedStream(out.Body, this.bodyGuard, opts?.signal);
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
    requestHandler: {
      connectionTimeout?: number;
      requestTimeout?: number;
      throwOnRequestTimeout?: boolean;
      httpsAgent: { keepAlive: boolean; maxSockets: number };
      httpAgent: { keepAlive: boolean; maxSockets: number };
    };
  } = {
    forcePathStyle: config.forcePathStyle ?? false,
    requestHandler: {
      httpsAgent: { keepAlive: true, maxSockets: MAX_SOCKETS },
      httpAgent: { keepAlive: true, maxSockets: MAX_SOCKETS },
    },
  };
  const timeouts = config.httpTimeouts;
  if (timeouts?.connectionTimeoutMs !== undefined) {
    opts.requestHandler.connectionTimeout = timeouts.connectionTimeoutMs;
  }
  if (timeouts?.requestTimeoutMs !== undefined) {
    opts.requestHandler.requestTimeout = timeouts.requestTimeoutMs;
    // Without this the SDK only logs a warning and keeps waiting.
    opts.requestHandler.throwOnRequestTimeout = true;
  }
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

interface DestroyableBody {
  destroy(): void;
  readonly destroyed?: boolean;
}

function isDestroyable(value: unknown): value is DestroyableBody {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { destroy?: unknown }).destroy === "function"
  );
}

/** Bounds of {@link idleGuardedStream}; `0` disables a bound. */
interface BodyGuard {
  /** Body never iterated, or S3 silent while a chunk is awaited. */
  idleMs: number;
  /** One chunk held by the consumer (downstream backpressure). */
  holdMs: number;
}

/**
 * Wrap a `GetObject` body so it cannot pin its pooled socket forever. The body
 * is destroyed when it is never iterated within `idleMs` (e.g. the HTTP client
 * left before the response was written), when S3 sends nothing for `idleMs`
 * while a chunk is awaited, when the consumer holds one chunk for `holdMs`
 * (a client that stopped reading without disconnecting — far longer, so slow
 * but live clients are never cut), on `signal` abort, and as soon as the
 * consumer stops early (`return()`/`break`). `destroy()` is called without an
 * error so an un-iterated body cannot raise an unhandled `'error'` event; a
 * later read then fails with a premature-close error instead of hanging.
 */
function idleGuardedStream(body: unknown, guard: BodyGuard, signal?: AbortSignal): ByteStream {
  const source = bodyToStream(body);
  if (!isDestroyable(body)) return source;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const release = (): void => {
    if (body.destroyed !== true) body.destroy();
  };
  if (signal) {
    if (signal.aborted) release();
    else signal.addEventListener("abort", release, { once: true });
  }
  const unlisten = (): void => signal?.removeEventListener("abort", release);
  const arm = (ms: number): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (ms <= 0) return;
    timer = setTimeout(release, ms);
    // Never keep the process alive just for this guard.
    (timer as { unref?: () => void }).unref?.();
  };

  arm(guard.idleMs);
  return (async function* guarded(): ByteStream {
    try {
      for await (const chunk of source) {
        arm(guard.holdMs); // consumer holds the chunk: backpressure bound
        yield chunk;
        arm(guard.idleMs); // waiting on S3 again
      }
    } finally {
      arm(0);
      unlisten();
      release();
    }
  })();
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
