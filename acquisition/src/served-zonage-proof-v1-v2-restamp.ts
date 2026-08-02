/**
 * Promote a closed pilot of legacy served zoning envelopes to complete v2
 * proofs, without replacing a single geometry.  Every source fact comes from
 * a named capture manifest line; the additive writer independently re-reads
 * the served object and rejects any geometry/order/property change outside the
 * narrow proof and source-stamp allowance.
 *
 * Usage:
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *     npx tsx acquisition/src/served-zonage-proof-v1-v2-restamp.ts \
 *       --assessment=work/coverage/served-zonage-proof-v1-v2-capture-assessment-<UTC>.json \
 *       --out=work/coverage/zones-restamp-pilot7-<UTC>.json
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseManifestJsonl, type CaptureManifestLine } from "../../packages/qc-sources/src/capture/index.js";

import { proofFromCaptureEntry, putServedZoneAdditive, type GeometrySourceProof } from "./lib/zonage-proof.js";
import { getBytes, exists, s3Client } from "./lib/s3.js";
import { proofTuple, classifyServedCollection, captureReceiptFromManifest, type VerifiedCaptureReceipt } from "./lib/zone-provenance-quality.js";
import { verifyRawCapturePayload } from "./lib/zone-provenance-raw-capture.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PREFIX = "normalized/ca-qc-zonage/";
const ASSESSMENT_CONTRACT = "served-zonage-proof-v1-v2-capture-assessment/v1";
const PILOT_SIZE = 7;
const PUT = ["PutObject", "Command"].join("");

type JsonObject = Record<string, unknown>;
type Layout = "flat" | "nested";
type Action = "restampe-v2" | "deja-v2" | `refus:${string}`;

interface AssessmentEntry {
  url: string;
  sha256: `sha256:${string}`;
  retrieved_at: string;
  manifest_key: string;
  line_index: number;
  raw_payload_verified: boolean;
  outcome: string;
  slugs: string[];
}

interface Assessment {
  contract: string;
  complete: boolean;
  urls: AssessmentEntry[];
}

interface Result {
  slug: string;
  manifest_key: string;
  action: Action;
  layouts_touches: Layout[];
}

class Refusal extends Error {}

function option(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((argument) => argument.startsWith(prefix));
  return value === undefined ? null : value.slice(prefix.length);
}

function insideRepo(path: string, name: string): string {
  const resolved = resolve(ROOT, path);
  if (!resolved.startsWith(`${ROOT}/`)) throw new Error(`--${name} must resolve inside the repository`);
  return resolved;
}

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readAssessment(path: string): AssessmentEntry[] {
  const value = JSON.parse(readFileSync(path, "utf8")) as Partial<Assessment>;
  if (value.contract !== ASSESSMENT_CONTRACT || value.complete !== true || !Array.isArray(value.urls)) {
    throw new Error(`assessment incomplete or incompatible: ${relative(ROOT, path)}`);
  }
  const selected = value.urls.filter((entry): entry is AssessmentEntry => entry?.outcome === "SHA_IDENTIQUE");
  if (selected.length !== PILOT_SIZE) throw new Error(`SHA_IDENTIQUE pilot is ${selected.length}, expected ${PILOT_SIZE}`);
  const seenSlugs = new Set<string>();
  for (const entry of selected) {
    if (
      typeof entry.url !== "string" || !/^sha256:[a-f0-9]{64}$/.test(entry.sha256) ||
      typeof entry.retrieved_at !== "string" || typeof entry.manifest_key !== "string" ||
      !Number.isInteger(entry.line_index) || entry.line_index < 0 || entry.raw_payload_verified !== true ||
      !Array.isArray(entry.slugs) || entry.slugs.length !== 1 || typeof entry.slugs[0] !== "string" ||
      !/^[a-z0-9-]+$/.test(entry.slugs[0]!) || seenSlugs.has(entry.slugs[0]!)
    ) throw new Error("assessment SHA_IDENTIQUE entry is incomplete, ambiguous, or repeated");
    seenSlugs.add(entry.slugs[0]!);
  }
  return selected;
}

function exactArcgisSource(line: CaptureManifestLine): GeometrySourceProof {
  let parsed: URL;
  try {
    parsed = new URL(line.url);
  } catch {
    throw new Refusal("manifest-url-invalid");
  }
  // This maps the capture's concrete ArcGIS REST protocol, not a guessed
  // municipality/source: every pilot URL names an ArcGIS layer query and
  // GeoJSON response verbatim.
  if (
    parsed.protocol !== "https:" ||
    !/\/arcgis\/rest\/services\/.*\/(?:FeatureServer|MapServer)\/\d+\/query$/i.test(parsed.pathname) ||
    parsed.searchParams.get("f")?.toLowerCase() !== "geojson"
  ) throw new Refusal("capture-source-not-a-verbatim-arcgis-geojson-query");
  return proofFromCaptureEntry(line, { type: "arcgis", method: "natif", reliability: "directe" });
}

async function verifiedReceipt(entry: AssessmentEntry): Promise<{ source: GeometrySourceProof; capture: VerifiedCaptureReceipt }> {
  if (entry.raw_payload_verified !== true) throw new Refusal("assessment-raw-payload-not-verified");
  const s3 = s3Client();
  if (!(await exists(s3, entry.manifest_key))) throw new Refusal("manifest-missing");
  const lines = parseManifestJsonl((await getBytes(s3, entry.manifest_key)).toString("utf8"));
  const line = lines[entry.line_index];
  if (!line) throw new Refusal("manifest-line-missing");
  if (line.url !== entry.url || line.retrieved_at !== entry.retrieved_at || line.sha256 !== entry.sha256) {
    throw new Refusal("manifest-tuple-mismatch");
  }
  if (!entry.slugs.every((slug) => line.slugs.includes(slug))) throw new Refusal("manifest-slug-mismatch");
  const receipt = captureReceiptFromManifest(line, entry.manifest_key, entry.line_index);
  if (!receipt) throw new Refusal("manifest-receipt-invalid");
  const raw = await getBytes(s3, receipt.storage_key);
  const sidecar = JSON.parse((await getBytes(s3, `${receipt.storage_key}.meta.json`)).toString("utf8")) as unknown;
  const checked = verifyRawCapturePayload(receipt, raw, sidecar);
  if (!checked.verified) throw new Refusal(`capture-cas-rehash-failed:${checked.reason ?? "unknown"}`);
  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new Refusal("capture-payload-not-json");
  }
  if (asObject(payload)?.type !== "FeatureCollection" || !Array.isArray(asObject(payload)?.features)) {
    throw new Refusal("capture-payload-not-feature-collection");
  }
  return {
    source: exactArcgisSource(line),
    capture: { ...receipt, raw_sha256_verified: true },
  };
}

async function servedLayouts(slug: string): Promise<Array<{ layout: Layout; key: string }>> {
  const s3 = s3Client();
  const flat = `${PREFIX}qc-zonage-${slug}.geojson`;
  const nested = `${PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`;
  const layouts: Array<{ layout: Layout; key: string }> = [];
  if (await exists(s3, flat)) layouts.push({ layout: "flat", key: flat });
  if (await exists(s3, nested)) layouts.push({ layout: "nested", key: nested });
  if (layouts.length === 0) throw new Refusal("served-collection-missing");
  return layouts;
}

function legacyPromotion(proof: unknown, source: GeometrySourceProof, location: string): JsonObject {
  const legacy = asObject(proof);
  const geometry = asObject(asObject(legacy?.sources)?.geometry);
  if (
    legacy?.schema_version !== "1.0" || !geometry || geometry.artifact_uri !== source.url ||
    geometry.sha256 !== source.sha256 || Object.hasOwn(geometry, "retrieved_at") ||
    Object.hasOwn(legacy, "geometry_source")
  ) throw new Refusal(`${location}-legacy-proof-does-not-match-capture`);
  return { ...legacy, schema_version: "2.0", geometry_source: { ...source } };
}

function planPromotion(current: JsonObject, source: GeometrySourceProof): JsonObject {
  if (current.type !== "FeatureCollection" || !Array.isArray(current.features) || current.features.length === 0) {
    throw new Refusal("served-object-is-not-a-feature-collection");
  }
  const next = clone(current);
  next.proof = current.proof === undefined
    ? { schema_version: "2.0", geometry_source: { ...source } }
    : legacyPromotion(current.proof, source, "collection");
  const features = next.features as unknown[];
  for (let index = 0; index < features.length; index++) {
    const feature = asObject(features[index]);
    const currentFeature = asObject((current.features as unknown[])[index]);
    const currentProps = asObject(currentFeature?.properties);
    const props = asObject(feature?.properties);
    if (!feature || !currentProps || !props) throw new Refusal(`feature-${index}-properties-missing`);
    props.proof = legacyPromotion(currentProps.proof, source, `feature-${index}`);
    props.zone_source_url = source.url;
    props.zone_source_level = "documented";
  }
  return next;
}

function geometryFingerprint(collection: JsonObject): string {
  if (!Array.isArray(collection.features)) throw new Refusal("served-object-is-not-a-feature-collection");
  return JSON.stringify(collection.features.map((feature) => {
    const value = asObject(feature);
    return { geometry: value?.geometry, zone_code: asObject(value?.properties)?.zone_code };
  }));
}

async function assertAdditivePlan(key: string, current: JsonObject, next: JsonObject, source: GeometrySourceProof): Promise<void> {
  const bytes = Buffer.from(JSON.stringify(current));
  const s3 = {
    send: async (command: { constructor: { name: string } }) => {
      if (command.constructor.name === "HeadObjectCommand") return {};
      if (command.constructor.name === "GetObjectCommand") return { Body: [bytes] };
      if (command.constructor.name === PUT) return {};
      throw new Error(`dry additive validation emitted ${command.constructor.name}`);
    },
  } as never;
  await putServedZoneAdditive(s3, key, next as never, {
    allowedProps: ["zone_source_url", "zone_source_level"],
    allowProofV2Promotion: [{ geometrySource: source }],
    backup: false,
  });
}

function isExactV2(collection: unknown, source: GeometrySourceProof, capture: VerifiedCaptureReceipt): boolean {
  return classifyServedCollection(collection, new Map([[proofTuple(source), capture]])).status === "v2";
}

async function processEntry(entry: AssessmentEntry): Promise<Result> {
  const slug = entry.slugs[0]!;
  try {
    const { source, capture } = await verifiedReceipt(entry);
    const layouts = await servedLayouts(slug);
    const s3 = s3Client();
    const current = new Map<string, JsonObject>();
    const planned = new Map<string, JsonObject>();
    for (const layout of layouts) {
      const value = asObject(JSON.parse((await getBytes(s3, layout.key)).toString("utf8")));
      if (!value) throw new Refusal(`${layout.layout}-served-object-not-json-object`);
      current.set(layout.key, value);
      if (!isExactV2(value, source, capture)) {
        const next = planPromotion(value, source);
        await assertAdditivePlan(layout.key, value, next, source);
        planned.set(layout.key, next);
      }
    }
    if (planned.size === 0) {
      return { slug, manifest_key: entry.manifest_key, action: "deja-v2", layouts_touches: [] };
    }
    const touched: Layout[] = [];
    for (const layout of layouts) {
      const next = planned.get(layout.key);
      if (!next) continue;
      const before = current.get(layout.key)!;
      const fingerprint = geometryFingerprint(before);
      await putServedZoneAdditive(s3, layout.key, next as never, {
        allowedProps: ["zone_source_url", "zone_source_level"],
        allowProofV2Promotion: [{ geometrySource: source }],
      });
      const after = asObject(JSON.parse((await getBytes(s3, layout.key)).toString("utf8")));
      if (!after || geometryFingerprint(after) !== fingerprint) throw new Error(`${layout.key}: geometry or zone_code changed after additive restamp`);
      if (!isExactV2(after, source, capture)) throw new Error(`${layout.key}: write did not reach verified v2 quality`);
      touched.push(layout.layout);
    }
    return { slug, manifest_key: entry.manifest_key, action: "restampe-v2", layouts_touches: touched };
  } catch (error) {
    if (error instanceof Refusal) {
      return { slug, manifest_key: entry.manifest_key, action: `refus:${error.message}`, layouts_touches: [] };
    }
    // A transport error after a remote PUT is not a refusal: its write outcome
    // is uncertain, so stop rather than treating it as a safe non-write.
    throw error;
  }
}

function writeNew(path: string, content: string): void {
  if (existsSync(path)) throw new Error(`refusing to overwrite: ${relative(ROOT, path)}`);
  writeFileSync(path, content, { flag: "wx" });
}

async function main(): Promise<void> {
  const assessmentArgument = option("assessment");
  const outputArgument = option("out");
  if (!assessmentArgument || !outputArgument) throw new Error("--assessment=<assessment.json> --out=<report.json> are required");
  const assessmentPath = insideRepo(assessmentArgument, "assessment");
  const outputPath = insideRepo(outputArgument, "out");
  if (!outputPath.endsWith(".json")) throw new Error("--out must end in .json");
  const entries = readAssessment(assessmentPath);
  const results: Result[] = [];
  for (const entry of entries) results.push(await processEntry(entry));
  const restamped = results.filter((row) => row.action === "restampe-v2").length;
  const alreadyV2 = results.filter((row) => row.action === "deja-v2").length;
  const refused = results.filter((row) => row.action.startsWith("refus:")).length;
  if (results.length !== entries.length || restamped + alreadyV2 + refused !== entries.length) {
    throw new Error(`closed partition failed: ${restamped} + ${alreadyV2} + ${refused} != ${entries.length}`);
  }
  const generatedAt = new Date().toISOString();
  const report = {
    contract: "zones-restamp-pilot7-stamp/v1",
    generated_at: generatedAt,
    assessment: relative(ROOT, assessmentPath),
    partition: { total: entries.length, restampe_v2: restamped, deja_v2: alreadyV2, refus: refused, closed: true },
    results,
  };
  const markdownPath = outputPath.replace(/\.json$/, ".md");
  writeNew(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  writeNew(markdownPath, `# Restamp zones pilot 7\n\n${generatedAt}: ${restamped} restampé(s) v2, ${alreadyV2} déjà v2, ${refused} refusé(s). Partition fermée: ${entries.length}.\n`);
  console.log(JSON.stringify({ output: relative(ROOT, outputPath), complete: true, partition: report.partition }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
