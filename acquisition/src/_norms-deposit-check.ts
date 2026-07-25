/**
 * Verify deposited qc-zonage-norms parquet products for a list of slugs.
 * For each slug: parquet presence, row count, distinct zone_code + sample,
 * published-field %, _source_url/_reglement/_methode/_snapshot, and canon
 * overlap with the served SIG grille. Read-only ($0, no Mistral).
 *
 * Usage: npx tsx acquisition/src/_norms-deposit-check.ts <slug1> <slug2> ...
 */
import { s3Client, getBytes, exists } from "./lib/s3.js";
import { readParquetRowsFromBuffer } from "./lib/parquet-read.js";
import { resolveGridKey, normsKey, SIG_ZONE_CODE_FIELDS, canonZone } from "./lib/zonage-norms.js";

const NORM_VALUE_COLS = [
  "densite_value", "hauteur_min_value", "hauteur_max_value", "frontage_min_value",
  "superficie_min_value", "marge_avant_min_value", "marge_laterale_min_value", "marge_arriere_min_value",
];

async function main(): Promise<void> {
  const s3 = s3Client();
  for (const slug of process.argv.slice(2)) {
    console.log(`\n===== ${slug} =====`);
    const k = normsKey(slug);
    if (!(await exists(s3, k))) { console.log(`  NO parquet at ${k}`); continue; }
    const rows = await readParquetRowsFromBuffer(await getBytes(s3, k));
    console.log(`  key: ${k}`);
    console.log(`  parquet rows: ${rows.length}`);
    const codes = [...new Set(rows.map((r) => String(r["zone_code"] ?? "")).filter(Boolean))];
    console.log(`  distinct zone_code (${codes.length}): ${codes.slice(0, 24).join(", ")}`);
    // published field pct across the 8 norm value columns
    let cells = 0, filled = 0;
    for (const r of rows) for (const c of NORM_VALUE_COLS) { cells++; if (r[c] !== null && r[c] !== undefined) filled++; }
    console.log(`  publishedFieldPct: ${cells ? ((100 * filled) / cells).toFixed(1) : "0"}%  (${filled}/${cells})`);
    const r0 = rows[0] ?? {};
    console.log(`  _source_url: ${r0["_source_url"] ?? "—"}`);
    console.log(`  _reglement:  ${r0["_reglement"] ?? "—"}`);
    console.log(`  _methode:    ${r0["_methode"] ?? "—"}`);
    console.log(`  _snapshot:   ${r0["_snapshot"] ?? "—"}`);

    const gk = await resolveGridKey(s3, slug);
    if (!gk) { console.log(`  SIG grid key: NONE`); continue; }
    const gj = JSON.parse((await getBytes(s3, gk)).toString("utf8")) as { features?: Array<{ properties?: Record<string, unknown> | null }> };
    const feats = gj.features ?? [];
    const canonToRaw = new Map<string, string>();
    for (const f of feats) {
      const p = f.properties ?? {};
      for (const name of SIG_ZONE_CODE_FIELDS) {
        const v = p[name];
        if (v === null || v === undefined || !String(v).trim()) continue;
        canonToRaw.set(canonZone(String(v).trim()), String(v).trim());
      }
    }
    const parquetCanon = new Set(codes.map((c) => canonZone(c)));
    let overlap = 0;
    for (const c of parquetCanon) if (canonToRaw.has(c)) overlap++;
    console.log(`  SIG grid key: ${gk}  (SIG canon codes: ${canonToRaw.size})`);
    console.log(`  canon overlap parquet∩SIG: ${overlap} / ${parquetCanon.size}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
