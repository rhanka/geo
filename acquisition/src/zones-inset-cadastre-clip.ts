/**
 * Découper le cadastre d'une muni sur l'EMPRISE D'UN ENCART, pour rendre le chamfer
 * (§6.5) applicable à un « agrandissement du périmètre urbain ».
 *
 * ── Le problème ────────────────────────────────────────────────────────────────
 * `t3-chamfer-seed` apparie le cadastre de TOUTE la muni à l'encre d'une feuille.
 * Sur un ENCART qui ne montre que le noyau villageois, le modèle complet ne peut PAS
 * converger : à l'échelle vraie, l'essentiel du modèle tombe HORS du cadre et sature à
 * `truncM`. C'est la « limite d'emprise » explicitement laissée ouverte au §6.5.
 * Mesuré sur sainte-christine : `fit_to_frame_px_per_m` de l'encart = 0,1041 alors que
 * l'échelle IMPRIMÉE (1:6 000 @150 dpi) vaut 0,9843 px/m ⇒ ratio vrai ≈ 9,45, très
 * au-delà de toute bande d'échelle saine.
 *
 * ── Ce que fait ce script ──────────────────────────────────────────────────────
 * L'emprise de l'encart est DESSINÉE sur la carte principale (le cartouche « Voir
 * agrandissement 1:N »), et la carte principale, elle, est déjà calée. On projette donc
 * ce rectangle-page par le géoréf de la carte principale (`--gcp`), et on ne garde du
 * cadastre que les lots qui intersectent la bbox obtenue (+ une marge). Le modèle rendu
 * au chamfer a alors la MÊME emprise que l'encart, et le ratio d'échelle redevient sain.
 *
 * Anti-invention : on ne fabrique aucune géométrie — on FILTRE des lots cadastraux réels.
 * Le découpage ne sert qu'à borner le MODÈLE de recalage ; la preuve reste en aval
 * (GCP indépendants patch-vérifiés, puis couverture-lots, §8).
 *
 * Usage :
 *   npx tsx acquisition/src/zones-inset-cadastre-clip.ts \
 *     --cadastre work/gcp/<slug>.cadastre.geojson \
 *     --gcp work/gcp/<slug>-t3.gcp.json \
 *     --inset-frac fx0,fy0,fx1,fy1 \
 *     --out work/gcp/<slug>-inset.cadastre.geojson [--margin-m 400] [--mode bbox|centroid]
 *
 * `--inset-frac` = le rectangle de l'encart tel qu'il est dessiné SUR LA CARTE
 * PRINCIPALE, en fractions de page (x→droite, y→bas).
 *
 * ── `--mode` (défaut `bbox`) ───────────────────────────────────────────────────
 * `bbox` retient tout lot dont la bbox TOUCHE l'emprise. Mesuré sur belcourt : en
 * cadastre PRIMITIF (lots de rang en lanières de ~7 km), ce critère ramène des lots
 * dont l'étendue déborde très au-delà de l'encart — la bbox du modèle retenu faisait
 * 7,3 km pour un encart de 2,0 km, et le chamfer saturait (`mean_dist` 155 m, 48 %
 * d'inliers). `centroid` ne retient que les lots dont le CENTROÏDE tombe dans
 * l'emprise : c'est la mesure qui répond à « combien de lots le feuillet urbain
 * est-il seul à étiqueter ? », donc au gate « village avalé ».
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { Feature, FeatureCollection } from "geojson";

import { buildGeoRefFromGcpsCrs, type GcpFile } from "./lib/t2-georef.js";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const cadastrePath = arg("cadastre");
const gcpPath = arg("gcp");
const insetRaw = arg("inset-frac");
const outPath = arg("out");
const marginM = Number(arg("margin-m", "400"));
const mode = String(arg("mode", "bbox"));
if (mode !== "bbox" && mode !== "centroid") throw new Error("--mode must be bbox|centroid");
if (!cadastrePath || !gcpPath || !insetRaw || !outPath) {
  throw new Error("required: --cadastre <f.geojson> --gcp <f.gcp.json> --inset-frac fx0,fy0,fx1,fy1 --out <f.geojson>");
}
const f = insetRaw.split(",").map(Number);
if (f.length !== 4 || !f.every(Number.isFinite)) throw new Error("--inset-frac must be fx0,fy0,fx1,fy1");
const [fx0, fy0, fx1, fy1] = f as [number, number, number, number];

const gcpFile = JSON.parse(readFileSync(gcpPath, "utf8")) as GcpFile;
const pageW = gcpFile.pageW!;
const pageH = gcpFile.pageH!;
if (!(pageW > 0) || !(pageH > 0)) throw new Error("gcp file must carry pageW/pageH");
const cal = buildGeoRefFromGcpsCrs(gcpFile.gcps, pageW, pageH, gcpFile.crs, gcpFile.neatline);
const geo = cal.geo;

/** Les 4 coins du rectangle de l'encart, projetés par le géoréf de la carte principale. */
const corners: Array<[number, number]> = [
  [fx0, fy0],
  [fx1, fy0],
  [fx0, fy1],
  [fx1, fy1],
];
// `topLeftToLonLat` prend un y DESCENDANT (convention pdftotext), exactement comme les
// fractions de page qu'on lit à l'écran ; `pageToLonLat` attend l'espace PDF y-montant.
const lonlat = corners.map(([fx, fy]) => geo.topLeftToLonLat(fx * pageW, fy * pageH));
const lons = lonlat.map((p) => p[0]);
const lats = lonlat.map((p) => p[1]);
const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
const dLat = marginM / 111_320;
const dLon = marginM / (111_320 * Math.cos((lat0 * Math.PI) / 180));
const bbox: [number, number, number, number] = [
  Math.min(...lons) - dLon,
  Math.min(...lats) - dLat,
  Math.max(...lons) + dLon,
  Math.max(...lats) + dLat,
];
console.error(
  `[inset-clip] emprise encart projetee : [${bbox.map((v) => v.toFixed(5)).join(", ")}] (marge ${marginM} m)`,
);

function featureBbox(feat: Feature): [number, number, number, number] | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const walk = (coords: unknown): void => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      const x = coords[0] as number;
      const y = coords[1] as number;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      return;
    }
    for (const c of coords) walk(c);
  };
  walk((feat.geometry as any)?.coordinates);
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null;
}

const cadastre = JSON.parse(readFileSync(cadastrePath, "utf8")) as FeatureCollection;
const kept = cadastre.features.filter((feat) => {
  const b = featureBbox(feat);
  if (!b) return false;
  if (mode === "centroid") {
    // centre de la bbox du lot — suffisant pour trancher « dedans / dehors »
    const cx = (b[0] + b[2]) / 2;
    const cy = (b[1] + b[3]) / 2;
    return cx >= bbox[0] && cx <= bbox[2] && cy >= bbox[1] && cy <= bbox[3];
  }
  // intersection de bbox : le lot touche l'emprise de l'encart
  return b[0] <= bbox[2] && b[2] >= bbox[0] && b[1] <= bbox[3] && b[3] >= bbox[1];
});

const out: FeatureCollection = { type: "FeatureCollection", features: kept };
writeFileSync(outPath, JSON.stringify(out));
console.log(
  JSON.stringify(
    {
      cadastre: cadastrePath,
      gcp: gcpPath,
      mode,
      inset_frac: [fx0, fy0, fx1, fy1],
      bbox_wgs84: bbox,
      lots_total: cadastre.features.length,
      lots_kept: kept.length,
      out: outPath,
    },
    null,
    2,
  ),
);
