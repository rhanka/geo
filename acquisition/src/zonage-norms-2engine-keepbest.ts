/**
 * TWO-ENGINE keep-best extraction for the `qc-zonage-norms-<slug>` corpus.
 *
 * PROCESS (the user's explicit design)
 * ------------------------------------
 * Extract each municipality's "grille des normes" with TWO INDEPENDENT engines and
 * keep the BEST per city, with ZERO regression vs what is already deposited on S3:
 *
 *   Engine A — hardened Document-AI OCR (mistral-ocr-4-0 → markdown → guarded
 *              ZoneNorms via the FROZEN extractor). Cheap (~$0.001/page), 12 lanes
 *              tolerable.
 *   Engine B — Claude Opus 4.8 at xhigh reasoning, driven through the local
 *              `claude -p` headless CLI on the user's SUBSCRIPTION (OAuth, NOT a
 *              paid API key — verified `apiKeySource: none`). Heavier (~1 min/page)
 *              and rate-limited (five_hour window, overage rejected → never bills),
 *              so few concurrent lanes.
 *
 * The retired chat-vision (mistral-medium) deposits are the keep-best BASELINE; a
 * global S3 backup lives at `registry/qc-zonage-norms-backup-chatvision/`.
 *
 * PER CITY
 * --------
 *   1. resolve the grille PDF: staged S3 → local work/zonage-norms → download from
 *      the manifest/munis source_url (magic-byte guarded). Temp PDF/PNG purged after.
 *   2. run Engine A AND Engine B (in parallel) over the SAME bounded page range.
 *   3. cross-validate each engine's zone codes against the muni SIG grille.
 *   4. COMPARE recall (SIG overlap when a grid exists, else distinct zone codes) +
 *      published norm-field count. Anti-invention is inherited WHOLE from both
 *      extractors' frozen `buildVisionField` guard (verbatim-or-null) → invention
 *      is structurally impossible, recorded as invention_ok:true.
 *   5. pick the better engine (recall, then published; tie → OCR, cheaper).
 *   6. KEEP-BEST gate vs the EXISTING deposit (strict Pareto, zero regression):
 *      deposit only when the winner does NOT regress recall AND does NOT regress
 *      published fields AND strictly improves at least one, AND has ≥3 zone codes.
 *      Otherwise the existing deposit is kept untouched.
 *   7. append a PROVENANCE row (the anti-"données de merde" audit) to
 *      work/coverage/normes-provenance.{json,md}.
 *
 * Default is DRY (measure + write provenance only). `--apply` deposits winners
 * (depositZonageNorms overwrites in place; a backup MUST exist first).
 *
 * Usage:
 *   tsx src/zonage-norms-2engine-keepbest.ts [slug ...] [--all-manifest] \
 *     [--residue work/.../residue.json] [--apply] [--engine both|claude|ocr] \
 *     [--claude-lanes 3] [--budget-usd 4] [--max-cities N] [--dpi 150] \
 *     [--claude-timeout-ms 200000]
 */
import { mkdtemp, writeFile, rm, readFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync, execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  mapMarkdownPageToZones,
  createMistralOcrHttpCall,
} from "../../packages/qc-sources/src/sources/grille-ocr-extractor.js";
import type { ZoneNormsT } from "../../packages/qc-sources/src/sources/grille-specifications-parser.js";

import { s3Client, getBytes, exists, listSlugs } from "./lib/s3.js";
import { resolveOcrCall } from "./lib/ocr.js";
import {
  crossValidateZoneCodes,
  depositZonageNorms,
  type CrossValResult,
} from "./lib/zonage-norms.js";
import {
  extractGrilleClaudeFromPdf,
  CLAUDE_METHODE,
} from "./lib/grille-claude-cli.js";

const execFileP = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const MUNIS_JSON = join(REPO, "work", "zonage-norms", "munis.json");
const LOCAL_GRILLE_DIR = join(REPO, "work", "zonage-norms");
const GRILLE_PREFIX = "sources/qc-zonage-grilles";
const PROVENANCE_DIR = join(REPO, "work", "coverage");
const PROVENANCE_JSON = join(PROVENANCE_DIR, "normes-provenance.json");
const PROVENANCE_MD = join(PROVENANCE_DIR, "normes-provenance.md");
/** Pages per OCR call (gs /prepress slices stay well under the upload ceiling). */
const CHUNK_PAGES = 8;

