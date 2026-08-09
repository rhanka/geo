/**
 * Read-only, resumable census of the proof URLs exposed by the served QC
 * zoning collections.  It exists to answer one narrow contract question for
 * Immo: an S3 artefact URL is not human-verifiable, and an ArcGIS query URL
 * must remain byte-for-byte intact.
 *
 * The geo-api selection rule is deliberately NOT the older registry-audit
 * rule: when both canonical layouts exist, the nested object is served.
 *
 * Usage (from repository root):
 *   NODE_OPTIONS="--dns-result-order=ipv4first --max-old-space-size=8192" \
 *   AWS_MAX_ATTEMPTS=10 npx tsx acquisition/src/served-zonage-immo-proof-url-audit.ts
 *
 * To audit one named restamp refusal class rather than the entire served
 * universe, select it from an immutable restamp plan:
 *   --restamp-plan=work/coverage/<plan>.json \
 *   --refusal-reason=no-s3-artifact-uri-found-in-current-feature-proofs
 *
 * The local state file is written atomically after each 20--30 item batch.
 * It contains no served write and can be resumed after an interruption.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseManifestJsonl, type CaptureManifestLine } from "../../packages/qc-sources/src/capture/index.js";
import { getBytes, listObjectEntries, s3Client } from "./lib/s3.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const ZONES_PREFIX = "normalized/ca-qc-zonage/";
const CAPTURE_RUNS_PREFIX = "capture/_runs/";
const DEFAULT_STEM = "work/coverage/served-zonage-immo-proof-url-audit-20260727";
const DEFAULT_BATCH_SIZE = 25;
const READ_CONCURRENCY = 2;
const SHA256_RE = /^sha256:[a-f0-9]{64}$/;

type Layout = "flat" | "nested";
type JsonObject = Record<string, unknown>;
type UrlField = "url" | "source_url" | "upstream_uri";
type OriginAvailability = "envelope" | "manifest-unique" | "manifest-ambiguous" | "absent";

interface ServedChoice {
  slug: string;
  key: string;
  layout: Layout;
  alternatives: string[];
}

interface EnvelopeUrl {
  url: string;
  fields: UrlField[];
}

interface S3ProofCase {
  artifact_uri: string;
  field: "proof.sources.geometry.artifact_uri";
  locations: Array<"collection.proof" | "feature.properties.proof">;
  envelope_public_urls: EnvelopeUrl[];
}

interface QueryProofCase {
  url: string;
  field: "proof.geometry_source.url";
  locations: Array<"collection.proof" | "feature.properties.proof">;
  sha256: string | null;
}

interface VerifiableProofCase {
  url: string;
  sha256: string;
  locations: Array<"collection.proof" | "feature.properties.proof">;
}

type ProofForm =
  | "proof-absent"
  | "proof-present-but-not-object"
  | "sources.geometry-absent"
  | "uniform-https-artifact-uri-with-valid-sha256"
  | "uniform-https-artifact-uri-sha256-missing-or-malformed"
  | "uniform-s3-artifact-uri"
  | "uniform-artifact-uri-absent"
  | "uniform-other-artifact-uri"
  | "mixed-geometry-artifact-uri-forms";

type GeometryArtifactForm =
  | "https-artifact-uri-with-valid-sha256"
  | "https-artifact-uri-sha256-missing-or-malformed"
  | "s3-artifact-uri"
  | "artifact-uri-absent"
  | "other-artifact-uri";

interface ProofEnvelopeSample {
  location: "collection.proof" | "feature.properties.proof";
  proof: JsonObject;
}

interface CollectionRow extends ServedChoice {
  proof_values: number;
  proof_envelopes: number;
  proof_schema_versions: string[];
  proof_form: ProofForm;
  geometry_artifact_forms: GeometryArtifactForm[];
  /** One complete, unmodified envelope for every distinct proof shape. */
  proof_envelope_samples: ProofEnvelopeSample[];
  s3_cases: S3ProofCase[];
  query_cases: QueryProofCase[];
  verifiable_https_sha256_cases: VerifiableProofCase[];
}

