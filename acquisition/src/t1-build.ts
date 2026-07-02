/**
 * t1-build.ts — T1 GeoPDF zoning end-to-end (pure-Node, no GDAL).
 *
 *   GeoPDF (georeferenced, labels=text)  +  province cadastre (S3)
 *      → embedded page→WGS84 transform   (t1-georef, /VP /Measure /GPTS)
 *      → georeferenced zone-code labels   (t1-labels, pdftotext -bbox)
 *      → cadastre line-of-sight nearest-label aggregation  (t1-zones)
 *      → 1 MultiPolygon / zone, WGS84, schema {zone_code, kind, source,
 *        confidence, n_lots}  →  normalized/ca-qc-zonage/qc-zonage-<slug>.geojson
 *
 * This is the TypeScript replacement for the Python legacy producer of the
 * saint-amable golden (build_zones.py + the OSM-RANSAC georef), now reading the
 * georeferencing straight out of the PDF — no GDAL, no manual GCPs.
 *
 * QA (strict, anti-invention — a failing gate ABORTS, never fabricates):
 *   - georef present (/VP /Measure /GEO) and corner residual below threshold,
 *   - ≥ min-codes distinct lettered zone codes (the anti-#74 rule),
 *   - labels land INSIDE the cadastre footprint (spatial agreement),
 *   - every output ring is a real cadastral lot; every zone_code verbatim PDF.
 *
 * Usage:
 *   tsx src/t1-build.ts --slug delson --pdf <url|path> [--dry-run]
 *                       [--out <dir>] [--cutoff-m 1500] [--min-codes 10]
 *                       [--max-residual-m 50] [--spatial-km 8]
 *                       [--labels text|gpt55] [--dict <codes.json>]
 *                       [--page 1] [--ocr-dpi 200] [--label-region x0,y0,x1,y1]
 *                       [--allow-numeric-codes]
 *
 * --allow-numeric-codes (default OFF) is the SAFE relaxation of the anti-#74
 * lettered rule for munis that zone with PURE-NUMERIC codes (val-dor 100–1000,
 * acton-vale 101–105). It REQUIRES --dict and admits a numeric code only when it
 * is verbatim in the dict, the dict is not a trivial 1..N run, and the extracted
 * set matches the dict SET (see lib/numeric-codes.ts). Otherwise it ABORTS.
 *
 * --labels gpt55 is for a GEOREFERENCED *glyph* GeoPDF (labels drawn as vector
 * outlines → pdftotext sees 0 words) in an environment WITHOUT tesseract: it
 * rasterizes the neatline, reads positioned labels with GPT-5.5 vision, and
 * keeps ONLY codes that validate verbatim + unambiguously against --dict (the
 * municipality's by-law code list). If no real codes validate, it ABORTS.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FeatureCollection } from "geojson";

import { extractGeoRef } from "./lib/t1-georef.js";
import { extractLabels, type ExtractLabelsResult } from "./lib/t1-labels.js";
import { nonAdmissibleCodes, numericDictSet, validateNumericRelaxation } from "./lib/numeric-codes.js";
import { buildZones, projConstants } from "./lib/t1-zones.js";
import { s3Client, getBytes, putBytes, BUCKET } from "./lib/s3.js";
import { haversineKm, bboxCenter, mergeByZoneCode } from "./lib/zone-serve.js";

interface Args {
  slug: string;
  pdf: string;
  dryRun: boolean;
  out?: string;
  cutoffM: number;
  minCodes: number;
  maxResidualM: number;
  spatialKm: number;
  cadastre?: string;
  /** "text" = pdftotext selectable labels; "gpt55" = GPT-5.5 positioned vision
   * OCR for GLYPH GeoPDFs (labels drawn as outlines, no selectable text). */
  labels: "text" | "gpt55";
  dict?: string;
  page?: number;
  ocrDpi: number;
  labelRegion?: [number, number, number, number];
  /** SAFE, dict-gated relaxation of the anti-#74 rule for numeric zone codes. */
  allowNumericCodes: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    if (t.startsWith("--")) {
      const key = t.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) a[key] = true;
      else {
        a[key] = next;
        i++;
      }
    }
  }
  if (!a["slug"] || !a["pdf"]) {
    throw new Error("required: --slug <slug> --pdf <url|path>");
  }
  const labels = String(a["labels"] ?? "text");
  if (labels !== "text" && labels !== "gpt55") throw new Error("--labels must be text|gpt55");
  let labelRegion: [number, number, number, number] | undefined;
  if (typeof a["label-region"] === "string") {
    const r = a["label-region"].split(",").map(Number);
    if (r.length === 4 && r.every((x) => Number.isFinite(x))) labelRegion = r as [number, number, number, number];
  }
  return {
    slug: String(a["slug"]),
    pdf: String(a["pdf"]),
    dryRun: Boolean(a["dry-run"]),
    out: a["out"] ? String(a["out"]) : undefined,
    cutoffM: a["cutoff-m"] ? Number(a["cutoff-m"]) : 1500,
    minCodes: a["min-codes"] ? Number(a["min-codes"]) : 10,
    maxResidualM: a["max-residual-m"] ? Number(a["max-residual-m"]) : 50,
    spatialKm: a["spatial-km"] ? Number(a["spatial-km"]) : 8,
    cadastre: a["cadastre"] ? String(a["cadastre"]) : undefined,
    labels,
    dict: a["dict"] ? String(a["dict"]) : undefined,
    page: a["page"] ? Number(a["page"]) : undefined,
    ocrDpi: a["ocr-dpi"] ? Number(a["ocr-dpi"]) : 200,
    labelRegion,
    allowNumericCodes: Boolean(a["allow-numeric-codes"]),
  };
}

