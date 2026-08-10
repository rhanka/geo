/**
 * @sentropic/geo/zones — serving helpers for zoning producers.
 *
 * The final assembly step of the recalage pipeline: once cadastral lots have
 * been assigned a `zone_code` by the nearest-label pass, these helpers collapse
 * them into the SERVED contract — one feature per DISTINCT `zone_code`, whose
 * geometry is the real cadastral union of its lots (never an invented shape).
 * The T1 (embedded-GeoPDF) and T2 (manual N-GCP) producers share this exact
 * serving gate rather than re-declaring it.
 *
 * Pure compute, zero I/O. Ported from the acquisition recalage pipeline
 * (`acquisition/src/lib/zone-serve.ts`, itself lifted verbatim from
 * `t1-build.ts`), with two idiomatic adaptations for the published library:
 *   - GeoJSON types come from {@link @sentropic/geo-core} (RFC 7946) instead of
 *     the `geojson` DefinitelyTyped package;
 *   - the legacy CRS84 `crs` member is dropped from the output — the library is
 *     WGS84-only (RFC 7946 §4), so the passthrough is a semantic no-op.
 * The serving behaviour (1 feature / zone_code, real-lot union, summed n_lots,
 * dropped assign_method) is behaviour-identical.
 */
import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Polygon,
  Position,
} from "@sentropic/geo-core";
import * as polyclip from "polyclip-ts";

/** Great-circle distance (km) between two [lon,lat] points. */
export function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const la1 = (a[1] * Math.PI) / 180;
  const la2 = (b[1] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Centre + bbox (lon/lat) of a FeatureCollection's polygonal geometry. */
export function bboxCenter(fc: FeatureCollection): {
  center: [number, number];
  bbox: [number, number, number, number];
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const f of fc.features) {
    const g = f.geometry;
    if (!g) continue;
    const scan = (poly: number[][][]): void => {
      for (const ring of poly)
        for (const p of ring) {
          if (p[0]! < minX) minX = p[0]!;
          if (p[0]! > maxX) maxX = p[0]!;
          if (p[1]! < minY) minY = p[1]!;
          if (p[1]! > maxY) maxY = p[1]!;
        }
    };
    if (g.type === "Polygon") scan(g.coordinates as number[][][]);
    else if (g.type === "MultiPolygon") for (const pp of g.coordinates as number[][][][]) scan(pp);
  }
  return { center: [(minX + maxX) / 2, (minY + maxY) / 2], bbox: [minX, minY, maxX, maxY] };
}

/**
 * Serving step: 1 feature per DISTINCT zone_code (the served contract, matching
 * the saint-amable golden). The per-code-point features are unioned into a
 * single MultiPolygon and their n_lots summed. Geometry is still 100% real
 * cadastre — on a union failure we keep the raw MultiPolygon of the lots.
 */
export function mergeByZoneCode(fc: FeatureCollection): FeatureCollection {
  const byCode = new Map<string, Feature[]>();
  for (const f of fc.features) {
    const code = String(f.properties?.["zone_code"]);
    const arr = byCode.get(code) ?? [];
    arr.push(f);
    byCode.set(code, arr);
  }
  const merged: Feature[] = [];
  for (const [code, group] of byCode) {
    const parts: Position[][][] = [];
    let nLots = 0;
    for (const f of group) {
      const g = f.geometry;
      if (g?.type === "Polygon") parts.push(g.coordinates);
      else if (g?.type === "MultiPolygon") for (const p of g.coordinates) parts.push(p);
      nLots += Number(f.properties?.["n_lots"] ?? 0);
    }
    let geometry: Polygon | MultiPolygon = { type: "MultiPolygon", coordinates: parts };
    if (parts.length > 1) {
      try {
        const [first, ...rest] = parts as unknown as Parameters<typeof polyclip.union>;
        const u = polyclip.union(first!, ...rest) as unknown as Position[][][];
        if (u && u.length > 0) geometry = { type: "MultiPolygon", coordinates: u };
      } catch {
        /* keep raw union of lots — never drop real geometry */
      }
    }
    const props = { ...group[0]!.properties, zone_code: code, n_lots: nLots };
    delete (props as Record<string, unknown>)["assign_method"];
    merged.push({ type: "Feature", properties: props, geometry });
  }
  return {
    type: "FeatureCollection",
    features: merged,
  };
}
