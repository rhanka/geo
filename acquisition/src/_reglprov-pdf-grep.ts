/**
 * _reglprov-pdf-grep.ts — lane P0_1 (provenance règlement). READ-ONLY.
 *
 * Grep VERBATIM d'un PDF local, page par page, avec le n° de page.
 * Comble l'angle mort de `_reglement-date-scan.ts` (regex « règlement (numéro|no) X »
 * seulement) quand il faut TRANCHER LE PIÈGE DES DEUX NUMÉROS : le nom de fichier /
 * l'URL portent un numéro (souvent l'amendement ou la consolidation) que le corps ne
 * porte peut-être NULLE PART. Seule une recherche du jeton BRUT le prouve.
 *
 * Usage:
 *   npx tsx acquisition/src/_reglprov-pdf-grep.ts --pdf <path> --re "2022-228|228"
 *   npx tsx acquisition/src/_reglprov-pdf-grep.ts --pdf <path> --re "adopt" --max 40
 */
import { execFileSync } from "node:child_process";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const pdf = arg("pdf");
const reSrc = arg("re");
const max = Number(arg("max") ?? 60);
if (!pdf || !reSrc) {
  console.error('usage: --pdf <path> --re "<regex>" [--max N]');
  process.exit(2);
}
const re = new RegExp(reSrc, "i");

const info = execFileSync("pdfinfo", [pdf], { encoding: "utf8", maxBuffer: 1 << 24 });
const pages = Number(/Pages:\s+(\d+)/.exec(info)?.[1] ?? 0);
console.log(`=== ${pdf} pages=${pages} re=/${reSrc}/i ===`);

let hits = 0;
for (let p = 1; p <= pages && hits < max; p += 1) {
  let txt = "";
  try {
    txt = execFileSync("pdftotext", ["-f", String(p), "-l", String(p), "-layout", pdf, "-"], {
      encoding: "utf8",
      maxBuffer: 1 << 24,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    continue;
  }
  for (const line of txt.split(/\r?\n/)) {
    if (!re.test(line)) continue;
    hits += 1;
    console.log(`p${p}\t${line.trim().replace(/\s+/g, " ").slice(0, 200)}`);
    if (hits >= max) break;
  }
}
console.log(`# hits=${hits}${hits >= max ? " (tronqué)" : ""}`);
