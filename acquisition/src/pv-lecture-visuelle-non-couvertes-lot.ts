/**
 * Prepare a bounded visual-reading lot from the non-covered municipality
 * cross-reference.  This runner only reads existing CAS objects from S3.
 *
 * It deliberately stops before interpretation: every downloaded object is
 * retained locally only when its streamed SHA-256 equals the CAS basename.
 * The resulting preflight is the hand-off to direct visual reading.
 *
 * Usage:
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/pv-lecture-visuelle-non-couvertes-lot.ts \
 *     --targets-file=work/coverage/pv-non-indexe-sur-non-couvertes-...json \
 *     --out=work/coverage/pv-lecture-visuelle-non-couvertes-lot-01-preflight-...json \
 *     [--outcomes=OWNER_NOT_CONFIRMED,DOCUMENT_READ_OR_TEXT_EXTRACTION_FAILED,NON_INDEXED_OTHER] \
 *     [--limit=20] [--prior-report=work/coverage/pv-lecture-visuelle-non-couvertes-lot-01-...json]
 */
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { finished } from "node:stream/promises";
import { once } from "node:events";
import { basename, resolve } from "node:path";

import { GetObjectCommand } from "@aws-sdk/client-s3";

import { BUCKET, s3Client } from "./lib/s3.js";

const ROOT = resolve(import.meta.dirname, "..", "..");
const COVERAGE = resolve(ROOT, "work", "coverage");
const MAX_LOCAL_JSON_BYTES = 5 * 1024 * 1024;
const DEFAULT_LOT_SIZE = 20;
const MAX_LOT_SIZE = 20;
const MISMATCH_STOP = 3;
const CAS_KEY = /^raw\/pv-index\/cas\/([a-f0-9]{64})\.([a-z0-9]+)$/u;
const DEFAULT_OUTCOMES = [
  "OWNER_NOT_CONFIRMED",
  "DOCUMENT_READ_OR_TEXT_EXTRACTION_FAILED",
  "NON_INDEXED_OTHER",
] as const;
const FINAL_VERDICT_OUTCOMES = [
  "INDEXED",
  "OWNER_NOT_CONFIRMED",
  "CONTAMINATION_OWNER_MISMATCH",
  "DOCUMENT_READ_OR_TEXT_EXTRACTION_FAILED",
  "NON_INDEXED_OTHER",
  "DOCUMENT_LISIBLE_NON_PV",
  "VISUALLY_UNREADABLE",
] as const;

type ConvertibleOutcome = (typeof DEFAULT_OUTCOMES)[number];
type JsonRecord = Record<string, unknown>;

interface SelectedDocument {
  readonly storage_key: string;
  readonly slug: string;
  readonly outcome: ConvertibleOutcome;
  readonly source: string | null;
}

interface GuardResult extends SelectedDocument {
  readonly expected_sha256: string;
  readonly calculated_sha256: string | null;
  readonly streamed_bytes: number | null;
  readonly integrity_outcome: "SHA_PASSED" | "CAS_SHA_MISMATCH" | "GET_FAILED";
  readonly local_path: string | null;
  readonly error: string | null;
}

