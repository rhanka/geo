/**
 * _reglement-scan-txt.ts — scanne les .txt (pdftotext) d'un dossier et imprime,
 * par slug, les lignes-CANDIDATES VERBATIM pour: numéro de règlement, mention
 * "règlement de zonage", entrée en vigueur / adoption (millésime), et le nom du
 * propriétaire (municipalité/ville). Sert à juger sans relire chaque grille.
 *
 * Usage: npx tsx src/_reglement-scan-txt.ts <txt_dir> [--slug s] [--glob p1-4]
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const NUM = /(r[èe]glement(\s+de\s+zonage)?\s*(num[ée]ro|n[o°º]\.?|#)\s*[:.]?\s*[\dA-Za-z][\d\-A-Za-z.\/]*)/i;
const ZON = /(zonage\s+(num[ée]ro|n[o°º]|#)\s*[:.]?\s*[\dA-Za-z][\d\-A-Za-z.\/]*)/i;
const ANNEXE = /(annexe[^\n]{0,40}r[èe]glement[^\n]{0,40}(num[ée]ro|n[o°º]|#)\s*[:.]?\s*[\dA-Za-z][\d\-A-Za-z.\/]*)/i;
const VIG = /(entr[ée]e?\s+en\s+vigueur|adopt[ée](?:\s+le)?|en\s+vigueur\s+le)\b[^\n]{0,60}/i;
const OWNER = /(municipalit[ée]|ville|paroisse|canton)\s+d[eu']?\s*[A-ZÀ-Ü][^\n]{0,50}/i;
const YEAR = /\b(19|20)\d{2}\b/;

function arg(argv: string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

function main(): void {
  const argv = process.argv.slice(2);
  const dir = argv[0];
  const only = arg(argv, "slug");
  const glob = arg(argv, "glob") ?? ".txt";
  const find = arg(argv, "find");
  const files = readdirSync(dir).filter((f) => f.endsWith(".txt") && f.includes(glob)).sort();
  if (find) {
    const re = new RegExp(find, "i");
    for (const f of files) {
      const slug = f.replace(/\.p\d+-\d+\.txt$/, "").replace(/\.full\.txt$/, "").replace(/\.txt$/, "");
      if (only && slug !== only) continue;
      const lines = readFileSync(resolve(dir, f), "utf8").split("\n");
      const hits: string[] = [];
      lines.forEach((ln, i) => {
        if (re.test(ln)) hits.push(`  L${i + 1}: ${ln.trim().replace(/\s{2,}/g, " ").slice(0, 200)}`);
      });
      if (hits.length) { console.log(`\n===== ${slug} (${hits.length}) =====`); hits.slice(0, 20).forEach((h) => console.log(h)); }
    }
    return;
  }
  for (const f of files) {
    const slug = f.replace(/\.p\d+-\d+\.txt$/, "").replace(/\.txt$/, "");
    if (only && slug !== only) continue;
    const lines = readFileSync(resolve(dir, f), "utf8").split("\n");
    const hitsNum = new Set<string>();
    const hitsVig = new Set<string>();
    const hitsOwner = new Set<string>();
    lines.forEach((ln) => {
      const t = ln.trim().replace(/\s{2,}/g, " ");
      if (!t) return;
      for (const re of [NUM, ZON, ANNEXE]) { const m = t.match(re); if (m) hitsNum.add(t.slice(0, 160)); }
      if (VIG.test(t) && YEAR.test(t)) hitsVig.add(t.slice(0, 160));
      if (OWNER.test(t) && hitsOwner.size < 3) hitsOwner.add(t.slice(0, 100));
    });
    console.log(`\n===== ${slug} =====`);
    console.log(`  OWNER: ${[...hitsOwner].join(" || ") || "(?)"}`);
    console.log(`  NUM(${hitsNum.size}):`);
    [...hitsNum].slice(0, 12).forEach((h) => console.log(`    · ${h}`));
    console.log(`  VIG/ADOPT(${hitsVig.size}):`);
    [...hitsVig].slice(0, 8).forEach((h) => console.log(`    · ${h}`));
  }
}

main();
