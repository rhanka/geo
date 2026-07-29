/**
 * Bounded OCR staging for the 186 already-approved scanned PV CAS objects.
 *
 * This runner never discovers candidates.  It accepts only keys present in the
 * committed 2026-07-29 inventory, keeps a running $2 ceiling, deposits the OCR
 * text to S3, and writes a compact checkpoint report after every document.
 * Graphification is deliberately a separate pass so its native safeguards stay
 * the sole authority for owner, legal-status, date and gazetteer decisions.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { Hash } from "@smithy/core/serde";
import { SignatureV4 } from "@smithy/signature-v4";
import type { HttpRequest } from "@smithy/types";

import { ensureOcrKeyLoaded } from "./lib/ocr-env.js";
import { resolveOcrCall } from "./lib/ocr.js";
import {
  PV_OCR_TEXT_CONTRACT,
  parsePvOcrTextArtifact,
  pvOcrArtifactKey,
  pvOcrUsd,
  type PvOcrTextArtifact,
} from "./lib/pv-ocr-artifact.js";
import { BUCKET, S3ENV, getBytes, loadEnv, objectHead, putBytes, s3Client, s3Target } from "./lib/s3.js";

const ROOT = resolve(import.meta.dirname, "..", "..");
const COVERAGE = resolve(ROOT, "work", "coverage");
const INVENTORY_PATH = "work/coverage/pv-ocr-inventaire-pages-20260729T122121Z.json";
// The inventory report itself is commit f42e09c0; its declared immutable input
// is the authorised failure-triage commit below.
const INVENTORY_INPUT_COMMIT = "14c60a04";
const EXPECTED_DOCUMENTS = 186;
const MAX_LOCAL_OR_ARTIFACT_BYTES = 5 * 1024 * 1024;
const RANGE_BYTES = 512 * 1024;
const OCR_PRICE_PER_PAGE = 0.001;
const OCR_HARD_CAP_PAGES = 2_000;

interface JsonRecord { readonly [key: string]: unknown }

interface InventoryDocument {
  readonly storage_key: string;
  readonly slug: string;
  readonly municipality_name: string;
  readonly url: string;
  readonly page_count: number | null;
  readonly content_length: number;
}

type StageOutcome = "OCR_COMPLETED" | "ALREADY_OCRD" | "OCR_FAILED" | "PAGE_COUNT_UNVERIFIED" | "BUDGET_STOP";

interface StageDocument {
  readonly storage_key: string;
  readonly slug: string;
  readonly municipality_name: string;
  readonly url: string;
  readonly inventory_page_count: number | null;
  readonly verified_page_count: number | null;
  readonly outcome: StageOutcome;
  readonly ocr_artifact_key?: string;
  readonly billed_pages: number | null;
  readonly cost_usd: string | null;
  readonly detail: string | null;
}

interface Args {
  readonly knownStart: number | null;
  readonly knownCount: number | null;
  readonly unknownKey: string | null;
  readonly output: string;
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

function string(value: unknown, where: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${where}: chaîne non vide requise`);
  return value;
}

function positiveInteger(value: unknown, where: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error(`${where}: entier positif requis`);
  return value as number;
}

function nullablePositiveInteger(value: unknown, where: string): number | null {
  if (value === null) return null;
  return positiveInteger(value, where);
}

function parseArgs(): Args {
  const values = (name: string): string[] => process.argv.slice(2)
    .filter((argument) => argument.startsWith(`--${name}=`))
    .map((argument) => argument.slice(name.length + 3));
  const single = (name: string): string | null => {
    const found = values(name);
    if (found.length > 1) throw new Error(`--${name} ne peut apparaître qu'une fois`);
    return found[0] ?? null;
  };
  const knownStartRaw = single("known-start");
  const knownCountRaw = single("known-count");
  const unknownKey = single("unknown-key");
  const out = single("out");
  if (!out) throw new Error("--out=work/coverage/pv-ocr-186-stage-...json est requis");
  const output = resolve(ROOT, out);
  if (!output.startsWith(`${COVERAGE}/`)) throw new Error("--out doit rester sous work/coverage");
  const knownRequested = knownStartRaw !== null || knownCountRaw !== null;
  if (knownRequested === (unknownKey !== null)) {
    throw new Error("choisir exactement --known-start/--known-count ou --unknown-key");
  }
  if (knownRequested && (knownStartRaw === null || knownCountRaw === null)) {
    throw new Error("--known-start et --known-count doivent être fournis ensemble");
  }
  const knownStart = knownStartRaw === null ? null : Number(knownStartRaw);
  const knownCount = knownCountRaw === null ? null : Number(knownCountRaw);
  if (knownStart !== null && (!Number.isInteger(knownStart) || knownStart < 0)) throw new Error("--known-start invalide");
  if (knownCount !== null && (!Number.isInteger(knownCount) || knownCount < 1)) throw new Error("--known-count invalide");
  return { knownStart, knownCount, unknownKey, output };
}

function readSmallJson(path: string): unknown {
  const size = statSync(path).size;
  if (size > MAX_LOCAL_OR_ARTIFACT_BYTES) throw new Error(`${path}: lecture > 5 MiB interdite`);
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function inventory(): InventoryDocument[] {
  const root = record(readSmallJson(resolve(ROOT, INVENTORY_PATH)), INVENTORY_PATH);
  if (root.contract !== "pv-ocr-inventaire-pages/v1" || root.input_commit !== INVENTORY_INPUT_COMMIT) {
    throw new Error("inventaire OCR non ancré sur le commit autorisé");
  }
  if (root.unique_failed_documents !== EXPECTED_DOCUMENTS || !Array.isArray(root.failed_documents)) {
    throw new Error("inventaire OCR: les 186 clés autorisées ne sont pas présentes");
  }
  const documents = root.failed_documents.map((value, index) => {
    const item = record(value, `${INVENTORY_PATH}.failed_documents[${index}]`);
    return {
      storage_key: string(item.storage_key, "storage_key"),
      slug: string(item.slug, "slug"),
      municipality_name: string(item.municipality_name, "municipality_name"),
      url: string(item.url, "url"),
      page_count: nullablePositiveInteger(item.page_count, "page_count"),
      content_length: positiveInteger(item.content_length, "content_length"),
    };
  });
  if (documents.length !== EXPECTED_DOCUMENTS || new Set(documents.map((document) => document.storage_key)).size !== EXPECTED_DOCUMENTS) {
    throw new Error("inventaire OCR: cardinalité ou unicité des 186 clés invalide");
  }
  return documents;
}

function selectDocuments(all: readonly InventoryDocument[], args: Args): InventoryDocument[] {
  if (args.unknownKey !== null) {
    const selected = all.filter((document) => document.storage_key === args.unknownKey && document.page_count === null);
    if (selected.length !== 1) throw new Error("--unknown-key doit être une des trois clés à pages inconnues");
    return selected;
  }
  const known = all.filter((document) => document.page_count !== null);
  const selected = known.slice(args.knownStart!, args.knownStart! + args.knownCount!);
  if (selected.length !== args.knownCount) throw new Error("sélection connue hors des 183 documents autorisés");
  return selected;
}

function writeAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

function completedPagesFromPreviousStages(excludePath: string): Map<string, number> {
  const pages = new Map<string, number>();
  for (const name of readdirSync(COVERAGE).filter((entry) => /^pv-ocr-186-stage-.*\.json$/u.test(entry)).sort()) {
    const path = resolve(COVERAGE, name);
    if (path === excludePath || statSync(path).size > MAX_LOCAL_OR_ARTIFACT_BYTES) continue;
    const value = record(readSmallJson(path), path);
    if (value.contract !== "pv-ocr-stage/v1" || !Array.isArray(value.documents)) continue;
    for (const item of value.documents) {
      const document = record(item, `${path}.documents[]`);
      if (document.billed_pages === null || document.billed_pages === undefined) continue;
      const key = string(document.storage_key, `${path}.documents[].storage_key`);
      const billed = positiveInteger(document.billed_pages, `${path}.documents[].billed_pages`);
      const previous = pages.get(key);
      if (previous !== undefined && previous !== billed) throw new Error(`${key}: coût OCR historique contradictoire`);
      pages.set(key, billed);
    }
  }
  return pages;
}

async function readBoundedRange(s3: S3Client, key: string, start: number, endInclusive: number): Promise<Buffer> {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(endInclusive) || start < 0 || endInclusive < start || endInclusive - start + 1 > RANGE_BYTES) {
    throw new Error(`${key}: plage S3 OCR invalide`);
  }
  const response = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key, Range: `bytes=${start}-${endInclusive}` }));
  const body = response.Body as AsyncIterable<Uint8Array> & { destroy?: (error?: Error) => void };
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > RANGE_BYTES) {
      body.destroy?.(new Error("plage S3 OCR trop grande"));
      throw new Error(`${key}: réponse de plage > ${RANGE_BYTES} octets`);
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, size);
}

function objectBody(buffer: Buffer, objectNumber: number, generation: number): string | null {
  const text = buffer.toString("latin1");
  const marker = new RegExp(`\\b${objectNumber}\\s+${generation}\\s+obj\\b([\\s\\S]{0,131072}?)endobj`, "u");
  return marker.exec(text)?.[1] ?? null;
}

function rootReference(buffer: Buffer): { object: number; generation: number } | null {
  const matches = [...buffer.toString("latin1").matchAll(/\/Root\s+(\d+)\s+(\d+)\s+R\b/gu)];
  const match = matches.at(-1);
  if (!match) return null;
  return { object: Number(match[1]), generation: Number(match[2]) };
}

function xrefOffset(buffer: Buffer, objectNumber: number): number | null {
  const text = buffer.toString("latin1");
  const xref = text.lastIndexOf("xref");
  if (xref < 0) return null;
  const lines = text.slice(xref).split(/\r?\n/u);
  let index = 1;
  while (index < lines.length) {
    const header = /^(\d+)\s+(\d+)\s*$/u.exec(lines[index]!);
    if (!header) break;
    const first = Number(header[1]);
    const count = Number(header[2]);
    index++;
    if (objectNumber >= first && objectNumber < first + count) {
      const row = lines[index + objectNumber - first];
      const match = /^(\d{10})\s+\d{5}\s+n\b/u.exec(row ?? "");
      return match ? Number(match[1]) : null;
    }
    index += count;
  }
  return null;
}

/**
 * Determines a PDF page count from bounded S3 byte ranges only.  It follows
 * the trailer Root → Catalog Pages → Pages Count chain; unsupported PDF xref
 * layouts fail closed rather than reading a >5 MiB document in full.
 */
