/**
 * t2-build-multisheet-claude.ts — T2 (GCP-georef, NO embedded georef) zoning
 * fused across MULTIPLE feuillets, each read via the Claude-vision GLYPH lane.
 *
 * WHY: many rural municipal zoning plans ship as 2–N feuillets — a whole-territory
 * "ensemble" sheet (rural A/F zones legible) + a zoomed "village" sheet (dense
 * R/C/I/P codes only legible there) + optional riverside detail sheets (e.g.
 * lyster 2023 "plan de zonage 1/2/3 de 3", 1:23000 ensemble + 1:6000 village).
 * Each feuillet is a raster plan that DRAWS the cadastre → it was independently
 * georeferenced by the chamfer→raster-register lane (work/gcp/<slug>-fN-t3.gcp.json,
 * `independent:true` GCPs). But the zone codes are GLYPHS (pdftotext = 0 codes),
 * so neither the text lane nor a live GPT quota can read them — the operating
 * agent (Claude 4.8 vision) reads each feuillet's positioned codes into a reads
 * file (via zones-tile-render → zones-reads-merge-tiles).
 *
 * Serving ONE feuillet alone MISLABELS the others' lots (rural sheet → village
 * lots snap to the nearest agricultural label; village sheet → farm lots snap to
 * a far village label — cf. project memory "zones-servies-sont-un-voronoi:
 * partiel PIRE que rien"). This runner is the GCP-georef + Claude counterpart of
 * `t1-build-multisheet-claude.ts` (which needs EMBEDDED georef) and the
 * Claude-reads counterpart of `t2-build-multisheet.ts` (which only reads text /
 * live-GPT labels).
 *
 * It reuses the EXACT committed pieces (buildGeoRefFromGcpsCrs GCP affine georef,
 * assertIndependentGcps anti-bbox gate, extractLabelsClaude dict-validated vision
 * reads, buildZones cadastre nearest-label aggregation, mergeByZoneCode serving)
 * and adds ONE thing: it POOLS the georeferenced CodePoints of every feuillet,
 * then runs a SINGLE buildZones pass so each cadastral lot is assigned to its
 * nearest label ACROSS ALL feuillets. That is the correct fusion: a village lot's
 * nearest label is a village-sheet code (correct), a farm lot's nearest is a
 * rural-sheet code (correct); mergeByZoneCode unions a code on two feuillets.
 *
 * Anti-invention (identical guards to t2-build/t2-build-multisheet): per-sheet
 * INDEPENDENT (non-bbox) GCPs + calibration residual ≤ threshold; each read
 * validated verbatim+unambiguous against the by-law --dict (dropped otherwise);
 * ≥ min-codes distinct lettered codes; no affectation/CMM tokens; per-sheet AND
 * fused label-centroid on the cadastre; fused cadastre coverage ≥ min-cadastre-pct.
 * A failing per-sheet gate EXCLUDES that feuillet (never forced); a failing global
 * gate WITHHOLDS the deposit (never fabricates, never uploads).
 *
 * Usage:
 *   tsx src/t2-build-multisheet-claude.ts --slug lyster \
 *     --dict work/zonage-dicts/lyster.codes.json \
 *     --sheets "work/gcp/lyster-f1-t3.gcp.json|work/reads/lyster-f1.reads.json;work/gcp/lyster-f2-t3.gcp.json|work/reads/lyster-f2.reads.json" \
 *     [--dry-run] [--out dir] [--cadastre file.geojson] \
 *     [--cutoff-m 1500] [--min-codes 10] [--max-residual-m 30] [--spatial-km 8] \
 *     [--min-cadastre-pct 50]
 *
 * Each --sheets entry is "gcp|reads[|page]" (';'-separated). The gcp file is a
 * `GcpFile` (lib/t2-georef.ts) whose `pdf` must resolve (local path). The reads
 * file is the agent's `{labels:[{code,x,y}]}` normalized 0..1 over the feuillet's
 * NEATLINE region (the same region this builder places them through).
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FeatureCollection } from "geojson";

import { loadClaudeReads, extractLabelsClaude } from "./lib/t1-labels-claude.js";
import { buildZones, type CodePoint } from "./lib/t1-zones.js";
import { assertIndependentGcps, buildGeoRefFromGcpsCrs, type GcpFile } from "./lib/t2-georef.js";
import { s3Client, getBytes, putBytes, BUCKET } from "./lib/s3.js";
import { haversineKm, bboxCenter, mergeByZoneCode } from "./lib/zone-serve.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function withhold(msg: string): never {
  console.error(`\n[t2-multisheet-claude] WITHHOLD (anti-invention): ${msg}`);
  process.exit(2);
}

interface SheetSpec {
  gcp: string;
  reads: string;
  page?: number;
}

function parseSheets(spec: string): SheetSpec[] {
  return spec
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const parts = s.split("|").map((p) => p.trim());
      if (parts.length < 2 || !parts[0] || !parts[1]) {
        withhold(`bad --sheets entry "${s}" (expected "gcp|reads[|page]")`);
      }
      return { gcp: parts[0]!, reads: parts[1]!, page: parts[2] ? Number(parts[2]) : undefined };
    });
}

function loadDict(path: string): string[] {
  const j = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const codes = Array.isArray(j) ? j : (j as { codes?: unknown }).codes;
  if (!Array.isArray(codes)) throw new Error("--dict must be a JSON array or { codes: [...] }");
  return codes.map(String);
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

interface SheetResult {
  gcp: string;
  reads: string;
  included: boolean;
  reason?: string;
  n_gcps?: number;
  independent?: number;
  residual_max_m?: number;
  n_reads?: number;
  n_validated?: number;
  n_rejected?: number;
  n_distinct?: number;
  spatial_km_from_cadastre?: number;
}

async function main(): Promise<void> {
  const slug = arg("slug");
  const dictPath = arg("dict");
  const sheetsSpec = arg("sheets");
  if (!slug || !dictPath || !sheetsSpec) {
    withhold('required: --slug <slug> --dict <codes.json> --sheets "gcp|reads;gcp|reads"');
  }
  const dryRun = flag("dry-run");
  const cutoffM = arg("cutoff-m") ? Number(arg("cutoff-m")) : 1500;
  const minCodes = Math.max(3, arg("min-codes") ? Number(arg("min-codes")) : 10);
  const maxResidualM = arg("max-residual-m") ? Number(arg("max-residual-m")) : 30;
  const spatialKm = arg("spatial-km") ? Number(arg("spatial-km")) : 8;
  const minCadastrePct = arg("min-cadastre-pct") ? Number(arg("min-cadastre-pct")) : 50;
  const cadastreArg = arg("cadastre");

  const t0 = Date.now();
  const dict = loadDict(dictPath!);
  const sheets = parseSheets(sheetsSpec!);
  console.error(`[t2-multisheet-claude] slug=${slug} sheets=${sheets.length} dict=${dict.length} codes`);

  // 0. Cadastre (shared by every feuillet) -----------------------------------
  const s3 = s3Client();
  const cadKey = cadastreArg ?? `normalized/qc-cadastre-lots/${slug}.geojson`;
  let cadBuf: Buffer;
  if (cadastreArg && existsSync(cadastreArg)) cadBuf = readFileSync(cadastreArg);
  else cadBuf = await getBytes(s3, cadKey);
  const cadastre = JSON.parse(cadBuf.toString("utf8")) as FeatureCollection;
  const { center: cadCenter, bbox: cadBbox } = bboxCenter(cadastre);
  const lat0 = (cadBbox[1] + cadBbox[3]) / 2;
  console.error(
    `[t2-multisheet-claude] cadastre: ${cadastre.features.length} lots, center ` +
      `${cadCenter[0].toFixed(4)},${cadCenter[1].toFixed(4)}`,
  );

  // 1. Per-feuillet: GCP georef + dict-validated Claude reads → pooled CodePoints.
  const pooled: CodePoint[] = [];
  const perSheet: SheetResult[] = [];
  let crsName = "";
  for (const sh of sheets) {
    const sr: SheetResult = { gcp: sh.gcp, reads: sh.reads, included: false };
    try {
      if (!existsSync(sh.gcp)) throw new Error(`gcp not found: ${sh.gcp}`);
      if (!existsSync(sh.reads)) throw new Error(`reads not found: ${sh.reads}`);
      const gcpFile = JSON.parse(readFileSync(sh.gcp, "utf8")) as GcpFile;
      if (!gcpFile.pdf) throw new Error(`gcp file has no pdf: ${sh.gcp}`);
      if (!existsSync(gcpFile.pdf)) throw new Error(`sheet pdf not found (fetch first): ${gcpFile.pdf}`);
      const page = sh.page ?? gcpFile.page ?? 1;
      const { pageW, pageH } =
        gcpFile.pageW && gcpFile.pageH ? { pageW: gcpFile.pageW, pageH: gcpFile.pageH } : pdfPageSize(gcpFile.pdf, page);

      // anti-invention: the feuillet must have INDEPENDENT (non-bbox) controls.
      const indep = assertIndependentGcps(gcpFile.gcps, pageW, pageH);
      sr.n_gcps = gcpFile.gcps.length;
      sr.independent = indep.independentCount;

      // affine georef of THIS feuillet, re-checked against the residual gate.
      const cal = buildGeoRefFromGcpsCrs(gcpFile.gcps, pageW, pageH, gcpFile.crs, gcpFile.neatline);
      sr.residual_max_m = Number(cal.maxResidualM.toFixed(2));
      if (cal.maxResidualM > maxResidualM) {
        sr.reason = `per-sheet calibration residual ${cal.maxResidualM.toFixed(1)}m > ${maxResidualM}m`;
        perSheet.push(sr);
        console.error(`[t2-multisheet-claude] feuillet ${sh.gcp} EXCLUDED — ${sr.reason}`);
        continue;
      }
      const geo = cal.geo;
      crsName = crsName || geo.crsName;

      // region = the feuillet's NEATLINE in page points (the reads are normalized
      // 0..1 over THIS region); full page if the gcp file carries no neatline.
      const region: [number, number, number, number] = gcpFile.neatline
        ? [
            gcpFile.neatline.fx0 * pageW,
            gcpFile.neatline.fy0 * pageH,
            gcpFile.neatline.fx1 * pageW,
            gcpFile.neatline.fy1 * pageH,
          ]
        : [0, 0, pageW, pageH];

      const reads = loadClaudeReads(sh.reads);
      const lab = extractLabelsClaude(reads, geo, dict, { region });
      sr.n_reads = reads.length;
      sr.n_validated = lab.n_validated;
      sr.n_rejected = lab.n_rejected;
      sr.n_distinct = lab.n_distinct;
      console.error(
        `[t2-multisheet-claude] ${sh.gcp}: ${indep.independentCount} indep GCPs, residual ${cal.maxResidualM.toFixed(2)}m | ` +
          `${reads.length} reads → ${lab.n_validated} validated (${lab.n_rejected} rejected), ${lab.codePoints.length} code-points`,
      );
      if (lab.reject_samples.length) console.error(`  rejects: ${lab.reject_samples.join(" | ")}`);

      if (lab.codePoints.length === 0) {
        sr.reason = "no verbatim zone-code labels survived the dict filter";
        perSheet.push(sr);
        console.error(`[t2-multisheet-claude] feuillet ${sh.gcp} EXCLUDED — ${sr.reason}`);
        continue;
      }

      // per-sheet spatial gate: this feuillet's labels must sit on the cadastre.
      const c: [number, number] = lab.codePoints.reduce(
        (acc, cp) => [acc[0] + cp.lon / lab.codePoints.length, acc[1] + cp.lat / lab.codePoints.length],
        [0, 0] as [number, number],
      );
      const km = haversineKm(c, cadCenter);
      sr.spatial_km_from_cadastre = Number(km.toFixed(2));
      if (km > spatialKm) {
        sr.reason = `feuillet label centroid ${km.toFixed(1)}km from cadastre (> ${spatialKm}km) — georef mismatch`;
        perSheet.push(sr);
        console.error(`[t2-multisheet-claude] feuillet ${sh.gcp} EXCLUDED — ${sr.reason}`);
        continue;
      }

      sr.included = true;
      perSheet.push(sr);
      for (const cp of lab.codePoints) pooled.push(cp);
      console.error(
        `[t2-multisheet-claude] feuillet ${sh.gcp} INCLUDED — ${lab.codePoints.length} labels, ` +
          `${lab.n_distinct} distinct codes, ${km.toFixed(2)}km from cadastre centroid`,
      );
    } catch (e) {
      sr.reason = `error: ${e instanceof Error ? e.message : String(e)}`;
      perSheet.push(sr);
      console.error(`[t2-multisheet-claude] feuillet ${sh.gcp} EXCLUDED — ${sr.reason}`);
    }
  }

  const included = perSheet.filter((s) => s.included);
  console.error(`[t2-multisheet-claude] ${included.length}/${sheets.length} feuillets passed their gates`);
  if (included.length === 0) withhold("no feuillet cleared its per-sheet gates");

  // 2. FUSE — pool CodePoints, one nearest-label pass over the whole cadastre.
  const distinct = new Set(pooled.map((c) => c.code));
  if (distinct.size < minCodes) withhold(`only ${distinct.size} distinct fused zone codes (< ${minCodes})`);
  const banned = /^(affectation|cmm|mrc|sad|pmad)/i;
  const isLetteredZone = (c: string) => /[A-Za-z]/.test(c) && /\d/.test(c);
  const bannedHit = [...distinct].filter((c) => banned.test(c) && !isLetteredZone(c));
  if (bannedHit.length > 0) withhold(`affectation/CMM tokens present: ${bannedHit.join(", ")}`);
  const nonLettered = [...distinct].filter((c) => !/[A-Za-z]/.test(c) || !/\d/.test(c));
  if (nonLettered.length > 0) withhold(`non-lettered (sequential?) fused codes: ${nonLettered.slice(0, 8).join(", ")}`);

  // fused spatial gate
  const fusedCentroid: [number, number] = pooled.reduce(
    (acc, c) => [acc[0] + c.lon / pooled.length, acc[1] + c.lat / pooled.length],
    [0, 0] as [number, number],
  );
  const fusedKm = haversineKm(fusedCentroid, cadCenter);
  if (fusedKm > spatialKm) withhold(`fused label centroid ${fusedKm.toFixed(1)}km from cadastre (> ${spatialKm}km)`);

  const source = "t2-gcp-claude48-vision-multisheet";
  const { featureCollection, stats } = buildZones(cadastre, pooled, {
    lat0,
    cutoffM,
    source,
    confidence: "contour-autogcp-multisheet",
    dissolve: true,
  });
  const served = mergeByZoneCode(featureCollection);
  const lotPct = (100 * stats.n_lots_assigned) / stats.n_lots_total;
  console.error(
    `[t2-multisheet-claude] FUSED: ${pooled.length} pooled labels → ${served.features.length} distinct-code features | ` +
      `${stats.n_lots_assigned}/${stats.n_lots_total} lots (${lotPct.toFixed(1)}% cadastre coverage)`,
  );

  const report = {
    slug,
    verdict: lotPct >= minCadastrePct ? "DEPOSIT" : "WITHHELD",
    source,
    confidence: "contour-autogcp-multisheet",
    label_mode: "claude-multisheet",
    crs: crsName,
    n_sheets_input: sheets.length,
    n_sheets_included: included.length,
    n_pooled_labels: pooled.length,
    n_distinct_codes_fused: distinct.size,
    distinct_codes: [...distinct].sort((a, b) => a.localeCompare(b, "en", { numeric: true })),
    n_served_features: served.features.length,
    fused_spatial_km_from_cadastre: Number(fusedKm.toFixed(3)),
    lot_to_zone_pct: Number(lotPct.toFixed(2)),
    min_cadastre_pct_gate: minCadastrePct,
    compute_seconds: Number(((Date.now() - t0) / 1000).toFixed(1)),
    sheets: perSheet,
    ...stats,
  };

  const outDir = arg("out") ?? join(tmpdir(), `t2msc-${slug}`);
  mkdirSync(outDir, { recursive: true });
  const geojsonPath = join(outDir, `qc-zonage-${slug}.geojson`);
  const statsPath = join(outDir, `qc-zonage-${slug}.stats.json`);
  writeFileSync(geojsonPath, JSON.stringify(served));
  writeFileSync(statsPath, JSON.stringify(report, null, 2));
  console.error(`[t2-multisheet-claude] wrote ${geojsonPath} + stats`);

  if (lotPct < minCadastrePct) {
    console.error(
      `\n[t2-multisheet-claude] WITHHOLD: fused cadastre coverage ${lotPct.toFixed(1)}% < ${minCadastrePct}% ` +
        `— honest partial coverage held back (add the missing feuillet[s]).`,
    );
    console.log(JSON.stringify(report, null, 2));
    process.exit(2);
  }

  if (dryRun) {
    console.error("[t2-multisheet-claude] --dry-run: NOT uploading to S3.");
  } else {
    const s3Key = `normalized/ca-qc-zonage/qc-zonage-${slug}.geojson`;
    await putBytes(s3, s3Key, JSON.stringify(served), "application/geo+json");
    await putBytes(s3, `normalized/ca-qc-zonage/qc-zonage-${slug}.stats.json`, JSON.stringify(report, null, 2), "application/json");
    console.error(`[t2-multisheet-claude] uploaded s3://${BUCKET}/${s3Key}`);
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