// ───────────────────────────────────────────────────────────────────────────
//  Config / manifest helpers.
// ───────────────────────────────────────────────────────────────────────────

interface MuniCfg {
  slug: string;
  route?: string;
  first?: number;
  last?: number;
  pages?: number;
  reglement?: string | number;
  sourceUrl?: string;
}

interface ManEntry {
  slug: string;
  source_url: string;
  methode: string;
  reglement?: string;
  zone_rows: number;
  unique_zone_codes: number;
  published_field_pct: number;
  crossval?: { gridFound: boolean; sigZoneCodes: number; overlap: number; recoupSig: number };
}

function loadMunis(): Map<string, MuniCfg> {
  if (!existsSync(MUNIS_JSON)) return new Map();
  const raw = JSON.parse(readFileSync(MUNIS_JSON, "utf8")) as unknown;
  const arr: MuniCfg[] = Array.isArray(raw)
    ? (raw as MuniCfg[])
    : ((raw as { munis?: MuniCfg[] }).munis ?? []);
  const m = new Map<string, MuniCfg>();
  for (const x of arr) if (x && x.slug) m.set(x.slug, x);
  return m;
}

function publishedCount(z: ZoneNormsT): number {
  const fs = [
    z.densite, z.hauteur_min, z.hauteur_max, z.frontage_min, z.superficie_min,
    z.marges.avant_min, z.marges.laterale_min, z.marges.arriere_min,
  ];
  return fs.filter((f) => f && f.value !== null).length;
}
function totalPublished(zones: ZoneNormsT[]): number {
  return zones.reduce((s, z) => s + publishedCount(z), 0);
}

function pdfPageCount(pdfPath: string): number {
  const r = spawnSync("pdfinfo", [pdfPath], { encoding: "utf8" });
  const m = r.stdout?.match(/Pages:\s+(\d+)/);
  return m ? Number(m[1]) : 0;
}

/**
 * Sorted, de-duplicated page numbers where OCR found grille zones. Read from the
 * `zone_page` provenance ("PAGE N ZONE X") the OCR mapper stamps. Used to target
 * Engine B at exactly the grille pages for cities with no calibrated munis range.
 */
function ocrGrillePages(zones: ZoneNormsT[]): number[] {
  const pages = new Set<number>();
  for (const z of zones) {
    const m = /^PAGE\s+(\d+)\b/.exec(z.zone_page);
    if (m) pages.add(Number(m[1]));
  }
  return [...pages].sort((a, b) => a - b);
}

/** Merge per-page zones by zone code, preferring the row with more published values. */
function mergeByZone(zones: ZoneNormsT[]): ZoneNormsT[] {
  const byZone = new Map<string, ZoneNormsT>();
  for (const zn of zones) {
    const k = zn.zone_code.toUpperCase().replace(/\s+/g, "");
    const prev = byZone.get(k);
    if (!prev || publishedCount(zn) > publishedCount(prev)) byZone.set(k, zn);
  }
  return [...byZone.values()];
}

// ───────────────────────────────────────────────────────────────────────────
//  Engine A — chunked OCR over [first,last] (gs /prepress slices; per-chunk
//  try/catch). Mirrors the proven path in zonage-norms-reocr-keepbest.ts.
// ───────────────────────────────────────────────────────────────────────────

