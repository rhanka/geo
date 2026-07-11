import type { FeatureCollection, Geometry } from "@sentropic/geo-core";
import proj4 from "proj4";
import { describe, expect, it } from "vitest";

import {
  deriveAutonomousGcpsFromPoints,
  extractSvgVectorPointsFromString,
  matchPagePointsToCadastre,
  type PagePoint,
} from "./autogcp.js";
import type { Gcp, GcpFile } from "./gcp.js";

const PAGE_W = 1000;
const PAGE_H = 800;

const A_LON = [1.6e-5, 2.5e-6, -73.53];
const A_LAT = [-1.0e-6, 1.2e-5, 45.385];

function truthTopLeft(x: number, yTopDown: number): [number, number] {
  const y = PAGE_H - yTopDown;
  return [A_LON[0]! * x + A_LON[1]! * y + A_LON[2]!, A_LAT[0]! * x + A_LAT[1]! * y + A_LAT[2]!];
}

function gcpAt(fx: number, fy: number, note: string): Gcp {
  const [lon, lat] = truthTopLeft(fx * PAGE_W, fy * PAGE_H);
  return { fx, fy, lon, lat, note };
}

function pointAt(fx: number, fy: number): PagePoint {
  return { x: fx * PAGE_W, y: fy * PAGE_H };
}

function lotAt(lon: number, lat: number, id: number): FeatureCollection<Geometry | null>["features"][number] {
  const eps = 2e-7;
  const ring: Array<[number, number]> = [
    [lon, lat],
    [lon + eps, lat],
    [lon + eps, lat + eps],
    [lon, lat + eps],
    [lon, lat],
  ];
  return {
    type: "Feature",
    properties: { id },
    geometry: { type: "Polygon", coordinates: [ring] },
  };
}

function cadastreFor(points: PagePoint[]): FeatureCollection<Geometry | null> {
  return {
    type: "FeatureCollection",
    features: points.map((p, i) => {
      const [lon, lat] = truthTopLeft(p.x, p.y);
      return lotAt(lon, lat, i);
    }),
  };
}

function seed(crs?: string): GcpFile {
  return {
    slug: "synthetic",
    pdf: "synthetic.pdf",
    page: 1,
    pageW: PAGE_W,
    pageH: PAGE_H,
    gcps: [gcpAt(0.1, 0.12, "top-left"), gcpAt(0.88, 0.15, "top-right"), gcpAt(0.45, 0.9, "bottom")],
    ...(crs !== undefined ? { crs } : {}),
  };
}

describe("georef/autogcp - SVG vector points", () => {
  it("extracts stroked path points from an SVG string without file IO", () => {
    const svg =
      '<svg width="120pt" height="100pt">' +
      "<defs></defs>" +
      '<path stroke="black" fill="none" d="M 10 10 L 70 10 L 70 50"/>' +
      '<path stroke="none" fill="none" d="M 1 1 L 80 1"/>' +
      '<path stroke="black" fill="red" d="M 2 2 L 90 2"/>' +
      "</svg>";

    const points = extractSvgVectorPointsFromString(svg, 120, 100);

    expect(points).toEqual([
      { x: 10, y: 10 },
      { x: 70, y: 10 },
      { x: 70, y: 50 },
    ]);
  });
});

