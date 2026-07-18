/**
 * Shared S3 access for the QC acquisition scripts (Scaleway Object Storage).
 *
 * Mirrors the Python `s3_client()` / `get_bytes()` / `exists()` / `list_slugs()`
 * helpers that every acquisition module re-declared. Credentials are read from
 * `/home/antoinefa/src/_acquisition-shared/s3.env` (NEVER committed) and the
 * client uses `forcePathStyle` exactly like the existing node scripts
 * (scripts/build-pmtiles.mjs) and the Python `boto3.client(endpoint_url=...)`.
 */
import { existsSync, readFileSync } from "node:fs";

import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

/**
 * Default creds file (never committed). Overridable with the `S3_ENV_FILE`
 * env var so a remote runner (e.g. the Scaleway normes job) can point at its
 * own materialised file — or skip the file entirely (see `s3Client`).
 */
export const S3ENV =
  process.env["S3_ENV_FILE"] ?? "/home/antoinefa/src/_acquisition-shared/s3.env";
export const BUCKET = "sentropic-geo";

/**
 * Parse an `.env`-style file into a flat record (ignores comments/blank).
 * Tolerates a leading `export ` (shell-sourced files like `sentropic/.env`)
 * and surrounding single/double quotes on values.
 */
export function loadEnv(path: string = S3ENV): Record<string, string> {
  const env: Record<string, string> = {};
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    let ln = raw.trim();
    if (!ln || ln.startsWith("#") || !ln.includes("=")) continue;
    if (ln.startsWith("export ")) ln = ln.slice("export ".length).trim();
    const i = ln.indexOf("=");
    const key = ln.slice(0, i).trim();
    let val = ln.slice(i + 1).trim();
    if (
      val.length >= 2 &&
      ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'")))
    ) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

/**
 * Build the Scaleway S3 client (forcePathStyle).
 *
 * Creds resolution (retro-compatible — the local default is unchanged):
 *   1. If the `envPath` file EXISTS, read creds from it (the historical path,
 *      `/home/antoinefa/src/_acquisition-shared/s3.env`, or `$S3_ENV_FILE`).
 *   2. Otherwise (remote runner with no file on disk), read the same
 *      `S3_ENDPOINT/S3_REGION/S3_ACCESS_KEY/S3_SECRET_KEY` keys straight from
 *      `process.env`. This lets a Scaleway Serverless Job inject creds as job
 *      env vars without materialising a file. NEVER logs any value.
 */
export function s3Client(envPath: string = S3ENV): S3Client {
  const env = existsSync(envPath) ? loadEnv(envPath) : process.env;
  return new S3Client({
    endpoint: env["S3_ENDPOINT"],
    region: env["S3_REGION"] || "fr-par",
    forcePathStyle: true,
    credentials: {
      accessKeyId: env["S3_ACCESS_KEY"]!,
      secretAccessKey: env["S3_SECRET_KEY"]!,
    },
  });
}

/** Read a whole object into a Buffer. Throws on missing key. */
export async function getBytes(
  s3: S3Client,
  key: string,
  bucket: string = BUCKET,
): Promise<Buffer> {
  const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const chunks: Buffer[] = [];
  // Body is a Node Readable in the SDK v3 node runtime.
  for await (const c of r.Body as AsyncIterable<Buffer>) chunks.push(c);
  return Buffer.concat(chunks);
}

/** Read + JSON.parse an object. */
export async function getJson<T = unknown>(
  s3: S3Client,
  key: string,
  bucket: string = BUCKET,
): Promise<T> {
  return JSON.parse((await getBytes(s3, key, bucket)).toString("utf8")) as T;
}

export interface ParsedFeatureCollection<TFeature = unknown> {
  type: "FeatureCollection";
  features: TFeature[];
  crs?: unknown;
}

const FEATURES_TOKEN = Buffer.from('"features"');

function isJsonWhitespace(byte: number): boolean {
  return byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09;
}

function findFeaturesArrayStart(buf: Buffer, key: string): number {
  let inString = false;
  let escaped = false;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (byte === 0x5c) escaped = true;
      else if (byte === 0x22) inString = false;
      continue;
    }

    if (byte !== 0x22) continue;
    if (buf.subarray(i, i + FEATURES_TOKEN.length).equals(FEATURES_TOKEN)) {
      let j = i + FEATURES_TOKEN.length;
      while (j < buf.length && isJsonWhitespace(buf[j]!)) j++;
      if (buf[j] !== 0x3a) continue;
      j++;
      while (j < buf.length && isJsonWhitespace(buf[j]!)) j++;
      if (buf[j] === 0x5b) return j + 1;
    }
    inString = true;
  }
  throw new Error(`GeoJSON features array not found: ${key}`);
}

