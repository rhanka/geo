/**
 * _diag-t3-reseed-spread — re-emit a chamfer seed's GCPs picking cadastre
 * vertices SPREAD OVER THE GEOGRAPHIC BBOX (grid-cell nearest-to-center),
 * instead of deriveChamferSeed's constant ARRAY-INDEX stride over
 * sampleCadastreModel's arc-length-ordered points (which can cluster all
 * emitted GCPs within one contiguous stretch of the model's iteration order
 * even when the model itself spans kilometres — measured on riviere-eternite:
 * seed fx/fy spanned only ~0.19x0.06 of the page though the cadastre spans
 * ~8km, and refitting an affine from that cluster projected the WHOLE
 * cadastre onto the plan's legend column, not the real Rang A-E grid).
 *
 * Uses the EXACT same pose math as deriveChamferSeed (from an already-passed
 * chamfer report's `best` pose) — no re-derivation, no gate touched. Output
 * is still `independent:false` / `cadastre-chamfer-seed`, still a SEED only.
 *
 * usage: npx tsx acquisition/src/_diag-t3-reseed-spread.ts --chamfer-report <r.json> \
 *   --cadastre <local.geojson> --page-w <n> --page-h <n> --pdf <path> --slug <slug> \
 *   --n 20 --out <seed.gcp.json>
 */
import { readFileSync, writeFileSync } from "node:fs";

const M_PER_DEG_LAT = 111320;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const reportPath = arg("chamfer-report");
const cadastrePath = arg("cadastre");
const pageW = Number(arg("page-w"));
const pageH = Number(arg("page-h"));
const pdf = arg("pdf");
const slug = arg("slug");
const n = Number(arg("n") ?? "20");
const outPath = arg("out");
if (!reportPath || !cadastrePath || !pageW || !pageH || !pdf || !slug || !outPath) {
  console.error(
    "usage: --chamfer-report <r.json> --cadastre <local.geojson> --page-w <n> --page-h <n> --pdf <path> --slug <slug> --n 20 --out <seed.gcp.json>",
  );
  process.exit(1);
}

const report = JSON.parse(readFileSync(reportPath, "utf8"));
const pose = report.best;
if (!pose) throw new Error("chamfer report has no best pose");
const dpi = report.dpi as number;
const scale = dpi / 72;

const cadastre = JSON.parse(readFileSync(cadastrePath, "utf8"));

function scanRings(geom: any, cb: (ring: [number, number][]) => void) {
  if (!geom) return;
  if (geom.type === "Polygon") for (const ring of geom.coordinates) cb(ring);
  else if (geom.type === "MultiPolygon") for (const poly of geom.coordinates) for (const ring of poly) cb(ring);
}

let minLat = Infinity;
let maxLat = -Infinity;
let minLon = Infinity;
let maxLon = -Infinity;
const allVerts: [number, number][] = [];
for (const f of cadastre.features) {
  scanRings(f.geometry, (ring) => {
    for (const p of ring) {
      const lon = p[0]!;
      const lat = p[1]!;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      allVerts.push([lon, lat]);
    }
  });
}
const lat0 = (minLat + maxLat) / 2;
const centroidLon = (minLon + maxLon) / 2;
const centroidLat = (minLat + maxLat) / 2;
const mPerLon = M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);
const cxm = centroidLon * mPerLon;
const cym = centroidLat * M_PER_DEG_LAT;

// grid the bbox into ~n cells, pick nearest real vertex to each cell center
const cols = Math.ceil(Math.sqrt(n));
const rows = Math.ceil(n / cols);
const picked: [number, number][] = [];
for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    if (picked.length >= n) break;
    const flon = minLon + ((c + 0.5) / cols) * (maxLon - minLon);
    const flat = minLat + ((r + 0.5) / rows) * (maxLat - minLat);
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (const v of allVerts) {
      const d = (v[0] - flon) ** 2 + (v[1] - flat) ** 2;
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    if (best) picked.push(best);
  }
}

const cos = Math.cos((pose.rotation_deg * Math.PI) / 180);
const sin = Math.sin((pose.rotation_deg * Math.PI) / 180);
const gcps = picked.map(([lon, lat]) => {
  const xm = lon * mPerLon;
  const ym = lat * M_PER_DEG_LAT;
  const dx = xm - cxm;
  const dy = ym - cym;
  const px = pose.cx_px + pose.scale_px_per_m * (dx * cos + dy * sin);
  const py = pose.cy_px + pose.scale_px_per_m * (dx * sin - dy * cos);
  return {
    fx: px / scale / pageW,
    fy: py / scale / pageH,
    lon,
    lat,
    source: "cadastre-chamfer-seed",
    independent: false,
    note:
      `COARSE SEED ONLY (never a calibration), RESEEDED for geographic spread: chamfer pose rot=${pose.rotation_deg.toFixed(2)}deg ` +
      `scale=${pose.scale_px_per_m.toFixed(4)}px/m ratio=${pose.scale_ratio.toFixed(3)} ` +
      `mean_ground_dist=${pose.mean_dist_m.toFixed(1)}m inliers=${pose.inlier_pct.toFixed(1)}%`,
  };
});

const gcpFile = {
  slug,
  pdf,
  page: report.page ?? 1,
  pageW,
  pageH,
  gcps,
};
writeFileSync(outPath, JSON.stringify(gcpFile, null, 2));
console.log(
  JSON.stringify(
    {
      picked: gcps.length,
      fx_range: [Math.min(...gcps.map((g) => g.fx)), Math.max(...gcps.map((g) => g.fx))],
      fy_range: [Math.min(...gcps.map((g) => g.fy)), Math.max(...gcps.map((g) => g.fy))],
    },
    null,
    2,
  ),
);
