/**
 * CPTAQ Phase-1 normalize/serve runner.
 *
 * This is deliberately not a capture client: every input is read from the
 * proof-bound PREPROD S3 capture. The temporary archive is only a disposable
 * GDAL staging copy of those verified bytes; no upstream request exists here.
 */
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { ovhSafeS3ClientOptions } from "../storage/s3-client-config.js";
import {
  assertCptaqPreprodBucket,
  buildCptaqServedCollections,
  CPTAQ_PHASE1_CITIES,
  CPTAQ_PREPROD_BUCKET,
  CPTAQ_UPSTREAM_URI,
  extractCptaqLayer,
  prepareCptaqPublications,
  publishCptaqPublications,
  type CptaqPublishStore,
} from "./cptaq.js";

export const CPTAQ_BOUNDARIES_KEY =
  "normalized/qc-admin-boundaries/qc-municipalites.geojson";

const RAW_KEY_RE = /^raw\/cptaq\/cas\/([a-f0-9]{64})\.(bin|zip)$/;
const MANIFEST_KEY_RE = /^capture\/_runs\/constraints-[a-zA-Z0-9-]+\/manifest\.jsonl$/;
const SHA256_RE = /^[a-f0-9]{64}$/;

interface S3BodyResult {
  bytes: Uint8Array;
  etag: string | null;
}

interface S3Sender {
  send(command: unknown): Promise<unknown>;
}

export interface CptaqRunnerRepository extends CptaqPublishStore {
  readRequired(key: string): Promise<S3BodyResult>;
}

export interface CptaqCaptureProof {
  url: string;
  retrievedAt: string;
  sha256: `sha256:${string}`;
}

export interface CptaqRunnerOptions {
  rawCasKey: string;
  captureManifestKey: string;
  boundariesKey?: string;
  publish?: boolean;
}

export interface CptaqRunSummary {
  bucket: typeof CPTAQ_PREPROD_BUCKET;
  raw_cas_key: string;
  raw_sha256: `sha256:${string}`;
  capture_manifest_key: string;
  boundaries_key: string;
  source_crs_wkt: string;
  simplify: "NONE";
  dry_run: boolean;
  publication_object_count: number;
  collections: Array<{
    city_slug: string;
    collection: string;
    feature_count: number;
    snapshot_sha256: `sha256:${string}`;
    snapshot_key: string;
  }>;
}

export interface CptaqRunnerDependencies {
  repository: CptaqRunnerRepository;
  extractArchive?: (
    rawCasKey: string,
    rawBytes: Uint8Array,
  ) => Promise<Awaited<ReturnType<typeof extractCptaqLayer>>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new Error(`${label}: invalid JSON`, { cause: error });
  }
}

