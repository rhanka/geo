/**
 * Fold retained zone-source provenance onto the served qc-zonage GeoJSONs.
 *
 * Immo reads zone-feature properties, not the coverage reports. This tool stamps
 * the retained historical geometry URL (or an honest null) plus its reported
 * proof level on every served zone feature.
 *
 * The normal mode is additive: it touches only `zone_source_url` and
 * `zone_source_level`. `--strip` is the only mode which deletes those fields.
 * A changed served object is copied to a timestamped backup first, then written
 * through the guarded served-zone helper and read back feature-by-feature.
 *
 * Usage (from acquisition/):
 *   npx tsx src/fold-zone-source-provenance-to-zonage.ts --all --dry-run
 *   npx tsx src/fold-zone-source-provenance-to-zonage.ts --all
 *   npx tsx src/fold-zone-source-provenance-to-zonage.ts --slugs saguenay,dunham
 *   npx tsx src/fold-zone-source-provenance-to-zonage.ts --all --strip
 *
 * Source input priority:
 *   1. a unique `work/coverage/zone-source-links*.json` export, or an explicit
 *      `--source-links <path>` export;
 *   2. the committed 2026-07-22 provenance reports, joined through the manifest.
 *
 * URLs are copied verbatim from retained fields only. In particular, a local
 * file path and a WFS service root + layer name are not promoted into a URL.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { S3Client } from "@aws-sdk/client-s3";

import { copyObject, exists, getBytes, s3Client } from "./lib/s3.js";
import { putServedZoneAdditive } from "./lib/zonage-proof.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const COVERAGE_DIR = resolve(ROOT, "work", "coverage");
const LEGACY_REPORT = resolve(COVERAGE_DIR, "proof-legacy-515-historical-20260722.json");
const ORPHAN_REPORT = resolve(COVERAGE_DIR, "proof-orphan-356-reconciliation-20260722.json");
const MANIFEST = resolve(COVERAGE_DIR, "zone-provenance-status-manifest-20260722.json");
const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";
const BACKUP_PREFIX = `${ZONAGE_PREFIX}_zone-source-fold-backups/`;
const URL_FIELD = "zone_source_url";
const LEVEL_FIELD = "zone_source_level";

export type ZoneSourceLevel = "historical-verified" | "legacy-traceable" | "candidate" | "orphan" | "unknown";

export interface ZoneSourceLink {
  slug: string;
  collectionKey: string;
  url: string | null;
  level: ZoneSourceLevel;
  evidenceRef: string | null;
}

type JsonRecord = Record<string, unknown>;
type Feature = { properties?: Record<string, unknown> | null } & Record<string, unknown>;
type FeatureCollection = { type?: unknown; features?: Feature[] } & Record<string, unknown>;

interface Args {
  slugs: string[];
  all: boolean;
  dryRun: boolean;
  strip: boolean;
  sourceLinks: string | null;
}

interface ObjectResult {
  key: string;
  features: number;
  changed: boolean;
  backupMade: boolean;
  readbackVerified: boolean;
  error: string | null;
}

interface SlugResult {
  slug: string;
  url: string | null;
  level: ZoneSourceLevel;
  objects: ObjectResult[];
  error: string | null;
}

function fail(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) fail(`${label} must be a non-empty string`);
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  return asString(value, label);
}

function sourceLevel(value: unknown, label: string): ZoneSourceLevel {
  switch (value) {
    case "historical-verified":
    case "legacy-traceable":
    case "orphan":
    case "unknown":
      return value;
    case "candidate":
    case "candidate-needs-human-confirmation":
      return "candidate";
    default:
      fail(`${label} has unsupported provenance state ${JSON.stringify(value)}`);
  }
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function reportCollectionKey(row: JsonRecord, source: "h" | "q"): string {
  return asString(source === "h" ? row.key : row.collection_key, `${source} report collection key`);
}

function positionalRows(report: JsonRecord, label: string): JsonRecord[] {
  const fields = report.row_fields;
  const rows = report.rows;
  if (!Array.isArray(fields) || !Array.isArray(rows) || !fields.every((field) => typeof field === "string")) {
    fail(`${label} must have string row_fields and rows`);
  }
  return rows.map((row, index) => {
    if (!Array.isArray(row) || row.length !== fields.length) fail(`${label} row ${index} does not match row_fields`);
    return Object.fromEntries(fields.map((field, fieldIndex) => [field, row[fieldIndex]]));
  });
}

/**
 * Deterministically derive the source links from the three retained reports.
 * The manifest's source_identity_ref is the authority for the exact 871-row
 * join; this deliberately avoids a weak slug-only cross-report lookup.
 */
