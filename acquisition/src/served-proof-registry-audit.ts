/**
 * Global, read-only census of the physical and logically served qc-zonage / qc-lots
 * corpus. Both canonical flat and mirrored nested keys are read. Flat wins only
 * when computing the logical serving view, matching the existing consumers.
 *
 * The source registry is deliberately narrow: it records URLs only from the
 * dedicated v2 `geometry_source` field or the legacy v1
 * `proof.sources.geometry.upstream_uri` field. Generic `url`, `source`, home-page,
 * regulation and S3 fields are never promoted to geometry evidence.
 *
 * Usage:
 *   npx tsx src/served-proof-registry-audit.ts \
 *     --out ../work/coverage/served-proof-registry.json \
 *     --summary-out ../work/coverage/served-proof-summary.json
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import type { S3Client } from "@aws-sdk/client-s3";
import { getBytes, listSlugs, s3Client } from "./lib/s3.js";
import {
  assertGeometryProof,
  isRealGeometryUrl,
  sameGeometryProof,
  type GeometrySourceProof,
} from "./lib/zonage-proof.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const ZONES = "normalized/ca-qc-zonage/";
const LOTS = "normalized/qc-lots/";

type Props = Record<string, unknown>;
type Feature = { properties?: Props | null };
type FC = {
  type?: unknown;
  features?: Feature[];
  proof?: { schema_version?: unknown; geometry_source?: unknown };
};
export type SourceCategory = "exact_source_eligible" | "recoverable" | "quarantine";
export type Layout = "flat" | "nested";
export type KeyChoice = { slug: string; key: string; layout: Layout; alternatives: string[] };
type Evidence = { url: string; field: string; proof?: GeometrySourceProof };
type SourceCount = { url: string; evidence_fields: Set<string>; features_attesting: number; proof?: GeometrySourceProof };
type Failure = { call: string; error: string };
type CollectionRow = {
  slug: string;
  key: string;
  layout: Layout;
  status: SourceCategory;
  features: number | null;
  feature_categories: Record<string, number>;
  evidence_urls: string[];
  reason?: string;
  zoning_allowed?: number;
  zoning_suppressed?: number;
  suppression_reasons?: Record<string, number>;
  eligibleCodes?: Set<string>;
  sources?: SourceCount[];
};

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
function errorText(e: unknown): string {
  const x = e as { name?: unknown; message?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return `${String(x?.name ?? "Error")}: ${String(x?.message ?? e)}${x?.$metadata?.httpStatusCode ? ` (HTTP ${x.$metadata.httpStatusCode})` : ""}`;
}
async function retry<T>(call: string, fn: () => Promise<T>, failures: Failure[], tries = 4): Promise<T | null> {
  let last: unknown;
  for (let n = 0; n < tries; n++) {
    try { return await fn(); }
    catch (e) { last = e; if (n + 1 < tries) await sleep(250 * 2 ** n); }
  }
  failures.push({ call, error: errorText(last) });
  return null;
}

export function slugFrom(rest: string, stem: string): { slug: string; layout: Layout } | null {
  let match = rest.match(new RegExp(`^${stem}-([a-z0-9-]+)$`));
  if (match) return { slug: match[1]!, layout: "flat" };
  match = rest.match(new RegExp(`^${stem}-([a-z0-9-]+)/${stem}-\\1$`));
  return match ? { slug: match[1]!, layout: "nested" } : null;
}

export function resolveKeys(rests: string[], stem: string, prefix: string): {
  choices: KeyChoice[];
  physicalChoices: KeyChoice[];
  physical: { flat: number; nested: number; ignored: number; total: number };
} {
  const grouped = new Map<string, Partial<Record<Layout, string>>>();
  let ignored = 0;
  for (const rest of rests) {
    const parsed = slugFrom(rest, stem);
    if (!parsed) { ignored++; continue; }
    const keys = grouped.get(parsed.slug) ?? {};
    keys[parsed.layout] = `${prefix}${rest}.geojson`;
    grouped.set(parsed.slug, keys);
  }
  const choices: KeyChoice[] = [];
  const physicalChoices: KeyChoice[] = [];
  for (const [slug, keys] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
    const alternatives = Object.values(keys).filter((key): key is string => !!key);
    for (const layout of ["flat", "nested"] as const) {
      if (keys[layout]) physicalChoices.push({ slug, key: keys[layout]!, layout, alternatives: alternatives.filter((key) => key !== keys[layout]) });
    }
    const layout: Layout = keys.flat ? "flat" : "nested";
    choices.push({ slug, key: keys[layout]!, layout, alternatives: alternatives.filter((key) => key !== keys[layout]) });
  }
  const flat = physicalChoices.filter((choice) => choice.layout === "flat").length;
  const nested = physicalChoices.length - flat;
  return { choices, physicalChoices, physical: { flat, nested, ignored, total: physicalChoices.length } };
}

export function resolveReportPaths(outArg?: string, summaryArg?: string, cwd = process.cwd(), root = ROOT): { out: string; summaryOut: string } {
  const out = outArg ? resolve(cwd, outArg) : resolve(root, "work/coverage/served-proof-registry.json");
  const summaryOut = summaryArg ? resolve(cwd, summaryArg) : out.replace(/\.json$/, ".summary.json");
  return { out, summaryOut };
}

function validProof(value: unknown): value is GeometrySourceProof {
  try { assertGeometryProof(value); return true; }
  catch { return false; }
}

/** Exact means explicitly asserted as geometry evidence; it does not mean eligible. */
export function exactEvidence(fc: FC, feature: Feature): Evidence[] {
  const out: Evidence[] = [];
  const addV2 = (wrapper: unknown, field: string) => {
    const value = wrapper as { geometry_source?: { url?: unknown } } | null | undefined;
    const source = value?.geometry_source;
    if (isRealGeometryUrl(source?.url)) out.push({ url: source.url, field, ...(validProof(source) ? { proof: source } : {}) });
  };
  addV2(fc.proof, "collection.proof.geometry_source");
  const proof = feature.properties?.proof as {
    geometry_source?: { url?: unknown };
    sources?: { geometry?: { upstream_uri?: unknown } };
  } | undefined;
  addV2(proof, "feature.properties.proof.geometry_source");
  const legacyUrl = proof?.sources?.geometry?.upstream_uri;
  if (isRealGeometryUrl(legacyUrl)) out.push({ url: legacyUrl, field: "feature.properties.proof.sources.geometry.upstream_uri" });
  return out;
}

