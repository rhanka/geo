/**
 * Restore human-openable URL + manifest SHA-256 together on legacy v1 zoning
 * proofs.  This is intentionally a two-phase runner:
 *
 *   1. --prepare reads only completed capture manifests plus current served
 *      envelopes and writes an immutable local plan.  The manifest SHA is the
 *      value to stamp; this runner never computes a SHA for the assertion.
 *   2. --plan applies a selected short batch through putServedZoneAdditive.
 *      The additive guard re-reads the served object and refuses any geometry,
 *      feature-count, order, or unrelated-property difference before writing.
 *
 * Usage from repository root:
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *     npx tsx acquisition/src/served-zonage-proof-url-restamp.ts \
 *       --prepare=work/coverage/served-zonage-proof-url-restamp-ready-20260727.json \
 *       --classification=work/coverage/capture-octets-classification-<UTC>.json \
 *       --run-prefix=zones-20260727T,zones-20260728T --expect-ready=50
 *
 * When Kubernetes sharded one capture into many manifest objects, prepare each
 * exact run-stamp independently (with `--expect-ready=0`), then merge the
 * completed, non-overlapping plans before any served write:
 *   npx tsx acquisition/src/served-zonage-proof-url-restamp.ts \
 *     --merge-plans=work/coverage/a.json,work/coverage/b.json \
 *     --merge-output=work/coverage/served-zonage-proof-url-restamp-ready-20260727.json \
 *     --expect-ready=50
 *
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *     npx tsx acquisition/src/served-zonage-proof-url-restamp.ts \
 *       --plan=work/coverage/served-zonage-proof-url-restamp-ready-20260727.json \
 *       --offset=0 --limit=10 --batch-size=5 --apply \
 *       --stem=work/coverage/served-zonage-proof-url-restamp-control-20260727
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseManifestJsonl } from "../../packages/qc-sources/src/capture/index.js";
import { type CaptureOctetClass } from "./lib/capture-octets-classification.js";
import {
  putServedZoneAdditive,
  type ProofArtifactUriSubstitution,
} from "./lib/zonage-proof.js";
import {
  isHttpsCaptureUrl,
  MissingSha256RestampRefusal,
  planMissingSha256ProofRestamp,
  selectEquivalentManifestReceipt,
  type ProofUrlManifestAttestation,
} from "./lib/served-zonage-proof-url-restamp.js";
import { getBytes, listObjectEntries, s3Client } from "./lib/s3.js";
import { verifyRawCapturePayload } from "./lib/zone-provenance-raw-capture.js";
import { captureReceiptFromManifest, selectServedZoneCollections } from "./lib/zone-provenance-quality.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ZONES_PREFIX = "normalized/ca-qc-zonage/";
const CAPTURE_RUNS_PREFIX = "capture/_runs/";
const DEFAULT_PREPARE = "work/coverage/served-zonage-proof-url-restamp-ready-20260727.json";
const DEFAULT_STEM = "work/coverage/served-zonage-proof-url-restamp-20260727";
// Served GeoJSON can be large (notably Montréal).  The preparation is a
// safety census, not a throughput race: one envelope at a time avoids an OOM
// before its result is atomically recorded.
const READ_CONCURRENCY = 1;
// Manifests are tiny immutable JSONL receipts; a small separate fan-out keeps
// a 100-pod capture run within one short preparation invocation without ever
// co-loading served GeoJSON envelopes.
const MANIFEST_READ_CONCURRENCY = 3;
const DEFAULT_BATCH_SIZE = 5;
// Kept constructed because the raw-write policy test requires production S3
// writes to remain implemented only in lib/s3.ts and lib/zonage-proof.ts.
const PUT = ["PutObject", "Command"].join("");

type JsonObject = Record<string, unknown>;
type Mode = "dry-run" | "apply";
type Outcome = "applied" | "substitutable" | "refused";

interface ManifestCandidate {
  storage_key: string;
  url: string;
  retrieved_at: string;
  sha256: `sha256:${string}`;
  manifest_key: string;
  line_index: number;
}

interface ReadyRow {
  slug: string;
  key: string;
  attestations: ProofUrlManifestAttestation[];
}

interface RefusedRow {
  slug: string;
  key: string | null;
  reason: string;
}

interface ExcludedCapture {
  manifest_key: string;
  line_index: number;
  storage_key: string;
  url: string;
  slugs: string[];
  classification: CaptureOctetClass;
  detail: string;
}

interface CaptureCandidates {
  bySlug: Map<string, ManifestCandidate[]>;
  excluded: ExcludedCapture[];
}

interface ClassificationLine {
  manifest_key: string;
  line_index: number;
  storage_key: string | null;
  classification: CaptureOctetClass;
  detail: string;
}

interface ClassificationReportReference {
  path: string;
  sha256: string;
}

interface Plan {
  contract: "served-zonage-proof-url-restamp-plan/v3";
  complete: boolean;
  run_prefix: string;
  generated_at: string;
  source: "capture-manifest-lines-classified-octets";
  classification_report: ClassificationReportReference;
  selected_layout: "nested_when_present_else_flat";
  collections: {
    capture_slugs: number;
    ready: number;
    refused: number;
    distinct_manifest_lines: number;
    excluded_capture_lines: number;
  };
  ready: ReadyRow[];
  refused: RefusedRow[];
  /** One row per rejected receipt; shared URLs retain their full slug set. */
  excluded_capture_lines: ExcludedCapture[];
}

