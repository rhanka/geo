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
 * Matching is deliberately exact only. It does not share geo's `event_id`
 * with immo, so it compares a canonical natural key instead. The optional
 * bylaw key is a second, unique-gated exact pass; it never forces an
 * ambiguous match.
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

/** The fixed recall sample from SPEC_QC_ZONING_EVENTS_V2.md. */
export const RECALL_SAMPLE_MUNICIPALITIES = [
  "saint-raymond",
  "saint-stanislas",
  "sutton",
  "coaticook",
  "saint-mathieu-de-beloeil",
  "saint-eustache",
] as const;

export type RecallSampleMunicipality = (typeof RECALL_SAMPLE_MUNICIPALITIES)[number];

/** Closed event-set partition: no fourth or implicit outcome is permitted. */
export const RECALL_OUTCOMES = ["matched", "missed", "extra"] as const;
export type RecallOutcome = (typeof RECALL_OUTCOMES)[number];

export const RECALL_THRESHOLD = 0.95;

/**
 * Candidate immo export fields. The export schema is pending confirmation;
 * this list is intentionally the entire adapter surface, rather than a model
 * of immo internals.
 */
export const IMMO_DESIGNATION_EVENT_CANDIDATE_FIELDS = {
  muni: ["muni", "city_slug"],
  type: ["type", "category"],
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
  readonly match_kind: "natural_key" | "secondary_bylaw_key" | null;
  readonly geo: NaturalKeyEvent | null;
  readonly immo: NaturalKeyEvent | null;
  readonly unmatched_reason: string | null;
}

export interface EventSetPartition {
  readonly matched: readonly PartitionEntry[];
  readonly missed: readonly PartitionEntry[];
  readonly extra: readonly PartitionEntry[];
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
  readonly immo_events: number;
  readonly geo_events: number;
  readonly recall: number | null;
  readonly recall_state: "measured" | "no_immo_ground_truth";
}

