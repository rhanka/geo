/**
 * Per-municipality runner for the `qc-zonage-norms-<slug>` product.
 *
 * Pipeline (anti-invention, TS-only):
 *   1. Take a DISCOVERED grille PDF (local path or URL) for one municipality.
 *   2. ROUTE on its `pdftotext -layout` projection:
 *        - native-text HORIZONTAL grille (Sherbrooke-type): pages pass the frozen
 *          `isGrillePage` header anchor AND `parseGrillePage` accepts them →
 *          run `extractGrilleDocument` (NO Mistral, $0).
 *        - MULTI-ZONE grille (zones-in-columns "grille des spécifications" /
 *          horizontal): route to the Document-AI OCR path (mistral-ocr by default,
 *          ~$1/1000 pages — 5–10× cheaper + more robust than chat-vision, per
 *          work/coverage/BENCH-OCR.md). Backend is env-parametrable (OCR_PROVIDER
 *          mistral-ocr|chandra, OCR_MODEL, OCR_API_BASE, OCR_API_KEY).
 *        - VERTICAL / image scan grille (single-zone-per-page): header anchors
 *          absent → Mistral 2-pass CHAT-VISION extractor, ONE rendered page at a
 *          time (the bench case where vision beats OCR 100% vs 3.6%).
 *   3. CROSS-VALIDATE the extracted zone codes against the muni's SIG grille.
 *   4. DEPOSIT `qc-zonage-norms-<slug>.parquet` + refresh manifest (idempotent).
 *
 * This runner adds ZERO parsing/normalisation: every published value comes from
 * the frozen `@geo/qc-sources` extractors. `null` beats a fabricated norm.
 *
 * Usage (npx tsx):
 *   tsx src/zonage-norms-run.ts --slug saint-alban --pdf /path/grille.pdf \
 *       --source-url https://… [--reglement 123] \
 *       [--route auto|native|ocr|multizone|vision] \
 *       [--max-vision-pages N] [--budget-usd 15] [--auto-grid-page] \
 *       [--dry-run] [--force]
 *
 * `--auto-grid-page` (ADDITIVE, off by default): pre-scan the PDF text to locate
 * the deep ANNEXE "grille des usages et normes" of a codified by-law and restrict
 * the OCR window to it, overriding the ~80-page cap (e.g. dudswell grille p.223–
 * 228 of 287). Without it the cap slices the annex off → 0 zones extracted.
 */
import { readFile } from "node:fs/promises";

import { spawnSync } from "node:child_process";

import {
  extractGrilleDocument,
} from "../../packages/qc-sources/src/sources/reglements-zonage-sherbrooke.js";
import {
  isGrillePage,
  parseGrillePage,
  type ZoneNormsT,
} from "../../packages/qc-sources/src/sources/grille-specifications-parser.js";
import {
  extractZonePageFromPdf,
  MistralVisionGrille,
  type VisionRawExtraction,
} from "../../packages/qc-sources/src/sources/grille-vision-extractor.js";
import {
  extractMultiZonePageFromPdf,
  MistralVisionMultiZone,
  type MultiZoneRawExtraction,
} from "../../packages/qc-sources/src/sources/grille-vision-multizone.js";
import { isMultiZoneHorizontalPage } from "../../packages/qc-sources/src/sources/grille-pdf-classifier.js";
import { extractGrilleOcrFromPdf } from "../../packages/qc-sources/src/sources/grille-ocr-extractor.js";

import { s3Client } from "./lib/s3.js";
import { resolveOcrCall } from "./lib/ocr.js";
import {
  crossValidateZoneCodes,
  depositZonageNorms,
  depositParquetOnly,
  shouldRejectForZeroOverlap,
} from "./lib/zonage-norms.js";

// Mistral medium pricing (per 1M tokens), used only for cost reporting.
// (mistral-medium-latest: ~$0.40 in / $2.00 out per 1M as of 2026-06.)
const MISTRAL_IN_PER_M = 0.4;
const MISTRAL_OUT_PER_M = 2.0;

/** Anti-invention floor: never deposit a product with fewer real zone codes. */
const MIN_DEPOSIT_ZONE_CODES = 3;