function loadDict(path: string): { codes: string[] } {
  const j = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const codes = Array.isArray(j) ? j : (j as { codes?: unknown }).codes;
  if (!Array.isArray(codes)) throw new Error("--dict must be a JSON array of codes or { codes: [...] }");
  return { codes: codes.map(String) };
}

async function resolvePdf(pdf: string): Promise<string> {
  if (!/^https?:/.test(pdf)) {
    if (!existsSync(pdf)) throw new Error(`pdf not found: ${pdf}`);
    return pdf;
  }
  const path = join(tmpdir(), `t1-${Date.now()}.pdf`);
  execSync(`curl -sL -A "Mozilla/5.0" ${JSON.stringify(pdf)} -o ${JSON.stringify(path)}`);
  return path;
}

function fail(msg: string): never {
  console.error(`\n[t1-build] ABORT (anti-invention): ${msg}`);
  process.exit(2);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const t0 = Date.now();
  console.error(`[t1-build] slug=${args.slug} pdf=${args.pdf}`);

  // 1. PDF + embedded georef -------------------------------------------------
  const pdfPath = await resolvePdf(args.pdf);
  const pdfBuf = readFileSync(pdfPath);
  const geo = extractGeoRef(pdfBuf, pdfPath);
  if (!geo) {
    fail(
      "no /VP /Measure /GEO georeferencing found — not a parseable T1 GeoPDF " +
        "(may be a TerraGo /LGIDict GeoPDF or a non-georef T2; use the dedicated path).",
    );
  }
  console.error(
    `[t1-build] georef: ${geo.crsName} | residual ${geo.maxResidualM.toFixed(2)} m | ` +
      `scale ${geo.scaleMPerPt.toFixed(3)} m/pt`,
  );
  if (geo.maxResidualM > args.maxResidualM) {
    fail(`georef corner residual ${geo.maxResidualM.toFixed(1)} m > ${args.maxResidualM} m`);
  }

  // 2. Labels ----------------------------------------------------------------
  // Text path (pdftotext) for selectable-label GeoPDFs; GPT-5.5 vision path for
  // GLYPH GeoPDFs (labels drawn as outlines → pdftotext sees 0 words). The
  // vision reads are dict-validated (verbatim, unambiguous) against the by-law
  // code list — the same anti-invention guard as the T2 gpt55 path.
  const source = args.labels === "gpt55" ? "geopdf-gpt55-vision" : "geopdf-esri";
  // Dict + numeric relaxation (default OFF; requires --dict). Hoisted so both the
  // text and gpt55 paths admit dict-backed pure-numeric codes when enabled.
  let dictCodes: string[] | undefined;
  if (args.dict) dictCodes = loadDict(args.dict).codes;
  if (args.allowNumericCodes && !dictCodes) fail("--allow-numeric-codes requires --dict <authoritative-zone-codes.json>");
  const numericDict = args.allowNumericCodes && dictCodes ? numericDictSet(dictCodes) : undefined;
  if (numericDict) console.error(`[t1-build] numeric relaxation ON: ${numericDict.size} dict-backed numeric codes`);
  let lab: ExtractLabelsResult;
  let gpt55Stats: Record<string, unknown> = {};
  if (args.labels === "gpt55") {
    if (!dictCodes) fail("--labels gpt55 requires --dict <authoritative-zone-codes.json>");
    const dict = dictCodes;
    console.error(`[t1-build] GPT-5.5 dictionary: ${dict.length} authoritative codes (${args.dict})`);
    const { extractLabelsGpt55 } = await import("./lib/t2-labels-gpt55.js");
    // Default crop = the embedded neatline (geo.bbox is PDF user-space, y-up);
    // convert to a top-left region for the rasteriser, or take --label-region.
    const [nx0, ny0, nx1, ny1] = geo.bbox;
    const neatlineRegion: [number, number, number, number] = [
      Math.min(nx0, nx1),
      geo.pageH - Math.max(ny0, ny1),
      Math.max(nx0, nx1),
      geo.pageH - Math.min(ny0, ny1),
    ];
    const page = args.page ?? 1;
    const gptLab = await extractLabelsGpt55(pdfPath, geo, dict, args.slug, {
      dpi: args.ocrDpi,
      page,
      region: args.labelRegion ?? neatlineRegion,
      ...(args.allowNumericCodes ? { allowNumeric: true } : {}),
    });
    lab = gptLab;
    gpt55Stats = {
      dict_size: dict.length,
      ocr_engine: gptLab.ocr_engine,
      gpt55_reads: gptLab.n_model_labels,
      gpt55_validated: gptLab.n_validated,
      gpt55_exact: gptLab.n_exact,
      gpt55_canonical: gptLab.n_canonical,
      gpt55_rejected: gptLab.n_rejected,
      gpt55_distinct: gptLab.n_distinct,
      gpt55_crop: gptLab.image_path,
      gpt55_snap_rate_pct: gptLab.snap_rate_pct,
      gpt55_latency_ms: gptLab.latency_ms,
      gpt55_tokens_input: gptLab.usage.inputTokens,
      gpt55_tokens_output: gptLab.usage.outputTokens,
      gpt55_reject_samples: gptLab.reject_samples,
    };
    console.error(
      `[t1-build] GPT-5.5 labels: ${gptLab.n_model_labels} reads, ${gptLab.nCodeLike} code-like, ` +
        `${gptLab.n_validated} validated (${gptLab.n_exact} exact + ${gptLab.n_canonical} canonical), ` +
        `${gptLab.n_rejected} rejected, ${gptLab.n_distinct} distinct codes`,
    );
    console.error(`[t1-build] GPT-5.5 rejects: ${gptLab.reject_samples.join(" | ")}`);
  } else {
    lab = extractLabels(pdfPath, geo, {
      ...(args.page ? { page: args.page } : {}),
      ...(numericDict ? { numericDict } : {}),
    });
  }
  const distinct = new Set(lab.codePoints.map((c) => c.code));
  const minCodes = Math.max(3, args.minCodes);
  console.error(
    `[t1-build] labels: ${lab.nWords} words, ${lab.nCodeLike} code-like, ` +
      `${lab.nInsideFrame} in-frame (${lab.rejectedOutsideFrame} rejected outside), ` +
      `${distinct.size} distinct codes`,
  );
  if (distinct.size < minCodes) {
    fail(
      `only ${distinct.size} distinct zone codes (< ${minCodes}); ` +
        (args.labels === "text"
          ? "labels may be glyphs → retry with --labels gpt55 --dict <codes.json>"
          : "vision OCR yielded too few real codes → ABORT (no fabrication)"),
    );
  }
  // anti-affectation always; anti-#74 lettered rule unless the SAFE numeric
  // relaxation is on (dict-gated) — then dict-backed numeric codes are allowed.
  const banned = /^(affectation|cmm|mrc|sad|pmad)/i;
  const bannedHit = [...distinct].filter((c) => banned.test(c));
  if (bannedHit.length > 0) fail(`affectation/CMM tokens present: ${bannedHit.join(", ")}`);
  if (numericDict && dictCodes) {
    const bad = nonAdmissibleCodes([...distinct], numericDict);
    if (bad.length > 0) fail(`codes neither lettered nor dict-numeric present: ${bad.slice(0, 8).join(", ")}`);
    const guard = validateNumericRelaxation({ distinctExtracted: [...distinct], dictCodes });
    if (!guard.ok) fail(`numeric-code guard: ${guard.reason}`);
    console.error(`[t1-build] numeric-code guard OK: ${guard.numericInDict} dict-validated numeric codes (dict has ${guard.dictNumeric})`);
  } else {
    const nonLettered = [...distinct].filter((c) => !/[A-Za-z]/.test(c) || !/\d/.test(c));
    if (nonLettered.length > 0) fail(`non-lettered (sequential?) codes present: ${nonLettered.slice(0, 8).join(", ")}`);
  }

  // 3. Cadastre --------------------------------------------------------------
  const s3 = s3Client();
  const cadKey = args.cadastre ?? `normalized/qc-cadastre-lots/${args.slug}.geojson`;
  let cadBuf: Buffer;
  if (args.cadastre && existsSync(args.cadastre)) cadBuf = readFileSync(args.cadastre);
  else cadBuf = await getBytes(s3, cadKey);
  const cadastre = JSON.parse(cadBuf.toString("utf8")) as FeatureCollection;
  const { center: cadCenter, bbox: cadBbox } = bboxCenter(cadastre);
  const lat0 = (cadBbox[1] + cadBbox[3]) / 2;
  console.error(
    `[t1-build] cadastre: ${cadastre.features.length} lots, center ` +
      `${cadCenter[0].toFixed(4)},${cadCenter[1].toFixed(4)}`,
  );

  // 3b. spatial gate: labels must sit inside the cadastre footprint.
  const labCenter: [number, number] = lab.codePoints.reduce(
    (acc, c) => [acc[0] + c.lon / lab.codePoints.length, acc[1] + c.lat / lab.codePoints.length],
    [0, 0] as [number, number],
  );
  const spatialKm = haversineKm(labCenter, cadCenter);
  console.error(`[t1-build] spatial: label-centroid vs cadastre-centroid = ${spatialKm.toFixed(2)} km`);
  if (spatialKm > args.spatialKm) {
    fail(`labels ${spatialKm.toFixed(1)} km from cadastre (> ${args.spatialKm} km) — georef mismatch`);
  }
  const inBbox = lab.codePoints.filter(
    (c) => c.lon >= cadBbox[0] && c.lon <= cadBbox[2] && c.lat >= cadBbox[1] && c.lat <= cadBbox[3],
  ).length;
  console.error(`[t1-build] ${inBbox}/${lab.codePoints.length} labels inside cadastre bbox`);

  // 4. Cadastre aggregation --------------------------------------------------
  const { featureCollection, stats } = buildZones(cadastre, lab.codePoints, {
    lat0,
    cutoffM: args.cutoffM,
    source,
    confidence: "contour-auto",
    dissolve: true,
  });
  void projConstants;
  const lotToZonePct = (100 * stats.n_lots_assigned) / stats.n_lots_total;
  // serving layer: 1 feature per distinct zone_code.
  const served = mergeByZoneCode(featureCollection);
  console.error(
    `[t1-build] zones: ${stats.n_zone_features} code-point features -> ${served.features.length} ` +
      `distinct-code features, ${stats.n_lots_assigned}/${stats.n_lots_total} ` +
      `lots (${lotToZonePct.toFixed(1)}%), ${stats.n_empty_labels} empty labels`,
  );

  // 5. Output ----------------------------------------------------------------
  const elapsedS = (Date.now() - t0) / 1000;
  const report = {
    slug: args.slug,
    source,
    confidence: "contour-auto",
    label_mode: args.labels,
    pdf: args.pdf,
    crs: geo.crsName,
    allow_numeric_codes: args.allowNumericCodes,
    ...gpt55Stats,
    georef_residual_m: Number(geo.maxResidualM.toFixed(3)),
    scale_m_per_pt: Number(geo.scaleMPerPt.toFixed(3)),
    n_label_codes: distinct.size,
    n_labels_in_frame: lab.nInsideFrame,
    n_served_features: served.features.length,
    label_spatial_km_from_cadastre: Number(spatialKm.toFixed(3)),
    lot_to_zone_pct: Number(lotToZonePct.toFixed(2)),
    compute_seconds: Number(elapsedS.toFixed(1)),
    ...stats,
  };

  const outDir = args.out ?? join(tmpdir(), `t1-${args.slug}`);
  mkdirSync(outDir, { recursive: true });
  const geojsonPath = join(outDir, `qc-zonage-${args.slug}.geojson`);
  const statsPath = join(outDir, `qc-zonage-${args.slug}.stats.json`);
  writeFileSync(geojsonPath, JSON.stringify(served));
  writeFileSync(statsPath, JSON.stringify(report, null, 2));
  console.error(`[t1-build] wrote ${geojsonPath} + stats`);

  if (args.dryRun) {
    console.error("[t1-build] --dry-run: NOT uploading to S3.");
  } else {
    const s3Key = `normalized/ca-qc-zonage/qc-zonage-${args.slug}.geojson`;
    await putBytes(s3, s3Key, JSON.stringify(served), "application/geo+json");
    await putBytes(
      s3,
      `normalized/ca-qc-zonage/qc-zonage-${args.slug}.stats.json`,
      JSON.stringify(report, null, 2),
      "application/json",
    );
    console.error(`[t1-build] uploaded s3://${BUCKET}/${s3Key}`);
  }

  // machine-readable summary on stdout
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
