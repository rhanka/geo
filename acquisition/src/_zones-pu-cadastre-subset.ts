/**
 * _zones-pu-cadastre-subset.ts — lève le mur §6.5 « emprise » sur les feuillets
 * « PÉRIMÈTRE URBAIN ».
 *
 * LE PROBLÈME. Une famille entière de plans de zonage québécois est publiée en
 * DEUX feuillets : « Général / Secteur rural » (tout le territoire) et
 * « Périmètre urbain / Secteur villageois » (le noyau seul, à une autre échelle).
 * Le feuillet rural ne PORTE PAS les étiquettes du village — il les remplace par
 * un aplat gris et un renvoi « voir feuillet 2 ». Servir le feuillet rural seul
 * fait donc avaler le village par la zone agricole voisine : mesuré à upton
 * (zone 510 = 134 lots/km² contre ~18 de médiane) et à saint-valerien-de-milton
 * (A-103 à 93 lots/km² contre ~10). C'est une erreur CATÉGORIELLE, refusée.
 *
 * Or le feuillet urbain ne se recale pas : `t3-chamfer-seed` ajuste le cadastre
 * de TOUTE la municipalité sur l'encre du plan, et cette feuille n'en dessine
 * qu'une fraction — le fit part au décor (mesuré : upton PU sort à rot 85,5° /
 * ratio 0,43, saint-alexandre PU idem). C'est la limite d'emprise du §6.5.
 *
 * CE QUE FAIT CE SCRIPT. Il fabrique le modèle chamfer manquant : le cadastre
 * BORNÉ au périmètre d'urbanisation. La borne n'est pas devinée — elle est
 * PROJETÉE depuis le feuillet RURAL déjà recalé : on lit à l'oeil le rectangle
 * (fractions de page) qui contient le liseré rouge du périmètre sur ce feuillet,
 * et l'affine 47-GCP (ou 19, 23…) déjà validé le convertit en bbox WGS84.
 *
 * Rien n'est inventé : la sortie est un SOUS-ENSEMBLE strict des lots réels du
 * cadastre, jamais une géométrie synthétisée. Les gates aval sont INCHANGÉS —
 * T3 doit toujours re-dériver des contrôles indépendants patch-vérifiés, et la
 * couverture-lots arbitre le dépôt (spec §8).
 *
 * $0 : pur TS, aucun appel modèle.
 *
 * Usage :
 *   npx tsx acquisition/src/_zones-pu-cadastre-subset.ts \
 *     --gcp work/gcp/<slug>.<tag>-t3.gcp.json \
 *     --frac fx0,fy0,fx1,fy1 \
 *     --cadastre work/cadastre/<slug>.geojson \
 *     --out work/cadastre/<slug>-pu.geojson [--pad-m 300]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import type { Feature, FeatureCollection, Position } from "geojson";

import { buildGeoRefFromGcps, type GcpFile } from "./lib/t2-georef.js";

function opt(n: string): string | undefined {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const gcpPath = opt("gcp");
const fracRaw = opt("frac");
const cadPath = opt("cadastre");
const outPath = opt("out");
const padM = Number(opt("pad-m") ?? "300");
if (!gcpPath || !fracRaw || !cadPath || !outPath) {
  throw new Error("required: --gcp <f.gcp.json> --frac fx0,fy0,fx1,fy1 --cadastre <in.geojson> --out <out.geojson>");
}
for (const p of [gcpPath, cadPath]) if (!existsSync(p)) throw new Error(`introuvable: ${p}`);

const frac = fracRaw.split(",").map(Number);
if (frac.length !== 4 || frac.some((n) => !Number.isFinite(n) || n < 0 || n > 1)) {
  throw new Error(`--frac doit être fx0,fy0,fx1,fy1 dans [0,1] — reçu ${fracRaw}`);
}
const [fx0, fy0, fx1, fy1] = frac as [number, number, number, number];

const gcpFile = JSON.parse(readFileSync(gcpPath, "utf8")) as GcpFile;
const pageW = Number(gcpFile.pageW);
const pageH = Number(gcpFile.pageH);
if (!(pageW > 0) || !(pageH > 0)) throw new Error(`le GcpFile ne porte pas pageW/pageH: ${gcpPath}`);
const { geo, maxResidualM } = buildGeoRefFromGcps(gcpFile.gcps, pageW, pageH, gcpFile.neatline);

// Les 4 coins du rectangle de page → WGS84 (fy est top-down, pageToLonLat est
// en espace utilisateur PDF, origine en bas à gauche).
const corners: Array<[number, number]> = [
  [fx0 * pageW, (1 - fy0) * pageH],
  [fx1 * pageW, (1 - fy0) * pageH],
  [fx1 * pageW, (1 - fy1) * pageH],
  [fx0 * pageW, (1 - fy1) * pageH],
];
const ll = corners.map(([x, y]) => geo.pageToLonLat(x, y));
let lon0 = Math.min(...ll.map((p) => p[0]));
let lon1 = Math.max(...ll.map((p) => p[0]));
let lat0 = Math.min(...ll.map((p) => p[1]));
let lat1 = Math.max(...ll.map((p) => p[1]));

const midLat = (lat0 + lat1) / 2;
const dLat = padM / 111320;
const dLon = padM / (111320 * Math.cos((midLat * Math.PI) / 180));
lon0 -= dLon;
lon1 += dLon;
lat0 -= dLat;
lat1 += dLat;

function centroid(f: Feature): [number, number] | null {
  const g = f.geometry;
  if (!g || g.type === "GeometryCollection") return null;
  let sx = 0;
  let sy = 0;
  let n = 0;
  const walk = (c: unknown): void => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === "number" && typeof c[1] === "number") {
      sx += c[0] as number;
      sy += c[1] as number;
      n++;
      return;
    }
    for (const x of c) walk(x);
  };
  walk((g as { coordinates: Position[] }).coordinates);
  return n ? [sx / n, sy / n] : null;
}

const fc = JSON.parse(readFileSync(cadPath, "utf8")) as FeatureCollection;
const kept = (fc.features ?? []).filter((f) => {
  const c = centroid(f);
  return !!c && c[0] >= lon0 && c[0] <= lon1 && c[1] >= lat0 && c[1] <= lat1;
});

console.log(`[pu-subset] gcp=${gcpPath} (${gcpFile.gcps.length} GCP, résidu max ${maxResidualM.toFixed(2)} m)`);
console.log(`[pu-subset] page ${pageW}x${pageH} pt · frac [${fx0}, ${fy0}, ${fx1}, ${fy1}] · pad ${padM} m`);
console.log(`[pu-subset] bbox projetée = ${lon0.toFixed(6)},${lat0.toFixed(6)},${lon1.toFixed(6)},${lat1.toFixed(6)}`);
console.log(`[pu-subset] cadastre: ${fc.features?.length ?? 0} lots → ${kept.length} retenus (${((100 * kept.length) / Math.max(1, fc.features?.length ?? 1)).toFixed(1)} %)`);
if (kept.length < 20) {
  throw new Error(`ABORT: seulement ${kept.length} lots dans l'emprise — le rectangle --frac est probablement faux (ne pas servir un modèle vide)`);
}
writeFileSync(outPath, JSON.stringify({ type: "FeatureCollection", features: kept }));
console.log(`[pu-subset] écrit ${outPath}`);