async function ocrEngine(
  sourcePdf: string,
  first: number,
  last: number,
  ocrCall: (p: string) => Promise<{ pages: Array<{ markdown: string }>; pagesProcessed: number }>,
  costPerPage: number,
  opts: { source_url: string; snapshot: string; methode: string },
): Promise<{ zones: ZoneNormsT[]; usd: number; pagesBilled: number; reasons: string[] }> {
  const dir = await mkdtemp(join(tmpdir(), "2eng-ocr-"));
  const zones: ZoneNormsT[] = [];
  let pagesBilled = 0;
  const reasons: string[] = [];
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  try {
    for (let start = first; start <= last; start += CHUNK_PAGES) {
      const end = Math.min(start + CHUNK_PAGES - 1, last);
      const chunkPdf = join(dir, `chunk-${start}-${end}.pdf`);
      try {
        await execFileP("gs", [
          "-sDEVICE=pdfwrite", "-dNOPAUSE", "-dBATCH", "-dQUIET", "-dSAFER",
          "-dPDFSETTINGS=/prepress",
          `-dFirstPage=${start}`, `-dLastPage=${end}`,
          `-sOutputFile=${chunkPdf}`, sourcePdf,
        ], { maxBuffer: 256 * 1024 * 1024 });
      } catch (e) {
        reasons.push(`gs ${start}-${end}: ${(e instanceof Error ? e.message : String(e)).slice(0, 50)}`);
        continue;
      }
      if (!existsSync(chunkPdf)) { reasons.push(`gs ${start}-${end}: no output`); continue; }
      let ok = false;
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        try {
          const res = await ocrCall(chunkPdf);
          pagesBilled += res.pagesProcessed;
          res.pages.forEach((pg, idx) => {
            zones.push(...mapMarkdownPageToZones(pg.markdown, start + idx, opts));
          });
          ok = true;
        } catch (e) {
          if (attempt === 0) { await sleep(1500); continue; }
          reasons.push(`ocr ${start}-${end}: ${(e instanceof Error ? e.message : String(e)).slice(0, 60)}`);
        }
      }
      await rm(chunkPdf, { force: true }).catch(() => undefined);
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
  return { zones, usd: pagesBilled * costPerPage, pagesBilled, reasons };
}

// ───────────────────────────────────────────────────────────────────────────
//  Provenance registry (the anti-"données de merde" audit).
// ───────────────────────────────────────────────────────────────────────────

type Winner = "ocr-4.0" | "claude-4.8" | "kept-existing" | "skip-no-grille" | "error";

interface ProvenanceRow {
  slug: string;
  gridFound: boolean;
  sigZoneCodes: number;
  /** recall = SIG overlap when gridFound, else distinct zone codes. */
  existing_recall: number;
  existing_published: number;
  existing_methode: string;
  engineA_ocr_recall: number;
  engineA_ocr_published: number;
  engineA_ocr_usd: number;
  engineB_claude_recall: number;
  engineB_claude_published: number;
  engineB_claude_pages: number;
  engineB_claude_seconds: number;
  winner: Winner;
  sig_overlap: number;
  invention_ok: true;
  raison_si_garde: string;
  deposited: boolean;
  retested_at: string;
}

/**
 * Load the prior provenance registry (if any). Lets a RESUMED run merge its rows
 * into the full audit instead of clobbering the cities it did not re-process.
 */
function loadExistingProvenance(): ProvenanceRow[] {
  if (!existsSync(PROVENANCE_JSON)) return [];
  try {
    const j = JSON.parse(readFileSync(PROVENANCE_JSON, "utf8")) as { rows?: ProvenanceRow[] };
    return Array.isArray(j.rows) ? j.rows : [];
  } catch {
    return [];
  }
}

async function writeProvenance(runRows: ProvenanceRow[]): Promise<void> {
  await mkdir(PROVENANCE_DIR, { recursive: true });
  // Merge by slug: this run's rows take precedence; prior rows for cities NOT in
  // this run are preserved verbatim (resumable, no audit loss).
  const bySlug = new Map<string, ProvenanceRow>();
  for (const r of loadExistingProvenance()) bySlug.set(r.slug, r);
  for (const r of runRows) bySlug.set(r.slug, r);
  const rows = [...bySlug.values()];
  await writeFile(PROVENANCE_JSON, JSON.stringify({ updated_at: new Date().toISOString(), rows }, null, 2));
  const aWin = rows.filter((r) => r.winner === "ocr-4.0").length;
  const bWin = rows.filter((r) => r.winner === "claude-4.8").length;
  const kept = rows.filter((r) => r.winner === "kept-existing").length;
  const dep = rows.filter((r) => r.deposited).length;
  const lines: string[] = [];
  lines.push("# Registre de provenance — normes 2-moteurs (keep-best)");
  lines.push("");
  lines.push(`_Généré ${new Date().toISOString()} — ${rows.length} villes._`);
  lines.push("");
  lines.push(`**Gagnants:** OCR-4.0 = ${aWin} · Claude-4.8 = ${bWin} · existant gardé = ${kept} · déposés (apply) = ${dep}`);
  lines.push("");
  lines.push("Recall = recoupement SIG si grille SIG dispo, sinon nb de zone_codes distincts. " +
    "Anti-invention: garde `buildVisionField` partagée (verbatim ou null) → invention_ok partout.");
  lines.push("");
  lines.push("| ville | grilleSIG | recall exist | recall OCR | recall Claude | gagnant | publié e/O/C | sig_ovlp | déposé | raison garde |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const r of [...rows].sort((a, b) => a.slug.localeCompare(b.slug))) {
    lines.push(
      `| ${r.slug} | ${r.gridFound ? r.sigZoneCodes : "—"} | ${r.existing_recall} | ${r.engineA_ocr_recall} | ${r.engineB_claude_recall} | ${r.winner} | ${r.existing_published}/${r.engineA_ocr_published}/${r.engineB_claude_published} | ${r.sig_overlap} | ${r.deposited ? "✓" : ""} | ${r.raison_si_garde} |`,
    );
  }
  lines.push("");
  await writeFile(PROVENANCE_MD, lines.join("\n"));
}

// ───────────────────────────────────────────────────────────────────────────
//  PDF resolution: staged S3 → local → download from source_url.
// ───────────────────────────────────────────────────────────────────────────

function findLocalGrille(slug: string): string | null {
  const dir = join(LOCAL_GRILLE_DIR, slug);
  if (!existsSync(dir)) return null;
  try {
    const pdfs = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf"));
    if (pdfs.length === 0) return null;
    // Prefer a file named like the main grille; else the first.
    const pref = pdfs.find((f) => /grille|original|annexe/i.test(f)) ?? pdfs[0]!;
    return join(dir, pref);
  } catch {
    return null;
  }
}

async function downloadPdf(url: string, dest: string): Promise<void> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60_000);
  try {
    const resp = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length < 1024 || buf.subarray(0, 5).toString("latin1") !== "%PDF-") {
      throw new Error("not a PDF");
    }
    await writeFile(dest, buf);
  } finally {
    clearTimeout(t);
  }
}