interface ManifestEvidence {
  url: string;
  retrieved_at: string;
  sha256: string;
  manifest_key: string;
  line_index: number;
}

interface Failure {
  phase: "collections" | "manifests";
  key: string;
  error: string;
}

interface AuditState {
  contract: "served-zonage-immo-proof-url-audit/v2";
  generated_at: string;
  read_only_s3: true;
  selection_rule: "nested_when_present_else_flat";
  selection: {
    restamp_plan_path: string | null;
    refusal_reason: string | null;
    slugs: string[];
  };
  batch_size: number;
  collections: {
    choices: ServedChoice[];
    rows: Record<string, CollectionRow>;
    next_batch: number;
  };
  manifests: {
    keys: string[] | null;
    next_batch: number;
    by_slug: Record<string, ManifestEvidence[]>;
  };
  failures: Failure[];
}

interface AuditSelection {
  restamp_plan_path: string | null;
  refusal_reason: string | null;
  slugs: string[];
}

interface ResolvedS3Case extends S3ProofCase {
  availability: OriginAvailability;
  manifest_public_origins: ManifestEvidence[];
}

interface ResolvedCollection extends CollectionRow {
  resolved_s3_cases: ResolvedS3Case[];
  public_origin_available: boolean;
  correctable_without_invention: boolean;
}

function option(name: string): string | null {
  const equals = `--${name}=`;
  const value = process.argv.slice(2).find((arg) => arg.startsWith(equals));
  return value ? value.slice(equals.length) : null;
}

function positiveIntegerOption(name: string, fallback: number): number {
  const value = option(name);
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`--${name} must be a positive integer`);
  return parsed;
}

function insideRepo(path: string, name: string): string {
  const resolved = resolve(ROOT, path);
  if (!resolved.startsWith(`${ROOT}/`)) throw new Error(`--${name} must resolve inside the repository`);
  return resolved;
}

function refusalSelection(planArgument: string | null, reason: string | null): AuditSelection {
  if (planArgument === null && reason === null) {
    return { restamp_plan_path: null, refusal_reason: null, slugs: [] };
  }
  if (planArgument === null || reason === null) {
    throw new Error("--restamp-plan and --refusal-reason must be supplied together");
  }
  const planPath = insideRepo(planArgument, "restamp-plan");
  const plan = asObject(JSON.parse(readFileSync(planPath, "utf8")));
  if (!Array.isArray(plan?.refused)) throw new Error(`restamp plan has no refused rows: ${planArgument}`);
  const slugs = plan.refused.flatMap((value) => {
    const row = asObject(value);
    return row?.reason === reason && typeof row.slug === "string" ? [row.slug] : [];
  }).sort();
  if (slugs.length === 0) throw new Error(`restamp plan has no refusals for ${reason}`);
  return { restamp_plan_path: relative(ROOT, planPath), refusal_reason: reason, slugs };
}

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function isPublicHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function hasQueryString(value: unknown): value is string {
  if (!isPublicHttpUrl(value)) return false;
  return new URL(value).search.length > 0;
}

function isPublicHttpsUrl(value: unknown): value is string {
  return isPublicHttpUrl(value) && new URL(value).protocol === "https:";
}

function geometryArtifactForm(geometry: JsonObject): GeometryArtifactForm {
  const artifactUri = geometry.artifact_uri;
  if (isPublicHttpsUrl(artifactUri)) {
    return typeof geometry.sha256 === "string" && SHA256_RE.test(geometry.sha256)
      ? "https-artifact-uri-with-valid-sha256"
      : "https-artifact-uri-sha256-missing-or-malformed";
  }
  if (typeof artifactUri === "string" && artifactUri.startsWith("s3://")) return "s3-artifact-uri";
  if (typeof artifactUri !== "string" || artifactUri.length === 0) return "artifact-uri-absent";
  return "other-artifact-uri";
}