export function deriveFallbackSourceLinks(
  legacyInput: unknown = readJson(LEGACY_REPORT),
  orphanInput: unknown = readJson(ORPHAN_REPORT),
  manifestInput: unknown = readJson(MANIFEST),
): ZoneSourceLink[] {
  if (!isRecord(legacyInput) || legacyInput.contract !== "proof-legacy-515-historical/v1" || !Array.isArray(legacyInput.collections)) {
    fail("unexpected legacy provenance report contract");
  }
  if (!isRecord(orphanInput) || orphanInput.contract !== "proof-orphan-reconciliation/v1" || !Array.isArray(orphanInput.collections)) {
    fail("unexpected orphan provenance report contract");
  }
  if (!isRecord(manifestInput) || manifestInput.contract !== "zone-provenance-status-manifest/r2") {
    fail("unexpected provenance manifest contract");
  }

  const legacy = legacyInput.collections.map((row, index) => {
    if (!isRecord(row)) fail(`legacy report collection ${index} is invalid`);
    return row;
  });
  const orphan = orphanInput.collections.map((row, index) => {
    if (!isRecord(row)) fail(`orphan report collection ${index} is invalid`);
    return row;
  });
  const rows = positionalRows(manifestInput, "provenance manifest");
  if (legacy.length !== 515 || orphan.length !== 356 || rows.length !== 871) {
    fail(`unexpected provenance report cardinality legacy=${legacy.length} orphan=${orphan.length} manifest=${rows.length}`);
  }

  const links = rows.map((manifestRow, index) => {
    const slug = asString(manifestRow.slug, `manifest row ${index} slug`);
    const collectionKey = asString(manifestRow.collection_key, `manifest row ${index} collection_key`);
    const ref = asString(manifestRow.source_identity_ref, `manifest row ${index} source_identity_ref`);
    const match = /^(h|q):(\d+):i$/.exec(ref);
    if (!match) fail(`manifest row ${slug} has unsupported source_identity_ref ${JSON.stringify(ref)}`);
    const source = match[1]! as "h" | "q";
    const reportIndex = Number(match[2]);
    const reportRow = (source === "h" ? legacy : orphan)[reportIndex];
    if (!reportRow) fail(`manifest row ${slug} references missing ${ref}`);
    if (asString(reportRow.slug, `${ref} slug`) !== slug || reportCollectionKey(reportRow, source) !== collectionKey) {
      fail(`manifest row ${slug} does not match ${ref}`);
    }

    const level = sourceLevel(reportRow.classification, `${ref} classification`);
    if (sourceLevel(manifestRow.provenance_state, `manifest row ${slug} provenance_state`) !== level) {
      fail(`manifest row ${slug} provenance state disagrees with ${ref}`);
    }

    let url: string | null = null;
    if (source === "h") {
      const identity = reportRow.candidate_source_identity;
      if (!isRecord(identity)) fail(`${ref} candidate_source_identity is invalid`);
      // This is the retained URL component, copied exactly. `exact` may append
      // a human annotation or selector and is an identity, not a rewritten URL.
      url = nullableString(identity.url_component, `${ref} candidate_source_identity.url_component`);
    } else if (isRecord(reportRow.source_identity)) {
      // Only an already-complete `url` is a source URL. A WFS service_root plus
      // type_name is deliberately NOT combined into a new endpoint.
      url = nullableString(reportRow.source_identity.url, `${ref} source_identity.url`);
    }

    return { slug, collectionKey, url, level, evidenceRef: ref };
  });
  assertUniqueLinks(links, "fallback provenance reports");
  return links.sort((left, right) => left.slug.localeCompare(right.slug));
}