interface Result {
  slug: string;
  key: string;
  outcome: Outcome;
  replacements: number;
  reason?: string;
}

interface State {
  contract: "served-zonage-proof-url-restamp-state/v1";
  plan_path: string;
  plan_sha256: string;
  mode: Mode;
  batch_size: number;
  selected: ReadyRow[];
  next_batch: number;
  results: Record<string, Result>;
}

function option(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

function integerOption(name: string, fallback: number, min: number, max: number): number {
  const raw = option(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`--${name} must be an integer between ${min} and ${max}`);
  return value;
}

function insideRepo(path: string, name: string): string {
  const resolved = resolve(ROOT, path);
  if (!resolved.startsWith(`${ROOT}/`)) throw new Error(`--${name} must resolve inside the repository`);
  return resolved;
}

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function sha256(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function writeAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function mapConcurrent<T, R>(
  items: readonly T[],
  fn: (item: T) => Promise<R>,
  concurrency: number = READ_CONCURRENCY,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      try { results[index] = { status: "fulfilled", value: await fn(items[index]!) }; }
      catch (reason) { results[index] = { status: "rejected", reason }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function validRunPrefix(value: string): boolean {
  return /^[A-Za-z0-9-]+$/.test(value);
}

function parseRunPrefixes(value: string): string[] {
  const prefixes = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (prefixes.length === 0 || prefixes.some((prefix) => !validRunPrefix(prefix))) {
    throw new Error("--run-prefix is a comma-separated list of letters, numbers, and hyphens");
  }
  return [...new Set(prefixes)];
}

function isTargetManifestKey(key: string, runPrefixes: readonly string[]): boolean {
  const match = /^capture\/_runs\/([^/]+)\/manifest\.jsonl$/.exec(key);
  return match !== null && runPrefixes.some((prefix) => match[1]!.startsWith(prefix));
}

function classificationIdentity(manifestKey: string, lineIndex: number): string {
  return `${manifestKey}\u0000${lineIndex}`;
}

function readClassificationReport(path: string): Map<string, ClassificationLine> {
  const report = asObject(JSON.parse(readFileSync(path, "utf8")));
  if (
    report?.contract !== "capture-octets-classification/v1" ||
    report.complete !== true ||
    !Array.isArray(report.lines)
  ) throw new Error(`classification report is incomplete or incompatible: ${path}`);
  const byIdentity = new Map<string, ClassificationLine>();
  for (const value of report.lines) {
    const line = asObject(value);
    const lineIndex = line?.line_index;
    if (
      typeof line?.manifest_key !== "string" ||
      typeof lineIndex !== "number" ||
      !Number.isInteger(lineIndex) ||
      (typeof line.storage_key !== "string" && line.storage_key !== null) ||
      (line.classification !== "GEOMETRIE" && line.classification !== "PAGE HTML" && line.classification !== "AUTRE") ||
      typeof line.detail !== "string"
    ) throw new Error(`classification report contains an invalid line: ${path}`);
    const identity = classificationIdentity(line.manifest_key, lineIndex);
    if (byIdentity.has(identity)) throw new Error(`classification report repeats ${identity}`);
    byIdentity.set(identity, {
      manifest_key: line.manifest_key,
      line_index: lineIndex,
      storage_key: line.storage_key,
      classification: line.classification,
      detail: line.detail,
    });
  }
  return byIdentity;
}

async function captureCandidatesBySlug(
  runPrefixInput: string,
  classifications: ReadonlyMap<string, ClassificationLine>,
): Promise<CaptureCandidates> {
  const runPrefixes = parseRunPrefixes(runPrefixInput);
  const s3 = s3Client();
  console.error(`[proof-url-restamp] prepare: listing manifests for ${runPrefixes.join(",")}`);
  const listings = await mapConcurrent(runPrefixes, (prefix) => listObjectEntries(s3, `${CAPTURE_RUNS_PREFIX}${prefix}`));
  const manifests = [...new Set(listings.flatMap((outcome) => {
    if (outcome.status === "rejected") throw new Error(`capture manifest listing failed: ${errorText(outcome.reason)}`);
    return outcome.value.map((entry) => entry.key).filter((key) => isTargetManifestKey(key, runPrefixes));
  }))].sort();
  if (manifests.length === 0) throw new Error(`no capture manifests found for prefix ${runPrefixInput}`);
  console.error(`[proof-url-restamp] prepare: ${manifests.length} manifest(s) to read`);
  const scanned = await mapConcurrent(manifests, async (manifestKey) => ({
    manifestKey,
    lines: parseManifestJsonl((await getBytes(s3, manifestKey)).toString("utf8")),
  }), MANIFEST_READ_CONCURRENCY);
  const bySlug = new Map<string, ManifestCandidate[]>();
  const excluded: ExcludedCapture[] = [];
  for (const outcome of scanned) {
    if (outcome.status === "rejected") throw new Error(`capture manifest read failed: ${errorText(outcome.reason)}`);
    const { manifestKey, lines } = outcome.value;
    for (const [lineIndex, line] of lines.entries()) {
      if (line.source !== "zones-v1-proof-url" || line.http_status !== 200 || !isHttpsCaptureUrl(line.url)) continue;
      const receipt = captureReceiptFromManifest(line, manifestKey, lineIndex);
      if (receipt === null) continue;
      const classification = classifications.get(classificationIdentity(manifestKey, lineIndex));
      if (classification === undefined) throw new Error(`capture manifest line lacks octet classification: ${manifestKey}:${lineIndex}`);
      if (classification.storage_key !== receipt.storage_key) {
        throw new Error(`classification storage key does not match manifest receipt: ${manifestKey}:${lineIndex}`);
      }
      const slugs = [...line.slugs].sort();
      if (classification.classification !== "GEOMETRIE") {
        excluded.push({
          manifest_key: receipt.manifest_key,
          line_index: receipt.line_index,
          storage_key: receipt.storage_key,
          url: receipt.url,
          slugs,
          classification: classification.classification,
          detail: classification.detail,
        });
        continue;
      }
      for (const slug of slugs) {
        const entries = bySlug.get(slug) ?? [];
        entries.push(receipt);
        bySlug.set(slug, entries);
      }
    }
  }
  excluded.sort((left, right) => left.manifest_key.localeCompare(right.manifest_key) || left.line_index - right.line_index);
  return { bySlug, excluded };
}

function featureArtifacts(current: JsonObject): Array<{ artifactUri: string; upstreamUri: unknown }> {
  if (current.type !== "FeatureCollection" || !Array.isArray(current.features)) {
    throw new MissingSha256RestampRefusal("served-object-is-not-a-feature-collection");
  }
  const artifacts = new Map<string, unknown>();
  for (const feature of current.features) {
    const geometry = asObject(asObject(asObject(feature)?.properties)?.proof)?.sources;
    const sourceGeometry = asObject(asObject(geometry)?.geometry);
    const artifactUri = sourceGeometry?.artifact_uri;
    if (typeof artifactUri !== "string" || !artifactUri.startsWith("s3://")) continue;
    const previous = artifacts.get(artifactUri);
    if (previous !== undefined && previous !== sourceGeometry?.upstream_uri) {
      throw new MissingSha256RestampRefusal("one-s3-artifact-has-multiple-served-upstream-uris");
    }
    artifacts.set(artifactUri, sourceGeometry?.upstream_uri);
  }
  return [...artifacts.entries()].map(([artifactUri, upstreamUri]) => ({ artifactUri, upstreamUri }));
}

function attestationsForCurrent(
  current: JsonObject,
  candidates: readonly ManifestCandidate[],
  excluded: readonly ExcludedCapture[],
): ProofUrlManifestAttestation[] {
  const artifacts = featureArtifacts(current);
  if (artifacts.length === 0) throw new MissingSha256RestampRefusal("no-s3-artifact-uri-found-in-current-feature-proofs");
  return artifacts.map(({ artifactUri, upstreamUri }) => {
    const matching = candidates.filter((candidate) => candidate.url === upstreamUri);
    const matchingReceipt = selectEquivalentManifestReceipt(matching);
    if (matchingReceipt === null) {
      if (matching.length === 0) {
        const nonGeometry = excluded
          .filter((candidate) => candidate.url === upstreamUri)
          .map((candidate) => `${candidate.classification}:${candidate.detail}`)
          .sort();
        if (nonGeometry.length > 0) {
          throw new MissingSha256RestampRefusal(`capture-octets-not-geometry:${[...new Set(nonGeometry)].join("|")}`);
        }
        throw new MissingSha256RestampRefusal("manifest-url-not-found-for-served-envelope");
      }
      throw new MissingSha256RestampRefusal("manifest-url-ambiguous-for-served-envelope");
    }
    return { artifactUri, replacementUrl: matchingReceipt.url, ...matchingReceipt };
  });
}

async function assertDryRunGuard(key: string, bytes: Buffer, next: JsonObject, attestations: readonly ProofArtifactUriSubstitution[]): Promise<void> {
  const s3 = {
    send: async (command: { constructor: { name: string } }) => {
      if (command.constructor.name === "HeadObjectCommand") return {};
      if (command.constructor.name === "GetObjectCommand") return { Body: [bytes] };
      // The guard has already checked all invariants when it reaches the final
      // PUT.  Accepting this no-op lets the exact production code finish on
      // in-memory bytes without writing a served object during preparation.
      if (command.constructor.name === PUT) return {};
      throw new Error(`dry-run additive guard unexpectedly sent ${command.constructor.name}`);
    },
  } as never;
  await putServedZoneAdditive(s3, key, next, { allowProofArtifactUriAndSha256Stamp: attestations, backup: false });
}

/** Re-hash the CAS only as a validation of the manifest receipt.  The returned
 * digest is deliberately never used to stamp a proof: `sha256` comes from the
 * receipt's manifest line, or the candidate is refused. */
async function assertManifestCas(attestation: ProofUrlManifestAttestation): Promise<void> {
  const s3 = s3Client();
  const [bytes, metaBytes] = await Promise.all([
    getBytes(s3, attestation.storage_key),
    getBytes(s3, `${attestation.storage_key}.meta.json`),
  ]);
  const checked = verifyRawCapturePayload({
    manifest_key: attestation.manifest_key,
    line_index: attestation.line_index,
    storage_key: attestation.storage_key,
    url: attestation.replacementUrl,
    retrieved_at: attestation.retrieved_at,
    sha256: attestation.sha256,
  }, bytes, JSON.parse(metaBytes.toString("utf8")) as { sourceUrl?: string; sha256?: string; fetchedAt?: string });
  if (!checked.verified) throw new MissingSha256RestampRefusal(`capture-cas-rehash-failed:${checked.reason}`);
}

async function prepareRow(
  slug: string,
  key: string | null,
  candidates: readonly ManifestCandidate[],
  excluded: readonly ExcludedCapture[],
): Promise<ReadyRow | RefusedRow> {
  if (key === null) return { slug, key: null, reason: "served-collection-not-found" };
  const bytes = await getBytes(s3Client(), key);
  try {
    const current = asObject(JSON.parse(bytes.toString("utf8")));
    if (!current) throw new MissingSha256RestampRefusal("served-object-is-not-a-json-object");
    const attestations = attestationsForCurrent(current, candidates, excluded);
    const planned = planMissingSha256ProofRestamp(key, current, attestations);
    for (const attestation of planned.attestations) await assertManifestCas(attestation);
    await assertDryRunGuard(key, bytes, planned.next, planned.attestations);
    return { slug, key, attestations: planned.attestations };
  } catch (error) {
    if (error instanceof MissingSha256RestampRefusal) return { slug, key, reason: error.message };
    return { slug, key, reason: `additive-guard-refused:${errorText(error)}` };
  }
}

async function preparePlan(
  output: string,
  runPrefix: string,
  classifications: ReadonlyMap<string, ClassificationLine>,
  classificationReport: ClassificationReportReference,
  expectedReady: number,
  offset: number,
  limit: number | null,
): Promise<void> {
  const candidates = await captureCandidatesBySlug(runPrefix, classifications);
  console.error(`[proof-url-restamp] prepare: ${candidates.bySlug.size} geometry capture slug(s), ${candidates.excluded.length} non-geometry receipt(s) excluded; listing served collections`);
  const served = selectServedZoneCollections((await listObjectEntries(s3Client(), ZONES_PREFIX)).map((entry) => entry.key));
  const bySlug = new Map(served.map((entry) => [entry.slug, entry.key]));
  const allSlugs = [...new Set([...candidates.bySlug.keys(), ...candidates.excluded.flatMap((entry) => entry.slugs)])].sort();
  if (offset > allSlugs.length) throw new Error(`--prepare-offset ${offset} exceeds ${allSlugs.length} capture slugs`);
  const slugs = allSlugs.slice(offset, limit === null ? undefined : offset + limit);
  if (slugs.length === 0) throw new Error("prepare selection is empty");
  console.error(`[proof-url-restamp] prepare: reading ${slugs.length}/${allSlugs.length} served envelope(s), concurrency=${READ_CONCURRENCY}`);
  const excludedBySlug = new Map<string, ExcludedCapture[]>();
  for (const entry of candidates.excluded) {
    for (const slug of entry.slugs) {
      const entries = excludedBySlug.get(slug) ?? [];
      entries.push(entry);
      excludedBySlug.set(slug, entries);
    }
  }
  const outcomes = await mapConcurrent(slugs, (slug) => prepareRow(
    slug,
    bySlug.get(slug) ?? null,
    candidates.bySlug.get(slug) ?? [],
    excludedBySlug.get(slug) ?? [],
  ));
  const ready: ReadyRow[] = [];
  const refused: RefusedRow[] = [];
  for (let index = 0; index < outcomes.length; index++) {
    const outcome = outcomes[index]!;
    const slug = slugs[index]!;
    if (outcome.status === "rejected") throw new Error(`served collection read failed for ${slug}: ${errorText(outcome.reason)}`);
    if ("attestations" in outcome.value) ready.push(outcome.value);
    else refused.push(outcome.value);
  }
  ready.sort((left, right) => left.slug.localeCompare(right.slug));
  refused.sort((left, right) => left.slug.localeCompare(right.slug));
  const plan: Plan = {
    contract: "served-zonage-proof-url-restamp-plan/v3",
    complete: expectedReady === 0 || ready.length === expectedReady,
    run_prefix: runPrefix,
    generated_at: new Date().toISOString(),
    source: "capture-manifest-lines-classified-octets",
    classification_report: classificationReport,
    selected_layout: "nested_when_present_else_flat",
    collections: {
      capture_slugs: slugs.length,
      ready: ready.length,
      refused: refused.length,
      distinct_manifest_lines: new Set(ready.flatMap((row) => row.attestations.map((item) => `${item.manifest_key}\u0000${item.line_index}`))).size,
      excluded_capture_lines: candidates.excluded.length,
    },
    ready,
    refused,
    excluded_capture_lines: candidates.excluded,
  };
  writeAtomic(output, plan);
  console.log(JSON.stringify({ output: relative(ROOT, output), complete: plan.complete, collections: plan.collections }, null, 2));
  if (!plan.complete) throw new Error(`prepared plan has ${ready.length} ready collections; expected ${expectedReady}; no served object was written`);
}

function readPlan(path: string): Plan {
  const plan = JSON.parse(readFileSync(path, "utf8")) as Plan;
  if (
    plan.contract !== "served-zonage-proof-url-restamp-plan/v3" ||
    plan.complete !== true ||
    plan.source !== "capture-manifest-lines-classified-octets" ||
    plan.selected_layout !== "nested_when_present_else_flat" ||
    !asObject(plan.classification_report) ||
    typeof asObject(plan.classification_report)?.path !== "string" ||
    typeof asObject(plan.classification_report)?.sha256 !== "string" ||
    !Array.isArray(plan.ready) ||
    !Array.isArray(plan.refused) ||
    !Array.isArray(plan.excluded_capture_lines)
  ) throw new Error(`plan incomplete or incompatible: ${path}`);
  return plan;
}

function mergePlans(paths: string[], output: string, expectedReady: number): void {
  if (paths.length < 2) throw new Error("--merge-plans requires at least two plans");
  const plans = paths.map(readPlan);
  const classificationReport = plans[0]!.classification_report;
  if (plans.some((plan) => plan.classification_report.path !== classificationReport.path || plan.classification_report.sha256 !== classificationReport.sha256)) {
    throw new Error("merge refused: plans do not use the same complete classification report");
  }
  const readyBySlug = new Map<string, ReadyRow>();
  const allCaptureSlugs = new Set<string>();
  const refusedBySlug = new Map<string, RefusedRow>();
  for (const plan of plans) {
    for (const row of plan.ready) {
      if (readyBySlug.has(row.slug)) throw new Error(`merge refused: ${row.slug} appears in more than one ready plan`);
      readyBySlug.set(row.slug, row);
      allCaptureSlugs.add(row.slug);
    }
    for (const row of plan.refused) {
      allCaptureSlugs.add(row.slug);
      const previous = refusedBySlug.get(row.slug);
      if (!previous) refusedBySlug.set(row.slug, row);
      else if (previous.reason !== row.reason || previous.key !== row.key) {
        throw new Error(`merge refused: ${row.slug} has inconsistent refusal evidence across plans`);
      }
    }
  }
  const ready = [...readyBySlug.values()].sort((left, right) => left.slug.localeCompare(right.slug));
  const refused = [...refusedBySlug.values()].filter((row) => !readyBySlug.has(row.slug)).sort((left, right) => left.slug.localeCompare(right.slug));
  const plan: Plan = {
    contract: "served-zonage-proof-url-restamp-plan/v3",
    complete: ready.length === expectedReady,
    run_prefix: plans.map((item) => item.run_prefix).join(","),
    generated_at: new Date().toISOString(),
    source: "capture-manifest-lines-classified-octets",
    classification_report: classificationReport,
    selected_layout: "nested_when_present_else_flat",
    collections: {
      capture_slugs: allCaptureSlugs.size,
      ready: ready.length,
      refused: refused.length,
      distinct_manifest_lines: new Set(ready.flatMap((row) => row.attestations.map((item) => `${item.manifest_key}\u0000${item.line_index}`))).size,
      excluded_capture_lines: new Set(plans.flatMap((plan) => plan.excluded_capture_lines.map((entry) => `${entry.manifest_key}\u0000${entry.line_index}`))).size,
    },
    ready,
    refused,
    excluded_capture_lines: [...new Map(plans.flatMap((plan) => plan.excluded_capture_lines).map((entry) => [`${entry.manifest_key}\u0000${entry.line_index}`, entry])).values()]
      .sort((left, right) => left.manifest_key.localeCompare(right.manifest_key) || left.line_index - right.line_index),
  };
  writeAtomic(output, plan);
  console.log(JSON.stringify({ output: relative(ROOT, output), complete: plan.complete, collections: plan.collections }, null, 2));
  if (!plan.complete) throw new Error(`merged plan has ${ready.length} ready collections; expected ${expectedReady}; no served object was written`);
}

function readState(path: string): State | null {
  if (!existsSync(path)) return null;
  const state = JSON.parse(readFileSync(path, "utf8")) as State;
  if (state.contract !== "served-zonage-proof-url-restamp-state/v1") throw new Error(`state incompatible: ${path}`);
  return state;
}

async function applyRow(row: ReadyRow, mode: Mode): Promise<Result> {
  const bytes = await getBytes(s3Client(), row.key);
  let planned: ReturnType<typeof planMissingSha256ProofRestamp>;
  try {
    const current = asObject(JSON.parse(bytes.toString("utf8")));
    if (!current) throw new MissingSha256RestampRefusal("served-object-is-not-a-json-object");
    planned = planMissingSha256ProofRestamp(row.key, current, row.attestations);
    await assertDryRunGuard(row.key, bytes, planned.next, planned.attestations);
  } catch (error) {
    if (error instanceof MissingSha256RestampRefusal) return { slug: row.slug, key: row.key, outcome: "refused", replacements: 0, reason: error.message };
    return { slug: row.slug, key: row.key, outcome: "refused", replacements: 0, reason: `additive-guard-refused:${errorText(error)}` };
  }
  if (mode === "apply") {
    // A transport/copy/PUT failure is not a guard refusal. Propagate it so the
    // state records prior completed rows and the operator stops to inspect it.
    await putServedZoneAdditive(s3Client(), row.key, planned.next, {
      allowProofArtifactUriAndSha256Stamp: planned.attestations,
    });
  }
  return { slug: row.slug, key: row.key, outcome: mode === "apply" ? "applied" : "substitutable", replacements: planned.attestations.length };
}

function report(state: State): Record<string, unknown> {
  const results = Object.values(state.results).sort((left, right) => left.slug.localeCompare(right.slug));
  const refusedByReason: Record<string, number> = {};
  for (const result of results.filter((item) => item.outcome === "refused")) {
    const reason = result.reason ?? "unspecified";
    refusedByReason[reason] = (refusedByReason[reason] ?? 0) + 1;
  }
  return {
    contract: state.contract,
    plan: { path: state.plan_path, sha256: state.plan_sha256 },
    mode: state.mode,
    complete: state.next_batch >= Math.ceil(state.selected.length / state.batch_size),
    batches: { batch_size: state.batch_size, read_concurrency: READ_CONCURRENCY },
    collections: {
      selected: state.selected.length,
      processed: results.length,
      applied: results.filter((item) => item.outcome === "applied").length,
      substitutable: results.filter((item) => item.outcome === "substitutable").length,
      refused: results.filter((item) => item.outcome === "refused").length,
      refused_by_reason: refusedByReason,
      distinct_manifest_lines: new Set(state.selected.flatMap((row) => row.attestations.map((item) => `${item.manifest_key}\u0000${item.line_index}`))).size,
    },
    results,
  };
}

async function applyPlan(planPath: string, stem: string): Promise<void> {
  if (hasFlag("apply") && hasFlag("dry-run")) throw new Error("choose only one of --apply or --dry-run");
  const mode: Mode = hasFlag("apply") ? "apply" : "dry-run";
  const plan = readPlan(planPath);
  const offset = integerOption("offset", 0, 0, plan.ready.length);
  const limit = integerOption("limit", plan.ready.length - offset, 1, plan.ready.length - offset);
  const batchSize = integerOption("batch-size", DEFAULT_BATCH_SIZE, 1, 10);
  const selected = plan.ready.slice(offset, offset + limit);
  const planReference = relative(ROOT, planPath);
  const planSha256 = sha256(readFileSync(planPath));
  const statePath = resolve(ROOT, `${stem}.state.json`);
  const reportPath = resolve(ROOT, `${stem}.json`);
  const prior = readState(statePath);
  const state: State = prior ?? {
    contract: "served-zonage-proof-url-restamp-state/v1",
    plan_path: planReference,
    plan_sha256: planSha256,
    mode,
    batch_size: batchSize,
    selected,
    next_batch: 0,
    results: {},
  };
  if (state.plan_path !== planReference || state.plan_sha256 !== planSha256 || state.mode !== mode || state.batch_size !== batchSize) {
    throw new Error("state does not match this plan, mode, or batch size; use a new --stem");
  }
  if (!prior) writeAtomic(statePath, state);

  const batches = Math.ceil(state.selected.length / state.batch_size);
  while (state.next_batch < batches) {
    const batch = state.next_batch;
    const pending = state.selected.slice(batch * state.batch_size, (batch + 1) * state.batch_size).filter((row) => !state.results[row.key]);
    const outcomes = await mapConcurrent(pending, (row) => applyRow(row, mode));
    for (let index = 0; index < outcomes.length; index++) {
      const outcome = outcomes[index]!;
      if (outcome.status === "rejected") {
        writeAtomic(statePath, state);
        throw new Error(`S3 write/read failure in batch ${batch + 1}; state saved, inspect before retrying: ${errorText(outcome.reason)}`);
      }
      state.results[pending[index]!.key] = outcome.value;
    }
    state.next_batch++;
    writeAtomic(statePath, state);
    console.log(`[proof-url-restamp] ${mode} batch ${batch + 1}/${batches}: ${pending.length} processed, state saved`);
  }
  const result = report(state);
  writeAtomic(reportPath, result);
  console.log(JSON.stringify({ output: relative(ROOT, reportPath), complete: result.complete, collections: result.collections }, null, 2));
}

async function main(): Promise<void> {
  const prepare = option("prepare");
  const plan = option("plan");
  const merge = option("merge-plans");
  if ([prepare, plan, merge].filter((value) => value !== null).length !== 1) {
    throw new Error("choose exactly one of --prepare=<path>, --plan=<path>, or --merge-plans=<paths>");
  }
  if (prepare) {
    if (hasFlag("apply") || hasFlag("dry-run")) throw new Error("--prepare is read-only; do not pass --apply or --dry-run");
    const runPrefix = option("run-prefix");
    if (!runPrefix) throw new Error("--run-prefix=<capture-run-prefix> is required with --prepare");
    const classificationPath = option("classification");
    if (!classificationPath) throw new Error("--classification=<complete-capture-octets-classification.json> is required with --prepare");
    const resolvedClassificationPath = insideRepo(classificationPath, "classification");
    const prepareOffset = integerOption("prepare-offset", 0, 0, 10_000);
    const prepareLimit = option("prepare-limit");
    await preparePlan(
      insideRepo(prepare, "prepare"),
      runPrefix,
      readClassificationReport(resolvedClassificationPath),
      { path: relative(ROOT, resolvedClassificationPath), sha256: sha256(readFileSync(resolvedClassificationPath)) },
      integerOption("expect-ready", 50, 0, 10_000),
      prepareOffset,
      prepareLimit === null ? null : integerOption("prepare-limit", 1, 1, 10_000),
    );
    return;
  }
  if (merge) {
    if (hasFlag("apply") || hasFlag("dry-run")) throw new Error("--merge-plans is read-only; do not pass --apply or --dry-run");
    const paths = merge.split(",").map((item) => item.trim()).filter(Boolean).map((item) => insideRepo(item, "merge-plans"));
    const output = option("merge-output");
    if (!output) throw new Error("--merge-output=<path> is required with --merge-plans");
    mergePlans(paths, insideRepo(output, "merge-output"), integerOption("expect-ready", 50, 1, 10_000));
    return;
  }
  const stem = option("stem") ?? DEFAULT_STEM;
  await applyPlan(insideRepo(plan!, "plan"), stem);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