function proofForm(
  proofValues: number,
  proofLocations: readonly { proof: JsonObject; location: "collection.proof" | "feature.properties.proof" }[],
): { proof_form: ProofForm; geometry_artifact_forms: GeometryArtifactForm[] } {
  if (proofValues === 0) return { proof_form: "proof-absent", geometry_artifact_forms: [] };
  if (proofLocations.length === 0) return { proof_form: "proof-present-but-not-object", geometry_artifact_forms: [] };
  const forms = new Set<GeometryArtifactForm>();
  let geometryCount = 0;
  for (const { proof } of proofLocations) {
    const geometry = asObject(asObject(proof.sources)?.geometry);
    if (geometry === null) continue;
    geometryCount++;
    forms.add(geometryArtifactForm(geometry));
  }
  const geometryArtifactForms = [...forms].sort();
  if (geometryCount === 0) return { proof_form: "sources.geometry-absent", geometry_artifact_forms: geometryArtifactForms };
  if (geometryArtifactForms.length > 1) return { proof_form: "mixed-geometry-artifact-uri-forms", geometry_artifact_forms: geometryArtifactForms };
  const form = geometryArtifactForms[0];
  if (form === "https-artifact-uri-with-valid-sha256") {
    return { proof_form: "uniform-https-artifact-uri-with-valid-sha256", geometry_artifact_forms: geometryArtifactForms };
  }
  if (form === "https-artifact-uri-sha256-missing-or-malformed") {
    return { proof_form: "uniform-https-artifact-uri-sha256-missing-or-malformed", geometry_artifact_forms: geometryArtifactForms };
  }
  if (form === "s3-artifact-uri") return { proof_form: "uniform-s3-artifact-uri", geometry_artifact_forms: geometryArtifactForms };
  if (form === "artifact-uri-absent") return { proof_form: "uniform-artifact-uri-absent", geometry_artifact_forms: geometryArtifactForms };
  return { proof_form: "uniform-other-artifact-uri", geometry_artifact_forms: geometryArtifactForms };
}

function errorText(error: unknown): string {
  const detail = error as { name?: unknown; message?: unknown; $metadata?: { httpStatusCode?: unknown } };
  const status = detail?.$metadata?.httpStatusCode;
  return `${String(detail?.name ?? "Error")}: ${String(detail?.message ?? error)}${status ? ` (HTTP ${status})` : ""}`;
}

export function atomicTemporaryPath(path: string): string {
  return `${path}.${randomUUID()}.tmp`;
}

function writeAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = atomicTemporaryPath(path);
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n");
  renameSync(temporary, path);
}

function readState(path: string): AuditState | null {
  if (!existsSync(path)) return null;
  const state = JSON.parse(readFileSync(path, "utf8")) as AuditState;
  if (state.contract !== "served-zonage-immo-proof-url-audit/v2") {
    throw new Error(`state incompatible: ${path}`);
  }
  if (state.selection_rule !== "nested_when_present_else_flat") {
    throw new Error(`state has an unsafe layout rule: ${state.selection_rule}`);
  }
  if (!Array.isArray(state.selection?.slugs)) throw new Error(`state selection is incompatible: ${path}`);
  return state;
}

function choiceFromKey(key: string): { slug: string; layout: Layout } | null {
  const flat = key.match(/^normalized\/ca-qc-zonage\/qc-zonage-([a-z0-9-]+)\.geojson$/);
  if (flat) return { slug: flat[1]!, layout: "flat" };
  const nested = key.match(/^normalized\/ca-qc-zonage\/qc-zonage-([a-z0-9-]+)\/qc-zonage-([a-z0-9-]+)\.geojson$/);
  return nested && nested[1] === nested[2] ? { slug: nested[1], layout: "nested" } : null;
}