function exportRows(input: unknown, label: string): JsonRecord[] {
  if (!isRecord(input)) fail(`${label} must be an object`);
  if (Array.isArray(input.rows)) {
    if (Array.isArray(input.row_fields)) return positionalRows(input, label);
    if (input.rows.every(isRecord)) return input.rows;
  }
  if (Array.isArray(input.collections) && input.collections.every(isRecord)) return input.collections;
  fail(`${label} must contain object rows or collections`);
}

/** Load the simple city-link export contract when a producer has emitted it. */
export function parseSourceLinkExport(input: unknown, label = "source-link export"): ZoneSourceLink[] {
  const rows = exportRows(input, label);
  const links = rows.map((row, index) => {
    const slug = asString(row.slug, `${label} row ${index} slug`);
    const collectionKey = asString(row.collection_key, `${label} row ${index} collection_key`);
    if (!owns(row, "retained_source_url")) fail(`${label} row ${slug} is missing retained_source_url`);
    if (!owns(row, "evidence_ref")) fail(`${label} row ${slug} is missing evidence_ref`);
    const url = nullableString(row.retained_source_url, `${label} row ${slug} retained_source_url`);
    const level = sourceLevel(row.provenance_state, `${label} row ${slug} provenance_state`);
    const evidenceRef = asString(row.evidence_ref, `${label} row ${slug} evidence_ref`);
    return { slug, collectionKey, url, level, evidenceRef };
  });
  if (links.length === 0) fail(`${label} has no rows`);
  assertUniqueLinks(links, label);
  return links.sort((left, right) => left.slug.localeCompare(right.slug));
}

function assertUniqueLinks(links: ZoneSourceLink[], label: string): void {
  const slugs = new Set<string>();
  const keys = new Set<string>();
  for (const link of links) {
    if (!zonageKeyCandidates(link.slug).includes(link.collectionKey)) {
      fail(`${label} has a collection key which does not belong to slug ${link.slug}`);
    }
    if (slugs.has(link.slug)) fail(`${label} has duplicate slug ${link.slug}`);
    if (keys.has(link.collectionKey)) fail(`${label} has duplicate collection key ${link.collectionKey}`);
    slugs.add(link.slug);
    keys.add(link.collectionKey);
  }
}

function sourceLinkExportPath(explicit: string | null): string | null {
  if (explicit) return resolve(ROOT, explicit);
  const candidates = readdirSync(COVERAGE_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^zone-source-links(?:[-.][a-z0-9][a-z0-9.-]*)?\.json$/i.test(entry.name))
    .map((entry) => resolve(COVERAGE_DIR, entry.name))
    .sort();
  if (candidates.length > 1) fail(`multiple zone source-link exports found; pass --source-links explicitly: ${candidates.join(", ")}`);
  return candidates[0] ?? null;
}

/** `--all` must never be silently narrowed by a partial/stale source-link export. */
export function assertCompleteAllCoverage(links: ZoneSourceLink[]): void {
  const expected = deriveFallbackSourceLinks();
  if (links.length !== expected.length) {
    fail(`source-link export has ${links.length} collections; --all requires the complete ${expected.length}-collection provenance manifest`);
  }
  const bySlug = new Map(links.map((link) => [link.slug, link]));
  for (const row of expected) {
    const actual = bySlug.get(row.slug);
    if (!actual || actual.collectionKey !== row.collectionKey) {
      fail(`source-link export does not cover manifest collection ${row.slug} (${row.collectionKey}); refuse --all`);
    }
  }
}

