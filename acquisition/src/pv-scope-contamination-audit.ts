/**
 * Read-only audit of PV capture-scope contamination.
 *
 * This runner never captures, graphifies, indexes, or writes S3.  It reads the
 * completed PV capture manifests, reads only PDF CAS objects at or below 5 MB,
 * and accepts an owner only when a municipality name is printed after an
 * explicit municipal-owner phrase in the document text.  Ambiguous homonyms,
 * unavailable objects, and unsupported document wording stay `unknown`.
 *
 * Usage:
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *     npx tsx acquisition/src/pv-scope-contamination-audit.ts \
 *       --phase=barkmere \
 *       --out=work/coverage/pv-scope-contamination-audit-YYYYMMDDTHHMMSSZ.json
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { CaptureRunHeaderSchema, parseManifestJsonl } from "../../packages/qc-sources/src/capture/index.js";
import { BUCKET, getBytes, getJson, listObjectEntries, objectHead, s3Client } from "./lib/s3.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const MAX_READ_BYTES = 5_000_000;
const PV_RUNS_PREFIX = "capture/_runs/pv-";
const PV_INDEX_PREFIX = "registry/qc-pv/";
const PV_CAS_PREFIX = "raw/pv-index/cas/";
const PV_CAS_KEY = /^raw\/pv-index\/cas\/[a-f0-9]{64}\.pdf$/u;
const SAMPLE_SEED = "pv-scope-contamination-audit/v1";
const SAMPLE_SCOPES = 20;
const SAMPLE_DOCUMENTS_PER_SCOPE = 5;

type AuditPhase = "barkmere" | "sample";

interface Args {
  readonly phase: AuditPhase;
  readonly output: string;
  readonly markdown: string;
}

interface Municipality {
  readonly slug: string;
  readonly name: string;
  readonly mrc: string | null;
  readonly population: number | null;
}

interface RegistryManifest {
  readonly count?: unknown;
  readonly pvIndexUrl?: unknown;
  readonly entries?: unknown;
}

interface ScopeObservation {
  readonly storage_key: string;
  readonly slug: string;
  readonly url: string;
  readonly manifest_key: string;
  readonly line_index: number;
}

interface OwnerEvidence {
  readonly status: "resolved" | "unknown";
  readonly reason: string | null;
  readonly owner_slug: string | null;
  readonly owner_name: string | null;
  readonly phrase: string | null;
  /** Normalized text excerpt around the accepted printed-owner phrase. */
  readonly evidence_context?: string | null;
}

interface CasOwner extends OwnerEvidence {
  readonly storage_key: string;
  readonly bytes: number | null;
}

interface ScopeDocumentEvidence {
  readonly storage_key: string;
  readonly scope_slug: string;
  readonly source_urls: readonly string[];
  readonly source_hosts: readonly string[];
  readonly manifest_evidence: readonly { readonly key: string; readonly line: number }[];
}

interface ScopeDocument extends ScopeDocumentEvidence, CasOwner {
  readonly mismatch: boolean | null;
}