/** Parse a GeoJSON FeatureCollection without converting the whole object to one
 * UTF-8 string. This avoids V8's max-string ceiling on very large cadastres. */
export function parseFeatureCollectionBuffer<TFeature = unknown>(
  buf: Buffer,
  key = "GeoJSON object",
): ParsedFeatureCollection<TFeature> {
  const features: TFeature[] = [];
  const start = findFeaturesArrayStart(buf, key);
  let inString = false;
  let escaped = false;
  let depth = 0;
  let featureStart = -1;

  for (let i = start; i < buf.length; i++) {
    const byte = buf[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (byte === 0x5c) escaped = true;
      else if (byte === 0x22) inString = false;
      continue;
    }

    if (byte === 0x22) {
      inString = true;
      continue;
    }
    if (depth === 0) {
      if (byte === 0x5d) return { type: "FeatureCollection", features };
      if (byte === 0x7b) {
        featureStart = i;
        depth = 1;
      }
      continue;
    }
    if (byte === 0x7b) depth++;
    else if (byte === 0x7d) {
      depth--;
      if (depth === 0) {
        features.push(JSON.parse(buf.subarray(featureStart, i + 1).toString("utf8")) as TFeature);
        featureStart = -1;
      }
    }
  }
  throw new Error(`GeoJSON features array did not terminate: ${key}`);
}

export async function getGeoJsonFeatureCollection<TFeature = unknown>(
  s3: S3Client,
  key: string,
  bucket: string = BUCKET,
): Promise<ParsedFeatureCollection<TFeature>> {
  return parseFeatureCollectionBuffer<TFeature>(await getBytes(s3, key, bucket), key);
}

/** HEAD probe — true iff the key exists (mirrors boto3 head_object/try). */
export async function exists(
  s3: S3Client,
  key: string,
  bucket: string = BUCKET,
): Promise<boolean> {
  return (await objectHead(s3, key, bucket)).exists;
}

/** Read only the existence metadata needed by bounded refresh planners. */
function isMissingObjectError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const detail = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return detail.name === "NotFound" || detail.name === "NoSuchKey" || detail.$metadata?.httpStatusCode === 404;
}

export async function objectHead(
  s3: S3Client,
  key: string,
  bucket: string = BUCKET,
): Promise<{ exists: boolean; lastModified?: Date }> {
  try {
    const result = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return { exists: true, ...(result.LastModified ? { lastModified: result.LastModified } : {}) };
  } catch (error) {
    if (isMissingObjectError(error)) return { exists: false };
    throw error;
  }
}

/** PUT raw bytes. */
export async function putBytes(
  s3: S3Client,
  key: string,
  body: Buffer | Uint8Array | string,
  contentType?: string,
  bucket: string = BUCKET,
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ...(contentType ? { ContentType: contentType } : {}),
    }),
  );
}

/** Delete a single object (idempotent — S3 delete of a missing key is a no-op). */
export async function deleteObject(
  s3: S3Client,
  key: string,
  bucket: string = BUCKET,
): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/** Server-side copy (used for the non-destructive *-preclip backups). */
export async function copyObject(
  s3: S3Client,
  srcKey: string,
  destKey: string,
  bucket: string = BUCKET,
): Promise<void> {
  await s3.send(
    new CopyObjectCommand({
      Bucket: bucket,
      CopySource: `${bucket}/${encodeURI(srcKey)}`,
      Key: destKey,
    }),
  );
}

/**
 * List top-level slugs under `prefix` ending in `suffix`. When `topLevelOnly`
 * is true, keys whose remaining path contains a `/` are skipped (mirrors the
 * `cadastre_index_province.list_slugs` behaviour that excludes nested ArcGIS
 * dumps); otherwise every matching key is returned (the role/clip variant).
 */
export async function listSlugs(
  s3: S3Client,
  prefix: string,
  suffix: string,
  topLevelOnly = false,
  bucket: string = BUCKET,
): Promise<string[]> {
  const out: string[] = [];
  let token: string | undefined;
  do {
    const r = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
        MaxKeys: 1000,
      }),
    );
    for (const o of r.Contents ?? []) {
      const k = o.Key!;
      if (!k.endsWith(suffix)) continue;
      const rest = k.slice(prefix.length, k.length - suffix.length);
      if (topLevelOnly && rest.includes("/")) continue;
      out.push(rest);
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out;
}
