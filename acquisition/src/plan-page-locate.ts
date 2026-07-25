/**
 * plan-page-locate.ts — find WHICH page of a multi-page by-law PDF carries the
 * zoning MAP, at $0 (text layer only, no render, no OCR, no model).
 *
 * WHY: 90 of the 263 non-done slugs already have a PDF on disk, but most are the
 * FULL by-law body (68, 87, 190, 258 pages) whose page 1 is a cover sheet. A
 * recalage run pointed at `--page 1` reads a title page, reports `svg_points: 0`,
 * and gets logged as "raster/scan, no vector to seed on" — a false terminal
 * verdict that is really a page-selection miss. The plan is an ANNEXE inside the
 * body (cf. saint-roch-ouest: plan on p110 of the 151-2023 body).
 *
 * THE DISCRIMINATOR IS SCATTER, NOT CODE COUNT (measured, bethanie 2026-07-17):
 * counting code-shaped tokens is NOT enough. Béthanie p185 is a "grille des
 * usages" whose rows read "classe A-1", "classe B-2", … — 23 distinct
 * code-shaped tokens, almost no prose, and every one of them a USAGE CLASS, not
 * a zone (that page's real zones are the numeric column heads 201, 202, 301…).
 * A count-only score called it a plan, and t3-chamfer-seed then "registered" the
 * cadastre onto a TABLE at 78% inliers / 7.5 m. Cf. the standing trap in project
 * memory: a letter-number token NEVER proves a zone code.
 *
 * A map SCATTERS its labels across the sheet in x AND y. A table stacks them in
 * a few columns: many distinct y, very few distinct x. So we score each page by
 * the 2-D scatter of its code positions (`pdftotext -bbox`), and a page whose
 * codes collapse into a handful of x-columns is reported as a GRILLE — which is
 * exactly what `--dict` wants — never as a plan.
 *
 * This LOCATES a page. It decides nothing, admits no code into any output, and
 * serves nothing — every recalage gate downstream is untouched. Treat its
 * output as a CANDIDATE to render and look at, not as a verdict.
 *
 * Usage:
 *   npx tsx acquisition/src/plan-page-locate.ts --pdf <body.pdf> [--top 8] [--max-pages 400]
 */
import { execFileSync } from "node:child_process";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

/**
 * Lettered zone codes as the builders admit them (cf. nonAdmissibleCodes): a
 * letter block and a digit block, either order, optionally suffixed (231-REC,
 * 212-F, H-3, RA-101, 17-R). Pure numbers are deliberately NOT counted here:
 * they are the anti-#74 OBJECTID fingerprint and would score every numbered
 * page. A muni that really zones numerically is served through the dict-gated
 * numeric relaxation (spec section 7.5), not through this locator.
 */
const CODE_RE = /^(?:[A-Z]{1,4}-?\d{1,4}(?:-[A-Z]{1,3})?|\d{1,4}-[A-Z]{1,4}(?:-\d{1,3})?)$/;
const PROSE_RE = /\b(?:le|la|les|des|dans|que|qui|est|sont|pour|par|une|aux|du|de)\b/gi;
/** Headings that mark a specifications/usage table — a dict source, not a map. */
const TABLE_HINT_RE = /\b(?:grille|classes?\s+d'usages?|usage\s+dominant|article\s+de\s+zonage|sp[ée]cifications?)\b/i;

interface Word {
  text: string;
  x: number;
  y: number;
}

function parseBboxPage(xml: string): { words: Word[]; pageW: number; pageH: number } {
  const pm = xml.match(/<page width="([\d.]+)" height="([\d.]+)"/);
  const pageW = pm ? Number(pm[1]) : 0;
  const pageH = pm ? Number(pm[2]) : 0;
  const words: Word[] = [];
  const re = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    words.push({
      text: m[5]!.trim(),
      x: (Number(m[1]) + Number(m[3])) / 2,
      y: (Number(m[2]) + Number(m[4])) / 2,
    });
  }
  return { words, pageW, pageH };
}

/** Count distinct clusters of a 1-D coordinate at a given tolerance. */
function clusters(vals: number[], tol: number): number {
  if (!vals.length) return 0;
  const s = [...vals].sort((a, b) => a - b);
  let n = 1;
  let last = s[0]!;
  for (const v of s) {
    if (v - last > tol) {
      n += 1;
      last = v;
    }
  }
  return n;
}

export interface PageScore {
  page: number;
  words: number;
  distinctCodes: number;
  proseHits: number;
  xCols: number;
  yRows: number;
  kind: "plan" | "grille" | "prose" | "no-text";
  why: string;
  sample: string[];
}

