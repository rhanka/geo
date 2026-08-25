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
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  UploadPartCommand,
} from "@aws-sdk/client-s3";

/**
 * Default creds file (never committed). Overridable with the `S3_ENV_FILE`
 * env var so a remote runner (e.g. the Scaleway normes job) can point at its
 * own materialised file — or skip the file entirely (see `s3Client`).
 */
export const S3ENV =
  process.env["S3_ENV_FILE"] ?? "/home/antoinefa/src/_acquisition-shared/s3.env";
/**
 * CIBLE S3 DECLAREE DANS LE DEPOT — `acquisition/config/s3-target.json`.
 *
 * `endpoint`, `region` et `bucket` NE SONT PAS DES SECRETS. Ils vivaient
 * pourtant dans un fichier gitignore parce que les CLES les accompagnaient,
 * donc ils etaient invisibles — et c'est ce qui a permis de lire l'ancien
 * bucket Scaleway pendant une heure apres la migration OVH sans aucun signal.
 * Seules `S3_ACCESS_KEY` / `S3_SECRET_KEY` restent hors du depot, en trois
 * exemplaires a synchroniser ensemble (.env local, GitHub secrets, secret kube
 * `geo-s3-credentials`); aucun des trois ne fait foi sur les autres.
 */
export interface S3Target { endpoint: string; region: string; bucket: string }

let cachedTarget: S3Target | null = null;

export function s3Target(): S3Target {
  if (cachedTarget !== null) return cachedTarget;
  const path = new URL("../../config/s3-target.json", import.meta.url);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<S3Target>;
  if (!parsed.endpoint || !parsed.region || !parsed.bucket) {
    throw new Error("acquisition/config/s3-target.json: endpoint, region et bucket sont requis");
  }
  cachedTarget = { endpoint: parsed.endpoint, region: parsed.region, bucket: parsed.bucket };
  return cachedTarget;
}

export const BUCKET = s3Target().bucket;

/**
 * Scaleway Object Storage rejects the AWS SDK's unknown-length `aws-chunked`
 * PutObject path. Multipart gives every uploaded part its explicit length while
 * retaining a strict, bounded memory footprint.
 */
export const STREAM_PART_BYTES = 8 * 1024 * 1024;

/** Exact public qc-zonage objects (legacy flat and mirrored nested layouts). */
export function isServedZoneKey(key: string): boolean {
  const match = key.match(/^normalized\/ca-qc-zonage\/qc-zonage-([a-z0-9-]+)(?:\.geojson|\/qc-zonage-([a-z0-9-]+)\.geojson)$/);
  return !!match && (!match[2] || match[1] === match[2]);
}

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
  const target = s3Target();
  const endpoint = env["S3_ENDPOINT"];
  const region = env["S3_REGION"];
  // ⛔ LE GARDE QUI MANQUAIT, ET QUI REND L'ERREUR IMPOSSIBLE PLUTOT QUE DOCUMENTEE.
  //
  // Le 2026-07-29 le bucket a migre de Scaleway vers OVH. Le cluster a bascule,
  // le fichier de creds LOCAL est reste sur `https://s3.fr-par.scw.cloud`, et
  // les lectures ont continue pendant une heure contre l'ANCIEN bucket — sans le
  // moindre signal, parce que la copie etait identique a l'octet: tout marchait
  // et rendait les bons SHA. Une ecriture aurait ete perdue en silence, sur un
  // bucket que plus personne ne lit.
  //
  // Comparer l'endpoint effectif a la cible DECLAREE DANS LE DEPOT transforme ce
  // defaut muet en refus bruyant. C'est la seule facon de le rendre visible: rien
  // dans la donnee ne distingue les deux clouds.
  if (endpoint !== undefined && endpoint !== target.endpoint) {
    throw new Error(
      `S3 endpoint ${endpoint} ne correspond pas a la cible declaree ${target.endpoint} ` +
        `(acquisition/config/s3-target.json). Une bascule de cloud se declare DANS LE DEPOT; ` +
        `les cles suivent dans .env local, GitHub secrets et le secret kube geo-s3-credentials.`,
    );
  }
  if (region !== undefined && region !== target.region) {
    throw new Error(
      `S3 region ${region} ne correspond pas a la cible declaree ${target.region} ` +
        `(acquisition/config/s3-target.json)`,
    );
  }
  return new S3Client({
    // La cible fait foi: un fichier de creds qui ne la porte pas ne peut plus
    // envoyer les octets ailleurs par omission.
    endpoint: target.endpoint,
    region: target.region,
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
  abortSignal?: AbortSignal,
): Promise<Buffer> {
  const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal });
  const body = r.Body as AsyncIterable<Buffer> & { destroy?: (error?: Error) => void };
  const abortError = new Error(`S3 read aborted: ${key}`);
  const abort = () => body.destroy?.(abortError);
  if (abortSignal?.aborted) {
    abort();
    throw abortError;
  }
  abortSignal?.addEventListener("abort", abort, { once: true });
  const chunks: Buffer[] = [];
  try {
    // Body is a Node Readable in the SDK v3 node runtime.
    for await (const c of body) chunks.push(c);
    return Buffer.concat(chunks);
  } finally {
    abortSignal?.removeEventListener("abort", abort);
  }
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
): Promise<{ exists: boolean; etag?: string; lastModified?: Date; contentLength?: number; contentType?: string }> {
  try {
    const result = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return {
      exists: true,
      ...(result.ETag ? { etag: result.ETag } : {}),
      ...(result.LastModified ? { lastModified: result.LastModified } : {}),
      ...(result.ContentLength === undefined ? {} : { contentLength: result.ContentLength }),
      ...(result.ContentType ? { contentType: result.ContentType } : {}),
    };
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
  if (isServedZoneKey(key)) {
    throw new Error(`direct served qc-zonage write refused: use putServedZoneGeojson with exact geometry proof (${key})`);
  }
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ...(contentType ? { ContentType: contentType } : {}),
    }),
  );
}

