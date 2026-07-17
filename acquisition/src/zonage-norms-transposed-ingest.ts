/**
 * zonage-norms-transposed-ingest.ts — committed NATIVE-TEXT ($0, deterministic)
 * ingester for the TRANSPOSED "grille des spécifications" family (MRC de La
 * Matapédia / Mitis / Bas-Saint-Laurent; ~25 munis).
 *
 * WHY a dedicated path. These grilles split the zone header across TWO stacked,
 * column-aligned rows:
 *
 *     Numéro de zone   1   2   3  …  20  …
 *     Usage dominant   Cp  Hb  Hb …  Ha  …
 *
 * so the REAL zone code is the PER-COLUMN pair number+usage ("20 Ha" →
 * `canonZone` → "HA-20", matching the SIG grille). The frozen mistral-ocr mapper
 * reads the numeric row as a bare-number header and DROPS the usage row → code
 * "20" → overlap=0 vs SIG "20 Ha" (proven on sainte-irène et al.). The
 * `pdftotext -layout` projection of these grilles is clean and column-aligned, so
 * `parseTransposedGrilleNativePage` (packages/qc-sources) reads it verbatim — no
 * LLM, no cost — and this module wires it to the UNMODIFIED cross-validation +
 * anti-invention gates + the `qc-zonage-norms-<slug>.parquet` deposit.
 *
 * ANTI-INVENTION: every value is a verbatim column token gated by the frozen
 * `buildVisionField`; a number column with no usage aligned to it is dropped
 * (never given a fabricated usage); deposit is REFUSED unless ≥3 real zone codes,
 * overlap≠0 vs the SIG grille, and publishedFieldPct≠0.
 *
 * Usage (one committed command; the PDF is already staged at
 * work/zonage-norms/<slug>/grille.pdf):
 *   # report only (parse + crossval, NO deposit):
 *   npx tsx acquisition/src/zonage-norms-transposed-ingest.ts --slug sainte-irene --report
 *   # deposit the parquet (parquet-only, no manifest race — reconcile after):
 *   npx tsx acquisition/src/zonage-norms-transposed-ingest.ts --slug sainte-irene --deposit
 *   # several munis at once:
 *   npx tsx acquisition/src/zonage-norms-transposed-ingest.ts \
 *     --slug sainte-irene,sayabec,saint-tharcisius,saint-cleophas --deposit
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ZoneNormsT } from "../../packages/qc-sources/src/sources/grille-specifications-parser.js";
import {
  parseTransposedGrilleNativePage,
  parseTransposedColumnsGrille,
  looksLikeTransposedColumnsGrille,
  parseAffectationMatrixGrille,
  looksLikeAffectationMatrixGrille,
} from "../../packages/qc-sources/src/sources/grille-ocr-extractor.js";

import { s3Client } from "./lib/s3.js";
import {
  canonZone,
  crossValidateZoneCodes,
  depositParquetOnly,
  depositZonageNorms,
  publishedFieldPct,
  shouldRejectForZeroOverlap,
  shouldRejectForZeroNormFields,
} from "./lib/zonage-norms.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const SNAPSHOT = new Date().toISOString().slice(0, 10);
const METHODE = "native-text/grille-transposee";
/** Provenance tag for the zones-in-COLUMNS variant (Sept-Îles/Saint-Tite/Valcourt). */
const METHODE_COLS = "native-text/grille-transposee-colonnes";
/** Provenance tag for the stacked number/letter affectation MATRIX (MRC de Papineau). */
const METHODE_MATRIX = "native-text/grille-matrice-affectation";
/** Anti-invention floor: never deposit a product with fewer real zone codes. */
const MIN_DEPOSIT_ZONE_CODES = 3;
/** Default provenance anchor for the MRC de La Matapédia family (override with --source-url). */
const DEFAULT_SOURCE_URL = "https://www.mrcmatapedia.qc.ca/";

