/**
 * run-claude48-normes-bench — the CLAUDE 4.8 (Opus, xhigh) volet of the vision/OCR
 * benchmark for the `qc-zonage-norms` residue.
 *
 * WHY / SCOPE
 * ----------
 * A codex agent runs the GPT-5.5 / 5.4 / Mistral-OCR-4 engines in parallel; THIS
 * script measures Claude Opus 4.8 (xhigh reasoning) reading the SAME hard grilles
 * through the wired Engine-B path (local `claude -p`, OAuth subscription, verified
 * apiKeySource:none → never bills). It reuses the FROZEN Engine-B pieces
 * (`grille-claude-cli.ts`: prompt, parse, guard-mapper, render/slice) verbatim and
 * adds ONLY per-call TOKEN + cost + time capture (the production engine drops usage).
 *
 * ANTI-POLLUTION (bench-only): reads S3 truth-ground READ-ONLY (SIG grille +
 * norms-manifest), NEVER deposits, NEVER touches coverage-matrix.json / the norms
 * manifest / provenance. All output lands under work/bench/.
 *
 * CORRECTNESS is measured against the muni's SIG grille (vérité-terrain) via the
 * frozen `crossValidateZoneCodes` (exact-canonical + numeric-bridge overlap):
 *   - recoupExtracted = overlap / codes-Claude-read   (precision; window-fair)
 *   - recoupSig       = overlap / codes-SIG           (recall; capped by --max-pages)
 *   - publishedFieldPct = share of the 8 norm fields Claude published a value for
 *   - hallucination = codes Claude read that the SIG grille does NOT know
 * Anti-invention is inherited WHOLE from the frozen buildVisionField guard
 * (verbatim-or-null) → a fabricated value is structurally impossible.
 *
 * Usage (committed runner):
 *   npx tsx acquisition/src/bench/run-claude48-normes-bench.ts --probe
 *   npx tsx acquisition/src/bench/run-claude48-normes-bench.ts \
 *      [--sample work/bench/sample-20.json] [--slugs a,b,c] [--max-pages 6] \
 *      [--lanes 2] [--dpi 150] [--limit N] [--timeout-ms 220000] [--out work/bench]
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  buildClaudePrompt,
  parseClaudeContent,
  mapClaudeExtractionToZones,
  renderPageToPng,
  CLAUDE_MODEL,
  CLAUDE_EFFORT,
  CLAUDE_METHODE,
} from "../lib/grille-claude-cli.js";
import { locateGrillePages } from "../../../packages/qc-sources/src/sources/grille-page-locator.js";
import { classifyGrillePdf } from "../../../packages/qc-sources/src/sources/grille-pdf-classifier.js";
import type { ZoneNormsT } from "../../../packages/qc-sources/src/sources/grille-specifications-parser.js";

import { s3Client, getBytes, exists } from "../lib/s3.js";
import {
  crossValidateZoneCodes,
  publishedFieldPct,
  resolveGridKey,
  normsKey,
  looksLikeTableOfContents,
  ZONAGE_NORMS_MANIFEST_KEY,
  type CrossValResult,
} from "../lib/zonage-norms.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const WORK = join(REPO, "work", "zonage-norms");
const BENCH_DIR = join(REPO, "work", "bench");

// ── args ────────────────────────────────────────────────────────────────────
function arg(k: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
function has(k: string): boolean {
  return process.argv.includes(`--${k}`);
}

// ── pdf helpers ───────────────────────────────────────────────────────────────
function pdfPageCount(pdf: string): number {
  const r = spawnSync("pdfinfo", [pdf], { encoding: "utf8" });
  const m = r.stdout?.match(/Pages:\s+(\d+)/);
  return m?.[1] ? Number(m[1]) : 0;
}
function pageTexts(pdf: string): string[] {
  const r = spawnSync("pdftotext", ["-q", "-layout", "-enc", "UTF-8", pdf, "-"], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.status !== 0) return [];
  const parts = (r.stdout ?? "").split("\f");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

interface Window {
  first: number;
  last: number;
  pageCount: number;
  textChars: number;
  layout: string;
  grillePages: number;
}

/** Verified per-slug grille windows (work/bench/windows.json): { "<slug>": {first,last} }. */
function loadWindows(): Record<string, { first?: number; last?: number }> {
  const p = join(BENCH_DIR, "windows.json");
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Record<string, { first?: number; last?: number }>;
  } catch {
    return {};
  }
}