interface Args {
  slug: string;
  pdf: string;
  sourceUrl: string;
  reglement?: string;
  route: "auto" | "native" | "vision" | "multizone" | "ocr";
  maxVisionPages: number;
  budgetUsd: number;
  dryRun: boolean;
  force: boolean;
  /** Parquet-only deposit (NO manifest write) — safe for concurrent lanes; reconcile via zonage-norms-manifest-merge.ts. */
  noManifest: boolean;
  /** Pre-scan the PDF text for the deep grille annex and bound the OCR window to it (overrides the page cap). */
  autoGridPage: boolean;
  snapshot: string;
  dpi?: number;
  /** 1-based inclusive page range to read (vision/multizone). Default: all. */
  firstPage?: number;
  lastPage?: number;
}

function parseArgs(argv: string[]): Args {
  const get = (k: string): string | undefined => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const has = (k: string): boolean => argv.includes(`--${k}`);
  const slug = get("slug");
  const pdf = get("pdf");
  const sourceUrl = get("source-url");
  if (!slug || !pdf || !sourceUrl) {
    throw new Error("required: --slug <slug> --pdf <path> --source-url <url>");
  }
  return {
    slug,
    pdf,
    sourceUrl,
    reglement: get("reglement"),
    route: (get("route") as Args["route"]) ?? "auto",
    maxVisionPages: Number(get("max-vision-pages") ?? "80"),
    budgetUsd: Number(get("budget-usd") ?? "15"),
    dryRun: has("dry-run"),
    force: has("force"),
    noManifest: has("no-manifest"),
    autoGridPage: has("auto-grid-page"),
    snapshot: get("snapshot") ?? new Date().toISOString().slice(0, 10),
    ...(get("dpi") ? { dpi: Number(get("dpi")) } : {}),
    ...(get("first-page") ? { firstPage: Number(get("first-page")) } : {}),
    ...(get("last-page") ? { lastPage: Number(get("last-page")) } : {}),
  };
}

function pdftotextLayout(pdfPath: string): string {
  const r = spawnSync("pdftotext", ["-q", "-layout", "-enc", "UTF-8", pdfPath, "-"], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(`pdftotext failed (${r.status}): ${r.stderr?.slice(0, 200)}`);
  }
  return r.stdout ?? "";
}

/** How many of a zone's 8 norm fields carry a published (non-null) value. */
function publishedCount(z: ZoneNormsT): number {
  const fs = [
    z.densite,
    z.hauteur_min,
    z.hauteur_max,
    z.frontage_min,
    z.superficie_min,
    z.marges.avant_min,
    z.marges.laterale_min,
    z.marges.arriere_min,
  ];
  return fs.filter((f) => f && f.value !== null).length;
}

/** Count PDF pages via pdfinfo (poppler). */
function pdfPageCount(pdfPath: string): number {
  const r = spawnSync("pdfinfo", [pdfPath], { encoding: "utf8" });
  const m = r.stdout?.match(/Pages:\s+(\d+)/);
  return m ? Number(m[1]) : 0;
}

function pageTextsByNumber(layoutText: string): string[] {
  const pages = layoutText.split("\f");
  if (pages[pages.length - 1] === "") pages.pop();
  return pages;
}

// ── Auto-grid-page detection (additive; gated on --auto-grid-page) ──────────
// Codified zoning by-laws bury their ANNEXE "grille des usages et normes" deep
// in the document (dudswell: p.223–228 of 287). The default ~80-page OCR cap
// (`maxVisionPages`) then slices the annex off → 0 zones extracted even though
// the grille exists. When `--auto-grid-page` is set we pre-scan the
// `pdftotext -layout` projection page-by-page and, on a hit, bound the OCR window
// to the grille block (±AUTO_GRID_MARGIN pages), overriding the cap. OFF by
// default, so default-behaviour runs (and any concurrent lane) are untouched.

/** Min DISTINCT zone-code tokens on a single header line to flag a grille page. */
const AUTO_GRID_MIN_CODES = 6;
/** Pages of slack added on each side of the detected grille block. */
const AUTO_GRID_MARGIN = 2;
/** Zone-code token: 1–4 leading letters + optional dash + 1–3 digits (RA-1, C2, VIL9). */
const ZONE_CODE_TOKEN = /\b[A-Z]{1,4}-?\d{1,3}\b/g;
/** Lines never treated as a grille header: by-law/article refs and 19xx/20xx years. */
const GRID_HEADER_EXCLUDE = /\b(?:ARTICLES?|R[ÈE]GLEMENTS?|REGLEMENTS?)\b|\b(?:19|20)\d{2}\b/i;