function requireString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label}: ${key} must be a non-empty string`);
  }
  return value;
}

export function validateCptaqKeys(options: CptaqRunnerOptions): {
  digest: string;
  boundariesKey: typeof CPTAQ_BOUNDARIES_KEY;
} {
  const raw = RAW_KEY_RE.exec(options.rawCasKey);
  if (!raw) {
    throw new Error("CPTAQ raw key must be raw/cptaq/cas/<sha256>.(bin|zip)");
  }
  if (!MANIFEST_KEY_RE.test(options.captureManifestKey)) {
    throw new Error(
      "CPTAQ capture manifest must be capture/_runs/constraints-<run>/manifest.jsonl",
    );
  }
  const boundariesKey = options.boundariesKey ?? CPTAQ_BOUNDARIES_KEY;
  if (boundariesKey !== CPTAQ_BOUNDARIES_KEY) {
    throw new Error(`CPTAQ requires the served qc-municipalites object ${CPTAQ_BOUNDARIES_KEY}`);
  }
  return { digest: raw[1]!, boundariesKey };
}

export function proofFromCptaqManifest(
  bytes: Uint8Array,
  rawCasKey: string,
): CptaqCaptureProof {
  const matches: Record<string, unknown>[] = [];
  for (const [index, rawLine] of new TextDecoder().decode(bytes).split("\n").entries()) {
    if (!rawLine.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(rawLine);
    } catch (error) {
      throw new Error(`CPTAQ capture manifest line ${index + 1}: invalid JSON`, { cause: error });
    }
    if (!isRecord(value)) {
      throw new Error(`CPTAQ capture manifest line ${index + 1}: object required`);
    }
    if (value["source"] === "cptaq" && value["storage_key"] === rawCasKey) matches.push(value);
  }
  if (matches.length !== 1) {
    throw new Error(`CPTAQ capture manifest requires one proof line for ${rawCasKey}; found ${matches.length}`);
  }
  const line = matches[0]!;
  if (line["lane"] !== "constraints") throw new Error("CPTAQ proof line lane must be constraints");
  if (line["redacted"] !== false) throw new Error("CPTAQ proof URL is redacted or UNKNOWN");
  if (line["error"] !== null) throw new Error("CPTAQ proof line records a capture failure");
  const status = line["http_status"];
  if (typeof status !== "number" || status < 200 || status >= 300) {
    throw new Error("CPTAQ proof line does not record a successful HTTP status");
  }
  const url = requireString(line, "url", "CPTAQ proof line");
  if (url !== CPTAQ_UPSTREAM_URI) {
    throw new Error("CPTAQ proof line URL is not the ratified ZA_transposee.zip upstream");
  }
  const retrievedAt = requireString(line, "retrieved_at", "CPTAQ proof line");
  if (Number.isNaN(Date.parse(retrievedAt))) {
    throw new Error("CPTAQ proof line retrieved_at is invalid");
  }
  const prefixedSha = requireString(line, "sha256", "CPTAQ proof line");
  if (!/^sha256:[a-f0-9]{64}$/.test(prefixedSha)) {
    throw new Error("CPTAQ proof line sha256 is invalid");
  }
  const raw = RAW_KEY_RE.exec(rawCasKey)!;
  if (prefixedSha !== `sha256:${raw[1]}`) {
    throw new Error("CPTAQ proof line sha256 does not match its raw CAS key");
  }
  return {
    url,
    retrievedAt,
    sha256: prefixedSha as `sha256:${string}`,
  };
}

export function validateCptaqRawSidecar(
  bytes: Uint8Array,
  input: {
    rawCasKey: string;
    rawBytes: Uint8Array;
    proof: CptaqCaptureProof;
  },
): void {
  const value = parseJson(bytes, "CPTAQ raw sidecar");
  if (!isRecord(value)) throw new Error("CPTAQ raw sidecar: object required");
  const digest = sha256(input.rawBytes);
  if (value["source"] !== "cptaq") throw new Error("CPTAQ raw sidecar source must be cptaq");
  if (value["storageKey"] !== input.rawCasKey) {
    throw new Error("CPTAQ raw sidecar storageKey does not match the requested CAS key");
  }
  if (value["sourceUrl"] !== CPTAQ_UPSTREAM_URI) {
    throw new Error("CPTAQ raw sidecar sourceUrl does not match ZA_transposee.zip");
  }
  if (value["sha256"] !== digest || input.proof.sha256 !== `sha256:${digest}`) {
    throw new Error("CPTAQ raw bytes, sidecar and proof-v2 sha256 do not agree");
  }
  if (value["bytesLen"] !== input.rawBytes.byteLength) {
    throw new Error("CPTAQ raw sidecar bytesLen does not match the CAS object");
  }
  if (value["fetchedAt"] !== input.proof.retrievedAt) {
    throw new Error("CPTAQ raw sidecar fetchedAt does not match proof-v2 retrieved_at");
  }
  const contentType = requireString(value, "contentType", "CPTAQ raw sidecar");
  if (!/^application\/(zip|octet-stream)(?:;|$)/i.test(contentType)) {
    throw new Error(`CPTAQ raw sidecar contentType is not a ZIP payload: ${contentType}`);
  }
}

async function stageAndExtract(
  rawCasKey: string,
  rawBytes: Uint8Array,
  extract: typeof extractCptaqLayer,
): Promise<Awaited<ReturnType<typeof extractCptaqLayer>>> {
  const directory = await mkdtemp(join(tmpdir(), "geo-cptaq-normalize-"));
  const archivePath = join(directory, basename(rawCasKey).endsWith(".zip") ? "captured.zip" : "captured.bin");
  try {
    await writeFile(archivePath, rawBytes);
    return await extract(archivePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function runCptaqNormalizeServe(
  options: CptaqRunnerOptions,
  dependencies: CptaqRunnerDependencies,
): Promise<CptaqRunSummary> {
  const repository = dependencies.repository;
  assertCptaqPreprodBucket(repository.bucket);
  const { digest, boundariesKey } = validateCptaqKeys(options);

  const [raw, manifest, sidecar, boundaries] = await Promise.all([
    repository.readRequired(options.rawCasKey),
    repository.readRequired(options.captureManifestKey),
    repository.readRequired(`${options.rawCasKey}.meta.json`),
    repository.readRequired(boundariesKey),
  ]);
  if (sha256(raw.bytes) !== digest) {
    throw new Error("CPTAQ raw CAS object bytes do not match the digest in its key");
  }
  if (
    raw.bytes.byteLength < 4 ||
    raw.bytes[0] !== 0x50 ||
    raw.bytes[1] !== 0x4b ||
    !((raw.bytes[2] === 0x03 && raw.bytes[3] === 0x04) ||
      (raw.bytes[2] === 0x05 && raw.bytes[3] === 0x06))
  ) throw new Error("CPTAQ raw CAS object is not a ZIP archive (PK magic absent)");
  const proof = proofFromCptaqManifest(manifest.bytes, options.rawCasKey);
  validateCptaqRawSidecar(sidecar.bytes, {
    rawCasKey: options.rawCasKey,
    rawBytes: raw.bytes,
    proof,
  });

  const extracted = dependencies.extractArchive
    ? await dependencies.extractArchive(options.rawCasKey, raw.bytes)
    : await stageAndExtract(options.rawCasKey, raw.bytes, extractCptaqLayer);
  const boundarySha = sha256(boundaries.bytes);
  const collections = buildCptaqServedCollections({
    source: extracted.source,
    boundaries: parseJson(boundaries.bytes, "CPTAQ qc-municipalites boundaries"),
    context: {
      bucket: repository.bucket,
      rawArtifactUri: `s3://${repository.bucket}/${options.rawCasKey}`,
      captureManifestUri: `s3://${repository.bucket}/${options.captureManifestKey}`,
      boundaryArtifactUri: `s3://${repository.bucket}/${boundariesKey}`,
      boundarySha256: `sha256:${boundarySha}`,
      sourceCrsWkt: extracted.sourceCrsWkt,
      proof: {
        url: proof.url,
        method:
          "S3 proof-v2 raw; GDAL/ogr2ogr zone_agricole_s -> EPSG:4326 RFC7946; simplify=NONE; clip=EXACT_GEOM/intersection",
        retrieved_at: proof.retrievedAt,
        sha256: proof.sha256,
      },
    },
  });
  const publications = prepareCptaqPublications(collections, repository.bucket);
  const publication = await publishCptaqPublications(
    repository,
    publications,
    options.publish !== true,
  );
  return {
    bucket: CPTAQ_PREPROD_BUCKET,
    raw_cas_key: options.rawCasKey,
    raw_sha256: proof.sha256,
    capture_manifest_key: options.captureManifestKey,
    boundaries_key: boundariesKey,
    source_crs_wkt: extracted.sourceCrsWkt,
    simplify: "NONE",
    dry_run: publication.dryRun,
    publication_object_count: publication.objectCount,
    collections: publications.map((item) => ({
      city_slug: item.citySlug,
      collection: item.layout.collection,
      feature_count: item.collection.features.length,
      snapshot_sha256: item.snapshotSha256,
      snapshot_key: item.snapshotKey,
    })),
  };
}

