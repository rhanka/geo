/**
 * zonage-norms-amendment-ingest.ts — deposit a `qc-zonage-norms-<slug>` product that
 * COMBINES a consolidated grille PDF with one or more ZONE-CREATION AMENDMENT feuillets.
 *
 * WHY a dedicated runner. A municipal "grille des normes" (consolidated refonte) is
 * re-extracted fine by `zonage-norms-run.ts` (multi-column OCR). But a zone-creation
 * amendment (e.g. Saint-Raymond Règl 922-26 "créer la zone HC-14") publishes the new
 * zone on its OWN feuillet page as a SINGLE numbered column under the family header
 * ("Zones résidentielles haute densité HC" + a lone "14" column). Every committed
 * multi-zone engine (markdown-OCR / mistral-schema / multizone-vision) FAILS to
 * compose the code on that single-column layout: the markdown mapper needs ≥2 numbered
 * columns (`asPrefixedNumericHeader`), the schema/multizone engines read the family
 * header ("HC") and drop the number. The frozen SINGLE-ZONE vision extractor, however,
 * reads such a page cleanly when handed the zone code the amendment's OWN title
 * declares verbatim (`--amend …|HC-14|…`). This runner wires that together:
 *
 *   base grille PDF  → `extractGrilleOcrFromPdf`  (the consolidated 342-zone re-extract)
 *   each amendment   → `extractZonePageFromPdf` + verbatim `expectedZone`  (1 zone/page)
 *   merge by zone_code (more-published wins) → crossval → anti-invention gates → deposit.
 *
 * This runner adds ZERO parsing of its own: every value comes from the FROZEN
 * `@geo/qc-sources` extractors (each cell gated by `buildVisionField` / the OCR mapper).
 * The zone CODE for an amendment is the verbatim code from the amendment's own title —
 * a label pin, never a fabricated value. `null` always beats a fabricated norm; the
 * same deposit gates as `zonage-norms-run` apply (≥3 codes, overlap≠0, fieldPct≠0).
 *
 * Deposits PARQUET-ONLY (never races the shared manifest); reconcile afterwards with
 * `zonage-norms-manifest-merge.ts --apply`.
 *
 * Usage (report first, then deposit):
 *   npx tsx acquisition/src/zonage-norms-amendment-ingest.ts --slug saint-raymond \
 *     --base-pdf /path/grille-annexe-I.pdf --base-source-url https://…/grille.pdf \
 *     --amend "/path/hc14.pdf|1|HC-14|https://…/reg-922-26.pdf" [--amend "…"] \
 *     [--reglement 922-26] [--report | --deposit]
 *
 * An --amend spec is pipe-delimited: <pdf>|<page(1-based)>|<zone_code>|<source_url>.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  extractGrilleOcrFromPdf,
  parseZoneHeader,
} from "../../packages/qc-sources/src/sources/grille-ocr-extractor.js";
import {
  extractZonePageFromPdf,
  MistralVisionGrille,
} from "../../packages/qc-sources/src/sources/grille-vision-extractor.js";
import {
  ZoneNorms,
  type ZoneNormsT,
  type NormFieldT,
} from "../../packages/qc-sources/src/sources/grille-specifications-parser.js";

import { s3Client } from "./lib/s3.js";
import { ensureOcrKeyLoaded } from "./lib/ocr-env.js";
import { resolveOcrCall } from "./lib/ocr.js";
import {
  crossValidateZoneCodes,
  depositParquetOnly,
  publishedFieldPct,
  shouldRejectForZeroOverlap,
  shouldRejectForZeroNormFields,
  type FlattenMeta,
} from "./lib/zonage-norms.js";

/** Anti-invention floor: never deposit a product with fewer real zone codes. */
const MIN_DEPOSIT_ZONE_CODES = 3;

interface Amendment {
  pdf: string;
  page: number;
  code: string;
  sourceUrl: string;
}

interface Args {
  slug: string;
  basePdf: string;
  baseSourceUrl: string;
  reglement?: string;
  amendments: Amendment[];
  snapshot: string;
  deposit: boolean;
  dpi?: number;
  /** How many independent vision reads per amendment page (cross-run concordance). */
  amendReads: number;
}

function parseArgs(argv: string[]): Args {
  const get = (k: string): string | undefined => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const getAll = (k: string): string[] => {
    const out: string[] = [];
    for (let i = 0; i < argv.length; i++) if (argv[i] === `--${k}` && argv[i + 1]) out.push(argv[i + 1]!);
    return out;
  };
  const slug = get("slug");
  const basePdf = get("base-pdf");
  const baseSourceUrl = get("base-source-url");
  if (!slug || !basePdf || !baseSourceUrl) {
    throw new Error("required: --slug <slug> --base-pdf <path> --base-source-url <url>");
  }
  const amendments = getAll("amend").map((spec) => {
    const [pdf, page, code, sourceUrl] = spec.split("|");
    if (!pdf || !page || !code || !sourceUrl) {
      throw new Error(`bad --amend spec (need <pdf>|<page>|<code>|<source_url>): ${spec}`);
    }
    return { pdf, page: Number(page), code: code.trim(), sourceUrl };
  });
  return {
    slug,
    basePdf,
    baseSourceUrl,
    ...(get("reglement") ? { reglement: get("reglement")! } : {}),
    amendments,
    snapshot: get("snapshot") ?? new Date().toISOString().slice(0, 10),
    deposit: argv.includes("--deposit"),
    ...(get("dpi") ? { dpi: Number(get("dpi")) } : {}),
    amendReads: Math.max(1, Number(get("amend-reads") ?? "6")),
  };
}

