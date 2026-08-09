/**
 * Add only a legally reviewed date to an existing density norm.  The legal
 * source is re-read from immutable captured bytes before any write; density
 * values and their source provenance are preserved verbatim.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  CaptureRunHeaderSchema,
  captureRunKeys,
  parseManifestJsonl,
} from "../../packages/qc-sources/src/capture/index.js";
import { captureReceiptFromManifest } from "./lib/zone-provenance-quality.js";
import { stampDensityLegalDateRows } from "./lib/density-legal-date-stamp.js";
import { extractNativeDocumentText } from "./lib/density-document-review.js";
import { readParquetRowsFromBuffer } from "./lib/parquet-read.js";
import { copyObject, exists, getBytes, putBytes, s3Client } from "./lib/s3.js";
import { normsKey, writeNormsParquet } from "./lib/zonage-norms.js";
import { verifyRawCapturePayload } from "./lib/zone-provenance-raw-capture.js";

const BACKUP_SUFFIX = ".pre-legal-date-stamp-20260728";

interface LegalSource {
  captureRun: string;
  manifestLine: number;
  url: string;
  sha256: string;
  storageKey: string;
  ownerVerbatim: string;
  dateVerbatim: string;
  page: number;
}

interface StampWorklistEntry {
  slug: string;
  zoneCodes: string[];
  legalDate: string;
  legalDateEvidence: string;
  legalSource: LegalSource;
}

function value(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index < 0 ? undefined : process.argv[index + 1];
}

function requireS3RunEnvironment(): void {
  if (!(process.env["NODE_OPTIONS"] ?? "").split(/\s+/).includes("--dns-result-order=ipv4first")) {
    throw new Error("run S3 refusé: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  }
  if (process.env["AWS_MAX_ATTEMPTS"] !== "10") {
    throw new Error("run S3 refusé: préfixer AWS_MAX_ATTEMPTS=10");
  }
}

function asRecord(value_: unknown, where: string): Record<string, unknown> {
  if (typeof value_ !== "object" || value_ === null || Array.isArray(value_)) {
    throw new Error(`${where}: objet attendu`);
  }
  return value_ as Record<string, unknown>;
}

function string(value_: unknown, where: string): string {
  if (typeof value_ !== "string" || !value_.trim()) throw new Error(`${where}: texte non vide attendu`);
  return value_;
}

function parseEntry(value_: unknown, index: number): StampWorklistEntry {
  const entry = asRecord(value_, `worklist[${index}]`);
  const legalSource = asRecord(entry["legal_source"], `worklist[${index}].legal_source`);
  const zoneCodes = entry["zone_codes"];
  if (!Array.isArray(zoneCodes) || zoneCodes.some((code) => typeof code !== "string" || !code.trim())) {
    throw new Error(`worklist[${index}].zone_codes: liste de codes exacts attendue`);
  }
  const manifestLine = legalSource["manifest_line"];
  if (!Number.isInteger(manifestLine) || Number(manifestLine) < 0) {
    throw new Error(`worklist[${index}].legal_source.manifest_line: entier positif attendu`);
  }
  const page = legalSource["page"];
  if (!Number.isInteger(page) || Number(page) < 1) {
    throw new Error(`worklist[${index}].legal_source.page: entier positif attendu`);
  }
  return {
    slug: string(entry["slug"], `worklist[${index}].slug`),
    zoneCodes: [...zoneCodes] as string[],
    legalDate: string(entry["legal_date"], `worklist[${index}].legal_date`),
    legalDateEvidence: string(entry["legal_date_evidence"], `worklist[${index}].legal_date_evidence`),
    legalSource: {
      captureRun: string(legalSource["capture_run"], `worklist[${index}].legal_source.capture_run`),
      manifestLine: Number(manifestLine),
      url: string(legalSource["url"], `worklist[${index}].legal_source.url`),
      sha256: string(legalSource["sha256"], `worklist[${index}].legal_source.sha256`),
      storageKey: string(legalSource["storage_key"], `worklist[${index}].legal_source.storage_key`),
      ownerVerbatim: string(legalSource["owner_verbatim"], `worklist[${index}].legal_source.owner_verbatim`),
      dateVerbatim: string(legalSource["date_verbatim"], `worklist[${index}].legal_source.date_verbatim`),
      page: Number(page),
    },
  };
}

function readWorklist(path: string): StampWorklistEntry[] {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("worklist: liste non vide attendue");
  return parsed.map(parseEntry);
}

function assertEvidence(entry: StampWorklistEntry): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.legalDate)) {
    throw new Error(`${entry.slug}: legal_date ISO YYYY-MM-DD requise`);
  }
  for (const required of [
    entry.legalSource.dateVerbatim,
    entry.legalSource.url,
    entry.legalSource.sha256,
    entry.legalSource.storageKey,
  ]) {
    if (!entry.legalDateEvidence.includes(required)) {
      throw new Error(`${entry.slug}: legal_date_evidence doit citer ${required}`);
    }
  }
}

/** PDF text operators often split printed words across line boundaries. */
function compactPdfText(value_: string): string {
  return value_.replace(/\s+/g, " ").trim();
}