describe("georef/autogcp - in-memory cadastre matching", () => {
  const points = [
    pointAt(0.12, 0.12),
    pointAt(0.28, 0.2),
    pointAt(0.43, 0.16),
    pointAt(0.7, 0.22),
    pointAt(0.86, 0.18),
    pointAt(0.2, 0.48),
    pointAt(0.5, 0.5),
    pointAt(0.78, 0.52),
    pointAt(0.16, 0.82),
    pointAt(0.44, 0.76),
    pointAt(0.72, 0.84),
    pointAt(0.9, 0.72),
  ];

  it("derives independent GCPs from page points and cadastre vertices", () => {
    const report = deriveAutonomousGcpsFromPoints({
      slug: "synthetic",
      pageW: PAGE_W,
      pageH: PAGE_H,
      seed: seed(),
      cadastre: cadastreFor(points),
      pagePoints: points,
      minGcps: 8,
      maxGcps: 12,
      maxCandidateDistanceM: 2,
      maxResidualM: 1,
    });

    expect(report.pass).toBe(true);
    expect(report.seed_candidate_matches).toBe(points.length);
    expect(report.selected_gcps).toBeGreaterThanOrEqual(8);
    expect(report.residual_max_m).not.toBeNull();
    expect(report.residual_max_m!).toBeLessThan(0.01);
    expect(report.holdout_max_m).not.toBeNull();
    expect(report.holdout_max_m!).toBeLessThan(0.01);
    expect(report.gcp_file?.gcps.every((g) => g.source === "cadastre-parcel-corner-match" && g.independent)).toBe(true);
  });

  it("reprojects a projected seed in memory", () => {
    const wgs84Seed = seed();
    const projectedSeed: GcpFile = {
      ...wgs84Seed,
      crs: "EPSG:3857",
      gcps: wgs84Seed.gcps.map((gcp) => {
        const [lon, lat] = proj4("WGS84", "EPSG:3857", [gcp.lon, gcp.lat]);
        return { ...gcp, lon, lat };
      }),
    };
    const report = deriveAutonomousGcpsFromPoints({
      slug: "synthetic",
      pageW: PAGE_W,
      pageH: PAGE_H,
      seed: projectedSeed,
      cadastre: cadastreFor(points),
      pagePoints: points,
      minGcps: 8,
      maxGcps: 12,
      maxCandidateDistanceM: 2,
      maxResidualM: 1,
    });

    expect(report.pass).toBe(true);
    expect(report.affine_gate_pass).toBe(true);
  });

  it("rejects a residual-clean mirrored match at the geometry gate", () => {
    const mirrorTruth = (x: number, yTopDown: number): [number, number] => {
      const y = PAGE_H - yTopDown;
      return [-1.6e-5 * x + 2.5e-6 * y - 73.5, -1.0e-6 * x + 1.2e-5 * y + 45.385];
    };
    const mirrorGcp = (fx: number, fy: number, note: string): Gcp => {
      const [lon, lat] = mirrorTruth(fx * PAGE_W, fy * PAGE_H);
      return { fx, fy, lon, lat, note };
    };
    const mirrorSeed: GcpFile = {
      slug: "mirror",
      pdf: "mirror.pdf",
      gcps: [mirrorGcp(0.1, 0.12, "top-left"), mirrorGcp(0.88, 0.15, "top-right"), mirrorGcp(0.45, 0.9, "bottom")],
    };
    const mirrorCadastre: FeatureCollection<Geometry | null> = {
      type: "FeatureCollection",
      features: points.map((point, index) => {
        const [lon, lat] = mirrorTruth(point.x, point.y);
        return lotAt(lon, lat, index);
      }),
    };
    const report = deriveAutonomousGcpsFromPoints({
      slug: "mirror",
      pageW: PAGE_W,
      pageH: PAGE_H,
      seed: mirrorSeed,
      cadastre: mirrorCadastre,
      pagePoints: points,
      minGcps: 8,
      maxGcps: 12,
      maxCandidateDistanceM: 2,
      maxResidualM: 1,
    });

    expect(report.residual_max_m).toBe(0);
    expect(report.affine_gate_pass).toBe(false);
    expect(report.affine_gate_reasons.join(" ")).toMatch(/mirror\/reflection/);
    expect(report.pass).toBe(false);
    expect(report.gcp_file).toBeUndefined();
  });

  it("rejects a GCP count that cannot feed the public affine", () => {
    for (const minGcps of [2, 2.5, Number.NaN]) {
      expect(() =>
        deriveAutonomousGcpsFromPoints({
          slug: "synthetic",
          pageW: PAGE_W,
          pageH: PAGE_H,
          seed: seed(),
          cadastre: cadastreFor(points),
          pagePoints: points,
          fit: "similarity",
          minGcps,
          maxGcps: 3,
        }),
      ).toThrow(/integer of at least 3/);
    }
  });

  it("rejects collinear similarity controls that the public affine cannot consume", () => {
    const collinearPoints = [pointAt(0.2, 0.5), pointAt(0.5, 0.5), pointAt(0.8, 0.5)];
    for (const affineGate of [undefined, false] as const) {
      const report = deriveAutonomousGcpsFromPoints({
        slug: "collinear",
        pageW: PAGE_W,
        pageH: PAGE_H,
        seed: seed(),
        cadastre: cadastreFor(collinearPoints),
        pagePoints: collinearPoints,
        fit: "similarity",
        minGcps: 3,
        maxGcps: 3,
        maxCandidateDistanceM: 2,
        maxResidualM: 1,
        ...(affineGate === false ? { affineGate } : {}),
      });

      expect(report.pass).toBe(false);
      expect(report.reason).toMatch(/degenerate/);
      expect(report.gcp_file).toBeUndefined();
    }
  });

  it("uses each cadastre vertex for at most one independent page match", () => {
    const [lon, lat] = truthTopLeft(PAGE_W / 2, PAGE_H / 2);
    const cadastre = cadastreFor([pointAt(0.5, 0.5)]);

    const result = matchPagePointsToCadastre({
      pagePoints: [pointAt(0.2, 0.2), pointAt(0.8, 0.8)],
      pageW: PAGE_W,
      pageH: PAGE_H,
      seedGeo: { topLeftToLonLat: () => [lon, lat] },
      cadastre,
      maxCandidateDistanceM: 0.01,
    });

    expect(result.matches).toHaveLength(1);
  });
});