function assertS3RunEnvironment(): void {
  if (!process.env.NODE_OPTIONS?.split(/\s+/u).includes("--dns-result-order=ipv4first")) {
    throw new Error("run S3 refusé: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  }
  if (process.env.AWS_MAX_ATTEMPTS !== "10") throw new Error("run S3 refusé: préfixer AWS_MAX_ATTEMPTS=10");
}

function record(value: unknown, where: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${where}: objet requis`);
  return value as JsonRecord;
}

function requiredString(value: unknown, where: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${where}: chaîne non vide requise`);
  return value;
}

function requiredArg(name: string): string {
  const values = process.argv.slice(2)
    .filter((value) => value.startsWith(`--${name}=`))
    .map((value) => value.slice(name.length + 3));
  if (values.length !== 1 || !values[0]) throw new Error(`--${name}=... est requis une seule fois`);
  return values[0]!;
}

function optionalArg(name: string): string | null {
  const values = process.argv.slice(2)
    .filter((value) => value.startsWith(`--${name}=`))
    .map((value) => value.slice(name.length + 3));
  if (values.length > 1 || values.some((value) => !value)) throw new Error(`--${name}=... au plus une fois et non vide`);
  return values[0] ?? null;
}

function optionalPositiveIntegerArg(name: string, fallback: number, maximum: number): number {
  const value = optionalArg(name);
  if (value === null) return fallback;
  if (!/^[1-9][0-9]*$/u.test(value)) throw new Error(`--${name}=entier positif requis`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) throw new Error(`--${name}: entier entre 1 et ${maximum} requis`);
  return parsed;
}

function absoluteRepoPath(argument: string, where: string): string {
  const path = resolve(ROOT, argument);
  if (!path.startsWith(`${ROOT}/`)) throw new Error(`${where}: chemin hors dépôt`);
  return path;
}

function readSmallJson(path: string): JsonRecord {
  if (statSync(path).size > MAX_LOCAL_JSON_BYTES) throw new Error(`${path}: lecture > 5 MiB interdite`);
  return record(JSON.parse(readFileSync(path, "utf8")), path);
}

function casParts(key: string, where: string): { readonly sha256: string; readonly extension: string } {
  const match = CAS_KEY.exec(key);
  if (!match) throw new Error(`${where}: clé CAS invalide`);
  return { sha256: match[1]!, extension: match[2]! };
}

function outcome(value: unknown, where: string, allowed: readonly string[]): ConvertibleOutcome {
  const normalized = requiredString(value, where);
  if (!allowed.includes(normalized)) throw new Error(`${where}: outcome non autorisé ${normalized}`);
  return normalized as ConvertibleOutcome;
}

function parseOutcomes(): readonly ConvertibleOutcome[] {
  const raw = optionalArg("outcomes");
  if (raw === null) return DEFAULT_OUTCOMES;
  const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
  if (values.length === 0 || new Set(values).size !== values.length) throw new Error("--outcomes: liste non vide et sans doublon requise");
  for (const value of values) {
    if (!(DEFAULT_OUTCOMES as readonly string[]).includes(value)) throw new Error(`--outcomes: valeur non convertible ${value}`);
  }
  return values as ConvertibleOutcome[];
}

function selectedDocuments(targetsPath: string, allowedOutcomes: readonly ConvertibleOutcome[], priorPath: string | null, limit: number): {
  readonly documents: SelectedDocument[];
  readonly candidate_documents: number;
  readonly prior_documents_skipped: number;
  readonly remaining_documents: number;
  readonly source_targets_file: string;
} {
  const targets = readSmallJson(targetsPath);
  if (targets.contract !== "pv-non-indexe-sur-non-couvertes/v1") throw new Error(`${targetsPath}: contrat de croisement inattendu`);
  const municipalities = targets.municipalities;
  if (!Array.isArray(municipalities)) throw new Error(`${targetsPath}.municipalities: tableau requis`);
  const candidates: SelectedDocument[] = [];
  const byKey = new Map<string, SelectedDocument>();
  for (const [municipalityIndex, municipalityValue] of municipalities.entries()) {
    const municipality = record(municipalityValue, `${targetsPath}.municipalities[${municipalityIndex}]`);
    const slug = requiredString(municipality.slug, `${targetsPath}.municipalities[${municipalityIndex}].slug`);
    if (!/^[a-z0-9][a-z0-9-]*$/u.test(slug)) throw new Error(`${targetsPath}.municipalities[${municipalityIndex}].slug: slug invalide`);
    if (!Array.isArray(municipality.non_indexed_documents)) throw new Error(`${targetsPath}.municipalities[${municipalityIndex}].non_indexed_documents: tableau requis`);
    for (const [documentIndex, documentValue] of municipality.non_indexed_documents.entries()) {
      const document = record(documentValue, `${targetsPath}.municipalities[${municipalityIndex}].non_indexed_documents[${documentIndex}]`);
      const rawOutcome = requiredString(document.outcome, `${targetsPath}.municipalities[${municipalityIndex}].non_indexed_documents[${documentIndex}].outcome`);
      if (!allowedOutcomes.includes(rawOutcome as ConvertibleOutcome)) continue;
      const key = requiredString(document.storage_key, `${targetsPath}.municipalities[${municipalityIndex}].non_indexed_documents[${documentIndex}].storage_key`);
      casParts(key, `${targetsPath}.municipalities[${municipalityIndex}].non_indexed_documents[${documentIndex}].storage_key`);
      const source = document.source === undefined || document.source === null ? null : requiredString(document.source, `${targetsPath}.municipalities[${municipalityIndex}].non_indexed_documents[${documentIndex}].source`);
      const selected: SelectedDocument = { storage_key: key, slug, outcome: rawOutcome as ConvertibleOutcome, source };
      const existing = byKey.get(key);
      if (existing !== undefined) {
        if (existing.slug !== selected.slug) throw new Error(`${targetsPath}: clé CAS portée par plusieurs slugs: ${key}`);
        continue;
      }
      byKey.set(key, selected);
      candidates.push(selected);
    }
  }

  const priorKeys = new Set<string>();
  if (priorPath !== null) {
    const prior = readSmallJson(priorPath);
    if (!Array.isArray(prior.documents)) throw new Error(`${priorPath}.documents: tableau requis`);
    for (const [index, value] of prior.documents.entries()) {
      const document = record(value, `${priorPath}.documents[${index}]`);
      const key = requiredString(document.storage_key, `${priorPath}.documents[${index}].storage_key`);
      casParts(key, `${priorPath}.documents[${index}].storage_key`);
      const verdict = requiredString(document.outcome, `${priorPath}.documents[${index}].outcome`);
      if (!(FINAL_VERDICT_OUTCOMES as readonly string[]).includes(verdict)
        || !Object.prototype.hasOwnProperty.call(document, "owner_status")
        || !Object.prototype.hasOwnProperty.call(document, "printed_owner")) {
        throw new Error(`${priorPath}: verdict final requis; préflight ou outcome non final pour ${key}`);
      }
      priorKeys.add(key);
    }
  }
  const remaining = candidates.filter((document) => !priorKeys.has(document.storage_key));
  return {
    documents: remaining.slice(0, limit),
    candidate_documents: candidates.length,
    prior_documents_skipped: candidates.filter((document) => priorKeys.has(document.storage_key)).length,
    remaining_documents: remaining.length,
    source_targets_file: targetsPath.slice(ROOT.length + 1),
  };
}

function compactError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/gu, " ").trim().slice(0, 1_000);
}

