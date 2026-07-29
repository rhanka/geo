/**
 * Prepare a bounded visual-reading lot of scan-only PVs.
 *
 * Every selected CAS object is downloaded once, SHA-256 hashed while streaming,
 * and retained locally only when the digest equals its CAS filename.  It does
 * not OCR, interpret, graphify, or write to object storage.
 *
 * Usage:
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/pv-lecture-visuelle-lot.ts \
 *     --out=work/coverage/pv-lecture-visuelle-lot-01-preflight-YYYYMMDDTHHMMSSZ.json \
 *     [--prior-report=work/coverage/pv-lecture-visuelle-lot-01-YYYYMMDDTHHMMSSZ.json ...]
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
const TRIAGE = resolve(COVERAGE, "pv-extraction-failures-triage-20260729T115007Z.json");
const INVENTORY = resolve(COVERAGE, "pv-ocr-inventaire-pages-20260729T122121Z.json");
const MAX_LOCAL_JSON_BYTES = 5 * 1024 * 1024;
const DEFAULT_LOT_SIZE = 20;
const MAX_LOT_SIZE = 186;
const MISMATCH_STOP = 3;

type JsonRecord = Record<string, unknown>;
type IntegrityOutcome = "SHA_PASSED" | "CAS_SHA_MISMATCH" | "GET_FAILED";

interface SelectedDocument {
  readonly storage_key: string;
  readonly slug: string;
  readonly municipality_name: string | null;
}

interface DocumentSelection {
  readonly description: string;
  readonly prior_lot_reports: readonly string[];
  readonly source_inventory: string | null;
  readonly candidate_cas_keys: number;
  readonly prior_lot_collisions_avoided: number;
  readonly remaining_after_dedupe: number;
  readonly documents: SelectedDocument[];
}

interface GuardResult extends SelectedDocument {
  readonly expected_sha256: string;
  readonly calculated_sha256: string | null;
  readonly streamed_bytes: number | null;
  readonly outcome: IntegrityOutcome;
  readonly local_pdf_available: boolean;
  readonly error: string | null;
}

function assertS3RunEnvironment(): void {
  if (!process.env.NODE_OPTIONS?.split(/\s+/u).includes("--dns-result-order=ipv4first")) {
    throw new Error("run S3 refusé: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  }
  if (process.env.AWS_MAX_ATTEMPTS !== "10") throw new Error("run S3 refusé: préfixer AWS_MAX_ATTEMPTS=10");
}

function requiredArg(name: string): string {
  const values = process.argv.slice(2).filter((value) => value.startsWith(`--${name}=`)).map((value) => value.slice(name.length + 3));
  if (values.length !== 1 || !values[0]) throw new Error(`--${name}=... est requis une seule fois`);
  return values[0]!;
}

function repeatedArg(name: string): string[] {
  const values = process.argv.slice(2).filter((value) => value.startsWith(`--${name}=`)).map((value) => value.slice(name.length + 3));
  if (values.some((value) => !value)) throw new Error(`--${name}=... ne peut pas être vide`);
  return values;
}

function optionalPositiveIntegerArg(name: string, fallback: number, maximum: number): number {
  const values = process.argv.slice(2).filter((value) => value.startsWith(`--${name}=`)).map((value) => value.slice(name.length + 3));
  if (values.length === 0) return fallback;
  if (values.length !== 1 || !/^[1-9][0-9]*$/u.test(values[0]!)) throw new Error(`--${name}=entier positif requis une seule fois`);
  const parsed = Number(values[0]);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) throw new Error(`--${name}: entier entre 1 et ${maximum} requis`);
  return parsed;
}

function record(value: unknown, where: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${where}: objet requis`);
  return value as JsonRecord;
}

function string(value: unknown, where: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${where}: chaîne non vide requise`);
  return value;
}

function nullableString(value: unknown, where: string): string | null {
  if (value === null || value === undefined) return null;
  return string(value, where);
}

function expectedSha256(key: string): string {
  const match = /^raw\/pv-index\/cas\/([a-f0-9]{64})\.pdf$/u.exec(key);
  if (!match) throw new Error(`${key}: clé CAS PDF sha256 requise`);
  return match[1]!;
}

function readSmallJson(path: string): JsonRecord {
  if (statSync(path).size > MAX_LOCAL_JSON_BYTES) throw new Error(`${path}: lecture > 5 MiB interdite`);
  return record(JSON.parse(readFileSync(path, "utf8")), path);
}

function priorLotCasKeys(path: string): Set<string> {
  const prior = readSmallJson(path);
  if (!Array.isArray(prior.documents) || prior.documents.length !== DEFAULT_LOT_SIZE) {
    throw new Error(`${path}: documents[20] requis pour la déduplication du lot antérieur`);
  }
  const keys = prior.documents.map((value, index) => {
    const document = record(value, `${path}.documents[${index}]`);
    const key = string(document.storage_key, `${path}.documents[${index}].storage_key`);
    expectedSha256(key);
    return key;
  });
  if (new Set(keys).size !== DEFAULT_LOT_SIZE) throw new Error(`${path}: clés CAS du lot antérieur dupliquées`);
  return new Set(keys);
}

function initialSampleSelection(limit: number): DocumentSelection {
  if (statSync(TRIAGE).size > MAX_LOCAL_JSON_BYTES) throw new Error(`${TRIAGE}: lecture > 5 MiB interdite`);
  const triage = readSmallJson(TRIAGE);
  const sample = record(triage.sample, "triage.sample");
  if (sample.inspected_documents !== 30 || !Array.isArray(sample.documents) || sample.documents.length !== 30) {
    throw new Error("triage: l'échantillon pur-scan attendu de 30 documents est invalide");
  }
  if (limit > sample.documents.length) throw new Error(`triage: --limit ne peut excéder les ${sample.documents.length} documents de l'échantillon initial`);
  const documents = sample.documents.slice(0, limit).map((value, index) => {
    const document = record(value, `triage.sample.documents[${index}]`);
    const key = string(document.storage_key, `triage.sample.documents[${index}].storage_key`);
    expectedSha256(key);
    return {
      storage_key: key,
      slug: string(document.slug, `triage.sample.documents[${index}].slug`),
      municipality_name: null,
    };
  });
  // `documents.length`, pas une constante: le dernier lot des 186 n'en compte que
  // 26, et comparer a une taille figee ferait lever un lot parfaitement valide.
  // Ce que le garde doit dire est « aucune cle en double », rien de plus.
  if (new Set(documents.map((document) => document.storage_key)).size !== documents.length) {
    throw new Error("triage: clés du lot dupliquées");
  }
  return {
    description: "les 20 premières entrées ordonnées de triage.sample.documents",
    prior_lot_reports: [],
    source_inventory: null,
    candidate_cas_keys: documents.length,
    prior_lot_collisions_avoided: 0,
    remaining_after_dedupe: 0,
    documents,
  };
}

function dedupedInventorySelection(priorReports: readonly string[], limit: number): DocumentSelection {
  if (priorReports.length === 0) throw new Error("au moins un --prior-report est requis pour la sélection sur inventaire");
  if (new Set(priorReports).size !== priorReports.length) throw new Error("--prior-report ne peut pas être répété");
  const inventory = readSmallJson(INVENTORY);
  if (inventory.input_commit !== "14c60a04" || inventory.source_triage !== "work/coverage/pv-extraction-failures-triage-20260729T115007Z.json") {
    throw new Error(`${INVENTORY}: ancrage triage inattendu`);
  }
  if (inventory.unique_failed_documents !== 186 || !Array.isArray(inventory.failed_documents) || inventory.failed_documents.length !== 186) {
    throw new Error(`${INVENTORY}: liste fermée de 186 clés CAS requise`);
  }
  const candidates = inventory.failed_documents.map((value, index) => {
    const document = record(value, `${INVENTORY}.failed_documents[${index}]`);
    const key = string(document.storage_key, `${INVENTORY}.failed_documents[${index}].storage_key`);
    expectedSha256(key);
    if (!Array.isArray(document.selection_offsets) || document.selection_offsets.some((offset) => !Number.isSafeInteger(offset) || (offset as number) < 0)) {
      throw new Error(`${INVENTORY}.failed_documents[${index}].selection_offsets: entiers positifs requis`);
    }
    if (document.selection_offsets.length === 0) throw new Error(`${INVENTORY}.failed_documents[${index}].selection_offsets: au moins un offset requis`);
    return {
      storage_key: key,
      slug: string(document.slug, `${INVENTORY}.failed_documents[${index}].slug`),
      municipality_name: nullableString(document.municipality_name, `${INVENTORY}.failed_documents[${index}].municipality_name`),
      first_selection_offset: Math.min(...document.selection_offsets as number[]),
    };
  });
  if (new Set(candidates.map((candidate) => candidate.storage_key)).size !== candidates.length) {
    throw new Error(`${INVENTORY}: clés CAS dupliquées`);
  }
  const priorKeys = new Set<string>();
  for (const report of priorReports) {
    for (const key of priorLotCasKeys(report)) {
      if (priorKeys.has(key)) throw new Error(`${report}: clé CAS déjà présente dans un lot antérieur`);
      priorKeys.add(key);
    }
  }
  const collisions = candidates.filter((candidate) => priorKeys.has(candidate.storage_key));
  if (collisions.length !== priorKeys.size) throw new Error(`${INVENTORY}: au moins une clé d'un lot antérieur manque de la liste des 186`);
  const remaining = candidates
    .filter((candidate) => !priorKeys.has(candidate.storage_key))
    .sort((left, right) => left.first_selection_offset - right.first_selection_offset || left.storage_key.localeCompare(right.storage_key));
  if (remaining.length !== candidates.length - priorKeys.size) throw new Error(`${INVENTORY}: déduplication incohérente, obtenue ${remaining.length}`);
  return {
    description: `les ${Math.min(limit, remaining.length)} clés CAS suivantes parmi les 186 échecs, ordonnées par premier offset de sélection puis clé CAS, après exclusion de tous les lots antérieurs`,
    prior_lot_reports: priorReports.map((report) => report.slice(ROOT.length + 1)),
    source_inventory: "work/coverage/pv-ocr-inventaire-pages-20260729T122121Z.json (clés, slugs et offsets seulement; pages/taille ignorées)",
    candidate_cas_keys: candidates.length,
    prior_lot_collisions_avoided: collisions.length,
    remaining_after_dedupe: remaining.length,
    documents: remaining.slice(0, limit).map(({ first_selection_offset: _offset, ...document }) => document),
  };
}

function selectedDocuments(priorReports: readonly string[], limit: number): DocumentSelection {
  return priorReports.length === 0 ? initialSampleSelection(limit) : dedupedInventorySelection(priorReports, limit);
}

function compactError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/gu, " ").trim().slice(0, 1_000);
}

async function downloadAndHash(document: SelectedDocument, workspace: string): Promise<GuardResult> {
  const expected = expectedSha256(document.storage_key);
  const finalPath = resolve(workspace, `${expected}.pdf`);
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
    if (calculated !== expected) {
      rmSync(partialPath, { force: true });
      return { ...document, expected_sha256: expected, calculated_sha256: calculated, streamed_bytes: streamed, outcome: "CAS_SHA_MISMATCH", local_pdf_available: false, error: null };
    }
    if (existsSync(finalPath)) rmSync(finalPath, { force: true });
    renameSync(partialPath, finalPath);
    return { ...document, expected_sha256: expected, calculated_sha256: calculated, streamed_bytes: streamed, outcome: "SHA_PASSED", local_pdf_available: true, error: null };
  } catch (error) {
    rmSync(partialPath, { force: true });
    return { ...document, expected_sha256: expected, calculated_sha256: null, streamed_bytes: streamed === 0 ? null : streamed, outcome: "GET_FAILED", local_pdf_available: false, error: compactError(error) };
  }
}

function writeAtomic(path: string, value: unknown): void {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

async function main(): Promise<void> {
  const output = resolve(ROOT, requiredArg("out"));
  const priorReportArgs = repeatedArg("prior-report");
  const requested = optionalPositiveIntegerArg("limit", DEFAULT_LOT_SIZE, MAX_LOT_SIZE);
  if (!output.startsWith(`${COVERAGE}/`)) throw new Error("--out doit rester sous work/coverage");
  if (existsSync(output)) throw new Error(`artefact déjà présent: ${output}`);
  const priorReports = priorReportArgs.map((report) => resolve(ROOT, report));
  if (priorReports.some((report) => !report.startsWith(`${COVERAGE}/`))) throw new Error("--prior-report doit rester sous work/coverage");
  assertS3RunEnvironment();
  const workspace = resolve(ROOT, "work", "graphify", basename(output, ".json"));
  mkdirSync(workspace, { recursive: true });
  const results: GuardResult[] = [];
  const selection = selectedDocuments(priorReports, requested);
  for (const document of selection.documents) {
    const result = await downloadAndHash(document, workspace);
    results.push(result);
    const mismatches = results.filter((value) => value.outcome === "CAS_SHA_MISMATCH").length;
    if (mismatches > MISMATCH_STOP) break;
  }
  const passed = results.filter((value) => value.outcome === "SHA_PASSED").length;
  const mismatches = results.filter((value) => value.outcome === "CAS_SHA_MISMATCH").length;
  const getFailed = results.filter((value) => value.outcome === "GET_FAILED").length;
  const stopped = mismatches > MISMATCH_STOP;
  const report = {
    contract: "pv-lecture-visuelle-preflight/v1",
    generated_at: new Date().toISOString(),
    read_only: true,
    source_triage: "work/coverage/pv-extraction-failures-triage-20260729T115007Z.json",
    selection: {
      description: selection.description,
      prior_lot_reports: selection.prior_lot_reports,
      source_inventory: selection.source_inventory,
      candidate_cas_keys: selection.candidate_cas_keys,
      prior_lot_collisions_avoided: selection.prior_lot_collisions_avoided,
      remaining_after_dedupe: selection.remaining_after_dedupe,
    },
    guard: {
      before_visual_reading: true,
      transport: "S3 GetObject",
      hash: "sha256 streamé; aucune mise en mémoire intégrale du PDF",
      mismatch_stop_threshold: MISMATCH_STOP,
      stopped_for_integrity_incident: stopped,
    },
    summary: { requested, attempted: results.length, sha_passed: passed, cas_sha_mismatch: mismatches, get_failed: getFailed },
    local_visual_workspace: workspace,
    documents: results,
  };
  writeAtomic(output, report);
  process.stdout.write(`${JSON.stringify({ output: output.slice(ROOT.length + 1), summary: report.summary, stopped }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