// Zone-code-density fallback (mirrors the committed `detectGridPages` in
// zonage-norms-run.ts): when the grille-title locator finds nothing but the doc
// carries a text layer, a grille annex page shows ≥6 DISTINCT zone-code tokens on a
// SINGLE header line (the zones-in-columns band). Used only when locateGrillePages
// returns null AND there is substantial text — so the window targets the real deep
// grille (mont-joli p.150+, levis, plaisance) instead of the cover/ToC head.
const AUTO_GRID_MIN_CODES = 6;
const ZONE_CODE_TOKEN = /\b[A-Z]{1,4}-?\d{1,3}\b/g;
const GRID_HEADER_EXCLUDE = /\b(?:ARTICLES?|R[ÈE]GLEMENTS?|REGLEMENTS?)\b|\b(?:19|20)\d{2}\b/i;

function detectGridWindow(texts: string[]): { first: number; last: number; hits: number } | null {
  // Two signals, in order of specificity:
  //  (1) a single header LINE with ≥AUTO_GRID_MIN_CODES distinct zone codes (clean
  //      zones-in-columns band) — start the window there;
  //  (2) else the PAGE-WIDE distinct-zone-code density peak (a scanned/OCR grille
  //      lists 10-40 zone codes per page; a cover/ToC/prose page lists few) — target
  //      the contiguous dense cluster around the peak.
  const lineHits: number[] = [];
  const perPage: number[] = [];
  for (let i = 0; i < texts.length; i++) {
    const pageCodes = new Set<string>();
    let lineHit = false;
    // Anti-false-positive: a table-of-contents / sommaire page lists many usage-class
    // codes (H2/C1/I1…) with page numbers and otherwise trips the density heuristic
    // (saint-pascal p4). Never a grille TABLE page (production guard, reused verbatim).
    if (looksLikeTableOfContents(texts[i] ?? "")) {
      perPage[i] = 0;
      continue;
    }
    for (const line of (texts[i] ?? "").split(/\r?\n/)) {
      if (GRID_HEADER_EXCLUDE.test(line)) continue;
      const codes = new Set<string>();
      for (const m of line.matchAll(ZONE_CODE_TOKEN)) {
        codes.add(m[0].toUpperCase());
        pageCodes.add(m[0].toUpperCase());
      }
      if (codes.size >= AUTO_GRID_MIN_CODES) lineHit = true;
    }
    if (lineHit) lineHits.push(i + 1);
    perPage[i] = pageCodes.size;
  }
  if (lineHits.length > 0) return { first: Math.min(...lineHits), last: Math.max(...lineHits), hits: lineHits.length };
  // Page-wide density peak.
  let peak = 0;
  let peakIdx = -1;
  for (let i = 0; i < perPage.length; i++) if ((perPage[i] ?? 0) > peak) { peak = perPage[i]!; peakIdx = i; }
  if (peakIdx < 0 || peak < 10) return null; // no grille-dense page — pure prose/scan
  const thr = Math.max(8, Math.floor(peak * 0.5));
  let lo = peakIdx;
  let hi = peakIdx;
  while (lo - 1 >= 0 && (perPage[lo - 1] ?? 0) >= thr) lo--;
  while (hi + 1 < perPage.length && (perPage[hi + 1] ?? 0) >= thr) hi++;
  const dense = perPage.filter((c) => (c ?? 0) >= thr).length;
  return { first: lo + 1, last: hi + 1, hits: dense };
}

/** Pick the grille page window. Priority:
 *  1. zone-code DENSITY (the production `--auto-grid-page` signal: a real grille
 *     TABLE page carries many zone codes) — most reliable; a prose page that merely
 *     MENTIONS "grille des spécifications" carries no code band, so it is not picked;
 *  2. grille-TITLE locator (title + rows) — fallback for clean native grilles;
 *  3. head-of-doc — pure image scan with no text signal at all.
 *  An explicit `--first`/`--last` (per-slug override map) always wins (handled by caller). */