async function downloadAndHash(document: SelectedDocument, workspace: string): Promise<GuardResult> {
  const { sha256, extension } = casParts(document.storage_key, document.storage_key);
  const finalPath = resolve(workspace, `${sha256}.${extension}`);
  const partialPath = `${finalPath}.${process.pid}.partial`;
  let streamed = 0;
  try {
    const response = await s3Client().send(new GetObjectCommand({ Bucket: BUCKET, Key: document.storage_key }));
    const body = response.Body as AsyncIterable<Uint8Array> | undefined;
    if (!body || typeof body[Symbol.asyncIterator] !== "function") throw new Error("GetObject sans flux asynchrone");
    const hash = createHash("sha256");
    const destination = createWriteStream(partialPath, { flags: "wx" });
    try {
      for await (const chunk of body) {
        streamed += chunk.byteLength;
        hash.update(chunk);
        if (!destination.write(chunk)) await once(destination, "drain");
      }
      destination.end();
      await finished(destination);
    } catch (error) {
      destination.destroy();
      throw error;
    }
    const calculated = hash.digest("hex");
    if (calculated !== sha256) {
      rmSync(partialPath, { force: true });
      return { ...document, expected_sha256: sha256, calculated_sha256: calculated, streamed_bytes: streamed, integrity_outcome: "CAS_SHA_MISMATCH", local_path: null, error: null };
    }
    if (existsSync(finalPath)) rmSync(finalPath, { force: true });
    renameSync(partialPath, finalPath);
    return { ...document, expected_sha256: sha256, calculated_sha256: calculated, streamed_bytes: streamed, integrity_outcome: "SHA_PASSED", local_path: finalPath, error: null };
  } catch (error) {
    rmSync(partialPath, { force: true });
    return { ...document, expected_sha256: sha256, calculated_sha256: null, streamed_bytes: streamed === 0 ? null : streamed, integrity_outcome: "GET_FAILED", local_path: null, error: compactError(error) };
  }
}