function resolveServedChoices(keys: readonly string[]): ServedChoice[] {
  const grouped = new Map<string, Partial<Record<Layout, string>>>();
  for (const key of keys) {
    const parsed = choiceFromKey(key);
    if (!parsed) continue;
    const layouts = grouped.get(parsed.slug) ?? {};
    layouts[parsed.layout] = key;
    grouped.set(parsed.slug, layouts);
  }
  return [...grouped.entries()]
    .map(([slug, layouts]) => {
      const key = layouts.nested ?? layouts.flat;
      if (!key) throw new Error(`internal selection failure for ${slug}`);
      const layout: Layout = layouts.nested ? "nested" : "flat";
      return {
        slug,
        key,
        layout,
        alternatives: [layouts.flat, layouts.nested].filter((value): value is string => !!value && value !== key),
      };
    })
    .sort((left, right) => left.slug.localeCompare(right.slug));
}

function envelopeUrls(geometry: JsonObject): EnvelopeUrl[] {
  const byUrl = new Map<string, Set<UrlField>>();
  for (const field of ["url", "source_url", "upstream_uri"] as const) {
    const value = geometry[field];
    if (!isPublicHttpUrl(value)) continue;
    const fields = byUrl.get(value) ?? new Set<UrlField>();
    fields.add(field);
    byUrl.set(value, fields);
  }
  return [...byUrl.entries()]
    .map(([url, fields]) => ({ url, fields: [...fields].sort() }))
    .sort((left, right) => left.url.localeCompare(right.url));
}

