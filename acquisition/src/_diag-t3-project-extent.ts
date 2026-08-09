/**
 * _diag-t3-project-extent — diagnose WHERE the cadastre model actually lands
 * on the plan page (page fractions), given a chamfer seed GCP file, so a
 * --neatline restriction can be aimed correctly instead of guessed visually.
 * Reuses the exact same seedInverse affine as t2-raster-register.ts.
 *
 * usage: npx tsx acquisition/src/_diag-t3-project-extent.ts --gcp <seed.gcp.json> --cadastre <local.geojson>
 */
import { readFileSync } from "node:fs";
import { fitAffine } from "./lib/t1-georef.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const gcpPath = arg("gcp");
const cadastrePath = arg("cadastre");
if (!gcpPath || !cadastrePath) {
  console.error("usage: --gcp <seed.gcp.json> --cadastre <local.geojson>");
  process.exit(1);
}

const seed = JSON.parse(readFileSync(gcpPath, "utf8"));
const cadastre = JSON.parse(readFileSync(cadastrePath, "utf8"));

const pageW = seed.pageW;
const pageH = seed.pageH;
const pts = seed.gcps.map((g: any) => [g.lon, g.lat] as [number, number]);
const xs = seed.gcps.map((g: any) => g.fx * pageW);
const ys = seed.gcps.map((g: any) => g.fy * pageH);
const cx = fitAffine(pts, xs);
const cy = fitAffine(pts, ys);
const toPage = (lon: number, lat: number) => ({
  x: cx[0] * lon + cx[1] * lat + cx[2],
  y: cy[0] * lon + cy[1] * lat + cy[2],
});

let minFx = Infinity;
let maxFx = -Infinity;
let minFy = Infinity;
let maxFy = -Infinity;
let n = 0;

function scan(geom: any) {
  if (!geom) return;
  if (geom.type === "Polygon") {
    for (const ring of geom.coordinates) for (const p of ring) visit(p);
  } else if (geom.type === "MultiPolygon") {
    for (const poly of geom.coordinates) for (const ring of poly) for (const p of ring) visit(p);
  }
}
function visit(p: [number, number]) {
  const page = toPage(p[0], p[1]);
  const fx = page.x / pageW;
  const fy = page.y / pageH;
  if (fx < minFx) minFx = fx;
  if (fx > maxFx) maxFx = fx;
  if (fy < minFy) minFy = fy;
  if (fy > maxFy) maxFy = fy;
  n++;
}

for (const f of cadastre.features) scan(f.geometry);

console.log(
  JSON.stringify(
    {
      pageW,
      pageH,
      vertices_scanned: n,
      projected_extent_fraction: { fx0: minFx, fy0: minFy, fx1: maxFx, fy1: maxFy },
      seed_gcp_fx_range: [Math.min(...seed.gcps.map((g: any) => g.fx)), Math.max(...seed.gcps.map((g: any) => g.fx))],
      seed_gcp_fy_range: [Math.min(...seed.gcps.map((g: any) => g.fy)), Math.max(...seed.gcps.map((g: any) => g.fy))],
    },
    null,
    2,
  ),
);