async function boundedPdfPageCount(s3: S3Client, key: string, contentLength: number): Promise<number | null> {
  const tailStart = Math.max(0, contentLength - RANGE_BYTES);
  const tail = await readBoundedRange(s3, key, tailStart, contentLength - 1);
  const root = rootReference(tail);
  if (!root) return null;
  let catalog = objectBody(tail, root.object, root.generation);
  if (catalog === null) {
    const offset = xrefOffset(tail, root.object);
    if (offset === null || offset >= contentLength) return null;
    catalog = objectBody(await readBoundedRange(s3, key, offset, Math.min(contentLength - 1, offset + RANGE_BYTES - 1)), root.object, root.generation);
  }
  if (catalog === null) return null;
  const pagesRef = /\/Pages\s+(\d+)\s+(\d+)\s+R\b/u.exec(catalog);
  if (!pagesRef) return null;
  const pagesObject = Number(pagesRef[1]);
  const pagesGeneration = Number(pagesRef[2]);
  let pages = objectBody(tail, pagesObject, pagesGeneration);
  if (pages === null) {
    const offset = xrefOffset(tail, pagesObject);
    if (offset === null || offset >= contentLength) return null;
    pages = objectBody(await readBoundedRange(s3, key, offset, Math.min(contentLength - 1, offset + RANGE_BYTES - 1)), pagesObject, pagesGeneration);
  }
  const count = /\/Type\s*\/Pages\b[\s\S]*?\/Count\s+(\d+)\b/u.exec(pages ?? "");
  return count && Number.isSafeInteger(Number(count[1])) && Number(count[1]) > 0 ? Number(count[1]) : null;
}

