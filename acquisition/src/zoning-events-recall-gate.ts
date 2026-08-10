/**
 * Measure the event-set recall of served `qc-zoning-events-<slug>` against
 * immo DesignationEvents before immo can retire its own event extraction.
 *
 * Read-only inputs:
 *   npx tsx acquisition/src/zoning-events-recall-gate.ts \
 *     --geo-events acquisition/src/__fixtures__/zoning-events-recall-gate.geo.json \
 *     --immo-events acquisition/src/__fixtures__/zoning-events-recall-gate.immo.json \
 *     --out=work/coverage/zoning-events-recall-gate-YYYYMMDDTHHMMSSZ.json \
 *     --markdown=work/coverage/zoning-events-recall-gate-YYYYMMDDTHHMMSSZ.md
 *
 * Without --geo-events, this reads the served S3 collections. Invoke that
 * production path with:
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 npx tsx ...
 *
 * Provenance: the type crosswalk is vendorized byte-for-byte from immo commit
 * b9c121d (`docs/spec/crosswalk-taxonomie.json`), PR #451, git blob dfe67cf.
 * The identity tuple stays exact; only type compatibility comes from that
 * frozen contract. Bylaw numbers are evidence only and never a match key.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  s3ZoningEventsStore,
  zoningEventsKeys,
  type ZoningEvent,
  type ZoningEventsDocument,
} from "./zoning-events-emit.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const VENDORED_CROSSWALK_PATH = fileURLToPath(new URL("./data/crosswalk-taxonomie.json", import.meta.url));

/**
 * The original fixed recall sample from SPEC_QC_ZONING_EVENTS_V2.md, kept as the
 * DEFAULT cohort only. The cohort is now a runtime parameter (`--cohort`) so the
 * gate can be pointed at the full 167 (`priorityRank ≤ 167` of set-167-bprime.tsv,
 * joined on `graph_city_slug`) without re-editing this module.
 */
export const RECALL_SAMPLE_MUNICIPALITIES = [
  "saint-raymond",
  "saint-stanislas",
  "sutton",
  "coaticook",
  "saint-mathieu-de-beloeil",
  "saint-eustache",
] as const;

/**
 * A cohort municipality slug. Formerly a closed union over the fixed 6-city
 * sample; now any served-collection slug, validated against the active cohort at
 * runtime rather than by the type system.
 */
export type RecallSampleMunicipality = string;

/** Parse a cohort file: one slug per line, or a TSV with a `graph_city_slug`
 * (fallback `slug`) column. Blank lines and `#` comments are ignored. Order is
 * preserved, duplicates rejected — a silent dedup would hide an upstream defect. */
export function parseCohortFile(text: string, where: string): string[] {
  const lines = text.split(/\r?\n/u).map((line) => line.replace(/\r$/u, ""));
  const nonEmpty = lines.map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith("#"));
  if (nonEmpty.length === 0) throw new Error(`${where}: cohorte vide`);
  const looksTabular = nonEmpty.some((line) => line.includes("\t"));
  let slugs: string[];
  if (looksTabular) {
    const header = nonEmpty[0]!.split("\t").map((cell) => cell.trim());
    const slugColumn = header.indexOf("graph_city_slug") !== -1
      ? header.indexOf("graph_city_slug")
      : header.indexOf("slug");
    if (slugColumn === -1) throw new Error(`${where}: colonne graph_city_slug|slug introuvable dans l'en-tête TSV`);
    slugs = nonEmpty.slice(1).map((line, index) => {
      const cell = line.split("\t")[slugColumn]?.trim();
      if (cell === undefined || cell.length === 0) throw new Error(`${where}: slug vide ligne ${index + 2}`);
      return cell;
    });
  } else {
    slugs = nonEmpty;
  }
  for (const slug of slugs) {
    if (!/^[a-z0-9-]+$/u.test(slug)) throw new Error(`${where}: slug invalide '${slug}' (attendu [a-z0-9-])`);
  }
  if (new Set(slugs).size !== slugs.length) throw new Error(`${where}: cohorte contient des slugs dupliqués`);
  return slugs;
}

/** Closed event-set partition: no fourth or implicit outcome is permitted. */
export const RECALL_OUTCOMES = ["matched", "missed", "extra"] as const;
export type RecallOutcome = (typeof RECALL_OUTCOMES)[number];

export const RECALL_THRESHOLD = 0.95;

/**
 * DEFAULT set-recall denominator for the fixed 6-city sample. On the 167 cohort
 * the active denominator is the count of immo DesignationEvents in the cohort
 * (or an explicit `--denominator`), so recall never silently improves by
 * dropping an immo DesignationEvent from its denominator.
 */
export const RECALL_SET_DENOMINATOR = 85;

/**
 * Candidate immo export fields. The export schema is pending confirmation;
 * this list is intentionally the entire adapter surface, rather than a model
 * of immo internals.
 */
export const IMMO_DESIGNATION_EVENT_CANDIDATE_FIELDS = {
  event_id: ["node_id", "event_id"],
  muni: ["muni", "city_slug"],
  type: ["type", "category", "kind"],
  date_iso: ["date", "date_iso"],
  bylaw_numero: ["bylaw_numero"],
  source_url: ["source_url", "url_pdf"],
  zone_ref: ["zone_ref", "zone_codes"],
  no_lot: ["no_lot"],
} as const;

const VOLATILE_QUERY_PARAMETER_NAMES = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "_ga",
  "_gl",
  "ref",
  "source",
  "download",
  "cache",
  "timestamp",
  "ts",
]);

export interface NaturalKey {
  readonly muni: string | null;
  readonly source_url_norm: string | null;
  readonly date_iso: string | null;
  readonly type: string | null;
}

export interface SecondaryNaturalKey {
  readonly muni: string;
  readonly bylaw_numero_norm: string;
  readonly type: string;
  readonly date_iso: string;
}

export interface NaturalKeySourceFields {
  readonly event_id: unknown | null;
  readonly muni: unknown | null;
  readonly source_url: unknown | null;
  readonly date_iso: unknown | null;
  readonly type: unknown | null;
  readonly bylaw_numero: unknown | null;
  readonly zone_ref: unknown | null;
  readonly no_lot: unknown | null;
}

/** One event as it can be audited without modelling immo's private graph. */
export interface NaturalKeyEvent {
  readonly side: "geo" | "immo";
  readonly natural_key: NaturalKey;
  readonly secondary_natural_key: SecondaryNaturalKey | null;
  readonly source_fields: NaturalKeySourceFields;
}

export interface PartitionEntry {
  readonly outcome: RecallOutcome;
  readonly match_kind: "identity_crosswalk" | null;
  readonly geo: NaturalKeyEvent | null;
  readonly immo: NaturalKeyEvent | null;
  readonly unmatched_reason: string | null;
}

export interface EventSetPartition {
  readonly matched: readonly PartitionEntry[];
  readonly missed: readonly PartitionEntry[];
  readonly extra: readonly PartitionEntry[];
}

/** A matchable multiset bucket: exact document identity plus neutral geo type. */
export interface SetRecallGroup {
  readonly key: {
    readonly muni: string;
    readonly source_url_norm: string;
    readonly date_iso: string;
    readonly crosswalked_type: string;
  };
  readonly immo_count: number;
  readonly geo_count: number;
  /** `min(immo_count, geo_count)`: it can never exceed immo_count. */
  readonly matched: number;
  /** `geo_count - matched`; it is reported for precision, never recall. */
  readonly over_split: number;
}

export type SetRecallMissReason =
  | "identity_key_incomplete"
  | "identity_not_aligned"
  | "immo_kind_hors_map"
  | "geo_type_absent_on_document"
  | "set_group_immo_overflow";

/** Deterministic witnesses for the immo events that remain missed by SET-RECALL. */
export interface SetRecallMiss {
  readonly immo: NaturalKeyEvent;
  readonly unmatched_reason: SetRecallMissReason;
}

/**
 * Multiset score mandated for the v3.4 transition decision. `recall` is
 * always a contribution to the active run denominator, even on a city row.
 */