/**
 * CROSS-RUN CONCORDANCE for one norm field over K independent vision reads.
 *
 * ANTI-INVENTION, STRICTER THAN A SINGLE READ. A single 2-pass read already nulls a
 * field unless BOTH passes concur; this adds a SECOND barrier across K reads: publish
 * a value ONLY when every read that produced a non-null value agrees on it. So a field
 * is deposited iff ≥1 read saw a value AND no two reads disagree — otherwise null.
 * A value can therefore never be fabricated or averaged; a flickering/uncertain cell
 * collapses to null (null beats a guess), and a stably-read cell keeps its verbatim
 * value (raw/unit/provenance from the first agreeing read).
 *
 * NB — this does NOT catch a value that is CONSISTENTLY mis-read the same way across
 * every run (e.g. a two-row "8.3 hauteur min / max" cell the OCR always conflates to
 * the min): that is an EXTRACTION-model limit, and such zones must be excluded upstream
 * (the caller only ingests amendment feuillets whose fields are NOT subject to a stable
 * mis-read — verified per zone). Concordance guarantees "correct-or-null" only for the
 * flicker case, never for a deterministic mis-read.
 */
export function concordField(fields: (NormFieldT | null | undefined)[]): NormFieldT | null {
  const nonNull = fields.filter((f): f is NormFieldT => !!f && f.value !== null);
  if (nonNull.length === 0) return null;
  const first = nonNull[0]!;
  if (nonNull.every((f) => f.value === first.value)) return first;
  return null; // reads disagree → unreliable → null
}

