/**
 * norms-codes-dump.ts — extrait la LISTE des codes-zone d'une grille de normes
 * déjà déposée (registry/qc-zonage-norms/qc-zonage-norms-<slug>.parquet), pour
 * pouvoir vérifier la JOINTURE zone_code(polygones) ↔ grille(normes) — le gate
 * anti-invention de zonage-opendata-deposit.ts (--norms-codes).
 *
 * Lit le parquet depuis S3 (hyparquet), auto-détecte la colonne de code-zone
 * (--code-col pour forcer), imprime les colonnes + un échantillon, et écrit un
 * JSON array des codes distincts (--out). Lecture seule ; aucun secret loggé.
 *
 * USAGE :
 *   npx tsx src/norms-codes-dump.ts --slug repentigny --out <codes.json>
 *   options : --code-col <nom> --key <s3key explicite>
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parquetReadObjects } from "hyparquet";
import { compressors } from "hyparquet-compressors";

import { s3Client, getBytes } from "./lib/s3.js";

const HERE = dirname(fileURLToPath(import.meta.url));

// Noms plausibles de la colonne code-zone dans une grille de normes.
const CODE_COL_PATTERNS = [
  /^zone_?code$/i, /^numero_?zone$/i, /^num_?zone$/i, /^no_?zone$/i,
  /^code_?zone$/i, /^zonage$/i, /^zone$/i, /^numerozone$/i, /^grille$/i,
];

function parseArgs(argv: string[]): { slug: string; codeCol?: string; key?: string; outFile?: string } {
  const get = (k: string): string | undefined => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  return {
    slug: (get("slug") ?? "").trim(),
    ...(get("code-col") ? { codeCol: get("code-col")!.trim() } : {}),
    ...(get("key") ? { key: get("key")!.trim() } : {}),
    ...(get("out") ? { outFile: get("out")!.trim() } : {}),
  };
}

function pickCodeCol(cols: string[]): string | null {
  for (const p of CODE_COL_PATTERNS) { const hit = cols.find((c) => p.test(c)); if (hit) return hit; }
  // Repli : première colonne dont le nom évoque une zone.
  return cols.find((c) => /zone/i.test(c)) ?? null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.slug && !args.key) { console.error("usage: --slug <slug> [--code-col <nom>] [--key <s3key>] [--out <codes.json>]"); process.exit(2); }
  const key = args.key ?? `registry/qc-zonage-norms/qc-zonage-norms-${args.slug}.parquet`;

  const s3 = s3Client();
  const buf = await getBytes(s3, key);
  // Un ArrayBuffer satisfait déjà l'interface AsyncBuffer de hyparquet
  // ({ byteLength, slice }), pas besoin d'un helper de fabrication.
  const file = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const rows = (await parquetReadObjects({ file, compressors })) as Array<Record<string, unknown>>;
  console.error(`[norms] key=${key} rows=${rows.length}`);
  if (rows.length === 0) { console.error("[norms] parquet vide"); process.exit(1); }

  const cols = Object.keys(rows[0]!);
  console.error(`[norms] colonnes: ${JSON.stringify(cols)}`);
  console.error(`[norms] échantillon ligne[0]: ${JSON.stringify(rows[0]).slice(0, 400)}`);

  const codeCol = args.codeCol ?? pickCodeCol(cols);
  if (!codeCol) { console.error(`[norms] AUCUNE colonne code-zone détectée (colonnes=${JSON.stringify(cols)}) — passe --code-col`); process.exit(1); }
  console.error(`[norms] colonne code-zone = '${codeCol}'`);

  const codes = new Set<string>();
  for (const r of rows) { const v = r[codeCol]; if (v === null || v === undefined) continue; const s = String(v).trim(); if (s) codes.add(s); }
  const list = [...codes].sort();
  console.error(`[norms] codes distincts=${list.length} | échantillon=${JSON.stringify(list.slice(0, 15))}`);

  const out = args.outFile ?? resolve(HERE, `../../work/zonage-norms/${args.slug}-norms-codes.json`);
  writeFileSync(out, JSON.stringify(list, null, 0) + "\n");
  console.error(`[norms] écrit ${list.length} codes → ${out}`);
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
