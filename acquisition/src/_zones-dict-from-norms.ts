/**
 * _zones-dict-from-norms.ts — écrit le dictionnaire de codes de zone RÉELS d'une
 * muni depuis sa grille de normes DÉJÀ DÉPOSÉE (registry/qc-zonage-norms).
 *
 * WHY : la relaxation numérique §7.5 (`--allow-numeric-codes`) et la voie
 * glyph-vision (`--labels claude --dict`) exigent toutes deux un `--dict`
 * AUTORITAIRE. La grille de normes déposée est extraite du règlement de zonage
 * lui-même : ses `zone_code` sont donc des codes réglementaires verbatim, pas une
 * liste devinée. Ce script n'invente rien : il lit le parquet et sérialise les
 * codes distincts. Si le parquet n'existe pas, il ABORT (pas de dict fabriqué).
 *
 * Usage : npx tsx acquisition/src/_zones-dict-from-norms.ts --slug <slug> [--out work/gcp/<slug>.dict.json]
 */
import { writeFileSync } from "node:fs";

import { getBytes, s3Client, exists } from "./lib/s3.js";
import { readParquetRowsFromBuffer } from "./lib/parquet-read.js";
import { normsKey } from "./lib/zonage-norms.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const slug = arg("slug");
  if (!slug) throw new Error("required: --slug <slug>");
  const out = arg("out") ?? `work/gcp/${slug}.dict.json`;

  const s3 = s3Client();
  const key = normsKey(slug);
  if (!(await exists(s3, key))) {
    console.error(`[dict] ABORT: aucune grille de normes déposée pour ${slug} (${key})`);
    console.error(`[dict] → pas de dict autoritaire ⇒ ne PAS relaxer les codes numériques (anti-#74).`);
    process.exit(2);
  }
  const rows = (await readParquetRowsFromBuffer(await getBytes(s3, key))) as Array<Record<string, unknown>>;
  const codes = [...new Set(rows.map((r) => String(r["zone_code"] ?? "").trim()).filter(Boolean))].sort();
  if (!codes.length) {
    console.error(`[dict] ABORT: parquet présent mais 0 zone_code`);
    process.exit(2);
  }
  writeFileSync(out, JSON.stringify(codes, null, 0));
  const numeric = codes.filter((c) => /^\d{1,4}$/.test(c));
  console.log(`[dict] ${slug}: ${rows.length} lignes → ${codes.length} codes distincts → ${out}`);
  console.log(`[dict]   dont purement numériques: ${numeric.length}`);
  console.log(`[dict]   échantillon: ${codes.slice(0, 25).join(", ")}`);
  const reglement = [...new Set(rows.map((r) => String(r["_reglement"] ?? "")).filter(Boolean))];
  const src = [...new Set(rows.map((r) => String(r["_source_url"] ?? "")).filter(Boolean))];
  console.log(`[dict]   règlement: ${reglement.join(" | ") || "(non renseigné)"}`);
  console.log(`[dict]   source_url: ${src.slice(0, 2).join(" | ") || "(non renseignée)"}`);
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