interface GridWindow {
  pages: number[];
  firstPage: number;
  lastPage: number;
}

/**
 * Scan per-page layout text for the grille des usages et normes annex. A page is
 * a grille page when ≥AUTO_GRID_MIN_CODES DISTINCT zone-code tokens sit on a
 * SINGLE line — the zones-in-columns header band, e.g. "Références A1 A2 A3 …" —
 * after dropping lines that look like by-law/article refs or carry a year (so a
 * règlement number / "ARTICLE 12" never trips it). Returns the
 * [min−margin, max+margin] page window (1-based, clamped) or null if none found.
 */
function detectGridPages(pageTexts: string[], pageCount: number): GridWindow | null {
  const hits: number[] = [];
  for (let i = 0; i < pageTexts.length; i++) {
    const text = pageTexts[i] ?? "";
    for (const line of text.split(/\r?\n/)) {
      if (GRID_HEADER_EXCLUDE.test(line)) continue;
      const codes = new Set<string>();
      for (const m of line.matchAll(ZONE_CODE_TOKEN)) codes.add(m[0].toUpperCase());
      if (codes.size >= AUTO_GRID_MIN_CODES) {
        hits.push(i + 1); // 1-based PDF page number
        break;
      }
    }
  }
  if (hits.length === 0) return null;
  const total = pageCount > 0 ? pageCount : Math.max(...hits);
  const firstPage = Math.max(1, Math.min(...hits) - AUTO_GRID_MARGIN);
  const lastPage = Math.min(total, Math.max(...hits) + AUTO_GRID_MARGIN);
  return { pages: hits, firstPage, lastPage };
}

function normalizeExpectedZone(raw: string): string {
  return raw.replace(/[–—]/g, "-").replace(/\s+/g, "").toUpperCase();
}

function expectedZoneFromPage(text: string): string | undefined {
  // NB: the optional trailing suffix-letter (e.g. "H-1A") must stay on the SAME
  // line as the digits — `[ \t]*` not `\s*`. With `\s*` the group spanned the
  // blank lines under a one-zone-per-page title ("ZONE CW-1\n\n\nUSES …") and
  // swallowed the leading "U" of "USES", pinning a fabricated "CW-1U" zone_code.
  const zoneLabel = text.match(/\bZONE\s+([A-Z]{1,4}\s*[-–—]?\s*\d+(?:\.\d+)?(?:[ \t]*[A-Z])?)/i);
  if (zoneLabel?.[1]) return normalizeExpectedZone(zoneLabel[1]);

  // DIGIT-FIRST page-title gabarit (the "ANNEXE J/L GRILLES DE SPÉCIFICATION …
  // ZONE 1-HA" one-zone-per-page sheets — la-durantaye, saint-neree-de-bellechasse).
  // Here the page's own zone lives in the TITLE in a "<digits>-<letters>[-<digits>]"
  // form ("ZONE 1- HA", "ZONE 122-AF-1") the letter-first patterns above cannot
  // read, so without this the single-zone vision extractor gets no expectedZone,
  // the two passes cannot agree on a (nonexistent) "ZONE (Plan général)" box, and
  // it throws `no-zone` on EVERY page. The dash separator keeps prose like "ZONE 5
  // cases" out (a digit run with no dash-letters tail never matches), and the
  // letter-first usage codes in the body (H-1, C-1…) are not digit-first so they
  // never shadow the title. ANTI-INVENTION: this only PINS the page's zone to the
  // verbatim title code — it fabricates no norm value.
  const titleZone = text.match(
    /\bZONE\s+(\d{1,3}\s*[-–—]\s*[A-Z]{1,3}(?:\s*[-–—]\s*\d{1,2})?)\b/i,
  );
  if (titleZone?.[1]) return normalizeExpectedZone(titleZone[1]);

  const header = text.split(/\r?\n/).slice(0, 24).join("\n");
  const standalone = header.match(
    /^\s*([A-Z]{1,4}\s*[-–—]\s*\d+(?:\.\d+)?(?:\s*[A-Z])?)\s*(?:[-–—]?\s*abrog(?:e|é|ée))?\s*$/im,
  );
  if (standalone?.[1]) return normalizeExpectedZone(standalone[1]);

  return undefined;
}

