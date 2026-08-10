/**
 * zonage-norms-schema-ingest.ts — committed runner for the DETERMINISTIC
 * Mistral OCR + `document_annotation` (JSON-schema) route (`--engine mistral-schema`).
 *
 * WHY a dedicated path. The wide TRANSPOSED "grille des spécifications" family —
 * zones in COLUMNS with a detached bottom "NORMES D'IMPLANTATION" block (MRC
 * Antoine-Labelle / ferme-neuve) — defeats the plain markdown OCR mapper: the
 * shattered wide table orphans the norm rows and publishes 0% fields even though the
 * grille is dense. This runner drives the SECOND Mistral `/v1/ocr` mode
 * (`document_annotation_format` with a per-zone JSON schema, ~$0.003/page,
 * `grille-mistral-schema.ts`) which fills one object per zone-column with the
 * VERBATIM cell (or null). Every cell is gated by the FROZEN `buildVisionField`
 * (via `mapClaudeExtractionToZones`), so anti-invention is inherited whole.
 *
 * This is the residue/mass lane: it deposits PARQUET-ONLY by default (never touches
 * the shared manifest, so it cannot race the stock / GPT-5.5 / vision lanes) and is
 * reconciled afterwards with `zonage-norms-manifest-merge.ts --apply`. Deposit is
 * REFUSED unless ≥3 real zone codes, overlap≠0 vs the SIG grille, and
 * publishedFieldPct≠0 (the same anti-invention floor as `zonage-norms-run`).
 *
 * Usage (one committed command; the PDF is staged at work/zonage-norms/<slug>/grille.pdf):
 *   # report only (extract + crossval, NO deposit, NO network cost beyond OCR):
 *   npx tsx acquisition/src/zonage-norms-schema-ingest.ts --slug ferme-neuve \
 *     --engine mistral-schema --first-page 186 --last-page 212 --report
 *   # deposit the parquet (parquet-only, reconcile the manifest after):
 *   npx tsx acquisition/src/zonage-norms-schema-ingest.ts --slug ferme-neuve \
 *     --engine mistral-schema --first-page 186 --last-page 212 --deposit
 *
 * Page selection (in priority order):
 *   --pages a,b,c            explicit 1-based page list
 *   --first-page/--last-page inclusive 1-based range (the annex window)
 *   (neither)                auto-detect the zones-in-columns / transposed pages
 *                            (±2 margin); falls back to the whole PDF if none found.
 * The selected set is trimmed to keep estimated cost within --budget-usd.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ZoneNormsT } from "../../packages/qc-sources/src/sources/grille-specifications-parser.js";
import { looksLikeTransposedColumnsGrille } from "../../packages/qc-sources/src/sources/grille-ocr-extractor.js";
import { isMultiZoneHorizontalPage } from "../../packages/qc-sources/src/sources/grille-pdf-classifier.js";

import { s3Client, loadEnv, exists } from "./lib/s3.js";
import {
  extractGrilleSchemaFromPdf,
  SCHEMA_METHODE,
  MISTRAL_SCHEMA_USD_PER_PAGE,
} from "./lib/grille-mistral-schema.js";
import {
  canonZone,
  crossValidateZoneCodes,
  depositParquetOnly,
  depositZonageNorms,
  normsKey,
  publishedFieldPct,
  shouldRejectForZeroOverlap,
  shouldRejectForZeroNormFields,
  looksLikeTableOfContents,
} from "./lib/zonage-norms.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const SNAPSHOT = new Date().toISOString().slice(0, 10);
/** Anti-invention floor: never deposit a product with fewer real zone codes. */
const MIN_DEPOSIT_ZONE_CODES = 3;
/** Pages of slack added on each side of an auto-detected grille block. */
const AUTO_MARGIN = 2;
const DEFAULT_SOURCE_URL = "non-disponible";
const ENGINE = "mistral-schema";

function arg(argv: string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}
function has(argv: string[], k: string): boolean {
  return argv.includes(`--${k}`);
}

