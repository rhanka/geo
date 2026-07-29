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
 *     --out=work/coverage/pv-lecture-visuelle-lot-01-preflight-YYYYMMDDTHHMMSSZ.json
 */
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { finished } from "node:stream/promises";
import { once } from "node:events";
import { resolve } from "node:path";

import { GetObjectCommand } from "@aws-sdk/client-s3";

import { BUCKET, s3Client } from "./lib/s3.js";

const ROOT = resolve(import.meta.dirname, "..", "..");
const COVERAGE = resolve(ROOT, "work", "coverage");
const TRIAGE = resolve(COVERAGE, "pv-extraction-failures-triage-20260729T115007Z.json");
const MAX_LOCAL_JSON_BYTES = 5 * 1024 * 1024;
const LOT_SIZE = 20;
const MISMATCH_STOP = 3;
const LOCAL_PDF_DIRECTORY = resolve(ROOT, "work", "graphify", "pv-lecture-visuelle-lot-01");

type JsonRecord = Record<string, unknown>;
type IntegrityOutcome = "SHA_PASSED" | "CAS_SHA_MISMATCH" | "GET_FAILED";

interface SelectedDocument {
  readonly storage_key: string;
  readonly slug: string;
  readonly municipality_name: string | null;
  readonly triage_content_length: number | null;
  readonly triage_page_count: number | null;
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

function nullableInteger(value: unknown, where: string): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${where}: entier positif ou null requis`);
  return value as number;
}

function expectedSha256(key: string): string {
  const match = /^raw\/pv-index\/cas\/([a-f0-9]{64})\.pdf$/u.exec(key);
  if (!match) throw new Error(`${key}: clé CAS PDF sha256 requise`);
  return match[1]!;
}

function selectedDocuments(): SelectedDocument[] {
  if (statSync(TRIAGE).size > MAX_LOCAL_JSON_BYTES) throw new Error(`${TRIAGE}: lecture > 5 MiB interdite`);
  const triage = record(JSON.parse(readFileSync(TRIAGE, "utf8")), TRIAGE);
  const sample = record(triage.sample, "triage.sample");
  if (sample.inspected_documents !== 30 || !Array.isArray(sample.documents) || sample.documents.length !== 30) {
    throw new Error("triage: l'échantillon pur-scan attendu de 30 documents est invalide");
  }
  const documents = sample.documents.slice(0, LOT_SIZE).map((value, index) => {
    const document = record(value, `triage.sample.documents[${index}]`);
    const key = string(document.storage_key, `triage.sample.documents[${index}].storage_key`);
    expectedSha256(key);
    const pdfinfo = record(document.tools, `triage.sample.documents[${index}].tools`);
    const summary = nullableString(record(pdfinfo.pdfinfo, `triage.sample.documents[${index}].tools.pdfinfo`).summary, "pdfinfo.summary");
    const pages = summary === null ? null : (() => {
      const match = /\bPages:\s*(\d+)\b/u.exec(summary);
      return match ? Number(match[1]) : null;
    })();
    return {
      storage_key: key,
      slug: string(document.slug, `triage.sample.documents[${index}].slug`),
      municipality_name: null,
      triage_content_length: nullableInteger(document.content_length, `triage.sample.documents[${index}].content_length`),
      triage_page_count: pages,
    };
  });
  if (new Set(documents.map((document) => document.storage_key)).size !== LOT_SIZE) throw new Error("triage: clés du lot dupliquées");
  return documents;
}

function compactError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/gu, " ").trim().slice(0, 1_000);
}

async function downloadAndHash(document: SelectedDocument): Promise<GuardResult> {
  const expected = expectedSha256(document.storage_key);
  const finalPath = resolve(LOCAL_PDF_DIRECTORY, `${expected}.pdf`);
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
  if (!output.startsWith(`${COVERAGE}/`)) throw new Error("--out doit rester sous work/coverage");
  if (existsSync(output)) throw new Error(`artefact déjà présent: ${output}`);
  assertS3RunEnvironment();
  mkdirSync(LOCAL_PDF_DIRECTORY, { recursive: true });
  const results: GuardResult[] = [];
  for (const document of selectedDocuments()) {
    const result = await downloadAndHash(document);
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
    selection: "les 20 premières entrées ordonnées de triage.sample.documents",
    guard: {
      before_visual_reading: true,
      transport: "S3 GetObject",
      hash: "sha256 streamé; aucune mise en mémoire intégrale du PDF",
      mismatch_stop_threshold: MISMATCH_STOP,
      stopped_for_integrity_incident: stopped,
    },
    summary: { requested: LOT_SIZE, attempted: results.length, sha_passed: passed, cas_sha_mismatch: mismatches, get_failed: getFailed },
    local_visual_workspace: LOCAL_PDF_DIRECTORY,
    documents: results,
  };
  writeAtomic(output, report);
  process.stdout.write(`${JSON.stringify({ output: output.slice(ROOT.length + 1), summary: report.summary, stopped }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