interface RouteDecision {
  route: "native" | "vision" | "multizone" | "ocr" | "none";
  nativeGrillePages: number;
  nativeAcceptedRows: number;
  reason: string;
}

// `isMultiZoneHorizontalPage` (zones-as-columns header detector) is shared with the
// discovery routeur and lives in `grille-pdf-classifier.ts` (imported above).

/**
 * Decide the route by probing the layout text with the frozen parser:
 *   - native: Sherbrooke-type pages pass `isGrillePage` AND `parseGrillePage`
 *     (NO Mistral, $0).
 *   - ocr: pages carry the "GRILLE DES SPÉCIFICATIONS" / "feuillet" markers OR a
 *     multi-zone HORIZONTAL header (zones in columns — MRC de Portneuf / Estrie /
 *     Compton). These are the dense multi-zone grilles where the Document-AI OCR
 *     path is 5–10× cheaper, faster and more robust than chat-vision
 *     (work/coverage/BENCH-OCR.md, 2026-06-23) → PRIMARY = OCR. The chat-vision
 *     multi-zone extractor stays reachable via `--route multizone` (fallback).
 *   - vision: otherwise (single-zone vertical / image grille — saint-stanislas
 *     type, where the bench showed vision 100% vs OCR 3.6%) → single-zone vision.
 */
function decideRoute(layoutText: string, sourceUrl: string, snapshot: string): RouteDecision {
  const pages = layoutText.split("\f").filter((p) => p.trim().length > 0);
  let grillePages = 0;
  let acceptedRows = 0;
  for (const p of pages) {
    if (!isGrillePage(p).isGrille) continue;
    grillePages++;
    const res = parseGrillePage(p, { source_url: sourceUrl, snapshot });
    if (!res.rejected) acceptedRows += res.zones.length;
  }
  if (grillePages > 0 && acceptedRows > 0) {
    return {
      route: "native",
      nativeGrillePages: grillePages,
      nativeAcceptedRows: acceptedRows,
      reason: `${grillePages} native grille pages, ${acceptedRows} accepted rows`,
    };
  }
  // The "grille des spécifications" multi-zone format (zones in columns) is the
  // dominant rural/Portneuf layout; route it to the multi-zone vision extractor.
  const specPages = pages.filter((p) => /grille des sp.cifications/i.test(p)).length;
  // Multi-zone HORIZONTAL grilles whose title is "grille des normes/usages" or
  // "grille de zonage" (Compton, bois-franc, …) carry no "spécifications" marker
  // and no native anchors, so without this they fell through to single-zone
  // vision and produced 0 zones. Route them to the same multi-zone extractor.
  const horizPages = pages.filter((p) => isMultiZoneHorizontalPage(p)).length;
  if (specPages > 0 || horizPages > 0) {
    const why =
      specPages > 0
        ? `${specPages} "grille des spécifications" pages`
        : `${horizPages} multi-zone horizontal grille pages (zones in columns)`;
    return {
      route: "ocr",
      nativeGrillePages: grillePages,
      nativeAcceptedRows: acceptedRows,
      reason: `${why} → OCR (mistral-ocr Document-AI, primary)`,
    };
  }
  return {
    route: "vision",
    nativeGrillePages: grillePages,
    nativeAcceptedRows: acceptedRows,
    reason:
      grillePages === 0
        ? "no native grille header anchors (single-zone vertical/image) → vision"
        : `${grillePages} grille pages but 0 accepted native rows → vision`,
  };
}

