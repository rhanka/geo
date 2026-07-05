/**
 * fsa-geocode.ts — Géocodage inverse RTA/FSA (code postal partiel) en BULK.
 *
 * Source : Fichier des limites des régions de tri d'acheminement (RTA / Forward
 * Sortation Area, FSA), Recensement 2021 de Statistique Canada — la RTA est
 * formée des **3 premiers caractères du code postal** (ex. « J4P »). Le code
 * postal complet (6 caractères) est la propriété de Postes Canada et n'existe
 * dans AUCUNE source ouverte joignable en bulk ; la RTA est donc le plafond
 * ouvert honnête pour le Québec. Les polygones RTA sont stagés en S3 par
 * `fsa-boundaries-prep.ts` sous {@link FSA_KEY} (WGS84, ~414 RTA du Québec).
 *
 * Le géocodage est un simple **point-in-polygon** du centroïde du lot dans la
 * RTA qui le contient (jointure spatiale BULK, aucun appel API par-lot). Un
 * index par cellule (grille 0.25°) filtre les candidats avant le test exact
 * `booleanPointInPolygon`, pour rester rapide sur les gros cadastres.
 *
 * Anti-invention : renvoie la vraie RTA de la source, ou `null` si le centroïde
 * ne tombe dans aucune RTA (jamais de valeur fabriquée).
 */
import type { S3Client } from "@aws-sdk/client-s3";
import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from "geojson";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";

import { getJson } from "./s3.js";

/** Clé S3 des polygones RTA/FSA du Québec (déposée par fsa-boundaries-prep.ts). */
export const FSA_KEY = "normalized/qc-admin-boundaries/qc-fsa.geojson";

/** Taille de cellule (degrés) de la grille de pré-filtrage spatial. */
const CELL = 0.25;

/**
 * Tolérance de raccrochage (km) pour un centroïde tombé HORS de toute RTA. Les
 * limites RTA de StatCan sont simplifiées côté serveur (~11 m) et partitionnent
 * le Québec ; un centroïde qui n'atterrit dans aucun polygone est presque
 * toujours à quelques mètres d'une limite (éclat de simplification) ou sur un
 * lot en bordure. On raccroche alors à la RTA la plus proche SI elle est à
 * ≤ SNAP_TOL_KM ; au-delà, le point est réellement hors de la couverture RTA du
 * Québec (eau, hors-province) → null (jamais fabriqué). 2 km couvre les éclats
 * de simplification sans jamais attribuer une RTA à un point franchement hors zone.
 */
const SNAP_TOL_KM = 2;
/** Degrés → km (approx. sphérique, latitude ~46-49° du Québec méridional). */
const KM_PER_DEG = 111.32;

type FsaGeom = Polygon | MultiPolygon;

interface FsaEntry {
  code: string; // CFSAUID (3 caractères, ex. "J4P")
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  geom: FsaGeom;
}

export interface FsaIndex {
  entries: FsaEntry[];
  /** cellKey -> indices d'entries dont le bbox recouvre la cellule. */
  grid: Map<string, number[]>;
  count: number;
}

function bboxOf(geom: FsaGeom): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const scan = (ring: Position[]): void => {
    for (const p of ring) {
      const x = p[0]!;
      const y = p[1]!;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  };
  if (geom.type === "Polygon") for (const r of geom.coordinates) scan(r);
  else for (const poly of geom.coordinates) for (const r of poly) scan(r);
  return [minX, minY, maxX, maxY];
}

const cellKey = (cx: number, cy: number): string => `${cx}:${cy}`;

/** Charge les polygones RTA depuis S3 et construit l'index (bbox + grille). */
export async function loadFsaIndex(s3: S3Client, key: string = FSA_KEY): Promise<FsaIndex> {
  const fc = await getJson<FeatureCollection>(s3, key);
  const entries: FsaEntry[] = [];
  const grid = new Map<string, number[]>();
  for (const f of (fc.features ?? []) as Feature[]) {
    const code = String(f.properties?.["CFSAUID"] ?? "").trim();
    const geom = f.geometry;
    if (!code || !geom || (geom.type !== "Polygon" && geom.type !== "MultiPolygon")) continue;
    const idx = entries.length;
    const bbox = bboxOf(geom as FsaGeom);
    entries.push({ code, bbox, geom: geom as FsaGeom });
    const [minX, minY, maxX, maxY] = bbox;
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
      for (let cy = Math.floor(minY / CELL); cy <= Math.floor(maxY / CELL); cy++) {
        const k = cellKey(cx, cy);
        const arr = grid.get(k);
        if (arr) arr.push(idx);
        else grid.set(k, [idx]);
      }
    }
  }
  return { entries, grid, count: entries.length };
}

