/**
 * normes-grille-window-probe — GATE $0 de la lane normes : décide, SANS dépenser un
 * cent, si un PDF local mérite une passe Mistral, et sur QUELLES pages.
 *
 * Motivation (deux pièges mesurés) :
 *  - « le nom du fichier ment » : un `grille.pdf` téléchargé par la découverte peut
 *    être un règlement de fosses septiques ou un amendement ponctuel. Router un tel
 *    PDF vers l'OCR paie pour 0 zone.
 *  - « auto-grid → OCR payant » : sans fenêtre prouvée, le fallback p1-80 coûte
 *    ~$0.08 pour 0 zone. Ici la fenêtre est PROUVÉE par la couche texte à $0.
 *
 * Pour chaque slug : pdftotext -layout page à page (poppler), puis
 *   - `grillePages` : pages portant un marqueur de grille verbatim
 *     (« grille des spécifications », « grille des usages et normes », …) ;
 *   - `normPages`   : pages portant ≥3 en-têtes de normes canoniques
 *     (marge, hauteur, superficie, implantation, frontage, rapport) — c'est la
 *     grille elle-même, même quand son titre vit sur une page précédente ;
 *   - `titleHint`   : 1res lignes non vides de la page 1, pour repérer un document
 *     hors-sujet (amendement, fosses septiques) avant de payer ;
 *   - `verdict`     : MISTRAL-WINDOW (fenêtre bornée prouvée) | SCAN-NO-TEXT
 *     (0 char : rendre en PNG avant de router) | NO-GRILLE-MARKER (le texte ne
 *     porte aucun marqueur : ne PAS payer sur ce PDF).
 *
 * `NO-GRILLE-MARKER` prouve que CE PDF ne porte pas de grille — jamais que la muni
 * n'en a pas (cf. « grille = PDF frère »).
 *
 * Pure lecture : 0 réseau, 0 S3, 0 LLM, 0 écriture.
 *   npx tsx acquisition/src/normes-grille-window-probe.ts --slugs a,b,c [--json] [--max-pages 400]
 *   npx tsx acquisition/src/normes-grille-window-probe.ts --pdf <path> [--json]
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const NORMS_DIR = join(REPO, "work", "zonage-norms");

function get(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (k: string) => process.argv.includes(`--${k}`);

/** Titre verbatim d'une grille des spécifications, toutes variantes rencontrées. */
const GRILLE_MARKERS = [
  "grille des specifications",
  "grille de specifications",
  "grille des usages et normes",
  "grille des usages et des normes",
  "grille d'usages et normes",
  "grilles des specifications",
  "specifications applicables",
  "usages et normes",
];

/** En-têtes de colonnes canoniques d'une grille (design retenu, §2 is_grille_page). */
const NORM_HEADERS = [
  "marge",
  "hauteur",
  "superficie",
  "implantation",
  "frontage",
  "rapport",
  "largeur",
  "profondeur",
  "densite",
  "logement",
];

