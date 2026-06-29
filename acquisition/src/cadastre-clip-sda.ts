/**
 * cadastre-clip-sda.ts — Clip d'un cadastre sur-capturé à la frontière
 * municipale SDA (index local, 0 appel réseau/ville).
 *
 * Port fidèle de `acquisition/cadastre_clip_sda.py`. Résolution slug -> polygone
 * SDA par `norm()` (NFD sans accents, apostrophes supprimées), désambiguïsation
 * des homonymes par MRC dans le suffixe `--<mrc>` puis proximité spatiale, plus
 * un fallback index rôle MAMH (code géo). Clip par centroïde (representative
 * point + strict point-in-polygon), anti-invention (suppression seule).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type { Feature, Geometry, Polygon, MultiPolygon, Position } from "geojson";
import distance from "@turf/distance";
import { representativePoint, strictPointInPolygon } from "./lib/geo.js";

/**
 * Slug canonique : NFD sans accents (catégorie Mn retirée), minuscule,
 * apostrophes supprimées, tout non-alphanum -> tiret unique.
 * "Baie-D'Urfé" -> "baie-durfe". IDENTIQUE à `cadastre_clip_sda.norm`.
 */
export function norm(name: string): string {
  const nfd = (name ?? "").normalize("NFD");
  let a = nfd
    .replace(/\p{Mn}/gu, "") // strip combining accents (Unicode category Mn)
    .toLowerCase();
  a = a.replace(/['’`]/g, "");
  a = a.replace(/[^a-z0-9]+/g, "-");
  a = a.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  return a;
}

export const ALIAS_SLUG_TO_CODE: Record<string, string> = {
  "eeyou-istchee-james-bay": "99060",
  "hatley-township-municipality": "45043",
};

export interface SdaEntry {
  code: string;
  nom: string;
  mrc_norm: string;
  geom: Polygon | MultiPolygon;
}

type GeoJSONFeature = Feature<Geometry, Record<string, unknown>>;

/** Union de deux (multi)polygones en MultiPolygon (territoires nordiques). */
function unionPolys(
  a: Polygon | MultiPolygon,
  b: Polygon | MultiPolygon,
): MultiPolygon {
  const toParts = (g: Polygon | MultiPolygon): Position[][][] =>
    g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  return { type: "MultiPolygon", coordinates: [...toParts(a), ...toParts(b)] };
}

export class SDAIndex {
  byName: Map<string, SdaEntry[]> = new Map();
  byCode: Map<string, SdaEntry> = new Map();
  roleIndex: Map<string, [string, string]> = new Map();

  constructor(boundariesPath: string) {
    const g = JSON.parse(readFileSync(boundariesPath, "utf8")) as {
      features: GeoJSONFeature[];
    };
    for (const f of g.features) {
      const p = f.properties ?? {};
      const code = String(p["MUS_CO_GEO"] ?? p["code"] ?? "").trim();
      const nm = String(p["MUS_NM_MUN"] ?? p["name"] ?? "");
      const mrc = String(p["MUS_NM_MRC"] ?? "");
      const geomDict = f.geometry;
      if (!code || !nm || !geomDict) continue;
      if (geomDict.type !== "Polygon" && geomDict.type !== "MultiPolygon") continue;
      const entry: SdaEntry = {
        code,
        nom: nm,
        mrc_norm: norm(mrc),
        geom: geomDict as Polygon | MultiPolygon,
      };
      const key = norm(nm);
      if (!this.byName.has(key)) this.byName.set(key, []);
      this.byName.get(key)!.push(entry);
      const prev = this.byCode.get(code);
      if (prev) {
        try {
          prev.geom = unionPolys(prev.geom, entry.geom);
        } catch {
          /* keep prev */
        }
      } else {
        this.byCode.set(code, { ...entry });
      }
    }
  }

  /** Charge un index rôle {norm(nom): [code, nom]} (JSON pré-fetché). */
  attachRoleIndex(roleIndexJson?: string): number {
    if (roleIndexJson) {
      const raw = JSON.parse(readFileSync(roleIndexJson, "utf8")) as Record<
        string,
        [string, string]
      >;
      this.roleIndex = new Map(Object.entries(raw).map(([k, v]) => [k, v]));
    }
    return this.roleIndex.size;
  }
}

/** Découpe un slug brut sur '--' (avant normalisation) et norme chaque segment. */
function splitSlug(slug: string): string[] {
  return (slug ?? "").split(/-{2,}/).map((seg) => norm(seg));
}

function candidatesFor(idx: SDAIndex, slug: string): SdaEntry[] {
  const s = norm(slug);
  if (idx.byName.has(s)) return idx.byName.get(s)!;
  const segs = splitSlug(slug);
  for (let i = segs.length; i > 0; i--) {
    const base = norm(segs.slice(0, i).join("-"));
    if (idx.byName.has(base)) return idx.byName.get(base)!;
  }
  return [];
}

/** Distance planaire approx (degrés) entre point et entrée — pour le tri de
 * proximité, équivalent monotone à shapely `geom.distance(pt)` (centroïde). */
function distToEntry(entry: SdaEntry, near: Position): number {
  const rp = representativePoint(entry.geom);
  const c = rp ?? near;
  // turf distance (km) is monotone in planar distance for ranking purposes.
  return distance(c as [number, number], near as [number, number]);
}

export function resolveBoundary(
  idx: SDAIndex,
  slug: string,
  near: Position | null = null,
): [SdaEntry | null, string] {
  const s = norm(slug);
  if (ALIAS_SLUG_TO_CODE[s]) {
    const e = idx.byCode.get(ALIAS_SLUG_TO_CODE[s]!);
    if (e) return [e, "alias"];
  }
  const cands = candidatesFor(idx, slug);
  if (cands.length === 1) return [cands[0]!, "name"];
  if (cands.length > 1) {
    const segs = splitSlug(slug);
    const suffixNorm = segs.length > 1 ? norm(segs.slice(1).join("-")) : "";
    if (suffixNorm) {
      for (const c of cands) {
        if (
          c.mrc_norm &&
          (c.mrc_norm === suffixNorm ||
            c.mrc_norm.includes(suffixNorm) ||
            suffixNorm.includes(c.mrc_norm))
        ) {
          return [c, "name+mrc"];
        }
      }
    }
    if (near !== null) {
      const sorted = [...cands].sort(
        (a, b) => distToEntry(a, near) - distToEntry(b, near),
      );
      return [sorted[0]!, "name+proximity"];
    }
    return [cands[0]!, "name+firstambig"];
  }
  // fallback role index
  if (idx.roleIndex.size) {
    let ri = idx.roleIndex.get(s);
    if (!ri) {
      const segs = splitSlug(slug);
      for (let i = segs.length; i > 0; i--) {
        const base = norm(segs.slice(0, i).join("-"));
        if (idx.roleIndex.has(base)) {
          ri = idx.roleIndex.get(base);
          break;
        }
      }
    }
    if (ri) {
      const e = idx.byCode.get(ri[0]);
      if (e) return [e, "role-index"];
    }
  }
  return [null, "no-match"];
}

export interface ClipResult {
  slug: string;
  before: number;
  after: number;
  retained_pct: number;
  boundary_match: boolean;
  resolve_method: string;
  sda_code?: string;
  sda_nom?: string;
  muni_area_deg2?: number;
  out: string | null;
  join_before?: number;
  join_after?: number;
  matched_coverage?: number;
}

/** Aire planaire (deg²) d'un (multi)polygone par la formule du lacet — équivaut
 * à shapely `.area` en degrés (mesure de diagnostic uniquement). */
function planarAreaDeg2(geom: Polygon | MultiPolygon): number {
  const ringArea = (ring: Position[]): number => {
    let a = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      a += ring[i]![0]! * ring[i + 1]![1]! - ring[i + 1]![0]! * ring[i]![1]!;
    }
    return Math.abs(a) / 2;
  };
  const polyArea = (poly: Position[][]): number => {
    if (poly.length === 0) return 0;
    let a = ringArea(poly[0]!);
    for (let i = 1; i < poly.length; i++) a -= ringArea(poly[i]!);
    return a;
  };
  if (geom.type === "Polygon") return polyArea(geom.coordinates);
  return geom.coordinates.reduce((s, p) => s + polyArea(p), 0);
}

/**
 * Charge la cadastre, résout la frontière SDA, ne retient QUE les lots dont le
 * centroïde (representative point) tombe strictement dans la frontière.
 * Si `roleParquetRows` est fourni (lu via le reader parquet), recalcule le
 * join% post-clip — IDENTIQUE à la branche pyarrow du .py.
 */
export function clipSlug(
  idx: SDAIndex,
  slug: string,
  inPath: string,
  outPath: string,
  roleParquetRows?: { NO_LOT?: unknown; role_usage_cubf?: unknown }[] | null,
): ClipResult {
  const g = JSON.parse(readFileSync(inPath, "utf8")) as {
    features: GeoJSONFeature[];
  };
  const feats = g.features ?? [];
  const n = feats.length;

  const cents: (Position | null)[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  for (const f of feats) {
    const c = representativePoint(f.geometry);
    cents.push(c);
    if (c) {
      xs.push(c[0]!);
      ys.push(c[1]!);
    }
  }
  const near: Position | null = xs.length
    ? [xs.reduce((a, b) => a + b, 0) / xs.length, ys.reduce((a, b) => a + b, 0) / ys.length]
    : null;

  const [entry, method] = resolveBoundary(idx, slug, near);
  if (entry === null) {
    return {
      slug,
      before: n,
      after: 0,
      retained_pct: 0,
      boundary_match: false,
      resolve_method: method,
      out: null,
    };
  }

  const muni = entry.geom;
  const kept: GeoJSONFeature[] = [];
  const keptNolots = new Set<string>();
  for (let i = 0; i < feats.length; i++) {
    const c = cents[i];
    if (c && strictPointInPolygon(c, muni)) {
      kept.push(feats[i]!);
      const nl = String((feats[i]!.properties ?? {})["NO_LOT"] ?? "").replace(/ /g, "");
      if (nl) keptNolots.add(nl);
    }
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({ type: "FeatureCollection", features: kept }));

  const res: ClipResult = {
    slug,
    before: n,
    after: kept.length,
    retained_pct: n ? round1((100 * kept.length) / n) : 0,
    boundary_match: true,
    resolve_method: method,
    sda_code: entry.code,
    sda_nom: entry.nom,
    muni_area_deg2: round5(planarAreaDeg2(muni)),
    out: outPath,
  };

  if (roleParquetRows && roleParquetRows.length) {
    const matched = new Set<string>();
    for (const r of roleParquetRows) {
      if (r.role_usage_cubf !== null && r.role_usage_cubf !== undefined) {
        matched.add(String(r.NO_LOT ?? "").replace(/ /g, ""));
      }
    }
    let inter = 0;
    for (const k of keptNolots) if (matched.has(k)) inter++;
    res.join_before = n ? round1((100 * matched.size) / n) : 0;
    res.join_after = kept.length ? round1((100 * inter) / kept.length) : 0;
    res.matched_coverage = matched.size ? round1((100 * inter) / matched.size) : 0;
  }
  return res;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
function round5(x: number): number {
  return Math.round(x * 1e5) / 1e5;
}
