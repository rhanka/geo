/**
 * lot-attrs-geom.ts — Attributs géométriques de lots cadastraux.
 *
 * Port fidèle de `acquisition/lot_attrs_geom.py`. Pour un GeoJSON de lots WGS84,
 * calcule par lot : superficie_m2, perimetre_m, frontage_m (côté court du
 * rectangle orienté minimal), profondeur_m (côté long du MRR).
 *
 * Projection : on choisit la projection métrique locale optimale selon la
 * longitude centroïde (MTM zones 7-10 EPSG:32187-32190, sinon UTM 17N/19N).
 * proj4 est configuré avec les définitions MTM NAD83/GRS80 (validées au mm près
 * contre pyproj). L'aire / le périmètre / le MRR sont calculés PLANAIREMENT sur
 * les coordonnées projetées, exactement comme shapely `.area` / `.length` /
 * `minimum_rotated_rectangle` sur la géométrie reprojetée.
 *
 * Anti-invention : un attribut non calculable de façon fiable -> null.
 */
import { readFileSync, writeFileSync } from "node:fs";

import type { Feature, Geometry, Polygon, MultiPolygon, Position } from "geojson";
import proj4 from "proj4";
import centroid from "@turf/centroid";

import { writeRoleParquet } from "./lib/parquet.js";

// MTM NAD83 / GRS80 zone definitions (proj4 ne connaît pas EPSG:321xx).
proj4.defs(
  "EPSG:32187",
  "+proj=tmerc +lat_0=0 +lon_0=-70.5 +k=0.9999 +x_0=304800 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
);
proj4.defs(
  "EPSG:32188",
  "+proj=tmerc +lat_0=0 +lon_0=-73.5 +k=0.9999 +x_0=304800 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
);
proj4.defs(
  "EPSG:32189",
  "+proj=tmerc +lat_0=0 +lon_0=-76.5 +k=0.9999 +x_0=304800 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
);
proj4.defs(
  "EPSG:32190",
  "+proj=tmerc +lat_0=0 +lon_0=-79.5 +k=0.9999 +x_0=304800 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
);

/** EPSG métrique local selon la longitude centroïde — seuils IDENTIQUES au .py. */
export function chooseEpsg(lon: number): number {
  if (lon < -79.5) {
    if (lon < -82.5) return 32617; // UTM 17N
    return 32190; // MTM Zone 10
  } else if (lon < -76.5) return 32189; // MTM Zone 9
  else if (lon < -73.5) return 32188; // MTM Zone 8
  else if (lon < -70.5) return 32187; // MTM Zone 7
  return 32619; // UTM 19N
}

type GeoJSONFeature = Feature<Geometry, Record<string, unknown> | null>;

export interface LotAttrs {
  no_lot: unknown;
  superficie_m2: number | null;
  perimetre_m: number | null;
  frontage_m: number | null;
  profondeur_m: number | null;
  _epsg_used: number | null;
  _geom_type: string | null;
}

/** Reprojette toutes les positions d'une (multi)géométrie WGS84 -> EPSG cible. */
function reproject(geom: Geometry, epsg: number): Geometry {
  const fwd = (pos: Position): Position => {
    const [x, y] = proj4("EPSG:4326", `EPSG:${epsg}`, [pos[0]!, pos[1]!]);
    return [x, y];
  };
  const mapRing = (ring: Position[]): Position[] => ring.map(fwd);
  switch (geom.type) {
    case "Polygon":
      return { type: "Polygon", coordinates: geom.coordinates.map(mapRing) };
    case "MultiPolygon":
      return {
        type: "MultiPolygon",
        coordinates: geom.coordinates.map((p) => p.map(mapRing)),
      };
    case "Point":
      return { type: "Point", coordinates: fwd(geom.coordinates) };
    case "LineString":
      return { type: "LineString", coordinates: mapRing(geom.coordinates) };
    case "MultiLineString":
      return { type: "MultiLineString", coordinates: geom.coordinates.map(mapRing) };
    default:
      return geom;
  }
}

const shoelace = (ring: Position[]): number => {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i]![0]! * ring[i + 1]![1]! - ring[i + 1]![0]! * ring[i]![1]!;
  }
  return a / 2;
};

/** Aire planaire (m²) d'un (multi)polygone projeté (extérieur - trous). */
function planarArea(geom: Geometry): number {
  const polyArea = (poly: Position[][]): number => {
    if (poly.length === 0) return 0;
    let a = Math.abs(shoelace(poly[0]!));
    for (let i = 1; i < poly.length; i++) a -= Math.abs(shoelace(poly[i]!));
    return a;
  };
  if (geom.type === "Polygon") return polyArea(geom.coordinates);
  if (geom.type === "MultiPolygon")
    return geom.coordinates.reduce((s, p) => s + polyArea(p), 0);
  return 0;
}

