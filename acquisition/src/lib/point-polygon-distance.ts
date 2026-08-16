/**
 * point-polygon-distance.ts — distance MÈTRES point→frontière-de-polygones sur
 * géométrie servie EPSG:4326 (lon/lat degrés).
 *
 * RAISON D'ÊTRE (audit col-2 cohérence lot-zone, SPEC_COL2_COHERENCE_AUDIT) :
 * la géométrie servie `qc-zonage`/`qc-lots` est en degrés WGS84 (vérifié
 * varennes/amherst — `col2-verify-crs-containment-20260808`). Un seuil de
 * tolérance métrique (T=10 m cohérent, 10–50 m mismatch, >50 m résidu) NE PEUT
 * PAS se mesurer en degrés euclidiens : 0,0001° vaut ~11 m en latitude mais
 * ~7,8 m en longitude au Québec (lat ~45,6°). On projette donc localement en
 * plan tangent ENU (mètres) ancré sur le POINT interrogé, avec les facteurs
 * d'échelle mètres/degré évalués à sa latitude, puis on calcule des distances
 * euclidiennes point→segment en mètres. Sur des distances < quelques centaines
 * de mètres l'erreur du plan tangent est très inférieure au mètre.
 *
 * Anti-invention : aucune réparation, aucune heuristique. Une entrée sans
 * segment exploitable renvoie `Infinity` (« pas de frontière mesurable ») — le
 * caller décide, on ne FABRIQUE pas une distance.
 */

import { projConstants } from "./t1-zones.js";

export type Ring = number[][]; // [[lon,lat], ...]
export type Poly = Ring[]; // [outer, ...holes]

/**
 * Mètres par degré de latitude/longitude à la latitude `latDeg`. DÉLÈGUE à
 * `projConstants` de ./t1-zones.js (mlon = 111320·cos(lat), mlat = 111320) —
 * SOURCE UNIQUE de la projection ENU locale. C'est la référence ratifiée de
 * SPEC_COL2_COHERENCE_AUDIT : le ground-truth de validation (sondes geo-jointures)
 * est calculé avec CETTE constante ; toute autre série (WGS84 courbure) décale de
 * ~0,16 % et fait basculer quelques lots aux seuils 10 m / 50 m → divergence à
 * l'entier. Ne PAS ré-inventer la constante ici.
 */
export function metersPerDegree(latDeg: number): { lat: number; lon: number } {
  const { mlon, mlat } = projConstants(latDeg);
  return { lat: mlat, lon: mlon };
}

/** Distance euclidienne (plan) du point (px,py) au segment [a,b]. */
function pointToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const qx = ax + t * dx;
  const qy = ay + t * dy;
  return Math.hypot(px - qx, py - qy);
}

/**
 * Distance MÈTRES du point `pt`=[lon,lat] à la FRONTIÈRE la plus proche de
 * `polys` (tout anneau : extérieur ET trous, de tout polygone). Projection ENU
 * locale ancrée sur `pt`. Ne teste PAS le containment : un point À L'INTÉRIEUR
 * d'un polygone renvoie sa distance au bord (>0) — c'est au caller de forcer 0
 * si le point est contenu (test point-in-polygon séparé). `Infinity` si aucun
 * segment exploitable.
 */
export function pointToPolygonsBoundaryMeters(pt: readonly [number, number], polys: readonly Poly[]): number {
  const [lon0, lat0] = pt;
  if (typeof lon0 !== "number" || typeof lat0 !== "number") return Infinity;
  const scale = metersPerDegree(lat0);
  // pt -> origine (0,0)
  let best = Infinity;
  for (const poly of polys) {
    for (const ring of poly) {
      const n = ring.length;
      if (n < 2) continue;
      // Projette chaque sommet en mètres relatifs à pt, à la volée.
      let prevX = (ring[0]![0]! - lon0) * scale.lon;
      let prevY = (ring[0]![1]! - lat0) * scale.lat;
      for (let i = 1; i < n; i++) {
        const cx = (ring[i]![0]! - lon0) * scale.lon;
        const cy = (ring[i]![1]! - lat0) * scale.lat;
        const d = pointToSegment(0, 0, prevX, prevY, cx, cy);
        if (d < best) best = d;
        prevX = cx;
        prevY = cy;
      }
    }
  }
  return best;
}