/** A cost-tracking wrapper around the live Mistral vision call. */
function costTrackedVision(): {
  call: MistralVisionGrille["extract"];
  usd: () => number;
  calls: () => number;
} {
  const base = new MistralVisionGrille();
  let inTok = 0;
  let outTok = 0;
  let nCalls = 0;
  // We cannot read usage from the frozen extract() return (it returns only the
  // parsed VisionRawExtraction). Estimate tokens from the JSON sizes instead —
  // reported as an ESTIMATE so the budget guard stays honest/conservative.
  const wrapped: MistralVisionGrille["extract"] = async (imagePath, pass, expectedZone) => {
    nCalls++;
    const before = Date.now();
    const out: VisionRawExtraction = await base.extract(imagePath, pass, expectedZone);
    void before;
    // Per-call estimate grounded in a LIVE probe (2026-06-22) of a 200-DPI
    // saint-stanislas page: ~2078 prompt tokens (image tiles dominate) and a
    // small-but-conservative completion budget for the full field JSON.
    inTok += 2100;
    outTok += 300;
    return out;
  };
  return {
    call: wrapped,
    usd: () => (inTok / 1e6) * MISTRAL_IN_PER_M + (outTok / 1e6) * MISTRAL_OUT_PER_M,
    calls: () => nCalls,
  };
}