/**
 * Resolve MISTRAL_API_KEY into process.env from the standard candidate .env files
 * (same set as the ferme-neuve bench), so this committed runner is self-sufficient.
 * The key is read into memory only — NEVER printed. Returns true when a key is present.
 */
function ensureMistralKey(): boolean {
  if (process.env["MISTRAL_API_KEY"] || process.env["OCR_API_KEY"]) return true;
  const candidates = [
    process.env["MISTRAL_ENV_FILE"],
    "/home/antoinefa/src/sentropic/.env",
    "/home/antoinefa/src/geo/.env",
    "/home/antoinefa/src/_acquisition-shared/mistral.env",
    "/home/antoinefa/src/_acquisition-shared/s3.env",
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    const env = loadEnv(p);
    if (env["MISTRAL_API_KEY"]) {
      process.env["MISTRAL_API_KEY"] = env["MISTRAL_API_KEY"];
      return true;
    }
  }
  return false;
}

/** `pdftotext -layout` → per-page texts (page break = \f). */
function pageTexts(pdfPath: string): string[] {
  const r = spawnSync("pdftotext", ["-q", "-layout", "-enc", "UTF-8", pdfPath, "-"], {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`pdftotext failed on ${pdfPath}: ${r.stderr?.slice(0, 160)}`);
  const parts = (r.stdout ?? "").split("\f");
  if (parts.length && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/** Count PDF pages via pdfinfo (poppler). */
function pdfPageCount(pdfPath: string): number {
  const r = spawnSync("pdfinfo", [pdfPath], { encoding: "utf8" });
  const m = r.stdout?.match(/Pages:\s+(\d+)/);
  return m ? Number(m[1]) : 0;
}

type NormFieldLike = ZoneNormsT["hauteur_max"];

/**
 * Reconcile ONE norm field seen twice for the same zone_code (repeated zone, or —
 * the dangerous case — one COLUMN PER CLASSE D'USAGES within a single-zone grille).
 *   - only one side published  → keep it (the other side simply did not read it)
 *   - both published, SAME value → keep it
 *   - both published, DIFFERENT  → REFUSE (value null, `divergence-colonnes`), raw kept
 * Never averages, never prefers a side: a divergence means the norm is not a
 * property of the zone alone, so no single value can be served as certain.
 */
export function mergeNormField(a: NormFieldLike, b: NormFieldLike): NormFieldLike {
  if (!a || a.value === null) return b && b.value !== null ? b : (a ?? b);
  if (!b || b.value === null) return a;
  if (a.value === b.value && a.unit === b.unit) return a;
  return { ...a, value: null, confidence: 0, flag: "divergence-colonnes" };
}

/** Field-wise reconciliation of two readings of the SAME zone_code. */
export function mergeZonesFieldWise(a: ZoneNormsT, b: ZoneNormsT): ZoneNormsT {
  return {
    ...a,
    usages: a.usages.length >= b.usages.length ? a.usages : b.usages,
    densite: mergeNormField(a.densite, b.densite),
    hauteur_min: mergeNormField(a.hauteur_min, b.hauteur_min),
    hauteur_max: mergeNormField(a.hauteur_max, b.hauteur_max),
    marges: {
      avant_min: mergeNormField(a.marges.avant_min, b.marges.avant_min),
      laterale_min: mergeNormField(a.marges.laterale_min, b.marges.laterale_min),
      arriere_min: mergeNormField(a.marges.arriere_min, b.marges.arriere_min),
    },
    frontage_min: mergeNormField(a.frontage_min, b.frontage_min),
    superficie_min: mergeNormField(a.superficie_min, b.superficie_min),
  };
}

/** Count the published (non-null) norm fields of a zone. */
function publishedCount(z: ZoneNormsT): number {
  return [
    z.densite,
    z.hauteur_min,
    z.hauteur_max,
    z.frontage_min,
    z.superficie_min,
    z.marges.avant_min,
    z.marges.laterale_min,
    z.marges.arriere_min,
  ].filter((f) => f && f.value !== null).length;
}

/**
 * Auto-detect the zones-in-columns / transposed grille block on the layout text.
 * A page qualifies when it carries a multi-zone HORIZONTAL header band OR the
 * transposed-columns signature (and is NOT a table-of-contents). Returns the
 * [min−margin, max+margin] 1-based page window, or null when nothing matched.
 */
function detectGrillePages(texts: string[], pageCount: number): number[] | null {
  const hits: number[] = [];
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i] ?? "";
    if (looksLikeTableOfContents(t)) continue;
    if (isMultiZoneHorizontalPage(t) || looksLikeTransposedColumnsGrille(t)) hits.push(i + 1);
  }
  if (hits.length === 0) return null;
  const total = pageCount > 0 ? pageCount : Math.max(...hits);
  const first = Math.max(1, Math.min(...hits) - AUTO_MARGIN);
  const last = Math.min(total, Math.max(...hits) + AUTO_MARGIN);
  const pages: number[] = [];
  for (let p = first; p <= last; p++) pages.push(p);
  return pages;
}

interface IngestReport {
  slug: string;
  pdf: string;
  engine: string;
  methode: string;
  pageSelection: string;
  pages: number[];
  pagesSelected: number;
  pagesProcessed: number;
  usd: number;
  chunksRead: number;
  chunksFailed: number;
  distinctZones: number;
  publishedFieldPct: number;
  crossval: { gridFound: boolean; sig: number; extracted: number; overlap: number; recoupSig: number };
  extractedNotInSig: string[];
  sample: string[];
  reasons: string[];
  gatesOk: boolean;
  deposited: boolean;
  key?: string;
  reason?: string;
}

async function ingestSlug(
  slug: string,
  opts: {
    pdf?: string;
    sourceUrl: string;
    reglement?: string;
    pages?: number[];
    firstPage?: number;
    lastPage?: number;
    budgetUsd: number;
    deposit: boolean;
    manifest: boolean;
    force: boolean;
  },
): Promise<IngestReport> {
  const pdf = opts.pdf ?? join(REPO, "work", "zonage-norms", slug, "grille.pdf");
  if (!existsSync(pdf)) throw new Error(`missing staged grille PDF: ${pdf}`);

  const texts = pageTexts(pdf);
  const pageCount = pdfPageCount(pdf) || texts.length;

  // ── Page selection (explicit list > explicit range > auto-detect > whole PDF) ──
  let pages: number[];
  let selectionKind: string;
  if (opts.pages && opts.pages.length > 0) {
    pages = opts.pages.filter((p) => p >= 1 && p <= pageCount);
    selectionKind = "explicit-list";
  } else if (opts.firstPage || opts.lastPage) {
    const first = opts.firstPage ?? 1;
    const last = Math.min(opts.lastPage ?? pageCount, pageCount);
    pages = [];
    for (let p = first; p <= last; p++) pages.push(p);
    selectionKind = `range ${first}..${last}`;
  } else {
    const detected = detectGrillePages(texts, pageCount);
    if (detected) {
      pages = detected;
      selectionKind = `auto-detect ${detected[0]}..${detected[detected.length - 1]}`;
    } else {
      pages = [];
      for (let p = 1; p <= pageCount; p++) pages.push(p);
      selectionKind = "whole-pdf (no grille pages detected)";
    }
  }

  // Budget guard: trim so estimated cost stays within --budget-usd.
  const maxByBudget =
    MISTRAL_SCHEMA_USD_PER_PAGE > 0
      ? Math.max(1, Math.floor(opts.budgetUsd / MISTRAL_SCHEMA_USD_PER_PAGE))
      : pages.length;
  if (pages.length > maxByBudget) pages = pages.slice(0, maxByBudget);

  const extract = await extractGrilleSchemaFromPdf(pdf, pages, {
    source_url: opts.sourceUrl,
    snapshot: SNAPSHOT,
    methode: SCHEMA_METHODE,
  });

  // Merge by canon zone key — FIELD-WISE CONCORDANCE, not "more published wins".
  // Two entries can carry the same zone_code for two reasons: the zone repeats
  // across chunks, or the grille gives ONE COLUMN PER CLASSE D'USAGES for a single
  // zone (marge avant 6 m for column 1, 10 m for column 2 — saint-andre-avellin
  // Annexe B). Keeping the "richer" entry would silently serve ONE class's norm as
  // the zone's norm. So: a field published by only one side is kept; two DIFFERENT
  // published values refuse the field (`divergence-colonnes`, raw kept).
  const byZone = new Map<string, ZoneNormsT>();
  for (const zn of extract.zones) {
    const key = canonZone(zn.zone_code);
    const prev = byZone.get(key);
    byZone.set(key, prev ? mergeZonesFieldWise(prev, zn) : zn);
  }
  const zones = [...byZone.values()];
  const fieldPct = publishedFieldPct(zones);

  const s3 = s3Client();
  const crossval = await crossValidateZoneCodes(s3, slug, zones);

  const report: IngestReport = {
    slug,
    pdf,
    engine: ENGINE,
    methode: SCHEMA_METHODE,
    pageSelection: selectionKind,
    pages,
    pagesSelected: pages.length,
    pagesProcessed: extract.pagesProcessed,
    usd: Math.round(extract.usd * 1e4) / 1e4,
    chunksRead: extract.chunksRead,
    chunksFailed: extract.chunksFailed,
    distinctZones: zones.length,
    publishedFieldPct: fieldPct,
    crossval: {
      gridFound: crossval.gridFound,
      sig: crossval.sigZoneCodes,
      extracted: crossval.extractedZoneCodes,
      overlap: crossval.overlap,
      recoupSig: Math.round(crossval.recoupSig * 1000) / 10,
    },
    extractedNotInSig: crossval.extractedNotInSig,
    sample: zones
      .slice(0, 8)
      .map(
        (z) =>
          `${z.zone_code}(h=${z.hauteur_max?.value ?? "-"},av=${z.marges.avant_min?.value ?? "-"},lat=${z.marges.laterale_min?.value ?? "-"},fr=${z.frontage_min?.value ?? "-"},sup=${z.superficie_min?.value ?? "-"},d=${z.densite?.value ?? "-"})`,
      ),
    reasons: extract.reasons,
    gatesOk: false,
    deposited: false,
  };

  // A captured-mode product must be complete: a skipped/invalid Mistral chunk
  // could otherwise turn a partial page range into apparently valid norms.
  if (extract.chunksFailed > 0) {
    report.reason = `anti-invention reject: ${extract.chunksFailed} Mistral schema chunk(s) failed`;
    return report;
  }

  // ── Anti-invention gates — identical floor to zonage-norms-run / transposed-ingest ──
  if (zones.length < MIN_DEPOSIT_ZONE_CODES) {
    report.reason = `below deposit gate: ${zones.length} unique zone_code(s) < ${MIN_DEPOSIT_ZONE_CODES}`;
    return report;
  }
  if (shouldRejectForZeroOverlap(crossval)) {
    report.reason = `anti-invention reject: grille found (${crossval.sigZoneCodes} SIG codes) but overlap=0`;
    return report;
  }
  if (shouldRejectForZeroNormFields(fieldPct)) {
    report.reason = "anti-invention reject: publishedFieldPct=0 (codes with no norm field)";
    return report;
  }
  report.gatesOk = true;

  if (!opts.deposit) return report;

  // NON-CLOBBERING guard: `depositParquetOnly` overwrites unconditionally, so a
  // rerun could regress a BETTER existing deposit (e.g. a Claude-4.8 / vision-route
  // parquet). Skip the write when a product already exists, unless --force.
  if (!opts.force && (await exists(s3, normsKey(slug)))) {
    report.reason = `already deposited (idempotent; pass --force to overwrite) — gates OK, fieldPct=${fieldPct}`;
    return report;
  }

  const meta = {
    source_url: opts.sourceUrl,
    methode: SCHEMA_METHODE,
    snapshot: SNAPSHOT,
    ...(opts.reglement ? { reglement: opts.reglement } : {}),
  };
  if (opts.manifest) {
    const result = await depositZonageNorms({ s3, slug, zones, meta, crossval });
    report.deposited = !result.skipped;
    report.key = result.key;
  } else {
    const { result } = await depositParquetOnly({ s3, slug, zones, meta, crossval });
    report.deposited = !result.skipped;
    report.key = result.key;
  }
  return report;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const engine = arg(argv, "engine") ?? ENGINE;
  if (engine !== ENGINE) {
    throw new Error(`unsupported --engine "${engine}" (only "${ENGINE}" is wired here)`);
  }
  if (!ensureMistralKey()) {
    throw new Error(
      "MISTRAL_API_KEY unavailable — export it or point MISTRAL_ENV_FILE at sentropic/.env (the OCR schema route requires it)",
    );
  }
  const slugArg = arg(argv, "slug");
  if (!slugArg) throw new Error("--slug <slug[,slug...]> is required");
  const slugs = slugArg.split(",").map((s) => s.trim()).filter(Boolean);
  const deposit = has(argv, "deposit");
  const force = has(argv, "force");
  // Default = parquet-only (no manifest race). --manifest opts into a direct write.
  const manifest = has(argv, "manifest");
  const sourceUrl = arg(argv, "source-url") ?? DEFAULT_SOURCE_URL;
  const reglement = arg(argv, "reglement");
  const budgetUsd = Number(arg(argv, "budget-usd") ?? "5");
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) {
    throw new Error("--budget-usd must be a finite positive number");
  }
  const pagesArg = arg(argv, "pages");
  const pages = pagesArg
    ? pagesArg.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n >= 1)
    : undefined;
  const firstPage = arg(argv, "first-page") ? Number(arg(argv, "first-page")) : undefined;
  const lastPage = arg(argv, "last-page") ? Number(arg(argv, "last-page")) : undefined;
  const pdf = slugs.length === 1 ? arg(argv, "pdf") : undefined;

  const reports: IngestReport[] = [];
  for (const slug of slugs) {
    try {
      reports.push(
        await ingestSlug(slug, {
          pdf,
          sourceUrl,
          reglement,
          ...(pages ? { pages } : {}),
          ...(firstPage ? { firstPage } : {}),
          ...(lastPage ? { lastPage } : {}),
          budgetUsd,
          deposit,
          manifest,
          force,
        }),
      );
    } catch (e) {
      reports.push({
        slug,
        pdf: pdf ?? `work/zonage-norms/${slug}/grille.pdf`,
        engine: ENGINE,
        methode: SCHEMA_METHODE,
        pageSelection: "n/a",
        pages: [],
        pagesSelected: 0,
        pagesProcessed: 0,
        usd: 0,
        chunksRead: 0,
        chunksFailed: 0,
        distinctZones: 0,
        publishedFieldPct: 0,
        crossval: { gridFound: false, sig: 0, extracted: 0, overlap: 0, recoupSig: 0 },
        extractedNotInSig: [],
        sample: [],
        reasons: [],
        gatesOk: false,
        deposited: false,
        reason: `ERROR: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
  const totalUsd = Math.round(reports.reduce((a, r) => a + r.usd, 0) * 1e4) / 1e4;
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      { product: "qc-zonage-norms", engine: ENGINE, method: SCHEMA_METHODE, deposit, totalUsd, reports },
      null,
      2,
    ),
  );
}

// Run only when invoked as a script — importing this module (tests of the merge
// helpers below) must not fire the CLI and its "--slug is required" throw.
const INVOKED_DIRECTLY =
  !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (INVOKED_DIRECTLY) {
  main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e instanceof Error ? e.stack : String(e));
    process.exit(1);
  });
}
