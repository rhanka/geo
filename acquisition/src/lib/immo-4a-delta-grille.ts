/**
 * Projection 4a: the grid-density delta already served on qc-zonage becomes
 * a separate, immutable snapshot for immo.  This module deliberately reads
 * only served S3 GeoJSON; it never reaches into work/ artifacts and it never
 * writes a qc-zonage collection.
 */
import { createHash } from "node:crypto";

import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { canonicalizeZoneCodeForJoin } from "@sentropic/geo";

import { BUCKET, getBytes, putBytes, putBytesIfAbsent, s3Client } from "./s3.js";

export const IMMO_4A_SCHEMA_VERSION = "1.0.0";
export const IMMO_4A_OUTPUT_PREFIX = "exports/immo/artefact-4a-delta-grille/v1/";
export const SERVED_ZONAGE_PREFIX = "normalized/ca-qc-zonage/";

type KnownEffet = "densifie" | "reduit" | "stable";
type Effet = KnownEffet | "inconnu";
type Layout = "nested" | "flat";

export interface Immo4aStore {
  list(prefix: string): Promise<string[]>;
  get(key: string): Promise<Buffer | null>;
  putIfAbsent(key: string, body: Buffer): Promise<void>;
  put(key: string, body: Buffer): Promise<void>;
}

export interface VivierB {
  _doc?: string;
  source?: string;
  as_of: string;
  count: number;
  slugs: string[];
}

export interface Immo4aSourceCollection {
  city_slug: string;
  collection: string;
  collection_s3_uri: string;
  selected_layout: Layout;
  object_sha256: string;
  feature_count: number;
}

export interface Immo4aRecord {
  /** Stable for an immo upsert; it is not an immo graph-node identifier. */
  delta_id: string;
  join_key: {
    city_slug: string;
    /** Exact, documented canonicalisation of zone_ref; never fuzzy matching. */
    zone_ref_canon_v1: string;
    /** Exact source surface retained so canonicalisation remains auditable. */
    zone_ref_verbatim: string;
    /** The post-delta grid regulation, never a guessed current regulation. */
    reglement_number: string;
  };
  geo_zone_collection: string;
  geo_zone_code: string;
  effet_densifiant: KnownEffet;
  densite_avant: number;
  densite_avant_millesime: string | null;
  densite_avant_reglement: string | null;
  densite_apres: number;
  densite_apres_millesime: string | null;
  densite_apres_reglement: string;
  /** Zone semantics only.  It is never immo's Signal usage_dominant. */
  geo_zone_usage_dominant: string | null;
  provenance: {
    projection_source: {
      collection_s3_uri: string;
      collection_sha256: string;
      selected_layout: Layout;
      zone_code: string;
    };
    /**
     * La preuve du DELTA lui-même, distincte de celle de la géométrie.
     *
     * `methode` vaut `deduit` quand la densité a été inférée des classes
     * d'habitation autorisées, et `explicit` quand elle a été lue dans une
     * colonne de grille : 80 des 224 deltas des artefacts sont `deduit`, et un
     * consommateur qui annote un procès-verbal doit pouvoir les distinguer et
     * citer la page. `null` tant que la collection servie ne matérialise pas ces
     * champs — ne JAMAIS y remettre la preuve de géométrie ou de règlement à la
     * place, ce serait requalifier une preuve en une autre.
     */
    grid_delta_evidence: {
      methode: string;
      densite_avant_source: string | null;
      densite_apres_source: string | null;
    } | null;
    zone_geometry: {
      zone_source_url: string | null;
      zone_source_level: string | null;
      proof: string | null;
      reglement_url: string | null;
    };
  };
}

export interface EffectCounters {
  collections_total: number;
  collections_known_effect: number;
  collections_unknown_only: number;
  collections_absent: number;
  collections_invalid_only: number;
  features_known_effect: number;
  features_explicit_unknown: number;
  features_effect_absent: number;
  features_invalid: number;
}

export interface Immo4aCoverage {
  served_collections: number;
  b_prime: EffectCounters;
  rest: EffectCounters;
  b_prime_export: {
    cities_with_known_effect: number;
    cities_emitted: number;
    records_emitted: number;
    known_effect_features_unjoinable: number;
    cities_omitted_without_known_effect: number;
  };
}

