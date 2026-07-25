/**
 * Énumère les CADRES géoréférencés (`/VP` viewports) d'un plan PDF.
 *
 * Motif (mesuré sur saint-alphonse-rodriguez, 2026-07-18) : un plan ArcGIS Pro peut
 * porter PLUSIEURS cadres géoréférencés sur UNE MÊME PAGE — typiquement la carte
 * municipale + un ENCART « périmètre d'urbanisation » (le noyau villageois, agrandi).
 * `extractGeoRef` ne retient QUE le cadre de plus grande aire-page (la carte
 * principale), ce qui est le bon défaut — mais les labels de l'encart tombent alors
 * « hors cadre » et sont rejetés.
 *
 * Pourquoi ça compte : la géométrie servie est un VORONOÏ des labels lus. Si le noyau
 * villageois n'est étiqueté QUE dans l'encart, ses lots — les plus denses de la muni —
 * partent SILENCIEUSEMENT aux zones rurales voisines. Le build affiche alors
 * « 100 % des lots assignés » : le chiffre rassure et le zonage est faux.
 *
 * Cette sonde répond, à $0 et AVANT tout dépôt : combien de cadres, quelle emprise
 * page, quelle emprise géographique, et donc — un second cadre est-il recalable ?
 *
 * N'invente rien : ne lit que ce que le PDF déclare. Aucun dépôt.
 *
 * Usage : npx tsx acquisition/src/_geopdf-viewports.ts --pdf <plan.pdf>
 */
import { readFileSync } from "node:fs";

import { inflatePdfText, viewportGeoRefs, wktToProj4 } from "./lib/t1-georef.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const pdf = arg("pdf");
if (!pdf) {
  console.error("usage: --pdf <plan.pdf>");
  process.exit(2);
}

const hay = inflatePdfText(readFileSync(pdf));
const vps = viewportGeoRefs(hay);

console.log(`pdf=${pdf}`);
console.log(`cadres /VP porteurs d'un géoréf GEO : ${vps.length}`);

if (!vps.length) {
  console.log("  aucun — plan non géoréférencé (voie T2/T3)");
  process.exit(0);
}

const rows = vps.map((v) => {
  const [x0, y0, x1, y1] = v.bbox as [number, number, number, number];
  const pageAreaPt2 = Math.abs((x1 - x0) * (y1 - y0));
  const lats: number[] = [];
  const lons: number[] = [];
  for (let i = 0; i + 1 < v.gpts.length; i += 2) {
    lats.push(v.gpts[i]!);
    lons.push(v.gpts[i + 1]!);
  }
  const spanLat = lats.length ? Math.max(...lats) - Math.min(...lats) : 0;
  const spanLon = lons.length ? Math.max(...lons) - Math.min(...lons) : 0;
  return {
    bbox: [x0, y0, x1, y1].map((n) => Math.round(n)),
    pageAreaPt2,
    spanLat,
    spanLon,
    centreLat: lats.length ? (Math.max(...lats) + Math.min(...lats)) / 2 : NaN,
    centreLon: lons.length ? (Math.max(...lons) + Math.min(...lons)) / 2 : NaN,
    crs: wktToProj4(v.wkt)?.name ?? "(WKT non reconnu)",
  };
});
rows.sort((a, b) => b.pageAreaPt2 - a.pageAreaPt2);

rows.forEach((r, i) => {
  const role = i === 0 ? "PRINCIPAL (retenu par extractGeoRef)" : "SECONDAIRE (labels rejetés hors-cadre)";
  console.log(`\n  [${i}] ${role}`);
  console.log(`      bbox page (pt)   : [${r.bbox.join(", ")}]  aire=${Math.round(r.pageAreaPt2)} pt²`);
  console.log(`      emprise géo      : Δlat=${r.spanLat.toFixed(4)}° Δlon=${r.spanLon.toFixed(4)}°`);
  console.log(`      centre           : ${r.centreLat.toFixed(5)}, ${r.centreLon.toFixed(5)}`);
  console.log(`      CRS              : ${r.crs}`);
});

if (rows.length > 1) {
  console.log(
    `\n⚠️  ${rows.length - 1} cadre(s) secondaire(s) géoréférencé(s) : leurs labels sont REJETÉS par` +
      ` t1-build. Vérifier qu'ils n'étiquettent pas des zones absentes du cadre principal` +
      ` (sinon les lots concernés partent au voisin — Voronoï silencieux).`,
  );
}