export function loadSourceLinks(explicitPath: string | null, requireCompleteAllCoverage = false): { links: ZoneSourceLink[]; input: string } {
  const exportPath = sourceLinkExportPath(explicitPath);
  if (exportPath) {
    if (!existsSync(exportPath)) fail(`source-link export does not exist: ${exportPath}`);
    const links = parseSourceLinkExport(readJson(exportPath), exportPath);
    if (requireCompleteAllCoverage) assertCompleteAllCoverage(links);
    return { links, input: exportPath };
  }
  return { links: deriveFallbackSourceLinks(), input: "fallback: legacy + orphan + manifest reports" };
}

function parseArgs(argv: string[]): Args {
  const slugs: string[] = [];
  let all = false;
  let dryRun = false;
  let strip = false;
  let sourceLinks: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const next = (): string => {
      const value = argv[++index];
      if (!value || value.startsWith("--")) fail(`missing value after ${arg}`);
      return value;
    };
    if (arg === "--slugs") slugs.push(...next().split(",").map((slug) => slug.trim()).filter(Boolean));
    else if (arg === "--all") all = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--strip") strip = true;
    else if (arg === "--source-links") sourceLinks = next();
    else fail(`unknown argument: ${arg}`);
  }
  if (all && slugs.length > 0) fail("pass either --all or --slugs, not both");
  if (!all && slugs.length === 0) fail("pass --all or --slugs <slug,...>");
  return { slugs: [...new Set(slugs)].sort(), all, dryRun, strip, sourceLinks };
}

function zonageKeyCandidates(slug: string): string[] {
  return [
    `${ZONAGE_PREFIX}qc-zonage-${slug}.geojson`,
    `${ZONAGE_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`,
  ];
}

async function retryS3<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  // A full fold reaches hundreds of objects. Keep retries bounded and local so
  // transient object-store timeouts do not turn into a false provenance gap.
  for (const delay of [0, 250, 750, 1500]) {
    if (delay > 0) await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, delay));
    try {
      return await operation();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function zonageKeys(s3: S3Client, slug: string): Promise<string[]> {
  const keys: string[] = [];
  for (const key of zonageKeyCandidates(slug)) if (await retryS3(() => exists(s3, key))) keys.push(key);
  return keys;
}

function parseFeatureCollection(bytes: Buffer, key: string): FeatureCollection {
  const value = JSON.parse(bytes.toString("utf8")) as unknown;
  if (!isRecord(value) || value.type !== "FeatureCollection" || !Array.isArray(value.features)) {
    fail(`${key} is not a GeoJSON FeatureCollection`);
  }
  for (const [index, feature] of value.features.entries()) {
    if (!isRecord(feature)) fail(`${key} feature ${index} is not an object`);
    if (feature.properties !== undefined && feature.properties !== null && !isRecord(feature.properties)) {
      fail(`${key} feature ${index} properties is not an object or null`);
    }
  }
  return value as FeatureCollection;
}

function owns(object: object, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, field);
}

/** Apply normal additive fields, or strip only the two fields this tool owns. */
export function patchFeatures(
  collection: FeatureCollection,
  link: Pick<ZoneSourceLink, "url" | "level">,
  strip: boolean,
): { changed: boolean; changedProperties: number } {
  if (!Array.isArray(collection.features)) fail("FeatureCollection has no features");
  let changedProperties = 0;
  for (const feature of collection.features) {
    if (!isRecord(feature)) fail("FeatureCollection has a non-object feature");
    if (strip) {
      const properties = feature.properties;
      if (!isRecord(properties)) continue;
      for (const field of [URL_FIELD, LEVEL_FIELD]) {
        if (owns(properties, field)) {
          delete properties[field];
          changedProperties += 1;
        }
      }
      continue;
    }
    const properties = isRecord(feature.properties) ? feature.properties : {};
    feature.properties = properties;
    for (const [field, expected] of [[URL_FIELD, link.url], [LEVEL_FIELD, link.level]] as const) {
      if (!owns(properties, field) || properties[field] !== expected) {
        properties[field] = expected;
        changedProperties += 1;
      }
    }
  }
  return { changed: changedProperties > 0, changedProperties };
}

