/**
 * zonage-norms-registry-fix.ts — apply a VERBATIM, auditable data-quality
 * reconciliation to a deposited `registry/qc-zonage-norms/qc-zonage-norms-<slug>.parquet`
 * from a committed JSON spec, in ONE backed-up + verified write. It fixes the two
 * systemic defects a multi-page HORIZONTAL grille exposes when the frozen
 * specifications parser drops/shifts columns:
 *   - REMOVE  fabricated pseudo-zones (wrapped row-labels / stray numbers the parser
 *             mis-read as zone_codes);
 *   - REKEY   mis-parsed real codes to their true code (prefix truncation / letter
 *             transposition), preserving the row's already-correct verbatim norms;
 *   - FILL    a NULL norm field from the operator's VERBATIM source read (fill-null-only;
 *             never overwrites a present value);
 *   - CORRECT overwrite a shift-corrupted present value with its verbatim source value.
 *
 * ANTI-INVENTION: every value comes from the spec, which must cite the source cell
 * (`prov`). value/raw/unit are transcriptions, never computed. Each touched row's
 * `_methode` is tagged (spec `note`) so the change is auditable; the ORIGINAL parquet
 * is backed up ONCE to `<key>.preregistryfix`; the round-trip re-read is verified.
 * IDEMPOTENT: a re-run fills nothing new (values now present), re-keys nothing (old
 * codes gone), removes nothing (rows gone), and skips corrects already at target.
 *
 * Usage:  tsx acquisition/src/zonage-norms-registry-fix.ts --spec <json> [--dry-run]
 */
import { readFileSync } from "node:fs";

import { BUCKET, copyObject, exists, getBytes, putBytes, s3Client } from "./lib/s3.js";
import { readParquetRowsFromBuffer } from "./lib/parquet-read.js";
import { NORM_FIELDS, normsKey, writeNormsParquet } from "./lib/zonage-norms.js";

interface CellSpec { zone: string; field: string; value: number | null; unit: string | null; raw: string | null; note: string; }
interface Spec {
  slug: string;
  remove?: string[];
  rekey?: Record<string, string>;
  fill?: CellSpec[];
  correct?: CellSpec[];
  confidence?: number;
}

const norm = (c: unknown): string => String(c ?? "").toUpperCase().replace(/\s+/g, "");

function findRow(rows: Record<string, unknown>[], zone: string): Record<string, unknown> | undefined {
  const k = norm(zone);
  return rows.find((r) => norm(r["zone_code"]) === k);
}

function applyCell(row: Record<string, unknown>, c: CellSpec, conf: number, mode: "fill" | "correct"): "set" | "noop" | "skip" {
  if (!NORM_FIELDS.includes(c.field as (typeof NORM_FIELDS)[number])) throw new Error(`bad field ${c.field}`);
  const vKey = `${c.field}_value`, rKey = `${c.field}_raw`, uKey = `${c.field}_unit`, cKey = `${c.field}_confidence`;
  const cur = row[vKey];
  const hasCur = cur !== null && cur !== undefined && Number.isFinite(Number(cur));
  const already = Number(cur) === c.value && String(row[rKey] ?? "") === String(c.raw ?? "") && String(row[uKey] ?? "") === String(c.unit ?? "");
  if (mode === "fill" && hasCur) return already ? "noop" : "skip"; // fill-null-only: never overwrite
  if (already) return "noop";
  row[rKey] = c.raw ?? undefined;
  row[vKey] = c.value ?? undefined;
  row[uKey] = c.unit ?? undefined;
  row[cKey] = conf;
  const m = row["_methode"] == null ? "" : String(row["_methode"]);
  if (!m.includes(c.note)) row["_methode"] = m ? `${m}+${c.note}` : c.note;
  return "set";
}

async function main(): Promise<void> {
  const specPath = process.argv[process.argv.indexOf("--spec") + 1];
  const dryRun = process.argv.includes("--dry-run");
  if (!specPath) throw new Error("required: --spec <json>");
  const spec = JSON.parse(readFileSync(specPath, "utf8")) as Spec;
  const conf = typeof spec.confidence === "number" ? spec.confidence : 0.92;
  const key = normsKey(spec.slug);
  const s3 = s3Client();
  if (!(await exists(s3, key))) throw new Error(`no norms parquet: ${key}`);
  let rows = await readParquetRowsFromBuffer(await getBytes(s3, key));
  const before = rows.length;

  // 1) REMOVE
  const removeSet = new Set((spec.remove ?? []).map(norm));
  const removed: string[] = [];
  rows = rows.filter((r) => {
    if (removeSet.has(norm(r["zone_code"]))) { removed.push(String(r["zone_code"])); return false; }
    return true;
  });

  // 2) REKEY
  const rekeyed: string[] = [];
  for (const [oldCode, newCode] of Object.entries(spec.rekey ?? {})) {
    const row = findRow(rows, oldCode);
    if (!row) { console.log(`REKEY skip (absent): ${oldCode}`); continue; }
    if (findRow(rows, newCode)) { console.log(`REKEY skip (target exists): ${oldCode}->${newCode}`); continue; }
    row["zone_code"] = newCode;
    rekeyed.push(`${oldCode}->${newCode}`);
  }

  // 3) FILL (fill-null-only) then 4) CORRECT (overwrite)
  const tally = { fillSet: 0, fillNoop: 0, fillSkip: [] as string[], corrSet: 0, corrNoop: 0, missing: [] as string[] };
  for (const c of spec.fill ?? []) {
    const row = findRow(rows, c.zone);
    if (!row) { tally.missing.push(`fill:${c.zone}`); continue; }
    const r = applyCell(row, c, conf, "fill");
    if (r === "set") tally.fillSet++; else if (r === "noop") tally.fillNoop++; else tally.fillSkip.push(`${c.zone}.${c.field}`);
  }
  for (const c of spec.correct ?? []) {
    const row = findRow(rows, c.zone);
    if (!row) { tally.missing.push(`correct:${c.zone}`); continue; }
    const r = applyCell(row, c, conf, "correct");
    if (r === "set") tally.corrSet++; else tally.corrNoop++;
  }

  console.log(`rows ${before} -> ${rows.length} | removed=${removed.length} rekeyed=${rekeyed.length} ` +
    `filled=${tally.fillSet}(noop=${tally.fillNoop},skip=${tally.fillSkip.length}) corrected=${tally.corrSet}(noop=${tally.corrNoop})`);
  if (removed.length) console.log(`  REMOVED: ${removed.join(" | ")}`);
  if (rekeyed.length) console.log(`  REKEYED: ${rekeyed.join(" | ")}`);
  if (tally.fillSkip.length) console.log(`  FILL-SKIP (present, not overwritten): ${tally.fillSkip.join(" | ")}`);
  if (tally.missing.length) console.log(`  MISSING ROWS: ${tally.missing.join(" | ")}`);

  if (dryRun) { console.log("DRY-RUN — no write"); return; }
  const backupKey = `${key}.preregistryfix`;
  if (!(await exists(s3, backupKey))) { await copyObject(s3, key, backupKey); console.log(`BACKUP ${backupKey}`); }
  else console.log(`BACKUP exists (kept) ${backupKey}`);
  const parquet = await writeNormsParquet(rows);
  await putBytes(s3, key, parquet, "application/octet-stream");
  const check = await readParquetRowsFromBuffer(await getBytes(s3, key, BUCKET));
  console.log(`OK wrote ${key} rows=${check.length} bytes=${parquet.length}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
