/**
 * zonage-norms-reparse-run.ts — re-parse ALREADY DEPOSITED norms grilles: recompute
 * the flat `<field>_value` columns FROM their stored `<field>_raw`, WITHOUT re-OCR /
 * re-vision, and re-write the `registry/qc-zonage-norms/qc-zonage-norms-<slug>.parquet`
 * in place. The recompute + its anti-invention contract live in the pure, unit-tested
 * `lib/zonage-norms-reparse.ts`; this runner owns only the S3 I/O.
 *
 * WHAT it does per slug:
 *   1. read the deposited parquet;
 *   2. `reparseNormRows` — FILL-NULLS-ONLY (never overwrite a concordant 2-pass
 *      value) from the stored raw via the frozen single-read guards; a raw that is
 *      not numerically parsable stays null (never fabricated). A recomputed field
 *      gets the distinct `REPARSE_RAW_CONFIDENCE` and its row's `_methode` is tagged
 *      `+reparse-raw` so a consumer (immo) can tell a single-read re-parse from a
 *      2-pass value;
 *   3. if any value was filled: back up the ORIGINAL to `<key>.prereparse` (ONLY if
 *      that backup does not already exist — so the backup always holds the true
 *      pre-reparse original across re-runs), then overwrite the parquet.
 *
 * IDEMPOTENT: a re-run fills nothing (values now present) → no write. NO re-OCR.
 *
 * Usage (npx tsx, from acquisition/):
 *   tsx src/zonage-norms-reparse-run.ts --slugs mont-tremblant --sample TM-105
 *   tsx src/zonage-norms-reparse-run.ts --slugs mont-tremblant --dry-run
 *   tsx src/zonage-norms-reparse-run.ts --all            # whole province (gated by owner)
 */
import type { S3Client } from "@aws-sdk/client-s3";

import { BUCKET, copyObject, exists, getBytes, listSlugs, putBytes, s3Client } from "./lib/s3.js";
import { readParquetRowsFromBuffer } from "./lib/parquet-read.js";
import { ZONAGE_NORMS_PREFIX, normsKey, writeNormsParquet } from "./lib/zonage-norms.js";
import { reparseNormRows } from "./lib/zonage-norms-reparse.js";

interface Args {
  slugs: string[];
  all: boolean;
  dryRun: boolean;
  sample: string | null;
}

function parseArgs(argv: string[]): Args {
  const slugs: string[] = [];
  let all = false;
  let dryRun = false;
  let sample: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--all") all = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--slug") slugs.push(...String(argv[++i] ?? "").split(",").filter(Boolean));
    else if (arg === "--slugs") slugs.push(...String(argv[++i] ?? "").split(",").filter(Boolean));
    else if (arg === "--sample") sample = String(argv[++i] ?? "").trim() || null;
    else throw new Error(`unknown argument: ${arg}`);
  }
  const uniqueSlugs = [...new Set(slugs)];
  if (uniqueSlugs.length === 0 && !all) throw new Error("pass --all, --slug <slug>, or --slugs <a,b>");
  return { slugs: uniqueSlugs, all, dryRun, sample };
}

/** Every deposited norms parquet slug (mirrors publish-norms-grilles enumerate). */
async function enumerateSlugs(s3: S3Client): Promise<string[]> {
  const rests = await listSlugs(s3, ZONAGE_NORMS_PREFIX, ".parquet", true);
  const out = new Set<string>();
  for (const rest of rests) {
    const s = rest.replace(/^qc-zonage-norms-/, "");
    if (s && !s.startsWith("manifest")) out.add(s);
  }
  return [...out].sort();
}

const NORM3 = ["densite", "frontage_min", "superficie_min"] as const;

function sampleLine(rows: Record<string, unknown>[], zone: string): string {
  const key = zone.toUpperCase().replace(/\s+/g, "");
  const row = rows.find((r) => String(r["zone_code"] ?? "").toUpperCase().replace(/\s+/g, "") === key);
  if (!row) return `sample ${zone}: not found`;
  const parts = NORM3.map(
    (f) => `${f}=${JSON.stringify(row[`${f}_value`])}(raw=${JSON.stringify(row[`${f}_raw`])})`,
  );
  return `sample ${zone}: ${parts.join(" ")}`;
}

async function runSlug(s3: S3Client, slug: string, args: Args): Promise<void> {
  const key = normsKey(slug);
  if (!(await exists(s3, key))) {
    console.log(`SKIP ${slug} — no norms parquet (${key})`);
    return;
  }
  const original = await getBytes(s3, key);
  const rows = await readParquetRowsFromBuffer(original);
  const { rows: reparsed, filledByField, rowsChanged } = reparseNormRows(rows);
  const totalFilled = Object.values(filledByField).reduce((a, b) => a + b, 0);

  const summary =
    `${slug} rows=${rows.length} rowsChanged=${rowsChanged} filled=${totalFilled} ` +
    `byField=${JSON.stringify(filledByField)}`;

  if (args.sample) console.log(`  before ${sampleLine(rows, args.sample)}`);

  if (rowsChanged === 0) {
    console.log(`NOOP ${summary} (nothing to fill — already re-parsed or no parsable raw)`);
    return;
  }

  if (args.dryRun) {
    console.log(`DRY  ${summary}`);
    if (args.sample) console.log(`  after  ${sampleLine(reparsed, args.sample)}`);
    return;
  }

  // Back up the ORIGINAL once (idempotent: keep the true pre-reparse bytes).
  const backupKey = `${key}.prereparse`;
  if (!(await exists(s3, backupKey))) {
    await copyObject(s3, key, backupKey);
  }
  const parquet = await writeNormsParquet(reparsed);
  await putBytes(s3, key, parquet, "application/octet-stream");

  // Verify the round-trip re-read carries the filled values.
  const check = await readParquetRowsFromBuffer(await getBytes(s3, key, BUCKET));
  console.log(`OK   ${summary} backup=${backupKey} bytes=${parquet.length}`);
  if (args.sample) console.log(`  after  ${sampleLine(check, args.sample)}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const s3 = s3Client();
  const slugs = args.all ? await enumerateSlugs(s3) : args.slugs;
  if (args.all) console.log(`ALL deposited norms slugs: ${slugs.length}${args.dryRun ? " | --dry-run" : ""}`);

  let ok = 0;
  let noop = 0;
  const failed: Array<{ slug: string; reason: string }> = [];
  for (const slug of slugs) {
    try {
      await runSlug(s3, slug, args);
      ok++;
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      failed.push({ slug, reason });
      console.log(`FAIL ${slug} ${reason}`);
    }
  }
  console.log(`DONE processed=${ok} noop=${noop} failed=${failed.length}`);
  if (failed.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
