/**
 * t2-build-multisheet.ts — T2 zoning for plans split across MULTIPLE sheets.
 *
 * A frequent rural case: an A0 zoning plan (Annexe B) is issued as 2–4
 * feuillets (e.g. Nominingue: feuillet 1 "territoire" + feuillet 2 "village"
 * 1:6000). Serving a single feuillet covers only its sub-territory (Nominingue
 * feuillet 2 alone = 28% of lots — unacceptable for the immo passthrough
 * contract), yet each feuillet is a perfectly good, independently
 * georeferenceable map.
 *
 * This builder is the multi-sheet sibling of `t2-build.ts`. It reuses the EXACT
 * committed pieces (auto-seed GCP derivation, GCP affine georef, label
 * extraction, cadastre nearest-label aggregation, `mergeByZoneCode` serving)
 * and adds ONE thing: it fuses N independently-georeferenced feuillets into a
 * single served collection.
 *
 *   for each feuillet:
 *     auto-seed real parcel-corner GCPs (t2-autogcp, residual ≤ gate + holdout)
 *       — OR load a pre-derived GcpFile —
 *     affine georef of THAT feuillet, re-checked ≤ max-residual (per-sheet gate)
 *     extract verbatim zone-code labels → georeferenced CodePoints
 *       (optionally filtered to the authoritative --dict, dropping lot numbers)
 *     per-sheet spatial gate (label centroid must sit on the cadastre)
 *   →  a feuillet that fails ANY of its own gates is EXCLUDED, never forced
 *      (better an honest partial coverage than one invented feuillet).
 *
 *   FUSE: the surviving feuillets' CodePoints are POOLED, then a SINGLE
 *   `buildZones` pass assigns every cadastral lot to its nearest label across
 *   ALL feuillets. This is the natural, correct dedup of border lots shared by
 *   two feuillets (nearest-label wins — a lot is assigned exactly once) and
 *   `mergeByZoneCode` unions a code that appears on two feuillets into one
 *   MultiPolygon. Geometry stays 100% real cadastre; codes stay verbatim PDF.
 *
 *   Global gates on the fused result (a failing gate WITHHOLDS the deposit,
 *   never fabricates): ≥ min-codes distinct lettered codes, no affectation/CMM
 *   tokens, fused label-centroid on the cadastre, cadastre coverage ≥
 *   min-cadastre-pct. Then deposit qc-zonage-<slug>.
 *
 * Usage:
 *   tsx src/t2-build-multisheet.ts --slug nominingue \
 *     --sheets sheet1.pdf,sheet2.gcp.json \
 *     [--labels text|gpt55] [--dict codes.json] \
 *     [--cadastre file.geojson] [--dry-run] [--out dir] \
 *     [--min-codes 3] [--max-residual-m 30] [--spatial-km 8] \
 *     [--cutoff-m 1500] [--min-cadastre-pct 50] \
 *     [--max-candidate-m 450] [--min-gcps 12] [--max-gcps 48] [--ocr-dpi 200]
 *
 * A `--sheets` entry ending in `.pdf` (or an http URL) is auto-seeded here; an
 * entry ending in `.json` is loaded as a `GcpFile` (its `pdf` must resolve).
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FeatureCollection } from "geojson";

import { extractLabels } from "./lib/t1-labels.js";
import { kindForPrefix, splitCode } from "./lib/t1-labels.js";
import { buildZones, type CodePoint } from "./lib/t1-zones.js";
import { deriveAutoSeedGcps } from "./lib/t2-autogcp.js";
import { assertIndependentGcps, buildGeoRefFromGcpsCrs, type GcpFile } from "./lib/t2-georef.js";
import { s3Client, getBytes, putBytes, BUCKET } from "./lib/s3.js";
import { haversineKm, bboxCenter, mergeByZoneCode } from "./lib/zone-serve.js";

interface Args {
  slug: string;
  sheets: string[];
  labels: "text" | "gpt55";
  dict?: string;
  cadastre?: string;
  dryRun: boolean;
  out?: string;
  minCodes: number;
  maxResidualM: number;
  spatialKm: number;
  cutoffM: number;
  minCadastrePct: number;
  maxCandidateM?: number;
  minGcps: number;
  maxGcps: number;
  ocrDpi: number;
  source: string;
  confidence: string;
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
  if (!a["slug"] || !a["sheets"]) {
    throw new Error("required: --slug <slug> --sheets <sheet1,sheet2,...> (each .pdf|url → auto-seed, or .json → GcpFile)");
  }
  const labels = String(a["labels"] ?? "text");
  if (labels !== "text" && labels !== "gpt55") throw new Error("--labels must be text|gpt55");
  const sheets = String(a["sheets"])
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (sheets.length < 1) throw new Error("--sheets needs at least one entry");
  return {
    slug: String(a["slug"]),
    sheets,
    labels,
    dict: a["dict"] ? String(a["dict"]) : undefined,
    cadastre: a["cadastre"] ? String(a["cadastre"]) : undefined,
    dryRun: Boolean(a["dry-run"]),
    out: a["out"] ? String(a["out"]) : undefined,
    minCodes: a["min-codes"] ? Number(a["min-codes"]) : 3,
    maxResidualM: a["max-residual-m"] ? Number(a["max-residual-m"]) : 30,
    spatialKm: a["spatial-km"] ? Number(a["spatial-km"]) : 8,
    cutoffM: a["cutoff-m"] ? Number(a["cutoff-m"]) : 1500,
    minCadastrePct: a["min-cadastre-pct"] ? Number(a["min-cadastre-pct"]) : 50,
    maxCandidateM: a["max-candidate-m"] ? Number(a["max-candidate-m"]) : undefined,
    minGcps: a["min-gcps"] ? Number(a["min-gcps"]) : 12,
    maxGcps: a["max-gcps"] ? Number(a["max-gcps"]) : 48,
    ocrDpi: a["ocr-dpi"] ? Number(a["ocr-dpi"]) : 200,
    source: a["source"] ? String(a["source"]) : "t2-multisheet-autogcp",
    confidence: a["confidence"] ? String(a["confidence"]) : "contour-autogcp-multisheet",
  };
}

async function resolvePdf(pdf: string): Promise<string> {
  if (!/^https?:/.test(pdf)) {
    if (!existsSync(pdf)) throw new Error(`pdf not found: ${pdf}`);
    return pdf;
  }
  const path = join(tmpdir(), `t2ms-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  execSync(`curl -sL -A "Mozilla/5.0" ${JSON.stringify(pdf)} -o ${JSON.stringify(path)}`);
  return path;
}

function pdfPageSize(pdfPath: string, page = 1): { pageW: number; pageH: number } {
  const info = execSync(`pdfinfo -f ${page} -l ${page} ${JSON.stringify(pdfPath)}`, { encoding: "utf8" });
  const escaped = String(page).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pm =
    info.match(new RegExp(`Page\\s+${escaped}\\s+size:\\s*([\\d.]+)\\s*x\\s*([\\d.]+)`)) ??
    info.match(/Page size:\s*([\d.]+)\s*x\s*([\d.]+)/);
  if (!pm) throw new Error("pdfinfo: could not read page size");
  return { pageW: Number(pm[1]), pageH: Number(pm[2]) };
}

function loadDict(path: string): string[] {
  const j = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const codes = Array.isArray(j) ? j : (j as { codes?: unknown }).codes;
  if (!Array.isArray(codes)) throw new Error("--dict must be a JSON array of codes or { codes: [...] }");
  return codes.map(String);
}

/** lowercase(normalized) → canonical dict spelling, for verbatim+authoritative filtering. */
function dictCanonicalMap(codes: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of codes) m.set(c.trim().replace(/\s+/g, "-").toLowerCase(), c.trim());
  return m;
}