export function classifyFeature(fc: FC, feature: Feature): SourceCategory {
  const collectionProof = fc.proof;
  const featureProof = feature.properties?.proof as { schema_version?: unknown; geometry_source?: unknown } | undefined;
  if (
    collectionProof?.schema_version === "2.0" &&
    featureProof?.schema_version === "2.0" &&
    validProof(collectionProof.geometry_source) &&
    sameGeometryProof(collectionProof.geometry_source, featureProof.geometry_source)
  ) return "exact_source_eligible";
  return exactEvidence(fc, feature).length > 0 ? "recoverable" : "quarantine";
}

export function collectionCategory(count: number, categories: Record<string, number>): SourceCategory {
  if (count === 0) return "quarantine";
  if ((categories.exact_source_eligible ?? 0) === count) return "exact_source_eligible";
  if ((categories.quarantine ?? 0) > 0) return "quarantine";
  return "recoverable";
}

function zoneCode(props: Props | null | undefined): string | null {
  for (const key of ["zone_code", "code_zone", "ZONE_CODE", "CODE_ZONE", "NO_ZONAGE", "no_zone", "NOZONE"]) {
    const value = props?.[key];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return null;
}
function assignment(props: Props | null | undefined): string | null {
  const value = props?.assignment_method;
  return value != null && String(value).trim() ? String(value).trim() : null;
}
function inc(target: Record<string, number>, key: string, amount = 1): void { target[key] = (target[key] ?? 0) + amount; }

function collectSource(sources: Map<string, SourceCount>, evidence: Evidence[]): void {
  const byUrl = new Map<string, Evidence[]>();
  for (const item of evidence) byUrl.set(item.url, [...(byUrl.get(item.url) ?? []), item]);
  for (const [url, items] of byUrl) {
    const current = sources.get(url) ?? { url, evidence_fields: new Set<string>(), features_attesting: 0 };
    for (const item of items) current.evidence_fields.add(item.field);
    current.features_attesting++;
    const validated = items.find((item) => item.proof)?.proof;
    if (validated) current.proof = validated;
    sources.set(url, current);
  }
}

/** Parse one feature at a time so large qc-lots objects never become one V8 string. */
export function visitFeatures(buf: Buffer, key: string, visit: (feature: Feature, index: number) => void): number {
  const token = Buffer.from('"features"');
  let arrayStart = -1;
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
    if (buf.subarray(i, i + token.length).equals(token)) {
      let cursor = i + token.length;
      while (cursor < buf.length && /\s/.test(String.fromCharCode(buf[cursor]!))) cursor++;
      if (buf[cursor] !== 0x3a) continue;
      cursor++;
      while (cursor < buf.length && /\s/.test(String.fromCharCode(buf[cursor]!))) cursor++;
      if (buf[cursor] === 0x5b) { arrayStart = cursor + 1; break; }
    }
    inString = true;
  }
  if (arrayStart < 0) throw new Error(`GeoJSON features array not found: ${key}`);

  let depth = 0;
  let featureStart = -1;
  let index = 0;
  inString = false;
  escaped = false;
  for (let i = arrayStart; i < buf.length; i++) {
    const byte = buf[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (byte === 0x5c) escaped = true;
      else if (byte === 0x22) inString = false;
      continue;
    }
    if (byte === 0x22) { inString = true; continue; }
    if (depth === 0) {
      if (byte === 0x5d) return index;
      if (byte === 0x7b) { featureStart = i; depth = 1; }
      continue;
    }
    if (byte === 0x7b || byte === 0x5b) depth++;
    else if (byte === 0x7d || byte === 0x5d) {
      depth--;
      if (depth === 0) {
        visit(JSON.parse(buf.subarray(featureStart, i + 1).toString("utf8")) as Feature, index++);
        featureStart = -1;
      }
    }
  }
  throw new Error(`GeoJSON features array did not terminate: ${key}`);
}

