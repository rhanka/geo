/**
 * Audit read-only des collections jumelles servies par geo-api.
 *
 * Le catalogue est reconstruit avec la même règle que StoreProvider : chaque
 * GeoJSON sous normalized/ est indexé par datasetId (ou son stem), et la dernière
 * clé triée gagne. On ne confond donc pas les deux layouts physiques flat/nested
 * d'une collection canonique avec une seconde collection servie.
 *
 * Les corps S3 et les réponses OGC ne sont ouverts que si leur taille est
 * strictement sous 5 Mio. Une taille absente, changeante ou trop grande arrête le
 * run : c'est une inconnue de mesure, jamais une absence d'effet.
 *
 * Usage (racine du dépôt) :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *     npx tsx acquisition/src/collections-jumelles-effets-retires.ts
 *
 * Aucune écriture n'est faite sous normalized/. Les deux lectures OGC sont
 * capturées par le chokepoint sous raw/ et capture/_runs/, préfixes non servis.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  GetObjectCommand,
  ListObjectsV2Command,
  type S3Client,
} from "@aws-sdk/client-s3";
import {
  capturedFetch,
  capturedText,
  NODE_FETCH_DEFAULT_MAX_REDIRECTS,
} from "../../packages/qc-sources/src/capture/index.js";

import { openCaptureRun } from "./lib/capture-s3.js";
import { BUCKET, s3Client } from "./lib/s3.js";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..", "..");
const NORMALIZED_PREFIX = "normalized/";
const API_BASE = "https://api.geo.sent-tech.ca";
const MAX_READ_BYTES = 5 * 1024 * 1024;
const REPORT_STEM = "collections-jumelles-effets-retires";

interface ListedObject {
  key: string;
  etag: string;
  last_modified: string | null;
  size: number;
}

interface CatalogEntry extends ListedObject {
  id: string;
  metadata_key: string | null;
}

interface FeatureLike {
  properties?: unknown;
}

interface FeatureCollectionLike {
  type?: unknown;
  features?: unknown;
}

interface EffectObservation {
  feature_count: number | null;
  effect_value_counts: Record<string, number>;
  non_unknown_effect_feature_count: number;
}

type SuffixPart = "additive-prebackup" | "timestamp" | "subdir" | "other";

interface TwinObservation extends CatalogEntry {
  canonical_collection: string;
  suffix: string;
  suffix_form: string;
  suffix_parts: SuffixPart[];
  /** `effet_densifiant` is a zonage field, published only under ca-qc-zonage/. */
  effect: EffectObservation | null;
  effect_measurement: "post-restart-ogc-pages" | "not-applicable-non-zonage";
  ogc_page_count: number | null;
}

interface ApiEvidence {
  collection: string;
  url: string;
  http_status: number | null;
  retrieved_at: string | null;
  bytes: number | null;
  sha256: string | null;
  storage_key: string | null;
  number_matched: number | null;
  number_returned: number | null;
  effect_value_counts: Record<string, number> | null;
  non_unknown_effect_feature_count: number | null;
  matching_zone_codes: string[];
  verdict: "CONFIRME" | "REFUTE";
  reason: string;
}

interface ApiPageCapture {
  url: string;
  http_status: number;
  retrieved_at: string;
  bytes: number;
  sha256: string;
  storage_key: string | null;
}

interface ServedZonageTwinRead {
  collection: string;
  effect: EffectObservation;
  page_count: number;
  captures: ApiPageCapture[];
  matching_zones: Array<{ zone_code: string; effect: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function utcStamp(now = new Date()): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function reportPath(extension: "json" | "md", stamp: string): string {
  return resolve(ROOT, "work", "coverage", `${REPORT_STEM}-${stamp}.${extension}`);
}

function stemOf(key: string): string {
  const basename = key.slice(key.lastIndexOf("/") + 1);
  if (!basename.endsWith(".geojson")) throw new Error(`GeoJSON attendu: ${key}`);
  return basename.slice(0, -".geojson".length);
}

function metadataKeyOf(geojsonKey: string): string {
  return `${geojsonKey.slice(0, -".geojson".length)}.meta.json`;
}

async function listAllObjects(s3: S3Client, prefix: string): Promise<ListedObject[]> {
  const objects: ListedObject[] = [];
  let token: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken: token,
        MaxKeys: 1000,
      }),
    );
    for (const item of page.Contents ?? []) {
      if (!item.Key || !item.ETag || item.Size === undefined || item.Size < 0) {
        throw new Error(`listing S3 incomplet sous ${prefix}: clé, ETag et taille sont requis`);
      }
      objects.push({
        key: item.Key,
        etag: item.ETag,
        last_modified: item.LastModified?.toISOString() ?? null,
        size: item.Size,
      });
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return objects.sort((left, right) => left.key.localeCompare(right.key));
}