function deaccent(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function pageCount(pdf: string): number {
  const r = spawnSync("pdfinfo", [pdf], { encoding: "utf8" });
  const m = r.stdout?.match(/Pages:\s+(\d+)/);
  return m ? Number(m[1]) : 0;
}

function pageTexts(pdf: string, lastPage: number): string[] {
  const r = spawnSync(
    "pdftotext",
    ["-q", "-layout", "-f", "1", "-l", String(lastPage), "-enc", "UTF-8", pdf, "-"],
    { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 },
  );
  const pages = (r.stdout ?? "").split("\f");
  if (pages.at(-1) === "") pages.pop();
  return pages;
}

/**
 * Une VRAIE grille aligne les zones en abscisse : ses lignes portent ≥6 codes de zone
 * distincts. Un règlement qui se CONTENTE de renvoyer à sa grille (« La grille des
 * spécifications (Annexe 1) est un tableau qui… ») n'en porte aucune. C'est le seul
 * discriminant fiable prose-vs-grille : mesuré sur courcelles-saint-evariste, les
 * marqueurs titre matchent 12 pages de PROSE, la grille vit dans un PDF frère absent.
 * Même modèle que detectGridPages() de zonage-norms-run.ts, pour que ce gate $0
 * prédise la décision du runner.
 */
const ZONE_CODE_TOKEN = /\b[A-Z]{1,4}-?\d{1,3}\b/g;
const GRID_MIN_CODES_PER_LINE = 6;

function hasGridLine(txt: string): boolean {
  for (const line of txt.split("\n")) {
    const codes = new Set(line.match(ZONE_CODE_TOKEN) ?? []);
    if (codes.size >= GRID_MIN_CODES_PER_LINE) return true;
  }
  return false;
}

interface Probe {
  slug: string;
  pdf: string;
  pages: number;
  textChars: number;
  grillePages: number[];
  normPages: number[];
  /** Pages portant une LIGNE de grille réelle (≥6 codes de zone distincts). */
  gridLinePages: number[];
  window: { first: number; last: number } | null;
  titleHint: string;
  verdict: "MISTRAL-WINDOW" | "SCAN-NO-TEXT" | "NO-GRILLE-MARKER" | "PROSE-ONLY-SIBLING-ANNEX";
}

interface UniverseFile {
  acquisition_universe?: Array<{ slug?: unknown }>;
}

interface ProgressFile {
  universe_path: string;
  scope_count: number;
  processed_slugs: string[];
  results: Probe[];
}

function probe(slug: string, pdf: string, maxPages: number): Probe {
  const pages = pageCount(pdf);
  const grillePages: number[] = [];
  const normPages: number[] = [];
  const gridLinePages: number[] = [];
  let textChars = 0;
  let titleHint = "";

  const scanTo = Math.min(pages, maxPages);
  const texts = scanTo > 0 ? pageTexts(pdf, scanTo) : [];
  for (let p = 1; p <= scanTo; p++) {
    const txt = texts[p - 1] ?? "";
    textChars += txt.length;
    if (p === 1) {
      titleHint = txt
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, 4)
        .join(" | ")
        .slice(0, 160);
    }
    const flat = deaccent(txt).replace(/\s+/g, " ");
    if (GRILLE_MARKERS.some((m) => flat.includes(m))) grillePages.push(p);
    const hits = new Set(NORM_HEADERS.filter((h) => flat.includes(h)));
    if (hits.size >= 3) normPages.push(p);
    if (hasGridLine(txt)) gridLinePages.push(p);
  }

  // La fenêtre se borne aux pages PORTEUSES d'une grille réelle (±2), jamais à
  // l'enveloppe des mentions : sur un règlement de 159 p. les mentions s'étalent de
  // la p.4 à la p.156 et « borner » revient à ne rien borner.
  const window = gridLinePages.length
    ? {
        first: Math.max(1, gridLinePages[0] - 2),
        last: Math.min(pages, gridLinePages[gridLinePages.length - 1] + 2),
      }
    : null;

  // Un scan image rend ~1 char/page (le seul form-feed de pdftotext), PAS 0 : tester
  // `textChars === 0` classe « pas de grille » un PDF qui n'a simplement aucune couche
  // texte — c'est le piège « scan ≠ grille », et il coûte un faux abandon.
  const charsPerPage = pages > 0 ? textChars / pages : 0;
  let verdict: Probe["verdict"];
  if (pages === 0 || charsPerPage < 50) verdict = "SCAN-NO-TEXT";
  else if (gridLinePages.length > 0) verdict = "MISTRAL-WINDOW";
  else if (grillePages.length > 0) verdict = "PROSE-ONLY-SIBLING-ANNEX";
  else verdict = "NO-GRILLE-MARKER";

  return {
    slug, pdf: pdf.replace(`${REPO}/`, ""), pages, textChars,
    grillePages, normPages, gridLinePages, window, titleHint, verdict,
  };
}