function inspectCollection(choice: ServedChoice, bytes: Buffer): CollectionRow {
  const parsed = JSON.parse(bytes.toString("utf8")) as unknown;
  const collection = asObject(parsed);
  if (!collection || collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
    throw new Error("invalid GeoJSON FeatureCollection");
  }

  const proofLocations: Array<{ proof: JsonObject; location: "collection.proof" | "feature.properties.proof" }> = [];
  let proofValues = 0;
  if (Object.hasOwn(collection, "proof")) {
    proofValues++;
    const topProof = asObject(collection.proof);
    if (topProof) proofLocations.push({ proof: topProof, location: "collection.proof" });
  }
  for (const feature of collection.features) {
    const properties = asObject(asObject(feature)?.properties);
    if (properties && Object.hasOwn(properties, "proof")) {
      proofValues++;
      const proof = asObject(properties.proof);
      if (proof) proofLocations.push({ proof, location: "feature.properties.proof" });
    }
  }

  const schemas = new Set<string>();
  const samples = new Map<string, ProofEnvelopeSample>();
  const s3Cases = new Map<string, { locations: Set<"collection.proof" | "feature.properties.proof">; urls: Map<string, Set<UrlField>> }>();
  const queryCases = new Map<string, { locations: Set<"collection.proof" | "feature.properties.proof">; sha256: string | null }>();
  const verifiableCases = new Map<string, { url: string; sha256: string; locations: Set<"collection.proof" | "feature.properties.proof"> }>();

  for (const { proof, location } of proofLocations) {
    if (typeof proof.schema_version === "string") schemas.add(proof.schema_version);
    const serialized = JSON.stringify(proof);
    if (!samples.has(serialized)) samples.set(serialized, { location, proof });
    const geometry = asObject(asObject(proof.sources)?.geometry);
    const artifact = geometry?.artifact_uri;
    const artifactSha256 = geometry?.sha256;
    if (isPublicHttpsUrl(artifact) && typeof artifactSha256 === "string" && SHA256_RE.test(artifactSha256)) {
      const identity = `${artifact}\u0000${artifactSha256}`;
      const current = verifiableCases.get(identity) ?? { url: artifact, sha256: artifactSha256, locations: new Set() };
      current.locations.add(location);
      verifiableCases.set(identity, current);
    }
    if (geometry && typeof artifact === "string" && artifact.startsWith("s3://")) {
      const current = s3Cases.get(artifact) ?? { locations: new Set(), urls: new Map() };
      current.locations.add(location);
      for (const candidate of envelopeUrls(geometry)) {
        const fields = current.urls.get(candidate.url) ?? new Set<UrlField>();
        for (const field of candidate.fields) fields.add(field);
        current.urls.set(candidate.url, fields);
      }
      s3Cases.set(artifact, current);
    }

    const geometrySource = asObject(proof.geometry_source);
    const url = geometrySource?.url;
    if (proof.schema_version === "2.0" && hasQueryString(url)) {
      const current = queryCases.get(url) ?? { locations: new Set(), sha256: null };
      current.locations.add(location);
      if (typeof geometrySource?.sha256 === "string") current.sha256 = geometrySource.sha256;
      queryCases.set(url, current);
    }
    const proofSha256 = geometrySource?.sha256;
    if (proof.schema_version === "2.0" && isPublicHttpsUrl(url) && typeof proofSha256 === "string" && SHA256_RE.test(proofSha256)) {
      const identity = `${url}\u0000${proofSha256}`;
      const current = verifiableCases.get(identity) ?? { url, sha256: proofSha256, locations: new Set() };
      current.locations.add(location);
      verifiableCases.set(identity, current);
    }
  }

  const form = proofForm(proofValues, proofLocations);

  return {
    ...choice,
    proof_values: proofValues,
    proof_envelopes: proofLocations.length,
    proof_schema_versions: [...schemas].sort(),
    ...form,
    proof_envelope_samples: [...samples.values()],
    s3_cases: [...s3Cases.entries()].map(([artifact_uri, details]) => ({
      artifact_uri,
      field: "proof.sources.geometry.artifact_uri" as const,
      locations: [...details.locations].sort(),
      envelope_public_urls: [...details.urls.entries()]
        .map(([url, fields]) => ({ url, fields: [...fields].sort() }))
        .sort((left, right) => left.url.localeCompare(right.url)),
    })).sort((left, right) => left.artifact_uri.localeCompare(right.artifact_uri)),
    query_cases: [...queryCases.entries()].map(([url, details]) => ({
      url,
      field: "proof.geometry_source.url" as const,
      locations: [...details.locations].sort(),
      sha256: details.sha256,
    })).sort((left, right) => left.url.localeCompare(right.url)),
    verifiable_https_sha256_cases: [...verifiableCases.values()].map((details) => ({
      url: details.url,
      sha256: details.sha256,
      locations: [...details.locations].sort(),
    })).sort((left, right) => left.url.localeCompare(right.url) || left.sha256.localeCompare(right.sha256)),
  };
}

async function mapConcurrent<T, R>(items: readonly T[], fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = { status: "fulfilled", value: await fn(items[index]!) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, items.length) }, worker));
  return results;
}

function usableManifestLine(line: CaptureManifestLine): line is CaptureManifestLine & { retrieved_at: string; sha256: string } {
  return !line.redacted && isPublicHttpUrl(line.url) && line.retrieved_at !== null && line.sha256 !== null && SHA256_RE.test(line.sha256);
}

function manifestKey(key: string): boolean {
  return /^capture\/_runs\/[^/]+\/manifest\.jsonl$/.test(key);
}

function resolveCase(candidate: S3ProofCase, evidence: readonly ManifestEvidence[]): ResolvedS3Case {
  if (candidate.envelope_public_urls.length > 0) {
    return { ...candidate, availability: "envelope", manifest_public_origins: [] };
  }
  const byTuple = new Map<string, ManifestEvidence>();
  for (const item of evidence) byTuple.set(`${item.url}\u0000${item.retrieved_at}\u0000${item.sha256}`, item);
  const origins = [...byTuple.values()].sort((left, right) =>
    left.url.localeCompare(right.url) || left.retrieved_at.localeCompare(right.retrieved_at) || left.sha256.localeCompare(right.sha256),
  );
  if (origins.length === 0) return { ...candidate, availability: "absent", manifest_public_origins: [] };
  return { ...candidate, availability: origins.length === 1 ? "manifest-unique" : "manifest-ambiguous", manifest_public_origins: origins };
}