function credentials(): { readonly accessKeyId: string; readonly secretAccessKey: string } {
  const env = existsSync(S3ENV) ? loadEnv(S3ENV) : process.env;
  if (!env.S3_ACCESS_KEY || !env.S3_SECRET_KEY) throw new Error("identifiants S3 absents pour URL OCR présignée");
  return { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY };
}

/** A ten-minute read-only URL lets Mistral read one already-captured CAS PDF. */
async function presignedGetUrl(key: string): Promise<string> {
  const target = s3Target();
  const endpoint = new URL(target.endpoint);
  const path = `${endpoint.pathname.replace(/\/$/u, "")}/${encodeURIComponent(BUCKET)}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const signer = new SignatureV4({
    credentials: credentials(),
    region: target.region,
    service: "s3",
    sha256: Hash.bind(null, "sha256"),
    uriEscapePath: false,
  });
  const request = await signer.presign({
    protocol: endpoint.protocol,
    hostname: endpoint.hostname,
    ...(endpoint.port ? { port: Number(endpoint.port) } : {}),
    method: "GET",
    path,
    query: {},
    headers: { host: endpoint.host },
  } as HttpRequest, { expiresIn: 600 });
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(request.query ?? {})) {
    if (Array.isArray(value)) value.forEach((part) => params.append(name, part));
    else if (typeof value === "string") params.set(name, value);
  }
  return `${endpoint.protocol}//${endpoint.host}${request.path}?${params.toString()}`;
}