function arg(argv: string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}
function has(argv: string[], k: string): boolean {
  return argv.includes(`--${k}`);
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

interface IngestReport {
  slug: string;
  pdf: string;
  methode: string;
  transposedPages: number;
  distinctZones: number;
  publishedFieldPct: number;
  crossval: { gridFound: boolean; sig: number; extracted: number; overlap: number; recoupSig: number };
  extractedNotInSig: string[];
  sample: string[];
  gatesOk: boolean;
  deposited: boolean;
  key?: string;
  reason?: string;
}

async function ingestSlug(
  slug: string,
  opts: { pdf?: string; sourceUrl: string; reglement?: string; deposit: boolean; manifest: boolean },
): Promise<IngestReport> {
  const pdf = opts.pdf ?? join(REPO, "work", "zonage-norms", slug, "grille.pdf");
  if (!existsSync(pdf)) throw new Error(`missing staged grille PDF: ${pdf}`);

  const pages = pageTexts(pdf);
  // Parse every page; merge by canon zone key (more published fields wins). Try the
  // Matapédia number+usage split-header parser FIRST; when a page yields nothing
  // there, fall back to the zones-in-COLUMNS parser (Sept-Îles/Saint-Tite/Valcourt),
  // which reads the header codes directly. The two signatures are exclusive.
  const byZone = new Map<string, ZoneNormsT>();
  let transposedPages = 0;
  let matPages = 0;
  let colPages = 0;
  let matrixPages = 0;
  for (let i = 0; i < pages.length; i++) {
    const text = pages[i] ?? "";
    let zs = parseTransposedGrilleNativePage(text, i + 1, {
      source_url: opts.sourceUrl,
      snapshot: SNAPSHOT,
      methode: METHODE,
    });
    if (zs.length > 0) matPages++;
    if (zs.length === 0 && looksLikeTransposedColumnsGrille(text)) {
      zs = parseTransposedColumnsGrille(text, i + 1, {
        source_url: opts.sourceUrl,
        snapshot: SNAPSHOT,
        methode: METHODE_COLS,
      });
      if (zs.length > 0) colPages++;
    }
    // Last: the affectation MATRIX (MRC de Papineau), whose header is stacked
    // number-over-letter and whose code is never printed. Its signature is
    // exclusive of both parsers above (they need a literal label row / an inline
    // code), so it only ever sees pages the others returned nothing for.
    if (zs.length === 0 && looksLikeAffectationMatrixGrille(text)) {
      zs = parseAffectationMatrixGrille(text, i + 1, {
        source_url: opts.sourceUrl,
        snapshot: SNAPSHOT,
        methode: METHODE_MATRIX,
      });
      if (zs.length > 0) matrixPages++;
    }
    if (zs.length > 0) transposedPages++;
    for (const zn of zs) {
      const key = canonZone(zn.zone_code);
      const prev = byZone.get(key);
      if (!prev || publishedCount(zn) > publishedCount(prev)) byZone.set(key, zn);
    }
  }
  // The deposit's summary methode reflects the parser that produced the majority of
  // pages (per-field provenance already carries the exact method per zone).
  const depositMethode =
    matrixPages > colPages && matrixPages > matPages
      ? METHODE_MATRIX
      : colPages > matPages
        ? METHODE_COLS
        : METHODE;
  const zones = [...byZone.values()];
  const fieldPct = publishedFieldPct(zones);

  const s3 = s3Client();
  const crossval = await crossValidateZoneCodes(s3, slug, zones);

  const report: IngestReport = {
    slug,
    pdf,
    methode: depositMethode,
    transposedPages,
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
      .map((z) => `${z.zone_code}(h=${z.hauteur_max?.value ?? "-"},av=${z.marges.avant_min?.value ?? "-"},d=${z.densite?.value ?? "-"})`),
    gatesOk: false,
    deposited: false,
  };

  // Gates — identical to zonage-norms-run's anti-invention floor.
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

  const meta = {
    source_url: opts.sourceUrl,
    methode: depositMethode,
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
  const slugArg = arg(argv, "slug");
  if (!slugArg) throw new Error("--slug <slug[,slug...]> is required");
  const slugs = slugArg.split(",").map((s) => s.trim()).filter(Boolean);
  const deposit = has(argv, "deposit");
  const manifest = !has(argv, "no-manifest"); // default: write manifest; --no-manifest → parquet-only
  const sourceUrl = arg(argv, "source-url") ?? DEFAULT_SOURCE_URL;
  const reglement = arg(argv, "reglement");
  const pdf = slugs.length === 1 ? arg(argv, "pdf") : undefined;

  const reports: IngestReport[] = [];
  for (const slug of slugs) {
    try {
      reports.push(await ingestSlug(slug, { pdf, sourceUrl, reglement, deposit, manifest }));
    } catch (e) {
      reports.push({
        slug,
        pdf: pdf ?? `work/zonage-norms/${slug}/grille.pdf`,
        methode: METHODE_COLS,
        transposedPages: 0,
        distinctZones: 0,
        publishedFieldPct: 0,
        crossval: { gridFound: false, sig: 0, extracted: 0, overlap: 0, recoupSig: 0 },
        extractedNotInSig: [],
        sample: [],
        gatesOk: false,
        deposited: false,
        reason: `ERROR: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ product: "qc-zonage-norms", method: METHODE, deposit, reports }, null, 2));
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
