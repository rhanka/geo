/**
 * Émet le dictionnaire de codes RÉGLEMENTAIRES d'une muni depuis la grille de normes
 * déjà déposée (`registry/qc-zonage-norms/qc-zonage-norms-<slug>.parquet`), au format
 * attendu par `--dict` (tableau JSON de codes).
 *
 * Motif (§7.5 de `docs/spec/zonage-georeferencement-gcp.md`) : certaines munis zonent en
 * codes PUREMENT NUMÉRIQUES (`200`, `204`, `305`…). Le gate anti-#74 les rejette par
 * défaut — indistinguables d'un OBJECTID séquentiel. La relaxation numérique n'est SÛRE
 * que derrière un dictionnaire AUTORITAIRE ; ce dictionnaire, quand la grille de normes
 * de la muni est déposée, existe déjà et n'a pas à être re-OCRisé.
 *
 * N'invente rien : les codes sortent verbatim du parquet déposé (colonne `zone_code`).
 *
 * Usage : npx tsx acquisition/src/_norms-dict-emit.ts --slug <slug> [--out work/dict/<slug>.json]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { s3Client, getBytes, exists } from "./lib/s3.js";
import { readParquetRowsFromBuffer } from "./lib/parquet-read.js";
import { normsKey } from "./lib/zonage-norms.js";

function arg(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const slug = (arg("slug") ?? "").trim();
  if (!slug) throw new Error("required: --slug <slug>");
  const out = arg("out") ?? `work/dict/${slug}.json`;

  const s3 = s3Client();
  const key = normsKey(slug);
  if (!(await exists(s3, key))) {
    throw new Error(`ABORT: aucune grille de normes déposée pour ${slug} (${key}) — pas de dict autoritaire`);
  }
  const buf = await getBytes(s3, key);
  const rows = await readParquetRowsFromBuffer(Buffer.from(buf));

  const codes = [
    ...new Set(
      rows
        .map((r: any) => r?.zone_code)
        .filter((c: unknown): c is string => typeof c === "string")
        .map((c: string) => c.trim())
        .filter(Boolean),
    ),
  ].sort();

  if (!codes.length) throw new Error(`ABORT: 0 zone_code dans ${key}`);

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(codes, null, 2));

  const numeric = codes.filter((c) => /^\d{1,4}$/.test(c));
  const lettered = codes.filter((c) => /[A-Za-z]/.test(c));
  console.log(`slug=${slug} rows=${rows.length} codes=${codes.length} → ${out}`);
  console.log(`  numériques purs : ${numeric.length}  |  lettrés : ${lettered.length}`);
  console.log(`  échantillon : ${codes.slice(0, 25).join(", ")}${codes.length > 25 ? " …" : ""}`);
}

main().catch((e) => {
  console.error(String(e?.message ?? e));
  process.exit(1);
});