async function ocrPresignedUrl(url: string, model: string): Promise<{ pages: readonly { markdown: string }[]; pagesProcessed: number }> {
  const apiKey = process.env.OCR_API_KEY ?? process.env.MISTRAL_API_KEY;
  if (!apiKey) throw new Error("MISTRAL_API_KEY / OCR_API_KEY absent");
  const library = await import("mistral-ocr");
  const client = library.createMistralClient(apiKey);
  const response = await client.ocr.process({
    model,
    document: { type: "document_url", documentUrl: url },
    includeImageBase64: false,
  });
  const pages = (response.pages ?? []).map((page) => ({ markdown: page.markdown ?? "" }));
  const pagesProcessed = response.usageInfo?.pagesProcessed ?? pages.length;
  if (!Number.isSafeInteger(pagesProcessed) || pagesProcessed < 1) throw new Error("Mistral OCR: pages facturées absentes");
  return { pages, pagesProcessed };
}

async function existingArtifact(s3: S3Client, document: InventoryDocument): Promise<PvOcrTextArtifact | null> {
  const key = pvOcrArtifactKey(document.storage_key);
  const head = await objectHead(s3, key);
  if (!head.exists) return null;
  if (head.contentLength === undefined || head.contentLength > MAX_LOCAL_OR_ARTIFACT_BYTES) {
    throw new Error(`${key}: artefact OCR existant trop grand ou taille inconnue`);
  }
  const artifact = parsePvOcrTextArtifact(JSON.parse((await getBytes(s3, key)).toString("utf8")), key);
  if (artifact.source.storage_key !== document.storage_key || artifact.source.slug !== document.slug || artifact.source.url !== document.url || artifact.source.municipality_name !== document.municipality_name) {
    throw new Error(`${key}: artefact OCR existant non réconcilié`);
  }
  return artifact;
}

