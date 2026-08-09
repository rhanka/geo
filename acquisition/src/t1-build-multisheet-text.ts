/** Pool dict-validated text labels from several pages of one embedded-georef PDF. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { S3Client } from "@aws-sdk/client-s3";
import type { FeatureCollection } from "geojson";

import { capturedFetch, NODE_FETCH_DEFAULT_MAX_REDIRECTS, type CaptureRequestInit, type CaptureRun } from "../../packages/qc-sources/src/capture/index.js";
import { openCaptureRun } from "./lib/capture-s3.js";
import { extractGeoRef } from "./lib/t1-georef.js";
import { extractLabels, filterExtractedLabelsByDict } from "./lib/t1-labels.js";
import { buildZones } from "./lib/t1-zones.js";
import { bboxCenter, haversineKm, mergeByZoneCode } from "./lib/zone-serve.js";
import { BUCKET, getBytes, putBytes, s3Client } from "./lib/s3.js";
import { attachGeometryProof, proofFromFetched, putServedZoneGeojson, type ServedZoneGeoJson } from "./lib/zonage-proof.js";

/** Deposit a new multi-page T1 geometry only with the bytes of its real GeoPDF. */
export async function depositT1MultisheetTextServedZoneGeojson(
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
  console.error(`[t1-multisheet-text] ABORT (anti-invention): ${message}`);
  process.exitCode = 2;
  throw new Error(message);
}