interface SheetResult {
  entry: string;
  pdf: string;
  page: number;
  included: boolean;
  reason?: string;
  n_gcps?: number;
  gcp_residual_max_m?: number;
  gcp_residual_rms_m?: number;
  autoseed?: boolean;
  autoseed_holdout_max_m?: number | null;
  n_labels_in_frame?: number;
  n_codes_kept?: number;
  n_distinct_codes?: number;
  n_dropped_non_dict?: number;
  spatial_km_from_cadastre?: number;
  neatline_extent?: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const t0 = Date.now();
  console.error(
    `[t2-multisheet] slug=${args.slug} sheets=${args.sheets.length} labels=${args.labels}` +
      (args.dict ? ` dict=${args.dict}` : ""),
  );

  // 0. Cadastre (shared by every feuillet) -----------------------------------
  const s3 = s3Client();
  const cadKey = args.cadastre ?? `normalized/qc-cadastre-lots/${args.slug}.geojson`;
  let cadBuf: Buffer;
  if (args.cadastre && existsSync(args.cadastre)) cadBuf = readFileSync(args.cadastre);
  else cadBuf = await getBytes(s3, cadKey);
  const cadastre = JSON.parse(cadBuf.toString("utf8")) as FeatureCollection;
  const { center: cadCenter, bbox: cadBbox } = bboxCenter(cadastre);
  const lat0 = (cadBbox[1] + cadBbox[3]) / 2;
  console.error(
    `[t2-multisheet] cadastre: ${cadastre.features.length} lots, center ` +
      `${cadCenter[0].toFixed(4)},${cadCenter[1].toFixed(4)}`,
  );