function stageReport(selected: readonly InventoryDocument[], documents: readonly StageDocument[], priorBilledPages: number): unknown {
  const billedPages = documents.reduce((total, document) => total + (document.billed_pages ?? 0), 0);
  const completed = documents.filter((document) => document.outcome === "OCR_COMPLETED" || document.outcome === "ALREADY_OCRD").length;
  return {
    contract: "pv-ocr-stage/v1",
    generated_at: new Date().toISOString(),
    input_inventory: INVENTORY_PATH,
    input_commit: INVENTORY_INPUT_COMMIT,
    authorization: { unique_cas_keys: EXPECTED_DOCUMENTS, hard_cap_usd: "2.000", price_per_page_usd: "0.001" },
    selected_documents: selected.length,
    completed_documents: completed,
    costs: {
      previously_observed_billed_pages: priorBilledPages,
      stage_billed_pages: billedPages,
      observed_billed_pages: priorBilledPages + billedPages,
      observed_cost_usd: pvOcrUsd(priorBilledPages + billedPages),
      hard_cap_usd: "2.000",
    },
    documents,
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  assertS3RunEnvironment();
  ensureOcrKeyLoaded();
  const resolved = resolveOcrCall();
  if (resolved.config.provider !== "mistral-ocr" || resolved.config.apiBase !== "https://api.mistral.ai" || resolved.costPerPage !== OCR_PRICE_PER_PAGE) {
    throw new Error("ce lot autorisé exige Mistral OCR au tarif exact de 0.001 USD/page");
  }
  const selected = selectDocuments(inventory(), args);
  const prior = completedPagesFromPreviousStages(args.output);
  const priorBilledPages = [...prior.values()].reduce((total, pages) => total + pages, 0);
  if (priorBilledPages > OCR_HARD_CAP_PAGES) throw new Error(`plafond déjà dépassé: ${pvOcrUsd(priorBilledPages)} USD`);
  const documents: StageDocument[] = [];
  const s3 = s3Client();
  const checkpoint = (): void => writeAtomic(args.output, stageReport(selected, documents, priorBilledPages));
  checkpoint();

  for (const document of selected) {
    let verifiedPagesForFailure: number | null = document.page_count;
    let billedPagesForFailure: number | null = null;
    try {
      const previous = await existingArtifact(s3, document);
      if (previous) {
        documents.push({
          ...document,
          inventory_page_count: document.page_count,
          verified_page_count: previous.ocr.verified_pages,
          outcome: "ALREADY_OCRD",
          ocr_artifact_key: pvOcrArtifactKey(document.storage_key),
          billed_pages: previous.ocr.billed_pages,
          cost_usd: previous.ocr.cost_usd,
          detail: "artefact OCR durable déjà présent; aucune nouvelle requête facturable",
        });
        checkpoint();
        continue;
      }
      const head = await objectHead(s3, document.storage_key);
      if (!head.exists || head.contentLength === undefined || head.contentLength !== document.content_length) {
        throw new Error("objet CAS absent ou taille différente de l'inventaire autorisé");
      }
      const verifiedPages = document.page_count ?? await boundedPdfPageCount(s3, document.storage_key, head.contentLength);
      verifiedPagesForFailure = verifiedPages;
      if (verifiedPages === null) {
        documents.push({ ...document, inventory_page_count: null, verified_page_count: null, outcome: "PAGE_COUNT_UNVERIFIED", billed_pages: null, cost_usd: null, detail: "pages > 5 MiB non vérifiables par lectures S3 bornées; OCR non lancé" });
        checkpoint();
        continue;
      }
      const alreadyBilled = priorBilledPages + documents.reduce((total, item) => total + (item.billed_pages ?? 0), 0);
      if (alreadyBilled + verifiedPages > OCR_HARD_CAP_PAGES) {
        documents.push({ ...document, inventory_page_count: document.page_count, verified_page_count: verifiedPages, outcome: "BUDGET_STOP", billed_pages: null, cost_usd: null, detail: `projection ${pvOcrUsd(alreadyBilled + verifiedPages)} USD > plafond 2.000 USD; OCR non lancé` });
        checkpoint();
        break;
      }
      const result = head.contentLength <= MAX_LOCAL_OR_ARTIFACT_BYTES
        ? await (async () => {
          const workspace = resolve(ROOT, "work", "pv-ocr", document.storage_key.slice(-16));
          mkdirSync(workspace, { recursive: true });
          const pdfPath = resolve(workspace, "captured.pdf");
          writeFileSync(pdfPath, await getBytes(s3, document.storage_key));
          const output = await resolved.call(pdfPath);
          return { pages: output.pages, pagesProcessed: output.pagesProcessed, inputTransport: "s3-local-bounded" as const };
        })()
        : await (async () => {
          const output = await ocrPresignedUrl(await presignedGetUrl(document.storage_key), resolved.config.model);
          return { ...output, inputTransport: "s3-presigned-url" as const };
        })();
      if (!Number.isSafeInteger(result.pagesProcessed) || result.pagesProcessed < 1) throw new Error("OCR sans pages facturées");
      billedPagesForFailure = result.pagesProcessed;
      const text = result.pages.map((page) => page.markdown).join("\f");
      if (!text.trim()) throw new Error("OCR vide: texte non déposable ni graphifiable");
      if (Buffer.byteLength(text, "utf8") > MAX_LOCAL_OR_ARTIFACT_BYTES) throw new Error("texte OCR > 5 MiB: dépôt/lecture bornés refusés");
      const artifact: PvOcrTextArtifact = {
        contract: PV_OCR_TEXT_CONTRACT,
        generated_at: new Date().toISOString(),
        source: { storage_key: document.storage_key, slug: document.slug, municipality_name: document.municipality_name, url: document.url },
        ocr: {
          provider: "mistral-ocr",
          methode: resolved.methode,
          model: resolved.config.model,
          input_transport: result.inputTransport,
          expected_pages: document.page_count,
          verified_pages: verifiedPages,
          billed_pages: result.pagesProcessed,
          cost_per_page_usd: "0.001",
          cost_usd: pvOcrUsd(result.pagesProcessed),
        },
        text,
      };
      await putBytes(s3, pvOcrArtifactKey(document.storage_key), JSON.stringify(artifact), "application/json");
      documents.push({
        ...document,
        inventory_page_count: document.page_count,
        verified_page_count: verifiedPages,
        outcome: "OCR_COMPLETED",
        ocr_artifact_key: pvOcrArtifactKey(document.storage_key),
        billed_pages: result.pagesProcessed,
        cost_usd: artifact.ocr.cost_usd,
        detail: result.pagesProcessed === verifiedPages ? null : `Mistral a facturé ${result.pagesProcessed} pages, contrôle PDF=${verifiedPages}`,
      });
      checkpoint();
      const observed = priorBilledPages + documents.reduce((total, item) => total + (item.billed_pages ?? 0), 0);
      if (observed > OCR_HARD_CAP_PAGES) break;
    } catch (error) {
      documents.push({
        ...document,
        inventory_page_count: document.page_count,
        verified_page_count: verifiedPagesForFailure,
        outcome: "OCR_FAILED",
        billed_pages: billedPagesForFailure,
        cost_usd: billedPagesForFailure === null ? null : pvOcrUsd(billedPagesForFailure),
        detail: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000),
      });
      checkpoint();
      const observed = priorBilledPages + documents.reduce((total, item) => total + (item.billed_pages ?? 0), 0);
      if (observed > OCR_HARD_CAP_PAGES) break;
    }
  }
  const final = stageReport(selected, documents, priorBilledPages) as JsonRecord;
  console.log(JSON.stringify({ report: args.output.slice(ROOT.length + 1), selected: selected.length, completed: final.completed_documents, cost_usd: record(final.costs, "costs").observed_cost_usd }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