export interface Immo4aArtifact {
  schema_version: typeof IMMO_4A_SCHEMA_VERSION;
  artifact: "geo-4a-delta-grille";
  complete: true;
  snapshot_id: string;
  generated_at: string;
  scope: {
    id: "immo-vivier-b-20260725";
    as_of: string;
    city_count: number;
    source_repository_path: string;
    source_sha256: string;
  };
  source: {
    producer: "@sentropic/geo";
    served_collection_prefix_s3_uri: string;
    layout_rule: "nested_when_present_else_flat";
    omission_rule: "omit_cities_without_known_effect_and_unjoinable_records";
  };
  coverage: Immo4aCoverage;
  source_collections: Immo4aSourceCollection[];
  records: Immo4aRecord[];
}

export interface BuildImmo4aArtifactOptions {
  store: Pick<Immo4aStore, "list" | "get">;
  vivier: VivierB;
  vivierSha256: string;
  generatedAt: string;
  vivierPath?: string;
  /** Bounded S3 body-read parallelism; defaults conservatively for routine runs. */
  readConcurrency?: number;
}

export interface PublishImmo4aArtifactOptions extends BuildImmo4aArtifactOptions {
  store: Immo4aStore;
  dryRun: boolean;
  outputPrefix?: string;
  verbose?: boolean;
}

export interface PublishImmo4aArtifactResult {
  artifact: Immo4aArtifact;
  snapshotKey: string;
  latestKey: string;
  snapshotUri: string;
  latestUri: string;
  artifactSha256: string;
  artifactBytes: number;
  contentSha256: string;
  unchanged: boolean;
}

interface FeatureLike {
  properties?: unknown;
}

interface FeatureCollectionLike {
  type?: unknown;
  features?: unknown;
}

interface SelectedCollection {
  citySlug: string;
  key: string;
  layout: Layout;
}

interface CollectionScan {
  source: Immo4aSourceCollection;
  group: "known" | "unknown_only" | "absent" | "invalid_only";
  knownEffects: number;
  explicitUnknowns: number;
  absentEffects: number;
  invalidEffects: number;
  records: Immo4aRecord[];
  unjoinableKnown: number;
}

interface MutableCounters extends EffectCounters {}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Canonical JSON value used for content fingerprints and artifact bytes. */
function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort(compareText)) sorted[key] = stableValue(value[key]);
  return sorted;
}

function stableJsonStringify(value: unknown): string {
  const serialized = JSON.stringify(stableValue(value));
  if (serialized === undefined) throw new Error("4a: valeur non sérialisable");
  return serialized;
}

/**
 * Fingerprint of the measured content only.  The publication time and the
 * snapshot label are transport metadata; neither is part of the measurement.
 */
export function immo4aContentSha256(artifact: Immo4aArtifact): string {
  const { generated_at: _generatedAt, snapshot_id: _snapshotId, ...content } = artifact;
  return sha256(stableJsonStringify({
    ...content,
    source_collections: [...content.source_collections].sort(compareSourceCollections),
    records: [...content.records].sort(compareRecords),
  }));
}