/** `pdftotext -layout` → per-page texts (page break = \f). */
function pageTexts(pdfPath: string): string[] {
  const r = spawnSync("pdftotext", ["-q", "-layout", "-enc", "UTF-8", pdfPath, "-"], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`pdftotext failed on ${pdfPath}: ${r.stderr?.slice(0, 160)}`);
  const parts = (r.stdout ?? "").split("\f");
  if (parts.length && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/** How many of a zone's 8 norm fields carry a published (non-null) value. */
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

/** Merge zones by canonical zone_code key, keeping the row with more published norms. */
function mergeByZone(zones: ZoneNormsT[]): ZoneNormsT[] {
  const byZone = new Map<string, ZoneNormsT>();
  for (const zn of zones) {
    const key = zn.zone_code.toUpperCase().replace(/\s+/g, "");
    const prev = byZone.get(key);
    if (!prev || publishedCount(zn) > publishedCount(prev)) byZone.set(key, zn);
  }
  return [...byZone.values()];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const keyFrom = ensureOcrKeyLoaded();
  if (keyFrom) console.error(`[ocr-env] loaded OCR key from ${keyFrom}`);
  const s3 = s3Client();

  if (!existsSync(args.basePdf)) throw new Error(`missing base PDF: ${args.basePdf}`);
  console.error(`[amend-ingest] slug=${args.slug} base=${args.basePdf} amendments=${args.amendments.length}`);

  // ── 1. Base consolidated grille via the frozen OCR path (multi-column feuillets). ──
  const ocr = resolveOcrCall();
  const texts = pageTexts(args.basePdf);
  const basePages: number[] = texts.map((_, i) => i + 1);
  const zoneCodes = texts.map((t) => parseZoneHeader(t) ?? undefined);
  const baseRes = await extractGrilleOcrFromPdf(args.basePdf, basePages, {
    source_url: args.baseSourceUrl,
    snapshot: args.snapshot,
    methode: ocr.methode,
    ocr: ocr.call,
    costPerPage: ocr.costPerPage,
    zoneCodes,
  });
  const baseZones = mergeByZone(baseRes.zones);
  console.error(
    `[base] pages=${basePages.length} pagesBilled=${baseRes.pagesProcessed} ` +
      `zones=${baseZones.length} usd=$${baseRes.usd.toFixed(4)}`,
  );

  // ── 2. Each amendment: one zone/page via the frozen single-zone vision extractor,
  //       the code pinned to the amendment's own verbatim declared zone code. ──
  const visionBase = new MistralVisionGrille();
  const vision = visionBase.extract.bind(visionBase);
  const amendZones: ZoneNormsT[] = [];
  const amendReports: Record<string, unknown>[] = [];
  for (const a of args.amendments) {
    if (!existsSync(a.pdf)) throw new Error(`missing amendment PDF: ${a.pdf}`);
    // K independent 2-pass vision reads → cross-run concordance per field. A single
    // read of a single-column amendment feuillet is noisy (the model flickers on the
    // adjacent "8.3" hauteur rows); concordance publishes a value ONLY when the reads
    // that saw it agree, else null. The zone CODE is pinned to the amendment's own
    // verbatim declared code (never inferred).
    const reads: ZoneNormsT[] = [];
    for (let k = 0; k < args.amendReads; k++) {
      try {
        reads.push(
          await extractZonePageFromPdf(a.pdf, a.page, {
            source_url: a.sourceUrl,
            snapshot: args.snapshot,
            expectedZone: a.code,
            vision,
            ...(args.dpi ? { dpi: args.dpi } : {}),
          }),
        );
      } catch (e) {
        console.error(`[amend] ${a.code} read ${k}: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`);
      }
    }
    if (reads.length === 0) {
      amendReports.push({ code: a.code, error: "all vision reads failed" });
      continue;
    }
    const pick = <T>(sel: (z: ZoneNormsT) => T | null | undefined): (T | null | undefined)[] =>
      reads.map(sel);
    const richest = reads.reduce((best, z) => (publishedCount(z) > publishedCount(best) ? z : best), reads[0]!);
    const zn = ZoneNorms.parse({
      zone_code: a.code, // verbatim from the amendment's own title (label pin, not a value)
      zone_page: `${a.code} (amendment feuillet, ${reads.length} concordant vision reads)`,
      usages: [...richest.usages],
      densite: concordField(pick((z) => z.densite)),
      hauteur_min: concordField(pick((z) => z.hauteur_min)),
      hauteur_max: concordField(pick((z) => z.hauteur_max)),
      frontage_min: concordField(pick((z) => z.frontage_min)),
      superficie_min: concordField(pick((z) => z.superficie_min)),
      marges: {
        avant_min: concordField(pick((z) => z.marges.avant_min)),
        laterale_min: concordField(pick((z) => z.marges.laterale_min)),
        arriere_min: concordField(pick((z) => z.marges.arriere_min)),
      },
    });
    amendZones.push(zn);
    amendReports.push({
      code: zn.zone_code,
      reads: reads.length,
      published: publishedCount(zn),
      densite: zn.densite?.value ?? null,
      hauteur_max: zn.hauteur_max?.value ?? null,
      hauteur_min: zn.hauteur_min?.value ?? null,
      marge_avant_min: zn.marges.avant_min?.value ?? null,
      marge_laterale_min: zn.marges.laterale_min?.value ?? null,
      marge_arriere_min: zn.marges.arriere_min?.value ?? null,
    });
    console.error(`[amend] ${a.code}: published=${publishedCount(zn)}/8 over ${reads.length} concordant reads`);
  }

  const zones = mergeByZone([...baseZones, ...amendZones]);
  const crossval = await crossValidateZoneCodes(s3, args.slug, zones);
  const fieldPct = publishedFieldPct(zones);
  console.error(
    `[crossval] grid=${crossval.gridFound} sig=${crossval.sigZoneCodes} extracted=${crossval.extractedZoneCodes} ` +
      `overlap=${crossval.overlap} recoupExtracted=${(crossval.recoupExtracted * 100).toFixed(0)}% fieldPct=${fieldPct}%`,
  );

  const gateReject =
    zones.length === 0
      ? "0 zones extracted"
      : shouldRejectForZeroOverlap(crossval)
        ? `anti-invention: grid found (${crossval.sigZoneCodes} SIG codes) but overlap=0`
        : crossval.extractedZoneCodes < MIN_DEPOSIT_ZONE_CODES
          ? `below deposit gate: ${crossval.extractedZoneCodes} < ${MIN_DEPOSIT_ZONE_CODES}`
          : shouldRejectForZeroNormFields(fieldPct)
            ? "anti-invention: publishedFieldPct=0"
            : null;

  let deposited = false;
  let key: string | undefined;
  if (args.deposit && !gateReject) {
    const meta: FlattenMeta = {
      source_url: args.baseSourceUrl,
      ...(args.reglement ? { reglement: args.reglement } : {}),
      methode: amendZones.length > 0 ? `${ocr.methode}+amendment-vision` : ocr.methode,
      snapshot: args.snapshot,
    };
    const { result } = await depositParquetOnly({ s3, slug: args.slug, zones, meta, crossval });
    deposited = true;
    key = result.key;
    console.error(`[deposit] parquet-only → ${result.key} rows=${result.rows} fieldPct=${result.publishedFieldPct}%`);
  }

  console.log(
    JSON.stringify(
      {
        slug: args.slug,
        deposited,
        gateReject,
        key,
        baseZones: baseZones.length,
        amendmentZones: amendZones.length,
        totalZones: zones.length,
        uniqueZoneCodes: crossval.extractedZoneCodes,
        publishedFieldPct: fieldPct,
        crossval: {
          gridFound: crossval.gridFound,
          sigZoneCodes: crossval.sigZoneCodes,
          overlap: crossval.overlap,
          recoupExtracted: crossval.recoupExtracted,
          recoupSig: crossval.recoupSig,
        },
        amendments: amendReports,
      },
      null,
      2,
    ),
  );
}

// Run only as the CLI entry point (so a test can import `concordField` without
// triggering the live extraction/deposit).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.stack : String(e));
    process.exit(1);
  });
}