/**
 * RTA (3 caractères) contenant le point (lon,lat), ou `null` si aucune n'est
 * atteignable. Deux passes :
 *   1. point-in-polygon exact (pré-filtre grille+bbox → quelques candidats) ;
 *   2. si le point tombe HORS de toute RTA, raccrochage à la RTA la plus proche
 *      si elle est à ≤ SNAP_TOL_KM (éclat de simplification / lot en bordure) ;
 *      sinon `null` (réellement hors couverture — jamais fabriqué).
 */
export function lookupFsa(index: FsaIndex, lon: number, lat: number): string | null {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const own = index.grid.get(cellKey(Math.floor(lon / CELL), Math.floor(lat / CELL)));
  if (own) {
    for (const i of own) {
      const e = index.entries[i]!;
      const [minX, minY, maxX, maxY] = e.bbox;
      if (lon < minX || lon > maxX || lat < minY || lat > maxY) continue;
      if (booleanPointInPolygon([lon, lat], e.geom)) return e.code;
    }
  }
  return nearestFsaWithin(index, lon, lat, SNAP_TOL_KM);
}

/** Candidats du voisinage 3×3 cellules autour du point (pour un point hors
 *  polygone, dont la cellule propre peut n'indexer aucune RTA). */
function neighborhood(index: FsaIndex, lon: number, lat: number): number[] {
  const cx = Math.floor(lon / CELL);
  const cy = Math.floor(lat / CELL);
  const seen = new Set<number>();
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const arr = index.grid.get(cellKey(cx + dx, cy + dy));
      if (arr) for (const i of arr) seen.add(i);
    }
  }
  return [...seen];
}

/** Distance (km) point→segment dans un plan équirectangulaire local (x mis à
 *  l'échelle par cos(lat)), suffisant à l'échelle du km. */
function segDistKm(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + t * dx;
  const qy = ay + t * dy;
  return Math.hypot(px - qx, py - qy) * KM_PER_DEG;
}

/** Distance (km) point→frontière d'un (multi)polygone (0 si le point est sur le
 *  bord ; le point est supposé extérieur ici). */
function pointToPolygonKm(lon: number, lat: number, geom: FsaGeom, coslat: number): number {
  const px = lon * coslat;
  const py = lat;
  let best = Infinity;
  const scan = (ring: Position[]): void => {
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i]!;
      const b = ring[i + 1]!;
      const d = segDistKm(px, py, a[0]! * coslat, a[1]!, b[0]! * coslat, b[1]!);
      if (d < best) best = d;
    }
  };
  if (geom.type === "Polygon") for (const r of geom.coordinates) scan(r);
  else for (const poly of geom.coordinates) for (const r of poly) scan(r);
  return best;
}

/** Distance (km) point→rectangle bbox (0 si dedans) — pré-filtre bon marché. */
function bboxDistKm(lon: number, lat: number, bbox: [number, number, number, number], coslat: number): number {
  const [minX, minY, maxX, maxY] = bbox;
  const ddx = lon < minX ? minX - lon : lon > maxX ? lon - maxX : 0;
  const ddy = lat < minY ? minY - lat : lat > maxY ? lat - maxY : 0;
  return Math.hypot(ddx * coslat, ddy) * KM_PER_DEG;
}

/** RTA la plus proche du point dans le voisinage, si ≤ tolKm ; sinon null. */
function nearestFsaWithin(index: FsaIndex, lon: number, lat: number, tolKm: number): string | null {
  const coslat = Math.cos((lat * Math.PI) / 180);
  let bestCode: string | null = null;
  let bestKm = Infinity;
  for (const i of neighborhood(index, lon, lat)) {
    const e = index.entries[i]!;
    if (bboxDistKm(lon, lat, e.bbox, coslat) > Math.min(tolKm, bestKm)) continue;
    const km = pointToPolygonKm(lon, lat, e.geom, coslat);
    if (km < bestKm) {
      bestKm = km;
      bestCode = e.code;
    }
  }
  return bestKm <= tolKm ? bestCode : null;
}
