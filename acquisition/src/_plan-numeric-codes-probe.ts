/**
 * Sonde $0 : quels codes de zone un PLAN imprime-t-il réellement, et le dictionnaire
 * réglementaire les couvre-t-il ?
 *
 * Motif (§7.5) : la relaxation numérique n'est SÛRE que si l'ensemble des codes extraits
 * recouvre fortement un dict autoritaire. Avant de lancer un recalage de ~30-60 min sur
 * un plan tout-numérique, cette sonde mesure le recouvrement à coût nul et dit si le
 * dict disponible est SUFFISANT ou PARTIEL (ex. grille de normes n'ayant capté qu'une
 * série alors que le plan en porte plusieurs).
 *
 * Normalise le dict : « Zone 101 » ↔ « 101 » (forme grille vs forme plan).
 *
 * Usage : npx tsx acquisition/src/_plan-numeric-codes-probe.ts --pdf <path> [--page N] [--dict <codes.json>]
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

function arg(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const pdf = arg("pdf");
if (!pdf || !existsSync(pdf)) throw new Error("required: --pdf <path existant>");
const page = arg("page");
const dictPath = arg("dict");

const args = ["-layout", "-enc", "UTF-8"];
if (page) args.push("-f", page, "-l", page);
args.push(pdf, "-");

const text = execFileSync("pdftotext", args, {
  encoding: "utf8",
  maxBuffer: 256 * 1024 * 1024,
});

// Les étiquettes de zone d'un plan : nombres à 3-4 chiffres, ou codes lettrés.
const tokens = text.split(/\s+/).map((t) => t.replace(/[^\w-]/g, "")).filter(Boolean);
const numeric = new Map<string, number>();
const lettered = new Map<string, number>();
for (const t of tokens) {
  if (/^\d{3,4}$/.test(t)) numeric.set(t, (numeric.get(t) ?? 0) + 1);
  else if (/^[A-Za-z]{1,3}-?\d{1,3}$/.test(t)) lettered.set(t, (lettered.get(t) ?? 0) + 1);
}

console.log(`PDF : ${pdf}${page ? ` (page ${page})` : " (toutes pages)"}`);
console.log(`  tokens numériques 3-4 chiffres distincts : ${numeric.size}  (occurrences ${[...numeric.values()].reduce((a, b) => a + b, 0)})`);
console.log(`  tokens lettrés distincts                 : ${lettered.size}`);

const nums = [...numeric.keys()].sort();
console.log(`  numériques : ${nums.slice(0, 60).join(", ")}${nums.length > 60 ? " …" : ""}`);
if (lettered.size) {
  console.log(`  lettrés    : ${[...lettered.keys()].sort().slice(0, 40).join(", ")}`);
}

// Répartition par centaine — révèle les séries (100/200/300…) qu'un dict partiel raterait.
const buckets = new Map<string, number>();
for (const n of nums) {
  const b = `${n.length === 3 ? n[0] : n.slice(0, 2)}xx`;
  buckets.set(b, (buckets.get(b) ?? 0) + 1);
}
console.log(`  séries     : ${[...buckets.entries()].sort().map(([k, v]) => `${k}=${v}`).join(" · ")}`);

if (dictPath && existsSync(dictPath)) {
  const raw: string[] = JSON.parse(readFileSync(dictPath, "utf8"));
  // Forme grille « Zone 101 » → forme plan « 101 ».
  const norm = (c: string) => c.replace(/^zone\s+/i, "").trim();
  const dict = new Set(raw.map(norm));
  const dictNumeric = [...dict].filter((c) => /^\d{1,4}$/.test(c));
  const hit = nums.filter((n) => dict.has(n));
  const miss = nums.filter((n) => !dict.has(n));
  const pct = nums.length ? (100 * hit.length) / nums.length : 0;
  console.log(`\nDICT : ${dictPath} — ${raw.length} codes (dont ${dictNumeric.length} numériques après normalisation)`);
  console.log(`  recouvrement plan∩dict : ${hit.length}/${nums.length} = ${pct.toFixed(1)} %`);
  console.log(`  couverts   : ${hit.slice(0, 40).join(", ") || "(aucun)"}`);
  console.log(`  NON couverts : ${miss.slice(0, 40).join(", ") || "(aucun)"}${miss.length > 40 ? ` … (+${miss.length - 40})` : ""}`);
  console.log(
    `\nVERDICT : ${pct >= 80 ? "dict SUFFISANT → §7.5 applicable (--allow-numeric-codes --dict)" : "dict PARTIEL → §7.5 NON applicable en l'état (le dict ne couvre pas les séries du plan)"}`,
  );
}
