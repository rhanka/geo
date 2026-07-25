/**
 * _plan-identity.ts — gate $0 « ce PDF est-il VRAIMENT le plan de zonage de CETTE
 * muni ? » avant d'y investir du chamfer/vision.
 *
 * Deux pieges mesures cette passe :
 *  - `lochaber-partie-ouest.pdf` porte un georef parfait… et c'est une CARTE
 *    ROUTIERE de la MRC Papineau (aucun code de zone) ;
 *  - un dossier de slug peut servir le document d'une AUTRE muni (homonyme).
 * Le seul verdict fiable est que la page NOMME sa municipalite ET s'annonce
 * comme un plan de zonage.
 *
 * Usage: npx tsx acquisition/src/_plan-identity.ts <pdf> [<pdf> ...] [--page N]
 */
import { execFileSync } from "node:child_process";

const argv = process.argv.slice(2);
const pi = argv.indexOf("--page");
const page = pi >= 0 ? argv[pi + 1]! : "1";
const pdfs = argv.filter((a) => !a.startsWith("--") && a !== page);

const ZONING = /(PLAN\s+DE\s+ZONAGE|CARTE\s+DE\s+ZONAGE|ZONAGE)/i;
const NOT_ZONING = /(CARTE\s+ROUTI[ÈE]RE|PLAN\s+D'?URBANISME|AFFECTATION\s+DU\s+SOL|SCH[ÉE]MA\s+D'?AM[ÉE]NAGEMENT|CARTE\s+DES\s+CONTRAINTES|ZONES?\s+INONDABLES?)/i;
const MUNI = /(MUNICIPALIT[ÉE]\s+D[EU'’]?\s*[A-ZÉÈÀÂÔÛÎa-zéèàâôûî'’\- ]{3,40}|VILLE\s+DE\s+[A-ZÉÈÀÂÔÛÎa-zéèàâôûî'’\- ]{3,40}|PAROISSE\s+D[EU'’]?\s*[A-Za-zÉÈÀÂÔÛÎéèàâôûî'’\- ]{3,40})/i;
const CODE = /\b[A-Z]{1,3}-\d{1,4}\b/g;

for (const pdf of pdfs) {
  let txt = "";
  try {
    txt = execFileSync("pdftotext", ["-f", page, "-l", page, "-layout", pdf, "-"], {
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
    });
  } catch (e) {
    console.log(`\n### ${pdf}\n   ERREUR pdftotext: ${(e as Error).message.slice(0, 120)}`);
    continue;
  }
  const flat = txt.replace(/\s+/g, " ");
  const codes = [...new Set(flat.match(CODE) ?? [])];
  console.log(`\n### ${pdf}  (p${page}, ${txt.length} car.)`);
  console.log(`   zonage?      ${ZONING.test(flat) ? "OUI — " + (flat.match(ZONING) ?? [""])[0] : "non"}`);
  const nz = flat.match(NOT_ZONING);
  console.log(`   contre-indic ${nz ? "⛔ " + nz[0] : "-"}`);
  const m = flat.match(MUNI);
  console.log(`   muni nommee  ${m ? m[0].slice(0, 60) : "(aucune)"}`);
  console.log(`   codes A-1    ${codes.length} distincts ${codes.slice(0, 12).join(", ")}`);
}
