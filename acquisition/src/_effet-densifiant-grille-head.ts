/**
 * _effet-densifiant-grille-head.ts — lane geo-4a, sonde $0 read-only (poppler natif).
 *
 * Pour chaque PDF de work/zonage-norms/<slug>/ (ou --file explicite): imprime le
 * texte des premières pages (en-tête → numéro/millésime de règlement) et compte les
 * mentions « logement » (présence d'une métrique de densité extractible).
 *
 * ANTI-INVENTION: n'extrait ni ne décide rien. Texte verbatim + comptes bruts.
 *
 * Usage:
 *   npx tsx acquisition/src/_effet-densifiant-grille-head.ts --slug alma --pages 2
 *   npx tsx acquisition/src/_effet-densifiant-grille-head.ts --file work/zonage-norms/alma/grille-2013.pdf --pages 2
 */
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

function pdftext(path: string, pages: number): string {
  try {
    return execFileSync(
      "pdftotext",
      ["-f", "1", "-l", String(pages), "-layout", "-enc", "UTF-8", path, "-"],
      { encoding: "utf8", maxBuffer: 128 * 1024 * 1024, timeout: 120_000 },
    );
  } catch {
    return "";
  }
}

function pages(path: string): number {
  try {
    const info = execFileSync("pdfinfo", [path], { encoding: "utf8" });
    return Number(/Pages:\s+(\d+)/.exec(info)?.[1] ?? "0");
  } catch {
    return 0;
  }
}

function countAll(path: string, re: RegExp): number {
  const full = (() => {
    try {
      return execFileSync("pdftotext", ["-layout", "-enc", "UTF-8", path, "-"], {
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
        timeout: 180_000,
      });
    } catch {
      return "";
    }
  })();
  return (full.match(re) ?? []).length;
}

function report(path: string, npages: number): void {
  const total = pages(path);
  console.log(`\n##### ${path} (pages=${total})`);
  const txt = pdftext(path, npages);
  const head = txt.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length >= 3 && l.length <= 160);
  for (const l of head.slice(0, 45)) console.log(`  ${l}`);
  console.log(
    `  -- mentions: logement=${countAll(path, /logement/gi)} habitation=${countAll(path, /habitation/gi)} "nombre de logement"=${countAll(path, /nombre\s+(maximal\s+)?de\s+logement/gi)}`,
  );
}

function grepPages(path: string, re: RegExp): void {
  const total = pages(path);
  console.log(`\n##### GREP ${path} (pages=${total})`);
  let full = "";
  try {
    full = execFileSync("pdftotext", ["-layout", "-enc", "UTF-8", path, "-"], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      timeout: 180_000,
    });
  } catch {
    console.log("  (pdftotext KO)");
    return;
  }
  const pagesArr = full.split("\f");
  let shown = 0;
  pagesArr.forEach((p, i) => {
    for (const raw of p.split(/\r?\n/)) {
      const l = raw.trim();
      if (l.length < 3 || l.length > 200) continue;
      if (!re.test(l)) continue;
      if (shown++ > 80) return;
      console.log(`p${i + 1}\t${l}`);
    }
  });
  if (shown === 0) console.log("  (0 ligne)");
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function fetchTo(url: string, name: string): string | null {
  const scratch = process.env.SCRATCH_DIR ?? "/home/antoinefa/.cache-tmp/claude-1000/-home-antoinefa-src-geo/004be741-47c6-49df-a58f-5d808887d41c/scratchpad";
  const dest = resolve(scratch, name);
  for (const insecure of [false, true]) {
    try {
      execFileSync("curl", [insecure ? "-skL" : "-sL", "--max-time", "90", "-A", UA, "-o", dest, url], {
        encoding: "utf8",
        timeout: 100_000,
      });
      const head = execFileSync("head", ["-c", "4", dest], { encoding: "latin1" });
      if (head.startsWith("%PDF")) return dest;
    } catch {
      /* retry insecure */
    }
  }
  return null;
}

function main(): void {
  const npages = Number(arg("pages") ?? "2");
  const grep = arg("grep");
  const fetch = arg("fetch");
  const asName = arg("as");
  if (fetch && asName) {
    const p = fetchTo(fetch, asName);
    if (!p) {
      console.log(`FETCH-FAIL (pas un PDF) ${fetch}`);
      return;
    }
    console.log(`FETCHED ${p}`);
    if (grep) grepPages(p, new RegExp(grep, "i"));
    else report(p, npages);
    return;
  }
  const file = arg("file");
  if (grep && file) {
    grepPages(resolve(ROOT, file), new RegExp(grep, "i"));
    return;
  }
  if (file) {
    report(resolve(ROOT, file), npages);
    return;
  }
  const slug = arg("slug");
  if (!slug) {
    console.log("usage: --slug <slug> [--pages N] | --file <path> [--pages N]");
    process.exit(1);
  }
  const dir = resolve(ROOT, "work", "zonage-norms", slug);
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((n) => n.toLowerCase().endsWith(".pdf"));
  } catch {
    console.log(`(aucun dossier work/zonage-norms/${slug}/)`);
    return;
  }
  names.sort((a, b) => statSync(resolve(dir, b)).size - statSync(resolve(dir, a)).size);
  for (const n of names) report(resolve(dir, n), npages);
}

main();