function writeAtomic(path: string, value: unknown): void {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

async function main(): Promise<void> {
  const targetsPath = absoluteRepoPath(requiredArg("targets-file"), "--targets-file");
  const output = absoluteRepoPath(requiredArg("out"), "--out");
  const priorArgument = optionalArg("prior-report");
  const priorPath = priorArgument === null ? null : absoluteRepoPath(priorArgument, "--prior-report");
  const requested = optionalPositiveIntegerArg("limit", DEFAULT_LOT_SIZE, MAX_LOT_SIZE);
  const allowedOutcomes = parseOutcomes();
  if (!output.startsWith(`${COVERAGE}/`) || !output.endsWith(".json")) throw new Error("--out doit être un JSON sous work/coverage");
  if (existsSync(output)) throw new Error(`artefact déjà présent: ${output}`);
  if (priorPath !== null && !priorPath.startsWith(`${COVERAGE}/`)) throw new Error("--prior-report doit rester sous work/coverage");
  assertS3RunEnvironment();

  const workspace = resolve(ROOT, "work", "graphify", basename(output, ".json"));
  mkdirSync(workspace, { recursive: true });
  const selection = selectedDocuments(targetsPath, allowedOutcomes, priorPath, requested);
  const results: GuardResult[] = [];
  for (const document of selection.documents) {
    const result = await downloadAndHash(document, workspace);
    results.push(result);
    process.stdout.write(`${JSON.stringify({ progress: results.length, requested: selection.documents.length, storage_key: result.storage_key, integrity_outcome: result.integrity_outcome })}\n`);
    if (results.filter((value) => value.integrity_outcome === "CAS_SHA_MISMATCH").length > MISMATCH_STOP) break;
  }

  const report = {
    contract: "pv-lecture-visuelle-non-couvertes-preflight/v1",
    generated_at: new Date().toISOString(),
    read_only: true,
    source_targets_file: selection.source_targets_file,
    outcomes: allowedOutcomes,
    selection: {
      candidate_documents: selection.candidate_documents,
      prior_documents_skipped: selection.prior_documents_skipped,
      remaining_documents: selection.remaining_documents,
      requested: requested,
      selected: selection.documents.length,
    },
    guard: {
      before_visual_reading: true,
      transport: "S3 GetObject",
      hash: "sha256 streamé; aucune mise en mémoire intégrale du document",
      mismatch_stop_threshold: MISMATCH_STOP,
    },
    local_visual_workspace: workspace,
    documents: results,
  };
  writeAtomic(output, report);
  process.stdout.write(`${JSON.stringify({ output: output.slice(ROOT.length + 1), selected: results.length, sha_passed: results.filter((value) => value.integrity_outcome === "SHA_PASSED").length, remaining_convertibles: Math.max(0, selection.remaining_documents - results.length) }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