function resolveRows(state: AuditState): ResolvedCollection[] {
  return Object.values(state.collections.rows)
    .map((row) => {
      const resolved_s3_cases = row.s3_cases.map((candidate) => resolveCase(candidate, state.manifests.by_slug[row.slug] ?? []));
      const public_origin_available = resolved_s3_cases.length > 0 && resolved_s3_cases.every((item) => item.availability !== "absent");
      const correctable_without_invention = resolved_s3_cases.length > 0 && resolved_s3_cases.every((item) =>
        item.availability === "envelope" || item.availability === "manifest-unique",
      );
      return { ...row, resolved_s3_cases, public_origin_available, correctable_without_invention };
    })
    .sort((left, right) => left.slug.localeCompare(right.slug));
}

function report(state: AuditState): Record<string, unknown> {
  const rows = resolveRows(state);
  const total = state.collections.choices.length;
  const manifestsComplete = state.manifests.keys === null
    ? rows.every((row) => row.s3_cases.length === 0)
    : state.manifests.next_batch >= Math.ceil(state.manifests.keys.length / state.batch_size);
  const complete = rows.length === total && state.failures.length === 0 && manifestsComplete;
  const withProof = rows.filter((row) => row.proof_envelopes > 0);
  const withS3 = rows.filter((row) => row.s3_cases.length > 0);
  const withQuery = rows.filter((row) => row.query_cases.length > 0);
  const withVerifiableHttpsSha256 = rows.filter((row) => row.verifiable_https_sha256_cases.length > 0);
  const publicAvailable = withS3.filter((row) => row.public_origin_available);
  const correctable = withS3.filter((row) => row.correctable_without_invention);
  const absent = withS3.filter((row) => row.resolved_s3_cases.some((item) => item.availability === "absent"));
  const ambiguous = withS3.filter((row) => row.resolved_s3_cases.some((item) => item.availability === "manifest-ambiguous"));
  const nested = rows.filter((row) => row.layout === "nested");
  const both = rows.filter((row) => row.alternatives.length > 0);
  const proofFormPartition = Object.fromEntries([...new Set(rows.map((row) => row.proof_form))].sort().map((form) => [form, {
    collections: rows.filter((row) => row.proof_form === form).length,
    slugs: rows.filter((row) => row.proof_form === form).map((row) => row.slug),
  }]));
  return {
    contract: state.contract,
    generated_at: new Date().toISOString(),
    read_only_s3: true,
    complete,
    selection_rule: state.selection_rule,
    selection: state.selection,
    batches: { batch_size: state.batch_size, read_concurrency: READ_CONCURRENCY },
    collections: {
      served: total,
      read: rows.length,
      nested_selected: nested.length,
      both_layouts: both.length,
      with_proof: withProof.length,
      with_v1_s3_artifact: withS3.length,
      with_v2_url_query: withQuery.length,
      with_verifiable_https_url_sha256: withVerifiableHttpsSha256.length,
      v1_s3_cases: withS3.reduce((sum, row) => sum + row.s3_cases.length, 0),
      v2_query_cases: withQuery.reduce((sum, row) => sum + row.query_cases.length, 0),
      s3_public_url_available: publicAvailable.length,
      s3_url_absent: absent.length,
      s3_manifest_ambiguous: ambiguous.length,
      s3_correctable_without_invention: correctable.length,
      s3_not_correctable_without_invention: withS3.length - correctable.length,
    },
    fields: {
      v1: "features[*].properties.proof.sources.geometry.artifact_uri",
      v2_collection: "proof.geometry_source.url",
      v2_feature: "features[*].properties.proof.geometry_source.url",
    },
    manifest_lookup: "only unredacted http(s) lines with url + retrieved_at + sha256, indexed by manifest slugs[]; multiple distinct tuples remain ambiguous",
    proof_form_partition: proofFormPartition,
    failures: state.failures,
    rows,
  };
}