async function verifyLegalSource(entry: StampWorklistEntry): Promise<void> {
  const source = entry.legalSource;
  const s3 = s3Client();
  const keys = captureRunKeys(source.captureRun);
  const header = CaptureRunHeaderSchema.parse(JSON.parse((await getBytes(s3, keys.header)).toString("utf8")));
  if (header.run_id !== source.captureRun || header.finished_at === null || header.exit_code !== 0) {
    throw new Error(`${entry.slug}: run de source légale non terminé avec succès`);
  }
  const manifest = parseManifestJsonl((await getBytes(s3, keys.manifest)).toString("utf8"));
  const line = manifest[source.manifestLine];
  if (!line || line.url !== source.url || line.sha256 !== source.sha256 || line.storage_key !== source.storageKey) {
    throw new Error(`${entry.slug}: receipt légal ne correspond pas à la worklist`);
  }
  if (line.redacted || line.http_status === null || line.http_status < 200 || line.http_status >= 300) {
    throw new Error(`${entry.slug}: capture légale non probante`);
  }
  const receipt = captureReceiptFromManifest(line, keys.manifest, source.manifestLine);
  if (receipt === null) throw new Error(`${entry.slug}: receipt légal invalide`);
  const bytes = await getBytes(s3, source.storageKey);
  const meta = JSON.parse((await getBytes(s3, `${source.storageKey}.meta.json`)).toString("utf8")) as unknown;
  const verification = verifyRawCapturePayload(receipt, bytes, meta);
  if (!verification.verified) throw new Error(`${entry.slug}: CAS légal invalide: ${String(verification.reason)}`);
  const native = extractNativeDocumentText(bytes, { sourceName: source.url });
  if (native.text === null) throw new Error(`${entry.slug}: source légale sans texte natif (${String(native.blocker)})`);
  const printed = compactPdfText(native.text);
  if (!printed.includes(compactPdfText(source.ownerVerbatim))) {
    throw new Error(`${entry.slug}: propriétaire imprimé introuvable dans la source légale`);
  }
  if (!printed.includes(compactPdfText(source.dateVerbatim))) {
    throw new Error(`${entry.slug}: citation de date introuvable dans la source légale`);
  }
}

async function stampEntry(entry: StampWorklistEntry, deposit: boolean): Promise<Record<string, unknown>> {
  assertEvidence(entry);
  await verifyLegalSource(entry);
  const s3 = s3Client();
  const key = normsKey(entry.slug);
  const before = await readParquetRowsFromBuffer(await getBytes(s3, key));
  const merged = stampDensityLegalDateRows(before, entry.zoneCodes.map((zoneCode) => ({
    zoneCode,
    legalDate: entry.legalDate,
    legalDateEvidence: entry.legalDateEvidence,
  })));
  if (deposit && merged.stamped > 0) {
    const backupKey = `${key}${BACKUP_SUFFIX}`;
    if (!(await exists(s3, backupKey))) await copyObject(s3, key, backupKey);
    await putBytes(s3, key, await writeNormsParquet(merged.rows), "application/octet-stream");
    const after = await readParquetRowsFromBuffer(await getBytes(s3, key));
    for (const zoneCode of entry.zoneCodes) {
      const row = after.find((candidate) => candidate["zone_code"] === zoneCode);
      if (
        !row
        || row["densite_legal_date"] !== entry.legalDate
        || row["densite_legal_date_evidence"] !== entry.legalDateEvidence
      ) throw new Error(`${entry.slug}/${zoneCode}: relecture parquet de date légale échouée`);
    }
  }
  return {
    slug: entry.slug,
    exact_zone_codes: entry.zoneCodes,
    legal_date: entry.legalDate,
    legal_date_evidence: entry.legalDateEvidence,
    legal_source: entry.legalSource,
    rows_before: before.length,
    rows_after: merged.rows.length,
    stamped: merged.stamped,
    unchanged: merged.unchanged,
    deposited: deposit,
  };
}

async function main(): Promise<void> {
  requireS3RunEnvironment();
  const worklist = value("--worklist");
  if (!worklist) throw new Error("usage: --worklist <json> [--deposit --legal-reviewed]");
  const deposit = process.argv.includes("--deposit");
  if (deposit && !process.argv.includes("--legal-reviewed")) {
    throw new Error("--deposit exige --legal-reviewed");
  }
  const selected = new Set((value("--slugs") ?? "").split(",").filter(Boolean));
  const entries = readWorklist(worklist).filter((entry) => selected.size === 0 || selected.has(entry.slug));
  if (entries.length === 0) throw new Error("aucune entrée sélectionnée");
  const results: Record<string, unknown>[] = [];
  for (const entry of entries) results.push(await stampEntry(entry, deposit));
  const report = {
    contract: "density-legal-date-stamp/v1",
    generated_at: new Date().toISOString(),
    worklist,
    deposited: deposit,
    results,
  };
  if (deposit) {
    await putBytes(
      s3Client(),
      "reports/density-legal-date-stamp/20260728-control.json",
      Buffer.from(`${JSON.stringify(report, null, 2)}\n`),
      "application/json",
    );
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