export interface SetRecallMeasurement {
  readonly denominator: number;
  readonly matched: number;
  readonly missed: number;
  readonly immo_events: number;
  readonly geo_events: number;
  readonly geo_unmatchable: number;
  readonly over_split: number;
  readonly recall: number;
  readonly recall_state: "measured" | "no_immo_ground_truth";
  readonly precision: number | null;
  readonly precision_state: "measured" | "no_geo_events";
  readonly groups: readonly SetRecallGroup[];
  readonly missed_immo: readonly SetRecallMiss[];
}

/** The pre-v3.4 unique-pair score, retained for a transparent comparison. */
export interface StrictRecallMeasurement {
  readonly matched: number;
  readonly missed: number;
  readonly extra: number;
  readonly immo_events: number;
  readonly geo_events: number;
  readonly recall: number | null;
  readonly recall_state: "measured" | "no_immo_ground_truth";
  /** Same active denominator as SET-RECALL, for the headline comparison. */
  readonly recall_fixed_sample: number;
}

export type GeoCollectionStatus =
  | "geo_local_events_loaded"
  | "geo_collection_loaded"
  | "geo_collection_absent"
  | "geo_collection_not_in_local_input"
  | "geo_read_error";

export interface CityRecall {
  readonly slug: RecallSampleMunicipality;
  readonly geo_collection_status: GeoCollectionStatus;
  readonly geo_read_error: string | null;
  readonly partition: EventSetPartition;
  readonly matched: number;
  readonly missed: number;
  readonly extra: number;
  /** Only `node_type === "DesignationEvent"`; this is the recall denominator. */
  readonly immo_events: number;
  /** `node_type === "Signal"`; reported but never eligible for recall. */
  readonly immo_signals_excluded: number;
  /** Missing, null, empty, or non-string `node_type`; never inferred into a denominator. */
  readonly immo_node_type_missing_or_unknown: number;
  /** Non-empty `node_type` values other than DesignationEvent or Signal. */
  readonly immo_node_type_other: number;
  readonly geo_events: number;
  /** Ratified headline score: multiset per exact document identity and type. */
  readonly set_recall: SetRecallMeasurement;
  /** Old unique-pair score, kept alongside the headline rather than replaced. */
  readonly strict_recall: StrictRecallMeasurement;
  /**
   * Compatibility aliases for the v1 unique-pair partition. Consumers must
   * use `set_recall` for the ratified v3.4 headline.
   */
  readonly recall: number | null;
  readonly recall_state: "measured" | "no_immo_ground_truth";
}

export interface RecallGateReport {
  readonly contract: "qc-zoning-events-recall-gate/v1";
  readonly generated_at: string;
  readonly read_only_aggregation: true;
  readonly sample_municipalities: readonly RecallSampleMunicipality[];
  readonly natural_key_definition: {
    readonly tuple: "(muni, source_url_norm, date_iso) exact + crosswalk(type)";
    readonly source_url_normalization: string;
    readonly matching: "set_recall: identity_exact_type_crosswalk_multiset; strict_recall: identity_exact_type_crosswalk_unique_gated";
    readonly secondary_key: "disabled; bylaw never relaxes identity";
  };
  readonly taxonomy_crosswalk: {
    readonly path: "acquisition/src/data/crosswalk-taxonomie.json";
    readonly source_commit: "b9c121d";
    readonly source_pull_request: "#451";
    readonly source_git_blob: "dfe67cf";
    readonly contract_status: "frozen";
    readonly immo_category_normalization: "trim+lowercase; synonyms; known id; otherwise autre";
    readonly unmapped: "non-match";
  };
  readonly threshold: number;
  readonly scoring: {
    readonly headline: "set_recall";
    readonly set_recall: string;
    readonly strict_recall: string;
    readonly precision: "Σ_g min(immo_count[g], geo_count[g]) / total_geo_events";
    readonly over_split: "geo_count[g] - min(immo_count[g], geo_count[g])";
  };
  readonly input: {
    readonly geo: "local_file" | "s3";
    readonly geo_events_path: string | null;
    readonly immo_events_path: string;
  };
  readonly states: readonly string[];
  readonly findings: readonly {
    readonly code: "taxonomy_crosswalk_vendorized" | "source_url_alignment_risk" | "saint_stanislas_absent";
    readonly detail: string;
  }[];
  readonly cities: readonly CityRecall[];
  readonly aggregate: {
    readonly matched: number;
    readonly missed: number;
    readonly extra: number;
    /** Only DesignationEvents. */
    readonly immo_events: number;
    readonly immo_signals_excluded: number;
    readonly immo_node_type_missing_or_unknown: number;
    readonly immo_node_type_other: number;
    readonly geo_events: number;
    readonly geo_read_error_count: number;
    readonly set_recall: SetRecallMeasurement;
    readonly strict_recall: StrictRecallMeasurement;
    /** Compatibility aliases for the v1 unique-pair aggregate. */
    readonly recall: number | null;
    readonly recall_state: "measured" | "no_immo_ground_truth";
  };
  readonly immo_zone_or_lot_population: {
    readonly designation_events: number;
    readonly zone_ref: { readonly populated: number; readonly null_or_unknown: number };
    readonly no_lot: { readonly populated: number; readonly null_or_unknown: number };
  };
  readonly immo_events_outside_sample: readonly NaturalKeyEvent[];
  readonly geo_documents_outside_sample: readonly string[];
  readonly gate: {
    readonly status: "baseline_geo_not_producing_yet" | "recall_below_threshold" | "recall_at_or_above_threshold" | "no_immo_ground_truth" | "geo_read_error";
    readonly exit_code: 0 | 1 | 2;
  };
}

export interface RunRecallGateOptions {
  readonly geoEventsPath?: string;
  readonly immoEventsPath: string;
  readonly outPath: string;
  readonly markdownPath: string;
  readonly generatedAt?: string;
  /**
   * Active cohort of municipality slugs. Defaults to the fixed 6-city sample.
   * Pass the 167 (`graph_city_slug` of `priorityRank ≤ 167`) to de-cable the
   * gate from its ratified sample.
   */
  readonly cohort?: readonly string[];
  /**
   * Active set-recall denominator. Defaults to the fixed `RECALL_SET_DENOMINATOR`
   * (85). On the 167 cohort, pass the count of immo DesignationEvents so recall
   * is a fraction of the real ground-truth, not the frozen sample.
   */
  readonly denominator?: number;
}

export interface RunRecallGateResult {
  readonly report: RecallGateReport;
  readonly output: string;
  readonly markdownOutput: string;
  readonly exitCode: 0 | 1 | 2;
}

interface CrosswalkMapping {
  readonly immoCategories: ReadonlySet<string>;
  readonly status: "mapped" | "unmapped";
}

