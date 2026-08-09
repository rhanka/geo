/**
 * _reglprov-pv-grep.ts — lane P0_1 (provenance règlement).
 *
 * GISEMENT: le CORPS du règlement de zonage est souvent inaccessible (URL morte,
 * portail SPA, hôte bloqué), MAIS les PROCÈS-VERBAUX et AVIS PUBLICS de la
 * municipalité le NOMMENT verbatim («... modifiant le règlement de zonage numéro
 * 21-90 ...»). C'est le motif qui a débloqué la-pocatiere et sainte-francoise.
 *
 * Ce script balaye le corpus PV déjà acquis sur disque (lane PV) et remonte, par
 * slug, les lignes qui nomment un règlement de ZONAGE avec un numéro — avec la
 * page et le fichier, pour lecture VERBATIM par l'opérateur.
 *
 * Il n'écrit RIEN dans le registre: c'est une sonde. L'opérateur lit, applique
 * l'owner-gate et écarte les amendements lui-même.
 *
 * Usage:
 *   npx tsx acquisition/src/_reglprov-pv-grep.ts --inventory
 *   npx tsx acquisition/src/_reglprov-pv-grep.ts --slugs a,b [--max-files 6] [--pages 40]
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Racines connues du corpus PV/avis déjà acquis (lane PV). */
const PV_ROOTS = [
  "work/pv-verified",
  "work/pv-shard-a",
  "work/pv-residue-r2",
  "work/pv-browser",
  "work/pv-js",
  "work/pv",
  "work/delegation-mass/pv",
  "work/zonage-norms",
];

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

function listDirs(p: string): string[] {
  try {
    return readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
}

function listPdfs(p: string, depth = 2): string[] {
  const out: string[] = [];
  const walk = (dir: string, d: number): void => {
    let ents: import("node:fs").Dirent[];
    try {
      ents = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const full = join(dir, e.name);
      if (e.isDirectory() && d > 0) walk(full, d - 1);
      else if (e.isFile() && e.name.toLowerCase().endsWith(".pdf")) out.push(full);
    }
  };
  walk(p, depth);
  return out;
}

function inventory(): void {
  for (const r of PV_ROOTS) {
    const abs = resolve(ROOT, r);
    if (!existsSync(abs)) {
      console.log(`${r}\tABSENT`);
      continue;
    }
    const dirs = listDirs(abs);
    const pdfs = listPdfs(abs, 2).length;
    console.log(`${r}\tsous-dossiers=${dirs.length}\tpdf(prof.2)=${pdfs}\tex=${dirs.slice(0, 4).join(",")}`);
  }
}

/**
 * «règlement de zonage numéro 123-45», «règlement de zonage no 123», «règlement de zonage 123-45».
 * ⛔ La classe d'accent DOIT couvrir è/È (grave): les couvertures crient «RÈGLEMENT DE ZONAGE
 * NUMÉRO ...» et un `[eé]` naïf les rate en bloc — faux FIND-0 massif (mesuré sur
 * saint-francois-du-lac: 204 occurrences ratées). C'est un piège de CE fichier, corrigé
 * ici: les autres sondes du lane (_reglement-corps-read, _reglement-local-probe,
 * _reglprov-fulltext-grep) utilisent déjà `r[eè]glement` et n'ont jamais eu ce défaut.
 */
const RE_ZONAGE_NUM =
  /r[eéèêë]glement\s+(?:de\s+)?zonage\s*(?:num[eéèêë]ro|no\.?|n[°os]\.?|#)?\s*([0-9][0-9A-Za-z‐-―.\-\/]{1,20})/i;

function pdfPages(file: string): number {
  try {
    const out = execFileSync("pdfinfo", [file], {
      encoding: "utf8",
      maxBuffer: 4 << 20,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const m = out.match(/^Pages:\s+(\d+)/m);
    return m ? Number(m[1]) : 0;
  } catch {
    return 0;
  }
}

function pageText(file: string, page: number): string {
  try {
    return execFileSync("pdftotext", ["-layout", "-f", String(page), "-l", String(page), file, "-"], {
      encoding: "utf8",
      maxBuffer: 16 << 20,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}

function main(): void {
  if (process.argv.includes("--inventory")) return inventory();
  const slugs = (arg("slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!slugs.length) {
    console.error("usage: --inventory | --slugs a,b [--max-files 6] [--pages 40]");
    process.exit(2);
  }
  const maxFiles = Number(arg("max-files", "6"));
  const maxPages = Number(arg("pages", "40"));

  for (const slug of slugs) {
    console.log(`\n===== ${slug} =====`);
    const files: string[] = [];
    for (const r of PV_ROOTS) {
      const dir = resolve(ROOT, r, slug);
      if (existsSync(dir) && statSync(dir).isDirectory()) files.push(...listPdfs(dir, 2));
    }
    if (!files.length) {
      console.log("  NO-PV-LOCAL");
      continue;
    }
    // les plus récents d'abord (mtime) — un PV récent nomme le règlement en vigueur
    files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    let hits = 0;
    for (const f of files.slice(0, maxFiles)) {
      const total = pdfPages(f);
      if (!total) {
        console.log(`  ${f.replace(ROOT + "/", "")}\tNO-TEXT/NOT-PDF`);
        continue;
      }
      const last = Math.min(total, maxPages);
      for (let p = 1; p <= last; p++) {
        const txt = pageText(f, p);
        if (!txt) continue;
        for (const line of txt.split("\n")) {
          const m = line.match(RE_ZONAGE_NUM);
          if (!m) continue;
          hits++;
          console.log(`  HIT ${f.replace(ROOT + "/", "")} p${p}\t«${line.trim().slice(0, 180)}»`);
          if (hits >= 12) break;
        }
        if (hits >= 12) break;
      }
      if (hits >= 12) break;
    }
    if (!hits) console.log(`  FIND-0 (fichiers sondés=${Math.min(files.length, maxFiles)}/${files.length})`);
  }
}

main();
