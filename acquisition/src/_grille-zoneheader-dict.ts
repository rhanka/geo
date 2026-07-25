/**
 * Construit le dict de codes de zone d'une grille « une page par zone ».
 *
 * Motif : beaucoup de munis publient leur ANNEXE « grille des spécifications » comme un
 * PDF FRÈRE du corps du règlement, à raison d'UNE PAGE PAR ZONE, dont l'en-tête porte le
 * code réel :
 *
 *     GRILLE DES SPÉCIFICATIONS                          Zone 100
 *       Annexe 2 du Règlement de zonage          USAGE PRÉDOMINANT: C
 *
 * Le code de zone réel est celui de l'EN-TÊTE (`100`). Piège écarté (cf. mémoire
 * `normes-grille-pdf-frere`) : les `R1`, `CS2`, `I1`, `P1`, `A1`, `EX1` du corps de la
 * page sont des CLASSES D'USAGES, jamais des codes de zone — ce script ne lit QUE
 * l'en-tête, jamais le corps.
 *
 * Source autoritaire INDÉPENDANTE du plan : c'est ce qui rend le gate `--dict` non
 * tautologique (on ne valide pas le plan par lui-même) — §7.5 de
 * `docs/spec/zonage-georeferencement-gcp.md`.
 *
 * N'invente rien : n'émet qu'un code réellement imprimé dans un en-tête de page.
 *
 * Variante `--code-below` : certains gabarits (Annexe « grilles combinées ») impriment
 * l'étiquette et le code sur DEUX lignes, le code aligné à droite sous l'étiquette :
 *
 *     GRILLE DES SPÉCIFICATIONS                                    ZONE
 *           Règlement de zonage                                    P1-26
 *
 * Le code est alors le DERNIER token de la ligne qui suit celle de l'étiquette.
 *
 * Usage : npx tsx acquisition/src/_grille-zoneheader-dict.ts --pdf <grille.pdf> \
 *           [--out work/dict/<slug>.json] [--label "Zone"] [--code-below]
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
const label = arg("label") ?? "Zone";
const codeBelow = process.argv.includes("--code-below");

const text = execFileSync("pdftotext", ["-layout", "-enc", "UTF-8", pdf, "-"], {
  encoding: "utf8",
  maxBuffer: 256 * 1024 * 1024,
});

// En-tête : « <label> <code> » sur les premières lignes de la page. Le code est pris
// verbatim ; on accepte le numérique pur (100) et le lettré (H-3, Ra1).
const HEADER_RE = new RegExp(`\\b${label}\\s+([A-Za-z]{0,3}-?\\d{1,4}[A-Za-z]?)\\b`);
const HEADER_LINES = 6;
// Forme admise pour `--code-below` : le token doit RESSEMBLER à un code de zone.
// Couvre le numérique pur (100), le lettré (H-3, Ra1) et le lettré-subdivisé (P1-26).
const CODE_BELOW_RE = /^[A-Za-z]{0,3}\d{0,4}-?\d{1,4}[A-Za-z]?$/;

const pages = text.split("\f");
const found: { page: number; code: string }[] = [];

pages.forEach((p, i) => {
  const lines = p.split(/\r?\n/).filter((l) => l.trim());
  if (codeBelow) {
    // Le code est le DERNIER token de la ligne SUIVANT celle qui porte l'étiquette.
    const li = lines.slice(0, HEADER_LINES).findIndex((l) => new RegExp(`\\b${label}\\b`).test(l));
    if (li < 0) return;
    const next = lines[li + 1];
    if (!next) return;
    const tok = next.trim().split(/\s+/).pop() ?? "";
    if (CODE_BELOW_RE.test(tok)) found.push({ page: i + 1, code: tok });
    return;
  }
  const head = lines.slice(0, HEADER_LINES).join("\n");
  const m = head.match(HEADER_RE);
  if (m) found.push({ page: i + 1, code: m[1].trim() });
});

const codes = [...new Set(found.map((f) => f.code))].sort((a, b) =>
  a.localeCompare(b, "fr", { numeric: true }),
);

if (!codes.length) {
  console.error(`ABORT: 0 en-tête « ${label} <code> » dans ${pdf} — mauvais doc ou autre gabarit`);
  process.exit(1);
}

const numeric = codes.filter((c) => /^\d{1,4}$/.test(c));
const lettered = codes.filter((c) => /[A-Za-z]/.test(c));

console.log(`pdf=${pdf} pages=${pages.length} en-têtes=${found.length} codes=${codes.length}`);
console.log(`  numériques purs : ${numeric.length}  |  lettrés : ${lettered.length}`);
console.log(`  échantillon : ${codes.slice(0, 30).join(", ")}${codes.length > 30 ? " …" : ""}`);

// Garde-fou §7.5 : une suite contiguë 1..N est indistinguable d'un OBJECTID.
if (numeric.length === codes.length && codes.length > 1) {
  const nums = numeric.map(Number).sort((a, b) => a - b);
  const contiguous = nums[0] === 1 && nums.every((n, i) => n === i + 1);
  if (contiguous) {
    console.error(`ABORT: dict = suite contiguë 1..${nums.length} — indistinguable d'un OBJECTID`);
    process.exit(1);
  }
}

if (out) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(codes, null, 2));
  console.log(`  → ${out}`);
}