const ringLength = (ring: Position[]): number => {
  let L = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const dx = ring[i + 1]![0]! - ring[i]![0]!;
    const dy = ring[i + 1]![1]! - ring[i]![1]!;
    L += Math.hypot(dx, dy);
  }
  return L;
};

/** Périmètre planaire (m) — somme des longueurs de tous les anneaux (shapely
 * `.length` inclut les anneaux intérieurs). */
function planarLength(geom: Geometry): number {
  if (geom.type === "Polygon") return geom.coordinates.reduce((s, r) => s + ringLength(r), 0);
  if (geom.type === "MultiPolygon")
    return geom.coordinates.reduce(
      (s, p) => s + p.reduce((ss, r) => ss + ringLength(r), 0),
      0,
    );
  return 0;
}

/** Tous les sommets extérieurs d'un (multi)polygone projeté. */
function allCoords(geom: Geometry): Position[] {
  const out: Position[] = [];
  if (geom.type === "Polygon") for (const r of geom.coordinates) out.push(...r);
  else if (geom.type === "MultiPolygon")
    for (const p of geom.coordinates) for (const r of p) out.push(...r);
  return out;
}

/** Enveloppe convexe (Andrew monotone chain), retourne un anneau fermé CCW. */
function convexHull(points: Position[]): Position[] {
  const pts = points
    .map((p) => [p[0]!, p[1]!] as [number, number])
    .sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));
  if (pts.length <= 2) return pts;
  const cross = (o: number[], a: number[], b: number[]) =>
    (a[0]! - o[0]!) * (b[1]! - o[1]!) - (a[1]! - o[1]!) * (b[0]! - o[0]!);
  const lower: number[][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: number[][] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0)
      upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper] as Position[];
}

/**
 * Rectangle orienté minimal (rotating calipers): retourne [côté court, côté
 * long] arrondis à 0.01, ou [null,null] si échec. Équivaut au calcul des côtés
 * de shapely `minimum_rotated_rectangle`.
 */
function orientedBboxSides(geom: Geometry): [number | null, number | null] {
  try {
    const hull = convexHull(allCoords(geom));
    if (hull.length < 3) return [null, null];
    let best = Infinity;
    let bestSides: [number, number] = [0, 0];
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i]!;
      const b = hull[(i + 1) % hull.length]!;
      let ex = b[0]! - a[0]!;
      let ey = b[1]! - a[1]!;
      const len = Math.hypot(ex, ey);
      if (len === 0) continue;
      ex /= len;
      ey /= len;
      // perpendicular
      const ux = -ey;
      const uy = ex;
      let minP = Infinity,
        maxP = -Infinity,
        minQ = Infinity,
        maxQ = -Infinity;
      for (const p of hull) {
        const proj = p[0]! * ex + p[1]! * ey;
        const perp = p[0]! * ux + p[1]! * uy;
        if (proj < minP) minP = proj;
        if (proj > maxP) maxP = proj;
        if (perp < minQ) minQ = perp;
        if (perp > maxQ) maxQ = perp;
      }
      const w = maxP - minP;
      const h = maxQ - minQ;
      const areaR = w * h;
      if (areaR < best) {
        best = areaR;
        bestSides = [w, h];
      }
    }
    const sMin = Math.round(Math.min(...bestSides) * 100) / 100;
    const sMax = Math.round(Math.max(...bestSides) * 100) / 100;
    return [sMin, sMax];
  } catch {
    return [null, null];
  }
}

const nullAttrs = (noLot: unknown, geomType: string | null, epsg: number | null): LotAttrs => ({
  no_lot: noLot,
  superficie_m2: null,
  perimetre_m: null,
  frontage_m: null,
  profondeur_m: null,
  _epsg_used: epsg,
  _geom_type: geomType,
});

export function computeLotAttrs(feature: GeoJSONFeature): LotAttrs {
  const props = feature.properties ?? {};
  const noLot =
    props["NO_LOT"] ?? props["noLot"] ?? props["no_lot"] ?? props["NOLOT"] ?? props["id"] ?? null;
  const geomRaw = feature.geometry;
  if (!geomRaw) return nullAttrs(noLot, null, null);
  if (geomRaw.type !== "Polygon" && geomRaw.type !== "MultiPolygon") {
    return nullAttrs(noLot, geomRaw.type, null);
  }
  const geom = geomRaw as Polygon | MultiPolygon;

  let lon: number;
  try {
    const c = centroid({ type: "Feature", properties: {}, geometry: geom } as never);
    lon = c.geometry.coordinates[0]!;
  } catch {
    return nullAttrs(noLot, geomRaw.type, null);
  }
  const epsg = chooseEpsg(lon);

  let projected: Geometry;
  try {
    projected = reproject(geom, epsg);
  } catch {
    return nullAttrs(noLot, geomRaw.type, epsg);
  }

  const areaM = planarArea(projected);
  const lenM = planarLength(projected);
  const [frontage, profondeur] = orientedBboxSides(projected);
  return {
    no_lot: noLot,
    superficie_m2: areaM > 0 ? Math.round(areaM * 100) / 100 : null,
    perimetre_m: lenM > 0 ? Math.round(lenM * 100) / 100 : null,
    frontage_m: frontage,
    profondeur_m: profondeur,
    _epsg_used: epsg,
    _geom_type: geomRaw.type,
  };
}

