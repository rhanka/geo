/**
 * T1 MULTI-CADRES : pool les labels de TOUS les cadres géoréférencés d'UNE page.
 *
 * Motif (mesuré sur saint-alphonse-rodriguez, 2026-07-18). Un plan ArcGIS Pro peut
 * porter DEUX cadres géoréférencés sur la même page :
 *
 *   - la CARTE PRINCIPALE (1:20 000, tout le territoire) ;
 *   - un ENCART « périmètre d'urbanisation » (le noyau villageois, ~1:8 000), qui
 *     porte sa PROPRE registration `/VP` `/Measure`.
 *
 * `t1-build` ne retient que le cadre de plus grande aire-page — le bon défaut. Mais
 * l'encart est DESSINÉ PAR-DESSUS la carte principale : son rectangle page est INCLUS
 * dans la neatline principale, donc ses labels passent le test « dans le cadre » et
 * sont projetés par la transformation de la CARTE PRINCIPALE — à des positions
 * géographiques fausses. Et comme le noyau villageois est illisible au 1:20 000,
 * ArcGIS n'y place presque aucune étiquette : les zones du village ne sont étiquetées
 * QUE dans l'encart.
 *
 * Effet net sans ce script (mesuré) : les lots du village — les plus denses de la
 * muni — partent au voisin rural le plus proche, et le build affiche
 * « 100 % des lots assignés ». Le chiffre rassure ; le zonage est faux. C'est le
 * contrat VORONOÏ : un label non lu (ou mal placé) = des lots faux EN SILENCE.
 *
 * Ce que fait ce script :
 *   1. énumère les cadres géoréférencés, triés par aire-page décroissante ;
 *   2. pour CHAQUE cadre, extrait les labels sous SA PROPRE transformation ;
 *   3. OCCLUSION : sur un cadre, exclut les rectangles des cadres plus petits — ils
 *      sont dessinés par-dessus, leurs labels appartiennent à l'encart, pas à lui ;
 *   4. pool, puis applique les MÊMES gates anti-invention que `t1-build`.
 *
 * N'invente rien : chaque label est un mot verbatim du PDF, validé contre `--dict`,
 * projeté par la registration du cadre où il est IMPRIMÉ.
 *
 * Usage :
 *   npx tsx acquisition/src/t1-build-multiframe.ts --slug <slug> --pdf <plan.pdf> \
 *     --dict work/dict/<slug>.json [--page 1] [--dry-run] [--out <dir>]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { S3Client } from "@aws-sdk/client-s3";
import type { FeatureCollection } from "geojson";

import { capturedFetch, NODE_FETCH_DEFAULT_MAX_REDIRECTS, type CaptureRequestInit, type CaptureRun } from "../../packages/qc-sources/src/capture/index.js";
import { openCaptureRun } from "./lib/capture-s3.js";
import { extractGeoRef, type GeoRef } from "./lib/t1-georef.js";
import {
  extractLabels,
  filterExtractedLabelsByDict,
  type ExtractLabelsResult,
} from "./lib/t1-labels.js";
import { buildZones } from "./lib/t1-zones.js";
import { bboxCenter, haversineKm, mergeByZoneCode } from "./lib/zone-serve.js";
import { BUCKET, getBytes, putBytes, s3Client } from "./lib/s3.js";
import { attachGeometryProof, proofFromFetched, putServedZoneGeojson, type ServedZoneGeoJson } from "./lib/zonage-proof.js";

/** Deposit a new multi-frame T1 geometry only with the bytes of its real GeoPDF. */
export async function depositT1MultiframeServedZoneGeojson(
  s3: S3Client,
  key: string,
  served: ServedZoneGeoJson,
  pdfUrl: string,
  pdfBytes: Buffer,
  retrievedAt = new Date().toISOString(),
): Promise<void> {
  const proof = proofFromFetched({
    url: pdfUrl,
    type: "pdf-zonage",
    method: "georeference",
    reliability: "georeferencee",
    bytes: pdfBytes,
    retrievedAt,
  });
  attachGeometryProof(served, proof, { url: pdfUrl, level: "documented" });
  await putServedZoneGeojson(s3, key, served);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function fail(message: string): never {
  console.error(`\n[t1-multiframe] ABORT (anti-invention): ${message}`);
  process.exitCode = 2;
  throw new Error(message);
}

/** Rectangle page d'un cadre, en FRACTIONS de page, origine haut-gauche. */
function frameRegionFrac(geo: GeoRef): { fx0: number; fy0: number; fx1: number; fy1: number } {
  const [rx0, ry0, rx1, ry1] = geo.bbox;
  const bx0 = Math.min(rx0, rx1);
  const bx1 = Math.max(rx0, rx1);
  const by0 = Math.min(ry0, ry1);
  const by1 = Math.max(ry0, ry1);
  return {
    fx0: bx0 / geo.pageW,
    fx1: bx1 / geo.pageW,
    // bbox est en y-montant (user-space) ; excludeRegions attend du y-descendant.
    fy0: (geo.pageH - by1) / geo.pageH,
    fy1: (geo.pageH - by0) / geo.pageH,
  };
}

function frameArea(geo: GeoRef): number {
  const [x0, y0, x1, y1] = geo.bbox;
  return Math.abs((x1 - x0) * (y1 - y0));
}

async function main(): Promise<void> {
  const slug = arg("slug");
  const pdfInput = arg("pdf");
  const dictPath = arg("dict");
  const page = arg("page") ? Number(arg("page")) : undefined;
  const out = arg("out");
  const dryRun = process.argv.includes("--dry-run");
  const maxResidualM = arg("max-residual-m") ? Number(arg("max-residual-m")) : 50;
  const spatialKmMax = arg("spatial-km") ? Number(arg("spatial-km")) : 8;
  const cutoffM = arg("cutoff-m") ? Number(arg("cutoff-m")) : 1500;
  if (!slug || !pdfInput || !dictPath) fail("required: --slug <slug> --pdf <plan.pdf|url> --dict <codes.json>");
  const pdfUrl = /^https?:\/\//.test(pdfInput) ? pdfInput : undefined;
  const s3 = s3Client();
  if (pdfUrl) {
    CAPTURE = openCaptureRun({ lane: "zones", s3 });
  }
  let pdf = pdfInput;
  let pdfBytes: Buffer;
  let pdfRetrievedAt: string | undefined;
  if (pdfUrl) {
    if (!CAPTURE) fail("capture run absent");
    // Le type du chokepoint préserve seulement les en-têtes et corps qu'il sait
    // sérialiser honnêtement; ne pas élargir ceci en `RequestInit`.
    const init: CaptureRequestInit = {};
    const captured = await capturedFetch(pdfUrl, init, {
      run: CAPTURE,
      source: "zones-t1-multiframe",
      slugs: [slug],
      version: "t1-build-multiframe/1",
      // `fetch(pdfUrl)` historique n'avait ni timeout applicatif ni plafond de
      // redirections inférieur au défaut Node : conserver ce comportement.
      timeoutMs: null,
      maxRedirects: NODE_FETCH_DEFAULT_MAX_REDIRECTS,
    });
    if (!captured.ok || captured.bytes === null) {
      fail(`PDF fetch failed: ${pdfUrl} (${captured.line.http_status ?? captured.line.error ?? "sans réponse"})`);
    }
    pdfBytes = Buffer.from(captured.bytes);
    pdfRetrievedAt = captured.line.retrieved_at ?? undefined;
    pdf = join(tmpdir(), `t1-multiframe-${slug}-${Date.now()}.pdf`);
    writeFileSync(pdf, pdfBytes);
  } else {
    if (!existsSync(pdf)) fail(`PDF not found: ${pdf}`);
    pdfBytes = readFileSync(pdf);
  }
  if (!existsSync(dictPath)) fail(`dict not found: ${dictPath}`);

  const t0 = Date.now();
  const dictJson = JSON.parse(readFileSync(dictPath, "utf8")) as string[] | { codes?: string[] };
  const dict = Array.isArray(dictJson) ? dictJson : dictJson.codes;
  if (!dict || dict.length < 3) fail("dictionary has fewer than 3 codes");
  console.error(`[t1-multiframe] slug=${slug} pdf=${pdf} dict=${dict.length} codes`);

  // 1. Cadres géoréférencés --------------------------------------------------
  const frames: GeoRef[] = [];
  for (let i = 0; i < 8; i++) {
    const g = extractGeoRef(pdfBytes, pdf, { frame: i });
    if (!g) break;
    frames.push(g);
  }
  if (!frames.length) fail("no /VP /Measure /GEO georeferencing found — not a T1 GeoPDF");
  if (frames.length === 1) {
    fail(
      "a single georeferenced frame — rien à pooler : utiliser t1-build (ce script " +
        "n'a de sens que sur un plan à encart géoréférencé ; cf. _geopdf-viewports.ts)",
    );
  }
  frames.forEach((g, i) => {
    console.error(
      `[t1-multiframe] cadre[${i}] ${g.crsName} | résidu ${g.maxResidualM.toFixed(2)} m | ` +
        `échelle ${g.scaleMPerPt.toFixed(3)} m/pt | aire ${Math.round(frameArea(g))} pt²`,
    );
    if (g.maxResidualM > maxResidualM) {
      fail(`cadre[${i}] résidu ${g.maxResidualM.toFixed(1)} m > ${maxResidualM} m`);
    }
  });

  // 2. Labels par cadre, avec occlusion des cadres plus petits ----------------
  const pooled: ExtractLabelsResult["codePoints"] = [];
  const perFrame: Array<Record<string, unknown>> = [];
  for (let i = 0; i < frames.length; i++) {
    const geo = frames[i]!;
    // Les cadres SUIVANTS sont plus petits (tri par aire décroissante) et dessinés
    // par-dessus celui-ci : leurs labels ne lui appartiennent pas.
    const excludeRegions = frames.slice(i + 1).map(frameRegionFrac);
    const raw = extractLabels(pdf, geo, {
      ...(page ? { page } : {}),
      ...(excludeRegions.length ? { excludeRegions } : {}),
    });
    const kept = filterExtractedLabelsByDict(raw, dict);
    pooled.push(...kept.codePoints);
    const distinctHere = new Set(kept.codePoints.map((c) => c.code));
    perFrame.push({
      frame: i,
      crs: geo.crsName,
      residual_m: Number(geo.maxResidualM.toFixed(3)),
      occluded_by: excludeRegions.length,
      labels_kept: kept.codePoints.length,
      distinct_codes: distinctHere.size,
      dict_rejected: kept.dictRejected,
    });
    console.error(
      `[t1-multiframe] cadre[${i}] labels: ${kept.codePoints.length} retenus, ` +
        `${distinctHere.size} codes distincts, ${kept.dictRejected} hors-dict, ` +
        `${excludeRegions.length} encart(s) occulté(s)`,
    );
  }

  const distinct = new Set(pooled.map((c) => c.code));
  console.error(`[t1-multiframe] pool: ${pooled.length} labels, ${distinct.size} codes distincts`);
  if (distinct.size < 3) fail(`only ${distinct.size} distinct dict-validated codes`);

  // 3. Gates anti-invention (mêmes que t1-build) ------------------------------
  const banned = /^(affectation|cmm|mrc|sad|pmad)/i;
  const bannedHit = [...distinct].filter((c) => banned.test(c));
  if (bannedHit.length) fail(`affectation/CMM tokens present: ${bannedHit.join(", ")}`);
  const nonLettered = [...distinct].filter((c) => !/[A-Za-z]/.test(c) || !/\d/.test(c));
  if (nonLettered.length) fail(`non-lettered (sequential?) codes present: ${nonLettered.slice(0, 8).join(", ")}`);

  // 4. Cadastre + gate spatial ------------------------------------------------
  const cadBuf = await getBytes(s3, `normalized/qc-cadastre-lots/${slug}.geojson`);
  const cadastre = JSON.parse(cadBuf.toString("utf8")) as FeatureCollection;
  const { center: cadCenter, bbox: cadBbox } = bboxCenter(cadastre);
  const lat0 = (cadBbox[1] + cadBbox[3]) / 2;
  console.error(`[t1-multiframe] cadastre: ${cadastre.features.length} lots`);

  const labCenter: [number, number] = pooled.reduce(
    (acc, c) => [acc[0] + c.lon / pooled.length, acc[1] + c.lat / pooled.length],
    [0, 0] as [number, number],
  );
  const spatialKm = haversineKm(labCenter, cadCenter);
  console.error(`[t1-multiframe] spatial: label-centroid vs cadastre-centroid = ${spatialKm.toFixed(2)} km`);
  if (spatialKm > spatialKmMax) fail(`labels ${spatialKm.toFixed(1)} km from cadastre — georef mismatch`);

  // 5. Zones ------------------------------------------------------------------
  const { featureCollection, stats } = buildZones(cadastre, pooled, {
    lat0,
    cutoffM,
    source: "geopdf-esri-multiframe",
    confidence: "contour-auto",
    dissolve: true,
  });
  const served = mergeByZoneCode(featureCollection);
  const lotPct = (100 * stats.n_lots_assigned) / stats.n_lots_total;
  console.error(
    `[t1-multiframe] zones: ${stats.n_zone_features} code-point features -> ` +
      `${served.features.length} distinct-code features, ${stats.n_lots_assigned}/` +
      `${stats.n_lots_total} lots (${lotPct.toFixed(1)}%), ${stats.n_empty_labels} empty labels`,
  );

  const report = {
    slug,
    source: "geopdf-esri-multiframe",
    confidence: "contour-auto",
    label_mode: "text",
    pdf: pdfUrl ?? pdf,
    n_frames: frames.length,
    frames: perFrame,
    crs: frames[0]!.crsName,
    georef_residual_m: Number(frames[0]!.maxResidualM.toFixed(3)),
    n_label_codes: distinct.size,
    n_served_features: served.features.length,
    label_spatial_km_from_cadastre: Number(spatialKm.toFixed(3)),
    lot_to_zone_pct: Number(lotPct.toFixed(2)),
    compute_seconds: Number(((Date.now() - t0) / 1000).toFixed(1)),
    ...stats,
  };

  const outDir = out ?? join(tmpdir(), `t1mf-${slug}`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `qc-zonage-${slug}.geojson`), JSON.stringify(served));
  writeFileSync(join(outDir, `qc-zonage-${slug}.stats.json`), JSON.stringify(report, null, 2));
  console.error(`[t1-multiframe] wrote ${outDir}/qc-zonage-${slug}.geojson + stats`);

  if (dryRun) {
    console.error("[t1-multiframe] --dry-run: NOT uploading to S3.");
  } else {
    if (!pdfUrl || !pdfRetrievedAt) {
      fail(
        "served deposit requires a real HTTP(S) GeoPDF acquisition URL, its retrieval timestamp, and the received bytes for sha256 proof v2; " +
          "a local --pdf path has no capture URL/retrieved_at, so it may only be used with --dry-run",
      );
    }
    const key = `normalized/ca-qc-zonage/qc-zonage-${slug}.geojson`;
    await depositT1MultiframeServedZoneGeojson(
      s3,
      key,
      served as unknown as ServedZoneGeoJson,
      pdfUrl,
      pdfBytes,
      pdfRetrievedAt,
    );
    await putBytes(
      s3,
      `normalized/ca-qc-zonage/qc-zonage-${slug}.stats.json`,
      JSON.stringify(report, null, 2),
      "application/json",
    );
    console.error(`[t1-multiframe] uploaded s3://${BUCKET}/${key}`);
  }
  console.log(JSON.stringify(report, null, 2));
}

let CAPTURE: CaptureRun | null = null;

async function closeCapture(exitCode: number): Promise<void> {
  if (!CAPTURE) return;
  try { await CAPTURE.finish(exitCode); }
  catch (error) { console.error(`[t1-multiframe] WARN clôture capture: ${error instanceof Error ? error.message : String(error)}`); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then(async () => { await closeCapture(typeof process.exitCode === "number" ? process.exitCode : 0); })
    .catch(async (error: unknown) => {
      console.error(error instanceof Error ? error.stack ?? error.message : String(error));
      await closeCapture(typeof process.exitCode === "number" ? process.exitCode : 1);
      if (process.exitCode === undefined) process.exitCode = 1;
    });
}
