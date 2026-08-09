/**
 * _reglprov-fulltext-grep.ts — passe plein-texte ($0) sur les PDF déjà téléchargés
 * dans le scratchpad reglprov/. Pour chaque <slug>.pdf, extrait TOUT le texte
 * (pdftotext) et imprime les lignes portant un NUMÉRO DE BASE de règlement de
 * zonage verbatim (pattern « règlement (de zonage) numéro/no/n° <chiffres> »),
 * ainsi que les lignes propriétaire (nom de municipalité) et adoption/vigueur.
 *
 * But: capter un numéro de base présent au-delà de la fenêtre de 30 pages, ou en
 * pied/annexe. Anti-invention: on LIT, on ne déduit pas.
 *
 * Usage: npx tsx acquisition/src/_reglprov-fulltext-grep.ts [--slugs a,b]
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

const SCRATCH = "/home/antoinefa/.cache-tmp/claude-1000/-home-antoinefa-src-geo/22a5fa1f-c477-4022-8e52-66c681ff7df4/scratchpad/reglprov";

// Numéro de BASE verbatim: « règlement [de zonage] numéro/no/n°/# <chiffres...> »
const BASENUM_RE =
  /r[eè]glement(\s+de\s+zonage)?\s*(num[eé]ro|n[°ºo]s?\.?|no\.?|#)\s*[:.]?\s*([0-9][0-9A-Za-z().\-\/]{1,20})/i;
const ADOPT_RE = /(adopt[eé]\w*|entr[eé]e?\s+en\s+vigueur|en\s+vigueur\s+le)\b/i;

function arg(argv: string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

function fulltext(pdf: string): string {
  return execFileSync("pdftotext", ["-layout", "-enc", "UTF-8", pdf, "-"],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 180_000 });
}

function main(): void {
  const argv = process.argv.slice(2);
  const only = (arg(argv, "slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const files = readdirSync(SCRATCH).filter((f) => f.endsWith(".pdf"));
  for (const f of files) {
    const slug = f.replace(/\.pdf$/, "");
    if (only.length && !only.includes(slug)) continue;
    let txt = "";
    try { txt = fulltext(resolve(SCRATCH, f)); }
    catch (e) { console.log(`\n### ${slug}\nERR ${e instanceof Error ? e.message : String(e)}`); continue; }
    const pages = txt.split("\f");
    const nums: string[] = [];
    const adopts: string[] = [];
    pages.forEach((pg, i) => {
      pg.split("\n").forEach((ln) => {
        const t = ln.trim();
        if (t.length < 4) return;
        const m = t.match(BASENUM_RE);
        if (m) nums.push(`p${i + 1} «${t.slice(0, 140)}»`);
        else if (ADOPT_RE.test(t) && /\b(19|20)\d{2}\b/.test(t)) adopts.push(`p${i + 1} «${t.slice(0, 140)}»`);
      });
    });
    // dédup
    const uniq = (a: string[]) => [...new Set(a.map((s) => s.replace(/\s+/g, " ")))];
    console.log(`\n### ${slug} (pages=${pages.length})`);
    const un = uniq(nums).slice(0, 14);
    console.log(`NUM-BASE (${uniq(nums).length}):`);
    for (const n of un) console.log(`  ${n}`);
    const ua = uniq(adopts).slice(0, 6);
    if (ua.length) { console.log(`ADOPT/VIGUEUR:`); for (const a of ua) console.log(`  ${a}`); }
  }
}

main();