export interface RecallGateReport {
  readonly contract: "qc-zoning-events-recall-gate/v1";
  readonly generated_at: string;
  readonly read_only_aggregation: true;
  readonly sample_municipalities: readonly RecallSampleMunicipality[];
  readonly natural_key_definition: {
    readonly tuple: "(muni, source_url_norm, date_iso, type)";
    readonly source_url_normalization: string;
    readonly matching: "exact_only_unique_gated";
    readonly secondary_key: "(muni, bylaw_numero_norm, type, date_iso), only when non-null on both sides";
  };
  readonly threshold: number;
  readonly input: {
    readonly geo: "local_file" | "s3";
    readonly geo_events_path: string | null;
    readonly immo_events_path: string;
  };
  readonly states: readonly string[];
  readonly cities: readonly CityRecall[];
  readonly aggregate: {
    readonly matched: number;
    readonly missed: number;
    readonly extra: number;
    readonly immo_events: number;
    readonly geo_events: number;
    readonly geo_read_error_count: number;
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
}

export interface RunRecallGateResult {
  readonly report: RecallGateReport;
  readonly output: string;
  readonly markdownOutput: string;
  readonly exitCode: 0 | 1 | 2;
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
  const type = canonicalToken(sourceFields.type);
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
    const muni = candidateValue(item, IMMO_DESIGNATION_EVENT_CANDIDATE_FIELDS.muni);
    const type = candidateValue(item, IMMO_DESIGNATION_EVENT_CANDIDATE_FIELDS.type);
    const dateIso = candidateValue(item, IMMO_DESIGNATION_EVENT_CANDIDATE_FIELDS.date_iso);
    const bylawNumero = candidateValue(item, IMMO_DESIGNATION_EVENT_CANDIDATE_FIELDS.bylaw_numero);
    const sourceUrl = candidateValue(item, IMMO_DESIGNATION_EVENT_CANDIDATE_FIELDS.source_url);
    const zoneRef = candidateValue(item, IMMO_DESIGNATION_EVENT_CANDIDATE_FIELDS.zone_ref);
    const noLot = candidateValue(item, IMMO_DESIGNATION_EVENT_CANDIDATE_FIELDS.no_lot);
    return toNaturalKeyEvent("immo", {
      event_id: null,
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

function naturalKeyToken(event: NaturalKeyEvent): string | null {
  const key = event.natural_key;
  if (key.muni === null || key.source_url_norm === null || key.date_iso === null || key.type === null) return null;
  return JSON.stringify([key.muni, key.source_url_norm, key.date_iso, key.type]);
}

function secondaryKeyToken(event: NaturalKeyEvent): string | null {
  const key = event.secondary_natural_key;
  return key === null ? null : JSON.stringify([key.muni, key.bylaw_numero_norm, key.type, key.date_iso]);
}

function sortPartitionEntries(entries: PartitionEntry[]): PartitionEntry[] {
  return entries.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

/**
 * Compute a closed, exact partition. The primary pass requires an identical
 * complete natural key. The secondary bylaw pass considers only still-unpaired
 * events, with an identical complete secondary key and exactly one event on
 * either side. Duplicates are deliberately left unpaired.
 */
export function partitionEventSets(
  geoEvents: readonly NaturalKeyEvent[],
  immoEvents: readonly NaturalKeyEvent[],
): EventSetPartition {
  const remainingGeo = new Set(geoEvents.map((_, index) => index));
  const remainingImmo = new Set(immoEvents.map((_, index) => index));
  const matched: PartitionEntry[] = [];
  const primaryAmbiguous = new Set<string>();
  const secondaryAmbiguous = new Set<string>();

  const matchBy = (
    keyFor: (event: NaturalKeyEvent) => string | null,
    kind: "natural_key" | "secondary_bylaw_key",
    ambiguous: Set<string>,
  ): void => {
    // Retain original indexes: filtering first would make matches delete the
    // wrong element from the remaining sets.
    const groupsFromRemaining = (events: readonly NaturalKeyEvent[], remaining: ReadonlySet<number>) => {
      const groups = new Map<string, number[]>();
      for (const index of remaining) {
        const key = keyFor(events[index]!);
        if (key === null) continue;
        const group = groups.get(key);
        if (group) group.push(index);
        else groups.set(key, [index]);
      }
      return groups;
    };
    const geoRemainingGroups = groupsFromRemaining(geoEvents, remainingGeo);
    const immoRemainingGroups = groupsFromRemaining(immoEvents, remainingImmo);
    const keys = new Set([...geoRemainingGroups.keys(), ...immoRemainingGroups.keys()]);
    for (const key of keys) {
      const geo = geoRemainingGroups.get(key) ?? [];
      const immo = immoRemainingGroups.get(key) ?? [];
      if (geo.length === 1 && immo.length === 1) {
        const geoIndex = geo[0]!;
        const immoIndex = immo[0]!;
        remainingGeo.delete(geoIndex);
        remainingImmo.delete(immoIndex);
        matched.push({
          outcome: "matched",
          match_kind: kind,
          geo: geoEvents[geoIndex]!,
          immo: immoEvents[immoIndex]!,
          unmatched_reason: null,
        });
      } else if (geo.length > 0 && immo.length > 0) {
        ambiguous.add(key);
      }
    }
  };

  matchBy(naturalKeyToken, "natural_key", primaryAmbiguous);
  matchBy(secondaryKeyToken, "secondary_bylaw_key", secondaryAmbiguous);

  const unmatchedReason = (event: NaturalKeyEvent): string => {
    const natural = naturalKeyToken(event);
    const secondary = secondaryKeyToken(event);
    if (natural !== null && primaryAmbiguous.has(natural)) return "natural_key_ambiguous";
    if (secondary !== null && secondaryAmbiguous.has(secondary)) return "secondary_bylaw_key_ambiguous";
    if (natural === null && secondary === null) return "natural_and_secondary_keys_incomplete";
    if (natural === null) return "natural_key_incomplete";
    if (secondary === null) return "no_exact_natural_key_match_secondary_key_unavailable";
    return "no_exact_natural_or_secondary_key_match";
  };

  const missed = [...remainingImmo].map((index) => ({
    outcome: "missed" as const,
    match_kind: null,
    geo: null,
    immo: immoEvents[index]!,
    unmatched_reason: unmatchedReason(immoEvents[index]!),
  }));
  const extra = [...remainingGeo].map((index) => ({
    outcome: "extra" as const,
    match_kind: null,
    geo: geoEvents[index]!,
    immo: null,
    unmatched_reason: unmatchedReason(geoEvents[index]!),
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

function sampleSlug(value: unknown): RecallSampleMunicipality | null {
  const slug = canonicalToken(value);
  return slug !== null && (RECALL_SAMPLE_MUNICIPALITIES as readonly string[]).includes(slug)
    ? slug as RecallSampleMunicipality
    : null;
}

function indexGeoDocuments(
  documents: readonly ZoningEventsDocument[],
  source: "local_file" | "s3",
  missingStatus: GeoCollectionStatus,
): LoadedGeoDocuments {
  const bySlug = new Map<RecallSampleMunicipality, ZoningEventsDocument>();
  const statuses = new Map<RecallSampleMunicipality, GeoCollectionStatus>();
  const outsideSample: string[] = [];
  for (const document of documents) {
    const slug = sampleSlug(document.muni);
    if (slug === null) {
      outsideSample.push(asNonEmptyString(document.muni) ?? "unknown");
      continue;
    }
    if (bySlug.has(slug)) throw new Error(`geo events: collection dupliquée pour ${slug}`);
    bySlug.set(slug, document);
    statuses.set(slug, source === "local_file" ? "geo_local_events_loaded" : "geo_collection_loaded");
  }
  for (const slug of RECALL_SAMPLE_MUNICIPALITIES) {
    if (!statuses.has(slug)) statuses.set(slug, missingStatus);
  }
  return { source, bySlug, statuses, errors: new Map(), outsideSample: outsideSample.sort() };
}

function loadLocalGeoDocuments(path: string): LoadedGeoDocuments {
  return indexGeoDocuments(
    parseZoningEventsDocuments(readJson(path), displayPath(rootRelativePath(path))),
    "local_file",
    "geo_collection_not_in_local_input",
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function loadS3GeoDocuments(): Promise<LoadedGeoDocuments> {
  const documents: ZoningEventsDocument[] = [];
  const statuses = new Map<RecallSampleMunicipality, GeoCollectionStatus>();
  const errors = new Map<RecallSampleMunicipality, string>();
  let store: ReturnType<typeof s3ZoningEventsStore>;
  try {
    store = s3ZoningEventsStore();
  } catch (error) {
    const message = errorText(error);
    for (const slug of RECALL_SAMPLE_MUNICIPALITIES) {
      statuses.set(slug, "geo_read_error");
      errors.set(slug, message);
    }
    return { source: "s3", bySlug: new Map(), statuses, errors, outsideSample: [] };
  }
  for (const slug of RECALL_SAMPLE_MUNICIPALITIES) {
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
      if (sampleSlug(document.muni) !== slug) {
        throw new Error(`S3 qc-zoning-events-${slug}: muni '${String(document.muni)}' ne correspond pas à la collection`);
      }
      documents.push(document);
      statuses.set(slug, "geo_collection_loaded");
    } catch (error) {
      statuses.set(slug, "geo_read_error");
      errors.set(slug, errorText(error));
    }
  }
  const indexed = indexGeoDocuments(documents, "s3", "geo_collection_absent");
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

function recallFor(partition: EventSetPartition): { recall: number | null; state: "measured" | "no_immo_ground_truth" } {
  const denominator = partition.matched.length + partition.missed.length;
  if (denominator === 0) return { recall: null, state: "no_immo_ground_truth" };
  return { recall: partition.matched.length / denominator, state: "measured" };
}

function markdown(report: RecallGateReport): string {
  const cityRows = report.cities.map((city) => {
    const recall = city.recall === null ? "unknown (no_immo_ground_truth)" : city.recall.toFixed(4);
    return `| ${city.slug} | ${city.geo_collection_status} | ${city.matched} | ${city.missed} | ${city.extra} | ${recall} |`;
  });
  const exceptions = report.cities.flatMap((city) => [
    ...city.partition.missed.map((entry) => `- missed ${city.slug}: ${JSON.stringify(entry.immo)}`),
    ...city.partition.extra.map((entry) => `- extra ${city.slug}: ${JSON.stringify(entry.geo)}`),
  ]);
  const aggregateRecall = report.aggregate.recall === null ? "unknown (no_immo_ground_truth)" : report.aggregate.recall.toFixed(4);
  return [
    "# Recall gate qc-zoning-events vs DesignationEvents immo",
    "",
    "Mesure read-only du rappel event-set sur l’échantillon contractuel. Les correspondances sont EXACTES et unicité-gatées; aucune clé incomplète ou ambiguë n’est forcée.",
    "",
    `Seuil : ${report.threshold}. Rappel agrégé : ${aggregateRecall}. État du gate : ${report.gate.status}.`,
    "",
    "| Ville | État geo | Matched | Missed | Extra | Recall |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
    ...cityRows,
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
  const output = outputPath(options.outPath, ".json");
  const markdownOutput = outputPath(options.markdownPath, ".md");
  const immoPath = rootRelativePath(options.immoEventsPath);
  const immoEvents = parseImmoDesignationEvents(readJson(options.immoEventsPath));
  const geo = options.geoEventsPath === undefined ? await loadS3GeoDocuments() : loadLocalGeoDocuments(options.geoEventsPath);
  const cities: CityRecall[] = [];
  const immoEventsOutsideSample: NaturalKeyEvent[] = [];

  for (const event of immoEvents) {
    if (sampleSlug(event.natural_key.muni) === null) immoEventsOutsideSample.push(event);
  }

  for (const slug of RECALL_SAMPLE_MUNICIPALITIES) {
    const document = geo.bySlug.get(slug);
    const geoEvents = document === undefined ? [] : document.events.map(parseGeoEvent);
    const cityImmoEvents = immoEvents.filter((event) => event.natural_key.muni === slug);
    const partition = partitionEventSets(geoEvents, cityImmoEvents);
    const measurement = recallFor(partition);
    cities.push({
      slug,
      geo_collection_status: geo.statuses.get(slug)!,
      geo_read_error: geo.errors.get(slug) ?? null,
      partition,
      matched: partition.matched.length,
      missed: partition.missed.length,
      extra: partition.extra.length,
      immo_events: cityImmoEvents.length,
      geo_events: geoEvents.length,
      recall: measurement.recall,
      recall_state: measurement.state,
    });
  }

  const aggregatePartition: EventSetPartition = {
    matched: cities.flatMap((city) => city.partition.matched),
    missed: cities.flatMap((city) => city.partition.missed),
    extra: cities.flatMap((city) => city.partition.extra),
  };
  const aggregateMeasurement = recallFor(aggregatePartition);
  const totalGeoEvents = cities.reduce((total, city) => total + city.geo_events, 0);
  const hasGeoReadError = cities.some((city) => city.geo_collection_status === "geo_read_error");
  const states: string[] = [];
  let gate: RecallGateReport["gate"];
  if (hasGeoReadError) {
    states.push("geo_read_error");
    gate = { status: "geo_read_error", exit_code: 2 };
  } else if (totalGeoEvents === 0) {
    states.push("baseline_geo_not_producing_yet");
    gate = { status: "baseline_geo_not_producing_yet", exit_code: 0 };
  } else if (aggregateMeasurement.recall === null) {
    states.push("no_immo_ground_truth");
    gate = { status: "no_immo_ground_truth", exit_code: 0 };
  } else if (aggregateMeasurement.recall < RECALL_THRESHOLD) {
    states.push("recall_below_threshold");
    gate = { status: "recall_below_threshold", exit_code: 1 };
  } else {
    states.push("recall_at_or_above_threshold");
    gate = { status: "recall_at_or_above_threshold", exit_code: 0 };
  }
  if (immoEventsOutsideSample.length > 0) states.push("immo_events_outside_sample");
  if (geo.outsideSample.length > 0) states.push("geo_documents_outside_sample");

  const report: RecallGateReport = {
    contract: "qc-zoning-events-recall-gate/v1",
    generated_at: options.generatedAt ?? new Date().toISOString(),
    read_only_aggregation: true,
    sample_municipalities: RECALL_SAMPLE_MUNICIPALITIES,
    natural_key_definition: {
      tuple: "(muni, source_url_norm, date_iso, type)",
      source_url_normalization: "trim; lowercase host; remove trailing pathname slash; remove utm_*, fbclid, gclid, mc_cid, mc_eid, _ga, _gl, ref, source, download, cache, timestamp, ts; sort retained query pairs",
      matching: "exact_only_unique_gated",
      secondary_key: "(muni, bylaw_numero_norm, type, date_iso), only when non-null on both sides",
    },
    threshold: RECALL_THRESHOLD,
    input: {
      geo: geo.source,
      geo_events_path: options.geoEventsPath === undefined ? null : displayPath(rootRelativePath(options.geoEventsPath)),
      immo_events_path: displayPath(immoPath),
    },
    states,
    cities,
    aggregate: {
      matched: aggregatePartition.matched.length,
      missed: aggregatePartition.missed.length,
      extra: aggregatePartition.extra.length,
      immo_events: aggregatePartition.matched.length + aggregatePartition.missed.length,
      geo_events: aggregatePartition.matched.length + aggregatePartition.extra.length,
      geo_read_error_count: cities.filter((city) => city.geo_collection_status === "geo_read_error").length,
      recall: aggregateMeasurement.recall,
      recall_state: aggregateMeasurement.state,
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
  const stamp = timestampForFilename(new Date());
  const result = await runRecallGate({
    ...(geoEventsPath === undefined ? {} : { geoEventsPath }),
    immoEventsPath,
    outPath: argumentValue("--out") ?? `work/coverage/zoning-events-recall-gate-${stamp}.json`,
    markdownPath: argumentValue("--markdown") ?? `work/coverage/zoning-events-recall-gate-${stamp}.md`,
  });
  process.stdout.write(`${JSON.stringify({
    json: displayPath(result.output),
    markdown: displayPath(result.markdownOutput),
    matched: result.report.aggregate.matched,
    missed: result.report.aggregate.missed,
    extra: result.report.aggregate.extra,
    immo_events: result.report.aggregate.immo_events,
    geo_events: result.report.aggregate.geo_events,
    recall: result.report.aggregate.recall,
    gate: result.report.gate.status,
    exit_code: result.exitCode,
  })}\n`);
  process.exitCode = result.exitCode;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${errorText(error)}\n`);
    process.exitCode = 2;
  });
}
