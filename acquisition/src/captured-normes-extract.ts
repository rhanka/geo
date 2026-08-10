/**
 * Remote-only bridge: exact captured PDF CAS → Mistral strict schema → parquet
 * and immutable receipt. It does not run the generic norms router, therefore no
 * GPT route can be selected.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  CapturedNormesExtractionReceiptSchema,
  CapturedNormesReferenceSchema,
  type CapturedNormesExtractionReceipt,
} from "../../packages/qc-sources/src/capture/index.js";
import { materializeCapturedNormesPdf } from "./capture-cas-materialize.js";
import { exists, getBytes, putBytesIfAbsentOrEqual, s3Client } from "./lib/s3.js";
import { normsKey } from "./lib/zonage-norms.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ACQUISITION = resolve(HERE, "..");
const REPO = resolve(ACQUISITION, "..");
const SCHEMA_INGEST = join(HERE, "zonage-norms-schema-ingest.ts");
const TSX = join(ACQUISITION, "node_modules", ".bin", "tsx");

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function required(name: string): string {
  const value = option(name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function requireRemoteS3Environment(): void {
  if (process.env["GEO_NORMES_CAPTURED_EXECUTION"] !== "remote") {
    throw new Error("captured normes extraction is remote-only");
  }
  if (!(process.env["NODE_OPTIONS"] ?? "").split(/\s+/).includes("--dns-result-order=ipv4first")) {
    throw new Error("lecture S3 refusée: NODE_OPTIONS=--dns-result-order=ipv4first is required");
  }
  if (process.env["AWS_MAX_ATTEMPTS"] !== "10") {
    throw new Error("lecture S3 refusée: AWS_MAX_ATTEMPTS=10 is required");
  }
}

function receiptKey(referenceKey: string): string {
  const safe = Buffer.from(referenceKey).toString("hex");
  return `registry/normes-captured-receipts/${safe}.json`;
}

interface SchemaReport {
  slug: string;
  pages: number[];
  deposited: boolean;
  key?: string;
  reason?: string;
}

/** The only child command this bridge is permitted to run for extraction. */
export function schemaIngestArgs(reference: { slug: string; url: string }, pdfPath: string, budgetUsd: number): string[] {
  return [
    SCHEMA_INGEST,
    "--slug", reference.slug,
    "--pdf", pdfPath,
    "--source-url", reference.url,
    "--engine", "mistral-schema",
    "--budget-usd", String(budgetUsd),
    "--deposit",
  ];
}

function parseSchemaReport(stdout: string): SchemaReport {
  const parsed = JSON.parse(stdout) as { reports?: unknown };
  if (!Array.isArray(parsed.reports) || parsed.reports.length !== 1) throw new Error("schema ingest must return exactly one report");
  const report = parsed.reports[0] as Partial<SchemaReport>;
  if (typeof report.slug !== "string" || !Array.isArray(report.pages) || typeof report.deposited !== "boolean") {
    throw new Error("schema ingest report is malformed");
  }
  return { slug: report.slug, pages: report.pages, deposited: report.deposited, ...(report.key ? { key: report.key } : {}), ...(report.reason ? { reason: report.reason } : {}) };
}

export async function extractCapturedNormes(referenceKey: string, budgetUsd: number): Promise<{ receiptKey: string; receipt: CapturedNormesExtractionReceipt; upload: "created" | "existing-equal" }> {
  requireRemoteS3Environment();
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) throw new Error("--budget-usd must be a finite positive number");
  const s3 = s3Client();
  const reference = CapturedNormesReferenceSchema.parse(
    JSON.parse((await getBytes(s3, referenceKey)).toString("utf8")),
  );
  if (reference.selection_key === null) throw new Error("captured PDF reference lacks immutable discovery selection");
  const key = receiptKey(referenceKey);
  if (await exists(s3, key)) {
    const receipt = CapturedNormesExtractionReceiptSchema.parse(JSON.parse((await getBytes(s3, key)).toString("utf8")));
    return { receiptKey: key, receipt, upload: "existing-equal" };
  }
  // A bridge receipt may be absent for a legacy parquet. Never spend another
  // paid OCR pass merely to discover that the non-clobbering ingest will skip.
  const existingParquet = normsKey(reference.slug);
  if (await exists(s3, existingParquet)) {
    const receipt = CapturedNormesExtractionReceiptSchema.parse({
      contract: "captured-normes-extraction-receipt/v1",
      generated_at: new Date().toISOString(),
      capture: reference,
      engine: "mistral-schema",
      methode: "ocr/mistral-schema",
      pages: [],
      budget_usd: budgetUsd,
      status: "refused",
      parquet_key: null,
      refusal: `existing norms parquet without captured bridge receipt: ${existingParquet}`,
    });
    const upload = await putBytesIfAbsentOrEqual(s3, key, `${JSON.stringify(receipt, null, 2)}\n`, "application/json");
    return { receiptKey: key, receipt, upload };
  }
  const pdfDir = join(REPO, "work", "zonage-norms", reference.slug);
  const pdfPath = join(pdfDir, "grille.pdf");
  mkdirSync(pdfDir, { recursive: true });

  try {
    await materializeCapturedNormesPdf(reference, pdfPath);
    const result = spawnSync(TSX, schemaIngestArgs(reference, pdfPath, budgetUsd), {
      cwd: ACQUISITION,
      env: {
        ...process.env,
        // The config validator in grille-mistral-schema rejects any non-Mistral
        // endpoint/provider, including ambient self-hosted OCR overrides.
        OCR_PROVIDER: "mistral-ocr",
        OCR_API_BASE: "https://api.mistral.ai",
        OCR_API_PATH: "/v1/ocr",
      },
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.status !== 0) throw new Error(`schema ingest failed: ${(result.stderr || result.stdout || "unknown").slice(-500)}`);
    const report = parseSchemaReport(result.stdout ?? "");
    if (report.slug !== reference.slug) throw new Error("schema ingest returned another slug");
    const receipt = CapturedNormesExtractionReceiptSchema.parse({
      contract: "captured-normes-extraction-receipt/v1",
      generated_at: new Date().toISOString(),
      capture: reference,
      engine: "mistral-schema",
      methode: "ocr/mistral-schema",
      pages: report.pages,
      budget_usd: budgetUsd,
      status: report.deposited ? "deposited" : "refused",
      parquet_key: report.deposited ? (report.key ?? null) : null,
      refusal: report.deposited ? null : (report.reason ?? "schema ingest did not deposit"),
    });
    const upload = await putBytesIfAbsentOrEqual(s3, key, `${JSON.stringify(receipt, null, 2)}\n`, "application/json");
    return { receiptKey: key, receipt, upload };
  } catch (error) {
    const receipt = CapturedNormesExtractionReceiptSchema.parse({
      contract: "captured-normes-extraction-receipt/v1",
      generated_at: new Date().toISOString(),
      capture: reference,
      engine: "mistral-schema",
      methode: "ocr/mistral-schema",
      pages: [],
      budget_usd: budgetUsd,
      status: "refused",
      parquet_key: null,
      refusal: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
    });
    const upload = await putBytesIfAbsentOrEqual(s3, key, `${JSON.stringify(receipt, null, 2)}\n`, "application/json");
    return { receiptKey: key, receipt, upload };
  }
}

async function main(): Promise<void> {
  const budget = Number(option("budget-usd") ?? "5");
  const result = await extractCapturedNormes(required("reference-key"), budget);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.receipt.status !== "deposited") process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
