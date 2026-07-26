/**
 * Immutable, consumer-verifiable catalogue of the data Geo actually serves.
 *
 * This is deliberately a read-only observer of served objects.  It never
 * writes `normalized/`; publication is restricted to its own contract prefix.
 * In particular, a failed list/read/parse/revalidation is an error, never a
 * measurement of absence.
 */
import { createHash } from "node:crypto";

import {
  GetObjectCommand,
  ListObjectsV2Command,
  type S3Client,
} from "@aws-sdk/client-s3";
import { canonicalizeZoneCodeForJoin } from "@sentropic/geo";

// Les écritures passent par le helper générique : une garde du dépôt exige que
// les PUT bruts restent confinés à `lib/s3.ts` et au gate de preuve, et elle a
// eu raison de se déclencher sur ce fichier.
import { BUCKET, putBytesIfAbsent, putBytesIfMatch } from "./s3.js";
import {
  assertServedZoneGeojson,
  isRealGeometryUrl,
  ZONE_SOURCE_LEVELS,
  type ServedZoneGeoJson,
} from "./zonage-proof.js";
import { selectServedZoneCollections, type ServedZoneCollection } from "./zone-provenance-quality.js";

export const GEO_SERVED_CONTRACT_SCHEMA_VERSION = "1.0.0";
export const GEO_SERVED_CONTRACT_PREFIX = "exports/immo/geo-served-contract/v1/";
export const SERVED_ZONAGE_PREFIX = "normalized/ca-qc-zonage/";
export const PV_INDEX_PREFIX = "registry/qc-pv/";
export const IMMO_4A_PREFIX = "exports/immo/artefact-4a-delta-grille/v1/";
export const IMMO_4A_LATEST_KEY = `${IMMO_4A_PREFIX}latest.json`;

export interface ListedObject {
  key: string;
  etag: string | null;
  last_modified: string | null;
  size: number | null;
}

export interface ReadObject {
  bytes: Buffer;
  etag: string | null;
  size: number | null;
}

/** S3 boundary: injectable so the contract can be fully tested without network. */
export interface GeoServedContractStore {
  list(prefix: string): Promise<ListedObject[]>;
  read(key: string): Promise<ReadObject | null>;
  /** True only if this call created the object; false means it already existed. */
  putIfAbsent(key: string, body: Buffer): Promise<boolean>;
  /** Compare-and-swap the mutable pointer.  A concurrent writer must fail closed. */
  putLatestIfCurrent(key: string, body: Buffer, priorEtag: string | null): Promise<void>;
}

export interface ContractRegistry {
  path: string;
  sha256: `sha256:${string}`;
  city_slugs: readonly string[];
}

export interface ContractCanonicalizer {
  id: "zone_ref_canon_v1";
  implementation_path: string;
  implementation_sha256: `sha256:${string}`;
}

type ValueState = "known" | "explicit_unknown" | "absent" | "invalid";
export interface ValuePartition {
  known: number;
  explicit_unknown: number;
  absent: number;
  invalid: number;
}

export interface JoinKeyPartition extends ValuePartition {
  /** A valid and non-colliding triad.  See canonical_collisions. */
  joinable: number;
  /** Features whose otherwise valid triad is ambiguous across verbatim zone codes. */
  blocked_canonical_collision: number;
}

export interface CityFieldCoverage {
  zone_code: ValuePartition;
  zone_ref_canon_v1: ValuePartition;
  reglement_number: ValuePartition;
  reglement_millesime: ValuePartition;
  usage_dominant: ValuePartition;
  zone_source_url: ValuePartition;
  zone_source_level: ValuePartition;
}

/** A closed city partition for a property.  `complete` means every feature in
 * the selected served collection has a semantically known value; it never
 * includes `explicit_unknown`, a missing property, or an invalid value. */
export interface CityValuePartition {
  complete: number;
  incomplete: number;
  explicit_unknown: number;
  absent: number;
  invalid: number;
  absent_collection: number;
}

export type CityFieldPartitions = { [K in keyof CityFieldCoverage]: CityValuePartition };

export interface ServedCityObservation {
  city_slug: string;
  state: "served" | "absent" | "invalid";
  collection: {
    collection: string;
    collection_s3_uri: string;
    selected_layout: "flat" | "nested";
    selected_object_sha256: `sha256:${string}`;
    listed_etag: string | null;
    listed_last_modified: string | null;
    listed_size: number | null;
    shadowed_layouts: Array<{
      key: string;
      s3_uri: string;
      etag: string | null;
      last_modified: string | null;
      size: number | null;
    }>;
  } | null;
  feature_count: number;
  fields: CityFieldCoverage;
  join_key: JoinKeyPartition & {
    canonical_collisions: Array<{
      zone_ref_canon_v1: string;
      reglement_number: string;
      zone_ref_verbatim: string[];
    }>;
  };
  /** Structural validation only: it deliberately does not claim capture-verified v2. */
  served_geometry_proof_shape: "structurally_valid" | "absent" | "invalid";
}