/** Tous les PDF stagés pour ce slug (le fichier nommé `grille.pdf` n'est pas forcément le bon). */
function slugPdfs(slug: string): string[] {
  const dir = join(NORMS_DIR, slug);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .map((f) => join(dir, f));
}

function writeProgress(path: string, universePath: string, scope: readonly string[], results: readonly Probe[]): void {
  const processedSlugs = [...new Set(results.map((result) => result.slug))].sort();
  const progress: ProgressFile = {
    universe_path: universePath,
    scope_count: scope.length,
    processed_slugs: processedSlugs,
    results: [...results].sort((a, b) => a.slug.localeCompare(b.slug) || a.pdf.localeCompare(b.pdf)),
  };
  writeFileSync(path, `${JSON.stringify(progress, null, 2)}\n`);
}

function main(): void {
  const maxPages = Number(get("max-pages") ?? "400");
  const asJson = has("json");
  const single = get("pdf");
  const universeArg = get("universe");
  const out = get("out");
  let results: Probe[] = [];

  if (single) {
    results.push(probe(get("slug") ?? "?", resolve(single), maxPages));
  } else {
    const universePath = universeArg ? resolve(universeArg) : "";
    const universe = universePath
      ? JSON.parse(readFileSync(universePath, "utf8")) as UniverseFile
      : null;
    const slugs = universe
      ? (universe.acquisition_universe ?? [])
          .map((entry) => entry.slug)
          .filter((slug): slug is string => typeof slug === "string" && slug.length > 0)
      : (get("slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!slugs.length) throw new Error("required: --slugs a,b,c or --universe <json> (or --pdf <path>)");
    if (out && !universePath) throw new Error("--out requiert --universe afin de fermer le périmètre");

    if (out && existsSync(out)) {
      const existing = JSON.parse(readFileSync(out, "utf8")) as ProgressFile;
      if (existing.universe_path !== universePath) {
        throw new Error(`${out}: univers différent (${existing.universe_path})`);
      }
      results = existing.results ?? [];
    }
    const done = new Set(results.map((result) => result.slug));
    const pending = slugs.filter((slug) => !done.has(slug));
    const maxRaw = get("max");
    const max = maxRaw === undefined ? pending.length : Number(maxRaw);
    if (!Number.isInteger(max) || max < 1) throw new Error(`--max invalide: ${maxRaw}`);
    const batch = pending.slice(0, max);
    for (const slug of batch) {
      const pdfs = slugPdfs(slug);
      if (!pdfs.length) {
        results.push({
          slug, pdf: "-", pages: 0, textChars: 0, grillePages: [], normPages: [],
          gridLinePages: [], window: null, titleHint: "", verdict: "NO-GRILLE-MARKER",
        });
      } else {
        for (const p of pdfs) results.push(probe(slug, p, maxPages));
      }
      if (out) writeProgress(out, universePath, slugs, results);
    }
    if (out) writeProgress(out, universePath, slugs, results);
    console.error(`# progress: batch=${batch.length} processed=${new Set(results.map((result) => result.slug)).size}/${slugs.length}`);
  }

  if (has("quiet")) return;
  if (asJson) {
    console.log(JSON.stringify({ results }, null, 2));
    return;
  }
  for (const r of results) {
    const win = r.window ? `p${r.window.first}..${r.window.last}` : "-";
    console.log(
      `${r.slug}\t${r.verdict}\tpages=${r.pages}\tchars=${r.textChars}\tgridlines=${r.gridLinePages.length}\tmention=${r.grillePages.length}\twin=${win}\t${r.pdf}`,
    );
    if (r.titleHint) console.log(`\t↳ ${r.titleHint}`);
  }
  const win = results.filter((r) => r.verdict === "MISTRAL-WINDOW").length;
  const prose = results.filter((r) => r.verdict === "PROSE-ONLY-SIBLING-ANNEX").length;
  console.error(
    `# window-probe: ${win}/${results.length} PDF avec grille RÉELLE (fenêtre prouvée à $0) · ` +
      `${prose} PROSE-ONLY (grille dans un PDF frère absent — ne pas payer)`,
  );
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
