/**
 * Remove a junk qc-zonage-norms parquet deposit (e.g. a failed extraction that
 * squeaked past the pubField≠0 floor with ~no real norm values). Prints the
 * deposit's rows + publishedFieldPct BEFORE deleting so the removal is evidenced.
 * NOT in the manifest → safe (manifest-merge only ADDS; this prevents a future
 * merge from folding the garbage). Read-only S3 delete of the passed slug(s) only.
 *
 * Usage: npx tsx acquisition/src/_norms-remove-deposit.ts <slug1> <slug2> ...
 */
import { s3Client, getBytes, exists, deleteObject } from "./lib/s3.js";
import { readParquetRowsFromBuffer } from "./lib/parquet-read.js";
import { normsKey } from "./lib/zonage-norms.js";

const NORM_VALUE_COLS = [
  "densite_value", "hauteur_min_value", "hauteur_max_value", "frontage_min_value",
  "superficie_min_value", "marge_avant_min_value", "marge_laterale_min_value", "marge_arriere_min_value",
];

async function main(): Promise<void> {
  const s3 = s3Client();
  for (const slug of process.argv.slice(2)) {
    const k = normsKey(slug);
    if (!(await exists(s3, k))) { console.log(`${slug}: NO parquet (nothing to remove)`); continue; }
    const rows = await readParquetRowsFromBuffer(await getBytes(s3, k));
    let cells = 0, filled = 0;
    for (const r of rows) for (const c of NORM_VALUE_COLS) { cells++; if (r[c] !== null && r[c] !== undefined) filled++; }
    const pct = cells ? ((100 * filled) / cells).toFixed(1) : "0";
    console.log(`${slug}: rows=${rows.length} publishedFieldPct=${pct}% (${filled}/${cells}) — DELETING ${k}`);
    await deleteObject(s3, k);
    console.log(`${slug}: removed.`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