function skipJsonWhitespace(buf: Buffer, index: number): number {
  while (index < buf.length && /\s/.test(String.fromCharCode(buf[index]!))) index++;
  return index;
}

function endJsonString(buf: Buffer, start: number): number {
  if (buf[start] !== 0x22) throw new Error("JSON string expected");
  for (let index = start + 1; index < buf.length; index++) {
    if (buf[index] === 0x5c) { index++; continue; }
    if (buf[index] === 0x22) return index + 1;
  }
  throw new Error("unterminated JSON string");
}

function endJsonValue(buf: Buffer, start: number): number {
  const first = buf[start];
  if (first === undefined || [0x2c, 0x3a, 0x5d, 0x7d].includes(first)) throw new Error("JSON value expected");
  if (first === 0x22) return endJsonString(buf, start);
  if (first !== 0x7b && first !== 0x5b) {
    let index = start;
    while (index < buf.length && !/\s/.test(String.fromCharCode(buf[index]!)) && ![0x2c, 0x5d, 0x7d].includes(buf[index]!)) index++;
    JSON.parse(buf.subarray(start, index).toString("utf8"));
    return index;
  }

  const closers = first === 0x7b ? [0x7d] : [0x5d];
  for (let index = start + 1; index < buf.length; index++) {
    const byte = buf[index]!;
    if (byte === 0x22) { index = endJsonString(buf, index) - 1; continue; }
    if (byte === 0x7b) closers.push(0x7d);
    else if (byte === 0x5b) closers.push(0x5d);
    else if (byte === closers.at(-1)) {
      closers.pop();
      if (closers.length === 0) return index + 1;
    }
  }
  throw new Error("unterminated JSON value");
}