/** Verify own-property presence: a literal null is intentionally different from an absent URL. */
export function verifyPatchedFeatures(
  collection: FeatureCollection,
  link: Pick<ZoneSourceLink, "url" | "level">,
  strip: boolean,
): void {
  if (!Array.isArray(collection.features)) fail("FeatureCollection has no features");
  for (const [index, feature] of collection.features.entries()) {
    if (!isRecord(feature)) fail(`FeatureCollection feature ${index} is not an object`);
    const properties = feature.properties;
    if (strip) {
      if (isRecord(properties) && (owns(properties, URL_FIELD) || owns(properties, LEVEL_FIELD))) {
        fail(`feature ${index} still has stripped source provenance fields`);
      }
      continue;
    }
    if (!isRecord(properties) || !owns(properties, URL_FIELD) || !owns(properties, LEVEL_FIELD) ||
      properties[URL_FIELD] !== link.url || properties[LEVEL_FIELD] !== link.level) {
      fail(`feature ${index} source provenance fields do not match expected values`);
    }
  }
}

function backupKey(runTimestamp: string, key: string): string {
  const relative = key.startsWith(ZONAGE_PREFIX) ? key.slice(ZONAGE_PREFIX.length) : key;
  return `${BACKUP_PREFIX}${runTimestamp}/${relative.replaceAll("/", "__")}`;
}

async function processObject(
  s3: S3Client,
  key: string,
  link: ZoneSourceLink,
  args: Args,
  runTimestamp: string,
): Promise<ObjectResult> {
  const collection = parseFeatureCollection(await retryS3(() => getBytes(s3, key)), key);
  const patch = patchFeatures(collection, link, args.strip);
  const result: ObjectResult = {
    key,
    features: collection.features!.length,
    changed: patch.changed,
    backupMade: false,
    readbackVerified: false,
    error: null,
  };
  if (args.dryRun) return result;
  try {
    if (patch.changed) {
      // The additive proof gate re-reads the served object and refuses any
      // geometry or non-whitelisted-property difference. Its generic backup is
      // disabled: this fold's timestamped backup is the reversible record.
      await retryS3(() => copyObject(s3, key, backupKey(runTimestamp, key)));
      result.backupMade = true;
      await retryS3(() => putServedZoneAdditive(s3, key, collection, {
        allowedProps: [URL_FIELD, LEVEL_FIELD],
        backup: false,
      }));
    }
    // A no-op retry is still a real served-object readback, not merely an
    // in-memory assertion. It closes the gap after an interrupted prior run.
    const readback = parseFeatureCollection(await retryS3(() => getBytes(s3, key)), key);
    verifyPatchedFeatures(readback, link, args.strip);
    result.readbackVerified = true;
  } catch (error) {
    // Preserve evidence of a timestamped backup that may already exist when a
    // subsequent PUT/readback fails; the caller reports this exact partial state.
    result.error = errorText(error);
  }
  return result;
}

function showUrl(url: string | null): string {
  return url === null ? "null" : JSON.stringify(url);
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (isRecord(error)) {
    const name = typeof error.name === "string" ? error.name : null;
    const message = typeof error.message === "string" ? error.message : null;
    const status = isRecord(error.$metadata) && typeof error.$metadata.httpStatusCode === "number"
      ? ` HTTP ${error.$metadata.httpStatusCode}`
      : "";
    if (name || message || status) return `${name ?? "S3 error"}${status}${message ? `: ${message}` : ""}`;
  }
  return String(error) || "unknown error";
}