export interface PvIndexCityObservation {
  city_slug: string;
  state: "present_valid_index" | "absent" | "invalid_index";
  index: {
    s3_uri: string;
    object_sha256: `sha256:${string}`;
    listed_etag: string | null;
    listed_last_modified: string | null;
    listed_size: number | null;
  } | null;
}

export interface Immo4aObservation {
  state: "present_verified_snapshot" | "absent" | "invalid";
  latest_s3_uri: string;
  snapshot_s3_uri: string | null;
  snapshot_id: string | null;
  snapshot_sha256: `sha256:${string}` | null;
  /** The latest bytes are compared with the named immutable snapshot. */
  latest_matches_snapshot: boolean;
  reason: string | null;
}

export interface GeoServedContractManifest {
  schema_version: typeof GEO_SERVED_CONTRACT_SCHEMA_VERSION;
  contract: "geo-served-contract";
  /** Complete means every observation below was read, parsed and revalidated; not that data coverage is 100%. */
  complete: true;
  generated_at: string;
  producer: "@sentropic/geo";
  registry: {
    path: string;
    sha256: `sha256:${string}`;
    city_count: number;
  };
  canonicalizer: ContractCanonicalizer;
  serving: {
    qc_zonage_prefix_s3_uri: string;
    selection_rule: "nested_when_present_else_flat";
    collection_name: "qc-zonage-<city_slug>";
    stable_join_key: {
      fields: ["city_slug", "zone_ref_canon_v1", "reglement_number"];
      city_slug: "committed 1,106-city registry slug";
      zone_ref_verbatim: "feature.properties.zone_code";
      zone_ref_canon_v1: "canonicalizeZoneCodeForJoin(feature.properties.zone_code)";
      reglement_number: "feature.properties.reglement_numero";
      uniqueness: "joinable excludes a collision of the full triad; inspect canonical_collisions and preserve zone_ref_verbatim";
    };
    field_semantics: {
      reglement_millesime: "feature.properties.reglement_millesime; business vintage, never publication time";
      provenance: "zone_source_url and zone_source_level describe zone geometry provenance; served_geometry_proof_shape is structural only";
      usage_dominant: "feature.properties.usage_dominant on a Geo zone; it is not an Immo Signal usage_dominant";
    };
  };
  qc_zonage: {
    cities: ServedCityObservation[];
    coverage: {
      city_partition: { served: number; absent: number; invalid: number };
      feature_count: number;
      fields: CityFieldCoverage;
      fields_by_city: CityFieldPartitions;
      join_key: Omit<JoinKeyPartition, "canonical_collisions"> & { canonical_collision_count: number };
      served_geometry_proof_shape: { structurally_valid: number; absent: number; invalid: number };
      unregistered_collections: Array<{
        city_slug: string;
        key: string;
        etag: string | null;
        last_modified: string | null;
        size: number | null;
      }>;
    };
  };
  artefacts: {
    geo_4a_delta_grille: Immo4aObservation;
  };
  pv: {
    kind: "index_only";
    index_prefix_s3_uri: string;
    bytes_of_pv_documents: "not_served";
    cities: PvIndexCityObservation[];
    coverage: {
      present_valid_index: number;
      absent: number;
      invalid_index: number;
      unregistered_index_keys: Array<{
        city_slug: string;
        key: string;
        etag: string | null;
        last_modified: string | null;
        size: number | null;
      }>;
    };
  };
}

export interface BuildGeoServedContractOptions {
  store: Pick<GeoServedContractStore, "list" | "read">;
  registry: ContractRegistry;
  canonicalizer: ContractCanonicalizer;
  generatedAt: string;
  readConcurrency?: number;
}

export interface PublishGeoServedContractOptions extends BuildGeoServedContractOptions {
  store: GeoServedContractStore;
  dryRun: boolean;
  outputPrefix?: string;
}

export interface PublishGeoServedContractResult {
  manifest: GeoServedContractManifest;
  manifestSha256: `sha256:${string}`;
  snapshotKey: string;
  latestKey: string;
  snapshotUri: string;
  latestUri: string;
}

interface FeatureLike { properties?: unknown }
interface FeatureCollectionLike { type?: unknown; features?: unknown }

