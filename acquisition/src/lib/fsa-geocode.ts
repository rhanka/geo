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
 * RTA (3 caractères) contenant le point (lon,lat), ou `null` si aucune. Le
 * pré-filtre grille+bbox restreint les tests exacts à quelques candidats.
 */
export function lookupFsa(index: FsaIndex, lon: number, lat: number): string | null {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const candidates = index.grid.get(cellKey(Math.floor(lon / CELL), Math.floor(lat / CELL)));
  if (!candidates) return null;
  for (const i of candidates) {
    const e = index.entries[i]!;
    const [minX, minY, maxX, maxY] = e.bbox;
    if (lon < minX || lon > maxX || lat < minY || lat > maxY) continue;
    if (booleanPointInPolygon([lon, lat], e.geom)) return e.code;
  }
  return null;
}
