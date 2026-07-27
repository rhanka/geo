/**
 * Resumable, fail-closed replacement of legacy immo v1 proof artifact URIs.
 *
 * This runner consumes the committed URL audit. It never invents an origin:
 * an envelope URL must still be present in the served envelope, and a manifest
 * URL must be the audit's sole capture tuple with the exact same SHA-256.
 *
 * Usage from repository root (dry-run is the default):
 *   NODE_OPTIONS="--dns-result-order=ipv4first --max-old-space-size=8192" \
 *   AWS_MAX_ATTEMPTS=10 npx tsx acquisition/src/served-zonage-immo-proof-url-substitution.ts \
 *   --limit=10
 *
 * Add --apply only after a separate deposit decision. Reads run at concurrency
 * two; state and report are atomically saved after each short batch.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  putServedZoneAdditive,
  type ProofArtifactUriSubstitution,
} from "./lib/zonage-proof.js";
import { getBytes, s3Client } from "./lib/s3.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const DEFAULT_AUDIT = "work/coverage/served-zonage-immo-proof-url-audit-20260727.json";
const DEFAULT_STEM = "work/coverage/served-zonage-immo-proof-url-substitution-20260727";
const DEFAULT_BATCH_SIZE = 10;
const READ_CONCURRENCY = 2;
const SHA256_RE = /^sha256:[a-f0-9]{64}$/;

type JsonObject = Record<string, unknown>;
type Mode = "dry-run" | "apply";
type Outcome = "substitutable" | "applied" | "refused";

interface AuditEnvelopeUrl { url: string; fields: string[] }
interface AuditManifestOrigin { url: string; retrieved_at: string; sha256: string; manifest_key: string; line_index: number }
interface AuditS3Case {
  artifact_uri: string;
  envelope_public_urls: AuditEnvelopeUrl[];
  availability: "envelope" | "manifest-unique" | "manifest-ambiguous" | "absent";
  manifest_public_origins: AuditManifestOrigin[];
}
interface AuditRow {
  slug: string;
  key: string;
  s3_cases: Array<{ artifact_uri: string }>;
  resolved_s3_cases: AuditS3Case[];
}
interface AuditReport {
  contract: "served-zonage-immo-proof-url-audit/v1";
  complete: boolean;
  rows: AuditRow[];
}
interface Result {
  slug: string;
  key: string;
  outcome: Outcome;
  replacements: number;
  reason?: string;
}
interface State {
  contract: "served-zonage-immo-proof-url-substitution/v1";
  audit_path: string;
  audit_sha256: string;
  mode: Mode;
  batch_size: number;
  selected: AuditRow[];
  next_batch: number;
  results: Record<string, Result>;
}

class Refusal extends Error {}

function option(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

function integerOption(name: string, fallback: number, min: number, max: number): number {
  const value = option(name);
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`--${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sha256(value: Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function isHttpsUrlWithoutQuery(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !!parsed.hostname && parsed.search.length === 0;
  } catch {
    return false;
  }
}

function writeAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n");
  renameSync(temporary, path);
}

function readAudit(path: string): AuditReport {
  const audit = JSON.parse(readFileSync(path, "utf8")) as AuditReport;
  if (audit.contract !== "served-zonage-immo-proof-url-audit/v1" || !audit.complete || !Array.isArray(audit.rows)) {
    throw new Error(`audit is incomplete or incompatible: ${path}`);
  }
  return audit;
}

function selectedRows(audit: AuditReport, limit: number): AuditRow[] {
  return audit.rows
    .filter((row) => Array.isArray(row.s3_cases) && row.s3_cases.length > 0 && Array.isArray(row.resolved_s3_cases))
    .sort((left, right) => left.slug.localeCompare(right.slug))
    .slice(0, limit);
}

function readState(path: string): State | null {
  if (!existsSync(path)) return null;
  const state = JSON.parse(readFileSync(path, "utf8")) as State;
  if (state.contract !== "served-zonage-immo-proof-url-substitution/v1") throw new Error(`state incompatible: ${path}`);
  return state;
}

function sourceCases(row: AuditRow): Map<string, AuditS3Case> {
  const byArtifact = new Map<string, AuditS3Case>();
  for (const item of row.resolved_s3_cases) {
    if (byArtifact.has(item.artifact_uri)) throw new Refusal("audit-artifact-uri-ambiguous");
    byArtifact.set(item.artifact_uri, item);
  }
  return byArtifact;
}

function substitutionFromEnvelope(geometry: JsonObject, item: AuditS3Case): ProofArtifactUriSubstitution {
  const replacementUrl = geometry.upstream_uri;
  const envelopeListsUrl = typeof replacementUrl === "string" && item.envelope_public_urls.some((candidate) => candidate.url === replacementUrl);
  if (!envelopeListsUrl || !isHttpsUrlWithoutQuery(replacementUrl)) {
    throw new Refusal("envelope-public-url-missing-invalid-or-changed");
  }
  const sha = geometry.sha256;
  if (typeof sha !== "string" || !SHA256_RE.test(sha)) throw new Refusal("envelope-sha256-missing-or-invalid");
  return { artifactUri: item.artifact_uri, replacementUrl, sha256: sha as `sha256:${string}` };
}

function substitutionFromManifest(geometry: JsonObject, item: AuditS3Case): ProofArtifactUriSubstitution {
  if (item.manifest_public_origins.length !== 1) throw new Refusal("manifest-public-url-not-unique");
  const origin = item.manifest_public_origins[0]!;
  if (!isHttpsUrlWithoutQuery(origin.url)) throw new Refusal("manifest-public-url-not-https-or-has-query");
  const sha = geometry.sha256;
  if (typeof sha !== "string" || !SHA256_RE.test(sha)) throw new Refusal("envelope-sha256-missing-or-invalid");
  if (sha !== origin.sha256) throw new Refusal("envelope-sha256-does-not-match-manifest");
  return { artifactUri: item.artifact_uri, replacementUrl: origin.url, sha256: sha as `sha256:${string}` };
}

function attestedSubstitution(geometry: JsonObject, item: AuditS3Case): ProofArtifactUriSubstitution {
  if (item.availability === "envelope") return substitutionFromEnvelope(geometry, item);
  if (item.availability === "manifest-unique") return substitutionFromManifest(geometry, item);
  if (item.availability === "manifest-ambiguous") throw new Refusal("manifest-public-url-ambiguous");
  throw new Refusal("public-url-absent-from-envelope-and-manifest");
}

function planSubstitution(row: AuditRow, current: JsonObject): {
  next: JsonObject;
  substitutions: ProofArtifactUriSubstitution[];
} {
  if (current.type !== "FeatureCollection" || !Array.isArray(current.features)) throw new Refusal("served-object-is-not-a-feature-collection");
  const collectionProof = asObject(current.proof);
  const collectionArtifact = asObject(asObject(collectionProof?.sources)?.geometry)?.artifact_uri;
  if (typeof collectionArtifact === "string" && collectionArtifact.startsWith("s3://")) {
    throw new Refusal("collection-level-proof-artifact-uri-is-immutable");
  }

  const cases = sourceCases(row);
  if (cases.size !== row.s3_cases.length) throw new Refusal("audit-resolved-case-count-mismatch");
  const next = clone(current);
  const nextFeatures = next.features;
  if (!Array.isArray(nextFeatures)) throw new Refusal("internal-clone-lost-feature-array");
  const encountered = new Set<string>();
  const substitutions = new Map<string, ProofArtifactUriSubstitution>();

  for (let index = 0; index < current.features.length; index++) {
    const currentFeature = asObject(current.features[index]);
    const nextFeature = asObject(nextFeatures[index]);
    const currentProof = asObject(asObject(currentFeature?.properties)?.proof);
    const nextProof = asObject(asObject(nextFeature?.properties)?.proof);
    if (!currentProof || !nextProof) continue;
    const geometry = asObject(asObject(currentProof.sources)?.geometry);
    const nextGeometry = asObject(asObject(nextProof.sources)?.geometry);
    const artifactUri = geometry?.artifact_uri;
    if (typeof artifactUri !== "string" || !artifactUri.startsWith("s3://")) continue;
    if (currentProof.schema_version !== "1.0" || nextProof.schema_version !== "1.0" || !geometry || !nextGeometry) {
      throw new Refusal(`feature-${index}-s3-artifact-is-not-a-v1-geometry-proof`);
    }
    const item = cases.get(artifactUri);
    if (!item) throw new Refusal(`feature-${index}-s3-artifact-is-not-listed-by-audit`);
    const substitution = attestedSubstitution(geometry, item);
    nextGeometry.artifact_uri = substitution.replacementUrl;
    encountered.add(artifactUri);
    substitutions.set(`${substitution.artifactUri}\u0000${substitution.replacementUrl}\u0000${substitution.sha256}`, substitution);
  }

  for (const artifactUri of cases.keys()) {
    if (!encountered.has(artifactUri)) throw new Refusal("audit-artifact-uri-not-found-in-current-feature-proofs");
  }
  if (substitutions.size === 0) throw new Refusal("no-s3-artifact-uri-found-in-current-feature-proofs");
  return { next, substitutions: [...substitutions.values()] };
}

/** Run the exact production additive guard against the bytes just read, without
 * an S3 write. A dry-run cannot claim a mutation that --apply would reject. */