/**
 * Cut an arbitrary async stream into bounded multipart buffers. Non-final S3
 * parts must be at least 5 MiB; 8 MiB keeps headroom for Node and transport.
 */
async function* multipartParts(
  body: AsyncIterable<Uint8Array>,
  partBytes: number = STREAM_PART_BYTES,
): AsyncIterable<Buffer> {
  let chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of body) {
    const source = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    let offset = 0;
    while (offset < source.byteLength) {
      const take = Math.min(partBytes - length, source.byteLength - offset);
      chunks.push(source.subarray(offset, offset + take));
      offset += take;
      length += take;
      if (length === partBytes) {
        yield Buffer.concat(chunks, length);
        chunks = [];
        length = 0;
      }
    }
  }
  if (length > 0) yield Buffer.concat(chunks, length);
}

/** PUT an async byte stream without accumulating the object in process memory. */
export async function putStream(
  s3: S3Client,
  key: string,
  body: AsyncIterable<Uint8Array>,
  contentType?: string,
  bucket: string = BUCKET,
): Promise<void> {
  if (isServedZoneKey(key)) {
    throw new Error(`direct served qc-zonage stream write refused: use proof-gated deposit (${key})`);
  }
  let uploadId: string | undefined;
  const parts: Array<{ ETag?: string; PartNumber: number }> = [];
  try {
    for await (const part of multipartParts(body)) {
      if (uploadId === undefined) {
        const started = await s3.send(
          new CreateMultipartUploadCommand({
            Bucket: bucket,
            Key: key,
            ...(contentType ? { ContentType: contentType } : {}),
          }),
        );
        uploadId = started.UploadId;
        if (!uploadId) throw new Error(`multipart upload without UploadId: ${key}`);
      }
      const partNumber = parts.length + 1;
      const uploaded = await s3.send(
        new UploadPartCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: part,
          // Do not let the SDK select the unsupported unknown-length chunked path.
          ContentLength: part.byteLength,
        }),
      );
      if (!uploaded.ETag) throw new Error(`multipart part without ETag: ${key}#${partNumber}`);
      parts.push({ ETag: uploaded.ETag, PartNumber: partNumber });
    }
    if (uploadId === undefined) {
      await putBytes(s3, key, Buffer.alloc(0), contentType, bucket);
      return;
    }
    await s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      }),
    );
  } catch (error) {
    if (uploadId !== undefined) {
      try {
        await s3.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }));
      } catch {
        // The original upload failure is the actionable error; preserve it.
      }
    }
    throw error;
  }
}

/** PUT a new object once; an existing snapshot must never be replaced. */
export async function putBytesIfAbsent(
  s3: S3Client,
  key: string,
  body: Buffer | Uint8Array | string,
  contentType?: string,
  bucket: string = BUCKET,
): Promise<void> {
  if (isServedZoneKey(key)) {
    throw new Error(`direct served qc-zonage write refused: immutable destination must not be served (${key})`);
  }
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      IfNoneMatch: "*",
      ...(contentType ? { ContentType: contentType } : {}),
    }),
  );
}