// ───────────────────────────────────────────────────────────────────────────
//  Concurrency pool.
// ───────────────────────────────────────────────────────────────────────────

async function pool<T>(items: T[], lanes: number, worker: (item: T, idx: number) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.max(1, lanes) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      await worker(items[i]!, i);
    }
  });
  await Promise.all(runners);
}

// ───────────────────────────────────────────────────────────────────────────
//  Main.
// ───────────────────────────────────────────────────────────────────────────

interface ResidueCand { slug: string; sourceUrl: string; route?: string; first?: number; last?: number; pages?: number; }

function argVal(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const allManifest = argv.includes("--all-manifest");
  const engine = (argVal(argv, "--engine") ?? "both") as "both" | "claude" | "ocr";
  const claudeLanes = Number(argVal(argv, "--claude-lanes") ?? "3");
  const budgetUsd = Number(argVal(argv, "--budget-usd") ?? "4");
  const maxCities = Number(argVal(argv, "--max-cities") ?? "0");
  const dpi = Number(argVal(argv, "--dpi") ?? "150");
  const claudeTimeoutMs = Number(argVal(argv, "--claude-timeout-ms") ?? "200000");
  const claudePageCap = Number(argVal(argv, "--claude-page-cap") ?? "40");
  const residuePath = argVal(argv, "--residue");

  const optFlags = new Set(["--engine", "--claude-lanes", "--budget-usd", "--max-cities", "--dpi", "--claude-timeout-ms", "--claude-page-cap", "--residue"]);
  const slugsArg = argv.filter((a, i) => !a.startsWith("--") && !optFlags.has(argv[i - 1] ?? ""));

  const residueCands: ResidueCand[] = residuePath
    ? (JSON.parse(readFileSync(residuePath, "utf8")) as ResidueCand[])
    : [];
  const residueBySlug = new Map(residueCands.map((c) => [c.slug, c]));

  const s3 = s3Client();
  const ocr = resolveOcrCall();
  if (engine !== "claude" && !ocr.config.apiKey) throw new Error("OCR_API_KEY/MISTRAL_API_KEY not set");
  const ocrCall = createMistralOcrHttpCall(ocr.config) as unknown as
    (p: string) => Promise<{ pages: Array<{ markdown: string }>; pagesProcessed: number }>;

  const man = JSON.parse((await getBytes(s3, "registry/qc-zonage-norms/manifest.json")).toString("utf8"));
  const entries = man.entries as ManEntry[];
  const bySlug = new Map(entries.map((e) => [e.slug, e]));
  const munis = loadMunis();

  let targets: string[];
  if (residuePath) targets = residueCands.map((c) => c.slug);
  else if (slugsArg.length > 0) targets = slugsArg;
  else if (allManifest) targets = entries.map((e) => e.slug);
  else targets = [];
  if (maxCities > 0) targets = targets.slice(0, maxCities);

  console.error(
    `[2eng] engine=${engine} lanes=${claudeLanes} apply=${apply} ocr=${ocr.config.model} ` +
    `targets=${targets.length}${residuePath ? " (residue)" : ""}`,
  );

  const snapshot = new Date().toISOString().slice(0, 10);
  const rows: ProvenanceRow[] = [];
  let totalOcrUsd = 0;
  let totalClaudeSeconds = 0;
  let globalClaudeRateLimited = false;

  // Resolve a city: returns its provenance row. Heavy work (engines) runs here.
  const processCity = async (slug: string): Promise<void> => {
    const base = bySlug.get(slug);
    const rc = residueBySlug.get(slug);
    const cfg: MuniCfg | undefined = rc
      ? { slug, route: rc.route, first: rc.first, last: rc.last, pages: rc.pages, sourceUrl: rc.sourceUrl }
      : munis.get(slug);

    const gridFoundBase = base?.crossval?.gridFound ?? false;
    const sigZoneCodesBase = base?.crossval?.sigZoneCodes ?? 0;
    const existingRecall = gridFoundBase ? (base?.crossval?.overlap ?? 0) : (base?.unique_zone_codes ?? 0);
    const existingPublished = base ? Math.round((base.zone_rows * 8 * base.published_field_pct) / 100) : 0;

    const row: ProvenanceRow = {
      slug, gridFound: gridFoundBase, sigZoneCodes: sigZoneCodesBase,
      existing_recall: existingRecall, existing_published: existingPublished,
      existing_methode: base?.methode ?? "—",
      engineA_ocr_recall: 0, engineA_ocr_published: 0, engineA_ocr_usd: 0,
      engineB_claude_recall: 0, engineB_claude_published: 0, engineB_claude_pages: 0, engineB_claude_seconds: 0,
      winner: "error", sig_overlap: 0, invention_ok: true, raison_si_garde: "",
      deposited: false, retested_at: new Date().toISOString(),
    };

    const dir = await mkdtemp(join(tmpdir(), `2eng-${slug}-`));
    let pdfPath: string | null = null;
    try {
      // Resolve PDF — MATCHED PAIR. The munis page range {first,last} is calibrated
      // to munis.sourceUrl (the grille-only PDF), NOT to the staged S3 doc, which may
      // be a different full-reglement PDF (e.g. stratford: staged = 174-page règlement,
      // range 1-8 = the 8-page STR_GRILLE). So when a munis range exists, download the
      // range-calibrated URL; otherwise prefer the staged S3 doc (whole-doc OCR), then
      // the manifest source_url.
      const stagedKey = `${GRILLE_PREFIX}/${slug}.pdf`;
      const local = findLocalGrille(slug);
      const munisUrl = cfg?.sourceUrl && /^https?:/.test(cfg.sourceUrl) ? cfg.sourceUrl : undefined;
      const baseUrl = base?.source_url && /^https?:/.test(base.source_url) ? base.source_url : undefined;
      const hasMunisRange = cfg?.first != null && cfg?.last != null;
      const sourceUrlMeta = munisUrl ?? baseUrl ?? base?.source_url ?? "non-disponible";

      if (hasMunisRange && (munisUrl ?? baseUrl)) {
        pdfPath = join(dir, "grille.pdf");
        await downloadPdf((munisUrl ?? baseUrl)!, pdfPath);
      } else if (await exists(s3, stagedKey)) {
        pdfPath = join(dir, "grille.pdf");
        await writeFile(pdfPath, await getBytes(s3, stagedKey));
      } else if (local) {
        pdfPath = local;
      } else if (baseUrl ?? munisUrl) {
        pdfPath = join(dir, "grille.pdf");
        await downloadPdf((baseUrl ?? munisUrl)!, pdfPath);
      } else {
        row.winner = "skip-no-grille";
        row.raison_si_garde = "aucune grille (S3/local/url) disponible";
        return;
      }

      const pageCount = pdfPageCount(pdfPath);
      const ocrFirst = hasMunisRange ? cfg!.first! : 1;
      const ocrLastFull = hasMunisRange ? Math.min(cfg!.last!, pageCount || cfg!.last!) : (pageCount || 1);

      // ── Engine A (OCR) FIRST — cheap, and it identifies the grille pages so
      //    Engine B (expensive, rate-limited) can target ONLY those pages. ──
      let ocrRes: Awaited<ReturnType<typeof ocrEngine>> | null = null;
      let ocrZones: ZoneNormsT[] = [];
      if (engine !== "claude") {
        const maxByBudget = Math.max(1, Math.floor(budgetUsd / ocr.costPerPage));
        const ocrLast = Math.min(ocrLastFull, ocrFirst - 1 + maxByBudget);
        ocrRes = await ocrEngine(pdfPath, ocrFirst, ocrLast, ocrCall, ocr.costPerPage,
          { source_url: sourceUrlMeta, snapshot, methode: ocr.methode });
        ocrZones = mergeByZone(ocrRes.zones);
        totalOcrUsd += ocrRes.usd;
        row.engineA_ocr_usd = Math.round(ocrRes.usd * 1000) / 1000;
        row.engineA_ocr_published = totalPublished(ocrZones);
      }

      // ── Determine Engine B page window ──
      //   - munis range → use it (capped);
      //   - else the contiguous span of pages where OCR found grille zones (capped);
      //   - else, when OCR ran and found nothing, skip B (no grille to read — don't
      //     burn subscription budget on non-grille pages).
      let cFirst: number | null = null;
      let cLast: number | null = null;
      if (engine !== "ocr" && !globalClaudeRateLimited) {
        if (hasMunisRange) {
          cFirst = ocrFirst;
          cLast = Math.min(ocrLastFull, ocrFirst - 1 + claudePageCap);
        } else {
          const gp = ocrGrillePages(ocrRes ? ocrRes.zones : []);
          if (gp.length) {
            cFirst = gp[0]!;
            cLast = Math.min(gp[gp.length - 1]!, cFirst - 1 + claudePageCap);
          } else if (!ocrRes) {
            // claude-only mode with no range → fall back to the head of the doc.
            cFirst = 1;
            cLast = Math.min(pageCount || claudePageCap, claudePageCap);
          }
        }
      }

      // ── Engine B (Claude) over the targeted window ──
      let claudeZones: ZoneNormsT[] = [];
      if (cFirst != null && cLast != null && cLast >= cFirst) {
        const claudeRes = await extractGrilleClaudeFromPdf(pdfPath, cFirst, cLast, {
          source_url: sourceUrlMeta, snapshot, dpi,
          cli: { timeoutMs: claudeTimeoutMs },
        });
        claudeZones = mergeByZone(claudeRes.zones);
        totalClaudeSeconds += claudeRes.durationMs / 1000;
        row.engineB_claude_pages = claudeRes.pagesRead;
        row.engineB_claude_seconds = Math.round(claudeRes.durationMs / 1000);
        row.engineB_claude_published = totalPublished(claudeZones);
        if (claudeRes.rateLimited) globalClaudeRateLimited = true;
      } else if (globalClaudeRateLimited && engine !== "ocr") {
        row.raison_si_garde = "claude rate-limit (sauté); ";
      }

      // ── Cross-validate each engine ──
      const ocrCross: CrossValResult = ocrZones.length
        ? await crossValidateZoneCodes(s3, slug, ocrZones)
        : { gridFound: gridFoundBase, sigZoneCodes: sigZoneCodesBase, extractedZoneCodes: 0, overlap: 0, recoupExtracted: 0, recoupSig: 0, extractedNotInSig: [] };
      const claudeCross: CrossValResult = claudeZones.length
        ? await crossValidateZoneCodes(s3, slug, claudeZones)
        : { gridFound: gridFoundBase, sigZoneCodes: sigZoneCodesBase, extractedZoneCodes: 0, overlap: 0, recoupExtracted: 0, recoupSig: 0, extractedNotInSig: [] };
      const gridFound = ocrCross.gridFound || claudeCross.gridFound || gridFoundBase;

      row.engineA_ocr_recall = gridFound ? ocrCross.overlap : ocrCross.extractedZoneCodes;
      row.engineB_claude_recall = gridFound ? claudeCross.overlap : claudeCross.extractedZoneCodes;

      // ── Pick the better engine (recall, then published; tie → OCR cheaper) ──
      const aRecall = row.engineA_ocr_recall, aPub = row.engineA_ocr_published;
      const bRecall = row.engineB_claude_recall, bPub = row.engineB_claude_published;
      let winnerEngine: "ocr" | "claude";
      if (bRecall > aRecall || (bRecall === aRecall && bPub > aPub)) winnerEngine = "claude";
      else winnerEngine = "ocr";
      // If the chosen engine produced nothing but the other did, switch.
      if (winnerEngine === "claude" && claudeZones.length < 3 && ocrZones.length >= 3) winnerEngine = "ocr";
      if (winnerEngine === "ocr" && ocrZones.length < 3 && claudeZones.length >= 3) winnerEngine = "claude";

      const winZones = winnerEngine === "claude" ? claudeZones : ocrZones;
      const winRecall = winnerEngine === "claude" ? bRecall : aRecall;
      const winPub = winnerEngine === "claude" ? bPub : aPub;
      const winCross = winnerEngine === "claude" ? claudeCross : ocrCross;
      const winMethode = winnerEngine === "claude" ? CLAUDE_METHODE : ocr.methode;
      row.sig_overlap = winCross.overlap;

      // ── KEEP-BEST gate vs existing (strict Pareto, zero regression) ──
      const recallOk = winRecall >= existingRecall;
      const payloadOk = winPub >= existingPublished;
      const strictGain = winRecall > existingRecall || winPub > existingPublished;
      const enoughZones = winZones.length >= 3;
      const beatsExisting = recallOk && payloadOk && strictGain && enoughZones;

      if (beatsExisting) {
        row.winner = winnerEngine === "claude" ? "claude-4.8" : "ocr-4.0";
        row.raison_si_garde += `recall ${existingRecall}->${winRecall}, publié ${existingPublished}->${winPub}`;
        if (apply) {
          await depositZonageNorms({
            s3, slug, zones: winZones,
            meta: {
              source_url: sourceUrlMeta,
              ...(base?.reglement ? { reglement: base.reglement } : {}),
              methode: winMethode, snapshot,
            },
            crossval: winCross, idempotent: false,
          });
          row.deposited = true;
        }
      } else {
        row.winner = "kept-existing";
        const why = !enoughZones ? "moins de 3 zones extraites"
          : !recallOk ? `recall régresserait ${existingRecall}->${winRecall}`
          : !payloadOk ? `payload régresserait ${existingPublished}->${winPub}`
          : "aucun gain strict (égalité)";
        row.raison_si_garde += why;
      }
    } catch (e) {
      row.winner = "error";
      row.raison_si_garde = (e instanceof Error ? e.message : String(e)).slice(0, 160);
    } finally {
      // Purge temp dir (downloaded/staged PDF). Local source PDFs are left in place.
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      rows.push(row);
      // Incremental provenance write (crash-safe).
      await writeProvenance(rows).catch(() => undefined);
      console.error(
        `[${slug}] ${row.winner} grid=${row.gridFound} ` +
        `recall e/O/C ${row.existing_recall}/${row.engineA_ocr_recall}/${row.engineB_claude_recall} ` +
        `pub ${row.existing_published}/${row.engineA_ocr_published}/${row.engineB_claude_published} ` +
        `claudePages=${row.engineB_claude_pages} ${row.engineB_claude_seconds}s :: ${row.raison_si_garde}`,
      );
    }
  };

  await pool(targets, claudeLanes, async (slug) => { await processCity(slug); });

  await writeProvenance(rows);

  const summary = {
    apply, engine, targets: targets.length,
    ocrWins: rows.filter((r) => r.winner === "ocr-4.0").length,
    claudeWins: rows.filter((r) => r.winner === "claude-4.8").length,
    keptExisting: rows.filter((r) => r.winner === "kept-existing").length,
    skipNoGrille: rows.filter((r) => r.winner === "skip-no-grille").length,
    errors: rows.filter((r) => r.winner === "error").length,
    deposited: rows.filter((r) => r.deposited).length,
    totalOcrUsd: Math.round(totalOcrUsd * 1000) / 1000,
    totalClaudeMinutes: Math.round(totalClaudeSeconds / 6) / 10,
    claudeRateLimited: globalClaudeRateLimited,
    provenance: PROVENANCE_JSON,
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