async function assertDryRunGuard(key: string, bytes: Buffer, next: JsonObject, substitutions: ProofArtifactUriSubstitution[]): Promise<void> {
  const s3 = {
    send: async (command: { constructor: { name: string } }) => {
      if (command.constructor.name === "HeadObjectCommand") return {};
      if (command.constructor.name === "GetObjectCommand") return { Body: [bytes] };
      throw new Error(`dry-run additive guard unexpectedly sent ${command.constructor.name}`);
    },
  } as never;
  await putServedZoneAdditive(s3, key, next, { allowProofArtifactUriSubstitution: substitutions, backup: false });
}

async function processRow(row: AuditRow, mode: Mode): Promise<Result> {
  const s3 = s3Client();
  const bytes = await getBytes(s3, row.key);
  let current: JsonObject;
  try {
    current = asObject(JSON.parse(bytes.toString("utf8"))) ?? (() => { throw new Refusal("served-object-is-not-a-json-object"); })();
  } catch (error) {
    if (error instanceof Refusal) return { slug: row.slug, key: row.key, outcome: "refused", replacements: 0, reason: error.message };
    return { slug: row.slug, key: row.key, outcome: "refused", replacements: 0, reason: "served-object-invalid-json" };
  }
  try {
    const { next, substitutions } = planSubstitution(row, current);
    await assertDryRunGuard(row.key, bytes, next, substitutions);
    if (mode === "apply") {
      await putServedZoneAdditive(s3, row.key, next, { allowProofArtifactUriSubstitution: substitutions });
    }
    return { slug: row.slug, key: row.key, outcome: mode === "apply" ? "applied" : "substitutable", replacements: substitutions.length };
  } catch (error) {
    if (error instanceof Refusal) return { slug: row.slug, key: row.key, outcome: "refused", replacements: 0, reason: error.message };
    throw error;
  }
}

