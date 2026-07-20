/**
 * _probe-vdq-reglement-col.ts — lane PROVENANCE P0_1, cas Ville de Québec.
 *
 * Question tranchée: la Ville de Québec a-t-elle UN numéro de règlement de zonage
 * (foldable per-muni par `fold-reglement-to-zonage.ts`, qui copie la MÊME valeur
 * sur tous les polygones) ou UN NUMÉRO PAR ZONE ?
 *
 * La grille officielle XLSX open data ([[vdq-xlsx-opendata-lane]]) porte une
 * colonne « Règlement » (`R.V.Q. …`). Cette sonde la lit VERBATIM et compte les
 * valeurs distinctes. Si >1, un stamp per-muni serait une provenance FAUSSE sur
 * toutes les zones sauf une — donc null curé + escalade « fold par zone ».
 *
 * $0, aucune dépendance (lecteur XLSX maison, cf. [[no-python-in-geo]]).
 *
 * Usage: npx tsx acquisition/src/_probe-vdq-reglement-col.ts [--xlsx <path>]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import { readWorkbook } from "./lib/xlsx.js";

const URL_XLSX = "https://carte.ville.quebec.qc.ca/DonneesOuvertes/vdq-zonage-grille.xlsx";

function arg(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  let path = arg("xlsx");
  if (!path) {
    path = resolve(process.env.TMPDIR ?? "/tmp", "vdq-zonage-grille.xlsx");
    if (!existsSync(path)) {
      const r = await fetch(URL_XLSX);
      if (!r.ok) { console.log(`FAIL HTTP ${r.status} ${URL_XLSX}`); return; }
      writeFileSync(path, Buffer.from(await r.arrayBuffer()));
    }
  }
  const wb = readWorkbook(readFileSync(path));
  const rows = wb.sheets[wb.sheetNames[0]] ?? [];
  // en-têtes: on cherche la colonne dont un en-tête contient « Règlement »
  let col = -1;
  let headerRow = -1;
  for (let r = 0; r < Math.min(rows.length, 8) && col < 0; r++) {
    const row = rows[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      if (/r[èe]glement/i.test(String(row[c] ?? ""))) { col = c; headerRow = r; break; }
    }
  }
  if (col < 0) { console.log("COLONNE-REGLEMENT-ABSENTE"); return; }
  console.log(`colonne=${col} (en-tête ligne ${headerRow + 1}: "${rows[headerRow]?.[col]}")`);

  const counts = new Map<string, number>();
  let filled = 0;
  let total = 0;
  for (let r = headerRow + 1; r < rows.length; r++) {
    const v = String(rows[r]?.[col] ?? "").trim();
    if (!rows[r] || rows[r].every((x) => !String(x ?? "").trim())) continue;
    total++;
    if (!v) continue;
    filled++;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`lignes=${total} renseignées=${filled} DISTINCTS=${counts.size}`);
  console.log("--- top 10 (valeur VERBATIM \\t nb de zones) ---");
  for (const [v, n] of sorted.slice(0, 10)) console.log(`${v}\t${n}`);
  console.log(
    counts.size > 1
      ? `VERDICT: ${counts.size} règlements DISTINCTS => stamp per-muni INTERDIT (provenance fausse sur ${filled - (sorted[0]?.[1] ?? 0)} zones).`
      : "VERDICT: numéro unique => foldable per-muni.",
  );
}

main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
