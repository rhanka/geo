/**
 * _usage-dom-legend — $0 helper (lane usage_dominant). Télécharge un règlement de
 * zonage (PDF) UNE fois vers le scratchpad (nom stable = --name), extrait le texte
 * verbatim via `pdftotext -layout` (aucune OCR, aucune invention), et affiche soit
 * une fenêtre de pages (--pages), soit les lignes matchant des mots-clés de légende
 * (--grep "a|b|c") avec ±3 lignes de contexte. Sert à localiser l'article
 * « division du territoire / classification des zones / vocations principales /
 * abréviation-fonction dominante » AVANT d'écrire le map préfixe→catégorie.
 *
 *   npx tsx acquisition/src/_usage-dom-legend.ts --url https://... --name saint-x --grep "vocation|dominant|abréviation|classification"
 *   npx tsx acquisition/src/_usage-dom-legend.ts --name saint-x --pages 15-20
 */
import { execFileSync, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const SCRATCH = "/home/antoinefa/.cache-tmp/claude-1000/-home-antoinefa-src-geo/0a14c29e-d681-4603-a98a-52dba2954bc5/scratchpad";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
  const url = arg("url");
  const name = (arg("name") ?? "usage-dom").replace(/[^a-z0-9._-]/gi, "_");
  const file = resolve(SCRATCH, `${name}.pdf`);
  if (url && (!existsSync(file) || process.argv.includes("--force"))) {
    execSync(`curl -skL -A "Mozilla/5.0" ${JSON.stringify(url)} -o ${JSON.stringify(file)}`, { stdio: "ignore" });
  }
  if (!existsSync(file)) throw new Error(`no PDF: pass --url the first time (cache=${file})`);

  const pages = arg("pages");
  const grepTerm = arg("grep");
  const range = arg("lines"); // "593-650" : imprime ces lignes du texte extrait
  const args = ["-layout", "-enc", "UTF-8"];
  if (pages) {
    const [f, l] = pages.split("-");
    if (f) args.push("-f", f);
    args.push("-l", l ?? f ?? "");
  }
  args.push(file, "-");

  let text: string;
  try {
    text = execFileSync("pdftotext", args, { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
  } catch (e) {
    throw new Error(`pdftotext failed (poppler-utils installed?): ${e instanceof Error ? e.message : String(e)}`);
  }

  if (range) {
    const [a, b] = range.split("-").map((n) => parseInt(n, 10));
    const lines = text.split("\n");
    const to = Number.isFinite(b) ? b : a;
    for (let i = a; i <= to && i <= lines.length; i++) console.log(`${String(i).padStart(5)}| ${lines[i - 1] ?? ""}`);
  } else if (grepTerm) {
    const re = new RegExp(grepTerm, "i");
    const lines = text.split("\n");
    let hits = 0;
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i]!)) {
        hits++;
        const from = Math.max(0, i - 3);
        const to = Math.min(lines.length - 1, i + 3);
        console.log(`--- L${i + 1} ---`);
        for (let j = from; j <= to; j++) console.log(lines[j]);
      }
    }
    console.log(`\n[grep "${grepTerm}" hits=${hits} lines=${lines.length} file=${file}]`);
  } else {
    console.log(text);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