function dryDistribution(links: ZoneSourceLink[]): string {
  const levels: Record<ZoneSourceLevel, number> = {
    "historical-verified": 0,
    "legacy-traceable": 0,
    candidate: 0,
    orphan: 0,
    unknown: 0,
  };
  for (const link of links) levels[link.level] += 1;
  const nonNull = links.filter((link) => link.url !== null).length;
  return `DRY-DISTRIBUTION collections=${links.length} nonNullUrl=${nonNull} ` +
    `historical-verified=${levels["historical-verified"]} legacy-traceable=${levels["legacy-traceable"]} ` +
    `candidate=${levels.candidate} orphan=${levels.orphan} unknown=${levels.unknown}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const loaded = loadSourceLinks(args.sourceLinks, args.all);
  const bySlug = new Map(loaded.links.map((link) => [link.slug, link]));
  const slugs = args.all ? loaded.links.map((link) => link.slug) : args.slugs;
  const links = slugs.map((slug) => bySlug.get(slug) ?? {
    slug,
    collectionKey: zonageKeyCandidates(slug)[0]!,
    url: null,
    level: "unknown" as const,
    evidenceRef: null,
  });
  const s3 = s3Client();
  const runTimestamp = new Date().toISOString().replaceAll(":", "").replaceAll(".", "");
  const results: SlugResult[] = [];
  console.log(`zone-source-fold mode=${args.dryRun ? "dry-run" : args.strip ? "strip" : "apply"} input=${loaded.input} slugs=${links.length}`);

  const processSlug = async (link: ZoneSourceLink): Promise<void> => {
    try {
      const keys = await zonageKeys(s3, link.slug);
      if (keys.length === 0) {
        const error = "no served flat or subfolder qc-zonage key";
        results.push({ slug: link.slug, url: link.url, level: link.level, objects: [], error });
        console.log(`${args.dryRun ? "DRY" : "ERR"} ${link.slug} features=0 url=${showUrl(link.url)} level=${link.level} error=${error}`);
        return;
      }
      const objects: ObjectResult[] = [];
      for (const key of keys) {
        try {
          objects.push(await processObject(s3, key, link, args, runTimestamp));
        } catch (error) {
          const message = errorText(error);
          objects.push({ key, features: 0, changed: false, backupMade: false, readbackVerified: false, error: message });
        }
      }
      const errors = objects.filter((object) => object.error).map((object) => `${object.key}: ${object.error}`);
      const result: SlugResult = { slug: link.slug, url: link.url, level: link.level, objects, error: errors.length ? errors.join(" | ") : null };
      results.push(result);
      const featureSummary = objects.map((object) => `${object.features}@${object.key.slice(ZONAGE_PREFIX.length).includes("/") ? "subfolder" : "flat"}`).join(",");
      const changed = objects.filter((object) => object.changed).length;
      console.log(`${args.dryRun ? "DRY" : result.error ? "ERR" : "OK "} ${link.slug} features=${featureSummary} url=${showUrl(link.url)} level=${link.level} changedObjects=${changed}${result.error ? ` error=${result.error}` : ""}`);
    } catch (error) {
      const message = errorText(error);
      results.push({ slug: link.slug, url: link.url, level: link.level, objects: [], error: message });
      console.log(`${args.dryRun ? "DRY" : "ERR"} ${link.slug} features=0 url=${showUrl(link.url)} level=${link.level} error=${message}`);
    }
  };
  // Bound concurrent S3 reads/writes: `--all` spans the full 871-collection
  // served universe, while a single-slug mutation remains strictly ordered.
  const concurrency = 32;
  for (let start = 0; start < links.length; start += concurrency) {
    await Promise.all(links.slice(start, start + concurrency).map(processSlug));
  }

  if (args.dryRun) {
    console.log(dryDistribution(links));
    console.log(`DONE dry-run collections=${results.length} failures=${results.filter((result) => result.error).length}`);
    return;
  }
  const collectionsStamped = results.filter((result) => result.objects.some((object) => object.changed)).length;
  const collectionsComplete = results.filter((result) => !result.error).length;
  const backups = results.flatMap((result) => result.objects).filter((object) => object.backupMade).length;
  const verified = results.flatMap((result) => result.objects).filter((object) => object.readbackVerified).length;
  const failed = results.filter((result) => result.error);
  console.log(`DONE collectionsStamped=${collectionsStamped} collectionsComplete=${collectionsComplete} backups=${backups} readbackVerified=${verified} failed=${failed.length}`);
  for (const result of failed) console.log(`FAILED ${result.slug} ${result.error}`);
  if (failed.length > 0) throw new Error(`zone-source fold incomplete: ${failed.length} collection(s) failed`);
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