  // dict (verbatim + authoritative label filter) ----------------------------
  let dictCanon: Map<string, string> | undefined;
  if (args.dict) {
    dictCanon = dictCanonicalMap(loadDict(args.dict));
    console.error(`[t2-multisheet] dictionary: ${dictCanon.size} authoritative codes`);
  }
  if (args.labels === "gpt55" && !dictCanon) {
    throw new Error("--labels gpt55 requires --dict <authoritative-zone-codes.json>");
  }

  // 1. Per-feuillet: georef + labels; each passes its OWN gates or is excluded.
  const sheetResults: SheetResult[] = [];
  const combined: CodePoint[] = [];
  let sheetIdx = 0;
  for (const entry of args.sheets) {
    sheetIdx++;
    const sr: SheetResult = { entry, pdf: entry, page: 1, included: false };
    try {
      const isPdf = /^https?:/.test(entry) || /\.pdf$/i.test(entry);
      let gcpFile: GcpFile;

      if (isPdf) {
        // --- auto-seed real parcel-corner GCPs for this feuillet ------------
        const pdfPath = await resolvePdf(entry);
        const size = pdfPageSize(pdfPath, 1);
        const seedReport = await deriveAutoSeedGcps({
          slug: args.slug,
          pdfPath,
          page: 1,
          pageW: size.pageW,
          pageH: size.pageH,
          cadastre,
          ...(args.maxCandidateM !== undefined ? { maxCandidateDistanceM: args.maxCandidateM } : {}),
          maxResidualM: args.maxResidualM,
          minGcps: args.minGcps,
          maxGcps: args.maxGcps,
        });
        sr.autoseed = true;
        sr.autoseed_holdout_max_m = seedReport.holdout_max_m;
        sr.neatline_extent = seedReport.best ? `${seedReport.best.extent}@${seedReport.best.rotation}` : undefined;
        if (!seedReport.pass || !seedReport.gcp_file) {
          sr.reason = `auto-seed failed its residual+holdout gate: ${seedReport.reason ?? "no seed cleared"}`;
          sheetResults.push(sr);
          console.error(`[t2-multisheet] feuillet #${sheetIdx} EXCLUDED — ${sr.reason}`);
          continue;
        }
        gcpFile = seedReport.gcp_file;
        gcpFile.pdf = pdfPath;
      } else {
        // --- pre-derived GcpFile -------------------------------------------
        gcpFile = JSON.parse(readFileSync(entry, "utf8")) as GcpFile;
        if (!gcpFile.pdf) throw new Error(`gcp file has no pdf: ${entry}`);
        gcpFile.pdf = await resolvePdf(gcpFile.pdf);
      }

      const pdfPath = gcpFile.pdf;
      const page = gcpFile.page ?? 1;
      sr.pdf = pdfPath;
      sr.page = page;
      const { pageW, pageH } =
        gcpFile.pageW && gcpFile.pageH ? { pageW: gcpFile.pageW, pageH: gcpFile.pageH } : pdfPageSize(pdfPath, page);

      // anti-invention: the feuillet must have INDEPENDENT (non-bbox) controls.
      const indep = assertIndependentGcps(gcpFile.gcps, pageW, pageH);
      sr.n_gcps = gcpFile.gcps.length;

      // affine georef of THIS feuillet, re-checked against the residual gate.
      const cal = buildGeoRefFromGcpsCrs(gcpFile.gcps, pageW, pageH, gcpFile.crs, gcpFile.neatline);
      sr.gcp_residual_max_m = Number(cal.maxResidualM.toFixed(2));
      sr.gcp_residual_rms_m = Number(cal.rmsResidualM.toFixed(2));
      if (cal.maxResidualM > args.maxResidualM) {
        sr.reason = `per-sheet calibration residual ${cal.maxResidualM.toFixed(1)}m > ${args.maxResidualM}m`;
        sheetResults.push(sr);
        console.error(`[t2-multisheet] feuillet #${sheetIdx} EXCLUDED — ${sr.reason}`);
        continue;
      }
      const geo = cal.geo;
      console.error(
        `[t2-multisheet] feuillet #${sheetIdx}: ${pdfPath.split("/").pop()} | ${indep.independentCount} independent GCPs, ` +
          `residual max ${cal.maxResidualM.toFixed(2)}m rms ${cal.rmsResidualM.toFixed(2)}m`,
      );

      // labels of THIS feuillet -------------------------------------------
      let codePoints: CodePoint[];
      let nInFrame = 0;
      if (args.labels === "gpt55") {
        const { extractLabelsGpt55 } = await import("./lib/t2-labels-gpt55.js");
        const neatlineRegion = gcpFile.neatline
          ? ([
              gcpFile.neatline.fx0 * pageW,
              gcpFile.neatline.fy0 * pageH,
              gcpFile.neatline.fx1 * pageW,
              gcpFile.neatline.fy1 * pageH,
            ] as [number, number, number, number])
          : undefined;
        const gptLab = await extractLabelsGpt55(pdfPath, geo, [...dictCanon!.values()], `${args.slug}-f${sheetIdx}`, {
          dpi: args.ocrDpi,
          page,
          region: neatlineRegion,
        });
        codePoints = gptLab.codePoints;
        nInFrame = gptLab.nInsideFrame;
      } else {
        const lab = extractLabels(pdfPath, geo, { page, excludeRegions: gcpFile.excludeRegions });
        codePoints = lab.codePoints;
        nInFrame = lab.nInsideFrame;
      }
      sr.n_labels_in_frame = nInFrame;

      // verbatim + authoritative dict filter (drops lot numbers / annotations)
      let dropped = 0;
      if (dictCanon && args.labels === "text") {
        const kept: CodePoint[] = [];
        for (const cp of codePoints) {
          const canon = dictCanon.get(cp.code.trim().replace(/\s+/g, "-").toLowerCase());
          if (!canon) {
            dropped++;
            continue;
          }
          const { prefix } = splitCode(canon);
          kept.push({ code: canon, prefix, kind: kindForPrefix(prefix), lon: cp.lon, lat: cp.lat });
        }
        codePoints = kept;
      }
      sr.n_dropped_non_dict = dropped;
      sr.n_codes_kept = codePoints.length;
      const distinctSheet = new Set(codePoints.map((c) => c.code));
      sr.n_distinct_codes = distinctSheet.size;

      if (codePoints.length === 0) {
        sr.reason = "no verbatim zone-code labels survived (after dict filter)";
        sheetResults.push(sr);
        console.error(`[t2-multisheet] feuillet #${sheetIdx} EXCLUDED — ${sr.reason}`);
        continue;
      }

      // per-sheet spatial gate: this feuillet's labels must sit on the cadastre.
      const c: [number, number] = codePoints.reduce(
        (acc, cp) => [acc[0] + cp.lon / codePoints.length, acc[1] + cp.lat / codePoints.length],
        [0, 0] as [number, number],
      );
      const km = haversineKm(c, cadCenter);
      sr.spatial_km_from_cadastre = Number(km.toFixed(2));
      if (km > args.spatialKm) {
        sr.reason = `feuillet label centroid ${km.toFixed(1)}km from cadastre (> ${args.spatialKm}km) — georef mismatch`;
        sheetResults.push(sr);
        console.error(`[t2-multisheet] feuillet #${sheetIdx} EXCLUDED — ${sr.reason}`);
        continue;
      }

      sr.included = true;
      sheetResults.push(sr);
      combined.push(...codePoints);
      console.error(
        `[t2-multisheet] feuillet #${sheetIdx} INCLUDED — ${codePoints.length} labels, ` +
          `${distinctSheet.size} distinct codes${dropped ? `, ${dropped} non-dict dropped` : ""}, ` +
          `${km.toFixed(2)}km from cadastre centroid`,
      );
    } catch (e) {
      sr.reason = `error: ${e instanceof Error ? e.message : String(e)}`;
      sheetResults.push(sr);
      console.error(`[t2-multisheet] feuillet #${sheetIdx} EXCLUDED — ${sr.reason}`);
    }
  }

