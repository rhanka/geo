/**
 * _reglement-date-scan.ts — lane PROVENANCE P0_1.
 *
 * Complète `_reglement-pdf-read.ts` (qui ne lit qu'une FENÊTRE de pages) en
 * balayant le PDF ENTIER pour deux besoins distincts:
 *   1) le NUMÉRO du règlement quand la page-titre est muette (grilles nues:
 *      l'en-tête d'une planche interne porte souvent «... DU RÈGLEMENT DE
 *      ZONAGE N° X»);
 *   2) le MILLÉSIME, qui ne doit JAMAIS être déduit du numéro
 *      ([[reglement-annee-du-numero-fausse]]) mais lu VERBATIM sur une clause
 *      d'adoption / d'entrée en vigueur.
 *
 * Sort le numéro de PAGE de chaque occurrence (alimente reglement_page_source)
 * en découpant la sortie pdftotext sur le saut de page (\f).
 *
 * Usage: npx tsx acquisition/src/_reglement-date-scan.ts --pdf <path> [--max N]
 */
import { execFileSync } from "node:child_process";

function arg(argv: string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

const NUM = /(r[èe]glement|by-?law)[^.\n]{0,40}?(?:n[°ouº]|num[ée]ro|no\.?|#)\s*:?\s*([0-9][0-9A-Za-z._\-\/]{1,20})/i;
const DATE =
  /(adopt|entr[ée]e?\s+en\s+vigueur|entr[ée]\s+en\s+vigueur|promulgation|sanctionn|fait\s+et\s+pass)/i;
const YEAR = /\b(19[5-9]\d|20[0-2]\d)\b/;

function main(): void {
  const argv = process.argv.slice(2);
  const pdf = arg(argv, "pdf");
  if (!pdf) { console.error("--pdf requis"); process.exit(1); }
  const max = Number(arg(argv, "max") ?? "40");

  let txt = "";
  try {
    txt = execFileSync("pdftotext", ["-layout", pdf, "-"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    });
  } catch (e) {
    console.log(`ERR pdftotext ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  const pages = txt.split("\f");
  if (!txt.replace(/[\s\f]/g, "")) {
    console.log(`NO-TEXT-LAYER pages=${pages.length} -> route vision (_pdf-page-png.ts + vision)`);
    return;
  }

  const nums: string[] = [];
  const dates: string[] = [];
  for (let p = 0; p < pages.length; p++) {
    for (const raw of pages[p].split("\n")) {
      const line = raw.replace(/\s+/g, " ").trim();
      if (!line) continue;
      if (nums.length < max && NUM.test(line)) nums.push(`p${p + 1}\t${line.slice(0, 160)}`);
      if (dates.length < max && DATE.test(line) && YEAR.test(line)) {
        dates.push(`p${p + 1}\t${line.slice(0, 160)}`);
      }
    }
  }
  console.log(`=== ${pdf} pages=${pages.length} ===`);
  console.log(`--- NUMÉRO (${nums.length}) ---`);
  for (const l of nums) console.log(l);
  console.log(`--- DATE VERBATIM (${dates.length}) ---`);
  for (const l of dates) console.log(l);
}

main();