/**
 * Idempotent immutable upload: create once, or accept an already-present object
 * only when its bytes are exactly equal. A 412 is never treated as success by
 * omission; the existing object is fully re-read without a caller timeout.
 */
export async function putBytesIfAbsentOrEqual(
  s3: S3Client,
  key: string,
  body: Buffer | Uint8Array | string,
  contentType?: string,
  bucket: string = BUCKET,
): Promise<"created" | "existing-equal"> {
  try {
    await putBytesIfAbsent(s3, key, body, contentType, bucket);
    return "created";
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    if ((error as { name?: string })?.name !== "PreconditionFailed" && status !== 412) throw error;
    const expected = typeof body === "string" ? Buffer.from(body) : Buffer.from(body);
    const existing = await getBytes(s3, key, bucket);
    if (!existing.equals(expected)) {
      throw new Error(`immutable S3 object collision: s3://${bucket}/${key}`);
    }
    return "existing-equal";
  }
}

/**
 * PUT conditionné à l'ETag courant — le compare-and-swap d'un POINTEUR mutable.
 *
 * `priorEtag === null` signifie « le pointeur ne doit pas encore exister » et
 * retombe donc sur `IfNoneMatch: "*"`. Sans cette précondition, deux runs
 * concurrents écriraient chacun leur pointeur et le dernier gagnerait en
 * silence : un consommateur lirait alors un `latest` qui ne correspond à aucun
 * instantané qu'il a vu. C'est la raison d'être de cette variante, et c'est
 * pourquoi elle vit ICI plutôt que chez son appelant — les écritures S3 brutes
 * restent confinées au helper générique et au gate de preuve.
 */
export async function putBytesIfMatch(
  s3: S3Client,
  key: string,
  body: Buffer | Uint8Array | string,
  priorEtag: string | null,
  contentType?: string,
  bucket: string = BUCKET,
): Promise<void> {
  if (isServedZoneKey(key)) {
    throw new Error(`direct served qc-zonage write refused: use putServedZoneGeojson with exact geometry proof (${key})`);
  }
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ...(priorEtag === null ? { IfNoneMatch: "*" } : { IfMatch: priorEtag }),
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

/**
 * Copy an object with GET+PUT (portable), NOT a server-side `CopyObjectCommand`.
 *
 * Used for the non-destructive `*-preclip` / prebackup backups a geometry
 * replacement takes before overwriting a served zone. OVH Object Storage
 * (BHS — the prod store since the 2026-07-29 migration) returns
 * `501 NotImplemented` on server-side `CopyObject`, so `CopyObjectCommand`
 * silently failed there: the backup never landed and the replace was left with
 * no rollback. Reading the source and re-uploading its bytes is portable across
 * clouds and reproduces the exact same result.
 *
 * The source object's `ContentType` is read from the GET and re-declared on the
 * PUT, so the copy keeps its type exactly as the server-side copy did (it copied
 * object metadata) — geojson backups stay `application/geo+json`, json stays
 * `application/json`, and any other declared type is preserved verbatim rather
 * than guessed. The object is buffered in memory, which is fine for the MB-range
 * zonage backups this serves (same footprint as {@link getBytes}). The
 * destination is written through {@link putBytes}, so the served-zone write
 * guard applies to both the caller's check above and the actual PUT.
 */
export async function copyObject(
  s3: S3Client,
  srcKey: string,
  destKey: string,
  bucket: string = BUCKET,
): Promise<void> {
  if (isServedZoneKey(destKey)) {
    throw new Error(`direct served qc-zonage copy refused: destination proof must be validated before write (${destKey})`);
  }
  const source = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: srcKey }));
  const body = source.Body as AsyncIterable<Buffer>;
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(chunk);
  await putBytes(s3, destKey, Buffer.concat(chunks), source.ContentType, bucket);
}