  const included = sheetResults.filter((s) => s.included);
  console.error(`[t2-multisheet] ${included.length}/${args.sheets.length} feuillets passed their gates`);

  const outDir = args.out ?? join(tmpdir(), `t2ms-${args.slug}`);
  mkdirSync(outDir, { recursive: true });

  const withhold = (verdict: string): never => {
    const report = {
      slug: args.slug,
      verdict: "WITHHELD",
      reason: verdict,
      sheets: sheetResults,
      compute_seconds: Number(((Date.now() - t0) / 1000).toFixed(1)),
    };
    const p = join(outDir, `qc-zonage-${args.slug}.stats.json`);
    writeFileSync(p, JSON.stringify(report, null, 2));
    console.error(`\n[t2-multisheet] WITHHOLD (anti-invention): ${verdict}`);
    console.log(JSON.stringify(report, null, 2));
    process.exit(2);
  };

  if (included.length === 0) withhold("no feuillet cleared its per-sheet gates");

  // 2. FUSE — pool CodePoints, one nearest-label pass over the whole cadastre.
  const distinct = new Set(combined.map((c) => c.code));
  const minCodes = Math.max(3, args.minCodes);
  if (distinct.size < minCodes) withhold(`only ${distinct.size} distinct fused zone codes (< ${minCodes})`);
  const banned = /^(affectation|cmm|mrc|sad|pmad)/i;
  const nonLettered = [...distinct].filter((c) => !/[A-Za-z]/.test(c) || !/\d/.test(c));
  const bannedHit = [...distinct].filter((c) => banned.test(c));
  if (nonLettered.length > 0) withhold(`non-lettered (sequential?) fused codes: ${nonLettered.slice(0, 8).join(", ")}`);
  if (bannedHit.length > 0) withhold(`affectation/CMM tokens present: ${bannedHit.join(", ")}`);