function pickWindow(pdf: string, maxPages: number, override?: { first?: number; last?: number }): Window {
  const pageCount = pdfPageCount(pdf);
  const texts = pageTexts(pdf);
  const textChars = texts.reduce((n, t) => n + t.trim().length, 0);
  // Verified per-slug override (work/bench/windows.json) always wins.
  if (override && override.first) {
    const first = override.first;
    const last = Math.min(override.last ?? first - 1 + maxPages, first - 1 + maxPages, pageCount || (override.last ?? first));
    return { first, last, pageCount, textChars, layout: "override", grillePages: 0 };
  }
  if (textChars > 2000) {
    // PRODUCTION content classifier: signal C (zone-code column header, prose- and
    // ToC-excluded) pinpoints the actual transposed grid; else the union grille span.
    const cls = classifyGrillePdf(texts);
    const s = cls.signals;
    if (s.zoneHeaderPages > 0 && s.firstZoneHeaderPage > 0) {
      const first = s.firstZoneHeaderPage;
      const last = Math.min(s.lastZoneHeaderPage, first - 1 + maxPages, pageCount || s.lastZoneHeaderPage);
      return { first, last, pageCount, textChars, layout: "zone-header", grillePages: s.zoneHeaderPages };
    }
    if (s.grillePages > 0 && s.firstGrillePage > 0) {
      const first = s.firstGrillePage;
      const last = Math.min(s.lastGrillePage, first - 1 + maxPages, pageCount || s.lastGrillePage);
      return { first, last, pageCount, textChars, layout: `grille-${cls.kind}`, grillePages: s.grillePages };
    }
    // Text present but no grille table signal — try the raw zone-code density band.
    const dg = detectGridWindow(texts);
    if (dg) {
      const first = dg.first;
      const last = Math.min(dg.last, first - 1 + maxPages, pageCount || dg.last);
      return { first, last, pageCount, textChars, layout: "grid-density", grillePages: dg.hits };
    }
  }
  const loc = texts.length ? locateGrillePages(texts) : null;
  if (loc) {
    const first = loc.firstPage;
    const last = Math.min(loc.lastPage, first - 1 + maxPages, pageCount || loc.lastPage);
    return { first, last, pageCount, textChars, layout: loc.layout, grillePages: loc.grillePageCount };
  }
  const last = Math.min(maxPages, pageCount || maxPages);
  return { first: 1, last, pageCount, textChars, layout: "image-scan", grillePages: 0 };
}

// ── Claude CLI call WITH usage capture (mirror of runClaudeCli + usage/cost) ──
interface ClaudeUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  costUsd: number;
  durationMs: number;
  resultText: string;
}

