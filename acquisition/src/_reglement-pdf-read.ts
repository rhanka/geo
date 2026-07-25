/**
 * _reglement-pdf-read.ts — lane P0_1 (provenance règlement).
 *
 * Sonde READ-ONLY, $0 (poppler natif `pdftotext`, aucun OCR). Lit la page-titre
 * d'un PDF à un chemin ARBITRAIRE (ex. un corps fraîchement récupéré via WebFetch
 * et sauvegardé hors du corpus). Complète `_reglement-corps-read.ts` qui, lui, ne
 * lit que les PDF déjà déposés sous work/zonage-norms/<slug>/.
 *
 * ANTI-INVENTION: n'extrait rien, ne décide rien, n'écrit rien. L'opérateur relève
 * le numéro officiel VERBATIM (le nom de fichier ne fait pas foi).
 *
 * Usage:
 *   npx tsx acquisition/src/_reglement-pdf-read.ts --pdf /abs/path.pdf --pages 6
 */
import { execFileSync } from "node:child_process";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const NUM_RE =
  /(r[eè]glement[s]?\s+(de\s+)?(zonage|d[eu]\s+zonage)|zonage\s+(num[eé]ro|n[°ºo]))|r[eè]glement\s*(num[eé]ro|n[°ºo]|#)\s*[:.]?\s*[0-9]|porte\s+(le\s+)?(num[eé]ro|titre)|amend/i;
const DATE_RE =
  /(entr[eé]e?\s+en\s+vigueur|en\s+vigueur\s+le|adopt[eé]|adoption|codification\s+administrative|consolid|attendu)/i;

function main(): void {
  const pdf = arg("pdf");
  const from = Number(arg("from", "1"));
  const pages = Number(arg("pages", "6"));
  if (!pdf) {
    console.error("usage: --pdf <path> [--from N] [--pages N]");
    process.exit(2);
  }
  const txt = execFileSync("pdftotext", ["-f", String(from), "-l", String(pages), "-layout", pdf, "-"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const lines = txt.split("\n");
  console.log(`=== ${pdf} (p${from}-${pages}) — ${lines.length} lignes ===\n`);
  console.log(txt.slice(0, 6000));
  console.log("\n=== LIGNES CANDIDATES (numéro/date) ===");
  lines.forEach((ln, i) => {
    const t = ln.trim();
    if (t && (NUM_RE.test(t) || DATE_RE.test(t))) console.log(`L${i}: ${t}`);
  });
}

main();