  // fused spatial gate
  const fusedCentroid: [number, number] = combined.reduce(
    (acc, c) => [acc[0] + c.lon / combined.length, acc[1] + c.lat / combined.length],
    [0, 0] as [number, number],
  );
  const fusedKm = haversineKm(fusedCentroid, cadCenter);
  if (fusedKm > args.spatialKm) withhold(`fused label centroid ${fusedKm.toFixed(1)}km from cadastre (> ${args.spatialKm}km)`);

  const { featureCollection, stats } = buildZones(cadastre, combined, {
    lat0,
    cutoffM: args.cutoffM,
    source: args.source,
    confidence: args.confidence,
    dissolve: true,
  });
  const served = mergeByZoneCode(featureCollection);
  const lotPct = (100 * stats.n_lots_assigned) / stats.n_lots_total;
  console.error(
    `[t2-multisheet] FUSED: ${combined.length} pooled labels → ${stats.n_zone_features} code-point features → ` +
      `${served.features.length} distinct-code features | ${stats.n_lots_assigned}/${stats.n_lots_total} lots ` +
      `(${lotPct.toFixed(1)}% cadastre coverage)`,
  );

  const elapsedS = (Date.now() - t0) / 1000;
  const report = {
    slug: args.slug,
    verdict: lotPct >= args.minCadastrePct ? "DEPOSIT" : "WITHHELD",
    source: args.source,
    confidence: args.confidence,
    label_mode: args.labels,
    n_sheets_input: args.sheets.length,
    n_sheets_included: included.length,
    n_fused_labels: combined.length,
    n_distinct_codes_fused: distinct.size,
    n_served_features: served.features.length,
    fused_spatial_km_from_cadastre: Number(fusedKm.toFixed(3)),
    lot_to_zone_pct: Number(lotPct.toFixed(2)),
    min_cadastre_pct_gate: args.minCadastrePct,
    compute_seconds: Number(elapsedS.toFixed(1)),
    sheets: sheetResults,
    ...stats,
  };

  const geojsonPath = join(outDir, `qc-zonage-${args.slug}.geojson`);
  const statsPath = join(outDir, `qc-zonage-${args.slug}.stats.json`);
  writeFileSync(geojsonPath, JSON.stringify(served));
  writeFileSync(statsPath, JSON.stringify(report, null, 2));
  console.error(`[t2-multisheet] wrote ${geojsonPath} + stats`);

  if (lotPct < args.minCadastrePct) {
    console.error(
      `\n[t2-multisheet] WITHHOLD: fused cadastre coverage ${lotPct.toFixed(1)}% < ${args.minCadastrePct}% ` +
        `— honest partial coverage held back (add the missing feuillet[s]).`,
    );
    console.log(JSON.stringify(report, null, 2));
    process.exit(2);
  }

  if (args.dryRun) {
    console.error("[t2-multisheet] --dry-run: NOT uploading to S3.");
  } else {
    const s3Key = `normalized/ca-qc-zonage/qc-zonage-${args.slug}.geojson`;
    await putBytes(s3, s3Key, JSON.stringify(served), "application/geo+json");
    await putBytes(
      s3,
      `normalized/ca-qc-zonage/qc-zonage-${args.slug}.stats.json`,
      JSON.stringify(report, null, 2),
      "application/json",
    );
    console.error(`[t2-multisheet] uploaded s3://${BUCKET}/${s3Key}`);
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
