/**
 * Fold legal-date provenance already verified in a norms parquet onto the
 * served qc-zonage object.  Every zone match is literal equality.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { foldExactDensityLegalDate } from "./lib/density-legal-date-served-fold.js";
import { readParquetRowsFromBuffer } from "./lib/parquet-read.js";
import { getBytes, exists, s3Client } from "./lib/s3.js";
import { putServedZoneAdditive } from "./lib/zonage-proof.js";
import { normsKey } from "./lib/zonage-norms.js";

const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";
const LEGAL_DATE_FIELDS = ["densite_legal_date", "densite_legal_date_evidence"] as const;

interface WorklistEntry {
  slug: string;
  zoneCodes: string[];
  legalDate: string;
  legalDateEvidence: string;
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

function parseWorklist(path: string): WorklistEntry[] {
  const value_ = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!Array.isArray(value_) || value_.length === 0) throw new Error("worklist non vide attendue");
  return value_.map((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) throw new Error(`worklist[${index}] invalide`);
    const record = item as Record<string, unknown>;
    const zones = record["zone_codes"];
    if (
      typeof record["slug"] !== "string"
      || !Array.isArray(zones)
      || zones.some((zone) => typeof zone !== "string" || !zone.trim())
      || typeof record["legal_date"] !== "string"
      || !/^\d{4}-\d{2}-\d{2}$/.test(record["legal_date"])
      || typeof record["legal_date_evidence"] !== "string"
      || !record["legal_date_evidence"].trim()
    ) throw new Error(`worklist[${index}] invalide`);
    return {
      slug: record["slug"],
      zoneCodes: [...zones] as string[],
      legalDate: record["legal_date"],
      legalDateEvidence: record["legal_date_evidence"],
    };
  });
}

async function servedKeys(slug: string): Promise<string[]> {
  const s3 = s3Client();
  const candidates = [
    `${ZONAGE_PREFIX}qc-zonage-${slug}.geojson`,
    `${ZONAGE_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`,
  ];
  const keys: string[] = [];
  for (const key of candidates) if (await exists(s3, key)) keys.push(key);
  return keys;
}

async function foldEntry(entry: WorklistEntry, dryRun: boolean): Promise<Record<string, unknown>> {
  const s3 = s3Client();
  const rows = await readParquetRowsFromBuffer(await getBytes(s3, normsKey(entry.slug)));
  for (const zoneCode of entry.zoneCodes) {
    const row = rows.filter((candidate) => candidate["zone_code"] === zoneCode);
    if (row.length !== 1) throw new Error(`${entry.slug}/${zoneCode}: ligne normative exacte attendue, ${row.length} trouvée`);
    if (
      row[0]!["densite_legal_date"] !== entry.legalDate
      || row[0]!["densite_legal_date_evidence"] !== entry.legalDateEvidence
    ) throw new Error(`${entry.slug}/${zoneCode}: norme sans la date légale vérifiée`);
  }

  const results: Array<Record<string, unknown>> = [];
  for (const key of await servedKeys(entry.slug)) {
    const fc = JSON.parse((await getBytes(s3, key)).toString("utf8")) as {
      type?: unknown;
      features?: Array<{ properties?: Record<string, unknown> | null }>;
    };
    if (fc.type !== "FeatureCollection" || !Array.isArray(fc.features)) throw new Error(`${key}: FeatureCollection attendue`);
    let matched = 0;
    let changed = 0;
    for (const zoneCode of entry.zoneCodes) {
      const folded = foldExactDensityLegalDate(fc.features, {
        zoneCode,
        legalDate: entry.legalDate,
        legalDateEvidence: entry.legalDateEvidence,
      });
      matched += folded.matched;
      changed += folded.changed;
    }
    if (matched === 0) throw new Error(`${key}: aucun polygone au code exact demandé`);
    if (!dryRun && changed > 0) {
      await putServedZoneAdditive(s3, key, fc as never, { allowedProps: LEGAL_DATE_FIELDS });
    }
    results.push({ key, polygons_matched_exactly: matched, provenance_cells_changed: changed, written: !dryRun && changed > 0 });
  }
  return { slug: entry.slug, legal_date: entry.legalDate, served: results };
}

async function main(): Promise<void> {
  requireS3RunEnvironment();
  const worklist = value("--worklist");
  if (!worklist) throw new Error("usage: --worklist <json> [--dry-run]");
  const dryRun = process.argv.includes("--dry-run");
  const selected = new Set((value("--slugs") ?? "").split(",").filter(Boolean));
  const entries = parseWorklist(worklist).filter((entry) => selected.size === 0 || selected.has(entry.slug));
  if (entries.length === 0) throw new Error("aucune entrée sélectionnée");
  const results: Record<string, unknown>[] = [];
  for (const entry of entries) results.push(await foldEntry(entry, dryRun));
  process.stdout.write(`${JSON.stringify({ contract: "density-legal-date-fold/v1", dry_run: dryRun, results }, null, 2)}\n`);
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