function fullyValidatedCollectionProof(buf: Buffer, candidate: FC["proof"] | undefined): FC["proof"] | undefined {
  // Keep the common legacy path streaming. A collection that presents a v2
  // proof is a candidate for exact eligibility, so validate its complete JSON
  // document before trusting that proof.
  if (!candidate) return undefined;
  try {
    const collection = JSON.parse(buf.toString("utf8")) as FC;
    return collection.type === "FeatureCollection" ? collection.proof : undefined;
  } catch {
    return undefined;
  }
}

/** Locate a top-level proof structurally; validate full JSON only for a candidate proof. */
export function topLevelCollectionProof(buf: Buffer): FC["proof"] | undefined {
  let index = skipJsonWhitespace(buf, 0);
  if (buf[index++] !== 0x7b) return undefined;
  let proof: FC["proof"] | undefined;
  for (;;) {
    index = skipJsonWhitespace(buf, index);
    if (buf[index] === 0x7d) {
      index = skipJsonWhitespace(buf, index + 1);
      return index === buf.length ? fullyValidatedCollectionProof(buf, proof) : undefined;
    }
    if (buf[index] !== 0x22) return undefined;
    const keyStart = index;
    const keyEnd = endJsonString(buf, keyStart);
    let key: string;
    try { key = JSON.parse(buf.subarray(keyStart, keyEnd).toString("utf8")) as string; }
    catch { return undefined; }
    index = skipJsonWhitespace(buf, keyEnd);
    if (buf[index++] !== 0x3a) return undefined;
    index = skipJsonWhitespace(buf, index);
    const valueStart = index;
    let valueEnd: number;
    try { valueEnd = endJsonValue(buf, valueStart); }
    catch { return undefined; }
    if (key === "proof") {
      try { proof = JSON.parse(buf.subarray(valueStart, valueEnd).toString("utf8")) as FC["proof"]; }
      catch { return undefined; }
    }
    index = skipJsonWhitespace(buf, valueEnd);
    if (buf[index] === 0x2c) { index++; continue; }
    if (buf[index] !== 0x7d) return undefined;
    index = skipJsonWhitespace(buf, index + 1);
    return index === buf.length ? fullyValidatedCollectionProof(buf, proof) : undefined;
  }
}

async function pool<T>(items: readonly T[], concurrency: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) { const index = next++; if (index >= items.length) return; await work(items[index]!); }
  }));
}

async function auditZone(s3: S3Client, choice: KeyChoice, failures: Failure[]): Promise<CollectionRow> {
  const bytes = await retry(`GetObject ${choice.key}`, () => getBytes(s3, choice.key), failures);
  if (!bytes) return { ...choice, status: "quarantine", features: null, feature_categories: {}, evidence_urls: [], reason: "s3_read_failed" };
  const fc: FC = { type: "FeatureCollection", proof: topLevelCollectionProof(bytes) };
  const categories: Record<string, number> = {};
  const sources = new Map<string, SourceCount>();
  const eligibleCodes = new Set<string>();
  let count: number;
  try {
    count = visitFeatures(bytes, choice.key, (feature) => {
      const category = classifyFeature(fc, feature);
      inc(categories, category);
      collectSource(sources, exactEvidence(fc, feature));
      if (category === "exact_source_eligible") {
        const code = zoneCode(feature.properties);
        if (code) eligibleCodes.add(code);
      }
    });
  } catch (e) {
    return { ...choice, status: "quarantine", features: null, feature_categories: {}, evidence_urls: [], reason: `invalid_geojson: ${errorText(e)}` };
  }
  return {
    ...choice,
    status: collectionCategory(count, categories),
    features: count,
    feature_categories: categories,
    evidence_urls: [...sources.keys()].sort(),
    eligibleCodes,
    sources: [...sources.values()],
  };
}

