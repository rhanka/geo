/**
 * _reglement-legend-probe.ts — trouve la LÉGENDE des préfixes de zone dans un
 * règlement de zonage (PDF local ou URL).
 *
 * La légende qui fait foi est la table « Abréviation / Fonction dominante » de la
 * section « division du territoire en zones » — PAS la matrice des usages permis
 * des grilles de spécifications.
 *
 * Extrait le texte (pdftotext -layout) puis affiche les lignes qui matchent le
 * motif, avec du contexte, pour lecture VERBATIM par l'agent (anti-invention).
 *
 * Usage:
 *   npx tsx acquisition/src/_reglement-legend-probe.ts --pdf ud/danville.pdf
 *   npx tsx acquisition/src/_reglement-legend-probe.ts --pdf x.pdf --find "RUR|MIX" --ctx 3
 *   npx tsx acquisition/src/_reglement-legend-probe.ts --url https://... --out ud/x.pdf
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_FIND =
  "division du territoire|classification des zones|types? de zones?|abr(é|e)viation|fonction dominante|vocation|appellation|codification des zones|identification des zones|nomenclature";

function arg(argv: string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

const argv = process.argv.slice(2);
const url = arg(argv, "url");
let pdf = arg(argv, "pdf");
const out = arg(argv, "out");
const find = arg(argv, "find") ?? DEFAULT_FIND;
const ctx = Number(arg(argv, "ctx") ?? "0");

if (url) {
  const dest = resolve(out ?? "downloaded.pdf");
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    console.error(`HTTP ${res.status} ${url}`);
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
  const head = buf.subarray(0, 5).toString("latin1");
  console.log(`downloaded ${dest} bytes=${buf.length} head=${JSON.stringify(head)}${head.startsWith("%PDF") ? "" : "  !! PAS UN PDF"}`);
  pdf = dest;
}

if (!pdf) {
  console.error("pass --pdf <file> | --url <url> --out <file>");
  process.exit(2);
}
const pdfPath = resolve(pdf);
if (!existsSync(pdfPath)) {
  console.error(`introuvable: ${pdfPath}`);
  process.exit(1);
}
const txtPath = pdfPath.replace(/\.pdf$/i, "") + ".txt";
if (!existsSync(txtPath)) execFileSync("pdftotext", ["-layout", pdfPath, txtPath]);

const lines = readFileSync(txtPath, "utf8").split("\n");
const re = new RegExp(find, "i");
let hits = 0;
for (const [i, line] of lines.entries()) {
  if (!re.test(line)) continue;
  hits++;
  if (hits > 60) {
    console.log("… (>60 hits, affine --find)");
    break;
  }
  if (ctx > 0) console.log("  ---");
  for (let j = Math.max(0, i - ctx); j <= Math.min(lines.length - 1, i + ctx); j++) {
    console.log(`${String(j + 1).padStart(5)}${j === i ? ":" : " "} ${lines[j]}`);
  }
}
console.log(`txt=${txtPath} lignes=${lines.length} hits=${hits}`);
