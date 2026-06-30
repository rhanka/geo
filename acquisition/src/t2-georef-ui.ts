/**
 * t2-georef-ui.ts — local web tool to manually 3-GCP georeference a T2 zoning
 * PDF and serve it through the proven T1 cadastre pipeline.
 *
 * It is the interactive front-end over `lib/t2-georef` + `lib/t1-labels` +
 * `lib/t1-zones` + `lib/zone-serve`: the human places ≥3 Ground Control Points
 * (PDF point ↔ real OSM point), the server fits the affine page→WGS84 transform,
 * runs the EXACT committed zoning recipe (cadastre nearest-label aggregation),
 * previews the coloured zones on the map, and — on demand — writes
 * `qc-zonage-<slug>.geojson` locally and/or to S3. No geometry or code is
 * invented: GCPs only register WHERE the existing PDF labels sit on Earth.
 *
 * Run (from acquisition/):
 *   npx tsx src/t2-georef-ui.ts                 # http://localhost:8088, dry (no S3)
 *   npx tsx src/t2-georef-ui.ts --port 9000
 *   npx tsx src/t2-georef-ui.ts --allow-s3      # enable the "Serve to S3" button
 *
 * Everything is local + in-process. The only external calls are: the PDF
 * download (curl), the OSM tile fetch (browser), and S3 (cadastre read; write
 * only when --allow-s3 AND the human clicks Serve). NEVER logs a secret.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FeatureCollection } from "geojson";

import { extractLabels, type ExtractLabelsResult } from "./lib/t1-labels.js";
import { buildZones } from "./lib/t1-zones.js";
import { buildGeoRefFromGcps, type Gcp, type NeatlineFrac } from "./lib/t2-georef.js";
import { s3Client, getBytes, putBytes, exists, BUCKET } from "./lib/s3.js";
import { haversineKm, bboxCenter, mergeByZoneCode } from "./lib/zone-serve.js";

// ---------------------------------------------------------------------------
// The 16 focus T2 cities (9 ex-"T1" RL-only + 7 original T2). `labels` is the
// rollout-observed label kind (text = pdftotext exact; glyph = OCR-assist).
// `pdf` seeds are best-effort — VERIFY/replace in the UI's PDF field.
// ---------------------------------------------------------------------------
interface CityDef {
  slug: string;
  group: "ex-t1-rl" | "t2-origin";
  labels: "text" | "glyph" | "unknown";
  pdf?: string;
  page?: number;
}
const CITIES: CityDef[] = [
  { slug: "saint-constant", group: "ex-t1-rl", labels: "text", pdf: "https://saint-constant.ca/uploads/Plan%20de%20zonage.pdf" },
  { slug: "saint-philippe", group: "ex-t1-rl", labels: "text", pdf: "https://ville.saintphilippe.quebec/wp-content/uploads/2026/06/zonag-501-33-36x365000-1.pdf" },
  { slug: "carignan", group: "ex-t1-rl", labels: "text", pdf: "https://www.carignan.quebec/wp-content/uploads/2021/01/Plan-de-zonage-de-la-ville-de-Carignan.pdf" },
  { slug: "brossard", group: "ex-t1-rl", labels: "glyph", pdf: "https://brossard.ca/app/uploads/2025/04/attach_cmsUpload_76cb17db-32c4-479e-87f3-5d167692bb63-2.pdf" },
  { slug: "varennes", group: "ex-t1-rl", labels: "glyph" },
  { slug: "saint-basile-le-grand", group: "ex-t1-rl", labels: "glyph" },
  { slug: "mont-royal", group: "ex-t1-rl", labels: "glyph" },
  { slug: "dollard-des-ormeaux", group: "ex-t1-rl", labels: "glyph" },
  { slug: "kirkland", group: "ex-t1-rl", labels: "glyph" },
  { slug: "saint-lambert", group: "t2-origin", labels: "unknown" },
  { slug: "boucherville", group: "t2-origin", labels: "unknown" },
  { slug: "saint-bruno-de-montarville", group: "t2-origin", labels: "unknown" },
  { slug: "chateauguay", group: "t2-origin", labels: "unknown", pdf: "https://ville.chateauguay.qc.ca/wp-content/uploads/2026/06/Annexe-A-Plan-de-zonage-2026.06.02.pdf" },
  { slug: "montreal-ouest", group: "t2-origin", labels: "unknown", pdf: "https://montreal-west.ca/wp-content/uploads/2018/10/2010-002-annexe-1-plan-de-zonage.pdf" },
  { slug: "montreal-est", group: "t2-origin", labels: "unknown" },
  { slug: "sainte-julie", group: "t2-origin", labels: "unknown", pdf: "https://www.ville.sainte-julie.qc.ca/uploads/html_content/Reglementation/2023-01-27_-_Plan_de_zonage_-_R.pdf" },
];

interface ServerOpts {
  port: number;
  allowS3: boolean;
  gcpDir: string;
  outDir: string;
}
function parseOpts(argv: string[]): ServerOpts {
  const a: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    if (t.startsWith("--")) {
      const key = t.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) a[key] = true;
      else { a[key] = next; i++; }
    }
  }
  return {
    port: a["port"] ? Number(a["port"]) : 8088,
    allowS3: Boolean(a["allow-s3"]),
    gcpDir: a["gcp-dir"] ? String(a["gcp-dir"]) : join(process.cwd(), "..", "work", "gcp"),
    outDir: a["out-dir"] ? String(a["out-dir"]) : join(process.cwd(), "..", "work", "t2-out"),
  };
}

// ---------------------------------------------------------------------------
// Per-slug caches (PDF path, raster PNG, parsed cadastre) so previews are fast.
// ---------------------------------------------------------------------------
const pdfCache = new Map<string, string>(); // slug|url -> local pdf path
const rasterCache = new Map<string, { png: string; imgW: number; imgH: number; pageW: number; pageH: number }>();
const cadastreCache = new Map<string, FeatureCollection>();
const cadInfoCache = new Map<string, { bbox: [number, number, number, number]; center: [number, number]; nLots: number }>();

function resolvePdf(slug: string, pdf: string): string {
  const key = `${slug}|${pdf}`;
  const cached = pdfCache.get(key);
  if (cached && existsSync(cached)) return cached;
  if (!/^https?:/.test(pdf)) {
    if (!existsSync(pdf)) throw new Error(`pdf not found: ${pdf}`);
    pdfCache.set(key, pdf);
    return pdf;
  }
  const path = join(tmpdir(), `t2ui-${slug}-${Date.now()}.pdf`);
  execSync(`curl -sL -A "Mozilla/5.0" ${JSON.stringify(pdf)} -o ${JSON.stringify(path)}`, { timeout: 120_000 });
  if (!existsSync(path) || readFileSync(path).length < 1000) throw new Error("PDF download failed / empty");
  pdfCache.set(key, path);
  return path;
}

function pngSize(buf: Buffer): { w: number; h: number } {
  if (buf.length < 24 || buf.toString("ascii", 12, 16) !== "IHDR") throw new Error("not a PNG");
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function rasterize(slug: string, pdfPath: string, dpi: number, page: number): { png: string; imgW: number; imgH: number; pageW: number; pageH: number } {
  const key = `${slug}|${pdfPath}|${dpi}|p${page}`;
  const cached = rasterCache.get(key);
  if (cached && existsSync(cached.png)) return cached;
  const info = execSync(`pdfinfo -f ${page} -l ${page} ${JSON.stringify(pdfPath)}`, { encoding: "utf8" });
  const pm =
    info.match(new RegExp(`Page\\s+${page}\\s+size:\\s*([\\d.]+)\\s*x\\s*([\\d.]+)`)) ??
    info.match(/Page size:\s*([\d.]+)\s*x\s*([\d.]+)/);
  if (!pm) throw new Error("pdfinfo: no page size");
  const pageW = Number(pm[1]);
  const pageH = Number(pm[2]);
  const prefix = join(tmpdir(), `t2ui-ras-${slug}-${dpi}-p${page}-${Date.now()}`);
  execSync(`pdftoppm -singlefile -r ${dpi} -png -f ${page} -l ${page} ${JSON.stringify(pdfPath)} ${JSON.stringify(prefix)}`, { timeout: 180_000 });
  const png = `${prefix}.png`;
  if (!existsSync(png)) throw new Error("pdftoppm: no PNG");
  const { w, h } = pngSize(readFileSync(png));
  const out = { png, imgW: w, imgH: h, pageW, pageH };
  rasterCache.set(key, out);
  return out;
}

async function loadCadastre(slug: string): Promise<FeatureCollection> {
  const c = cadastreCache.get(slug);
  if (c) return c;
  const s3 = s3Client();
  const buf = await getBytes(s3, `normalized/qc-cadastre-lots/${slug}.geojson`);
  const fc = JSON.parse(buf.toString("utf8")) as FeatureCollection;
  cadastreCache.set(slug, fc);
  const { center, bbox } = bboxCenter(fc);
  cadInfoCache.set(slug, { center, bbox, nLots: fc.features.length });
  return fc;
}

// ---------------------------------------------------------------------------
// Build (in-process): GCPs → georef → labels → zones → served FC + report.
// ---------------------------------------------------------------------------
interface BuildBody {
  slug: string;
  pdf: string;
  gcps: Gcp[];
  neatline?: NeatlineFrac;
  page?: number;
  labels?: "text" | "ocr";
  ocrReviewed?: boolean;
  dpi?: number;
  cutoffM?: number;
  minCodes?: number;
  maxResidualM?: number;
  spatialKm?: number;
}
async function runBuild(b: BuildBody): Promise<{ ok: true; report: Record<string, unknown>; zones: FeatureCollection } | { ok: false; error: string }> {
  try {
    const minCodes = b.minCodes ?? 8;
    const minDistinct = Math.max(3, minCodes);
    const maxResidualM = b.maxResidualM ?? 50;
    const spatialKm = b.spatialKm ?? 8;
    const cutoffM = b.cutoffM ?? 1500;
    const page = b.page ?? 1;
    const pdfPath = resolvePdf(b.slug, b.pdf);
    const { pageW, pageH } = rasterize(b.slug, pdfPath, b.dpi ?? 150, page);

    const cal = buildGeoRefFromGcps(b.gcps, pageW, pageH, b.neatline);
    if (cal.maxResidualM > maxResidualM) {
      return { ok: false, error: `GCP residual ${cal.maxResidualM.toFixed(1)} m > ${maxResidualM} m — recheck picks` };
    }
    let lab: ExtractLabelsResult;
    if ((b.labels ?? "text") === "ocr") {
      const { extractLabelsOcr } = await import("./lib/t2-labels-ocr.js");
      lab = await extractLabelsOcr(pdfPath, cal.geo, { dpi: b.dpi ?? 200, page });
    } else {
      lab = extractLabels(pdfPath, cal.geo, { page });
    }
    const distinct = new Set(lab.codePoints.map((c) => c.code));
    if (distinct.size < minDistinct) {
      return { ok: false, error: `only ${distinct.size} distinct codes (< ${minDistinct}); ${(b.labels ?? "text") === "text" ? "try OCR labels if glyphs" : "OCR yield too low"}` };
    }
    const banned = /^(affectation|cmm|mrc|sad|pmad)/i;
    const nonLettered = [...distinct].filter((c) => !/[A-Za-z]/.test(c) || !/\d/.test(c));
    const bannedHit = [...distinct].filter((c) => banned.test(c));
    if (nonLettered.length) return { ok: false, error: `non-lettered codes present: ${nonLettered.slice(0, 6).join(", ")}` };
    if (bannedHit.length) return { ok: false, error: `affectation/CMM tokens: ${bannedHit.join(", ")}` };

    const cadastre = await loadCadastre(b.slug);
    const info = cadInfoCache.get(b.slug)!;
    const lat0 = (info.bbox[1] + info.bbox[3]) / 2;
    const labCenter: [number, number] = lab.codePoints.reduce(
      (acc, c) => [acc[0] + c.lon / lab.codePoints.length, acc[1] + c.lat / lab.codePoints.length],
      [0, 0] as [number, number],
    );
    const spatial = haversineKm(labCenter, info.center);
    if (spatial > spatialKm) {
      return { ok: false, error: `labels ${spatial.toFixed(1)} km from cadastre (> ${spatialKm} km) — GCP georef mismatch` };
    }
    const { featureCollection, stats } = buildZones(cadastre, lab.codePoints, {
      lat0, cutoffM, source: "t2-gcp3", confidence: "contour-manual-gcp", dissolve: true,
    });
    const served = mergeByZoneCode(featureCollection);
    const lotPct = (100 * stats.n_lots_assigned) / stats.n_lots_total;
    const report = {
      slug: b.slug, source: "t2-gcp3", confidence: "contour-manual-gcp", pdf: b.pdf, page,
      label_mode: b.labels ?? "text", n_gcps: b.gcps.length,
      ocr_reviewed: (b.labels ?? "text") === "ocr" ? Boolean(b.ocrReviewed) : undefined,
      gcp_residual_max_m: Number(cal.maxResidualM.toFixed(3)), gcp_residual_rms_m: Number(cal.rmsResidualM.toFixed(3)),
      gcp_residuals_m: cal.residualsM.map((r) => Number(r.toFixed(2))),
      n_label_codes: distinct.size, n_labels_in_frame: lab.nInsideFrame,
      n_served_features: served.features.length, label_spatial_km_from_cadastre: Number(spatial.toFixed(3)),
      lot_to_zone_pct: Number(lotPct.toFixed(2)), n_lots_assigned: stats.n_lots_assigned, n_lots_total: stats.n_lots_total,
    };
    return { ok: true, report, zones: served };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------
function sendJson(res: ServerResponse, code: number, obj: unknown): void {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  res.end(body);
}
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function main(): void {
  const opts = parseOpts(process.argv.slice(2));
  mkdirSync(opts.gcpDir, { recursive: true });
  mkdirSync(opts.outDir, { recursive: true });

  const server = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", `http://localhost:${opts.port}`);
        const path = url.pathname;

        if (path === "/" || path === "/index.html") {
          const html = HTML;
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(html);
          return;
        }

        if (path === "/api/cities") {
          const savedGcps = new Set(
            existsSync(opts.gcpDir)
              ? readdirSync(opts.gcpDir).filter((f) => f.endsWith(".gcp.json")).map((f) => f.replace(/\.gcp\.json$/, ""))
              : [],
          );
          const s3 = opts.allowS3 ? s3Client() : null;
          const out = [];
          for (const c of CITIES) {
            let served = false;
            if (s3) served = await exists(s3, `normalized/ca-qc-zonage/qc-zonage-${c.slug}.geojson`).catch(() => false);
            out.push({ ...c, page: c.page ?? 1, hasGcp: savedGcps.has(c.slug), served });
          }
          sendJson(res, 200, { allowS3: opts.allowS3, gcpDir: opts.gcpDir, outDir: opts.outDir, cities: out });
          return;
        }

        if (path === "/api/load") {
          const slug = url.searchParams.get("slug") ?? "";
          const pdf = url.searchParams.get("pdf") ?? CITIES.find((c) => c.slug === slug)?.pdf ?? "";
          const dpi = Number(url.searchParams.get("dpi") ?? "150");
          const page = Number(url.searchParams.get("page") ?? CITIES.find((c) => c.slug === slug)?.page ?? "1");
          if (!slug || !pdf) { sendJson(res, 400, { error: "slug and pdf required" }); return; }
          const pdfPath = resolvePdf(slug, pdf);
          const ras = rasterize(slug, pdfPath, dpi, page);
          let cad: { bbox: number[]; center: number[]; nLots: number } | null = null;
          try { await loadCadastre(slug); const i = cadInfoCache.get(slug)!; cad = { bbox: i.bbox, center: i.center, nLots: i.nLots }; }
          catch (e) { cad = null; void e; }
          // load existing saved GCP if any
          let saved: unknown = null;
          const gp = join(opts.gcpDir, `${slug}.gcp.json`);
          if (existsSync(gp)) saved = JSON.parse(readFileSync(gp, "utf8"));
          sendJson(res, 200, { slug, pdf, page, dpi, pageW: ras.pageW, pageH: ras.pageH, imgW: ras.imgW, imgH: ras.imgH, cadastre: cad, savedGcp: saved });
          return;
        }

        if (path === "/api/raster") {
          const slug = url.searchParams.get("slug") ?? "";
          const dpi = url.searchParams.get("dpi") ?? "150";
          const page = url.searchParams.get("page") ?? "1";
          const entry = [...rasterCache.entries()].find(([k]) => k.startsWith(`${slug}|`) && k.endsWith(`|${dpi}|p${page}`));
          if (!entry) { sendJson(res, 404, { error: "raster not loaded; call /api/load first" }); return; }
          const buf = readFileSync(entry[1].png);
          res.writeHead(200, { "content-type": "image/png", "content-length": buf.length });
          res.end(buf);
          return;
        }

        if (path === "/api/build" && req.method === "POST") {
          const body = JSON.parse(await readBody(req)) as BuildBody;
          const r = await runBuild(body);
          sendJson(res, r.ok ? 200 : 422, r);
          return;
        }

        if (path === "/api/save-gcp" && req.method === "POST") {
          const body = JSON.parse(await readBody(req)) as { slug: string; pdf: string; page?: number; gcps: Gcp[]; neatline?: NeatlineFrac; pageW?: number; pageH?: number };
          const file = { slug: body.slug, pdf: body.pdf, page: body.page ?? 1, pageW: body.pageW, pageH: body.pageH, gcps: body.gcps, neatline: body.neatline };
          const gp = join(opts.gcpDir, `${body.slug}.gcp.json`);
          writeFileSync(gp, JSON.stringify(file, null, 2));
          sendJson(res, 200, { ok: true, path: gp });
          return;
        }

        if (path === "/api/serve" && req.method === "POST") {
          const body = JSON.parse(await readBody(req)) as BuildBody & { toS3?: boolean };
          const r = await runBuild(body);
          if (!r.ok) { sendJson(res, 422, r); return; }
          if ((body.labels ?? "text") === "ocr" && body.toS3 && !body.ocrReviewed) {
            sendJson(res, 422, { ok: false, error: "OCR labels need human code QA before S3; tick OCR reviewed after checking verbatim codes" });
            return;
          }
          const localPath = join(opts.outDir, `qc-zonage-${body.slug}.geojson`);
          writeFileSync(localPath, JSON.stringify(r.zones));
          writeFileSync(join(opts.outDir, `qc-zonage-${body.slug}.stats.json`), JSON.stringify(r.report, null, 2));
          let s3Key: string | null = null;
          if (body.toS3) {
            if (!opts.allowS3) { sendJson(res, 403, { ok: false, error: "server started without --allow-s3" }); return; }
            const s3 = s3Client();
            s3Key = `normalized/ca-qc-zonage/qc-zonage-${body.slug}.geojson`;
            await putBytes(s3, s3Key, JSON.stringify(r.zones), "application/geo+json");
            await putBytes(s3, `normalized/ca-qc-zonage/qc-zonage-${body.slug}.stats.json`, JSON.stringify(r.report, null, 2), "application/json");
          }
          sendJson(res, 200, { ok: true, localPath, s3: s3Key ? `s3://${BUCKET}/${s3Key}` : null, report: r.report });
          return;
        }

        sendJson(res, 404, { error: `no route ${path}` });
      } catch (e) {
        sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
      }
    })();
  });

  server.listen(opts.port, () => {
    console.error(`\n  gcp3 T2 georef tool  →  http://localhost:${opts.port}`);
    console.error(`  S3 serving: ${opts.allowS3 ? "ENABLED (--allow-s3)" : "disabled (local only)"}`);
    console.error(`  GCP files : ${opts.gcpDir}`);
    console.error(`  Served to : ${opts.outDir}\n`);
  });
}

// ---------------------------------------------------------------------------
// The single-page UI (vanilla JS + Leaflet from CDN). Two panes: rasterised PDF
// (left, click to place a PDF GCP) + OSM map (right, click the SAME real point).
// ---------------------------------------------------------------------------
const HTML = String.raw`<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>gcp3 — calage T2 zonage</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
  :root{--bg:#0f1115;--panel:#171a21;--fg:#e6e6e6;--mut:#9aa3b2;--acc:#4ea1ff;--ok:#36c177;--bad:#ff5d5d;}
  *{box-sizing:border-box}
  body{margin:0;font:13px/1.4 system-ui,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg)}
  header{display:flex;gap:10px;align-items:center;padding:8px 12px;background:var(--panel);border-bottom:1px solid #262b36;flex-wrap:wrap}
  header b{color:var(--acc)}
  select,input,button{font:inherit;background:#0d0f14;color:var(--fg);border:1px solid #2a3140;border-radius:6px;padding:5px 8px}
  input[type=text]{min-width:340px}
  button{cursor:pointer;background:#1d2430}
  button.primary{background:var(--acc);color:#04101f;border-color:var(--acc);font-weight:600}
  button.ok{background:var(--ok);color:#03140b;border-color:var(--ok);font-weight:600}
  button:disabled{opacity:.45;cursor:not-allowed}
  #main{display:grid;grid-template-columns:1fr 1fr;gap:0;height:calc(100vh - 96px)}
  #left{position:relative;overflow:auto;background:#000;border-right:1px solid #262b36}
  #pdfwrap{position:relative;display:inline-block}
  #pdfimg{display:block;max-width:100%}
  #map{height:100%}
  .gcpdot{position:absolute;transform:translate(-50%,-50%);width:20px;height:20px;border-radius:50%;
    background:var(--acc);color:#04101f;font-weight:700;display:flex;align-items:center;justify-content:center;
    border:2px solid #fff;font-size:11px;pointer-events:none;box-shadow:0 0 4px #000}
  .gcpdot.pending{background:#ffb020;color:#1a0e00}
  #side{position:absolute;right:0;top:0;z-index:500;background:rgba(17,20,27,.92);padding:8px;border-radius:0 0 0 8px;max-width:320px;font-size:12px}
  table{border-collapse:collapse;width:100%}
  td,th{padding:2px 5px;border-bottom:1px solid #262b36;text-align:left}
  .mut{color:var(--mut)} .ok{color:var(--ok)} .bad{color:var(--bad)}
  #status{padding:5px 12px;background:var(--panel);border-top:1px solid #262b36;min-height:26px}
  .leaflet-popup-content{color:#111}
  .pill{display:inline-block;padding:1px 6px;border-radius:10px;background:#222b3a;font-size:11px;margin-left:4px}
</style></head>
<body>
<header>
  <b>gcp3</b> calage 3-GCP T2
  <select id="city"></select>
  <input type="text" id="pdf" placeholder="URL ou chemin du PDF de zonage (plan)"/>
  <label class="mut">page <input type="number" id="page" value="1" min="1" style="width:64px"></label>
  <label class="mut">dpi <input type="number" id="dpi" value="150" style="width:64px"></label>
  <button id="load">Charger</button>
  <label class="mut"><input type="checkbox" id="ocr"> labels OCR (glyphes, exp.)</label>
  <label class="mut"><input type="checkbox" id="ocrReviewed"> OCR revu</label>
  <span id="meta" class="mut"></span>
</header>
<div id="main">
  <div id="left"><div id="pdfwrap"><img id="pdfimg" alt="(charger une ville)"></div></div>
  <div style="position:relative"><div id="map"></div>
    <div id="side">
      <div><b>GCPs</b> <span class="mut">(clic PDF puis clic carte, ×3+)</span></div>
      <table id="gcptab"><tbody></tbody></table>
      <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
        <button id="undo">↶ annuler</button>
        <button id="clear">vider</button>
        <button id="compute" class="primary" disabled>Calculer + Aperçu</button>
      </div>
      <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
        <button id="savegcp" disabled>💾 Sauver GCP</button>
        <button id="serveLocal" class="ok" disabled>Servir (local)</button>
        <button id="serveS3" disabled>Servir → S3</button>
      </div>
      <div id="report" style="margin-top:6px"></div>
    </div>
  </div>
</div>
<div id="status" class="mut">Prêt. Choisir une ville, vérifier/coller l'URL du PDF, Charger.</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const KIND_COLORS={residential:"#4ea1ff",commercial:"#ff8c42",industrial:"#b07cff",institutional:"#ffd166",
  park:"#36c177",agricultural:"#9acd32",conservation:"#2ec4b6",mixed:"#f78fb3","mixed-use":"#f78fb3",unknown:"#9aa3b2"};
let STATE={slug:"",pdf:"",page:1,pageW:0,pageH:0,imgW:0,imgH:0,allowS3:false,gcps:[],pending:null,zonesLayer:null};
const $=id=>document.getElementById(id);
const status=(m,cls)=>{const s=$("status");s.textContent=m;s.className=cls||"mut";};

const map=L.map("map",{zoomControl:true}).setView([45.5,-73.5],11);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OSM"}).addTo(map);
let bboxRect=null, mapMarkers=[];

async function loadCities(){
  const r=await fetch("/api/cities");const d=await r.json();STATE.allowS3=d.allowS3;
  const sel=$("city");sel.innerHTML="";
  for(const c of d.cities){
    const o=document.createElement("option");o.value=c.slug;
    o.textContent=(c.served?"✅ ":(c.hasGcp?"📍 ":"· "))+c.slug+"  ["+c.labels+"]";
    o.dataset.pdf=c.pdf||"";o.dataset.labels=c.labels;o.dataset.page=c.page||1;sel.appendChild(o);
  }
  $("serveS3").style.display=d.allowS3?"":"none";
  syncCity();
}
function syncCity(){const o=$("city").selectedOptions[0];if(!o)return;$("pdf").value=o.dataset.pdf||"";$("page").value=o.dataset.page||1;$("ocr").checked=o.dataset.labels==="glyph";}
$("city").onchange=syncCity;

$("load").onclick=async()=>{
  const slug=$("city").value, pdf=$("pdf").value.trim(), dpi=$("dpi").value||"150", page=$("page").value||"1";
  if(!pdf){status("Coller l'URL/chemin du PDF de plan de zonage.","bad");return;}
  status("Chargement + rasterisation du PDF… (téléchargement, pdftoppm)","mut");
  try{
    const r=await fetch("/api/load?slug="+encodeURIComponent(slug)+"&pdf="+encodeURIComponent(pdf)+"&dpi="+dpi+"&page="+page);
    const d=await r.json();if(d.error){status("Erreur: "+d.error,"bad");return;}
    STATE={...STATE,slug,pdf,page:Number(page),pageW:d.pageW,pageH:d.pageH,imgW:d.imgW,imgH:d.imgH,gcps:[],pending:null};
    $("pdfimg").src="/api/raster?slug="+encodeURIComponent(slug)+"&dpi="+dpi+"&page="+page+"&t="+Date.now();
    $("meta").textContent="page "+page+" · "+d.pageW+"×"+d.pageH+"pt · img "+d.imgW+"×"+d.imgH+"px"+(d.cadastre?(" · cadastre "+d.cadastre.nLots+" lots"):" · cadastre MANQUANT");
    if(d.cadastre){
      const[mnx,mny,mxx,mxy]=d.cadastre.bbox;
      if(bboxRect)map.removeLayer(bboxRect);
      bboxRect=L.rectangle([[mny,mnx],[mxy,mxx]],{color:"#4ea1ff",weight:1,fill:false,dashArray:"4"}).addTo(map);
      map.fitBounds([[mny,mnx],[mxy,mxx]]);
    }
    if(d.savedGcp&&d.savedGcp.gcps){d.savedGcp.gcps.forEach(g=>STATE.gcps.push({...g}));status("GCP sauvegardés rechargés ("+STATE.gcps.length+").","ok");}
    redraw();status("PDF chargé. Placer ≥3 GCP: clic sur un point reconnaissable du PLAN, puis le MÊME point sur la carte OSM.","ok");
  }catch(e){status("Erreur: "+e.message,"bad");}
};

$("pdfimg").onclick=ev=>{
  if(!STATE.slug)return;
  const img=$("pdfimg");const rect=img.getBoundingClientRect();
  const fx=(ev.clientX-rect.left)/rect.width, fy=(ev.clientY-rect.top)/rect.height;
  if(STATE.pending&&STATE.pending.lon==null){STATE.pending.fx=fx;STATE.pending.fy=fy;} // replace pdf side
  else{STATE.pending={fx,fy,lon:null,lat:null};}
  status("Point PDF #"+(STATE.gcps.length+1)+" placé. Maintenant clic le même endroit sur la carte.","mut");
  redraw();
};
map.on("click",ev=>{
  if(!STATE.slug)return;
  const lon=ev.latlng.lng, lat=ev.latlng.lat;
  if(STATE.pending&&STATE.pending.fx!=null){STATE.pending.lon=lon;STATE.pending.lat=lat;STATE.gcps.push(STATE.pending);STATE.pending=null;
    status("GCP #"+STATE.gcps.length+" complété.", STATE.gcps.length>=3?"ok":"mut");}
  else{status("Placer d'abord le point sur le PDF (gauche).","bad");}
  redraw();
});

function redraw(){
  // pdf dots
  const wrap=$("pdfwrap");[...wrap.querySelectorAll(".gcpdot")].forEach(e=>e.remove());
  const img=$("pdfimg");const addDot=(fx,fy,label,pending)=>{
    const d=document.createElement("div");d.className="gcpdot"+(pending?" pending":"");
    d.style.left=(fx*img.clientWidth)+"px";d.style.top=(fy*img.clientHeight)+"px";d.textContent=label;wrap.appendChild(d);};
  STATE.gcps.forEach((g,i)=>addDot(g.fx,g.fy,i+1,false));
  if(STATE.pending&&STATE.pending.fx!=null)addDot(STATE.pending.fx,STATE.pending.fy,STATE.gcps.length+1,true);
  // map markers
  mapMarkers.forEach(m=>map.removeLayer(m));mapMarkers=[];
  STATE.gcps.forEach((g,i)=>{if(g.lon!=null){const m=L.marker([g.lat,g.lon]).addTo(map).bindTooltip(""+(i+1),{permanent:true,direction:"top"});mapMarkers.push(m);}});
  // table
  const tb=$("gcptab").querySelector("tbody");tb.innerHTML="";
  STATE.gcps.forEach((g,i)=>{const tr=document.createElement("tr");
    tr.innerHTML="<td>#"+(i+1)+"</td><td class=mut>"+g.fx.toFixed(3)+","+g.fy.toFixed(3)+"</td><td>"+(g.lon!=null?g.lat.toFixed(5)+","+g.lon.toFixed(5):"—")+"</td><td id=res"+i+" class=mut>·</td>";tb.appendChild(tr);});
  const ready=STATE.gcps.length>=3 && STATE.gcps.every(g=>g.lon!=null);
  $("compute").disabled=!ready; $("savegcp").disabled=STATE.gcps.length<3;
}
$("undo").onclick=()=>{if(STATE.pending){STATE.pending=null;}else{STATE.gcps.pop();}redraw();};
$("clear").onclick=()=>{STATE.gcps=[];STATE.pending=null;if(STATE.zonesLayer){map.removeLayer(STATE.zonesLayer);STATE.zonesLayer=null;}$("report").innerHTML="";["serveLocal","serveS3"].forEach(b=>$(b).disabled=true);redraw();};

function buildBody(){return{slug:STATE.slug,pdf:STATE.pdf,gcps:STATE.gcps.map(g=>({fx:g.fx,fy:g.fy,lon:g.lon,lat:g.lat})),
  labels:$("ocr").checked?"ocr":"text",ocrReviewed:$("ocrReviewed").checked,page:STATE.page,dpi:Number($("dpi").value||150),pageW:STATE.pageW,pageH:STATE.pageH};}

$("compute").onclick=async()=>{
  status("Calage + extraction labels + agrégation cadastre…","mut");
  $("compute").disabled=true;
  try{
    const r=await fetch("/api/build",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(buildBody())});
    const d=await r.json();
    if(!d.ok){status("Échec gate: "+d.error,"bad");$("compute").disabled=false;return;}
    const rep=d.report;
    rep.gcp_residuals_m.forEach((v,i)=>{const c=$("res"+i);if(c){c.textContent=v+"m";c.className=v<5?"ok":(v<20?"mut":"bad");}});
    if(STATE.zonesLayer)map.removeLayer(STATE.zonesLayer);
    STATE.zonesLayer=L.geoJSON(d.zones,{style:f=>({color:KIND_COLORS[f.properties.kind]||"#9aa3b2",weight:1,fillOpacity:.45}),
      onEachFeature:(f,l)=>l.bindPopup("<b>"+f.properties.zone_code+"</b> ("+(f.properties.kind||"?")+")<br>"+f.properties.n_lots+" lots")}).addTo(map);
    $("report").innerHTML="<table>"+
      "<tr><td>résidu GCP max</td><td class='"+(rep.gcp_residual_max_m<5?"ok":"bad")+"'>"+rep.gcp_residual_max_m+" m (rms "+rep.gcp_residual_rms_m+")</td></tr>"+
      "<tr><td>codes distincts</td><td>"+rep.n_label_codes+"</td></tr>"+
      "<tr><td>features servies</td><td>"+rep.n_served_features+"</td></tr>"+
      "<tr><td>lots → zone</td><td>"+rep.lot_to_zone_pct+"% ("+rep.n_lots_assigned+"/"+rep.n_lots_total+")</td></tr>"+
      "<tr><td>spatial labels↔cadastre</td><td>"+rep.label_spatial_km_from_cadastre+" km</td></tr></table>";
    ["serveLocal","serveS3"].forEach(b=>$(b).disabled=false);
    status("Aperçu OK — "+rep.n_label_codes+" codes, "+rep.lot_to_zone_pct+"% lots zonés. Vérifier visuellement avant de servir.","ok");
  }catch(e){status("Erreur: "+e.message,"bad");}
  $("compute").disabled=false;
};
$("savegcp").onclick=async()=>{
  const r=await fetch("/api/save-gcp",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(buildBody())});
  const d=await r.json();status(d.ok?("GCP sauvés: "+d.path):("Erreur: "+d.error),d.ok?"ok":"bad");
};
async function serve(toS3){
  status("Construction + dépôt"+(toS3?" S3":" local")+"…","mut");
  const r=await fetch("/api/serve",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...buildBody(),toS3})});
  const d=await r.json();
  if(!d.ok){status("Échec: "+d.error,"bad");return;}
  status("Servi: "+d.localPath+(d.s3?(" + "+d.s3):""),"ok");
}
$("serveLocal").onclick=()=>serve(false);
$("serveS3").onclick=()=>serve(true);
window.addEventListener("resize",redraw);
loadCities();
</script>
</body></html>`;

main();