/** Keep the consumer-facing JSON readable while making every key order explicit. */
export function serializeImmo4aArtifact(artifact: Immo4aArtifact): Buffer {
  const serialized = JSON.stringify(stableValue(artifact), null, 2);
  if (serialized === undefined) throw new Error("4a: artefact non sérialisable");
  return Buffer.from(`${serialized}\n`, "utf8");
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isKnownEffet(value: unknown): value is KnownEffet {
  return value === "densifie" || value === "reduit" || value === "stable";
}

function isEffet(value: unknown): value is Effet {
  return isKnownEffet(value) || value === "inconnu";
}

function emptyCounters(): MutableCounters {
  return {
    collections_total: 0,
    collections_known_effect: 0,
    collections_unknown_only: 0,
    collections_absent: 0,
    collections_invalid_only: 0,
    features_known_effect: 0,
    features_explicit_unknown: 0,
    features_effect_absent: 0,
    features_invalid: 0,
  };
}

function addScan(counters: MutableCounters, scan: CollectionScan): void {
  counters.collections_total++;
  if (scan.group === "known") counters.collections_known_effect++;
  else if (scan.group === "unknown_only") counters.collections_unknown_only++;
  else if (scan.group === "absent") counters.collections_absent++;
  else counters.collections_invalid_only++;
  counters.features_known_effect += scan.knownEffects;
  counters.features_explicit_unknown += scan.explicitUnknowns;
  counters.features_effect_absent += scan.absentEffects;
  counters.features_invalid += scan.invalidEffects;
}

function servedZoneKey(key: string): SelectedCollection | null {
  const escapedPrefix = SERVED_ZONAGE_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const flat = new RegExp(`^${escapedPrefix}qc-zonage-([a-z0-9-]+)\\.geojson$`).exec(key);
  if (flat) return { citySlug: flat[1]!, key, layout: "flat" };
  const nested = new RegExp(`^${escapedPrefix}qc-zonage-([a-z0-9-]+)\\/qc-zonage-\\1\\.geojson$`).exec(key);
  if (nested) return { citySlug: nested[1]!, key, layout: "nested" };
  return null;
}

/** The OGC API serves nested when both physical layouts exist. */
export function selectServedCollections(keys: readonly string[]): SelectedCollection[] {
  const selected = new Map<string, SelectedCollection>();
  for (const key of keys) {
    const candidate = servedZoneKey(key);
    if (!candidate) continue;
    const previous = selected.get(candidate.citySlug);
    if (!previous || candidate.layout === "nested") selected.set(candidate.citySlug, candidate);
  }
  return [...selected.values()].sort((a, b) => compareText(a.citySlug, b.citySlug));
}

function validateKnownEffect(
  citySlug: string,
  zoneCode: string,
  props: Record<string, unknown>,
): { effet: KnownEffet; before: number; after: number } | null {
  const effet = props["effet_densifiant"];
  if (!isKnownEffet(effet)) return null;
  const before = finiteNumberOrNull(props["densite_avant"]);
  const after = finiteNumberOrNull(props["densite_apres"]);
  if (before === null || after === null) return null;
  const derived: KnownEffet = after > before ? "densifie" : after < before ? "reduit" : "stable";
  if (effet !== derived) {
    throw new Error(
      `4a ${citySlug}/${zoneCode}: effet_densifiant=${effet} contredit densite_avant/apres ${before}->${after} (dérivé=${derived})`,
    );
  }
  return { effet, before, after };
}

function createRecord(
  citySlug: string,
  source: Immo4aSourceCollection,
  props: Record<string, unknown>,
): Immo4aRecord | null {
  const zoneCode = stringOrNull(props["zone_code"]);
  if (!zoneCode) return null;
  const validated = validateKnownEffect(citySlug, zoneCode, props);
  if (!validated) return null;
  // This is deliberately the *after* regulation. `reglement_numero` describes
  // the current served zone and may be a different vintage; falling back would
  // fabricate a bridge to immo's bylaw node.
  const afterReglement = stringOrNull(props["densite_apres_reglement"]);
  const canon = canonicalizeZoneCodeForJoin(zoneCode);
  const afterMillesime = stringOrNull(props["densite_apres_millesime"]);
  // `densite_apres_reglement` has already carried a zone code (Coaticook
  // RD-104). A regex cannot prove a regulation number: require an explicit
  // post vintage and reject a value that is the exact same join code.
  if (
    !afterReglement || !afterMillesime || !canon ||
    canonicalizeZoneCodeForJoin(afterReglement) === canon
  ) return null;
  const beforeMillesime = stringOrNull(props["densite_avant_millesime"]);
  const beforeReglement = stringOrNull(props["densite_avant_reglement"]);
  const usage = stringOrNull(props["usage_dominant"]);
  const methode = stringOrNull(props["effet_densifiant_methode"]);
  const deltaId = sha256(`geo-4a-v1|${citySlug}|${canon}|${afterReglement}`);
  return {
    delta_id: deltaId,
    join_key: {
      city_slug: citySlug,
      zone_ref_canon_v1: canon,
      zone_ref_verbatim: zoneCode,
      reglement_number: afterReglement,
    },
    geo_zone_collection: source.collection,
    geo_zone_code: zoneCode,
    effet_densifiant: validated.effet,
    densite_avant: validated.before,
    densite_avant_millesime: beforeMillesime,
    densite_avant_reglement: beforeReglement,
    densite_apres: validated.after,
    densite_apres_millesime: afterMillesime,
    densite_apres_reglement: afterReglement,
    geo_zone_usage_dominant: usage,
    provenance: {
      projection_source: {
        collection_s3_uri: source.collection_s3_uri,
        collection_sha256: source.object_sha256,
        selected_layout: source.selected_layout,
        zone_code: zoneCode,
      },
      // Seule une méthode RÉELLEMENT servie fait une preuve : sans elle, on
      // laisse `null` plutôt que de supposer `explicit`, qui serait la valeur
      // flatteuse et la seule à ne pas devoir être devinée.
      grid_delta_evidence: methode === null ? null : {
        methode,
        densite_avant_source: stringOrNull(props["densite_avant_source"]),
        densite_apres_source: stringOrNull(props["densite_apres_source"]),
      },
      zone_geometry: {
        zone_source_url: stringOrNull(props["zone_source_url"]),
        zone_source_level: stringOrNull(props["zone_source_level"]),
        proof: stringOrNull(props["proof"]),
        reglement_url: stringOrNull(props["reglement_url"]),
      },
    },
  };
}

function recordFingerprint(record: Immo4aRecord): string {
  const comparable = {
    ...record,
    provenance: {
      ...record.provenance,
      projection_source: {
        ...record.provenance.projection_source,
        // Multipolygons have different feature positions but one source object.
        collection_sha256: "same-source",
      },
    },
  };
  return stableJsonStringify(comparable);
}

const RECORD_SORT_FIELDS = [
  "city_slug",
  "zone_ref_canon_v1",
  "reglement_number",
  "zone_ref_verbatim",
  "delta_id",
] as const;

function compareSourceCollections(a: Immo4aSourceCollection, b: Immo4aSourceCollection): number {
  const city = compareText(a.city_slug, b.city_slug);
  return city !== 0 ? city : compareText(a.collection_s3_uri, b.collection_s3_uri);
}

function compareRecords(a: Immo4aRecord, b: Immo4aRecord): number {
  const aValues = [
    a.join_key.city_slug,
    a.join_key.zone_ref_canon_v1,
    a.join_key.reglement_number,
    a.join_key.zone_ref_verbatim,
    a.delta_id,
  ];
  const bValues = [
    b.join_key.city_slug,
    b.join_key.zone_ref_canon_v1,
    b.join_key.reglement_number,
    b.join_key.zone_ref_verbatim,
    b.delta_id,
  ];
  for (let i = 0; i < RECORD_SORT_FIELDS.length; i++) {
    const compared = compareText(aValues[i]!, bValues[i]!);
    if (compared !== 0) return compared;
  }
  return 0;
}

function dedupeRecords(citySlug: string, records: Immo4aRecord[]): Immo4aRecord[] {
  const byId = new Map<string, Immo4aRecord>();
  for (const record of records) {
    const existing = byId.get(record.delta_id);
    if (!existing) {
      byId.set(record.delta_id, record);
      continue;
    }
    if (recordFingerprint(existing) !== recordFingerprint(record)) {
      throw new Error(
        `4a ${citySlug}/${record.geo_zone_code}: plusieurs polygones portent un delta contradictoire`,
      );
    }
  }
  return [...byId.values()].sort(compareRecords);
}

function parseCollection(key: string, body: Buffer): FeatureLike[] {
  const parsed = JSON.parse(body.toString("utf8")) as FeatureCollectionLike;
  if (parsed.type !== "FeatureCollection" || !Array.isArray(parsed.features)) {
    throw new Error(`4a ${key}: FeatureCollection attendu`);
  }
  return parsed.features as FeatureLike[];
}

function scanCollection(selected: SelectedCollection, body: Buffer): CollectionScan {
  const features = parseCollection(selected.key, body);
  const source: Immo4aSourceCollection = {
    city_slug: selected.citySlug,
    collection: `qc-zonage-${selected.citySlug}`,
    collection_s3_uri: `s3://${BUCKET}/${selected.key}`,
    selected_layout: selected.layout,
    object_sha256: sha256(body),
    feature_count: features.length,
  };

  let knownEffects = 0;
  let explicitUnknowns = 0;
  let absentEffects = 0;
  let invalidEffects = 0;
  const records: Immo4aRecord[] = [];
  let unjoinableKnown = 0;

  for (const feature of features) {
    if (!isRecord(feature) || !isRecord(feature.properties)) {
      absentEffects++;
      continue;
    }
    const props = feature.properties;
    if (!hasOwn(props, "effet_densifiant")) {
      absentEffects++;
      continue;
    }
    const effect = props["effet_densifiant"];
    if (!isEffet(effect)) {
      invalidEffects++;
      continue;
    }
    if (effect === "inconnu") {
      explicitUnknowns++;
      continue;
    }
    const zoneCode = stringOrNull(props["zone_code"]);
    try {
      const record = createRecord(selected.citySlug, source, props);
      const valid = zoneCode ? validateKnownEffect(selected.citySlug, zoneCode, props) : null;
      if (!valid) {
        invalidEffects++;
        continue;
      }
      knownEffects++;
      if (record) records.push(record);
      else unjoinableKnown++;
    } catch (error) {
      // A contradiction is not silently downgraded to unknown. The caller gets
      // a hard failure for an observed claim whose supporting counts disagree.
      throw error;
    }
  }

  const group = knownEffects > 0
    ? "known"
    : explicitUnknowns > 0
      ? "unknown_only"
      : invalidEffects > 0
        ? "invalid_only"
        : "absent";
  return {
    source,
    group,
    knownEffects,
    explicitUnknowns,
    absentEffects,
    invalidEffects,
    records: dedupeRecords(selected.citySlug, records),
    unjoinableKnown,
  };
}

async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

/**
 * Measure every actually served collection, but project only the B' scope.
 * A city with no known effect is omitted: immo already holds its placeholder
 * `inconnu`, and emitting a synthetic zone-level unknown would imply an
 * observation geo did not make.
 */
export async function buildImmo4aArtifact(options: BuildImmo4aArtifactOptions): Promise<Immo4aArtifact> {
  const expected = new Set(options.vivier.slugs);
  if (options.vivier.count !== expected.size) {
    throw new Error(`4a vivier B': count=${options.vivier.count} mais ${expected.size} slugs uniques`);
  }
  const selected = selectServedCollections(await options.store.list(SERVED_ZONAGE_PREFIX));
  if (selected.length >= 100) console.error(`[4a] discovery collections servies: ${selected.length}`);
  const readConcurrency = options.readConcurrency ?? 8;
  if (!Number.isInteger(readConcurrency) || readConcurrency < 1 || readConcurrency > 32) {
    throw new Error(`4a readConcurrency invalide: ${String(readConcurrency)} (attendu 1..32)`);
  }
  let scanned = 0;
  const scans = await mapConcurrent(selected, readConcurrency, async (entry) => {
    const body = await options.store.get(entry.key);
    if (!body) throw new Error(`4a collection disparue après listing: ${entry.key}`);
    const scan = scanCollection(entry, body);
    scanned++;
    if (selected.length >= 100 && (scanned % 100 === 0 || scanned === selected.length)) {
      console.error(`[4a] collections servies lues: ${scanned}/${selected.length}`);
    }
    return scan;
  });

  const bPrime = emptyCounters();
  const rest = emptyCounters();
  const records: Immo4aRecord[] = [];
  const sources: Immo4aSourceCollection[] = [];
  const knownCities = new Set<string>();
  const emittedCities = new Set<string>();
  let unjoinableKnown = 0;

  for (const scan of scans) {
    const inScope = expected.has(scan.source.city_slug);
    addScan(inScope ? bPrime : rest, scan);
    if (!inScope) continue;
    if (scan.knownEffects > 0) knownCities.add(scan.source.city_slug);
    unjoinableKnown += scan.unjoinableKnown;
    if (scan.records.length === 0) continue;
    emittedCities.add(scan.source.city_slug);
    sources.push(scan.source);
    records.push(...scan.records);
  }
  records.sort(compareRecords);
  const uniqueRecords = dedupeRecords("B'", records);
  const idSet = new Set(uniqueRecords.map((record) => record.delta_id));
  if (idSet.size !== uniqueRecords.length) throw new Error("4a: delta_id dupliqué entre villes B'");

  const sourceCollections = sources.sort(compareSourceCollections);
  const artifact: Immo4aArtifact = {
    schema_version: IMMO_4A_SCHEMA_VERSION,
    artifact: "geo-4a-delta-grille",
    complete: true,
    snapshot_id: "",
    generated_at: options.generatedAt,
    scope: {
      id: "immo-vivier-b-20260725",
      as_of: options.vivier.as_of,
      city_count: options.vivier.count,
      source_repository_path: options.vivierPath ?? "acquisition/config/immo-vivier-b-20260725.json",
      source_sha256: options.vivierSha256,
    },
    source: {
      producer: "@sentropic/geo",
      served_collection_prefix_s3_uri: `s3://${BUCKET}/${SERVED_ZONAGE_PREFIX}`,
      layout_rule: "nested_when_present_else_flat",
      omission_rule: "omit_cities_without_known_effect_and_unjoinable_records",
    },
    coverage: {
      served_collections: scans.length,
      b_prime: bPrime,
      rest,
      b_prime_export: {
        cities_with_known_effect: knownCities.size,
        cities_emitted: emittedCities.size,
        records_emitted: uniqueRecords.length,
        known_effect_features_unjoinable: unjoinableKnown,
        cities_omitted_without_known_effect: options.vivier.count - knownCities.size,
      },
    },
    source_collections: sourceCollections,
    records: uniqueRecords,
  };
  artifact.snapshot_id = immo4aContentSha256(artifact).slice(0, 24);
  return artifact;
}

export function immo4aArtifactKeys(snapshotIdValue: string, prefix = IMMO_4A_OUTPUT_PREFIX): {
  snapshotKey: string;
  latestKey: string;
} {
  const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
  if (!normalizedPrefix.startsWith(IMMO_4A_OUTPUT_PREFIX)) {
    throw new Error(`4a output prefix interdit: ${prefix}`);
  }
  return {
    snapshotKey: `${normalizedPrefix}snapshots/${snapshotIdValue}.json`,
    latestKey: `${normalizedPrefix}latest.json`,
  };
}

/** Build then publish snapshot first, and only then move the consumer's latest pointer. */
export async function publishImmo4aArtifact(
  options: PublishImmo4aArtifactOptions,
): Promise<PublishImmo4aArtifactResult> {
  const artifact = await buildImmo4aArtifact(options);
  const body = serializeImmo4aArtifact(artifact);
  const contentSha256 = immo4aContentSha256(artifact);
  const { snapshotKey, latestKey } = immo4aArtifactKeys(artifact.snapshot_id, options.outputPrefix);
  const existingLatestBody = await options.store.get(latestKey);
  if (existingLatestBody !== null) {
    let existing: Immo4aArtifact | null = null;
    try {
      const parsed: unknown = JSON.parse(existingLatestBody.toString("utf8"));
      if (isRecord(parsed) && typeof parsed.snapshot_id === "string" && typeof parsed.generated_at === "string") {
        existing = parsed as unknown as Immo4aArtifact;
      }
    } catch {
      // A malformed latest is not a matching measurement; normal publication
      // below will fail closed at the immutable snapshot boundary if needed.
    }
    if (existing !== null && immo4aContentSha256(existing) === contentSha256) {
      const existingKeys = immo4aArtifactKeys(existing.snapshot_id, options.outputPrefix);
      if (options.verbose) console.error(`[4a] contenu inchangé: unchanged=true, snapshot conservé: ${existingKeys.snapshotKey}`);
      return {
        artifact: existing,
        snapshotKey: existingKeys.snapshotKey,
        latestKey,
        snapshotUri: `s3://${BUCKET}/${existingKeys.snapshotKey}`,
        latestUri: `s3://${BUCKET}/${latestKey}`,
        artifactSha256: sha256(existingLatestBody),
        artifactBytes: existingLatestBody.length,
        contentSha256,
        unchanged: true,
      };
    }
  }
  const result: PublishImmo4aArtifactResult = {
    artifact,
    snapshotKey,
    latestKey,
    snapshotUri: `s3://${BUCKET}/${snapshotKey}`,
    latestUri: `s3://${BUCKET}/${latestKey}`,
    artifactSha256: sha256(body),
    artifactBytes: body.length,
    contentSha256,
    unchanged: false,
  };
  if (!options.dryRun) {
    if (options.verbose) console.error(`[4a] écriture snapshot immuable: ${snapshotKey}`);
    await options.store.putIfAbsent(snapshotKey, body);
    if (options.verbose) console.error(`[4a] écriture latest: ${latestKey}`);
    await options.store.put(latestKey, body);
    if (options.verbose) console.error("[4a] publication terminée");
  }
  return result;
}

/** Production adapter; the boundary remains injectable for network-free tests. */
export function s3Immo4aStore(s3 = s3Client()): Immo4aStore {
  return {
    async list(prefix) {
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const page = await s3.send(new ListObjectsV2Command({
          Bucket: BUCKET,
          Prefix: prefix,
          ContinuationToken: token,
          MaxKeys: 1000,
        }));
        for (const entry of page.Contents ?? []) if (entry.Key) keys.push(entry.Key);
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return keys;
    },
    async get(key) {
      try {
        // A read timeout would turn a transport failure into a false absence
        // measurement.  Let the SDK's retry policy and the caller's lifecycle
        // govern the read; publication fails closed on any returned error.
        return await getBytes(s3, key);
      } catch (error) {
        const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
        if (status === 404 || (error as { name?: string })?.name === "NotFound") return null;
        throw error;
      }
    },
    async put(key, body) {
      await putBytes(s3, key, body, "application/json");
    },
    async putIfAbsent(key, body) {
      await putBytesIfAbsent(s3, key, body, "application/json");
    },
  };
}
