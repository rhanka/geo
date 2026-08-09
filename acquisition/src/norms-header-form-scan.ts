/**
 * norms-header-form-scan — $0. Imprime les PREMIÈRES LIGNES d'une page centrale de
 * chaque PDF d'un lot de slugs, pour LIRE la FORME de la bannière de zone.
 *
 * POURQUOI. Les sondes existantes répondent en binaire ("0 zones extracted") sans
 * jamais montrer POURQUOI. Or les 3 grilles trouvées sur le shard 0/1 l'ont été en
 * lisant l'en-tête à l'œil :
 *   - gaspe            "GRILLE DE SPÉCIFICATIONS            _M-239_"  (gabarit C, ajouté)
 *   - saint-gedeon     "MUNICIPALITÉ DE SAINT-GÉDÉON   Numéro de zone: 100"
 *   - sainte-clotilde  "ZONES: Aa1, Aa2-1, Aa4 …"                     (bannière PLURIELLE)
 * Un `0 zones` peut donc être un faux négatif de GABARIT, pas une absence de grille :
 * ce script rend la forme visible avant toute dépense.
 *
 * Lit une page à ~40 % du document (les annexes-grilles vivent après le corps) et,
 * à défaut de texte, le signale comme SCAN (piste Mistral OCR, pas natif).
 * Pure lecture : poppler seulement, 0 S3, 0 LLM, 0 dépense.
 *
 * Usage:
 *   npx tsx acquisition/src/norms-header-form-scan.ts --slugs a,b,c [--lines 6] [--at 0.4]
 *   npx tsx acquisition/src/norms-header-form-scan.ts --pairs "slug=chemin.pdf,…"
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const REPO = resolve(process.cwd());
const NORMS_DIR = join(REPO, "work", "zonage-norms");
const nLines = Number(arg("lines", "6"));
const at = Number(arg("at", "0.4"));

/** Tous les PDF du slug, le plus explicitement « grille » d'abord. */
function pdfsOf(slug: string): string[] {
  const dir = join(NORMS_DIR, slug);
  if (!existsSync(dir)) return [];
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const pdfs = entries.filter((e) => e.toLowerCase().endsWith(".pdf"));
  const score = (f: string): number => {
    const l = f.toLowerCase();
    if (l.includes("annexe") && l.includes("grille")) return 100;
    if (l.includes("grille") || l.includes("cahier") || l.includes("specif")) return 80;
    if (l.includes("annexe")) return 60;
    return 10;
  };
  return pdfs
    .sort((a, b) => {
      const d = score(b) - score(a);
      if (d !== 0) return d;
      return statSync(join(dir, b)).size - statSync(join(dir, a)).size;
    })
    .map((f) => join(dir, f));
}

function pageCount(pdf: string): number {
  const r = spawnSync("pdfinfo", [pdf], { encoding: "utf8", timeout: 30000 });
  return Number(r.stdout?.match(/Pages:\s+(\d+)/)?.[1] ?? "0");
}

function pageText(pdf: string, page: number): string {
  const r = spawnSync(
    "pdftotext",
    ["-q", "-layout", "-enc", "UTF-8", "-f", String(page), "-l", String(page), pdf, "-"],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 60000 },
  );
  return r.stdout ?? "";
}

function main(): void {
  const forced = new Map<string, string>();
  for (const p of (arg("pairs") ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const eq = p.indexOf("=");
    if (eq <= 0) {
      console.error(`--pairs: attendu slug=chemin.pdf, reçu "${p}"`);
      process.exit(1);
    }
    forced.set(p.slice(0, eq).trim(), p.slice(eq + 1).trim());
  }
  const slugs = forced.size
    ? [...forced.keys()]
    : (arg("slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!slugs.length) {
    console.error("need --slugs a,b,c or --pairs slug=chemin.pdf");
    process.exit(1);
  }

  for (const slug of slugs) {
    const pdfs = forced.has(slug) ? [forced.get(slug)!] : pdfsOf(slug);
    if (!pdfs.length) {
      console.log(`\n### ${slug}\n  NO-PDF`);
      continue;
    }
    console.log(`\n### ${slug}`);
    for (const pdf of pdfs.slice(0, forced.size ? 1 : 2)) {
      const pages = pageCount(pdf);
      const page = Math.max(1, Math.round(pages * at));
      const txt = pageText(pdf, page);
      const rel = pdf.replace(REPO + "/", "");
      if (txt.replace(/\s+/g, "").length < 40) {
        console.log(`  [SCAN — piste Mistral OCR] p${page}/${pages} ${rel}`);
        continue;
      }
      console.log(`  [p${page}/${pages}] ${rel}`);
      const lines = txt.split(/\r?\n/).filter((l) => l.trim()).slice(0, nLines);
      for (const l of lines) console.log(`    | ${l.slice(0, 170)}`);
    }
  }
}

main();
