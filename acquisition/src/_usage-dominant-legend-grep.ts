/**
 * _usage-dominant-legend-grep.ts — helper $0 (lecture seule) pour la lane
 * usage_dominant. Extrait le texte natif d'un PDF de règlement déjà téléchargé
 * et imprime les lignes qui matchent un motif (regex, insensible casse) avec le
 * n° de page — pour LIRE VERBATIM la légende « Abréviation / Fonction dominante »
 * (« division du territoire en zones ») avant d'écrire un prefix_map. N'écrit
 * rien, ne fabrique rien: rend le texte tel que porté par le PDF.
 *
 * Prend les arguments en ARGV (pas en env) pour rester invocable via `npx tsx`
 * sans assignation shell (le hook anti-inline filtre le 1er token).
 *
 *   npx tsx acquisition/src/_usage-dominant-legend-grep.ts --pdf <path> --pattern 'Habitation|Récréation' [--from N --to M] [--context]
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const pdf = arg("pdf") ?? "";
const pattern = arg("pattern") ?? "Habitation|Commerce|Industrie|Agricole|Récréation|Conservation";
const from = Number(arg("from") ?? "1");
const context = process.argv.includes("--context");
if (!pdf || !existsSync(pdf)) {
  console.error(`required: --pdf <path existant> (reçu: ${pdf || "∅"})`);
  process.exit(2);
}

const info = spawnSync("pdfinfo", [pdf], { encoding: "utf8" });
if (info.error) {
  console.error(`pdfinfo indisponible: ${info.error.message}`);
  process.exit(3);
}
const pagesM = /Pages:\s+(\d+)/.exec(info.stdout ?? "");
const pages = pagesM ? Number(pagesM[1]) : 0;
const to = Number(arg("to") ?? String(pages));
const rx = new RegExp(pattern, "i");
let hits = 0;
for (let p = Math.max(1, from); p <= Math.min(pages, to); p++) {
  const t = spawnSync("pdftotext", ["-layout", "-f", String(p), "-l", String(p), pdf, "-"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const lines = (t.stdout ?? "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (rx.test(lines[i]!)) {
      const emit = context ? lines.slice(Math.max(0, i - 1), i + 2) : [lines[i]!];
      for (const ln of emit) {
        const trimmed = ln.replace(/\s+$/g, "");
        if (trimmed.trim()) console.log(`p${p}: ${trimmed.slice(0, 220)}`);
      }
      hits++;
      if (context) console.log("    ---");
      if (hits > 120) {
        console.log("... (>120 hits, stop)");
        process.exit(0);
      }
    }
  }
}
console.log(`\n[legend-grep] pdf=${pdf} pages=${pages} range=${from}-${to} hits=${hits} pattern=/${pattern}/i`);
