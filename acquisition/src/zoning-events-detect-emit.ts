/**
 * Dry-run spine for the neutral `qc-zoning-events-<slug>` collection.
 *
 * This module intentionally has no S3 PUT path.  Source adapters provide only
 * source-grounded candidates; this spine owns the stable event identity, the
 * exact-only zone join, validation, and local dry-run artefacts.  Publishing
 * remains the separate, explicit `serveZoningEvents` operation.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getBytes, s3Client } from "./lib/s3.js";
import {
  computeEventId,
  resolveZonesExact,
  validateZoningEvent,
  type ZoneMention,
  type ZoningEvent,
  type ZoningEventType,
  type ZoningEventsDocument,
} from "./zoning-events-emit.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";

/**
 * A source-proven candidate, before the served-zone exact join.
 *
 * `source_ref` and `detection_anchor` are the complete stable identity input:
 * neither a moving bylaw number nor a scan ordinal is allowed to replace them.
 * `extrait_brut` is copied verbatim from the source artifact; candidates with
 * no proof span are rejected rather than made plausible by the emitter.
 */
export interface DetectedEventCandidate {
  readonly source_ref: string;
  readonly detection_anchor: string;
  readonly type: ZoningEventType;
  readonly date_iso: string;
  readonly bylaw_numero: string | null;
  readonly zone_mentions: readonly ZoneMention[];
  readonly extrait_brut: string;
  readonly url_pdf: string;
}

/**
 * Extension seam for PV, avis-publics, CPTAQ, and transcript adapters.
 *
 * An adapter may read captured evidence, but it must never publish.  It
 * returns an empty array when its corpus has no source-grounded candidate;
 * that state is made visible in the dry-run manifest, not patched with a
 * synthetic event.
 */
export interface ZoningEventSourceAdapter {
  name: string;
  detect(citySlug: string): Promise<DetectedEventCandidate[]>;
}

export type ServedZoneCodesResult =
  | { readonly state: "loaded"; readonly zoneCodes: readonly string[]; readonly sourceKey: string }
  | { readonly state: "unavailable"; readonly reason: string };

/** Read-only boundary for the real served `qc-zonage-<slug>` code set. */
export interface ServedZoneCodesReader {
  read(citySlug: string): Promise<ServedZoneCodesResult>;
}

export interface CityDryRunResult {
  readonly citySlug: string;
  readonly adapter: string;
  readonly candidates_detected: number;
  readonly events_emitted: number;
  readonly zones_resolus_exact_geom: number;
  readonly zones_non_resolus: number;
  readonly zone_set:
    | { readonly state: "loaded"; readonly source_key: string; readonly zone_codes_count: number }
    | { readonly state: "unavailable"; readonly reason: string };
  readonly output: string;
}

export interface ZoningEventsDryRunManifest {
  readonly contract: "qc-zoning-events-dryrun/v1";
  readonly mode: "dry-run-no-s3-put";
  readonly generated_at: string;
  readonly adapter: string;
  /** One array-of-documents input directly consumable by the recall gate. */
  readonly documents_output: string;
  readonly cities: readonly CityDryRunResult[];
}

export interface RunZoningEventsDryRunOptions {
  readonly cities: readonly string[];
  readonly adapter: ZoningEventSourceAdapter;
  readonly servedZoneCodes: ServedZoneCodesReader;
  readonly outputDirectory: string;
  readonly generatedAt?: string;
}

interface FeatureCollection {
  readonly type: "FeatureCollection";
  readonly features: readonly { readonly properties?: Record<string, unknown> | null }[];
}

function dateOnly(isoTimestamp: string): string {
  const date = isoTimestamp.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw new Error(`as_of invalide: ${isoTimestamp}`);
  return date;
}

