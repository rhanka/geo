/**
 * Construit le dict de codes de zone d'une grille « type × numéro de secteur ».
 *
 * Motif : certaines munis (labrecque, règl. 300-07) publient leur grille en tableaux
 * par TYPE de zone, où chaque colonne est un SECTEUR numéroté :
 *
 *     Numéro de secteur                    1      2      3
 *     Type de zone et usage dominant       Ra     Ra     Ra
 *
 * Le code de zone réel imprimé sur le plan est la CONCATÉNATION type+numéro (`Ra1`,
 * `Ra2`, `Fb10`) — cf. la légende du plan : « Ab = nom de la zone / 1 = numéro de la
 * zone ». Ce script lit la grille (source autoritaire INDÉPENDANTE du plan) et émet le
 * dict, pour que les lectures vision soient validées verbatim contre lui.
 *
 * N'invente rien : n'émet que des paires (type, numéro) réellement alignées dans une
 * page de la grille.
 *
 * Usage : npx tsx acquisition/src/_grille-secteur-dict.ts --pdf <grille.pdf> --out work/dict/<slug>.json
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

function arg(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const pdf = arg("pdf");
if (!pdf) throw new Error("required: --pdf <grille.pdf>");
const out = arg("out");

const text = execFileSync("pdftotext", ["-layout", "-enc", "UTF-8", pdf, "-"], {
  encoding: "utf8",
  maxBuffer: 256 * 1024 * 1024,
});

const SECTEUR_RE = /Num[ée]ro\s+de\s+secteur\s+(.+)/i;
const TYPE_RE = /Type\s+de\s+zone\s+et\s+usage\s+dominant\s+(.+)/i;

const codes = new Set<string>();
const perPage: string[] = [];

text.split("\f").forEach((page, i) => {
  const secLine = page.split(/\r?\n/).find((l) => SECTEUR_RE.test(l));
  const typLine = page.split(/\r?\n/).find((l) => TYPE_RE.test(l));
  if (!secLine || !typLine) return;

  // Les numéros de secteur sont écrits en LISTES et en PLAGES groupées par colonne,
  // pas un par colonne :
  //   « Numéro de secteur   2,4,5,6   1,3,7,8,9 et 10 »   → énumération
  //   « Numéro de secteur   1         2à6 »                → plage (2,3,4,5,6)
  // Les virgules et « et » ne sont que des séparateurs ; « à » dénote une plage
  // fermée, qu'on développe (la grille l'énonce, on ne l'invente pas).
  const secRaw = SECTEUR_RE.exec(secLine)?.[1] ?? "";
  const nums: string[] = [];
  const consumed = secRaw.replace(/(\d{1,3})\s*(?:à|a|-)\s*(\d{1,3})/gi, (_m, a: string, b: string) => {
    const lo = Number(a);
    const hi = Number(b);
    if (hi >= lo && hi - lo <= 60) for (let n = lo; n <= hi; n++) nums.push(String(n));
    return " ";
  });
  for (const m of consumed.matchAll(/\d{1,3}/g)) nums.push(m[0]);
  const typs = (TYPE_RE.exec(typLine)?.[1] ?? "")
    .trim()
    .split(/\s+/)
    .filter((t) => /^[A-Z][a-z]?$/.test(t));

  if (!nums.length || !typs.length) return;

  // Un tableau du chapitre 10 porte UN type de zone (répété par colonne d'usage).
  // Si la page mêle plusieurs types distincts, l'appariement numéro↔type est ambigu :
  // on s'abstient plutôt que de fabriquer un code.
  const distinctTypes = [...new Set(typs)];
  if (distinctTypes.length !== 1) {
    perPage.push(`p${i + 1}: SKIP (types multiples: ${distinctTypes.join("/")} — appariement ambigu)`);
    return;
  }
  const t = distinctTypes[0]!;
  const found: string[] = [];
  for (const n of [...new Set(nums)]) {
    const code = `${t}${n}`;
    codes.add(code);
    found.push(code);
  }
  if (found.length) perPage.push(`p${i + 1}: ${found.join(" ")}`);
});

const sorted = [...codes].sort((a, b) => {
  const ma = /^([A-Za-z]+)(\d+)$/.exec(a);
  const mb = /^([A-Za-z]+)(\d+)$/.exec(b);
  if (ma && mb && ma[1] !== mb[1]) return ma[1]!.localeCompare(mb[1]!);
  if (ma && mb) return Number(ma[2]) - Number(mb[2]);
  return a.localeCompare(b);
});

for (const l of perPage) console.log(l);
console.log(`\ncodes distincts : ${sorted.length}`);
console.log(sorted.join(" "));

if (out) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(sorted, null, 2));
  console.log(`\n→ ${out}`);
}