interface VendorizedCrosswalk {
  readonly synonyms: ReadonlyMap<string, string>;
  readonly knownImmoCategories: ReadonlySet<string>;
  readonly mappedImmoCategories: ReadonlySet<string>;
  readonly mappings: ReadonlyMap<string, CrosswalkMapping>;
  /** Reverse crosswalk used only to form the SET-RECALL neutral-type group. */
  readonly geoTypeByImmoCategory: ReadonlyMap<string, string>;
  readonly unknown: "autre";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${where}: objet requis`);
  return value;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function candidateValue(
  source: Record<string, unknown>,
  candidates: readonly string[],
): unknown | null {
  for (const candidate of candidates) {
    if (Object.hasOwn(source, candidate)) return source[candidate] ?? null;
  }
  return null;
}

function canonicalToken(value: unknown): string | null {
  return asNonEmptyString(value)?.toLowerCase() ?? null;
}

function stringList(value: unknown, where: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.length > 0)) {
    throw new Error(`${where}: tableau de chaînes non vides requis`);
  }
  return [...value];
}

/**
 * Parse and validate the copied contract rather than reconstructing its
 * taxonomy in code. A malformed or non-frozen artifact is a hard failure:
 * guessing an `autre` fallback would make an audit-invalid false match.
 */
function loadVendorizedCrosswalk(): VendorizedCrosswalk {
  const raw = record(JSON.parse(readFileSync(VENDORED_CROSSWALK_PATH, "utf8")) as unknown, "crosswalk");
  const contract = record(raw.$contract, "crosswalk.$contract");
  if (contract.status !== "frozen") throw new Error("crosswalk.$contract.status frozen requis");

  const identity = record(contract.identity, "crosswalk.$contract.identity");
  const identityFields = stringList(identity.fields, "crosswalk.$contract.identity.fields");
  if (identity.comparison !== "exact" || identity.all_required !== true || identity.match_before_type !== true
    || identityFields.join(",") !== "municipality,source_url,date") {
    throw new Error("crosswalk: contrat d'identité exacte requis");
  }

  const categoryInput = record(contract.category_input, "crosswalk.$contract.category_input");
  if (categoryInput.normalization !== "trim+lowercase" || categoryInput.unknown !== "autre") {
    throw new Error("crosswalk: contrat de canonicalisation immo requis");
  }
  const synonyms = new Map<string, string>();
  for (const [source, target] of Object.entries(record(categoryInput.synonyms, "crosswalk.$contract.category_input.synonyms"))) {
    const canonicalSource = canonicalToken(source);
    const canonicalTarget = canonicalToken(target);
    if (canonicalSource === null || canonicalTarget === null) throw new Error("crosswalk: synonyme invalide");
    synonyms.set(canonicalSource, canonicalTarget);
  }

  const vocabularies = record(contract.target_vocabularies, "crosswalk.$contract.target_vocabularies");
  const knownImmoCategories = new Set([
    ...stringList(vocabularies.category, "crosswalk.$contract.target_vocabularies.category"),
    ...stringList(vocabularies.etape, "crosswalk.$contract.target_vocabularies.etape"),
  ]);
  const geoKinds = new Set(stringList(contract.geo_kinds, "crosswalk.$contract.geo_kinds"));
  const mappingsRaw = record(raw.mappings, "crosswalk.mappings");
  const mappings = new Map<string, CrosswalkMapping>();
  const mappedImmoCategories = new Set<string>();
  const geoTypeByImmoCategory = new Map<string, string>();

  for (const [geoKind, value] of Object.entries(mappingsRaw)) {
    const mapping = record(value, `crosswalk.mappings.${geoKind}`);
    const status = mapping.status;
    if (status !== "mapped" && status !== "unmapped") throw new Error(`crosswalk.mappings.${geoKind}.status invalide`);
    const immo = stringList(mapping.immo, `crosswalk.mappings.${geoKind}.immo`);
    const axis = mapping.axis;
    const cardinality = mapping.cardinality;
    if (status === "mapped") {
      const expectedCardinality = immo.length === 1 ? "1↔1" : "1↔n";
      if (immo.length === 0 || (axis !== "category" && axis !== "etape") || cardinality !== expectedCardinality) {
        throw new Error(`crosswalk.mappings.${geoKind}: mapping mappé invalide`);
      }
    } else if (immo.length !== 0 || axis !== null || cardinality !== null) {
      throw new Error(`crosswalk.mappings.${geoKind}: mapping non mappé invalide`);
    }
    if (new Set(immo).size !== immo.length || immo.some((category) => !knownImmoCategories.has(category))) {
      throw new Error(`crosswalk.mappings.${geoKind}: cible immo invalide`);
    }
    if (status === "mapped") {
      for (const category of immo) {
        const existingGeoType = geoTypeByImmoCategory.get(category);
        if (existingGeoType !== undefined && existingGeoType !== geoKind) {
          throw new Error(`crosswalk: catégorie immo '${category}' mappée vers plusieurs types geo`);
        }
        mappedImmoCategories.add(category);
        geoTypeByImmoCategory.set(category, geoKind);
      }
    }
    mappings.set(geoKind, { immoCategories: new Set(immo), status });
  }
  if (mappings.size !== geoKinds.size || [...geoKinds].some((kind) => !mappings.has(kind))) {
    throw new Error("crosswalk: tous les types geo contractuels doivent être mappés");
  }
  if ([...synonyms.values()].some((category) => !knownImmoCategories.has(category))) {
    throw new Error("crosswalk: synonyme vers une catégorie inconnue");
  }
  return {
    synonyms,
    knownImmoCategories,
    mappedImmoCategories,
    mappings,
    geoTypeByImmoCategory,
    unknown: "autre",
  };
}

const VENDORED_CROSSWALK = loadVendorizedCrosswalk();

/** Implements `$contract.category_input` exactly; `autre` is never matchable. */
export function canonicalizeImmoCategory(value: unknown): string {
  const token = canonicalToken(value);
  if (token === null) return VENDORED_CROSSWALK.unknown;
  const normalized = VENDORED_CROSSWALK.synonyms.get(token) ?? token;
  return VENDORED_CROSSWALK.knownImmoCategories.has(normalized)
    ? normalized
    : VENDORED_CROSSWALK.unknown;
}

function canonicalDate(value: unknown): string | null {
  const date = asNonEmptyString(value);
  return date !== null && /^\d{4}-\d{2}-\d{2}$/u.test(date) ? date : null;
}

/**
 * URL normalization remains an exact comparison:
 * - trim the input;
 * - lowercase only the host;
 * - remove a trailing pathname slash (except `/`);
 * - remove a fixed set of tracking/cache query parameters (and `utm_*`);
 * - sort the remaining query pairs deterministically.
 *
 * It never approximates a path, host, date, or document identity. A malformed
 * URL is unknown (`null`) instead of being coerced into a matchable value.
 */
export function normalizeSourceUrl(value: unknown): string | null {
  const sourceUrl = asNonEmptyString(value);
  if (sourceUrl === null) return null;
  try {
    const url = new URL(sourceUrl);
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/u, "");
    const retained = [...url.searchParams.entries()]
      .filter(([name]) => {
        const lower = name.toLowerCase();
        return !lower.startsWith("utm_") && !VOLATILE_QUERY_PARAMETER_NAMES.has(lower);
      })
      .sort(([leftName, leftValue], [rightName, rightValue]) => {
        const byName = leftName.localeCompare(rightName);
        return byName !== 0 ? byName : leftValue.localeCompare(rightValue);
      });
    url.search = "";
    for (const [name, parameterValue] of retained) url.searchParams.append(name, parameterValue);
    return url.toString();
  } catch {
    return null;
  }
}

function secondaryNaturalKey(
  muni: string | null,
  bylawNumero: unknown,
  type: string | null,
  dateIso: string | null,
): SecondaryNaturalKey | null {
  const bylawNumeroNorm = canonicalToken(bylawNumero);
  if (muni === null || bylawNumeroNorm === null || type === null || dateIso === null) return null;
  return { muni, bylaw_numero_norm: bylawNumeroNorm, type, date_iso: dateIso };
}

function toNaturalKeyEvent(
  side: "geo" | "immo",
  sourceFields: NaturalKeySourceFields,
): NaturalKeyEvent {
  const muni = canonicalToken(sourceFields.muni);
  const type = side === "immo"
    ? canonicalizeImmoCategory(sourceFields.type)
    : canonicalToken(sourceFields.type);
  const dateIso = canonicalDate(sourceFields.date_iso);
  return {
    side,
    natural_key: {
      muni,
      source_url_norm: normalizeSourceUrl(sourceFields.source_url),
      date_iso: dateIso,
      type,
    },
    secondary_natural_key: secondaryNaturalKey(muni, sourceFields.bylaw_numero, type, dateIso),
    source_fields: sourceFields,
  };
}

/**
 * Parse the only input boundary for immo DesignationEvents.
 *
 * // ADAPTER: field mapping to be confirmed against immo export schema
 *
 * The pending immo schema is deliberately not inferred. Each natural-key
 * component is taken from the first present documented candidate. If no
 * candidate is present (or the candidate is not a usable string), that
 * component remains null/unknown and cannot be guessed into a match.
 */
// ADAPTER: field mapping to be confirmed against immo export schema
export function parseImmoDesignationEvents(raw: unknown): NaturalKeyEvent[] {
  if (!Array.isArray(raw)) throw new Error("immo events: tableau JSON requis (un event par entrée)");
  return raw.map((value, index) => {
    const item = record(value, `immo events[${index}]`);
    const eventId = candidateValue(item, IMMO_DESIGNATION_EVENT_CANDIDATE_FIELDS.event_id);
    const muni = candidateValue(item, IMMO_DESIGNATION_EVENT_CANDIDATE_FIELDS.muni);
    const type = candidateValue(item, IMMO_DESIGNATION_EVENT_CANDIDATE_FIELDS.type);
    const dateIso = candidateValue(item, IMMO_DESIGNATION_EVENT_CANDIDATE_FIELDS.date_iso);
    const bylawNumero = candidateValue(item, IMMO_DESIGNATION_EVENT_CANDIDATE_FIELDS.bylaw_numero);
    const sourceUrl = candidateValue(item, IMMO_DESIGNATION_EVENT_CANDIDATE_FIELDS.source_url);
    const zoneRef = candidateValue(item, IMMO_DESIGNATION_EVENT_CANDIDATE_FIELDS.zone_ref);
    const noLot = candidateValue(item, IMMO_DESIGNATION_EVENT_CANDIDATE_FIELDS.no_lot);
    return toNaturalKeyEvent("immo", {
      event_id: eventId,
      muni,
      source_url: sourceUrl,
      date_iso: dateIso,
      type,
      bylaw_numero: bylawNumero,
      zone_ref: zoneRef,
      no_lot: noLot,
    });
  });
}

interface ClassifiedImmoEvents {
  readonly designationEvents: readonly NaturalKeyEvent[];
  readonly signals: readonly NaturalKeyEvent[];
  readonly nodeTypeMissingOrUnknown: readonly NaturalKeyEvent[];
  readonly nodeTypeOther: readonly NaturalKeyEvent[];
}

/**
 * The immo handoff contains both DesignationEvents and derived Signals. Only
 * the former are ground truth for this geo emission recall denominator.
 *
 * `node_type` is deliberately exact and case-sensitive here. An absent,
 * malformed, or unknown value is reported separately; it is never guessed
 * into either product type.
 */
function classifyImmoEvents(raw: unknown): ClassifiedImmoEvents {
  if (!Array.isArray(raw)) throw new Error("immo events: tableau JSON requis (un event par entrée)");
  const events = parseImmoDesignationEvents(raw);
  const designationEvents: NaturalKeyEvent[] = [];
  const signals: NaturalKeyEvent[] = [];
  const nodeTypeMissingOrUnknown: NaturalKeyEvent[] = [];
  const nodeTypeOther: NaturalKeyEvent[] = [];
  for (const [index, value] of raw.entries()) {
    const item = record(value, `immo events[${index}]`);
    const event = events[index]!;
    if (!Object.hasOwn(item, "node_type") || asNonEmptyString(item.node_type) === null) {
      nodeTypeMissingOrUnknown.push(event);
    } else if (item.node_type === "DesignationEvent") {
      designationEvents.push(event);
    } else if (item.node_type === "Signal") {
      signals.push(event);
    } else {
      nodeTypeOther.push(event);
    }
  }
  return { designationEvents, signals, nodeTypeMissingOrUnknown, nodeTypeOther };
}

function parseGeoEvent(event: ZoningEvent): NaturalKeyEvent {
  const source = event as unknown as Record<string, unknown>;
  return toNaturalKeyEvent("geo", {
    event_id: source.event_id ?? null,
    muni: source.muni ?? null,
    source_url: source.url_pdf ?? null,
    date_iso: source.date_iso ?? null,
    type: source.type ?? null,
    bylaw_numero: source.bylaw_numero ?? null,
    zone_ref: source.zone_codes_resolus ?? null,
    no_lot: null,
  });
}

/** Identity is the complete document tuple. Type is deliberately excluded. */
function identityKeyToken(event: NaturalKeyEvent): string | null {
  const key = event.natural_key;
  if (key.muni === null || key.source_url_norm === null || key.date_iso === null) return null;
  return JSON.stringify([key.muni, key.source_url_norm, key.date_iso]);
}

function crosswalkMapping(geo: NaturalKeyEvent): CrosswalkMapping | null {
  const type = geo.natural_key.type;
  return type === null ? null : VENDORED_CROSSWALK.mappings.get(type) ?? null;
}

function isCrosswalkPair(geo: NaturalKeyEvent, immo: NaturalKeyEvent): boolean {
  const geoIdentity = identityKeyToken(geo);
  const immoIdentity = identityKeyToken(immo);
  if (geoIdentity === null || geoIdentity !== immoIdentity) return false;
  const mapping = crosswalkMapping(geo);
  const immoCategory = immo.natural_key.type;
  return mapping?.status === "mapped" && immoCategory !== null && mapping.immoCategories.has(immoCategory);
}

/**
 * The only type relaxation admitted to a SET-RECALL group. Geo contributes
 * its mapped neutral type; immo travels kind -> canonical category -> that
 * same neutral type through the frozen vendorized crosswalk. `autre` and all
 * unmapped categories deliberately return null instead of being guessed.
 */
function crosswalkedGeoType(event: NaturalKeyEvent): string | null {
  if (event.side === "geo") {
    const mapping = crosswalkMapping(event);
    return mapping?.status === "mapped" ? event.natural_key.type : null;
  }
  const immoCategory = event.natural_key.type;
  return immoCategory === null ? null : VENDORED_CROSSWALK.geoTypeByImmoCategory.get(immoCategory) ?? null;
}

interface SetRecallGroupKey {
  readonly token: string;
  readonly key: SetRecallGroup["key"];
}

function setRecallGroupKey(event: NaturalKeyEvent): SetRecallGroupKey | null {
  const { muni, source_url_norm: sourceUrlNorm, date_iso: dateIso } = event.natural_key;
  const type = crosswalkedGeoType(event);
  if (muni === null || sourceUrlNorm === null || dateIso === null || type === null) return null;
  const key = {
    muni,
    source_url_norm: sourceUrlNorm,
    date_iso: dateIso,
    crosswalked_type: type,
  };
  return { key, token: JSON.stringify([muni, sourceUrlNorm, dateIso, type]) };
}

interface SetRecallGroupAccumulator {
  readonly key: SetRecallGroup["key"];
  readonly immo: NaturalKeyEvent[];
  readonly geo: NaturalKeyEvent[];
}

function sortNaturalKeyEvents(events: readonly NaturalKeyEvent[]): NaturalKeyEvent[] {
  return [...events].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

/**
 * Measure ratified SET-RECALL by a document+type multiset.
 *
 * For every matchable g = (muni, source_url_norm, date_iso,
 * crosswalked_type), matched[g] = min(immo_count[g], geo_count[g]). The
 * recall denominator is the fixed 85-event sample; precision uses all geo
 * events, and over-split never enters recall. The strict unique-pair score is
 * intentionally calculated separately by `partitionEventSets`.
 */
export function setRecallFor(
  geoEvents: readonly NaturalKeyEvent[],
  immoEvents: readonly NaturalKeyEvent[],
  denominator: number = RECALL_SET_DENOMINATOR,
): SetRecallMeasurement {
  if (!Number.isInteger(denominator) || denominator <= 0) {
    throw new Error(`set-recall: dénominateur entier positif requis, reçu ${denominator}`);
  }
  const groups = new Map<string, SetRecallGroupAccumulator>();
  const add = (event: NaturalKeyEvent): void => {
    const groupKey = setRecallGroupKey(event);
    if (groupKey === null) return;
    const group = groups.get(groupKey.token) ?? {
      key: groupKey.key,
      immo: [],
      geo: [],
    };
    if (event.side === "immo") group.immo.push(event);
    else group.geo.push(event);
    groups.set(groupKey.token, group);
  };
  for (const event of immoEvents) add(event);
  for (const event of geoEvents) add(event);

  const selectedImmo = new Set<NaturalKeyEvent>();
  const measuredGroups: SetRecallGroup[] = [];
  let matched = 0;
  let overSplit = 0;
  for (const group of [...groups.values()].sort((left, right) => JSON.stringify(left.key).localeCompare(JSON.stringify(right.key)))) {
    const immo = sortNaturalKeyEvents(group.immo);
    const geo = sortNaturalKeyEvents(group.geo);
    const groupMatched = Math.min(immo.length, geo.length);
    if (groupMatched > immo.length) throw new Error("set-recall invalide: matched dépasse immo_count");
    for (const event of immo.slice(0, groupMatched)) selectedImmo.add(event);
    const groupOverSplit = geo.length - groupMatched;
    measuredGroups.push({
      key: group.key,
      immo_count: immo.length,
      geo_count: geo.length,
      matched: groupMatched,
      over_split: groupOverSplit,
    });
    matched += groupMatched;
    overSplit += groupOverSplit;
  }

  const missedImmo: SetRecallMiss[] = [];
  for (const event of sortNaturalKeyEvents(immoEvents)) {
    if (selectedImmo.has(event)) continue;
    const groupKey = setRecallGroupKey(event);
    let unmatchedReason: SetRecallMissReason;
    if (identityKeyToken(event) === null) {
      unmatchedReason = "identity_key_incomplete";
    } else if (crosswalkedGeoType(event) === null) {
      unmatchedReason = "immo_kind_hors_map";
    } else {
      const group = groupKey === null ? undefined : groups.get(groupKey.token);
      if (group === undefined || group.geo.length === 0) {
        const sameIdentityGeo = geoEvents.some((geo) => identityKeyToken(geo) === identityKeyToken(event));
        unmatchedReason = sameIdentityGeo ? "geo_type_absent_on_document" : "identity_not_aligned";
      } else {
        unmatchedReason = "set_group_immo_overflow";
      }
    }
    missedImmo.push({ immo: event, unmatched_reason: unmatchedReason });
  }

  const missed = immoEvents.length - matched;
  if (missed !== missedImmo.length || matched > immoEvents.length || matched > geoEvents.length) {
    throw new Error("set-recall invalide: conservation des events rompue");
  }
  const geoUnmatchable = geoEvents.filter((event) => setRecallGroupKey(event) === null).length;
  const precision = geoEvents.length === 0 ? null : matched / geoEvents.length;
  return {
    denominator,
    matched,
    missed,
    immo_events: immoEvents.length,
    geo_events: geoEvents.length,
    geo_unmatchable: geoUnmatchable,
    over_split: overSplit,
    recall: matched / denominator,
    recall_state: immoEvents.length === 0 ? "no_immo_ground_truth" : "measured",
    precision,
    precision_state: precision === null ? "no_geo_events" : "measured",
    groups: measuredGroups,
    missed_immo: missedImmo,
  };
}

function sortPartitionEntries(entries: PartitionEntry[]): PartitionEntry[] {
  return entries.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

/**
 * Compute a closed partition gated by a unique 1 geo ↔ 1 immo candidate edge.
 * Identity (muni, source_url_norm, date_iso) is exact and complete; only the
 * geo type / immo category comparison uses the vendorized crosswalk. A bylaw
 * number may not create an edge, so it can never relax document identity.
 */
export function partitionEventSets(
  geoEvents: readonly NaturalKeyEvent[],
  immoEvents: readonly NaturalKeyEvent[],
): EventSetPartition {
  const remainingGeo = new Set(geoEvents.map((_, index) => index));
  const remainingImmo = new Set(immoEvents.map((_, index) => index));
  const matched: PartitionEntry[] = [];
  const hasCandidateBeforeUniqueGate = new Set<string>();

  while (true) {
    const geoCandidates = new Map<number, number[]>();
    const immoCandidates = new Map<number, number[]>();
    for (const geoIndex of remainingGeo) {
      for (const immoIndex of remainingImmo) {
        if (!isCrosswalkPair(geoEvents[geoIndex]!, immoEvents[immoIndex]!)) continue;
        const geoEdges = geoCandidates.get(geoIndex) ?? [];
        geoEdges.push(immoIndex);
        geoCandidates.set(geoIndex, geoEdges);
        const immoEdges = immoCandidates.get(immoIndex) ?? [];
        immoEdges.push(geoIndex);
        immoCandidates.set(immoIndex, immoEdges);
        hasCandidateBeforeUniqueGate.add(`${geoIndex}:${immoIndex}`);
      }
    }
    const uniquePairs: Array<readonly [number, number]> = [];
    for (const [geoIndex, immoIndexes] of geoCandidates) {
      const immoIndex = immoIndexes[0];
      if (immoIndexes.length === 1 && immoIndex !== undefined && immoCandidates.get(immoIndex)?.length === 1) {
        uniquePairs.push([geoIndex, immoIndex]);
      }
    }
    if (uniquePairs.length === 0) break;
    for (const [geoIndex, immoIndex] of uniquePairs) {
      remainingGeo.delete(geoIndex);
      remainingImmo.delete(immoIndex);
      matched.push({
        outcome: "matched",
        match_kind: "identity_crosswalk",
        geo: geoEvents[geoIndex]!,
        immo: immoEvents[immoIndex]!,
        unmatched_reason: null,
      });
    }
  }

  const unmatchedReason = (side: "geo" | "immo", event: NaturalKeyEvent, index: number): string => {
    const identity = identityKeyToken(event);
    if (identity === null) return "identity_key_incomplete";
    const counterpart = side === "immo" ? geoEvents : immoEvents;
    const sameIdentity = counterpart.filter((candidate) => identityKeyToken(candidate) === identity);
    if (sameIdentity.length === 0) return "identity_not_aligned";
    if (side === "immo" && !VENDORED_CROSSWALK.mappedImmoCategories.has(event.natural_key.type ?? "")) {
      return "immo_kind_hors_map";
    }
    if (side === "geo" && crosswalkMapping(event)?.status !== "mapped") return "geo_type_unmapped";
    const hasCompatibleType = side === "immo"
      ? sameIdentity.some((geo) => isCrosswalkPair(geo, event))
      : sameIdentity.some((immo) => isCrosswalkPair(event, immo));
    if (!hasCompatibleType) return side === "immo" ? "geo_type_absent_on_document" : "immo_type_absent_on_document";
    const candidateKey = side === "immo"
      ? [...remainingGeo].some((geoIndex) => hasCandidateBeforeUniqueGate.has(`${geoIndex}:${index}`))
      : [...remainingImmo].some((immoIndex) => hasCandidateBeforeUniqueGate.has(`${index}:${immoIndex}`));
    return candidateKey ? "crosswalk_match_ambiguous" : "crosswalk_match_not_selected";
  };

  const missed = [...remainingImmo].map((index) => ({
    outcome: "missed" as const,
    match_kind: null,
    geo: null,
    immo: immoEvents[index]!,
    unmatched_reason: unmatchedReason("immo", immoEvents[index]!, index),
  }));
  const extra = [...remainingGeo].map((index) => ({
    outcome: "extra" as const,
    match_kind: null,
    geo: geoEvents[index]!,
    immo: null,
    unmatched_reason: unmatchedReason("geo", geoEvents[index]!, index),
  }));

  const partition: EventSetPartition = {
    matched: sortPartitionEntries(matched),
    missed: sortPartitionEntries(missed),
    extra: sortPartitionEntries(extra),
  };
  const covered = partition.matched.length * 2 + partition.missed.length + partition.extra.length;
  if (covered !== geoEvents.length + immoEvents.length) {
    throw new Error("partition recall non fermée: tous les events ne sont pas couverts exactement une fois");
  }
  return partition;
}

function rootRelativePath(path: string): string {
  const absolute = resolve(ROOT, path);
  if (!absolute.startsWith(`${ROOT}/`) && absolute !== ROOT) throw new Error(`chemin hors dépôt: ${path}`);
  return absolute;
}

function displayPath(path: string): string {
  const fromRoot = relative(ROOT, path);
  return !fromRoot.startsWith("..") && !isAbsolute(fromRoot) ? fromRoot : path;
}

function readJson(path: string): unknown {
  const absolute = rootRelativePath(path);
  const size = statSync(absolute).size;
  if (size > MAX_INPUT_BYTES) throw new Error(`${displayPath(absolute)}: ${size} octets > plafond de ${MAX_INPUT_BYTES}`);
  return JSON.parse(readFileSync(absolute, "utf8")) as unknown;
}

/** The immo export is a read-only handoff and may deliberately live outside this checkout. */
function readOnlyInputPath(path: string): string {
  return isAbsolute(path) ? resolve(path) : rootRelativePath(path);
}

function readImmoEventsInput(path: string): unknown {
  const absolute = readOnlyInputPath(path);
  const size = statSync(absolute).size;
  if (size > MAX_INPUT_BYTES) throw new Error(`${displayPath(absolute)}: ${size} octets > plafond de ${MAX_INPUT_BYTES}`);
  const text = readFileSync(absolute, "utf8");
  const parseNdjson = (): unknown[] => {
    const lines = text.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line.length > 0);
    return lines.map((line, index) => {
      try {
        return JSON.parse(line) as unknown;
      } catch (error) {
        throw new Error(`${displayPath(absolute)}: NDJSON ligne ${index + 1} invalide: ${errorText(error)}`);
      }
    });
  };
  if (absolute.toLowerCase().endsWith(".ndjson")) return parseNdjson();
  try {
    return JSON.parse(text) as unknown;
  } catch (jsonError) {
    const nonEmptyLineCount = text.split(/\r?\n/u).filter((line) => line.trim().length > 0).length;
    if (nonEmptyLineCount > 1) return parseNdjson();
    throw new Error(`${displayPath(absolute)}: JSON invalide: ${errorText(jsonError)}`);
  }
}

function parseZoningEventsDocuments(raw: unknown, where: string): ZoningEventsDocument[] {
  const documents = Array.isArray(raw) ? raw : [raw];
  return documents.map((value, index) => {
    const document = record(value, `${where}[${index}]`);
    if (!Array.isArray(document.events)) throw new Error(`${where}[${index}].events: tableau requis`);
    if (asNonEmptyString(document.muni) === null) throw new Error(`${where}[${index}].muni: chaîne non vide requise`);
    for (const [eventIndex, event] of document.events.entries()) {
      if (!isRecord(event)) throw new Error(`${where}[${index}].events[${eventIndex}]: objet requis`);
    }
    return document as unknown as ZoningEventsDocument;
  });
}

interface LoadedGeoDocuments {
  readonly source: "local_file" | "s3";
  readonly bySlug: ReadonlyMap<RecallSampleMunicipality, ZoningEventsDocument>;
  readonly statuses: ReadonlyMap<RecallSampleMunicipality, GeoCollectionStatus>;
  readonly errors: ReadonlyMap<RecallSampleMunicipality, string>;
  readonly outsideSample: readonly string[];
}

function sampleSlug(value: unknown, cohort: ReadonlySet<string>): RecallSampleMunicipality | null {
  const slug = canonicalToken(value);
  return slug !== null && cohort.has(slug) ? slug : null;
}

function indexGeoDocuments(
  documents: readonly ZoningEventsDocument[],
  source: "local_file" | "s3",
  missingStatus: GeoCollectionStatus,
  cohort: readonly string[],
): LoadedGeoDocuments {
  const cohortSet = new Set(cohort);
  const bySlug = new Map<RecallSampleMunicipality, ZoningEventsDocument>();
  const statuses = new Map<RecallSampleMunicipality, GeoCollectionStatus>();
  const outsideSample: string[] = [];
  for (const document of documents) {
    const slug = sampleSlug(document.muni, cohortSet);
    if (slug === null) {
      outsideSample.push(asNonEmptyString(document.muni) ?? "unknown");
      continue;
    }
    if (bySlug.has(slug)) throw new Error(`geo events: collection dupliquée pour ${slug}`);
    bySlug.set(slug, document);
    statuses.set(slug, source === "local_file" ? "geo_local_events_loaded" : "geo_collection_loaded");
  }
  for (const slug of cohort) {
    if (!statuses.has(slug)) statuses.set(slug, missingStatus);
  }
  return { source, bySlug, statuses, errors: new Map(), outsideSample: outsideSample.sort() };
}

function loadLocalGeoDocuments(path: string, cohort: readonly string[]): LoadedGeoDocuments {
  return indexGeoDocuments(
    parseZoningEventsDocuments(readJson(path), displayPath(rootRelativePath(path))),
    "local_file",
    "geo_collection_not_in_local_input",
    cohort,
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function loadS3GeoDocuments(cohort: readonly string[]): Promise<LoadedGeoDocuments> {
  const cohortSet = new Set(cohort);
  const documents: ZoningEventsDocument[] = [];
  const statuses = new Map<RecallSampleMunicipality, GeoCollectionStatus>();
  const errors = new Map<RecallSampleMunicipality, string>();
  let store: ReturnType<typeof s3ZoningEventsStore>;
  try {
    store = s3ZoningEventsStore();
  } catch (error) {
    const message = errorText(error);
    for (const slug of cohort) {
      statuses.set(slug, "geo_read_error");
      errors.set(slug, message);
    }
    return { source: "s3", bySlug: new Map(), statuses, errors, outsideSample: [] };
  }
  for (const slug of cohort) {
    try {
      let bytes: Buffer | null = null;
      for (const key of zoningEventsKeys(slug)) {
        bytes = await store.getExisting(key);
        if (bytes !== null) break;
      }
      if (bytes === null) {
        statuses.set(slug, "geo_collection_absent");
        continue;
      }
      const parsed = parseZoningEventsDocuments(JSON.parse(bytes.toString("utf8")) as unknown, `S3 qc-zoning-events-${slug}`);
      if (parsed.length !== 1) throw new Error(`S3 qc-zoning-events-${slug}: un document attendu, reçu ${parsed.length}`);
      const document = parsed[0]!;
      if (sampleSlug(document.muni, cohortSet) !== slug) {
        throw new Error(`S3 qc-zoning-events-${slug}: muni '${String(document.muni)}' ne correspond pas à la collection`);
      }
      documents.push(document);
      statuses.set(slug, "geo_collection_loaded");
    } catch (error) {
      statuses.set(slug, "geo_read_error");
      errors.set(slug, errorText(error));
    }
  }
  const indexed = indexGeoDocuments(documents, "s3", "geo_collection_absent", cohort);
  return { source: "s3", bySlug: indexed.bySlug, statuses, errors, outsideSample: indexed.outsideSample };
}

function populated(value: unknown | null): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return true;
}

function populationCount(events: readonly NaturalKeyEvent[], field: "zone_ref" | "no_lot") {
  const populatedCount = events.filter((event) => populated(event.source_fields[field])).length;
  return { populated: populatedCount, null_or_unknown: events.length - populatedCount };
}

function strictRecallFor(
  partition: EventSetPartition,
  fixedDenominator: number = RECALL_SET_DENOMINATOR,
): StrictRecallMeasurement {
  const denominator = partition.matched.length + partition.missed.length;
  const recall = denominator === 0 ? null : partition.matched.length / denominator;
  return {
    matched: partition.matched.length,
    missed: partition.missed.length,
    extra: partition.extra.length,
    immo_events: denominator,
    geo_events: partition.matched.length + partition.extra.length,
    recall,
    recall_state: recall === null ? "no_immo_ground_truth" : "measured",
    recall_fixed_sample: partition.matched.length / fixedDenominator,
  };
}

function markdown(report: RecallGateReport): string {
  const activeDenominator = report.aggregate.set_recall.denominator;
  const cityRows = report.cities.map((city) => {
    const setRecall = city.set_recall.recall.toFixed(4);
    const strictRecall = city.strict_recall.recall_fixed_sample.toFixed(4);
    const precision = city.set_recall.precision === null ? "unknown (no_geo_events)" : city.set_recall.precision.toFixed(4);
    return `| ${city.slug} | ${city.geo_collection_status} | ${city.set_recall.matched}/${activeDenominator} | ${strictRecall} | ${setRecall} | ${precision} | ${city.set_recall.over_split} | ${city.set_recall.geo_unmatchable} | ${city.immo_signals_excluded} |`;
  });
  const exceptions = report.cities.flatMap((city) => [
    ...city.set_recall.missed_immo.map((entry) => `- set-recall missed ${city.slug}: ${entry.unmatched_reason}; ${JSON.stringify(entry.immo)}`),
    ...city.partition.missed.map((entry) => `- missed ${city.slug}: ${JSON.stringify(entry.immo)}`),
    ...city.partition.extra.map((entry) => `- extra ${city.slug}: ${JSON.stringify(entry.geo)}`),
  ]);
  const setAggregate = report.aggregate.set_recall;
  const strictAggregate = report.aggregate.strict_recall;
  const aggregatePrecision = setAggregate.precision === null ? "unknown (no_geo_events)" : setAggregate.precision.toFixed(4);
  return [
    "# Recall gate qc-zoning-events vs DesignationEvents immo",
    "",
    "Mesure read-only du rappel event-set sur l’échantillon contractuel. **Headline ratifié : SET-RECALL**. Le strict reste visible en parallèle. L’identité (muni, source_url_norm, date_iso) est EXACTE; seul le type passe par le crosswalk vendorisé. Aucune clé incomplète ou hors-map n’est forcée.",
    "",
    `Formule exacte : pour chaque groupe matchable g = (muni, source_url_norm, date_iso, crosswalked_type), matched[g] = min(immo_count[g], geo_count[g]). SET-RECALL = Σ_g matched[g] / ${activeDenominator} (dénominateur actif du run). Précision = Σ_g matched[g] / total_geo_events; over_split[g] = geo_count[g] − matched[g] et n’entre jamais dans le recall. Les kinds immo hors-map et le type geo \`autre\` ne créent aucun groupe matchable.`,
    "",
    `Seuil : ${report.threshold}. SET-RECALL agrégé : ${setAggregate.matched}/${activeDenominator} (${setAggregate.recall.toFixed(4)}). Strict agrégé : ${strictAggregate.matched}/${activeDenominator} (${strictAggregate.recall_fixed_sample.toFixed(4)}). Précision agrégée : ${aggregatePrecision} (${setAggregate.matched}/${setAggregate.geo_events}); over_split : ${setAggregate.over_split}. État du gate : ${report.gate.status}.`,
    "",
    `| Ville | État geo | SET matched/${activeDenominator} | Strict recall | SET recall | Précision | Over-split | Geo hors groupe | Signals écartés |`,
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...cityRows,
    "",
    "## Entrées immo hors dénominateur",
    "",
    `Signals écartés : ${report.aggregate.immo_signals_excluded}. node_type missing/unknown : ${report.aggregate.immo_node_type_missing_or_unknown}. node_type autre : ${report.aggregate.immo_node_type_other}.`,
    "",
    "## Failure 1 — population des DesignationEvents immo",
    "",
    `DesignationEvents : ${report.immo_zone_or_lot_population.designation_events}. zone_ref peuplé/null-or-unknown : ${report.immo_zone_or_lot_population.zone_ref.populated}/${report.immo_zone_or_lot_population.zone_ref.null_or_unknown}. no_lot peuplé/null-or-unknown : ${report.immo_zone_or_lot_population.no_lot.populated}/${report.immo_zone_or_lot_population.no_lot.null_or_unknown}.`,
    "",
    "## Findings déclarés",
    "",
    ...report.findings.map((finding) => `- ${finding.code}: ${finding.detail}`),
    "",
    "## Missed et extra (clés naturelles et champs sources)",
    "",
    ...(exceptions.length > 0 ? exceptions : ["Aucun missed ni extra."]),
    "",
    "La liste complète, y compris la partition fermée matched/missed/extra et la mesure zone_ref/no_lot, est dans l’artefact JSON voisin.",
    "",
  ].join("\n");
}