async function auditLots(s3: S3Client, choice: KeyChoice, zone: CollectionRow | undefined, failures: Failure[]): Promise<CollectionRow> {
  const bytes = await retry(`GetObject ${choice.key}`, () => getBytes(s3, choice.key), failures);
  if (!bytes) return { ...choice, status: "quarantine", features: null, feature_categories: {}, evidence_urls: [], reason: "s3_read_failed", zoning_allowed: 0, zoning_suppressed: 0, suppression_reasons: { s3_read_failed: 1 } };
  const fc: FC = { type: "FeatureCollection", proof: topLevelCollectionProof(bytes) };
  const categories: Record<string, number> = {};
  const reasons: Record<string, number> = {};
  const sources = new Map<string, SourceCount>();
  let allowed = 0;
  let count: number;
  try {
    count = visitFeatures(bytes, choice.key, (feature) => {
      const category = classifyFeature(fc, feature);
      inc(categories, category);
      collectSource(sources, exactEvidence(fc, feature));
      const code = zoneCode(feature.properties);
      const method = assignment(feature.properties);
      let reason: string | null = null;
      if (!code || method === "unassigned") reason = "zone_assignment_unavailable";
      else if (!method) reason = "assignment_method_unavailable";
      else if (method !== "area-majority" && method !== "centroid-fallback") reason = "assignment_method_invalid";
      else if (!zone) reason = "zone_collection_unavailable";
      else if (zone.status !== "exact_source_eligible") reason = "zone_collection_not_exact_source_eligible";
      else if (!zone.eligibleCodes?.has(code)) reason = "precise_eligible_zone_feature_unavailable";
      if (reason) inc(reasons, reason); else allowed++;
    });
  } catch (e) {
    return { ...choice, status: "quarantine", features: null, feature_categories: {}, evidence_urls: [], reason: `invalid_geojson: ${errorText(e)}`, zoning_allowed: 0, zoning_suppressed: 0, suppression_reasons: { invalid_geojson: 1 } };
  }
  return {
    ...choice,
    status: collectionCategory(count, categories),
    features: count,
    feature_categories: categories,
    evidence_urls: [...sources.keys()].sort(),
    zoning_allowed: allowed,
    zoning_suppressed: count - allowed,
    suppression_reasons: reasons,
    sources: [...sources.values()],
  };
}

function publicRow(row: CollectionRow): Omit<CollectionRow, "eligibleCodes" | "sources"> {
  const { eligibleCodes: _eligibleCodes, sources: _sources, ...publicFields } = row;
  return publicFields;
}

function sumRows(rows: CollectionRow[]) {
  const collectionCategories: Record<string, number> = {};
  const featureCategories: Record<string, number> = {};
  let featureTotal = 0;
  for (const row of rows) {
    inc(collectionCategories, row.status);
    if (row.features != null) featureTotal += row.features;
    for (const [category, count] of Object.entries(row.feature_categories)) inc(featureCategories, category, count);
  }
  return { collections: { total: rows.length, categories: collectionCategories }, features: { total: featureTotal, categories: featureCategories } };
}

function sourceRegistry(product: "qc-zonage" | "qc-lots", rows: CollectionRow[]) {
  // Recoverable URLs remain diagnostic candidates on their collection row. The
  // registry itself contains only a fully eligible v2 collection proof.
  return rows.flatMap((row) => row.status !== "exact_source_eligible" ? [] : (row.sources ?? []).filter((source) => !!source.proof).map((source) => ({
    product,
    slug: row.slug,
    key: row.key,
    layout: row.layout,
    collection_status: row.status,
    url: source.url,
    evidence_fields: [...source.evidence_fields].sort(),
    features_attesting: source.features_attesting,
    proof: source.proof!,
  }))).sort((a, b) => a.key.localeCompare(b.key) || a.url.localeCompare(b.url));
}