function sha256(bytes: Buffer | string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function emptyPartition(): ValuePartition {
  return { known: 0, explicit_unknown: 0, absent: 0, invalid: 0 };
}

function emptyFields(): CityFieldCoverage {
  return {
    zone_code: emptyPartition(),
    zone_ref_canon_v1: emptyPartition(),
    reglement_number: emptyPartition(),
    reglement_millesime: emptyPartition(),
    usage_dominant: emptyPartition(),
    zone_source_url: emptyPartition(),
    zone_source_level: emptyPartition(),
  };
}

function emptyCityValuePartition(): CityValuePartition {
  return { complete: 0, incomplete: 0, explicit_unknown: 0, absent: 0, invalid: 0, absent_collection: 0 };
}

function emptyCityFieldPartitions(): CityFieldPartitions {
  return {
    zone_code: emptyCityValuePartition(),
    zone_ref_canon_v1: emptyCityValuePartition(),
    reglement_number: emptyCityValuePartition(),
    reglement_millesime: emptyCityValuePartition(),
    usage_dominant: emptyCityValuePartition(),
    zone_source_url: emptyCityValuePartition(),
    zone_source_level: emptyCityValuePartition(),
  };
}

function emptyJoinPartition(): JoinKeyPartition {
  return { ...emptyPartition(), joinable: 0, blocked_canonical_collision: 0 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isExplicitUnknown(value: unknown): boolean {
  return value === null || (typeof value === "string" && /^(?:inconnu|unknown)$/i.test(value.trim()));
}

function classifyProperty(
  props: Record<string, unknown> | null,
  key: string,
  isKnown: (value: unknown) => boolean,
): ValueState {
  if (!props || !hasOwn(props, key)) return "absent";
  const value = props[key];
  if (isExplicitUnknown(value)) return "explicit_unknown";
  return isKnown(value) ? "known" : "invalid";
}

function increment(partition: ValuePartition, state: ValueState): void {
  partition[state]++;
}

function partitionTotal(partition: ValuePartition): number {
  return partition.known + partition.explicit_unknown + partition.absent + partition.invalid;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function scalar(value: unknown): boolean {
  return nonEmptyString(value) || (typeof value === "number" && Number.isFinite(value));
}

function validZoneCode(value: unknown): boolean {
  return nonEmptyString(value) && canonicalizeZoneCodeForJoin(value).length > 0;
}

function validSourceLevel(value: unknown): boolean {
  return typeof value === "string" && ZONE_SOURCE_LEVELS.has(value as never);
}

function cityAbsent(slug: string): ServedCityObservation {
  return {
    city_slug: slug,
    state: "absent",
    collection: null,
    feature_count: 0,
    fields: emptyFields(),
    join_key: { ...emptyJoinPartition(), canonical_collisions: [] },
    served_geometry_proof_shape: "absent",
  };
}

function selectedIdentity(
  key: string,
  listed: ReadonlyMap<string, ListedObject>,
): { etag: string | null; last_modified: string | null; size: number | null } {
  const entry = listed.get(key);
  if (!entry) throw new Error(`contract: clé sélectionnée absente du listing: ${key}`);
  return { etag: entry.etag, last_modified: entry.last_modified, size: entry.size };
}

function invalidCity(
  selection: ServedZoneCollection,
  listed: ReadonlyMap<string, ListedObject>,
  bytes: Buffer,
): ServedCityObservation {
  const identity = selectedIdentity(selection.key, listed);
  return {
    city_slug: selection.slug,
    state: "invalid",
    collection: {
      collection: `qc-zonage-${selection.slug}`,
      collection_s3_uri: `s3://${BUCKET}/${selection.key}`,
      selected_layout: selection.layout,
      selected_object_sha256: sha256(bytes),
      listed_etag: identity.etag,
      listed_last_modified: identity.last_modified,
      listed_size: identity.size,
      shadowed_layouts: selection.alternatives.map((key) => ({ key, s3_uri: `s3://${BUCKET}/${key}`, ...selectedIdentity(key, listed) })),
    },
    feature_count: 0,
    fields: emptyFields(),
    join_key: { ...emptyJoinPartition(), canonical_collisions: [] },
    served_geometry_proof_shape: "invalid",
  };
}

function scanServedCity(
  selection: ServedZoneCollection,
  listed: ReadonlyMap<string, ListedObject>,
  bytes: Buffer,
): ServedCityObservation {
  let parsed: FeatureCollectionLike;
  try {
    parsed = JSON.parse(bytes.toString("utf8")) as FeatureCollectionLike;
  } catch {
    return invalidCity(selection, listed, bytes);
  }
  if (parsed.type !== "FeatureCollection" || !Array.isArray(parsed.features) || parsed.features.length === 0) {
    return invalidCity(selection, listed, bytes);
  }

  const fields = emptyFields();
  const join = emptyJoinPartition();
  const joinCandidates: Array<{ zone_ref_canon_v1: string; reglement_number: string; zone_ref_verbatim: string }> = [];
  for (const feature of parsed.features as FeatureLike[]) {
    const props = isRecord(feature) && isRecord(feature.properties) ? feature.properties : null;
    const zoneCode = classifyProperty(props, "zone_code", validZoneCode);
    const canonical = zoneCode === "known" ? canonicalizeZoneCodeForJoin(props!["zone_code"]) : "";
    const regulation = classifyProperty(props, "reglement_numero", scalar);
    increment(fields.zone_code, zoneCode);
    increment(fields.zone_ref_canon_v1, canonical ? "known" : zoneCode);
    increment(fields.reglement_number, regulation);
    increment(fields.reglement_millesime, classifyProperty(props, "reglement_millesime", scalar));
    increment(fields.usage_dominant, classifyProperty(props, "usage_dominant", nonEmptyString));
    increment(fields.zone_source_url, classifyProperty(props, "zone_source_url", isRealGeometryUrl));
    increment(fields.zone_source_level, classifyProperty(props, "zone_source_level", validSourceLevel));

    const joinState: ValueState = zoneCode === "invalid" || regulation === "invalid"
      ? "invalid"
      : zoneCode === "known" && regulation === "known"
        ? "known"
        : zoneCode === "explicit_unknown" || regulation === "explicit_unknown"
          ? "explicit_unknown"
          : "absent";
    increment(join, joinState);
    if (joinState === "known" && props && nonEmptyString(props["zone_code"])) {
      joinCandidates.push({
        zone_ref_canon_v1: canonical,
        reglement_number: String(props["reglement_numero"]).trim(),
        zone_ref_verbatim: props["zone_code"].trim(),
      });
    }
  }
  const candidatesByTriad = new Map<string, { zone_ref_canon_v1: string; reglement_number: string; verbatim: Set<string> }>();
  for (const candidate of joinCandidates) {
    const key = `${candidate.zone_ref_canon_v1}\u0000${candidate.reglement_number}`;
    const observed = candidatesByTriad.get(key) ?? { zone_ref_canon_v1: candidate.zone_ref_canon_v1, reglement_number: candidate.reglement_number, verbatim: new Set<string>() };
    observed.verbatim.add(candidate.zone_ref_verbatim);
    candidatesByTriad.set(key, observed);
  }
  const collidingTriads = new Set([...candidatesByTriad.entries()].filter(([, value]) => value.verbatim.size > 1).map(([key]) => key));
  const canonicalCollisions = [...candidatesByTriad.entries()]
    .filter(([, value]) => value.verbatim.size > 1)
    .map(([, value]) => ({ zone_ref_canon_v1: value.zone_ref_canon_v1, reglement_number: value.reglement_number, zone_ref_verbatim: [...value.verbatim].sort() }))
    .sort((left, right) => `${left.zone_ref_canon_v1}\u0000${left.reglement_number}`.localeCompare(`${right.zone_ref_canon_v1}\u0000${right.reglement_number}`));
  join.blocked_canonical_collision = joinCandidates.filter((candidate) => collidingTriads.has(`${candidate.zone_ref_canon_v1}\u0000${candidate.reglement_number}`)).length;
  join.joinable = join.known - join.blocked_canonical_collision;
  const identity = selectedIdentity(selection.key, listed);
  let proofShape: ServedCityObservation["served_geometry_proof_shape"];
  if (!isRecord(parsed) || !("proof" in parsed)) proofShape = "absent";
  else {
    try {
      assertServedZoneGeojson(selection.key, parsed as unknown as ServedZoneGeoJson);
      proofShape = "structurally_valid";
    } catch {
      proofShape = "invalid";
    }
  }
  return {
    city_slug: selection.slug,
    state: "served",
    collection: {
      collection: `qc-zonage-${selection.slug}`,
      collection_s3_uri: `s3://${BUCKET}/${selection.key}`,
      selected_layout: selection.layout,
      selected_object_sha256: sha256(bytes),
      listed_etag: identity.etag,
      listed_last_modified: identity.last_modified,
      listed_size: identity.size,
      shadowed_layouts: selection.alternatives.map((key) => ({ key, s3_uri: `s3://${BUCKET}/${key}`, ...selectedIdentity(key, listed) })),
    },
    feature_count: parsed.features.length,
    fields,
    join_key: { ...join, canonical_collisions: canonicalCollisions },
    served_geometry_proof_shape: proofShape,
  };
}

function addPartition(target: ValuePartition, source: ValuePartition): void {
  target.known += source.known;
  target.explicit_unknown += source.explicit_unknown;
  target.absent += source.absent;
  target.invalid += source.invalid;
}

function addFields(target: CityFieldCoverage, source: CityFieldCoverage): void {
  for (const key of Object.keys(target) as Array<keyof CityFieldCoverage>) addPartition(target[key], source[key]);
}

function assertPartition(label: string, partition: ValuePartition, expected: number): void {
  if (partitionTotal(partition) !== expected) {
    throw new Error(`contract: partition ${label}=${partitionTotal(partition)} ne ferme pas sur ${expected}`);
  }
}

function aggregateZonage(cities: readonly ServedCityObservation[], unregistered: GeoServedContractManifest["qc_zonage"]["coverage"]["unregistered_collections"]) {
  const cityPartition = { served: 0, absent: 0, invalid: 0 };
  const fields = emptyFields();
  const fieldsByCity = emptyCityFieldPartitions();
  const join = emptyJoinPartition();
  let featureCount = 0;
  let canonicalCollisionCount = 0;
  const proofShape = { structurally_valid: 0, absent: 0, invalid: 0 };
  for (const city of cities) {
    cityPartition[city.state]++;
    featureCount += city.feature_count;
    addFields(fields, city.fields);
    for (const field of Object.keys(fieldsByCity) as Array<keyof CityFieldCoverage>) {
      const partition = city.fields[field];
      const target = fieldsByCity[field];
      if (city.state === "absent") target.absent_collection++;
      else if (city.state === "invalid") target.invalid++;
      else if (partition.known === city.feature_count) target.complete++;
      else if (partition.invalid > 0) target.invalid++;
      else if (partition.known > 0) target.incomplete++;
      else if (partition.explicit_unknown > 0) target.explicit_unknown++;
      else target.absent++;
    }
    addPartition(join, city.join_key);
    join.joinable += city.join_key.joinable;
    join.blocked_canonical_collision += city.join_key.blocked_canonical_collision;
    canonicalCollisionCount += city.join_key.canonical_collisions.length;
    proofShape[city.served_geometry_proof_shape]++;
    for (const [field, partition] of Object.entries(city.fields)) assertPartition(`${city.city_slug}.${field}`, partition, city.feature_count);
    assertPartition(`${city.city_slug}.join_key`, city.join_key, city.feature_count);
    if (city.join_key.joinable + city.join_key.blocked_canonical_collision !== city.join_key.known) {
      throw new Error(`contract: jointures ${city.city_slug} ne ferment pas sur les triades connues`);
    }
  }
  if (cityPartition.served + cityPartition.absent + cityPartition.invalid !== cities.length) {
    throw new Error("contract: partition villes qc-zonage non fermée");
  }
  for (const [field, partition] of Object.entries(fields)) assertPartition(`aggregate.${field}`, partition, featureCount);
  for (const [field, partition] of Object.entries(fieldsByCity)) {
    const total = partition.complete + partition.incomplete + partition.explicit_unknown + partition.absent + partition.invalid + partition.absent_collection;
    if (total !== cities.length) throw new Error(`contract: partition villes ${field}=${total} ne ferme pas sur ${cities.length}`);
  }
  assertPartition("aggregate.join_key", join, featureCount);
  if (join.joinable + join.blocked_canonical_collision !== join.known) {
    throw new Error("contract: jointures agrégées ne ferment pas sur les triades connues");
  }
  return {
    city_partition: cityPartition,
    feature_count: featureCount,
    fields,
    fields_by_city: fieldsByCity,
    join_key: { ...join, canonical_collision_count: canonicalCollisionCount },
    served_geometry_proof_shape: proofShape,
    unregistered_collections: unregistered,
  };
}

function pvIndexSlug(key: string): string | null {
  const match = /^registry\/qc-pv\/([a-z0-9-]+)\/index\.json$/.exec(key);
  return match?.[1] ?? null;
}

function isValidIndex(bytes: Buffer): boolean {
  try {
    const root = JSON.parse(bytes.toString("utf8"));
    if (!isRecord(root) || !Array.isArray(root["entries"])) return false;
    return root["entries"].every((entry) => {
      if (!isRecord(entry) || !nonEmptyString(entry["url"])) return false;
      try {
        const url = new URL(entry["url"]);
        return url.protocol === "https:" || url.protocol === "http:";
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

/** A post-listing GET must be the object we listed.  Otherwise a replace then
 * restore race could pair an old ETag with bytes from a different object. */
function assertReadMatchesListing(key: string, listed: ListedObject, read: ReadObject): void {
  if (listed.etag === null || read.etag === null || listed.etag !== read.etag) {
    throw new Error(`contract: identité ETag incohérente après listing: ${key}`);
  }
  if (listed.size === null || read.size === null || listed.size !== read.size) {
    throw new Error(`contract: taille incohérente après listing: ${key}`);
  }
}

function listingFingerprint(entries: readonly ListedObject[]): string {
  return canonicalJson(entries
    .map(({ key, etag, last_modified, size }) => ({ key, etag, last_modified, size }))
    .sort((left, right) => left.key.localeCompare(right.key)));
}

async function mapConcurrent<T, R>(items: readonly T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(items.length, concurrency) }, worker));
  return results;
}

function ensureRegistry(registry: ContractRegistry): void {
  if (!/^sha256:[a-f0-9]{64}$/.test(registry.sha256)) throw new Error("contract: hash registre invalide");
  if (registry.city_slugs.length === 0) throw new Error("contract: registre vide");
  const seen = new Set<string>();
  for (const slug of registry.city_slugs) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug) || seen.has(slug)) throw new Error(`contract: slug registre invalide/dupliqué: ${slug}`);
    seen.add(slug);
  }
}

function immo4aSnapshotKey(snapshotId: string): string {
  if (!/^[a-f0-9]{24}$/.test(snapshotId)) throw new Error(`contract: snapshot_id 4a invalide: ${snapshotId}`);
  return `${IMMO_4A_PREFIX}snapshots/${snapshotId}.json`;
}

async function observe4a(store: Pick<GeoServedContractStore, "read">): Promise<Immo4aObservation> {
  const latestUri = `s3://${BUCKET}/${IMMO_4A_LATEST_KEY}`;
  const latest = await store.read(IMMO_4A_LATEST_KEY);
  if (!latest) return { state: "absent", latest_s3_uri: latestUri, snapshot_s3_uri: null, snapshot_id: null, snapshot_sha256: null, latest_matches_snapshot: false, reason: null };
  let snapshotId: string;
  try {
    const parsed = JSON.parse(latest.bytes.toString("utf8")) as { schema_version?: unknown; artifact?: unknown; complete?: unknown; snapshot_id?: unknown };
    if (parsed.schema_version !== "1.0.0" || parsed.artifact !== "geo-4a-delta-grille" || parsed.complete !== true || typeof parsed.snapshot_id !== "string") {
      throw new Error("latest 4a ne respecte pas le schéma contractuel");
    }
    snapshotId = parsed.snapshot_id;
  } catch (error) {
    return { state: "invalid", latest_s3_uri: latestUri, snapshot_s3_uri: null, snapshot_id: null, snapshot_sha256: null, latest_matches_snapshot: false, reason: error instanceof Error ? error.message : String(error) };
  }
  let snapshotKey: string;
  try {
    snapshotKey = immo4aSnapshotKey(snapshotId);
  } catch (error) {
    return { state: "invalid", latest_s3_uri: latestUri, snapshot_s3_uri: null, snapshot_id: snapshotId, snapshot_sha256: null, latest_matches_snapshot: false, reason: error instanceof Error ? error.message : String(error) };
  }
  const snapshot = await store.read(snapshotKey);
  if (!snapshot) return { state: "invalid", latest_s3_uri: latestUri, snapshot_s3_uri: `s3://${BUCKET}/${snapshotKey}`, snapshot_id: snapshotId, snapshot_sha256: null, latest_matches_snapshot: false, reason: "snapshot 4a absent" };
  const equal = latest.bytes.equals(snapshot.bytes);
  return {
    state: equal ? "present_verified_snapshot" : "invalid",
    latest_s3_uri: latestUri,
    snapshot_s3_uri: `s3://${BUCKET}/${snapshotKey}`,
    snapshot_id: snapshotId,
    snapshot_sha256: sha256(snapshot.bytes),
    latest_matches_snapshot: equal,
    reason: equal ? null : "latest 4a et snapshot immuable différents",
  };
}

/**
 * Build a complete observation.  There is intentionally no read timeout here:
 * a timeout would turn a transport failure into a false absence measurement.
 */
export async function buildGeoServedContract(options: BuildGeoServedContractOptions): Promise<GeoServedContractManifest> {
  ensureRegistry(options.registry);
  if (options.canonicalizer.id !== "zone_ref_canon_v1" || !/^sha256:[a-f0-9]{64}$/.test(options.canonicalizer.implementation_sha256)) {
    throw new Error("contract: définition canonicalizer invalide");
  }
  if (Number.isNaN(Date.parse(options.generatedAt))) throw new Error(`contract: generated_at invalide: ${options.generatedAt}`);
  const concurrency = options.readConcurrency ?? 8;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) throw new Error("contract: readConcurrency attendu 1..32");

  const [zonageListing, pvListing] = await Promise.all([
    options.store.list(SERVED_ZONAGE_PREFIX),
    options.store.list(PV_INDEX_PREFIX),
  ]);
  const zonageFingerprint = listingFingerprint(zonageListing);
  const pvFingerprint = listingFingerprint(pvListing);
  const zonageByKey = new Map(zonageListing.map((entry) => [entry.key, entry]));
  const registrySlugs = [...options.registry.city_slugs].sort();
  const knownSlugs = new Set(registrySlugs);
  const selected = selectServedZoneCollections(zonageListing.map((entry) => entry.key));
  const selectedBySlug = new Map(selected.map((entry) => [entry.slug, entry]));
  const unregisteredCollections = selected
    .filter((entry) => !knownSlugs.has(entry.slug))
    .map((entry) => {
      const identity = selectedIdentity(entry.key, zonageByKey);
      return { city_slug: entry.slug, key: entry.key, ...identity };
    });
  const servedCities = await mapConcurrent(registrySlugs, concurrency, async (slug) => {
    const selection = selectedBySlug.get(slug);
    if (!selection) return cityAbsent(slug);
    const object = await options.store.read(selection.key);
    if (!object) throw new Error(`contract: collection disparue après listing: ${selection.key}`);
    assertReadMatchesListing(selection.key, zonageByKey.get(selection.key)!, object);
    return scanServedCity(selection, zonageByKey, object.bytes);
  });

  const pvBySlug = new Map<string, ListedObject>();
  const unregisteredIndexKeys: GeoServedContractManifest["pv"]["coverage"]["unregistered_index_keys"] = [];
  for (const entry of pvListing) {
    const slug = pvIndexSlug(entry.key);
    if (!slug) continue;
    if (!knownSlugs.has(slug)) unregisteredIndexKeys.push({ city_slug: slug, key: entry.key, etag: entry.etag, last_modified: entry.last_modified, size: entry.size });
    else if (pvBySlug.has(slug)) throw new Error(`contract: index PV dupliqué pour ${slug}`);
    else pvBySlug.set(slug, entry);
  }
  const pvCities = await mapConcurrent(registrySlugs, concurrency, async (slug): Promise<PvIndexCityObservation> => {
    const entry = pvBySlug.get(slug);
    if (!entry) return { city_slug: slug, state: "absent", index: null };
    const object = await options.store.read(entry.key);
    if (!object) throw new Error(`contract: index PV disparu après listing: ${entry.key}`);
    assertReadMatchesListing(entry.key, entry, object);
    const state = isValidIndex(object.bytes) ? "present_valid_index" : "invalid_index";
    return {
      city_slug: slug,
      state,
      index: {
        s3_uri: `s3://${BUCKET}/${entry.key}`,
        object_sha256: sha256(object.bytes),
        listed_etag: entry.etag,
        listed_last_modified: entry.last_modified,
        listed_size: entry.size,
      },
    };
  });
  const artefact4a = await observe4a(options.store);

  // Reject a mixed list/read view.  These second listings are deliberately not
  // timed out; an incomplete observation must never become a publication.
  const [zonageListingAfter, pvListingAfter] = await Promise.all([
    options.store.list(SERVED_ZONAGE_PREFIX),
    options.store.list(PV_INDEX_PREFIX),
  ]);
  if (listingFingerprint(zonageListingAfter) !== zonageFingerprint || listingFingerprint(pvListingAfter) !== pvFingerprint) {
    throw new Error("contract: listing S3 a changé pendant la lecture; publication refusée");
  }

  const zonageCoverage = aggregateZonage(servedCities, unregisteredCollections);
  const pvCoverage = {
    present_valid_index: pvCities.filter((city) => city.state === "present_valid_index").length,
    absent: pvCities.filter((city) => city.state === "absent").length,
    invalid_index: pvCities.filter((city) => city.state === "invalid_index").length,
    unregistered_index_keys: unregisteredIndexKeys.sort((left, right) => left.key.localeCompare(right.key)),
  };
  if (pvCoverage.present_valid_index + pvCoverage.absent + pvCoverage.invalid_index !== registrySlugs.length) {
    throw new Error("contract: partition indices PV non fermée");
  }
  return {
    schema_version: GEO_SERVED_CONTRACT_SCHEMA_VERSION,
    contract: "geo-served-contract",
    complete: true,
    generated_at: options.generatedAt,
    producer: "@sentropic/geo",
    registry: { path: options.registry.path, sha256: options.registry.sha256, city_count: registrySlugs.length },
    canonicalizer: options.canonicalizer,
    serving: {
      qc_zonage_prefix_s3_uri: `s3://${BUCKET}/${SERVED_ZONAGE_PREFIX}`,
      selection_rule: "nested_when_present_else_flat",
      collection_name: "qc-zonage-<city_slug>",
      stable_join_key: {
        fields: ["city_slug", "zone_ref_canon_v1", "reglement_number"],
        city_slug: "committed 1,106-city registry slug",
        zone_ref_verbatim: "feature.properties.zone_code",
        zone_ref_canon_v1: "canonicalizeZoneCodeForJoin(feature.properties.zone_code)",
        reglement_number: "feature.properties.reglement_numero",
        uniqueness: "joinable excludes a collision of the full triad; inspect canonical_collisions and preserve zone_ref_verbatim",
      },
      field_semantics: {
        reglement_millesime: "feature.properties.reglement_millesime; business vintage, never publication time",
        provenance: "zone_source_url and zone_source_level describe zone geometry provenance; served_geometry_proof_shape is structural only",
        usage_dominant: "feature.properties.usage_dominant on a Geo zone; it is not an Immo Signal usage_dominant",
      },
    },
    qc_zonage: { cities: servedCities, coverage: zonageCoverage },
    artefacts: { geo_4a_delta_grille: artefact4a },
    pv: {
      kind: "index_only",
      index_prefix_s3_uri: `s3://${BUCKET}/${PV_INDEX_PREFIX}`,
      bytes_of_pv_documents: "not_served",
      cities: pvCities,
      coverage: pvCoverage,
    },
  };
}

/** RFC 8785-like deterministic JSON for this data domain: sorted object keys,
 * array order preserved, no whitespace.  The manifest rejects non-finite data
 * before this serializer is called. */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("contract: JSON canonique refuse un nombre non fini");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new Error(`contract: JSON canonique refuse ${typeof value}`);
}

export function geoServedContractKeys(manifestSha256: `sha256:${string}`, prefix = GEO_SERVED_CONTRACT_PREFIX): { snapshotKey: string; latestKey: string } {
  const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
  if (!normalizedPrefix.startsWith(GEO_SERVED_CONTRACT_PREFIX)) throw new Error(`contract: préfixe de sortie interdit: ${prefix}`);
  const digest = manifestSha256.slice("sha256:".length);
  return { snapshotKey: `${normalizedPrefix}snapshots/${digest}.json`, latestKey: `${normalizedPrefix}latest.json` };
}

/** Snapshot first, then a CAS-protected pointer.  A write failure cannot move latest. */
export async function publishGeoServedContract(options: PublishGeoServedContractOptions): Promise<PublishGeoServedContractResult> {
  const manifest = await buildGeoServedContract(options);
  const bytes = Buffer.from(`${canonicalJson(manifest)}\n`, "utf8");
  const manifestSha256 = sha256(bytes);
  const { snapshotKey, latestKey } = geoServedContractKeys(manifestSha256, options.outputPrefix);
  const snapshotUri = `s3://${BUCKET}/${snapshotKey}`;
  const latestUri = `s3://${BUCKET}/${latestKey}`;
  if (!options.dryRun) {
    const wrote = await options.store.putIfAbsent(snapshotKey, bytes);
    if (!wrote) {
      const existing = await options.store.read(snapshotKey);
      if (!existing || !existing.bytes.equals(bytes)) throw new Error(`contract: collision snapshot immuable: ${snapshotKey}`);
    }
    const previous = await options.store.read(latestKey);
    const pointer = Buffer.from(`${canonicalJson({
      schema_version: GEO_SERVED_CONTRACT_SCHEMA_VERSION,
      contract: "geo-served-contract-latest",
      snapshot_sha256: manifestSha256,
      snapshot_s3_uri: snapshotUri,
      generated_at: manifest.generated_at,
    })}\n`, "utf8");
    await options.store.putLatestIfCurrent(latestKey, pointer, previous?.etag ?? null);
  }
  return { manifest, manifestSha256, snapshotKey, latestKey, snapshotUri, latestUri };
}

function isMissingObjectError(error: unknown): boolean {
  if (!isRecord(error)) return false;
  const metadata = isRecord(error["$metadata"]) ? error["$metadata"] : null;
  return error["name"] === "NotFound" || error["name"] === "NoSuchKey" || metadata?.["httpStatusCode"] === 404;
}

async function readResponseBody(response: { Body?: unknown }): Promise<Buffer> {
  const body = response.Body as AsyncIterable<Buffer> | undefined;
  if (!body || typeof body[Symbol.asyncIterator] !== "function") throw new Error("contract: réponse S3 sans body lisible");
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** Production S3 adapter.  It contains no application timeout by design. */
export function s3GeoServedContractStore(s3: S3Client): GeoServedContractStore {
  return {
    async list(prefix) {
      const entries: ListedObject[] = [];
      let token: string | undefined;
      do {
        const page = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 }));
        for (const item of page.Contents ?? []) {
          if (!item.Key) continue;
          entries.push({ key: item.Key, etag: item.ETag ?? null, last_modified: item.LastModified?.toISOString() ?? null, size: item.Size ?? null });
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return entries.sort((left, right) => left.key.localeCompare(right.key));
    },
    async read(key) {
      try {
        const response = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
        const bytes = await readResponseBody(response);
        return { bytes, etag: response.ETag ?? null, size: response.ContentLength ?? bytes.length };
      } catch (error) {
        if (isMissingObjectError(error)) return null;
        throw error;
      }
    },
    async putIfAbsent(key, body) {
      try {
        await putBytesIfAbsent(s3, key, body, "application/json", BUCKET);
        return true;
      } catch (error) {
        const metadata = isRecord(error) && isRecord(error["$metadata"]) ? error["$metadata"] : null;
        if (metadata?.["httpStatusCode"] === 412 || (isRecord(error) && error["name"] === "PreconditionFailed")) return false;
        throw error;
      }
    },
    async putLatestIfCurrent(key, body, priorEtag) {
      await putBytesIfMatch(s3, key, body, priorEtag, "application/json", BUCKET);
    },
  };
}