export interface LotAttrsStats {
  n_total: number;
  n_null_geom: number;
  n_superficie: number;
  n_perimetre: number;
  n_frontage: number;
  n_profondeur: number;
  pct_superficie: string;
  pct_perimetre: string;
  pct_frontage: string;
  pct_profondeur: string;
}

export function computeLotAttrsGeojson(
  fc: { features?: GeoJSONFeature[]; crs?: unknown },
  includeGeom = true,
): { outputFc: { type: string; crs: unknown; features: GeoJSONFeature[] }; stats: LotAttrsStats } {
  const featuresIn = fc.features ?? [];
  const featuresOut: GeoJSONFeature[] = [];
  const nTotal = featuresIn.length;
  let nSup = 0,
    nPer = 0,
    nFro = 0,
    nPro = 0,
    nNull = 0;

  for (const feat of featuresIn) {
    const attrs = computeLotAttrs(feat);
    const newProps: Record<string, unknown> = { ...(feat.properties ?? {}) };
    newProps["superficie_m2"] = attrs.superficie_m2;
    newProps["perimetre_m"] = attrs.perimetre_m;
    newProps["frontage_m"] = attrs.frontage_m;
    newProps["profondeur_m"] = attrs.profondeur_m;
    newProps["_epsg_used"] = attrs._epsg_used;
    featuresOut.push({
      type: "Feature",
      properties: newProps,
      geometry: (includeGeom ? feat.geometry : null) as Geometry,
    });
    if (attrs.superficie_m2 !== null) nSup++;
    if (attrs.perimetre_m !== null) nPer++;
    if (attrs.frontage_m !== null) nFro++;
    if (attrs.profondeur_m !== null) nPro++;
    if (!feat.geometry) nNull++;
  }
  const pct = (n: number): string => (nTotal > 0 ? `${((100 * n) / nTotal).toFixed(1)}%` : "N/A");
  return {
    outputFc: { type: "FeatureCollection", crs: fc.crs ?? null, features: featuresOut },
    stats: {
      n_total: nTotal,
      n_null_geom: nNull,
      n_superficie: nSup,
      n_perimetre: nPer,
      n_frontage: nFro,
      n_profondeur: nPro,
      pct_superficie: pct(nSup),
      pct_perimetre: pct(nPer),
      pct_frontage: pct(nFro),
      pct_profondeur: pct(nPro),
    },
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length < 2) {
    console.error(
      "Usage: tsx src/lot-attrs-geom.ts <input.geojson> <output.geojson|output.parquet>",
    );
    process.exit(1);
  }
  const [inputPath, outputPath] = argv as [string, string];
  console.error(`[lot_attrs_geom] Lecture : ${inputPath}`);
  const fc = JSON.parse(readFileSync(inputPath, "utf8"));
  console.error("[lot_attrs_geom] Calcul attributs géométriques…");
  const { outputFc, stats } = computeLotAttrsGeojson(fc, true);
  console.error("[lot_attrs_geom] Couverture :");
  for (const [k, v] of Object.entries(stats)) console.error(`  ${k}: ${v}`);

  if (outputPath.endsWith(".parquet")) {
    const rows = outputFc.features.map((f) => {
      const p = f.properties ?? {};
      return {
        no_lot: p["no_lot"] ?? p["NO_LOT"] ?? null,
        superficie_m2: p["superficie_m2"] ?? null,
        perimetre_m: p["perimetre_m"] ?? null,
        frontage_m: p["frontage_m"] ?? null,
        profondeur_m: p["profondeur_m"] ?? null,
      };
    });
    await writeRoleParquet(rows, outputPath);
    console.error(`[lot_attrs_geom] Parquet écrit : ${outputPath}`);
  } else {
    writeFileSync(outputPath, JSON.stringify(outputFc));
    console.error(`[lot_attrs_geom] GeoJSON écrit : ${outputPath}`);
  }
  console.error("[lot_attrs_geom] Terminé.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
