/**
 * Sonde le RECOUVREVENT entre les jetons texte d'un plan PDF et le dictionnaire
 * de codes réglementaires d'une muni — pour trancher, AVANT tout build, entre :
 *   - lane `--labels text`  (les codes de zone sont des mots sélectionnables) ;
 *   - lane `--labels claude` (codes en glyphes → 0 code lisible en texte).
 *
 * N'invente rien : compte des occurrences verbatim. Aucun dépôt.
 *
 * Usage : npx tsx acquisition/src/_zones-dict-overlap-probe.ts --pdf <path> --dict <codes.json> [--page N]
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const pdf = arg("pdf");
const dictPath = arg("dict");
const page = arg("page");
if (!pdf || !dictPath) {
  console.error("usage: --pdf <path> --dict <codes.json> [--page N]");
  process.exit(2);
}

const dictRaw: string[] = JSON.parse(readFileSync(dictPath, "utf8"));
// Normalisation fidèle : « ZONE 105 » porte le code 105 ; on garde la trace.
const dict = new Set<string>();
for (const raw of dictRaw) {
  const t = String(raw).trim();
  dict.add(t);
  const m = /^ZONE\s+(\d{1,4})$/i.exec(t);
  if (m) dict.add(m[1]!);
}

const pageArgs = page ? ["-f", page, "-l", page] : [];
const text = execFileSync("pdftotext", [...pageArgs, "-layout", pdf, "-"], {
  encoding: "utf8",
  maxBuffer: 512 * 1024 * 1024,
});

const tokens = text.split(/[^A-Za-z0-9.-]+/).filter(Boolean);
const freq = new Map<string, number>();
for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);

const hits = [...dict].filter((c) => freq.has(c)).sort();
// Le complément est ce qui compte pour l'anti-invention : la géométrie servie est un
// VORONOÏ des labels lus — un code réglementaire ABSENT du texte du plan est soit une
// zone qui n'existe pas au plan, soit un label que la lane texte ne voit pas (glyphe,
// trop petit). Dans le 2e cas, ses lots partent SILENCIEUSEMENT au voisin.
const missing = dictRaw.filter((c) => !freq.has(String(c).trim())).sort();
const numericTokens = [...freq.keys()].filter((t) => /^\d{1,4}$/.test(t));
const letteredTokens = [...freq.keys()].filter((t) => /^[A-Za-z]{1,4}[ .-]?\d+$/.test(t));

console.log(`pdf=${pdf}${page ? ` page=${page}` : ""}`);
console.log(`texte: ${text.length} chars · ${tokens.length} jetons · ${freq.size} distincts`);
console.log(`dict: ${dictRaw.length} entrées (+${dict.size - dictRaw.length} formes normalisées)`);
console.log(`\nCODES DU DICT PRÉSENTS VERBATIM DANS LE TEXTE : ${hits.length}/${dictRaw.length}`);
console.log(`  ${JSON.stringify(hits.slice(0, 60))}`);
console.log(`\nCODES DU DICT ABSENTS DU TEXTE : ${missing.length}/${dictRaw.length}`);
console.log(`  ${JSON.stringify(missing)}`);

console.log(`\njetons purement numériques (1-4 chiffres) distincts : ${numericTokens.length}`);
console.log(`jetons lettrés (A-1) distincts : ${letteredTokens.length}`);
console.log(`  ${JSON.stringify(letteredTokens.slice(0, 40))}`);
