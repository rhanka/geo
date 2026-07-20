/**
 * Scan VERBATIM d'un PDF réglementaire pour des codes de zone candidats.
 *
 * Sert à falsifier/compléter un dictionnaire : il n'invente rien, il compte les
 * occurrences EXACTES d'un motif `LETTRES-CHIFFRES` dans la couche texte du PDF,
 * et imprime le contexte de la première occurrence de chaque code demandé
 * (--probe) pour que l'agent LISE la preuve au lieu de la supposer.
 *
 * Usage :
 *   npx tsx acquisition/src/_zones-dict-verbatim-scan.ts --pdf <file> \
 *     [--probe FC-8,FC-9] [--min-count 1] [--first-page N] [--last-page N]
 */
import { execFileSync } from "node:child_process";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const pdf = arg("pdf");
if (!pdf) throw new Error("required: --pdf <file>");
const probe = (arg("probe") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const minCount = Number(arg("min-count", "1"));
const first = arg("first-page");
const last = arg("last-page");

const pdfArgs: string[] = [];
if (first) pdfArgs.push("-f", first);
if (last) pdfArgs.push("-l", last);
pdfArgs.push(pdf, "-");

const text = execFileSync("pdftotext", pdfArgs, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });

// Deux familles de codes réels rencontrées : LETTRES-CHIFFRES (`RR-12`) et
// CHIFFRES-LETTRES (`11-AF`, la forme « numéro de zone + vocation »).
const PATTERNS = [/\b([A-Z]{1,5})-(\d{1,3})\b/g, /\b(\d{1,3})-([A-Z]{1,3})\b/g];
const counts = new Map<string, number>();
for (const RE of PATTERNS) {
  let m: RegExpExecArray | null;
  while ((m = RE.exec(text))) {
    const code = `${m[1]}-${m[2]}`;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
}
const rows = [...counts.entries()].filter(([, n]) => n >= minCount).sort((a, b) => (a[0] < b[0] ? -1 : 1));
console.log(`# ${rows.length} codes distincts (min-count=${minCount}) dans ${pdf}`);
console.log(rows.map(([c, n]) => `${c}(${n})`).join(" "));

for (const p of probe) {
  const idx = text.indexOf(p);
  if (idx < 0) {
    console.log(`\n## ${p} : ABSENT de la couche texte`);
    continue;
  }
  console.log(`\n## ${p} : ${counts.get(p) ?? 0} occurrence(s) — contexte :`);
  console.log(text.slice(Math.max(0, idx - 220), idx + 220).replace(/\s+/g, " "));
}