export function selectAuditChoices(choices: readonly ServedChoice[], selection: AuditSelection): ServedChoice[] {
  if (selection.slugs.length === 0) return [...choices];
  const selected = choices.filter((choice) => selection.slugs.includes(choice.slug));
  if (selected.length !== selection.slugs.length) {
    const found = new Set(selected.map((choice) => choice.slug));
    throw new Error(`selected served collections not found: ${selection.slugs.filter((slug) => !found.has(slug)).join(",")}`);
  }
  return selected;
}

async function initialState(batchSize: number, selection: AuditSelection): Promise<AuditState> {
  const s3 = s3Client();
  const entries = await listObjectEntries(s3, ZONES_PREFIX);
  const choices = resolveServedChoices(entries.map((entry) => entry.key));
  const selected = selectAuditChoices(choices, selection);
  return {
    contract: "served-zonage-immo-proof-url-audit/v2",
    generated_at: new Date().toISOString(),
    read_only_s3: true,
    selection_rule: "nested_when_present_else_flat",
    selection,
    batch_size: batchSize,
    collections: { choices: selected, rows: {}, next_batch: 0 },
    manifests: { keys: null, next_batch: 0, by_slug: {} },
    failures: [],
  };
}

async function scanCollections(state: AuditState, statePath: string, maxBatches: number): Promise<boolean> {
  const s3 = s3Client();
  const batches = Math.ceil(state.collections.choices.length / state.batch_size);
  let scanned = 0;
  while (state.collections.next_batch < batches && scanned < maxBatches) {
    const batch = state.collections.next_batch;
    const choices = state.collections.choices.slice(batch * state.batch_size, (batch + 1) * state.batch_size)
      .filter((choice) => !state.collections.rows[choice.key]);
    const outcomes = await mapConcurrent(choices, async (choice) => inspectCollection(choice, await getBytes(s3, choice.key)));
    for (let index = 0; index < outcomes.length; index++) {
      const outcome = outcomes[index]!;
      const choice = choices[index]!;
      if (outcome.status === "fulfilled") state.collections.rows[choice.key] = outcome.value;
      else state.failures.push({ phase: "collections", key: choice.key, error: errorText(outcome.reason) });
    }
    state.collections.next_batch++;
    scanned++;
    writeAtomic(statePath, state);
    console.log(`[immo-proof-url-audit] collections batch ${batch + 1}/${batches}: ${choices.length} read, state saved`);
    if (outcomes.some((outcome) => outcome.status === "rejected")) {
      throw new Error("collection read failure; state saved, rerun after resolving S3 failure");
    }
  }
  return state.collections.next_batch >= batches;
}