function nonEmpty(value: string, field: string, citySlug: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${citySlug}: candidat sans ${field}`);
  return trimmed;
}

function assertCandidate(candidate: DetectedEventCandidate, citySlug: string): void {
  nonEmpty(candidate.source_ref, "source_ref", citySlug);
  nonEmpty(candidate.detection_anchor, "detection_anchor", citySlug);
  nonEmpty(candidate.extrait_brut, "extrait_brut verbatim", citySlug);
  nonEmpty(candidate.url_pdf, "url_pdf", citySlug);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(candidate.date_iso)) {
    throw new Error(`${citySlug}: candidat date_iso invalide (${candidate.date_iso})`);
  }
  for (const mention of candidate.zone_mentions) nonEmpty(mention.mention_brute, "zone_mentions[].mention_brute", citySlug);
}

function unresolvedWithoutZoneSet(mentions: readonly ZoneMention[]) {
  return mentions.map((mention) => ({
    mention_brute: mention.mention_brute,
    page: mention.page,
    raison: "detection-incomplete" as const,
  }));
}

/**
 * Convert candidates to one complete local document.  The only resolution
 * operation is `resolveZonesExact`; absence of a served set is explicit in
 * every unresolved mention and never treated as an empty, successful join.
 */
export function buildZoningEventsDryRunDocument(
  citySlug: string,
  candidates: readonly DetectedEventCandidate[],
  servedZones: ServedZoneCodesResult,
  generatedAt: string,
): ZoningEventsDocument {
  const asOfDate = dateOnly(generatedAt);
  const ids = new Set<string>();
  const events: ZoningEvent[] = candidates.map((candidate) => {
    assertCandidate(candidate, citySlug);
    const eventId = computeEventId(citySlug, candidate.source_ref, candidate.detection_anchor);
    if (ids.has(eventId)) {
      throw new Error(`${citySlug}: candidats dupliqués pour event_id ${eventId}; ancre stable non unique`);
    }
    ids.add(eventId);

    const zones = servedZones.state === "loaded"
      ? resolveZonesExact(candidate.zone_mentions, servedZones.zoneCodes, { as_of_date: asOfDate })
      : { resolved: [], unresolved: unresolvedWithoutZoneSet(candidate.zone_mentions) };
    const event: ZoningEvent = {
      event_id: eventId,
      version: 1,
      supersedes: null,
      state: "active",
      muni: citySlug,
      bylaw_numero: candidate.bylaw_numero,
      type: candidate.type,
      date_iso: candidate.date_iso,
      detection_state: servedZones.state === "loaded" ? "detected" : "detection_incomplete",
      zone_codes_resolus: zones.resolved,
      zone_codes_non_resolus: zones.unresolved,
      nb_unites_max: null,
      effet_densifiant_ref: null,
      url_pdf: candidate.url_pdf,
      extrait_brut: candidate.extrait_brut,
      confidence: 1,
      provenance: {
        producer: "geo/zoning-events-detect-emit",
        source_span: candidate.extrait_brut,
        source_url: candidate.url_pdf,
        as_of_date: asOfDate,
      },
    };
    validateZoningEvent(event);
    return event;
  });

  return {
    type: "FeatureCollection",
    as_of: generatedAt,
    complete: true,
    muni: citySlug,
    events,
    features: events.map((event) => ({ type: "Feature", geometry: null, properties: event })),
  };
}

/** Read the selected nested layout first, matching geo-api's serving rule. */
export function servedZonageKeys(citySlug: string): readonly string[] {
  const name = `qc-zonage-${citySlug}`;
  return [`${ZONAGE_PREFIX}${name}/${name}.geojson`, `${ZONAGE_PREFIX}${name}.geojson`];
}

function parseZoneCodes(body: Buffer, key: string): readonly string[] {
  let collection: FeatureCollection;
  try {
    collection = JSON.parse(body.toString("utf8")) as FeatureCollection;
  } catch (error) {
    throw new Error(`${key}: JSON invalide (${error instanceof Error ? error.message : String(error)})`);
  }
  if (collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
    throw new Error(`${key}: FeatureCollection requis`);
  }
  const codes = collection.features.map((feature, index) => {
    const code = feature.properties?.zone_code;
    if (typeof code !== "string" || !code.trim()) throw new Error(`${key}.features[${index}].properties.zone_code manquant`);
    return code.trim();
  });
  if (codes.length === 0) throw new Error(`${key}: zone set vide`);
  return codes;
}

/** Production reader is read-only; it never imports or exposes any PUT primitive. */
export function s3ServedZoneCodesReader(): ServedZoneCodesReader {
  return {
    async read(citySlug) {
      const s3 = s3Client();
      const failures: string[] = [];
      for (const key of servedZonageKeys(citySlug)) {
        try {
          return { state: "loaded", zoneCodes: parseZoneCodes(await getBytes(s3, key), key), sourceKey: key };
        } catch (error) {
          failures.push(`${key}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      return { state: "unavailable", reason: failures.join(" | ") };
    },
  };
}