function isNotFound(error: unknown): boolean {
  if (!isRecord(error)) return false;
  return (
    error["name"] === "NoSuchKey" ||
    error["name"] === "NotFound" ||
    (isRecord(error["$metadata"]) && error["$metadata"]["httpStatusCode"] === 404)
  );
}

function isPreconditionFailed(error: unknown): boolean {
  return (
    isRecord(error) &&
    (error["name"] === "PreconditionFailed" ||
      (isRecord(error["$metadata"]) && error["$metadata"]["httpStatusCode"] === 412))
  );
}

async function bodyToBytes(body: unknown): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return body;
  if (isRecord(body) && typeof body["transformToByteArray"] === "function") {
    return await (body["transformToByteArray"] as () => Promise<Uint8Array>)();
  }
  if (body && typeof (body as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function") {
    const chunks: Uint8Array[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array>) chunks.push(chunk);
    const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
    const joined = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return joined;
  }
  throw new Error("CPTAQ S3 GetObject returned no readable body");
}

export class CptaqS3Repository implements CptaqRunnerRepository {
  readonly bucket: string;

  constructor(
    private readonly client: S3Sender,
    bucket: string,
  ) {
    assertCptaqPreprodBucket(bucket);
    this.bucket = bucket;
  }

  async readRequired(key: string): Promise<S3BodyResult> {
    const value = await this.read(key);
    if (!value) throw new Error(`CPTAQ required preprod S3 object is absent: ${key}`);
    return value;
  }