/** Cost-tracking wrapper around the live multi-zone Mistral vision call. */
function costTrackedMultiZone(): {
  call: MistralVisionMultiZone["extract"];
  usd: () => number;
  calls: () => number;
} {
  const base = new MistralVisionMultiZone();
  let inTok = 0;
  let outTok = 0;
  let nCalls = 0;
  const wrapped: MistralVisionMultiZone["extract"] = async (imagePath, pass) => {
    nCalls++;
    const out: MultiZoneRawExtraction = await base.extract(imagePath, pass);
    // A multi-zone page returns many zones → larger completion. Conservative
    // per-call estimate: ~2300 prompt tokens (denser image) + ~120 tokens/zone.
    inTok += 2300;
    outTok += 120 * Math.max(1, out.zones.length);
    return out;
  };
  return {
    call: wrapped,
    usd: () => (inTok / 1e6) * MISTRAL_IN_PER_M + (outTok / 1e6) * MISTRAL_OUT_PER_M,
    calls: () => nCalls,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const s3 = s3Client();

  // eslint-disable-next-line no-console
  console.error(`[zonage-norms] slug=${args.slug} pdf=${args.pdf} route=${args.route}`);

  const layoutText = pdftotextLayout(args.pdf);
  const pageTexts = pageTextsByNumber(layoutText);
  const decision =
    args.route === "auto"
      ? decideRoute(layoutText, args.sourceUrl, args.snapshot)
      : {
          route: args.route,
          nativeGrillePages: 0,
          nativeAcceptedRows: 0,
          reason: `forced route=${args.route}`,
        };
  console.error(`[route] ${decision.route}: ${decision.reason}`);

  // ADDITIVE: when --auto-grid-page is set, locate the deep grille annex and bound
  // the OCR window to it (overriding the page cap). On miss → log + normal fallback.
  // Native route ignores firstPage/lastPage, so this only steers the OCR/vision paths.
  if (args.autoGridPage) {
    const win = detectGridPages(pageTexts, pdfPageCount(args.pdf));
    if (win) {
      args.firstPage = win.firstPage;
      args.lastPage = win.lastPage;
      // Override the page cap: ensure maxVisionPages spans the whole detected
      // window (the cap is computed as first-1+maxVisionPages in each route).
      args.maxVisionPages = Math.max(args.maxVisionPages, win.lastPage - win.firstPage + 1);
      console.error(
        `[auto-grid] grille pages detected: ${win.pages.join(",")} → OCR window ` +
          `${win.firstPage}..${win.lastPage} (±${AUTO_GRID_MARGIN}, page cap overridden)`,
      );
    } else {
      console.error("[auto-grid] aucune page-grille détectée — fallback comportement normal");
    }
  }

  let zones: ZoneNormsT[] = [];
  let methode = "";
  let visionUsd = 0;
  let visionCalls = 0;
  let visionPagesAttempted = 0;
  let visionPagesFailed = 0;

  if (decision.route === "native") {
    const res = extractGrilleDocument(layoutText, {
      source_url: args.sourceUrl,
      snapshot: args.snapshot,
    });
    zones = res.zones;
    methode = "native-text/header-anchored-cluster";
    console.error(
      `[native] pages=${res.stats.totalPages} grille=${res.stats.grillePages} ` +
        `rejected=${res.stats.rejectedGrillePages} rows=${res.stats.zoneRows} ` +
        `uniqueZones=${res.stats.uniqueZoneCodes}`,
    );
  } else if (decision.route === "vision") {
    if (!process.env["MISTRAL_API_KEY"]) {
      throw new Error("vision route requires MISTRAL_API_KEY (load sentropic/.env)");
    }
    methode = "mistral-vision";
    const tracker = costTrackedVision();
    const pageCount = pdfPageCount(args.pdf);
    const first = args.firstPage ?? 1;
    const last = Math.min(args.lastPage ?? pageCount, first - 1 + args.maxVisionPages, pageCount);
    console.error(
      `[vision] pdf pages=${pageCount} range=${first}..${last} budget=$${args.budgetUsd}` +
        (args.dpi ? ` dpi=${args.dpi}` : ""),
    );
    for (let page = first; page <= last; page++) {
      if (tracker.usd() >= args.budgetUsd) {
        console.error(`[budget] reached $${tracker.usd().toFixed(2)} — stopping at page ${page}`);
        break;
      }
      visionPagesAttempted++;
      try {
        const expectedZone = expectedZoneFromPage(pageTexts[page - 1] ?? "");
        const zn = await extractZonePageFromPdf(args.pdf, page, {
          source_url: args.sourceUrl,
          snapshot: args.snapshot,
          ...(expectedZone ? { expectedZone } : {}),
          ...(args.dpi ? { dpi: args.dpi } : {}),
          vision: tracker.call,
        });
        zones.push(zn);
      } catch (e) {
        visionPagesFailed++;
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[vision] page ${page} skipped: ${msg.slice(0, 120)}`);
      }
    }
    visionUsd = tracker.usd();
    visionCalls = tracker.calls();
    console.error(
      `[vision] zones=${zones.length} attempted=${visionPagesAttempted} ` +
        `failed=${visionPagesFailed} calls=${visionCalls} estUsd=$${visionUsd.toFixed(3)}`,
    );
  } else if (decision.route === "ocr") {
    // PRIMARY path for multi-zone grilles: Document-AI OCR (mistral-ocr by
    // default; OCR_PROVIDER=chandra + OCR_API_BASE switches backend). One bounded
    // OCR call over the annex page range → markdown → SAME guarded ZoneNorms.
    const ocr = resolveOcrCall();
    if (!ocr.config.apiKey) {
      throw new Error(
        "ocr route requires OCR_API_KEY or MISTRAL_API_KEY (load sentropic/.env)",
      );
    }
    methode = ocr.methode;
    const pageCount = pdfPageCount(args.pdf);
    const first = args.firstPage ?? 1;
    const last = Math.min(args.lastPage ?? pageCount, first - 1 + args.maxVisionPages, pageCount);
    // Budget guard: trim the page set so estimated cost stays within --budget-usd.
    const maxByBudget =
      ocr.costPerPage > 0 ? Math.max(1, Math.floor(args.budgetUsd / ocr.costPerPage)) : last - first + 1;
    const pages: number[] = [];
    for (let p = first; p <= last && pages.length < maxByBudget; p++) pages.push(p);
    console.error(
      `[ocr] provider=${ocr.config.provider} model=${ocr.config.model} ` +
        `pdf pages=${pageCount} range=${first}..${last} pages=${pages.length} ` +
        `budget=$${args.budgetUsd} ~$${(pages.length * ocr.costPerPage).toFixed(4)}`,
    );
    visionPagesAttempted = pages.length;
    const byZone = new Map<string, ZoneNormsT>();
    try {
      const res = await extractGrilleOcrFromPdf(args.pdf, pages, {
        source_url: args.sourceUrl,
        snapshot: args.snapshot,
        methode: ocr.methode,
        ocr: ocr.call,
        costPerPage: ocr.costPerPage,
      });
      visionUsd = res.usd;
      // Merge by zone_code, preferring the row that carries more published norm
      // values (a zone family can span a USAGES + a NORMES feuillet). Anti-
      // invention: never overwrite a value with null.
      for (const zn of res.zones) {
        const key = zn.zone_code.toUpperCase().replace(/\s+/g, "");
        const prev = byZone.get(key);
        if (!prev || publishedCount(zn) > publishedCount(prev)) byZone.set(key, zn);
      }
      console.error(
        `[ocr] pagesBilled=${res.pagesProcessed} zones=${byZone.size} ` +
          `usd=$${res.usd.toFixed(4)} latency=${res.latencyMs}ms`,
      );
    } catch (e) {
      visionPagesFailed = pages.length;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[ocr] FAILED: ${msg.slice(0, 200)}`);
    }
    zones = [...byZone.values()];
    console.error(
      `[ocr] zones=${zones.length} attempted=${visionPagesAttempted} failed=${visionPagesFailed} estUsd=$${visionUsd.toFixed(4)}`,
    );
  } else if (decision.route === "multizone") {
    if (!process.env["MISTRAL_API_KEY"]) {
      throw new Error("multizone route requires MISTRAL_API_KEY (load sentropic/.env)");
    }
    methode = "mistral-vision";
    const tracker = costTrackedMultiZone();
    const pageCount = pdfPageCount(args.pdf);
    // For multizone, only the "GRILLE DES SPÉCIFICATIONS" pages carry data; the
    // caller passes --first-page/--last-page to bound the annex. Default = all.
    const first = args.firstPage ?? 1;
    const last = Math.min(args.lastPage ?? pageCount, first - 1 + args.maxVisionPages, pageCount);
    console.error(
      `[multizone] pdf pages=${pageCount} range=${first}..${last} budget=$${args.budgetUsd}` +
        (args.dpi ? ` dpi=${args.dpi}` : ""),
    );
    const byZone = new Map<string, ZoneNormsT>();
    for (let page = first; page <= last; page++) {
      if (tracker.usd() >= args.budgetUsd) {
        console.error(`[budget] reached $${tracker.usd().toFixed(2)} — stopping at page ${page}`);
        break;
      }
      visionPagesAttempted++;
      try {
        const pageZones = await extractMultiZonePageFromPdf(args.pdf, page, {
          source_url: args.sourceUrl,
          snapshot: args.snapshot,
          ...(args.dpi ? { dpi: args.dpi } : {}),
          vision: tracker.call,
        });
        // A multi-zone grille often spans a USAGES feuillet + a NORMES feuillet for
        // the same zone family; the norms (this product's payload) come from the
        // NORMES feuillet. Merge by zone_code, preferring the row that carries more
        // published norm values (anti-invention: never overwrite a value with null).
        for (const zn of pageZones) {
          const key = zn.zone_code.toUpperCase().replace(/\s+/g, "");
          const prev = byZone.get(key);
          if (!prev || publishedCount(zn) > publishedCount(prev)) byZone.set(key, zn);
        }
        console.error(`[multizone] page ${page}: ${pageZones.length} zones`);
      } catch (e) {
        visionPagesFailed++;
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[multizone] page ${page} skipped: ${msg.slice(0, 120)}`);
      }
    }
    zones = [...byZone.values()];
    visionUsd = tracker.usd();
    visionCalls = tracker.calls();
    console.error(
      `[multizone] zones=${zones.length} attempted=${visionPagesAttempted} ` +
        `failed=${visionPagesFailed} calls=${visionCalls} estUsd=$${visionUsd.toFixed(3)}`,
    );
  } else {
    console.error("[route] none — nothing extractable; not depositing.");
  }

  if (zones.length === 0) {
    console.log(
      JSON.stringify(
        {
          slug: args.slug,
          deposited: false,
          reason: "0 zones extracted",
          route: decision.route,
          visionUsd,
        },
        null,
        2,
      ),
    );
    return;
  }

  const crossval = await crossValidateZoneCodes(s3, args.slug, zones);
  console.error(
    `[crossval] grid=${crossval.gridFound} sig=${crossval.sigZoneCodes} ` +
      `extracted=${crossval.extractedZoneCodes} overlap=${crossval.overlap} ` +
      `recoupExtracted=${(crossval.recoupExtracted * 100).toFixed(0)}% ` +
      `recoupSig=${(crossval.recoupSig * 100).toFixed(0)}%`,
  );

  if (args.dryRun) {
    console.log(
      JSON.stringify(
        {
          slug: args.slug,
          dryRun: true,
          route: decision.route,
          methode,
          zones: zones.length,
          uniqueZoneCodes: crossval.extractedZoneCodes,
          crossval,
          visionUsd,
          sampleZones: zones.slice(0, 3),
        },
        null,
        2,
      ),
    );
    return;
  }

  // ANTI-INVENTION CROSS-CHECK GATE: when a SIG/reglement grille WAS found but
  // NONE of the extracted codes match a real grille code (overlap=0), the codes
  // are mis-routed OCR garbage (e.g. row LABELS read as zone codes — kirkland).
  // The count gate below cannot catch this (≥3 distinct strings still exist), so
  // we reject here. Only fires when a grille exists; gridFound=false keeps the
  // legitimate "no reference grille" path on the count gate alone.
  if (shouldRejectForZeroOverlap(crossval)) {
    console.error(
      `[gate] REJET anti-invention : grille trouvée (${crossval.sigZoneCodes} codes SIG) ` +
        `mais overlap=0 → les ${crossval.extractedZoneCodes} codes extraits ne matchent ` +
        `AUCUN code réglementaire (probable OCR mal-routé lisant des labels). Pas de dépôt.`,
    );
    console.log(
      JSON.stringify(
        {
          slug: args.slug,
          deposited: false,
          reason: `anti-invention reject: grid found (${crossval.sigZoneCodes} SIG codes) but overlap=0 — ${crossval.extractedZoneCodes} extracted code(s) match NO regulatory code (likely mis-routed OCR reading labels)`,
          route: decision.route,
          methode,
          uniqueZoneCodes: crossval.extractedZoneCodes,
          crossval: {
            gridFound: crossval.gridFound,
            sigZoneCodes: crossval.sigZoneCodes,
            overlap: crossval.overlap,
          },
          visionUsd,
        },
        null,
        2,
      ),
    );
    return;
  }

  // ANTI-INVENTION DEPOSIT GATE: publish a `qc-zonage-norms-<slug>` product ONLY
  // when at least MIN_DEPOSIT_ZONE_CODES distinct REAL zone codes were recovered.
  // A handful of zones is the signature of a misread/misroute (a non-grille page
  // yielding one stray code, or a layout the extractor cannot read) — refusing the
  // deposit keeps a thin/fabricated product out of the registry. `null` (no deposit)
  // always beats a 1–2-zone false grille.
  if (crossval.extractedZoneCodes < MIN_DEPOSIT_ZONE_CODES) {
    console.log(
      JSON.stringify(
        {
          slug: args.slug,
          deposited: false,
          reason: `below deposit gate: ${crossval.extractedZoneCodes} unique zone_code(s) < ${MIN_DEPOSIT_ZONE_CODES} (anti-invention)`,
          route: decision.route,
          methode,
          uniqueZoneCodes: crossval.extractedZoneCodes,
          visionUsd,
        },
        null,
        2,
      ),
    );
    return;
  }

  const depositMeta = {
    source_url: args.sourceUrl,
    ...(args.reglement ? { reglement: args.reglement } : {}),
    methode,
    snapshot: args.snapshot,
  };
  // --no-manifest: parquet-only deposit (no shared-manifest write) so concurrent
  // lanes never race the manifest writer; reconcile later with
  // zonage-norms-manifest-merge.ts (parquet existence is the truth).
  const result = args.noManifest
    ? (
        await depositParquetOnly({
          s3,
          slug: args.slug,
          zones,
          meta: depositMeta,
          crossval,
        })
      ).result
    : await depositZonageNorms({
        s3,
        slug: args.slug,
        zones,
        meta: depositMeta,
        crossval,
        idempotent: !args.force,
      });

  console.log(
    JSON.stringify(
      {
        slug: args.slug,
        deposited: !result.skipped,
        skipped: result.skipped,
        key: result.key,
        route: decision.route,
        methode,
        rows: result.rows,
        uniqueZoneCodes: result.uniqueZoneCodes,
        publishedFieldPct: result.publishedFieldPct,
        crossval: {
          gridFound: crossval.gridFound,
          sigZoneCodes: crossval.sigZoneCodes,
          overlap: crossval.overlap,
          recoupExtracted: crossval.recoupExtracted,
          recoupSig: crossval.recoupSig,
        },
        visionUsd,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