function outputPath(directory: string, filename: string): string {
  const path = resolve(directory, filename);
  if (!path.startsWith(`${ROOT}/`)) throw new Error(`sortie hors dépôt: ${path}`);
  if (existsSync(path)) throw new Error(`refus d'écraser l'artefact: ${path}`);
  return path;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

/** Run all requested cities locally.  No `serveZoningEvents` call is made. */
export async function runZoningEventsDryRun(options: RunZoningEventsDryRunOptions): Promise<ZoningEventsDryRunManifest> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const uniqueCities = [...new Set(options.cities)];
  if (uniqueCities.length !== options.cities.length || uniqueCities.some((city) => !/^[a-z0-9-]+$/u.test(city))) {
    throw new Error("cities doit être une liste de slugs uniques [a-z0-9-]");
  }
  const results: CityDryRunResult[] = [];
  const documents: ZoningEventsDocument[] = [];
  for (const citySlug of uniqueCities) {
    const [candidates, zoneSet] = await Promise.all([options.adapter.detect(citySlug), options.servedZoneCodes.read(citySlug)]);
    const document = buildZoningEventsDryRunDocument(citySlug, candidates, zoneSet, generatedAt);
    const output = outputPath(options.outputDirectory, `${citySlug}.json`);
    writeJson(output, document);
    documents.push(document);
    results.push({
      citySlug,
      adapter: options.adapter.name,
      candidates_detected: candidates.length,
      events_emitted: document.events.length,
      zones_resolus_exact_geom: document.events.reduce((total, event) => total + event.zone_codes_resolus.length, 0),
      zones_non_resolus: document.events.reduce((total, event) => total + event.zone_codes_non_resolus.length, 0),
      zone_set: zoneSet.state === "loaded"
        ? { state: "loaded", source_key: zoneSet.sourceKey, zone_codes_count: zoneSet.zoneCodes.length }
        : zoneSet,
      output,
    });
  }
  const documentsOutput = outputPath(options.outputDirectory, "documents.json");
  writeJson(documentsOutput, documents);
  const manifest: ZoningEventsDryRunManifest = {
    contract: "qc-zoning-events-dryrun/v1",
    mode: "dry-run-no-s3-put",
    generated_at: generatedAt,
    adapter: options.adapter.name,
    documents_output: documentsOutput,
    cities: results,
  };
  writeJson(outputPath(options.outputDirectory, "manifest.json"), manifest);
  return manifest;
}

function argumentValue(name: string): string | undefined {
  const args = process.argv.slice(2);
  const equals = args.find((argument) => argument.startsWith(`${name}=`));
  if (equals !== undefined) return equals.slice(name.length + 1);
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

async function main(): Promise<void> {
  const { pvCorpsGraphifySemanticAdapter } = await import("./zoning-events-source-pv-corps.js");
  const citiesRaw = argumentValue("--cities");
  if (!citiesRaw) throw new Error("--cities=slug-a,slug-b est requis");
  const outputDirectory = argumentValue("--out") ?? "work/coverage/qc-zoning-events-dryrun";
  const result = await runZoningEventsDryRun({
    cities: citiesRaw.split(",").map((city) => city.trim()).filter(Boolean),
    adapter: pvCorpsGraphifySemanticAdapter(),
    servedZoneCodes: s3ServedZoneCodesReader(),
    outputDirectory,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