async function mapConcurrent<T, R>(items: readonly T[], fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
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
  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, items.length) }, worker));
  return results;
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
    audit: { path: state.audit_path, sha256: state.audit_sha256 },
    mode: state.mode,
    complete: state.next_batch >= Math.ceil(state.selected.length / state.batch_size),
    batches: { batch_size: state.batch_size, read_concurrency: READ_CONCURRENCY },
    collections: {
      selected: state.selected.length,
      processed: results.length,
      substitutable: results.filter((item) => item.outcome === "substitutable").length,
      applied: results.filter((item) => item.outcome === "applied").length,
      non_corrected: results.filter((item) => item.outcome === "refused").length,
      refused_by_reason: refusedByReason,
    },
    results,
  };
}

async function main(): Promise<void> {
  if (hasFlag("apply") && hasFlag("dry-run")) throw new Error("choose only one of --apply or --dry-run");
  const mode: Mode = hasFlag("apply") ? "apply" : "dry-run";
  const batchSize = integerOption("batch-size", DEFAULT_BATCH_SIZE, 1, 10);
  const limit = integerOption("limit", Number.MAX_SAFE_INTEGER, 1, 10_000);
  const auditPath = resolve(ROOT, option("audit") ?? DEFAULT_AUDIT);
  const auditReference = relative(ROOT, auditPath);
  if (!auditReference || auditReference.startsWith("..")) throw new Error("--audit must resolve inside the repository");
  const stem = option("stem") ?? DEFAULT_STEM;
  const statePath = resolve(ROOT, `${stem}.state.json`);
  const reportPath = resolve(ROOT, `${stem}.json`);
  const auditBytes = readFileSync(auditPath);
  const auditSha256 = sha256(auditBytes);
  const audit = readAudit(auditPath);
  const prior = readState(statePath);
  const state = prior ?? {
    contract: "served-zonage-immo-proof-url-substitution/v1" as const,
    audit_path: auditReference,
    audit_sha256: auditSha256,
    mode,
    batch_size: batchSize,
    selected: selectedRows(audit, limit),
    next_batch: 0,
    results: {},
  };
  if (state.audit_path !== auditReference || state.audit_sha256 !== auditSha256 || state.mode !== mode || state.batch_size !== batchSize) {
    throw new Error("state does not match this audit, mode, or batch size; use a new --stem");
  }
  if (!prior) writeAtomic(statePath, state);

  const batches = Math.ceil(state.selected.length / state.batch_size);
  while (state.next_batch < batches) {
    const batch = state.next_batch;
    const pending = state.selected
      .slice(batch * state.batch_size, (batch + 1) * state.batch_size)
      .filter((row) => !state.results[row.key]);
    const outcomes = await mapConcurrent(pending, (row) => processRow(row, mode));
    for (let index = 0; index < outcomes.length; index++) {
      const outcome = outcomes[index]!;
      if (outcome.status === "fulfilled") state.results[pending[index]!.key] = outcome.value;
    }
    writeAtomic(statePath, state);
    if (outcomes.some((outcome) => outcome.status === "rejected")) {
      throw new Error(`S3 read/write failure in batch ${batch + 1}; completed rows saved, rerun the same command`);
    }
    state.next_batch++;
    writeAtomic(statePath, state);
    console.log(`[immo-proof-url-substitution] ${mode} batch ${batch + 1}/${batches}: ${pending.length} processed, state saved`);
  }
  const result = report(state);
  writeAtomic(reportPath, result);
  console.log(JSON.stringify({ output: reportPath, complete: result.complete, collections: result.collections }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