async function runClaudeWithUsage(
  imagePath: string,
  prompt: string,
  timeoutMs: number,
): Promise<ClaudeUsage> {
  const bytes = await readFile(imagePath);
  const userMessage = {
    type: "user",
    message: {
      role: "user",
      content: [
        { type: "text", text: prompt },
        {
          type: "image",
          source: { type: "base64", media_type: "image/png", data: bytes.toString("base64") },
        },
      ],
    },
  };
  const args = [
    "-p",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--verbose",
    "--model", CLAUDE_MODEL,
    "--effort", CLAUDE_EFFORT,
    "--tools", "",
    "--no-session-persistence",
  ];
  const t0 = Date.now();
  return await new Promise<ClaudeUsage>((resolvePromise, reject) => {
    const child = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`claude -p exceeded ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      let resultText: string | null = null;
      let costUsd = 0;
      let resultIsError = false;
      let rateLimited = false;
      const u = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 };
      for (const line of stdout.split("\n")) {
        const s = line.trim();
        if (!s.startsWith("{")) continue;
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(s) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (msg["type"] === "rate_limit_event") {
          const info = (msg["rate_limit_info"] ?? {}) as Record<string, unknown>;
          if (info["status"] && info["status"] !== "allowed") rateLimited = true;
        }
        if (msg["type"] === "result") {
          resultText = typeof msg["result"] === "string" ? (msg["result"] as string) : null;
          costUsd = typeof msg["total_cost_usd"] === "number" ? (msg["total_cost_usd"] as number) : 0;
          resultIsError = msg["is_error"] === true;
          const usage = (msg["usage"] ?? {}) as Record<string, unknown>;
          const num = (k: string): number => (typeof usage[k] === "number" ? (usage[k] as number) : 0);
          u.inputTokens = num("input_tokens");
          u.outputTokens = num("output_tokens");
          u.cacheReadTokens = num("cache_read_input_tokens");
          u.cacheCreateTokens = num("cache_creation_input_tokens");
        }
      }
      if (rateLimited) return reject(new Error("RATE_LIMIT"));
      if (code !== 0 || resultIsError || resultText === null) {
        return reject(new Error(`claude -p exit=${code} is_error=${resultIsError} ${stderr.slice(0, 160)}`));
      }
      resolvePromise({ ...u, costUsd, durationMs: Date.now() - t0, resultText });
    });
    // Guard the stdin socket: if the child exits before we finish writing (early
    // death, rate-limit), the write raises EPIPE as an 'error' event on the socket
    // — unhandled, it crashes the whole process. Swallow it; the close handler above
    // resolves/rejects from the child's actual output/exit code.
    child.stdin.on("error", () => {
      /* EPIPE / broken pipe — child already gone; handled via close */
    });
    try {
      child.stdin.write(JSON.stringify(userMessage) + "\n");
      child.stdin.end();
    } catch {
      /* write after end / EPIPE — ignore; close handler settles the promise */
    }
  });
}

function publishedCount(z: ZoneNormsT): number {
  const fs = [
    z.densite, z.hauteur_min, z.hauteur_max, z.frontage_min, z.superficie_min,
    z.marges.avant_min, z.marges.laterale_min, z.marges.arriere_min,
  ];
  return fs.filter((f) => f && f.value !== null).length;
}
function mergeByZone(zones: ZoneNormsT[]): ZoneNormsT[] {
  const byZone = new Map<string, ZoneNormsT>();
  for (const zn of zones) {
    const k = zn.zone_code.toUpperCase().replace(/\s+/g, "");
    const prev = byZone.get(k);
    if (!prev || publishedCount(zn) > publishedCount(prev)) byZone.set(k, zn);
  }
  return [...byZone.values()];
}

interface ManEntry {
  slug: string;
  unique_zone_codes?: number;
  published_field_pct?: number;
  methode?: string;
  crossval?: { gridFound?: boolean; sigZoneCodes?: number; overlap?: number };
}

interface BenchRow {
  slug: string;
  pdfPages: number;
  textChars: number;
  layout: string;
  windowFirst: number;
  windowLast: number;
  gridFound: boolean;
  sigZoneCodes: number;
  // Claude 4.8 outputs
  pagesRead: number;
  pagesFailed: number;
  zonesRead: number;
  uniqueCodes: number;
  overlap: number;
  numericBridged: number;
  recoupExtracted: number; // precision (window-fair)
  recoupSig: number;       // recall (capped)
  publishedFieldPct: number;
  hallucinationCodes: string[]; // extracted not in SIG (sample)
  // consumption
  inTokens: number;
  outTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  costUsdApiEquiv: number; // CLI-reported would-be API cost; subscription bills $0
  seconds: number;
  // existing deposit reference (known-good)
  existingUniqueCodes: number;
  existingPublishedPct: number;
  existingMethode: string;
  rateLimited: boolean;
  error?: string;
}

// ── sample resolution ─────────────────────────────────────────────────────────
function loadSampleSlugs(): string[] {
  const slugsArg = arg("slugs");
  if (slugsArg) return slugsArg.split(",").map((s) => s.trim()).filter(Boolean);
  const samplePath = arg("sample") ?? join(BENCH_DIR, "sample-20.json");
  if (!existsSync(samplePath)) throw new Error(`sample file not found: ${samplePath} (pass --slugs or create it)`);
  const raw = JSON.parse(readFileSync(samplePath, "utf8")) as unknown;
  const arr: unknown = Array.isArray(raw) ? raw : (raw as { slugs?: unknown }).slugs;
  if (!Array.isArray(arr)) throw new Error("sample file must be an array or { slugs: [...] }");
  return arr.map((x) => (typeof x === "string" ? x : (x as { slug: string }).slug)).filter(Boolean);
}

function localGrille(slug: string): string | null {
  const dir = join(WORK, slug);
  if (!existsSync(dir)) return null;
  try {
    const pdfs = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf"));
    if (!pdfs.length) return null;
    const pref = pdfs.find((f) => /grille/i.test(f)) ?? pdfs[0]!;
    return join(dir, pref);
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  await mkdir(BENCH_DIR, { recursive: true });
  const probe = has("probe");
  const maxPages = Number(arg("max-pages") ?? "6");
  const lanes = Number(arg("lanes") ?? "2");
  const dpi = Number(arg("dpi") ?? "150");
  const timeoutMs = Number(arg("timeout-ms") ?? "220000");
  const limit = arg("limit") ? Number(arg("limit")) : undefined;
  const outDir = arg("out") ?? BENCH_DIR;
  await mkdir(outDir, { recursive: true });

  let slugs = loadSampleSlugs();
  if (limit !== undefined) slugs = slugs.slice(0, limit);

  const WINDOWS = loadWindows();
  const s3 = s3Client();

  // Existing deposit reference (known-good) from the norms manifest (read-only).
  const manBySlug = new Map<string, ManEntry>();
  try {
    if (await exists(s3, ZONAGE_NORMS_MANIFEST_KEY)) {
      const man = JSON.parse((await getBytes(s3, ZONAGE_NORMS_MANIFEST_KEY)).toString("utf8")) as { entries?: ManEntry[] };
      for (const e of man.entries ?? []) manBySlug.set(e.slug, e);
    }
  } catch {
    /* manifest optional */
  }
  const snapshot = new Date().toISOString().slice(0, 10);
  const prompt = buildClaudePrompt();

  // ── PROBE MODE — classify + SIG truth-ground, no Claude. ──
  if (probe) {
    const rows: Array<Record<string, unknown>> = [];
    for (const slug of slugs) {
      const pdf = localGrille(slug);
      if (!pdf) {
        rows.push({ slug, staged: false });
        continue;
      }
      const w = pickWindow(pdf, maxPages, WINDOWS[slug]);
      const gk = await resolveGridKey(s3, slug).catch(() => null);
      let sigCodes = 0;
      if (gk) {
        const cv = await crossValidateZoneCodes(s3, slug, []);
        sigCodes = cv.sigZoneCodes;
      }
      const deposited = await exists(s3, normsKey(slug)).catch(() => false);
      const man = manBySlug.get(slug);
      rows.push({
        slug, staged: true, pdfPages: w.pageCount, textChars: w.textChars, layout: w.layout,
        grillePages: w.grillePages, window: `${w.first}..${w.last}`,
        sigFound: Boolean(gk), sigZoneCodes: sigCodes, deposited,
        existingUniqueCodes: man?.unique_zone_codes ?? 0, existingPublishedPct: man?.published_field_pct ?? 0,
      });
      console.error(
        `[probe] ${slug} staged=${Boolean(pdf)} pages=${w.pageCount} chars=${w.textChars} ` +
          `layout=${w.layout} win=${w.first}..${w.last} sig=${Boolean(gk)}(${sigCodes}) deposited=${deposited}`,
      );
    }
    await writeFile(join(outDir, "probe.json"), JSON.stringify({ generated: new Date().toISOString(), maxPages, rows }, null, 2));
    console.log(JSON.stringify({ probe: true, n: rows.length, out: join(outDir, "probe.json") }, null, 2));
    return;
  }

  // ── RENDER-ONLY (diagnostic; no Claude) — save window PNGs for visual inspection. ──
  if (has("render-only")) {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileP2 = promisify(execFile);
    for (const slug of slugs) {
      const pdf = localGrille(slug);
      if (!pdf) continue;
      const w = pickWindow(pdf, maxPages, WINDOWS[slug]);
      for (let p = w.first; p <= w.last; p++) {
        const prefix = join(outDir, `render-${slug}-p${p}`);
        await execFileP2("pdftoppm", ["-png", "-r", String(dpi), "-f", String(p), "-l", String(p), "-singlefile", pdf, prefix]).catch((e) => console.error(`render ${slug} p${p}: ${e}`));
        console.error(`[render] ${slug} p${p} -> ${prefix}.png`);
      }
    }
    console.log(JSON.stringify({ renderOnly: true, out: outDir }, null, 2));
    return;
  }

  // ── RUN MODE ──
  console.error(`[bench-48] model=${CLAUDE_MODEL} effort=${CLAUDE_EFFORT} slugs=${slugs.length} lanes=${lanes} maxPages=${maxPages} dpi=${dpi}`);
  const rows: BenchRow[] = [];
  let globalRateLimited = false;

  const resultsPath = join(outDir, "claude48-results.json");
  // --resume: pre-load already-processed rows from a prior (possibly crashed) run and
  // skip those slugs, so a partial run can be finished without re-billing completed cities.
  const done = new Set<string>();
  if (has("resume") && existsSync(resultsPath)) {
    try {
      const prev = JSON.parse(readFileSync(resultsPath, "utf8")) as { rows?: BenchRow[] };
      for (const r of prev.rows ?? []) {
        rows.push(r);
        done.add(r.slug);
      }
      console.error(`[bench-48] resume: ${done.size} slug(s) already done — skipping them`);
    } catch {
      /* ignore malformed prior results */
    }
  }
  const writeResults = async (): Promise<void> => {
    const agg = aggregate(rows);
    await writeFile(resultsPath, JSON.stringify({ generated: new Date().toISOString(), model: CLAUDE_MODEL, effort: CLAUDE_EFFORT, methode: CLAUDE_METHODE, maxPages, dpi, aggregate: agg, rows }, null, 2));
    await writeFile(join(outDir, "claude48-normes-bench.md"), renderMarkdown(rows, agg, maxPages));
  };

  const processCity = async (slug: string): Promise<void> => {
    const row: BenchRow = {
      slug, pdfPages: 0, textChars: 0, layout: "?", windowFirst: 0, windowLast: 0,
      gridFound: false, sigZoneCodes: 0, pagesRead: 0, pagesFailed: 0, zonesRead: 0,
      uniqueCodes: 0, overlap: 0, numericBridged: 0, recoupExtracted: 0, recoupSig: 0,
      publishedFieldPct: 0, hallucinationCodes: [], inTokens: 0, outTokens: 0,
      cacheReadTokens: 0, cacheCreateTokens: 0, costUsdApiEquiv: 0, seconds: 0,
      existingUniqueCodes: 0, existingPublishedPct: 0, existingMethode: "—", rateLimited: false,
    };
    const man = manBySlug.get(slug);
    row.existingUniqueCodes = man?.unique_zone_codes ?? 0;
    row.existingPublishedPct = man?.published_field_pct ?? 0;
    row.existingMethode = man?.methode ?? "—";
    try {
      const pdf = localGrille(slug);
      if (!pdf) {
        row.error = "no staged grille.pdf";
        return;
      }
      const w = pickWindow(pdf, maxPages, WINDOWS[slug]);
      row.pdfPages = w.pageCount;
      row.textChars = w.textChars;
      row.layout = w.layout;
      row.windowFirst = w.first;
      row.windowLast = w.last;
      if (w.last < w.first) {
        row.error = "empty window (0-page or unreadable pdf)";
        return;
      }

      // Render each page DIRECTLY from the original PDF via pdftoppm (poppler) — no
      // ghostscript slice (gs is not installed here; pdftoppm -f/-l reads one page).
      const allZones: ZoneNormsT[] = [];
      const t0 = Date.now();
      for (let truePage = w.first; truePage <= w.last && !globalRateLimited; truePage++) {
        let png: string | null = null;
        try {
          png = await renderPageToPng(pdf, truePage, dpi);
          const usage = await runClaudeWithUsage(png, prompt, timeoutMs);
          if (has("dump-raw")) {
            await writeFile(join(outDir, `raw-${slug}-p${truePage}.txt`), usage.resultText).catch(() => undefined);
          }
          row.inTokens += usage.inputTokens;
          row.outTokens += usage.outputTokens;
          row.cacheReadTokens += usage.cacheReadTokens;
          row.cacheCreateTokens += usage.cacheCreateTokens;
          row.costUsdApiEquiv += usage.costUsd;
          const extraction = parseClaudeContent(usage.resultText);
          const zs = mapClaudeExtractionToZones(extraction, truePage, { source_url: pdf, snapshot });
          allZones.push(...zs);
          row.pagesRead++;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg === "RATE_LIMIT") {
            globalRateLimited = true;
            row.rateLimited = true;
            break;
          }
          row.pagesFailed++;
        } finally {
          if (png) await rm(dirname(png), { recursive: true, force: true }).catch(() => undefined);
        }
      }
      row.seconds = Math.round((Date.now() - t0) / 100) / 10;

      const merged = mergeByZone(allZones);
      row.zonesRead = merged.length;
      row.publishedFieldPct = publishedFieldPct(merged);
      const cv: CrossValResult = merged.length
        ? await crossValidateZoneCodes(s3, slug, merged)
        : await crossValidateZoneCodes(s3, slug, []);
      row.gridFound = cv.gridFound;
      row.sigZoneCodes = cv.sigZoneCodes;
      row.uniqueCodes = cv.extractedZoneCodes;
      row.overlap = cv.overlap;
      row.numericBridged = cv.numericBridged;
      row.recoupExtracted = Math.round(cv.recoupExtracted * 1000) / 1000;
      row.recoupSig = Math.round(cv.recoupSig * 1000) / 1000;
      row.hallucinationCodes = cv.extractedNotInSig;
    } catch (e) {
      row.error = (e instanceof Error ? e.message : String(e)).slice(0, 180);
    } finally {
      rows.push(row);
      await writeResults().catch(() => undefined);
      console.error(
        `[${slug}] pagesRead=${row.pagesRead}/${row.pagesRead + row.pagesFailed} zones=${row.zonesRead} ` +
          `codes=${row.uniqueCodes} overlap=${row.overlap}/${row.sigZoneCodes} ` +
          `recoupE=${row.recoupExtracted} recoupSig=${row.recoupSig} pub%=${row.publishedFieldPct} ` +
          `tok=${row.inTokens}/${row.outTokens} $${row.costUsdApiEquiv.toFixed(3)} ${row.seconds}s ` +
          `${row.rateLimited ? "RATE-LIMITED " : ""}${row.error ? "ERR:" + row.error : ""}`,
      );
    }
  };

  // concurrency pool
  let next = 0;
  const runners = Array.from({ length: Math.max(1, lanes) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= slugs.length) return;
      if (done.has(slugs[i]!)) continue; // --resume: already processed in a prior run
      if (globalRateLimited) {
        rows.push({
          slug: slugs[i]!, pdfPages: 0, textChars: 0, layout: "?", windowFirst: 0, windowLast: 0,
          gridFound: false, sigZoneCodes: 0, pagesRead: 0, pagesFailed: 0, zonesRead: 0, uniqueCodes: 0,
          overlap: 0, numericBridged: 0, recoupExtracted: 0, recoupSig: 0, publishedFieldPct: 0,
          hallucinationCodes: [], inTokens: 0, outTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0,
          costUsdApiEquiv: 0, seconds: 0, existingUniqueCodes: manBySlug.get(slugs[i]!)?.unique_zone_codes ?? 0,
          existingPublishedPct: manBySlug.get(slugs[i]!)?.published_field_pct ?? 0, existingMethode: "—",
          rateLimited: true, error: "skipped (global rate-limit)",
        });
        continue;
      }
      await processCity(slugs[i]!);
    }
  });
  await Promise.all(runners);

  await writeResults();
  const agg = aggregate(rows);
  console.log(JSON.stringify({ done: true, cities: rows.length, aggregate: agg, out: resultsPath }, null, 2));
}

interface Agg {
  cities: number;
  citiesWithSig: number;
  citiesWithZones: number;
  meanRecoupExtracted: number;
  meanRecoupSig: number;
  meanPublishedFieldPct: number;
  totalOverlap: number;
  totalSigCodes: number;
  totalUniqueCodes: number;
  totalInTokens: number;
  totalOutTokens: number;
  totalCostUsdApiEquiv: number;
  costPerCityApiEquiv: number;
  totalSeconds: number;
  secondsPerCity: number;
  rateLimitedCities: number;
}

function mean(xs: number[]): number {
  return xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1000) / 1000 : 0;
}

function aggregate(rows: BenchRow[]): Agg {
  const withZones = rows.filter((r) => r.zonesRead > 0);
  const withSig = rows.filter((r) => r.gridFound);
  const withSigZones = rows.filter((r) => r.gridFound && r.zonesRead > 0);
  const totalCost = rows.reduce((a, r) => a + r.costUsdApiEquiv, 0);
  const totalSec = rows.reduce((a, r) => a + r.seconds, 0);
  return {
    cities: rows.length,
    citiesWithSig: withSig.length,
    citiesWithZones: withZones.length,
    meanRecoupExtracted: mean(withSigZones.map((r) => r.recoupExtracted)),
    meanRecoupSig: mean(withSigZones.map((r) => r.recoupSig)),
    meanPublishedFieldPct: mean(withZones.map((r) => r.publishedFieldPct)),
    totalOverlap: rows.reduce((a, r) => a + r.overlap, 0),
    totalSigCodes: withSig.reduce((a, r) => a + r.sigZoneCodes, 0),
    totalUniqueCodes: rows.reduce((a, r) => a + r.uniqueCodes, 0),
    totalInTokens: rows.reduce((a, r) => a + r.inTokens, 0),
    totalOutTokens: rows.reduce((a, r) => a + r.outTokens, 0),
    totalCostUsdApiEquiv: Math.round(totalCost * 1000) / 1000,
    costPerCityApiEquiv: rows.length ? Math.round((totalCost / rows.length) * 1000) / 1000 : 0,
    totalSeconds: Math.round(totalSec * 10) / 10,
    secondsPerCity: rows.length ? Math.round((totalSec / rows.length) * 10) / 10 : 0,
    rateLimitedCities: rows.filter((r) => r.rateLimited).length,
  };
}

function renderMarkdown(rows: BenchRow[], agg: Agg, maxPages: number): string {
  const L: string[] = [];
  L.push("# Benchmark Claude Opus 4.8 (xhigh) — grilles de normes (vision)");
  L.push("");
  L.push(`_Généré ${new Date().toISOString()} · modèle ${CLAUDE_MODEL} · effort ${CLAUDE_EFFORT} · route Engine-B \`claude -p\` (OAuth, apiKeySource:none) · fenêtre ≤ ${maxPages} pages/ville._`);
  L.push("");
  L.push("**Correctness** = recoupement avec la couche SIG (vérité-terrain), overlap canonique + pont numérique. `recoupE` = overlap/codes-lus (précision, équitable-fenêtre) · `recoupSig` = overlap/codes-SIG (rappel, borné par la fenêtre). `pub%` = champs-normes publiés (verbatim-ou-null). Hallucination = codes lus absents du SIG.");
  L.push("");
  L.push("**Conso** = tokens in/out + coût $ équivalent-API (rapporté par le CLI ; l'abonnement facture 0 $) + temps.");
  L.push("");
  L.push("| ville | layout | pages | fenêtre | SIG | zones | codes | overlap | recoupE | recoupSig | pub% | halluc | tok in/out | $API-eq | s | dépôt (codes/pub%) |");
  L.push("|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--|");
  for (const r of [...rows].sort((a, b) => a.slug.localeCompare(b.slug))) {
    const halluc = r.gridFound && r.uniqueCodes > 0 ? `${r.uniqueCodes - r.overlap}/${r.uniqueCodes}` : "—";
    const err = r.error ? ` ⚠️${r.error}` : r.rateLimited ? " ⚠️rate-limit" : "";
    L.push(
      `| ${r.slug}${err} | ${r.layout} | ${r.pdfPages} | ${r.windowFirst}-${r.windowLast} | ${r.gridFound ? r.sigZoneCodes : "—"} | ${r.zonesRead} | ${r.uniqueCodes} | ${r.overlap} | ${r.recoupExtracted} | ${r.recoupSig} | ${r.publishedFieldPct} | ${halluc} | ${r.inTokens}/${r.outTokens} | ${r.costUsdApiEquiv.toFixed(3)} | ${r.seconds} | ${r.existingUniqueCodes}/${r.existingPublishedPct} |`,
    );
  }
  L.push("");
  L.push("## Agrégats");
  L.push("");
  L.push(`- Villes: ${agg.cities} · avec SIG: ${agg.citiesWithSig} · avec zones lues: ${agg.citiesWithZones} · rate-limited: ${agg.rateLimitedCities}`);
  L.push(`- **Correctness moyenne** (villes SIG∧zones): recoupExtracted=${agg.meanRecoupExtracted} · recoupSig=${agg.meanRecoupSig} · publishedFieldPct=${agg.meanPublishedFieldPct}%`);
  L.push(`- Overlap total ${agg.totalOverlap} / codes-SIG ${agg.totalSigCodes} · codes-lus total ${agg.totalUniqueCodes}`);
  L.push(`- **Conso**: tokens in=${agg.totalInTokens} out=${agg.totalOutTokens} · coût total $API-eq=${agg.totalCostUsdApiEquiv} · **coût/ville**=${agg.costPerCityApiEquiv} · temps total=${agg.totalSeconds}s · temps/ville=${agg.secondsPerCity}s`);
  L.push("");
  L.push("_Coût $ = équivalent-API rapporté par le CLI ; sur l'abonnement OAuth (apiKeySource:none) la facturation réelle est 0 $ (quota rate-limit uniquement)._");
  L.push("");
  return L.join("\n");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
