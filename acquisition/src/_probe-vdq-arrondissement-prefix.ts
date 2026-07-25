/**
 * _probe-vdq-arrondissement-prefix.ts — lane PROVENANCE P0_1, cas Ville de Québec.
 *
 * CONTEXTE. `_probe-vdq-reglement-col.ts` a mesuré que la Ville de Québec n'a PAS
 * un numéro de règlement unique (408 valeurs distinctes dans « Dernier règlement
 * ayant modifié la zone ») => stamp per-muni INTERDIT. Mais ce verdict « null
 * structurel » confond DEUX choses : la Ville n'a pas UN règlement, elle en a UN
 * PAR ARRONDISSEMENT (« Règlement de l'Arrondissement X sur l'urbanisme »,
 * R.C.A.NV.Q. NNN, dont l'Annexe II EST la grille de spécifications servie).
 *
 * QUESTION TRANCHÉE ICI. Peut-on rattacher chaque ZONE à son ARRONDISSEMENT à
 * partir du seul `zone_code` servi (ex. « 21703Mc ») ? L'hypothèse « le 1er
 * chiffre du code de zone = le numéro d'arrondissement » est une DÉDUCTION
 * ([[zone-prefix-letter-inference-trap]]) tant qu'on ne l'a pas MESURÉE.
 *
 * MESURE. La colonne « Dernier règlement ayant modifié la zone » porte, pour une
 * partie des zones, un numéro d'arrondissement EXPLICITE : « R.C.A.<N>V.Q. ... ».
 * On croise ce N avec le 1er chiffre du code de zone de la MÊME ligne. Si la
 * concordance est totale sur des centaines de lignes, le rattachement zone ->
 * arrondissement est un FAIT MESURÉ, pas une inférence. Les « R.V.Q. ... »
 * (règlements de la Ville, non préfixés par arrondissement) sont hors témoin et
 * comptés à part : ils ne peuvent ni confirmer ni infirmer.
 *
 * Ce script NE STAMPE RIEN. Il ne fait que rendre le verdict de rattachement.
 *
 * $0, aucune dépendance (lecteur XLSX maison, cf. [[no-python-in-geo]]).
 *
 * Usage: npx tsx acquisition/src/_probe-vdq-arrondissement-prefix.ts [--xlsx <path>]
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

  // 1) repérer la ligne d'en-tête + les 2 colonnes utiles
  let headerRow = -1;
  let colRegl = -1;
  let colZone = -1;
  for (let r = 0; r < Math.min(rows.length, 8) && headerRow < 0; r++) {
    const row = rows[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      if (/r[èe]glement/i.test(String(row[c] ?? ""))) { colRegl = c; headerRow = r; }
    }
  }
  if (headerRow < 0) { console.log("COLONNE-REGLEMENT-ABSENTE"); return; }
  const hdr = rows[headerRow] ?? [];
  console.log("--- en-têtes VERBATIM ---");
  for (let c = 0; c < hdr.length; c++) console.log(`  [${c}] ${JSON.stringify(String(hdr[c] ?? ""))}`);
  for (let c = 0; c < hdr.length; c++) {
    if (/zone/i.test(String(hdr[c] ?? "")) && c !== colRegl) { colZone = c; break; }
  }
  if (colZone < 0) { console.log("COLONNE-ZONE-ABSENTE"); return; }
  console.log(`\ncolRegl=${colRegl} colZone=${colZone}`);

  // 2) croiser N de « R.C.A.<N>V.Q. » avec le 1er chiffre du code de zone
  let witness = 0;
  let agree = 0;
  const mismatches: string[] = [];
  const byArr = new Map<string, Set<string>>();
  let rvqOnly = 0;
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((x) => !String(x ?? "").trim())) continue;
    const regl = String(row[colRegl] ?? "").trim();
    const zone = String(row[colZone] ?? "").trim();
    if (!regl || !zone) continue;
    const m = /^R\.C\.A\.(\d+)V\.Q\./i.exec(regl);
    const firstDigit = /^(\d)/.exec(zone)?.[1];
    if (!m) { if (/^R\.V\.Q\./i.test(regl)) rvqOnly++; continue; }
    if (!firstDigit) continue;
    witness++;
    if (m[1] === firstDigit) agree++;
    else if (mismatches.length < 12) mismatches.push(`zone=${zone} regl=${regl}`);
    const set = byArr.get(firstDigit) ?? new Set<string>();
    set.add(regl);
    byArr.set(firstDigit, set);
  }

  console.log(`\n--- croisement arrondissement (R.C.A.<N>V.Q.) x 1er chiffre du code de zone ---`);
  console.log(`témoins (lignes à règlement d'ARRONDISSEMENT explicite) = ${witness}`);
  console.log(`concordants = ${agree}   discordants = ${witness - agree}`);
  console.log(`hors témoin (« R.V.Q. … », non préfixés par arrondissement) = ${rvqOnly}`);
  if (mismatches.length) {
    console.log("--- exemples DISCORDANTS ---");
    for (const s of mismatches) console.log(`  ${s}`);
  }
  console.log("--- règlements d'arrondissement vus, par 1er chiffre de zone ---");
  for (const k of [...byArr.keys()].sort()) {
    const set = byArr.get(k)!;
    console.log(`  chiffre ${k}: ${set.size} règl. distincts, ex. ${[...set].slice(0, 3).join(" | ")}`);
  }
  console.log(
    witness > 0 && agree === witness
      ? `\nVERDICT: rattachement zone->arrondissement MESURÉ (${agree}/${witness}, 0 discordant) => le 1er chiffre du code de zone EST le numéro d'arrondissement.`
      : `\nVERDICT: rattachement NON établi (${agree}/${witness}) => ne PAS folder par préfixe.`,
  );
}

main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