function assertS3Environment(): void {
  if (!process.env.NODE_OPTIONS?.split(/\s+/u).includes("--dns-result-order=ipv4first")) {
    throw new Error("run S3 refusé: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  }
  if (process.env.AWS_MAX_ATTEMPTS !== "10") {
    throw new Error("run S3 refusé: préfixer AWS_MAX_ATTEMPTS=10");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, where: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${where} doit être une chaîne non vide`);
  return value.trim();
}

function readSmallJson<T>(path: string): T {
  if (statSync(path).size > MAX_READ_BYTES) throw new Error(`${relative(ROOT, path)} dépasse ${MAX_READ_BYTES} octets`);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function option(name: string): string | null {
  const values = process.argv.slice(2)
    .filter((value) => value.startsWith(`--${name}=`))
    .map((value) => value.slice(name.length + 3));
  if (values.length > 1) throw new Error(`--${name} ne peut apparaître qu'une fois`);
  return values[0] ?? null;
}

function parseArgs(): Args {
  const phase = option("phase");
  if (phase !== "barkmere" && phase !== "sample") {
    throw new Error("--phase=barkmere ou --phase=sample est requis");
  }
  const requested = option("out");
  if (!requested) throw new Error("--out=work/coverage/pv-scope-contamination-audit-<UTC>.json est requis");
  const output = resolve(ROOT, requested);
  if (!output.startsWith(`${ROOT}/work/coverage/pv-scope-contamination-audit-`) || !output.endsWith(".json")) {
    throw new Error("--out doit être un rapport work/coverage/pv-scope-contamination-audit-<UTC>.json");
  }
  if (existsSync(output)) throw new Error(`refus d'écraser l'artefact: ${relative(ROOT, output)}`);
  return { phase, output, markdown: output.replace(/\.json$/u, ".md") };
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("fr-CA")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function stableRank(key: string): string {
  return createHash("sha256").update(`${SAMPLE_SEED}\u0000${key}`).digest("hex");
}

function host(url: string): string | null {
  try {
    return new URL(url).hostname.toLocaleLowerCase("en-CA");
  } catch {
    return null;
  }
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function writeImmutable(path: string, body: string): void {
  if (existsSync(path)) throw new Error(`refus d'écraser l'artefact: ${relative(ROOT, path)}`);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, body, "utf8");
  renameSync(temporary, path);
}

function municipalities(): Map<string, Municipality> {
  const path = resolve(ROOT, "packages", "geo-sources-americas", "src", "ca-qc", "municipalities", "municipalities.qc.json");
  const rows = readSmallJson<unknown>(path);
  if (!Array.isArray(rows)) throw new Error("gazetteer municipal invalide");
  const result = new Map<string, Municipality>();
  for (const [index, row] of rows.entries()) {
    if (!isRecord(row)) throw new Error(`gazetteer municipal[${index}] invalide`);
    const slug = requiredString(row.slug, `gazetteer municipal[${index}].slug`);
    const name = requiredString(row.name, `gazetteer municipal[${index}].name`);
    const mrc = row.mrc === null ? null : requiredString(row.mrc, `gazetteer municipal[${index}].mrc`);
    const population = row.population === null
      ? null
      : typeof row.population === "number" && Number.isInteger(row.population) && row.population > 0
        ? row.population
        : (() => { throw new Error(`gazetteer municipal[${index}].population invalide`); })();
    if (result.has(slug)) throw new Error(`gazetteer municipal: slug dupliqué ${slug}`);
    result.set(slug, { slug, name, mrc, population });
  }
  return result;
}

function ownerNameIndex(rows: ReadonlyMap<string, Municipality>): Map<string, readonly Municipality[]> {
  const result = new Map<string, Municipality[]>();
  for (const row of rows.values()) {
    const name = normalize(row.name);
    if (!name) throw new Error(`nom municipal vide après normalisation: ${row.slug}`);
    const entries = result.get(name) ?? [];
    entries.push(row);
    result.set(name, entries);
  }
  return new Map([...result.entries()].map(([name, entries]) => [name, entries.sort((a, b) => a.slug.localeCompare(b.slug))]));
}

async function readSmallS3Text(s3: ReturnType<typeof s3Client>, key: string): Promise<string> {
  const head = await objectHead(s3, key);
  if (!head.exists || head.contentLength === undefined) throw new Error(`${key}: objet absent ou taille inconnue`);
  if (head.contentLength > MAX_READ_BYTES) throw new Error(`${key}: ${head.contentLength} octets > plafond de lecture`);
  const bytes = await getBytes(s3, key);
  if (bytes.length > MAX_READ_BYTES) throw new Error(`${key}: corps ${bytes.length} octets > plafond de lecture`);
  return bytes.toString("utf8");
}

async function mapConcurrent<T, R>(items: readonly T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      output[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return output;
}

async function completedPvObservations(onlySlugs?: ReadonlySet<string>): Promise<{
  readonly observations: readonly ScopeObservation[];
  readonly terminal_manifests: number;
  readonly non_terminal_manifests: number;
  readonly skipped_oversize_manifests: readonly string[];
  readonly read_errors: readonly { readonly key: string; readonly reason: string }[];
}> {
  const s3 = s3Client();
  const manifestKeys = (await listObjectEntries(s3, PV_RUNS_PREFIX))
    .map((entry) => entry.key)
    .filter((key) => key.endsWith("/manifest.jsonl"))
    .sort((left, right) => left.localeCompare(right));
  const scanned = await mapConcurrent(manifestKeys, 8, async (manifestKey) => {
    const headerKey = `${manifestKey.slice(0, -"manifest.jsonl".length)}run.json`;
    try {
      const header = CaptureRunHeaderSchema.parse(JSON.parse(await readSmallS3Text(s3, headerKey)));
      if (header.lane !== "pv" || header.finished_at === null || header.exit_code !== 0) {
        return { terminal: false, observations: [] as ScopeObservation[], oversize: null as string | null, error: null as string | null };
      }
      const manifestHead = await objectHead(s3, manifestKey);
      if (!manifestHead.exists || manifestHead.contentLength === undefined) {
        return { terminal: true, observations: [] as ScopeObservation[], oversize: null as string | null, error: `${manifestKey}: objet absent ou taille inconnue` };
      }
      if (manifestHead.contentLength > MAX_READ_BYTES) {
        return { terminal: true, observations: [] as ScopeObservation[], oversize: manifestKey, error: null as string | null };
      }
      const lines = parseManifestJsonl(await readSmallS3Text(s3, manifestKey));
      const observations: ScopeObservation[] = [];
      for (const [lineIndex, line] of lines.entries()) {
        if (line.source !== "pv-index" || line.storage_key === null || !PV_CAS_KEY.test(line.storage_key)) continue;
        if (line.slugs.length !== 1) continue;
        if (onlySlugs !== undefined && !onlySlugs.has(line.slugs[0]!)) continue;
        observations.push({
          storage_key: line.storage_key,
          slug: line.slugs[0]!,
          url: line.url,
          manifest_key: manifestKey,
          line_index: lineIndex + 1,
        });
      }
      return { terminal: true, observations, oversize: null as string | null, error: null as string | null };
    } catch (error) {
      return {
        terminal: false,
        observations: [] as ScopeObservation[],
        oversize: null as string | null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  return {
    observations: scanned.flatMap((item) => item.observations),
    terminal_manifests: scanned.filter((item) => item.terminal).length,
    non_terminal_manifests: scanned.filter((item) => !item.terminal).length,
    skipped_oversize_manifests: scanned.flatMap((item) => item.oversize === null ? [] : [item.oversize]),
    read_errors: scanned.flatMap((item, index) => item.error === null ? [] : [{ key: manifestKeys[index]!, reason: item.error }]),
  };
}

/** A municipality named as the object of a resolution is not the document owner. */
function isThirdPartyMunicipalityMention(context: string): boolean {
  return /\b(?:appui|support|entente|agreement|contribution|resolution|service)\b[^.]{0,220}\b(?:a|au|aux|avec|to|for|with)\s+(?:la\s+|le\s+|les\s+)?(?:municipalite|municipality|ville|town|cite|city|village|canton|parish)\b/u.test(context) ||
    /\bsigned\s+with\s+(?:the\s+)?(?:municipality|ville|town|city|village)\b/u.test(context);
}

function findPrintedOwner(text: string, names: ReadonlyMap<string, readonly Municipality[]>): OwnerEvidence {
  const normalizedText = normalize(text);
  if (!normalizedText) return { status: "unknown", reason: "document_text_empty", owner_slug: null, owner_name: null, phrase: null };
  const found: Array<{ readonly normalized_name: string; readonly phrase: string; readonly index: number }> = [];
  let rejectedThirdPartyMention = false;
  for (const normalizedName of names.keys()) {
    const escapedName = normalizedName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const expression = new RegExp(
      `\\b(?:municipalite|municipality|ville|town|cite|city|village|canton|parish|conseil municipal|municipal council)\\s+(?:de|du|des|d|of)?\\s*${escapedName}\\b`,
      "u",
    );
    const match = expression.exec(normalizedText);
    if (match) {
      const context = normalizedText.slice(Math.max(0, match.index - 220), match.index + match[0]!.length + 220);
      if (isThirdPartyMunicipalityMention(context)) {
        rejectedThirdPartyMention = true;
      } else {
        found.push({ normalized_name: normalizedName, phrase: match[0]!, index: match.index });
      }
    }
  }
  const distinctNames = [...new Map(found.map((item) => [item.normalized_name, item])).values()];
  if (distinctNames.length === 0) {
    return {
      status: "unknown",
      reason: rejectedThirdPartyMention ? "municipal_name_mentioned_as_third_party" : "no_explicit_municipal_owner_phrase",
      owner_slug: null,
      owner_name: null,
      phrase: null,
    };
  }
  if (distinctNames.length > 1) {
    return { status: "unknown", reason: "multiple_explicit_municipal_owner_phrases", owner_slug: null, owner_name: null, phrase: null };
  }
  const match = distinctNames[0]!;
  const candidates = names.get(match.normalized_name)!;
  if (candidates.length !== 1) {
    return { status: "unknown", reason: "owner_name_homonym", owner_slug: null, owner_name: null, phrase: match.phrase };
  }
  const owner = candidates[0]!;
  return {
    status: "resolved",
    reason: null,
    owner_slug: owner.slug,
    owner_name: owner.name,
    phrase: match.phrase,
    evidence_context: normalizedText.slice(Math.max(0, match.index - 120), match.index + match.phrase.length + 180),
  };
}

async function readCasOwner(
  s3: ReturnType<typeof s3Client>,
  storageKey: string,
  names: ReadonlyMap<string, readonly Municipality[]>,
): Promise<CasOwner> {
  try {
    const head = await objectHead(s3, storageKey);
    if (!head.exists || head.contentLength === undefined) {
      return { storage_key: storageKey, bytes: null, status: "unknown", reason: "cas_absent_or_size_unknown", owner_slug: null, owner_name: null, phrase: null };
    }
    if (head.contentLength > MAX_READ_BYTES) {
      return { storage_key: storageKey, bytes: head.contentLength, status: "unknown", reason: "cas_exceeds_read_limit", owner_slug: null, owner_name: null, phrase: null };
    }
    const bytes = await getBytes(s3, storageKey);
    if (bytes.length > MAX_READ_BYTES) {
      return { storage_key: storageKey, bytes: bytes.length, status: "unknown", reason: "cas_body_exceeds_read_limit", owner_slug: null, owner_name: null, phrase: null };
    }
    const text = await extractPdfText(bytes);
    if (text.status !== "ok") {
      return { storage_key: storageKey, bytes: bytes.length, status: "unknown", reason: text.reason, owner_slug: null, owner_name: null, phrase: null };
    }
    return { storage_key: storageKey, bytes: bytes.length, ...findPrintedOwner(text.text, names) };
  } catch (error) {
    return {
      storage_key: storageKey,
      bytes: null,
      status: "unknown",
      reason: `s3_read_error:${error instanceof Error ? error.message : String(error)}`,
      owner_slug: null,
      owner_name: null,
      phrase: null,
    };
  }
}

async function extractPdfText(bytes: Buffer): Promise<
  | { readonly status: "ok"; readonly text: string }
  | { readonly status: "unknown"; readonly reason: string }
> {
  return new Promise((resolve) => {
    const process = spawn("pdftotext", ["-", "-"], { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let stdoutBytes = 0;
    let overflow = false;
    let settled = false;
    const finish = (value: { readonly status: "ok"; readonly text: string } | { readonly status: "unknown"; readonly reason: string }): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    process.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_READ_BYTES) {
        overflow = true;
        process.kill();
        return;
      }
      chunks.push(chunk);
    });
    process.on("error", (error) => finish({ status: "unknown", reason: `pdftotext_error:${error.message}` }));
    process.on("close", (code, signal) => {
      if (overflow) {
        finish({ status: "unknown", reason: "extracted_text_exceeds_read_limit" });
      } else if (code !== 0) {
        finish({ status: "unknown", reason: `pdftotext_exit:${code ?? signal ?? "unknown"}` });
      } else {
        finish({ status: "ok", text: Buffer.concat(chunks).toString("utf8") });
      }
    });
    process.stdin.on("error", (error) => finish({ status: "unknown", reason: `pdftotext_stdin_error:${error.message}` }));
    process.stdin.end(bytes);
  });
}

async function barkmereRegistry(s3: ReturnType<typeof s3Client>): Promise<{
  readonly key: string;
  readonly bytes: number | null;
  readonly entries: number | null;
  readonly declared_count: number | null;
  readonly index_url: string | null;
  readonly index_host: string | null;
}> {
  const key = "registry/qc-pv/barkmere/index.json";
  const head = await objectHead(s3, key);
  if (!head.exists || head.contentLength === undefined) return { key, bytes: null, entries: null, declared_count: null, index_url: null, index_host: null };
  if (head.contentLength > MAX_READ_BYTES) throw new Error(`${key} dépasse le plafond de lecture`);
  const manifest = await getJson<RegistryManifest>(s3, key);
  const entries = Array.isArray(manifest.entries) ? manifest.entries.length : null;
  const declaredCount = typeof manifest.count === "number" && Number.isInteger(manifest.count) ? manifest.count : null;
  const indexUrl = typeof manifest.pvIndexUrl === "string" ? manifest.pvIndexUrl : null;
  return { key, bytes: head.contentLength, entries, declared_count: declaredCount, index_url: indexUrl, index_host: indexUrl === null ? null : host(indexUrl) };
}

function scopeEvidence(
  observations: readonly ScopeObservation[],
  municipalitiesBySlug: ReadonlyMap<string, Municipality>,
): Map<string, ScopeDocumentEvidence[]> {
  const byScope = new Map<string, Map<string, ScopeObservation[]>>();
  for (const observation of observations) {
    if (!municipalitiesBySlug.has(observation.slug)) continue;
    const byKey = byScope.get(observation.slug) ?? new Map<string, ScopeObservation[]>();
    const rows = byKey.get(observation.storage_key) ?? [];
    rows.push(observation);
    byKey.set(observation.storage_key, rows);
    byScope.set(observation.slug, byKey);
  }
  const result = new Map<string, ScopeDocumentEvidence[]>();
  for (const [slug, byKey] of byScope) {
    const documents = [...byKey.entries()].map(([storageKey, evidence]) => {
      const sourceUrls = [...new Set(evidence.map((item) => item.url))].sort((left, right) => left.localeCompare(right));
      const sourceHosts = [...new Set(sourceUrls.map(host).filter((value): value is string => value !== null))].sort((left, right) => left.localeCompare(right));
      return {
        scope_slug: slug,
        storage_key: storageKey,
        source_urls: sourceUrls,
        source_hosts: sourceHosts,
        manifest_evidence: evidence
          .map((item) => ({ key: item.manifest_key, line: item.line_index }))
          .sort((left, right) => left.key.localeCompare(right.key) || left.line - right.line),
      };
    }).sort((left, right) => left.storage_key.localeCompare(right.storage_key));
    result.set(slug, documents);
  }
  return result;
}

function attachOwners(
  documents: readonly ScopeDocumentEvidence[],
  owners: ReadonlyMap<string, CasOwner>,
): ScopeDocument[] {
  return documents.map((document) => {
    const owner = owners.get(document.storage_key);
    if (!owner) throw new Error(`propriétaire CAS absent: ${document.storage_key}`);
    return {
      ...document,
      ...owner,
      mismatch: owner.status === "resolved" ? owner.owner_slug !== document.scope_slug : null,
    };
  });
}

function rate(rows: readonly { readonly contaminated: boolean }[]): { readonly numerator: number; readonly denominator: number; readonly percent: number | null } {
  const numerator = rows.filter((row) => row.contaminated).length;
  return { numerator, denominator: rows.length, percent: rows.length === 0 ? null : Number((100 * numerator / rows.length).toFixed(2)) };
}

function commonReportFields(phase: AuditPhase, completed: Awaited<ReturnType<typeof completedPvObservations>>): Record<string, unknown> {
  return {
    contract: "pv-scope-contamination-audit/v2",
    generated_at: new Date().toISOString(),
    phase,
    mode: "read-only-s3-pdf-owner-audit",
    rules: {
      owner: "Resolved only from an explicit municipal-owner phrase printed by pdftotext in the CAS PDF; a municipality named as a resolution beneficiary or counterparty is unknown, never owner evidence. Filenames, scope slugs, URLs, and fuzzy matches are never used.",
      homonyms: "An owner name matching more than one municipality is unknown.",
      maximum_read_bytes: MAX_READ_BYTES,
      s3_environment: { NODE_OPTIONS: "--dns-result-order=ipv4first", AWS_MAX_ATTEMPTS: "10" },
    },
    inputs: {
      bucket: BUCKET,
      registry_prefix: PV_INDEX_PREFIX,
      capture_runs_prefix: PV_RUNS_PREFIX,
      cas_prefix: PV_CAS_PREFIX,
      capture_manifests: {
        terminal: completed.terminal_manifests,
        non_terminal_or_unreadable: completed.non_terminal_manifests,
        skipped_oversize: completed.skipped_oversize_manifests,
        read_errors: completed.read_errors,
      },
    },
  };
}

function barkmereMarkdown(report: Record<string, unknown>): string {
  const barkmere = report.barkmere as Record<string, unknown>;
  const registry = barkmere.registry as Record<string, unknown>;
  const cas = barkmere.cas as Record<string, unknown>;
  return `# Audit contamination des scopes PV — Barkmere\n\n` +
    `Généré le ${report.generated_at as string}; lecture S3 seulement, aucune capture, indexation ou écriture S3.\n\n` +
    `- Registre : ${registry.entries as string} entrées (${registry.declared_count as string} déclarées), index ${registry.index_url as string} (${registry.index_host as string}).\n` +
    `- CAS rattachées : ${cas.attached_unique_cas as string}; propriétaire imprimé Barkmere : ${cas.owned_by_barkmere as string}; hors scope confirmé : ${cas.confirmed_outside_scope as string}; inconnues : ${cas.unknown_owner as string}.\n` +
    `- Sources CAS : ${(cas.source_hosts as string[]).join(", ") || "aucune"}.\n`;
}

function sampleMarkdown(report: Record<string, unknown>): string {
  const sample = report.sample as Record<string, unknown>;
  const rate = sample.scope_contamination_rate as Record<string, unknown>;
  const hypothesis = report.hypothesis as Record<string, unknown>;
  const crosscheck = hypothesis.population_crosscheck as Record<string, unknown>;
  const lower = crosscheck.lower_population_half as Record<string, unknown>;
  const upper = crosscheck.upper_population_half as Record<string, unknown>;
  const impact = report.impact as Record<string, unknown>;
  return `# Audit contamination des scopes PV — échantillon\n\n` +
    `Généré le ${report.generated_at as string}; lecture S3 seulement, aucune capture, indexation ou écriture S3.\n\n` +
    `- ${rate.numerator as string}/${rate.denominator as string} scopes contaminés confirmés (${rate.percent as string} %), ${sample.documents_examined as string} CAS lues (${sample.documents_per_scope as string}/scope).\n` +
    `- Population : moitié basse ${lower.contaminated_scopes as string}/${lower.scopes as string}; moitié haute ${upper.contaminated_scopes as string}/${upper.scopes as string}. ${hypothesis.conclusion as string}\n` +
    `- ${impact.confirmed_mismatched_documents as string} documents confirmés hors scope dans l’échantillon, ${impact.affected_municipalities_union as string} municipalités dans l’union scope/propriétaire; ${impact.unknown_documents as string} inconnus.\n`;
}

function persist(args: Args, report: Record<string, unknown>, markdown: string): void {
  writeImmutable(args.output, `${JSON.stringify(report, null, 2)}\n`);
  writeImmutable(args.markdown, markdown);
}

async function barkmereAudit(
  args: Args,
  s3: ReturnType<typeof s3Client>,
  municipalitiesBySlug: ReadonlyMap<string, Municipality>,
  names: ReadonlyMap<string, readonly Municipality[]>,
): Promise<void> {
  const [registry, completed] = await Promise.all([
    barkmereRegistry(s3),
    completedPvObservations(new Set(["barkmere"])),
  ]);
  const evidence = scopeEvidence(completed.observations, municipalitiesBySlug).get("barkmere") ?? [];
  const keys = evidence.map((document) => document.storage_key);
  const owners = new Map(await mapConcurrent(keys, 4, async (key) => [key, await readCasOwner(s3, key, names)] as const));
  const documents = attachOwners(evidence, owners);
  const sourceUrls = [...new Set(documents.flatMap((document) => document.source_urls))].sort((left, right) => left.localeCompare(right));
  const sourceHosts = [...new Set(sourceUrls.map(host).filter((value): value is string => value !== null))].sort((left, right) => left.localeCompare(right));
  const report: Record<string, unknown> = {
    ...commonReportFields("barkmere", completed),
    barkmere: {
      registry,
      cas: {
        attached_unique_cas: documents.length,
        owned_by_barkmere: documents.filter((document) => document.owner_slug === "barkmere").length,
        confirmed_outside_scope: documents.filter((document) => document.mismatch === true).length,
        unknown_owner: documents.filter((document) => document.mismatch === null).length,
        source_hosts: sourceHosts,
        source_urls: sourceUrls,
        documents: documents.map((document) => ({
          storage_key: document.storage_key,
          printed_owner: document.owner_name,
          printed_owner_slug: document.owner_slug,
          owner_status: document.status,
          owner_reason: document.reason,
          printed_phrase: document.phrase,
          printed_owner_context: document.evidence_context ?? null,
          mismatch: document.mismatch,
          source_urls: document.source_urls,
          manifest_evidence: document.manifest_evidence,
        })),
      },
    },
  };
  persist(args, report, barkmereMarkdown(report));
  process.stdout.write(`${JSON.stringify({
    json: relative(ROOT, args.output),
    markdown: relative(ROOT, args.markdown),
    barkmere_attached_cas: documents.length,
    barkmere_owned: documents.filter((document) => document.owner_slug === "barkmere").length,
    barkmere_confirmed_outside_scope: documents.filter((document) => document.mismatch === true).length,
  })}\n`);
}

async function sampleAudit(
  args: Args,
  s3: ReturnType<typeof s3Client>,
  municipalitiesBySlug: ReadonlyMap<string, Municipality>,
  names: ReadonlyMap<string, readonly Municipality[]>,
): Promise<void> {
  const completed = await completedPvObservations();
  const scopes = scopeEvidence(completed.observations, municipalitiesBySlug);
  const population = [...scopes.entries()]
    .filter(([, documents]) => documents.length >= SAMPLE_DOCUMENTS_PER_SCOPE)
    .map(([slug, documents]) => ({ slug, documents, municipality: municipalitiesBySlug.get(slug)! }))
    .sort((left, right) => stableRank(left.slug).localeCompare(stableRank(right.slug)) || left.slug.localeCompare(right.slug));
  const sampledScopes = population.slice(0, SAMPLE_SCOPES);
  if (sampledScopes.length !== SAMPLE_SCOPES) throw new Error(`population de scopes avec ${SAMPLE_DOCUMENTS_PER_SCOPE} CAS insuffisante: ${sampledScopes.length}`);
  const selected = sampledScopes.map(({ slug, documents, municipality }) => ({
    slug,
    municipality,
    attached_cas: documents.length,
    documents: [...documents]
      .sort((left, right) => stableRank(`${slug}\u0000${left.storage_key}`).localeCompare(stableRank(`${slug}\u0000${right.storage_key}`)) || left.storage_key.localeCompare(right.storage_key))
      .slice(0, SAMPLE_DOCUMENTS_PER_SCOPE),
  }));
  const keys = [...new Set(selected.flatMap((scope) => scope.documents.map((document) => document.storage_key)))].sort((left, right) => left.localeCompare(right));
  const owners = new Map(await mapConcurrent(keys, 4, async (key) => [key, await readCasOwner(s3, key, names)] as const));
  const sample = selected.map((scope) => {
    const documents = attachOwners(scope.documents, owners);
    const mismatches = documents.filter((document) => document.mismatch === true);
    return {
      slug: scope.slug,
      municipality: scope.municipality.name,
      population: scope.municipality.population,
      mrc: scope.municipality.mrc,
      attached_cas: scope.attached_cas,
      contaminated: mismatches.length > 0,
      confirmed_mismatched_documents: mismatches.length,
      unknown_documents: documents.filter((document) => document.mismatch === null).length,
      documents: documents.map((document) => ({
        storage_key: document.storage_key,
        printed_owner: document.owner_name,
        printed_owner_slug: document.owner_slug,
        owner_status: document.status,
        owner_reason: document.reason,
        printed_phrase: document.phrase,
        printed_owner_context: document.evidence_context ?? null,
        mismatch: document.mismatch,
        source_hosts: document.source_hosts,
      })),
    };
  });
  const scopeRate = rate(sample);
  const knownPopulation = sample.filter((row) => row.population !== null).map((row) => row.population!);
  const populationMedian = median(knownPopulation);
  const lower = populationMedian === null ? [] : sample.filter((row) => row.population !== null && row.population <= populationMedian);
  const upper = populationMedian === null ? [] : sample.filter((row) => row.population !== null && row.population > populationMedian);
  const lowerRate = rate(lower);
  const upperRate = rate(upper);
  const missingPopulation = sample.filter((row) => row.population === null);
  const contaminatedMissingPopulation = missingPopulation.filter((row) => row.contaminated);
  const selectedDocuments = sample.flatMap((row) => row.documents.map((document) => ({ ...document, scope_slug: row.slug })));
  const mismatched = selectedDocuments.filter((document) => document.mismatch === true);
  const affectedScopes = new Set(mismatched.map((document) => document.scope_slug));
  const affectedOwners = new Set(mismatched.map((document) => document.printed_owner_slug!).filter(Boolean));
  const mrcPairs = mismatched.map((document) => ({
    scope_mrc: municipalitiesBySlug.get(document.scope_slug)!.mrc,
    owner_mrc: municipalitiesBySlug.get(document.printed_owner_slug!)?.mrc ?? null,
  }));
  const mrcKnownPairs = mrcPairs.filter((pair) => pair.scope_mrc !== null && pair.owner_mrc !== null);
  const sameMrcPairs = mrcKnownPairs.filter((pair) => pair.scope_mrc === pair.owner_mrc).length;
  const smallMunicipalityEvidence = contaminatedMissingPopulation.length === 0 && populationMedian !== null && lowerRate.percent !== null && upperRate.percent !== null && lowerRate.percent > upperRate.percent;
  const hypothesisConclusion = populationMedian === null
    ? "Hypothèse non testable: population absente dans l’échantillon."
    : contaminatedMissingPopulation.length > 0
      ? "Hypothèse non tranchable: un scope contaminé confirmé n’a pas de population; les deux moitiés mesurables n’ont aucune contamination confirmée, et un hôte ne suffit jamais à attribuer l’opérateur du portail."
    : smallMunicipalityEvidence
      ? "La composante « petites municipalités » est soutenue; le mécanisme « via leur MRC » reste non établi: un hôte ne suffit jamais à attribuer l’opérateur du portail."
      : "L’hypothèse ne tient pas dans l’échantillon: la moitié basse de population n’est pas plus contaminée; un hôte ne suffit jamais à attribuer l’opérateur du portail.";
  const report: Record<string, unknown> = {
    ...commonReportFields("sample", completed),
    sample: {
      selection: {
        seed: SAMPLE_SEED,
        eligible_scopes_with_at_least_five_attached_cas: population.length,
        sampled_scopes: sample.length,
        documents_per_scope: SAMPLE_DOCUMENTS_PER_SCOPE,
        selection: "sha256(seed + NUL + scope slug), then sha256(seed + NUL + scope slug + NUL + CAS key); never alphabetic order",
      },
      documents_examined: selectedDocuments.length,
      documents_per_scope: SAMPLE_DOCUMENTS_PER_SCOPE,
      scope_contamination_rate: scopeRate,
      scopes: sample,
    },
    hypothesis: {
      tested: "Confirmed contamination rate among the lower versus upper half of sampled scopes by gazetteer population. Same-MRC pairs are reported as regional correlation only; portal ownership is never inferred from a hostname.",
      population_crosscheck: {
        sample_population_median: populationMedian,
        missing_population_scopes: missingPopulation.length,
        contaminated_scopes_with_missing_population: contaminatedMissingPopulation.length,
        lower_population_half: { scopes: lower.length, contaminated_scopes: lowerRate.numerator, rate_percent: lowerRate.percent },
        upper_population_half: { scopes: upper.length, contaminated_scopes: upperRate.numerator, rate_percent: upperRate.percent },
      },
      regional_crosscheck: {
        confirmed_mismatched_documents_with_known_scope_and_owner_mrc: mrcKnownPairs.length,
        same_mrc_pairs: sameMrcPairs,
      },
      conclusion: hypothesisConclusion,
    },
    impact: {
      scope: "confirmed matches in this 20-scope / 100-document sample only; no extrapolation",
      confirmed_mismatched_documents: mismatched.length,
      affected_scope_municipalities: [...affectedScopes].sort((left, right) => left.localeCompare(right)),
      printed_owner_municipalities: [...affectedOwners].sort((left, right) => left.localeCompare(right)),
      affected_municipalities_union: new Set([...affectedScopes, ...affectedOwners]).size,
      unknown_documents: selectedDocuments.filter((document) => document.mismatch === null).length,
      confirmed_misattachments: mismatched.map((document) => ({
        storage_key: document.storage_key,
        scope_slug: document.scope_slug,
        printed_owner_slug: document.printed_owner_slug,
        printed_owner: document.printed_owner,
        printed_phrase: document.printed_phrase,
        source_hosts: document.source_hosts,
      })),
    },
  };
  persist(args, report, sampleMarkdown(report));
  process.stdout.write(`${JSON.stringify({
    json: relative(ROOT, args.output),
    markdown: relative(ROOT, args.markdown),
    sampled_contaminated_scopes: scopeRate,
    documents_examined: selectedDocuments.length,
    confirmed_mismatched_documents: mismatched.length,
  })}\n`);
}

async function main(): Promise<void> {
  const args = parseArgs();
  assertS3Environment();
  const municipalityRows = municipalities();
  const nameIndex = ownerNameIndex(municipalityRows);
  const s3 = s3Client();
  if (args.phase === "barkmere") {
    await barkmereAudit(args, s3, municipalityRows, nameIndex);
    return;
  }
  await sampleAudit(args, s3, municipalityRows, nameIndex);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