export function scorePage(xml: string, page: number): PageScore {
  const { words, pageW, pageH } = parseBboxPage(xml);
  const text = words.map((w) => w.text).join(" ");
  const prose = (text.match(PROSE_RE) ?? []).length;
  const codeWords = words.filter((w) => CODE_RE.test(w.text));
  const distinct = new Set(codeWords.map((w) => w.text));
  // Cluster at ~4% of the page so a column of labels counts once.
  const xCols = clusters(codeWords.map((w) => w.x), Math.max(pageW * 0.04, 8));
  const yRows = clusters(codeWords.map((w) => w.y), Math.max(pageH * 0.04, 8));
  const tableHint = TABLE_HINT_RE.test(text);

  let kind: PageScore["kind"];
  let why: string;
  if (words.length < 12) {
    kind = "no-text";
    why = "aucune couche texte — candidate plan-GLYPHES, a rendre et lire en vision";
  } else if (distinct.size < 8) {
    kind = "prose";
    why = `seulement ${distinct.size} code(s) distinct(s)`;
  } else if (tableHint) {
    kind = "grille";
    why = "en-tete de tableau (grille/classes d'usages/specifications) — les jetons lettres sont des CLASSES, pas des zones";
  } else if (xCols < 4 || yRows < 4) {
    kind = "grille";
    why = `codes empiles en tableau: ${xCols} colonne(s) x ${yRows} rangee(s) — une carte disperse en x ET en y`;
  } else if (prose > distinct.size * 1.5) {
    kind = "prose";
    why = `prose (${prose}) domine les codes (${distinct.size})`;
  } else {
    kind = "plan";
    why = `codes disperses sur la feuille: ${xCols} colonne(s) x ${yRows} rangee(s)`;
  }
  return {
    page,
    words: words.length,
    distinctCodes: distinct.size,
    proseHits: prose,
    xCols,
    yRows,
    kind,
    why,
    sample: [...distinct].slice(0, 8),
  };
}

function pageCount(pdf: string): number {
  const info = execFileSync("pdfinfo", [pdf], { encoding: "utf8", timeout: 60_000 });
  const m = info.match(/Pages:\s*(\d+)/);
  if (!m) throw new Error("pdfinfo: could not read page count");
  return Number(m[1]);
}

export function locatePlanPages(pdf: string, maxPages: number): PageScore[] {
  const n = Math.min(pageCount(pdf), maxPages);
  const out: PageScore[] = [];
  for (let p = 1; p <= n; p++) {
    let xml = "";
    try {
      xml = execFileSync("pdftotext", ["-bbox", "-f", String(p), "-l", String(p), pdf, "-"], {
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      /* unreadable page → scores as no-text, still reported */
    }
    out.push(scorePage(xml, p));
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith("plan-page-locate.ts")) {
  const pdf = arg("pdf");
  if (!pdf) throw new Error("required: --pdf <path>");
  const top = Number(arg("top", "8"));
  const maxPages = Number(arg("max-pages", "400"));
  const scores = locatePlanPages(pdf, maxPages);
  const plans = scores.filter((s) => s.kind === "plan").sort((a, b) => b.distinctCodes - a.distinctCodes);
  const grilles = scores.filter((s) => s.kind === "grille").sort((a, b) => b.distinctCodes - a.distinctCodes);
  const noText = scores.filter((s) => s.kind === "no-text");

  console.log(`=== plan-page-locate ${pdf} (${scores.length} pages lues, $0) ===`);
  console.log(
    `plan=${plans.length} | grille=${grilles.length} | prose=${scores.filter((s) => s.kind === "prose").length} | sans texte=${noText.length}`,
  );
  console.log("");
  console.log("=== CANDIDATS PLAN (codes disperses en x ET en y) ===");
  if (!plans.length) console.log("  (aucun)");
  for (const s of plans.slice(0, top)) {
    console.log(`  page ${s.page}\tcodes=${s.distinctCodes}\t${s.xCols}col x ${s.yRows}rang\tex: ${s.sample.join(", ")}`);
  }
  if (grilles.length) {
    console.log("");
    console.log("=== CANDIDATS GRILLE (source de --dict ; PAS un plan) ===");
    for (const s of grilles.slice(0, top)) {
      console.log(`  page ${s.page}\tcodes=${s.distinctCodes}\t${s.why}`);
    }
  }
  if (noText.length) {
    console.log("");
    console.log(`=== PAGES SANS COUCHE TEXTE (${noText.length}) — candidates PLAN-GLYPHES (rendre + vision) ===`);
    console.log(`  pages: ${noText.slice(0, 40).map((s) => s.page).join(", ")}${noText.length > 40 ? " …" : ""}`);
  }
  console.log("");
  console.log("RAPPEL: ceci est un CANDIDAT, pas un verdict. Rends la page et REGARDE-la avant de recaler:");
  console.log("  npx tsx acquisition/src/_pdf-render-page.ts --pdf <pdf> --page <n> --dpi 70 --out <prefix>");
}