async function scanManifests(state: AuditState, statePath: string, maxBatches: number): Promise<boolean> {
  const targetSlugs = new Set(Object.values(state.collections.rows).filter((row) => row.s3_cases.length > 0).map((row) => row.slug));
  if (targetSlugs.size === 0) return true;
  const s3 = s3Client();
  if (state.manifests.keys === null) {
    const entries = await listObjectEntries(s3, CAPTURE_RUNS_PREFIX);
    state.manifests.keys = entries.map((entry) => entry.key).filter(manifestKey);
    writeAtomic(statePath, state);
    console.log(`[immo-proof-url-audit] ${state.manifests.keys.length} manifests listed, state saved`);
  }
  const keys = state.manifests.keys;
  const batches = Math.ceil(keys.length / state.batch_size);
  let scanned = 0;
  while (state.manifests.next_batch < batches && scanned < maxBatches) {
    const batch = state.manifests.next_batch;
    const selected = keys.slice(batch * state.batch_size, (batch + 1) * state.batch_size);
    const outcomes = await mapConcurrent(selected, async (key) => {
      const lines = parseManifestJsonl((await getBytes(s3, key)).toString("utf8"));
      return lines.flatMap((line, lineIndex) => !usableManifestLine(line)
        ? []
        : line.slugs.filter((slug) => targetSlugs.has(slug)).map((slug) => ({
          slug,
          evidence: {
            url: line.url,
            retrieved_at: line.retrieved_at,
            sha256: line.sha256,
            manifest_key: key,
            line_index: lineIndex,
          } satisfies ManifestEvidence,
        })),
      );
    });
    for (let index = 0; index < outcomes.length; index++) {
      const outcome = outcomes[index]!;
      const key = selected[index]!;
      if (outcome.status === "rejected") {
        state.failures.push({ phase: "manifests", key, error: errorText(outcome.reason) });
        continue;
      }
      for (const { slug, evidence } of outcome.value) {
        state.manifests.by_slug[slug] = [...(state.manifests.by_slug[slug] ?? []), evidence];
      }
    }
    state.manifests.next_batch++;
    scanned++;
    writeAtomic(statePath, state);
    console.log(`[immo-proof-url-audit] manifests batch ${batch + 1}/${batches}: ${selected.length} read, state saved`);
    if (outcomes.some((outcome) => outcome.status === "rejected")) {
      throw new Error("manifest read failure; state saved, rerun after resolving S3 failure");
    }
  }
  return state.manifests.next_batch >= batches;
}

async function main(): Promise<void> {
  const batchSize = Number(option("batch-size") ?? DEFAULT_BATCH_SIZE);
  if (!Number.isInteger(batchSize) || batchSize < 20 || batchSize > 30) {
    throw new Error("--batch-size must be an integer between 20 and 30");
  }
  const stem = option("stem") ?? DEFAULT_STEM;
  const maxBatches = positiveIntegerOption("max-batches", Number.MAX_SAFE_INTEGER);
  const selection = refusalSelection(option("restamp-plan"), option("refusal-reason"));
  const statePath = resolve(ROOT, `${stem}.state.json`);
  const reportPath = resolve(ROOT, `${stem}.json`);
  const prior = readState(statePath);
  const state = prior ?? await initialState(batchSize, selection);
  if (state.batch_size !== batchSize) throw new Error(`state batch_size=${state.batch_size}; resume with --batch-size=${state.batch_size}`);
  if (JSON.stringify(state.selection) !== JSON.stringify(selection)) throw new Error("state selection does not match this invocation");
  if (!prior) writeAtomic(statePath, state);

  const collectionsComplete = await scanCollections(state, statePath, maxBatches);
  if (!collectionsComplete) {
    console.log(JSON.stringify({
      output: statePath,
      complete: false,
      phase: "collections",
      scanned_collections: Object.keys(state.collections.rows).length,
      remaining_collections: state.collections.choices.length - Object.keys(state.collections.rows).length,
      resume: "rerun with the same --stem",
    }, null, 2));
    return;
  }
  const manifestsComplete = await scanManifests(state, statePath, maxBatches);
  if (!manifestsComplete) {
    console.log(JSON.stringify({
      output: statePath,
      complete: false,
      phase: "manifests",
      scanned_manifests: state.manifests.next_batch * state.batch_size,
      total_manifests: state.manifests.keys?.length ?? 0,
      resume: "rerun with the same --stem",
    }, null, 2));
    return;
  }
  const result = report(state);
  writeAtomic(reportPath, result);
  const counts = result.collections as Record<string, unknown>;
  console.log(JSON.stringify({ output: reportPath, complete: result.complete, collections: counts, failures: state.failures.length }, null, 2));
  if (!result.complete) process.exitCode = 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