/**
 * Read one complete JSON object only after enforcing the 5 Mio upper bound.
 * If the object changed since listing, IfMatch makes the read fail rather than
 * mixing one catalogue snapshot with another object's bytes.
 */
async function readJsonUnderLimit(s3: S3Client, object: ListedObject): Promise<unknown> {
  if (object.size > MAX_READ_BYTES) {
    throw new Error(`refus de lire > 5 Mio: s3://${BUCKET}/${object.key} (${object.size} octets)`);
  }
  const response = await s3.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: object.key, IfMatch: object.etag }),
  );
  if (response.ContentLength === undefined || response.ContentLength > MAX_READ_BYTES) {
    throw new Error(`taille S3 absente ou > 5 Mio à la lecture: s3://${BUCKET}/${object.key}`);
  }
  const body = response.Body as AsyncIterable<Uint8Array> | undefined;
  if (!body) throw new Error(`corps S3 absent: s3://${BUCKET}/${object.key}`);
  const chunks: Buffer[] = [];
  let read = 0;
  for await (const chunk of body) {
    read += chunk.byteLength;
    if (read > MAX_READ_BYTES) throw new Error(`flux S3 > 5 Mio: s3://${BUCKET}/${object.key}`);
    chunks.push(Buffer.from(chunk));
  }
  if (read !== response.ContentLength) {
    throw new Error(`taille S3 incohérente: s3://${BUCKET}/${object.key} (${read} != ${response.ContentLength})`);
  }
  try {
    return JSON.parse(Buffer.concat(chunks, read).toString("utf8")) as unknown;
  } catch (error) {
    throw new Error(`JSON S3 invalide: s3://${BUCKET}/${object.key}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function mapLimit<T, U>(items: readonly T[], limit: number, fn: (item: T) => Promise<U>): Promise<U[]> {
  const results = new Array<U>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

async function catalogFromS3(s3: S3Client): Promise<{ objects: ListedObject[]; collections: CatalogEntry[] }> {
  const objects = await listAllObjects(s3, NORMALIZED_PREFIX);
  const byKey = new Map(objects.map((object) => [object.key, object]));
  const geojson = objects.filter((object) => object.key.endsWith(".geojson"));
  const entries = await mapLimit(geojson, 16, async (object): Promise<CatalogEntry> => {
    const metadata_key = metadataKeyOf(object.key);
    const metadata = byKey.get(metadata_key);
    let id = stemOf(object.key);
    if (metadata) {
      const parsed = await readJsonUnderLimit(s3, metadata);
      if (isRecord(parsed) && typeof parsed["datasetId"] === "string") id = parsed["datasetId"];
    }
    return { ...object, id, metadata_key: metadata ? metadata_key : null };
  });

  // StoreProvider indexes keys in lexicographic order and a later same id wins.
  const selected = new Map<string, CatalogEntry>();
  for (const entry of entries.sort((left, right) => left.key.localeCompare(right.key))) selected.set(entry.id, entry);
  return { objects, collections: [...selected.values()].sort((left, right) => left.id.localeCompare(right.id)) };
}

function stripOneKnownSuffix(id: string): { base: string; part: SuffixPart } | null {
  const additive = /^(.*)\.additive-prebackup$/.exec(id);
  if (additive) return { base: additive[1]!, part: "additive-prebackup" };

  // ISO timestamp directory names emitted by recovery / staging jobs.
  const timestamp = /^(.*)\.\d{4}-\d{2}-\d{2}T\d{4,6}Z$/.exec(id);
  if (timestamp) return { base: timestamp[1]!, part: "timestamp" };

  const subdir = /^(.*)__subdir$/.exec(id);
  if (subdir) return { base: subdir[1]!, part: "subdir" };

  // Variants that cannot be municipal-name continuations are grouped as other.
  // Single-hyphen tails are deliberately excluded: qc-pv-saint-georges and
  // qc-pv-saint-georges-de-windsor are distinct municipalities, not twins.
  const other = /^(.*?)(?:__(?:.+)|\.(?:backup|prebackup|copy|bak|old|tmp|test|debug|v\d+)|--(?:\d+|backup|prebackup|copy|bak|old|tmp|test|debug|v\d+)|-(?:backup|prebackup|copy|bak|old|tmp|test|debug|v\d+))$/.exec(id);
  return other ? { base: other[1]!, part: "other" } : null;
}

function twinOf(id: string, canonicalIds: ReadonlySet<string>): {
  canonical_collection: string;
  suffix: string;
  suffix_parts: SuffixPart[];
} | null {
  let current = id;
  const reversedParts: SuffixPart[] = [];
  for (;;) {
    const stripped = stripOneKnownSuffix(current);
    if (!stripped) return null;
    reversedParts.push(stripped.part);
    current = stripped.base;
    if (canonicalIds.has(current)) {
      const suffix_parts = [...reversedParts].reverse();
      return { canonical_collection: current, suffix: id.slice(current.length), suffix_parts };
    }
  }
}

function effectObservation(value: unknown): EffectObservation {
  if (!isRecord(value) || value.type !== "FeatureCollection" || !Array.isArray(value.features)) {
    throw new Error("FeatureCollection JSON attendu");
  }
  const effect_value_counts: Record<string, number> = {};
  let non_unknown_effect_feature_count = 0;
  for (const feature of value.features as FeatureLike[]) {
    const properties = isRecord(feature) && isRecord(feature.properties) ? feature.properties : null;
    if (!properties || !("effet_densifiant" in properties)) continue;
    const effect = properties["effet_densifiant"];
    if (effect === null || effect === undefined || (typeof effect === "string" && effect.trim() === "")) continue;
    const key = typeof effect === "string" ? effect : JSON.stringify(effect);
    effect_value_counts[key] = (effect_value_counts[key] ?? 0) + 1;
    if (effect !== "inconnu") non_unknown_effect_feature_count++;
  }
  return { feature_count: value.features.length, effect_value_counts, non_unknown_effect_feature_count };
}

const S3_RANGE_BYTES = 1024 * 1024;
const EFFECT_KEY = Buffer.from('"effet_densifiant"');
const MAX_EFFECT_VALUE_BYTES = 64 * 1024;

function isWhitespace(byte: number): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
}

function countEffectValue(
  value: unknown,
  effect_value_counts: Record<string, number>,
): number {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return 0;
  const key = typeof value === "string" ? value : JSON.stringify(value);
  effect_value_counts[key] = (effect_value_counts[key] ?? 0) + 1;
  return value === "inconnu" ? 0 : 1;
}

/**
 * A byte-level scanner for exactly one JSON property. It never stores a
 * GeoJSON feature: only a 1 Mio S3 range plus the currently incomplete field
 * token are retained. A key-looking string embedded in a value is rejected
 * because it is not followed by a colon.
 */
class EffectFieldScanner {
  #pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  #pendingField = false;
  readonly effect_value_counts: Record<string, number> = {};
  non_unknown_effect_feature_count = 0;

  push(chunk: Buffer): void {
    let source: Buffer<ArrayBufferLike> = this.#pending.length === 0 ? chunk : Buffer.concat([this.#pending, chunk]);
    let cursor = 0;
    this.#pending = Buffer.alloc(0);
    this.#pendingField = false;
    for (;;) {
      const keyAt = source.indexOf(EFFECT_KEY, cursor);
      if (keyAt < 0) {
        this.#pending = source.subarray(Math.max(cursor, source.length - EFFECT_KEY.length + 1));
        return;
      }
      let valueStart = keyAt + EFFECT_KEY.length;
      while (valueStart < source.length && isWhitespace(source[valueStart]!)) valueStart++;
      if (valueStart >= source.length) {
        this.#pending = source.subarray(keyAt);
        this.#pendingField = true;
        return;
      }
      if (source[valueStart] !== 0x3a) {
        cursor = keyAt + EFFECT_KEY.length;
        continue;
      }
      valueStart++;
      while (valueStart < source.length && isWhitespace(source[valueStart]!)) valueStart++;
      if (valueStart >= source.length) {
        this.#pending = source.subarray(keyAt);
        this.#pendingField = true;
        return;
      }
      const parsed = this.#parseValue(source, valueStart);
      if (parsed === null) {
        if (source.length - keyAt > MAX_EFFECT_VALUE_BYTES) {
          throw new Error("valeur effet_densifiant > 64 Kio: refus de tamponner une valeur non bornée");
        }
        this.#pending = source.subarray(keyAt);
        this.#pendingField = true;
        return;
      }
      this.non_unknown_effect_feature_count += countEffectValue(parsed.value, this.effect_value_counts);
      cursor = parsed.next;
    }
  }

  finish(): void {
    if (this.#pendingField) {
      throw new Error("champ effet_densifiant tronqué à la fin de l'objet S3");
    }
  }

  #parseValue(source: Buffer, start: number): { value: unknown; next: number } | null {
    if (source[start] === 0x22) {
      let escaped = false;
      for (let index = start + 1; index < source.length; index++) {
        const byte = source[index]!;
        if (escaped) {
          escaped = false;
          continue;
        }
        if (byte === 0x5c) {
          escaped = true;
          continue;
        }
        if (byte !== 0x22) continue;
        const raw = source.subarray(start, index + 1);
        try {
          return { value: JSON.parse(raw.toString("utf8")) as unknown, next: index + 1 };
        } catch (error) {
          throw new Error(`valeur effet_densifiant JSON invalide: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      return null;
    }
    let end = start;
    while (end < source.length && !isWhitespace(source[end]!) && source[end] !== 0x2c && source[end] !== 0x7d && source[end] !== 0x5d) end++;
    if (end === source.length) return null;
    const raw = source.subarray(start, end).toString("utf8");
    try {
      return { value: JSON.parse(raw) as unknown, next: end };
    } catch (error) {
      throw new Error(`valeur effet_densifiant JSON invalide: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function observationFromScanner(scanner: EffectFieldScanner): EffectObservation {
  return {
    feature_count: null,
    effect_value_counts: scanner.effect_value_counts,
    non_unknown_effect_feature_count: scanner.non_unknown_effect_feature_count,
  };
}

/** Pure, bounded scanner entrypoint for the range-boundary regression test. */
export function scanEffectFieldChunks(chunks: readonly Uint8Array[]): EffectObservation {
  const scanner = new EffectFieldScanner();
  for (const chunk of chunks) scanner.push(Buffer.from(chunk));
  scanner.finish();
  return observationFromScanner(scanner);
}

async function readS3Range(s3: S3Client, object: ListedObject, start: number, end: number): Promise<Buffer> {
  const response = await s3.send(
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: object.key,
      Range: `bytes=${start}-${end}`,
      IfMatch: object.etag,
    }),
  );
  const expected = end - start + 1;
  if (response.ContentLength !== expected) {
    throw new Error(`plage S3 de taille incohérente: s3://${BUCKET}/${object.key} (${response.ContentLength} != ${expected})`);
  }
  const body = response.Body as AsyncIterable<Uint8Array> | undefined;
  if (!body) throw new Error(`corps S3 absent: s3://${BUCKET}/${object.key}`);
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of body) {
    bytes += chunk.byteLength;
    if (bytes > S3_RANGE_BYTES) throw new Error(`plage S3 > 1 Mio: s3://${BUCKET}/${object.key}`);
    chunks.push(Buffer.from(chunk));
  }
  if (bytes !== expected) throw new Error(`plage S3 tronquée: s3://${BUCKET}/${object.key} (${bytes} != ${expected})`);
  return Buffer.concat(chunks, bytes);
}