  async read(key: string): Promise<S3BodyResult | null> {
    assertCptaqPreprodBucket(this.bucket);
    try {
      const output = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!isRecord(output) || output["Body"] === undefined) {
        throw new Error(`CPTAQ S3 object has no body: ${key}`);
      }
      return {
        bytes: await bodyToBytes(output["Body"]),
        etag: typeof output["ETag"] === "string" ? output["ETag"] : null,
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async putIfAbsent(key: string, body: Uint8Array, contentType: string): Promise<boolean> {
    assertCptaqPreprodBucket(this.bucket);
    try {
      await this.client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        IfNoneMatch: "*",
      }));
      return true;
    } catch (error) {
      if (isPreconditionFailed(error)) return false;
      throw error;
    }
  }

  async putIfCurrent(
    key: string,
    body: Uint8Array,
    priorEtag: string | null,
    contentType: string,
  ): Promise<void> {
    assertCptaqPreprodBucket(this.bucket);
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ...(priorEtag === null ? { IfNoneMatch: "*" } : { IfMatch: priorEtag }),
    }));
  }
}

export function cptaqRepositoryFromEnv(
  env: Record<string, string | undefined> = process.env,
): CptaqS3Repository {
  const bucket = env["S3_BUCKET"]?.trim() || env["BUCKET"]?.trim() || CPTAQ_PREPROD_BUCKET;
  assertCptaqPreprodBucket(bucket);
  const endpoint = env["S3_ENDPOINT"]?.trim();
  const region = env["S3_REGION"]?.trim();
  if (!endpoint || !region) throw new Error("CPTAQ runner requires S3_ENDPOINT and S3_REGION");
  const accessKeyId = env["S3_ACCESS_KEY"]?.trim();
  const secretAccessKey = env["S3_SECRET_KEY"]?.trim();
  if ((accessKeyId && !secretAccessKey) || (!accessKeyId && secretAccessKey)) {
    throw new Error("CPTAQ runner requires both S3_ACCESS_KEY and S3_SECRET_KEY when either is set");
  }
  const client = new S3Client({
    endpoint,
    region,
    forcePathStyle: true,
    ...(accessKeyId && secretAccessKey
      ? { credentials: { accessKeyId, secretAccessKey } }
      : {}),
    ...ovhSafeS3ClientOptions(),
  });
  return new CptaqS3Repository(client as unknown as S3Sender, bucket);
}

export function parseCptaqRunnerArgs(argv: readonly string[]): CptaqRunnerOptions {
  const options: Partial<CptaqRunnerOptions> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--publish") options.publish = true;
    else if (arg === "--raw-cas-key") {
      const value = argv[++index];
      if (!value) throw new Error("--raw-cas-key requires a value");
      options.rawCasKey = value;
    } else if (arg === "--capture-manifest-key") {
      const value = argv[++index];
      if (!value) throw new Error("--capture-manifest-key requires a value");
      options.captureManifestKey = value;
    } else if (arg === "--boundaries-key") {
      const value = argv[++index];
      if (!value) throw new Error("--boundaries-key requires a value");
      options.boundariesKey = value;
    }
    else throw new Error(`Unknown CPTAQ runner argument: ${String(arg)}`);
  }
  if (!options.rawCasKey || !options.captureManifestKey) {
    throw new Error(
      "Usage: cptaq-normalize-serve --raw-cas-key <raw/cptaq/cas/sha.bin> --capture-manifest-key <capture/_runs/constraints-run/manifest.jsonl> [--publish]",
    );
  }
  return options as CptaqRunnerOptions;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const options = parseCptaqRunnerArgs(argv);
  const summary = await runCptaqNormalizeServe(options, {
    repository: cptaqRepositoryFromEnv(),
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