/**
 * Idempotent immutable re-key — copy a source object to a NEW key with the exact
 * bytes AND content-type of the source, create-once. The create-once mirror of a
 * server-side copy, but done CLIENT-SIDE (GET source + conditional PUT dest):
 * the OVH-BHS S3 endpoint returns `501 NotImplemented` for server-side
 * CopyObject (proven by the committed enforcement probe), so {@link copyObject}
 * is not usable here. The destination is created once, or an already-present
 * destination is accepted ONLY when its bytes are exactly equal to the source
 * (idempotent re-run).
 *
 * The write goes through {@link putBytesIfAbsentOrEqual}, i.e. native PutObject
 * `IfNoneMatch: "*"` — proven ENFORCED on OVH-BHS (a pre-existing different-bytes
 * destination throws 412 and is left byte-for-byte UNCHANGED, never
 * accept-and-ignore). A 412 is never treated as success by omission: the existing
 * destination is re-read and compared with `Buffer.equals` against the source
 * bytes we hold from the GET (never an ETag compare — a multipart ETag
 * `<md5>-<n>` is not the content MD5 and would false-negative). Because the
 * PutObject precondition is atomic and fail-closed there is NO objectHead-then-put
 * fallback pretending create-once (no TOCTOU window) and NO exclusive-window
 * constraint is required. COPY-ONLY: the source is only READ, never modified or
 * deleted (CA-G7).
 */
export async function rekeyObjectIfAbsentOrEqual(
  s3: S3Client,
  srcKey: string,
  destKey: string,
  bucket: string = BUCKET,
): Promise<"created" | "existing-equal"> {
  const bytes = await getBytes(s3, srcKey, bucket);
  const head = await objectHead(s3, srcKey, bucket);
  // putBytesIfAbsentOrEqual guards a served-zone destination and enforces the
  // create-once / byte-equal contract via native PutObject IfNoneMatch:"*".
  return putBytesIfAbsentOrEqual(s3, destKey, bytes, head.contentType, bucket);
}

/**
 * Backup tied to the exact source revision observed during a preflight, done
 * with a REVISION-GUARDED GET+PUT — NOT a server-side `CopyObjectCommand`.
 *
 * A geometry replacement cannot claim to have backed up revision A, then
 * silently copy (and later overwrite) revision B written by a concurrent
 * writer. The server-side copy enforced that with `CopySourceIfMatch`, but OVH
 * Object Storage (BHS — the prod store since the 2026-07-29 migration) returns
 * `501 NotImplemented` on server-side `CopyObject`, so that copy silently
 * failed there and the revision-guarded backup never landed — the same OVH-BHS
 * bug that {@link copyObject} works around.
 *
 * The revision guard is preserved by carrying the observed ETag onto the GET as
 * `IfMatch`: if the source's current ETag no longer matches `sourceEtag`, S3
 * returns `412 PreconditionFailed` and the GET throws — exactly the mismatch
 * signal the old `CopySourceIfMatch` produced — so no PUT is issued and the
 * backup is never written from the wrong revision. This is deliberately NOT a
 * naked GET: the `IfMatch` IS the compare-and-swap and the whole point of the
 * primitive. The source object's `ContentType` is read from the GET and
 * re-declared on the PUT (same as {@link copyObject}), and the write goes
 * through {@link putBytes} so the served-zone guard applies to the actual PUT as
 * well as the caller's check above. The destination remains non-served, exactly
 * like {@link copyObject}.
 */
export async function copyObjectIfMatch(
  s3: S3Client,
  srcKey: string,
  destKey: string,
  sourceEtag: string,
  bucket: string = BUCKET,
): Promise<void> {
  if (!sourceEtag) throw new Error(`copyObjectIfMatch requires the observed source ETag (${srcKey})`);
  if (isServedZoneKey(destKey)) {
    throw new Error(`direct served qc-zonage copy refused: destination proof must be validated before write (${destKey})`);
  }
  const source = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: srcKey, IfMatch: sourceEtag }),
  );
  const body = source.Body as AsyncIterable<Buffer>;
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(chunk);
  await putBytes(s3, destKey, Buffer.concat(chunks), source.ContentType, bucket);
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

/**
 * Paged S3 listing retaining the object identity needed by resumable readers.
 * `ETag` changes on an overwrite at the same key, unlike a slug-only listing.
 */
export interface ListedS3Object {
  key: string;
  etag: string | null;
  last_modified: string | null;
}

export async function listObjectEntries(
  s3: S3Client,
  prefix: string,
  bucket: string = BUCKET,
  abortSignal?: AbortSignal,
): Promise<ListedS3Object[]> {
  const out: ListedS3Object[] = [];
  let token: string | undefined;
  do {
    const result = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
        MaxKeys: 1000,
      }),
      { abortSignal },
    );
    for (const object of result.Contents ?? []) {
      if (!object.Key) continue;
      out.push({
        key: object.Key,
        etag: object.ETag ?? null,
        last_modified: object.LastModified?.toISOString() ?? null,
      });
    }
    token = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (token);
  return out.sort((left, right) => left.key.localeCompare(right.key));
}