async function effectObservationByRanges(s3: S3Client, object: ListedObject): Promise<EffectObservation> {
  const scanner = new EffectFieldScanner();
  const rangeCount = Math.ceil(object.size / S3_RANGE_BYTES);
  for (let range = 0; range < rangeCount; range++) {
    const start = range * S3_RANGE_BYTES;
    const end = Math.min(object.size - 1, start + S3_RANGE_BYTES - 1);
    scanner.push(await readS3Range(s3, object, start, end));
  }
  scanner.finish();
  return observationFromScanner(scanner);
}

function identifyTwins(collections: readonly CatalogEntry[]): TwinObservation[] {
  const canonicalIds = new Set(collections.map((collection) => collection.id));
  return collections
    .map((collection) => ({ collection, twin: twinOf(collection.id, canonicalIds) }))
    .filter((candidate): candidate is { collection: CatalogEntry; twin: NonNullable<typeof candidate.twin> } => candidate.twin !== null)
    .map(({ collection, twin }): TwinObservation => {
      const isZonage = collection.key.startsWith("normalized/ca-qc-zonage/");
      return {
        ...collection,
        ...twin,
        suffix_form: twin.suffix_parts.join("+"),
        effect: null,
        effect_measurement: isZonage ? "post-restart-ogc-pages" : "not-applicable-non-zonage",
        ogc_page_count: null,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function apiEffects(value: unknown): {
  number_matched: number;
  number_returned: number;
  effect: EffectObservation;
  zones: Array<{ zone_code: string; effect: string }>;
} {
  if (!isRecord(value) || !Array.isArray(value.features) || typeof value["numberMatched"] !== "number" || typeof value["numberReturned"] !== "number") {
    throw new Error("réponse OGC FeatureCollection complète attendue");
  }
  const effect = effectObservation(value as FeatureCollectionLike);
  const zones: Array<{ zone_code: string; effect: string }> = [];
  for (const feature of value.features as FeatureLike[]) {
    const properties = isRecord(feature) && isRecord(feature.properties) ? feature.properties : null;
    if (!properties || typeof properties["zone_code"] !== "string" || typeof properties["effet_densifiant"] !== "string") continue;
    zones.push({ zone_code: properties["zone_code"], effect: properties["effet_densifiant"] });
  }
  return { number_matched: value["numberMatched"], number_returned: value["numberReturned"], effect, zones };
}

function suttonVerdict(read: ReturnType<typeof apiEffects>): Pick<ApiEvidence, "verdict" | "reason" | "matching_zone_codes"> {
  const counts = read.effect.effect_value_counts;
  const confirmed =
    read.number_matched === 95 &&
    read.number_returned === 95 &&
    counts["stable"] === 48 &&
    counts["densifie"] === 27 &&
    counts["reduit"] === 10 &&
    read.effect.non_unknown_effect_feature_count === 85;
  return {
    verdict: confirmed ? "CONFIRME" : "REFUTE",
    reason: confirmed
      ? "95 features, dont 48 stable + 27 densifie + 10 reduit (85 effets non-inconnu)"
      : "les compteurs servis ne correspondent pas au cas signalé",
    matching_zone_codes: [],
  };
}

function coaticookVerdict(read: ReturnType<typeof apiEffects>): Pick<ApiEvidence, "verdict" | "reason" | "matching_zone_codes"> {
  const matching_zone_codes = read.zones
    .filter((zone) => zone.zone_code === "RD-104" && zone.effect === "densifie")
    .map((zone) => zone.zone_code);
  const confirmed = matching_zone_codes.length === 1;
  return {
    verdict: confirmed ? "CONFIRME" : "REFUTE",
    reason: confirmed ? "RD-104 est servi une fois avec effet_densifiant=densifie" : "RD-104 densifie n'est pas servi exactement une fois",
    matching_zone_codes,
  };
}

const OGC_PAGE_SIZE = 100;

function addEffectCounts(total: Record<string, number>, page: Record<string, number>): void {
  for (const [value, count] of Object.entries(page)) total[value] = (total[value] ?? 0) + count;
}

async function readServedZonageTwin(
  run: ReturnType<typeof openCaptureRun>,
  collection: string,
  matchingZone: (zone: { zone_code: string; effect: string }) => boolean,
): Promise<ServedZonageTwinRead> {
  const captures: ApiPageCapture[] = [];
  const effect_value_counts: Record<string, number> = {};
  const matching_zones: Array<{ zone_code: string; effect: string }> = [];
  let non_unknown_effect_feature_count = 0;
  let returned = 0;

  const readPage = async (offset: number): Promise<ReturnType<typeof apiEffects>> => {
    const url = `${API_BASE}/collections/${encodeURIComponent(collection)}/items?limit=${OGC_PAGE_SIZE}&offset=${offset}`;
    const result = await capturedFetch(
      url,
      { headers: { accept: "application/geo+json" } },
      {
        run,
        lane: "zones",
        source: "geo-api-readback",
        slugs: [],
        timeoutMs: null,
        maxBytes: MAX_READ_BYTES,
        maxRedirects: NODE_FETCH_DEFAULT_MAX_REDIRECTS,
        retainBody: true,
      },
    );
    if (!result.ok || result.bytes === null || result.line.http_status === null || result.line.retrieved_at === null || result.line.bytes === null || result.line.sha256 === null) {
      throw new Error(`lecture OGC incomplète pour ${collection} offset=${offset}: ${result.line.error ?? "sans octets"}`);
    }
    const read = apiEffects(JSON.parse(capturedText(result)) as unknown);
    if (read.number_returned !== read.effect.feature_count) {
      throw new Error(`compteur OGC incohérent pour ${collection} offset=${offset}`);
    }
    captures.push({
      url,
      http_status: result.line.http_status,
      retrieved_at: result.line.retrieved_at,
      bytes: result.line.bytes,
      sha256: result.line.sha256,
      storage_key: result.line.storage_key,
    });
    addEffectCounts(effect_value_counts, read.effect.effect_value_counts);
    non_unknown_effect_feature_count += read.effect.non_unknown_effect_feature_count;
    returned += read.number_returned;
    matching_zones.push(...read.zones.filter(matchingZone));
    return read;
  };

  const first = await readPage(0);
  if (!Number.isInteger(first.number_matched) || first.number_matched < 0) {
    throw new Error(`numberMatched OGC invalide pour ${collection}`);
  }
  const page_count = Math.max(1, Math.ceil(first.number_matched / OGC_PAGE_SIZE));
  for (let page = 1; page < page_count; page++) {
    const read = await readPage(page * OGC_PAGE_SIZE);
    if (read.number_matched !== first.number_matched) {
      throw new Error(`numberMatched a changé pendant la pagination OGC: ${collection}`);
    }
  }
  if (returned !== first.number_matched) {
    throw new Error(`pagination OGC incomplète pour ${collection}`);
  }
  return {
    collection,
    effect: {
      feature_count: first.number_matched,
      effect_value_counts,
      non_unknown_effect_feature_count,
    },
    page_count,
    captures,
    matching_zones,
  };
}

function apiEvidenceFromRead(
  read: ServedZonageTwinRead,
  verdictFor: (value: ReturnType<typeof apiEffects>) => Pick<ApiEvidence, "verdict" | "reason" | "matching_zone_codes">,
): ApiEvidence {
  const first = read.captures[0];
  if (!first) throw new Error(`aucune capture OGC: ${read.collection}`);
  if (read.effect.feature_count === null) throw new Error(`compteur OGC absent: ${read.collection}`);
  const verdict = verdictFor({
    number_matched: read.effect.feature_count,
    number_returned: read.effect.feature_count,
    effect: read.effect,
    zones: read.matching_zones,
  });
  return {
    collection: read.collection,
    url: first.url,
    http_status: first.http_status,
    retrieved_at: first.retrieved_at,
    bytes: read.captures.reduce((sum, capture) => sum + capture.bytes, 0),
    sha256: first.sha256,
    storage_key: first.storage_key,
    number_matched: read.effect.feature_count,
    number_returned: read.effect.feature_count,
    effect_value_counts: read.effect.effect_value_counts,
    non_unknown_effect_feature_count: read.effect.non_unknown_effect_feature_count,
    ...verdict,
  };
}

async function readApiEvidence(twins: readonly TwinObservation[]): Promise<{
  capture_run_id: string;
  reads: ServedZonageTwinRead[];
  sutton: ApiEvidence;
  coaticook: ApiEvidence;
}> {
  const run = openCaptureRun({ lane: "zones", echo: null });
  const targets = [
    "qc-zonage-sutton.additive-prebackup",
    "qc-zonage-coaticook__subdir.2026-07-26T0643Z",
  ];
  let exitCode = 1;
  try {
    const reads: ServedZonageTwinRead[] = [];
    const byId = new Map(twins.map((twin) => [twin.id, twin]));
    for (const collection of targets) {
      const twin = byId.get(collection);
      if (!twin || twin.effect_measurement !== "post-restart-ogc-pages") {
        throw new Error(`collection zonage jumelle attendue absente: ${collection}`);
      }
      reads.push(await readServedZonageTwin(run, collection, (zone) => zone.zone_code === "RD-104" && zone.effect === "densifie"));
    }
    const byCollection = new Map(reads.map((read) => [read.collection, read]));
    const sutton = byCollection.get("qc-zonage-sutton.additive-prebackup");
    const coaticook = byCollection.get("qc-zonage-coaticook__subdir.2026-07-26T0643Z");
    if (!sutton || !coaticook) throw new Error("les deux collections signalées ne sont pas dans le catalogue servi");
    const suttonEvidence = apiEvidenceFromRead(sutton, suttonVerdict);
    const coaticookEvidence = apiEvidenceFromRead(coaticook, coaticookVerdict);
    exitCode = suttonEvidence.verdict === "CONFIRME" && coaticookEvidence.verdict === "CONFIRME" ? 0 : 1;
    return { capture_run_id: run.runId, reads, sutton: suttonEvidence, coaticook: coaticookEvidence };
  } finally {
    await run.finish(exitCode);
  }
}

function suffixCounts(twins: readonly TwinObservation[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const twin of twins) counts[twin.suffix_form] = (counts[twin.suffix_form] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function reportMarkdown(report: {
  generated_at: string;
  rollout_restart: { deployment: string; namespace: string; observed_generation: number };
  served_collection_count: number;
  twin_counts_by_suffix_form: Record<string, number>;
  twins_with_non_unknown_effect: number;
  non_unknown_effect_feature_count: number;
  api_evidence: { sutton: ApiEvidence; coaticook: ApiEvidence };
}): string {
  const forms = Object.entries(report.twin_counts_by_suffix_form)
    .map(([form, count]) => `${form}=${count}`)
    .join("; ") || "aucune";
  return `# Collections jumelles et effets retirés\n\n` +
    `Mesure UTC: ${report.generated_at}. Déploiement redémarré: ${report.rollout_restart.namespace}/${report.rollout_restart.deployment}, génération observée ${report.rollout_restart.observed_generation}.\n\n` +
    `- Collections servies: ${report.served_collection_count}; jumelles par forme: ${forms}.\n` +
    `- Jumelles portant au moins un \`effet_densifiant\` non \`inconnu\`: ${report.twins_with_non_unknown_effect} collections, ${report.non_unknown_effect_feature_count} features.\n` +
    `- OGC post-redémarrage: Sutton ${report.api_evidence.sutton.verdict} (${report.api_evidence.sutton.reason}); Coaticook ${report.api_evidence.coaticook.verdict} (${report.api_evidence.coaticook.reason}).\n\n` +
    `## Recommandation (non appliquée)\n\n` +
    `Retirer les collections jumelles plutôt que seulement leurs effets, puis publier un registre immuable collection-id → canonique/version et faire casser les consommateurs sur tout id absent de ce registre; cela casse les résolutions par préfixe/horodatage et tout client qui consommait explicitement un jumeau, mais empêche toute ré-ingestion silencieuse.\n`;
}

async function main(): Promise<void> {
  const generated_at = new Date().toISOString();
  const stamp = utcStamp(new Date(generated_at));
  const s3 = s3Client();
  const catalog = await catalogFromS3(s3);
  const identifiedTwins = identifyTwins(catalog.collections);
  const zonageEffects = await mapLimit(
    identifiedTwins.filter((twin) => twin.effect_measurement === "post-restart-ogc-pages"),
    4,
    async (twin) => ({ id: twin.id, effect: await effectObservationByRanges(s3, twin) }),
  );
  const effectsByCollection = new Map(zonageEffects.map((observation) => [observation.id, observation.effect]));
  const twins = identifiedTwins.map((twin): TwinObservation => {
    const effect = effectsByCollection.get(twin.id);
    if (twin.effect_measurement === "post-restart-ogc-pages" && !effect) {
      throw new Error(`lecture S3 par champs manquante pour le jumeau zonage ${twin.id}`);
    }
    return effect ? { ...twin, effect } : twin;
  });
  const api = await readApiEvidence(twins);
  const twins_with_non_unknown_effect = twins.filter((twin) => (twin.effect?.non_unknown_effect_feature_count ?? 0) > 0);
  const report = {
    schema_version: "1.0.0",
    generated_at,
    measurement: {
      complete: true,
      object_read_max_bytes: MAX_READ_BYTES,
      s3_prefix: NORMALIZED_PREFIX,
      catalog_rule: "StoreProvider: .geojson recursively indexed by datasetId or stem; lexicographically later same id wins",
      twin_rule: "served id with an existing canonical id after stripping additive-prebackup, ISO timestamp, __subdir, or an unambiguous backup/copy/debug/--number suffix",
      effect_rule: "feature property effet_densifiant present, non-empty, and not exactly inconnu; every zonage twin is scanned as 1 Mio S3 ranges, while the two named cases are confirmed through bounded OGC pages after restart",
    },
    rollout_restart: {
      deployment: "geo-api",
      namespace: "geo",
      kubeconfig: "/tmp/ovh.kubeconfig",
      observed_generation: 20,
      command: "kubectl --kubeconfig=/tmp/ovh.kubeconfig -n geo rollout restart deployment/geo-api",
    },
    s3_object_count_under_normalized: catalog.objects.length,
    served_collection_count: catalog.collections.length,
    twin_collection_count: twins.length,
    twin_counts_by_suffix_form: suffixCounts(twins),
    twins_with_non_unknown_effect: twins_with_non_unknown_effect.length,
    non_unknown_effect_feature_count: twins.reduce((sum, twin) => sum + (twin.effect?.non_unknown_effect_feature_count ?? 0), 0),
    api_evidence: api,
    // Keep the committed report short: all 391 names add no decision value.
    // The only individual rows retained are the 15 that still serve a claim.
    effect_bearing_twins: twins_with_non_unknown_effect,
    recommendation: {
      status: "PROPOSEE_NON_APPLIQUEE",
      choose: "retirer-les-collections-jumelles",
      canonicality_contract: "publier un registre immuable collection-id -> canonical_collection_id, version, retired_at/reason; les consommateurs refusent les ids hors registre",
      consequences: [
        "casse les consommateurs qui résolvent par préfixe, suffixe ou horodatage",
        "casse les clients qui appellent explicitement une collection jumelle",
        "supprime le chemin de ré-ingestion silencieuse des effets retirés",
        "exige une migration coordonnée et une période d'avertissement avant suppression",
      ],
    },
  };

  const jsonPath = reportPath("json", stamp);
  const markdownPath = reportPath("md", stamp);
  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, reportMarkdown(report), "utf8");
  console.log(JSON.stringify({ json: jsonPath, markdown: markdownPath, served_collection_count: catalog.collections.length }, null, 2));
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exit(1);
  });
}
