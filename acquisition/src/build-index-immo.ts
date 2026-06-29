/**
 * build-index-immo.ts — INDEX ZERO-COPIE IMMO (geo province QC).
 *
 * Port fidèle de `acquisition/build_index_immo.py`. Federation-first : l'index
 * NE copie PAS la géométrie ; il référence feature_id (geoId) + no_lot, ajoute
 * code_zone (point-in-polygon centroïde sur grille zonage) + attrs bâtiment
 * (jointure rôle foncier par no_lot normalisé).
 *
 * Ce module exporte les fonctions de join réutilisées par
 * `cadastre-index-province.ts` (buildCity / writeIndexParquet / buildZoneIndex),
 * comme le .py réutilise `build_index_immo as core`.
 *
 * ANTI-INVENTION : code_zone=null si pas de grille OU centroïde hors polygone ;
 * attrs bâtiment=null si pas de match rôle. Jamais deviner.
 */
import type { S3Client } from "@aws-sdk/client-s3";
import type { Feature, Geometry, Polygon, MultiPolygon, Position } from "geojson";

import { BUCKET as DEFAULT_BUCKET, exists, getBytes, getJson } from "./lib/s3.js";
import { representativePoint, strictPointInPolygon } from "./lib/geo.js";
import { readParquetRowsFromBuffer } from "./lib/parquet-read.js";
import { writeIndexImmoParquet, INDEX_IMMO_COLUMNS, type IndexImmoRow } from "./lib/parquet.js";

export const BUCKET = DEFAULT_BUCKET;
export const REGISTRY = "/home/antoinefa/src/_acquisition-shared/acquisition-registry.json";
export const GRIDS_MAP = "/home/antoinefa/src/_acquisition-shared/grids-slug-map.json";
export const SNAPSHOT = "2026-06-21";
export const SOURCE = "geo:cadastre-clip⋈role⋈zonage";

/** Colonnes bâtiment issues du rôle (jointure par no_lot normalisé). */
export const ROLE_COLS = [
  "role_usage_cubf",
  "role_nb_etages_max",
  "role_annee_construction",
  "role_superficie_batiment_m2",
  "role_nb_logements",
  "role_valeur_immeuble",
] as const;

/** Schéma de sortie (ordre + types pour le manifest), miroir de OUT_SCHEMA. */
export const OUT_SCHEMA: [string, string][] = [
  ["feature_id", "string"],
  ["no_lot", "string"],
  ["code_zone", "string"],
  ["role_usage_cubf", "string"],
  ["role_nb_etages_max", "double"],
  ["role_annee_construction", "double"],
  ["role_superficie_batiment_m2", "double"],
  ["role_nb_logements", "double"],
  ["role_valeur_immeuble", "double"],
  ["_source", "string"],
  ["_snapshot", "string"],
];

type GeoFeature = Feature<Geometry, Record<string, unknown> | null>;
type FeatureCollection = { features?: GeoFeature[] };

export interface ZoneIndex {
  polys: (Polygon | MultiPolygon)[];
  codes: string[];
  n: number;
}

/**
 * Charge la grille zonage -> { polys, codes }. Ne garde que les polygones avec
 * un zone_code non-null (anti-invention). Retourne null si absente/vide.
 */
export async function buildZoneIndex(
  s3: S3Client,
  gridSlug: string,
): Promise<ZoneIndex | null> {
  const key = `normalized/ca-qc-zonage/${gridSlug}.geojson`;
  if (!(await exists(s3, key))) return null;
  const gj = (await getJson(s3, key)) as FeatureCollection;
  const polys: (Polygon | MultiPolygon)[] = [];
  const codes: string[] = [];
  for (const f of gj.features ?? []) {
    const zc = (f.properties ?? {})["zone_code"];
    const g = f.geometry;
    if (zc === null || zc === undefined || zc === "" || !g) continue;
    if (g.type !== "Polygon" && g.type !== "MultiPolygon") continue;
    polys.push(g as Polygon | MultiPolygon);
    codes.push(String(zc));
  }
  if (polys.length === 0) return null;
  return { polys, codes, n: polys.length };
}

/**
 * Charge le parquet rôle -> { lookup: {no_lot_normalisé: {role_col: val}}, n }.
 * Retourne lookup vide si absent / dégénéré (pas de NO_LOT).
 */