async function main(): Promise<void> {
  const slug = arg("slug");
  const pdfInput = arg("pdf");
  const dictPath = arg("dict");
  const pages = (arg("pages") ?? "1").split(",").map(Number).filter(Number.isFinite);
  const out = arg("out") ?? `work/zones-recalage/${slug}-t1-multisheet-text`;
  const dryRun = process.argv.includes("--dry-run");
  if (!slug || !pdfInput || !dictPath || pages.length === 0) fail("required: --slug --pdf <plan.pdf|url> --dict --pages 1,2");
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
      source: "zones-t1-multisheet-text",
      slugs: [slug],
      version: "t1-build-multisheet-text/1",
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
    pdf = join(tmpdir(), `t1-multisheet-text-${slug}-${Date.now()}.pdf`);
    writeFileSync(pdf, pdfBytes);
  } else {
    if (!existsSync(pdf)) fail("PDF not found");
    pdfBytes = readFileSync(pdf);
  }
  if (!existsSync(dictPath)) fail("dictionary not found");
  const dictJson = JSON.parse(readFileSync(dictPath, "utf8")) as string[] | { codes?: string[] };
  const dict = Array.isArray(dictJson) ? dictJson : dictJson.codes;
  if (!dict || dict.length < 3) fail("dictionary has fewer than 3 codes");

  // Same opt-in as t1-build: an ArcGIS data frame ROTATED on the sheet has a /VP
  // /BBox larger than the /MediaBox by construction (lib/t1-georef
  // isPageAnchoredFrame). Default OFF — the strict containment gate is unchanged.
  const allowOverflowFrame = process.argv.includes("--allow-overflow-frame");
  const geo = extractGeoRef(pdfBytes, pdf, {
    ...(allowOverflowFrame ? { allowOverflowFrame: true } : {}),
  });
  if (!geo) fail("no embedded /VP /Measure /GEO georeferencing");
  if (geo.maxResidualM > 50) fail(`georef residual ${geo.maxResidualM.toFixed(1)}m > 50m`);

  const pooled = [] as ReturnType<typeof extractLabels>["codePoints"];
  const perPage: Array<Record<string, unknown>> = [];
  for (const page of pages) {
    const raw = extractLabels(pdf, geo, { page });
    const filtered = filterExtractedLabelsByDict(raw, dict);
    pooled.push(...filtered.codePoints);
    perPage.push({ page, raw: raw.codePoints.length, kept: filtered.codePoints.length, rejected: filtered.dictRejected });
  }
  const distinct = new Set(pooled.map((point) => point.code));
  if (distinct.size < 3) fail(`only ${distinct.size} distinct dict-validated codes`);
  const banned = [...distinct].filter((code) => /^(affectation|cmm|mrc|sad|pmad)/i.test(code));
  if (banned.length) fail(`affectation tokens: ${banned.join(",")}`);
  const nonLettered = [...distinct].filter((code) => !/[A-Za-z]/.test(code) || !/\d/.test(code));
  if (nonLettered.length) fail(`non-lettered codes: ${nonLettered.join(",")}`);

  const cadastre = JSON.parse(
    (await getBytes(s3, `normalized/qc-cadastre-lots/${slug}.geojson`)).toString("utf8"),
  ) as FeatureCollection;
  const { center, bbox } = bboxCenter(cadastre);
  const labelCenter = pooled.reduce<[number, number]>(
    (acc, point) => [acc[0] + point.lon / pooled.length, acc[1] + point.lat / pooled.length],
    [0, 0],
  );
  const spatialKm = haversineKm(labelCenter, center);
  if (spatialKm > 8) fail(`labels ${spatialKm.toFixed(1)}km from cadastre`);

  const { featureCollection, stats } = buildZones(cadastre, pooled, {
    lat0: (bbox[1] + bbox[3]) / 2,
    cutoffM: 1500,
    source: "geopdf-esri-multisheet-text-dict",
    confidence: "contour-auto",
    dissolve: true,
  });
  const served = mergeByZoneCode(featureCollection);
  const lotPct = 100 * stats.n_lots_assigned / stats.n_lots_total;
  const minLotPct = arg("min-lot-pct") ? Number(arg("min-lot-pct")) : 70;
  console.error(
    `[t1-multisheet-text] pooled: ${pooled.length} labels / ${distinct.size} codes -> ` +
      `${served.features.length} features, ${stats.n_lots_assigned}/${stats.n_lots_total} lots (${lotPct.toFixed(2)}%)`,
  );
  if (lotPct < minLotPct) fail(`lot assignment ${lotPct.toFixed(2)}% < ${minLotPct}%`);
  const report = {
    slug,
    source: "geopdf-esri-multisheet-text-dict",
    pdf: pdfUrl ?? pdf,
    pages: perPage,
    georef_residual_m: Number(geo.maxResidualM.toFixed(3)),
    dict_codes: dict.length,
    // `n_code_points` / `n_distinct_codes` viennent de `stats` (buildZones les calcule sur
    // le MÊME tableau `pooled`) : les redéclarer ici les faisait écraser par le spread.
    n_served_features: served.features.length,
    label_spatial_km_from_cadastre: Number(spatialKm.toFixed(3)),
    lot_to_zone_pct: Number(lotPct.toFixed(2)),
    ...stats,
  };
  mkdirSync(out, { recursive: true });
  const geojson = join(out, `qc-zonage-${slug}.geojson`);
  const statsPath = join(out, `qc-zonage-${slug}.stats.json`);
  writeFileSync(geojson, JSON.stringify(served));
  writeFileSync(statsPath, JSON.stringify(report, null, 2));
  if (!dryRun) {
    if (!pdfUrl || !pdfRetrievedAt) {
      fail(
        "served deposit requires a real HTTP(S) GeoPDF acquisition URL, its retrieval timestamp, and the received bytes for sha256 proof v2; " +
          "a local --pdf path has no capture URL/retrieved_at, so it may only be used with --dry-run",
      );
    }
    const key = `normalized/ca-qc-zonage/qc-zonage-${slug}.geojson`;
    await depositT1MultisheetTextServedZoneGeojson(
      s3,
      key,
      served as unknown as ServedZoneGeoJson,
      pdfUrl,
      pdfBytes,
      pdfRetrievedAt,
    );
    await putBytes(s3, `normalized/ca-qc-zonage/qc-zonage-${slug}.stats.json`, JSON.stringify(report, null, 2), "application/json");
    console.error(`[t1-multisheet-text] uploaded s3://${BUCKET}/${key}`);
  }
  console.log(JSON.stringify(report, null, 2));
}

let CAPTURE: CaptureRun | null = null;

async function closeCapture(exitCode: number): Promise<void> {
  if (!CAPTURE) return;
  try { await CAPTURE.finish(exitCode); }
  catch (error) { console.error(`[t1-multisheet-text] WARN clôture capture: ${error instanceof Error ? error.message : String(error)}`); }
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
