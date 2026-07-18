/**
 * _usage-dom-local-legend — $0 helper (lane usage_dominant), jumeau LOCAL de
 * _usage-dom-legend. Au lieu de télécharger une URL, il lit un PDF DÉJÀ présent
 * dans le corpus local `work/zonage-norms/<slug>/` (déposé par la lane normes),
 * extrait le texte verbatim via `pdftotext -layout` (aucune OCR, aucune invention)
 * et affiche soit une fenêtre de pages (--pages f-l), soit une plage de lignes du
 * texte extrait (--lines a-b), soit les lignes matchant --grep (±3 lignes).
 *
 * Sert à lire la LÉGENDE « division du territoire / classification des zones /
 * abréviation-fonction dominante » d'un règlement dont l'URL n'est pas stampée sur
 * les features mais dont le corps/la grille sont sur disque.
 *
 * Choix du PDF: --file <sous-chaîne> cible un fichier précis; sinon le PLUS GROS
 * (le corps porte la légende). --list imprime l'inventaire et sort.
 *
 *   npx tsx acquisition/src/_usage-dom-local-legend.ts --slug caplan --list
 *   npx tsx acquisition/src/_usage-dom-local-legend.ts --slug cascapedia-saint-jules --file grille --grep "dominante|vocation|abréviation|classification"
 *   npx tsx acquisition/src/_usage-dom-local-legend.ts --slug aston-jonction --file grille-base --pages 1-4
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CORPUS = resolve(ROOT, "work", "zonage-norms");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function localPdfs(slug: string): string[] {
  const dir = resolve(CORPUS, slug);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .map((f) => resolve(dir, f))
    .filter((p) => statSync(p).size > 2048)
    .sort((a, b) => statSync(b).size - statSync(a).size);
}

function main(): void {
  const slug = (arg("slug") ?? "").trim();
  if (!slug) throw new Error("required: --slug <slug>");
  const pdfs = localPdfs(slug);
  if (!pdfs.length) throw new Error(`no local PDF in work/zonage-norms/${slug}/`);
  if (process.argv.includes("--list")) {
    for (const p of pdfs) console.log(`${(statSync(p).size / 1_048_576).toFixed(2)}MB\t${p.replace(ROOT + "/", "")}`);
    return;
  }
  const fileSub = arg("file");
  const file = fileSub ? pdfs.find((p) => p.toLowerCase().includes(fileSub.toLowerCase())) : pdfs[0];
  if (!file) throw new Error(`no local PDF matching --file ${fileSub}`);
  console.log(`# ${file.replace(ROOT + "/", "")}`);

  const pages = arg("pages");
  const args = ["-layout", "-enc", "UTF-8"];
  if (pages) {
    const [f, l] = pages.split("-");
    if (f) args.push("-f", f);
    args.push("-l", l ?? f ?? "");
  }
  args.push(file, "-");
  const text = execFileSync("pdftotext", args, { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });

  const range = arg("lines");
  const grepTerm = arg("grep");
  if (range) {
    const [a, b] = range.split("-").map((n) => parseInt(n, 10));
    const lines = text.split("\n");
    const to = Number.isFinite(b) ? b! : a!;
    for (let i = a!; i <= to && i <= lines.length; i++) console.log(`${String(i).padStart(5)}| ${lines[i - 1] ?? ""}`);
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
    console.log(`\n[grep "${grepTerm}" hits=${hits} lines=${lines.length}]`);
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