export async function buildRoleLookup(
  s3: S3Client,
  slug: string,
): Promise<{ lookup: Map<string, Record<string, unknown>>; roleRows: number }> {
  const key = `registry/role-foncier/${slug}.parquet`;
  if (!(await exists(s3, key))) return { lookup: new Map(), roleRows: 0 };
  const buf = await getBytes(s3, key);
  const rows = await readParquetRowsFromBuffer(buf);
  if (rows.length === 0 || !("NO_LOT" in (rows[0] ?? {}))) {
    return { lookup: new Map(), roleRows: 0 };
  }
  const cols = ROLE_COLS.filter((c) => c in (rows[0] ?? {}));
  const lookup = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    const k = String(r["NO_LOT"] ?? "").replace(/ /g, "");
    if (lookup.has(k)) continue; // première occurrence gagne
    const rec: Record<string, unknown> = {};
    for (const c of cols) rec[c] = r[c];
    lookup.set(k, rec);
  }
  return { lookup, roleRows: rows.length };
}

/** code_zone du 1er polygone contenant pt (strict), sinon null. */
export function codeZoneForPoint(zidx: ZoneIndex | null, pt: Position): string | null {
  if (!zidx) return null;
  for (let i = 0; i < zidx.polys.length; i++) {
    if (strictPointInPolygon(pt, zidx.polys[i]!)) return zidx.codes[i]!;
  }
  return null;
}

export interface CityStats {
  lots: number;
  with_code_zone: number;
  with_building_attrs: number;
  join_matched: number;
  code_zone_pct: number;
  building_pct: number;
  join_pct: number;
  has_grid: boolean;
  grid_slug: string | null;
  zone_polys: number;
  role_rows: number;
  error?: string;
}

const isNa = (v: unknown): boolean =>
  v === null || v === undefined || (typeof v === "number" && Number.isNaN(v));

/** Construit les lignes d'index pour une ville. */
export async function buildCity(
  s3: S3Client,
  slug: string,
  gridSlug: string | null,
): Promise<{ rows: IndexImmoRow[] | null; stats: Partial<CityStats> }> {
  const cadKey = `normalized/qc-cadastre-lots/${slug}.geojson`;
  if (!(await exists(s3, cadKey))) return { rows: null, stats: { error: "cadastre absent" } };
  const cad = (await getJson(s3, cadKey)) as FeatureCollection;

  const zidx = gridSlug ? await buildZoneIndex(s3, gridSlug) : null;
  const { lookup, roleRows } = await buildRoleLookup(s3, slug);

  const rows: IndexImmoRow[] = [];
  let withZone = 0;
  let withAttrs = 0;
  let joinMatched = 0;
  for (const f of cad.features ?? []) {
    const p = f.properties ?? {};
    const g = f.geometry;
    const featureId = p["geoId"] ?? null;
    const noLot = p["NO_LOT"] ?? null;

    let codeZone: string | null = null;
    if (g) {
      const pt = representativePoint(g);
      if (pt) codeZone = codeZoneForPoint(zidx, pt);
    }
    if (codeZone !== null) withZone++;

    const k = noLot !== null && noLot !== undefined ? String(noLot).replace(/ /g, "") : null;
    const rec = k !== null ? lookup.get(k) : undefined;

    const row: Record<string, unknown> = {
      feature_id: featureId,
      no_lot: noLot,
      code_zone: codeZone,
      _source: SOURCE,
      _snapshot: SNAPSHOT,
    };
    if (rec) {
      joinMatched++;
      let anyAttr = false;
      for (const c of ROLE_COLS) {
        const v = rec[c];
        if (!isNa(v)) {
          row[c] = v;
          anyAttr = true;
        } else row[c] = null;
      }
      if (anyAttr) withAttrs++;
    } else {
      for (const c of ROLE_COLS) row[c] = null;
    }
    rows.push(row as IndexImmoRow);
  }

  const n = rows.length;
  const stats: CityStats = {
    lots: n,
    with_code_zone: withZone,
    with_building_attrs: withAttrs,
    join_matched: joinMatched,
    code_zone_pct: n ? round2((100 * withZone) / n) : 0,
    building_pct: n ? round2((100 * withAttrs) / n) : 0,
    join_pct: n ? round2((100 * joinMatched) / n) : 0,
    has_grid: !!zidx,
    grid_slug: gridSlug,
    zone_polys: zidx ? zidx.n : 0,
    role_rows: roleRows,
  };
  return { rows, stats };
}

/**
 * Écrit les lignes en parquet (schéma index-immo fixe). role_usage_cubf est
 * normalisé en string (int -> "1000"), comme le .py.
 */
export async function writeParquet(rows: IndexImmoRow[], path: string): Promise<number> {
  const out: IndexImmoRow[] = rows.map((r) => {
    const o: Record<string, unknown> = {};
    for (const c of INDEX_IMMO_COLUMNS) o[c] = r[c];
    const cubf = o["role_usage_cubf"];
    if (isNa(cubf)) o["role_usage_cubf"] = null;
    else if (typeof cubf === "number")
      o["role_usage_cubf"] = Number.isInteger(cubf) ? String(cubf) : String(cubf);
    else o["role_usage_cubf"] = String(cubf);
    return o as IndexImmoRow;
  });
  return writeIndexImmoParquet(out, path);
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