async function main(): Promise<void> {
  const { out, summaryOut } = resolveReportPaths(arg("out"), arg("summary-out"));
  const failures: Failure[] = [];
  const s3 = s3Client();
  const [zoneRests, lotRests] = await Promise.all([
    retry(`ListObjectsV2 ${ZONES}`, () => listSlugs(s3, ZONES, ".geojson", false), failures),
    retry(`ListObjectsV2 ${LOTS}`, () => listSlugs(s3, LOTS, ".geojson", false), failures),
  ]);
  if (!zoneRests || !lotRests) throw new Error(`listing failed; details: ${JSON.stringify(failures)}`);

  const zoneKeys = resolveKeys(zoneRests, "qc-zonage", ZONES);
  const lotKeys = resolveKeys(lotRests, "qc-lots", LOTS);
  const zoneRows: CollectionRow[] = [];
  await pool(zoneKeys.physicalChoices, 4, async (choice) => { zoneRows.push(await auditZone(s3, choice, failures)); });
  zoneRows.sort((a, b) => a.key.localeCompare(b.key));
  const zoneByKey = new Map(zoneRows.map((row) => [row.key, row]));
  const selectedZoneRows = zoneKeys.choices.map((choice) => zoneByKey.get(choice.key)!).filter(Boolean);
  const selectedZoneBySlug = new Map(selectedZoneRows.map((row) => [row.slug, row]));

  const lotRows: CollectionRow[] = [];
  // Lot objects are much larger than zone objects. Two concurrent buffers keep
  // memory bounded while still overlapping S3 latency.
  await pool(lotKeys.physicalChoices, 2, async (choice) => { lotRows.push(await auditLots(s3, choice, selectedZoneBySlug.get(choice.slug), failures)); });
  lotRows.sort((a, b) => a.key.localeCompare(b.key));
  const lotByKey = new Map(lotRows.map((row) => [row.key, row]));
  const selectedLotRows = lotKeys.choices.map((choice) => lotByKey.get(choice.key)!).filter(Boolean);

  const zoning = { allowed: 0, suppressed: 0, suppression_reasons: {} as Record<string, number> };
  for (const row of selectedLotRows) {
    zoning.allowed += row.zoning_allowed ?? 0;
    zoning.suppressed += row.zoning_suppressed ?? 0;
    for (const [reason, count] of Object.entries(row.suppression_reasons ?? {})) inc(zoning.suppression_reasons, reason, count);
  }
  const generatedAt = new Date().toISOString();
  const logicalZones = sumRows(selectedZoneRows);
  const logicalLots = sumRows(selectedLotRows);
  const report = {
    contract: "served-proof-registry/v2",
    generated_at: generatedAt,
    read_only: true,
    evidence_policy: "dedicated geometry proof fields only; no inferred/generic URLs",
    serving_precedence: "flat canonical key, then mirrored nested canonical key",
    layouts: {
      zones: { ...zoneKeys.physical, logical_collections: zoneKeys.choices.length },
      lots: { ...lotKeys.physical, logical_collections: lotKeys.choices.length },
    },
    logical_serving_view: {
      zones: { ...logicalZones, registry: selectedZoneRows.map(publicRow) },
      lots: { ...logicalLots, zoning, registry: selectedLotRows.map(publicRow) },
    },
    physical_audit: {
      zones: { ...sumRows(zoneRows), registry: zoneRows.map(publicRow) },
      lots: { ...sumRows(lotRows), registry: lotRows.map(publicRow) },
    },
    source_registry: [
      ...sourceRegistry("qc-zonage", zoneRows),
      ...sourceRegistry("qc-lots", lotRows),
    ],
    failed_s3_calls: failures,
  };
  const summary = {
    contract: report.contract,
    generated_at: generatedAt,
    read_only: true,
    layouts: report.layouts,
    logical_serving_view: {
      zones: logicalZones,
      lots: { ...logicalLots, zoning },
    },
    physical_audit: { zones: sumRows(zoneRows), lots: sumRows(lotRows) },
    source_registry_entries: report.source_registry.length,
    failed_s3_calls: failures,
  };
  writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  writeFileSync(summaryOut, JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify({ out, summary_out: summaryOut, ...summary }));
  if (failures.length) process.exitCode = 2;
}

const isMain = !!process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exitCode = 1; });