function outputPath(path: string, extension: ".json" | ".md"): string {
  if (!path.endsWith(extension)) throw new Error(`sortie doit finir par ${extension}: ${path}`);
  const absolute = isAbsolute(path) ? resolve(path) : rootRelativePath(path);
  if (existsSync(absolute)) throw new Error(`refus d'écraser l'artefact: ${displayPath(absolute)}`);
  return absolute;
}

function writeArtifact(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, { encoding: "utf8", flag: "wx" });
}

export async function runRecallGate(options: RunRecallGateOptions): Promise<RunRecallGateResult> {
  const cohort = options.cohort ?? [...RECALL_SAMPLE_MUNICIPALITIES];
  if (cohort.length === 0) throw new Error("cohorte vide: au moins une municipalité requise");
  if (cohort.some((slug) => !/^[a-z0-9-]+$/u.test(slug))) throw new Error("cohorte: slugs [a-z0-9-] requis");
  if (new Set(cohort).size !== cohort.length) throw new Error("cohorte: slugs dupliqués");
  const cohortSet = new Set(cohort);
  const denominator = options.denominator ?? RECALL_SET_DENOMINATOR;
  const output = outputPath(options.outPath, ".json");
  const markdownOutput = outputPath(options.markdownPath, ".md");
  const immoPath = readOnlyInputPath(options.immoEventsPath);
  const immoInput = classifyImmoEvents(readImmoEventsInput(options.immoEventsPath));
  const immoEvents = immoInput.designationEvents;
  const geo = options.geoEventsPath === undefined
    ? await loadS3GeoDocuments(cohort)
    : loadLocalGeoDocuments(options.geoEventsPath, cohort);
  const cities: CityRecall[] = [];
  const immoEventsOutsideSample: NaturalKeyEvent[] = [];
  const sampleImmoEvents = immoEvents.filter((event) => sampleSlug(event.natural_key.muni, cohortSet) !== null);
  const sampleGeoEvents: NaturalKeyEvent[] = [];

  for (const event of immoEvents) {
    if (sampleSlug(event.natural_key.muni, cohortSet) === null) immoEventsOutsideSample.push(event);
  }

  for (const slug of cohort) {
    const document = geo.bySlug.get(slug);
    const geoEvents = document === undefined ? [] : document.events.map(parseGeoEvent);
    const cityImmoEvents = immoEvents.filter((event) => event.natural_key.muni === slug);
    const citySignals = immoInput.signals.filter((event) => event.natural_key.muni === slug);
    const cityNodeTypeMissingOrUnknown = immoInput.nodeTypeMissingOrUnknown
      .filter((event) => event.natural_key.muni === slug);
    const cityNodeTypeOther = immoInput.nodeTypeOther.filter((event) => event.natural_key.muni === slug);
    const partition = partitionEventSets(geoEvents, cityImmoEvents);
    const strictRecall = strictRecallFor(partition, denominator);
    const setRecall = setRecallFor(geoEvents, cityImmoEvents, denominator);
    sampleGeoEvents.push(...geoEvents);
    cities.push({
      slug,
      geo_collection_status: geo.statuses.get(slug)!,
      geo_read_error: geo.errors.get(slug) ?? null,
      partition,
      matched: partition.matched.length,
      missed: partition.missed.length,
      extra: partition.extra.length,
      immo_events: cityImmoEvents.length,
      immo_signals_excluded: citySignals.length,
      immo_node_type_missing_or_unknown: cityNodeTypeMissingOrUnknown.length,
      immo_node_type_other: cityNodeTypeOther.length,
      geo_events: geoEvents.length,
      set_recall: setRecall,
      strict_recall: strictRecall,
      recall: strictRecall.recall,
      recall_state: strictRecall.recall_state,
    });
  }

  const aggregatePartition: EventSetPartition = {
    matched: cities.flatMap((city) => city.partition.matched),
    missed: cities.flatMap((city) => city.partition.missed),
    extra: cities.flatMap((city) => city.partition.extra),
  };
  const aggregateStrictRecall = strictRecallFor(aggregatePartition, denominator);
  const aggregateSetRecall = setRecallFor(sampleGeoEvents, sampleImmoEvents, denominator);
  const totalGeoEvents = aggregateSetRecall.geo_events;
  const hasGeoReadError = cities.some((city) => city.geo_collection_status === "geo_read_error");
  const states: string[] = [];
  let gate: RecallGateReport["gate"];
  if (hasGeoReadError) {
    states.push("geo_read_error");
    gate = { status: "geo_read_error", exit_code: 2 };
  } else if (totalGeoEvents === 0) {
    states.push("baseline_geo_not_producing_yet");
    gate = { status: "baseline_geo_not_producing_yet", exit_code: 0 };
  } else if (aggregateSetRecall.recall_state === "no_immo_ground_truth") {
    states.push("no_immo_ground_truth");
    gate = { status: "no_immo_ground_truth", exit_code: 0 };
  } else if (aggregateSetRecall.recall < RECALL_THRESHOLD) {
    states.push("recall_below_threshold");
    gate = { status: "recall_below_threshold", exit_code: 1 };
  } else {
    states.push("recall_at_or_above_threshold");
    gate = { status: "recall_at_or_above_threshold", exit_code: 0 };
  }
  if (immoEventsOutsideSample.length > 0) states.push("immo_events_outside_sample");
  if (geo.outsideSample.length > 0) states.push("geo_documents_outside_sample");
  if (cities.some((city) => city.set_recall.recall_state === "no_immo_ground_truth")) states.push("no_immo_ground_truth");
  if (immoInput.nodeTypeMissingOrUnknown.length > 0) states.push("immo_node_type_missing_or_unknown");
  if (immoInput.nodeTypeOther.length > 0) states.push("immo_node_type_other");

  const report: RecallGateReport = {
    contract: "qc-zoning-events-recall-gate/v1",
    generated_at: options.generatedAt ?? new Date().toISOString(),
    read_only_aggregation: true,
    sample_municipalities: cohort,
    natural_key_definition: {
      tuple: "(muni, source_url_norm, date_iso) exact + crosswalk(type)",
      source_url_normalization: "trim; lowercase host; remove trailing pathname slash; remove utm_*, fbclid, gclid, mc_cid, mc_eid, _ga, _gl, ref, source, download, cache, timestamp, ts; sort retained query pairs",
      matching: "set_recall: identity_exact_type_crosswalk_multiset; strict_recall: identity_exact_type_crosswalk_unique_gated",
      secondary_key: "disabled; bylaw never relaxes identity",
    },
    taxonomy_crosswalk: {
      path: "acquisition/src/data/crosswalk-taxonomie.json",
      source_commit: "b9c121d",
      source_pull_request: "#451",
      source_git_blob: "dfe67cf",
      contract_status: "frozen",
      immo_category_normalization: "trim+lowercase; synonyms; known id; otherwise autre",
      unmapped: "non-match",
    },
    threshold: RECALL_THRESHOLD,
    scoring: {
      headline: "set_recall",
      set_recall: `Σ_g min(immo_count[g], geo_count[g]) / ${denominator}`,
      strict_recall: `unique crosswalk pairs / ${denominator}`,
      precision: "Σ_g min(immo_count[g], geo_count[g]) / total_geo_events",
      over_split: "geo_count[g] - min(immo_count[g], geo_count[g])",
    },
    input: {
      geo: geo.source,
      geo_events_path: options.geoEventsPath === undefined ? null : displayPath(rootRelativePath(options.geoEventsPath)),
      immo_events_path: displayPath(immoPath),
    },
    states,
    findings: [
      {
        code: "taxonomy_crosswalk_vendorized",
        detail: "Le type est relâché uniquement par le crosswalk gelé vendorisé depuis immo b9c121d / PR #451 / blob dfe67cf. Une catégorie sans cible geo (dont piia et autre) reste non-matchée.",
      },
      {
        code: "source_url_alignment_risk",
        detail: "geo(url_pdf) et immo(source_url) peuvent référer des URL différentes pour un même event, créant des faux missed sous le matching exact.",
      },
      {
        code: "saint_stanislas_absent",
        detail: "Le slug saint-stanislas est ambigu (saint-stanislas-de-kostka / saint-stanislas--des-chenaux / saint-stanislas--maria-chapdelaine) et l’export immo ne fournit pas de graphe sous le slug nu ; la ville est no_immo_ground_truth.",
      },
    ],
    cities,
    aggregate: {
      matched: aggregatePartition.matched.length,
      missed: aggregatePartition.missed.length,
      extra: aggregatePartition.extra.length,
      immo_events: aggregatePartition.matched.length + aggregatePartition.missed.length,
      immo_signals_excluded: immoInput.signals.length,
      immo_node_type_missing_or_unknown: immoInput.nodeTypeMissingOrUnknown.length,
      immo_node_type_other: immoInput.nodeTypeOther.length,
      geo_events: aggregatePartition.matched.length + aggregatePartition.extra.length,
      geo_read_error_count: cities.filter((city) => city.geo_collection_status === "geo_read_error").length,
      set_recall: aggregateSetRecall,
      strict_recall: aggregateStrictRecall,
      recall: aggregateStrictRecall.recall,
      recall_state: aggregateStrictRecall.recall_state,
    },
    immo_zone_or_lot_population: {
      designation_events: immoEvents.length,
      zone_ref: populationCount(immoEvents, "zone_ref"),
      no_lot: populationCount(immoEvents, "no_lot"),
    },
    immo_events_outside_sample: immoEventsOutsideSample,
    geo_documents_outside_sample: geo.outsideSample,
    gate,
  };
  writeArtifact(output, `${JSON.stringify(report, null, 2)}\n`);
  writeArtifact(markdownOutput, markdown(report));
  return { report, output, markdownOutput, exitCode: gate.exit_code };
}

function argumentValue(name: string): string | undefined {
  const args = process.argv.slice(2);
  const equals = args.find((argument) => argument.startsWith(`${name}=`));
  if (equals !== undefined) return equals.slice(name.length + 1);
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function timestampForFilename(now: Date): string {
  return now.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
}

async function main(): Promise<void> {
  const immoEventsPath = argumentValue("--immo-events");
  if (!immoEventsPath) throw new Error("--immo-events <path> est requis");
  const geoEventsPath = argumentValue("--geo-events");
  const cohortPath = argumentValue("--cohort");
  const cohort = cohortPath === undefined
    ? undefined
    : parseCohortFile(readFileSync(readOnlyInputPath(cohortPath), "utf8"), displayPath(readOnlyInputPath(cohortPath)));
  const denominatorRaw = argumentValue("--denominator");
  const denominator = denominatorRaw === undefined ? undefined : Number.parseInt(denominatorRaw, 10);
  if (denominatorRaw !== undefined && (denominator === undefined || Number.isNaN(denominator))) {
    throw new Error(`--denominator entier requis, reçu '${denominatorRaw}'`);
  }
  const stamp = timestampForFilename(new Date());
  const result = await runRecallGate({
    ...(geoEventsPath === undefined ? {} : { geoEventsPath }),
    ...(cohort === undefined ? {} : { cohort }),
    ...(denominator === undefined ? {} : { denominator }),
    immoEventsPath,
    outPath: argumentValue("--out") ?? `work/coverage/zoning-events-recall-gate-${stamp}.json`,
    markdownPath: argumentValue("--markdown") ?? `work/coverage/zoning-events-recall-gate-${stamp}.md`,
  });
  process.stdout.write(`${JSON.stringify({
    json: displayPath(result.output),
    markdown: displayPath(result.markdownOutput),
    headline: result.report.scoring.headline,
    set_recall: result.report.aggregate.set_recall,
    strict_recall: result.report.aggregate.strict_recall,
    immo_events: result.report.aggregate.immo_events,
    immo_signals_excluded: result.report.aggregate.immo_signals_excluded,
    immo_node_type_missing_or_unknown: result.report.aggregate.immo_node_type_missing_or_unknown,
    immo_node_type_other: result.report.aggregate.immo_node_type_other,
    geo_events: result.report.aggregate.geo_events,
    gate: result.report.gate.status,
    exit_code: result.exitCode,
    cities: result.report.cities.map((city) => ({
      slug: city.slug,
      set_recall: city.set_recall,
      strict_recall: city.strict_recall,
      immo_events: city.immo_events,
      immo_signals_excluded: city.immo_signals_excluded,
      geo_collection_status: city.geo_collection_status,
    })),
  })}\n`);
  process.exitCode = result.exitCode;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${errorText(error)}\n`);
    process.exitCode = 2;
  });
}
