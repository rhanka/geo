/**
 * Unit tests for the manual-GCP georeferencing math (georef/gcp.ts).
 *
 * Pure, network-free. We synthesise a KNOWN affine page→WGS84 transform,
 * sample GCPs from it, rebuild the GeoRef from those GCPs, and assert the
 * recovered transform reproduces the truth to sub-metre residual — proving the
 * 3-GCP calibration is exact for an affine ground truth (which a planar
 * municipal projection is, to second order).
 *
 * Ported verbatim (import path only) from the acquisition golden test
 * `acquisition/src/lib/t2-georef.test.ts`.
 */
import proj4 from "proj4";
import { describe, it, expect } from "vitest";

import {
  assertIndependentGcps,
  buildGeoRefFromGcps,
  buildGeoRefFromGcpsCrs,
  gcpLooksBboxDerived,
  type Gcp,
} from "./gcp.js";

// A plausible Rive-Sud plan: ~3370×2384 pt landscape page, ~6 km wide near 45.4°N.
const PAGE_W = 3370;
const PAGE_H = 2384;

// Known affine: user-space (x,y, bottom-left origin) → (lon,lat).
// Centre ~ -73.50,45.40; ~6 km across the page width; tiny rotation + y-shear.
const A_LON = [1.9e-5, 1.0e-6, -73.53];
const A_LAT = [-0.7e-6, 1.35e-5, 45.385];
const truthLonLat = (x: number, y: number): [number, number] => [
  A_LON[0]! * x + A_LON[1]! * y + A_LON[2]!,
  A_LAT[0]! * x + A_LAT[1]! * y + A_LAT[2]!,
];

/** Make a GCP at page-fraction (fx, fy-top-down) using the known truth. */
function gcpAt(fx: number, fy: number, note: string): Gcp {
  const ux = fx * PAGE_W;
  const uy = (1 - fy) * PAGE_H; // fy top-down → user-space bottom-up
  const [lon, lat] = truthLonLat(ux, uy);
  return { fx, fy, lon, lat, note };
}

describe("georef/gcp — 3-GCP affine calibration", () => {
  it("reproduces a known affine to sub-metre residual from 3 spread GCPs", () => {
    const gcps = [
      gcpAt(0.1, 0.12, "top-left landmark"),
      gcpAt(0.88, 0.15, "top-right landmark"),
      gcpAt(0.45, 0.9, "bottom-centre landmark"),
    ];
    const { geo, maxResidualM, rmsResidualM } = buildGeoRefFromGcps(gcps, PAGE_W, PAGE_H);
    expect(maxResidualM).toBeLessThan(0.01); // exact for 3 GCPs on an affine truth
    expect(rmsResidualM).toBeLessThan(0.01);

    // an INDEPENDENT page point must map to the truth.
    const [tx, ty] = [0.6 * PAGE_W, 0.6 * PAGE_H];
    const [gotLon, gotLat] = geo.pageToLonLat(tx, ty);
    const [wantLon, wantLat] = truthLonLat(tx, ty);
    const mPerDegLat = 111320;
    const mPerDegLon = 111320 * Math.cos((wantLat * Math.PI) / 180);
    const errM = Math.hypot((gotLon - wantLon) * mPerDegLon, (gotLat - wantLat) * mPerDegLat);
    expect(errM).toBeLessThan(0.05);
  });

  it("topLeftToLonLat matches pdftotext top-left origin", () => {
    const gcps = [
      gcpAt(0.1, 0.12, "a"),
      gcpAt(0.88, 0.15, "b"),
      gcpAt(0.45, 0.9, "c"),
    ];
    const { geo } = buildGeoRefFromGcps(gcps, PAGE_W, PAGE_H);
    // A label at page-fraction (0.5, 0.3 top-down): pdftotext y = 0.3*pageH.
    const fx = 0.5;
    const fyTop = 0.3;
    const viaTopLeft = geo.topLeftToLonLat(fx * PAGE_W, fyTop * PAGE_H);
    const viaUser = geo.pageToLonLat(fx * PAGE_W, (1 - fyTop) * PAGE_H);
    expect(viaTopLeft[0]).toBeCloseTo(viaUser[0], 9);
    expect(viaTopLeft[1]).toBeCloseTo(viaUser[1], 9);
  });

  it("least-squares averages noisy GCPs (4 points, small jitter)", () => {
    const jitterDeg = 0.00002; // ~1.5 m
    const base = [
      gcpAt(0.1, 0.1, "a"),
      gcpAt(0.9, 0.12, "b"),
      gcpAt(0.85, 0.9, "c"),
      gcpAt(0.15, 0.88, "d"),
    ];
    const noisy = base.map((g, i) => ({
      ...g,
      lon: g.lon + (i % 2 === 0 ? jitterDeg : -jitterDeg),
      lat: g.lat + (i < 2 ? jitterDeg : -jitterDeg),
    }));
    const { maxResidualM } = buildGeoRefFromGcps(noisy, PAGE_W, PAGE_H);
    // residual is bounded by the injected jitter, not blown up.
    expect(maxResidualM).toBeLessThan(5);
    expect(maxResidualM).toBeGreaterThan(0);
  });

  it("rejects < 3 GCPs and collinear layouts", () => {
    expect(() => buildGeoRefFromGcps([gcpAt(0.1, 0.1, "a"), gcpAt(0.9, 0.9, "b")], PAGE_W, PAGE_H)).toThrow(
      /≥3 GCPs/,
    );
    const collinear = [gcpAt(0.1, 0.1, "a"), gcpAt(0.5, 0.5, "b"), gcpAt(0.9, 0.9, "c")];
    expect(() => buildGeoRefFromGcps(collinear, PAGE_W, PAGE_H)).toThrow(/collinear/);
  });

  it("accepts a globally spread layout when its first three GCPs are collinear", () => {
    const gcps = [
      gcpAt(0.1, 0.1, "line-a"),
      gcpAt(0.2, 0.2, "line-b"),
      gcpAt(0.3, 0.3, "line-c"),
      gcpAt(0.8, 0.2, "off-line"),
    ];

    const result = buildGeoRefFromGcps(gcps, PAGE_W, PAGE_H);

    expect(result.maxResidualM).toBeLessThan(0.01);
  });

  it("rejects a page-spread affine whose ground transform is singular", () => {
    const groundCollinear: Gcp[] = [
      { fx: 0.1, fy: 0.1, lon: -73.2, lat: 45, independent: true },
      { fx: 0.9, fy: 0.1, lon: -73.1, lat: 45, independent: true },
      { fx: 0.5, fy: 0.9, lon: -73, lat: 45, independent: true },
    ];

    expect(() => buildGeoRefFromGcps(groundCollinear, PAGE_W, PAGE_H)).toThrow(/ground transform.*singular/);
  });

  it("reprojects a projected CRS definition that contains a towgs84 parameter", () => {
    const crs = "+proj=utm +zone=18 +ellps=GRS80 +towgs84=0,0,0 +units=m +no_defs";
    const wgs84Gcps = [
      gcpAt(0.1, 0.12, "top-left"),
      gcpAt(0.88, 0.15, "top-right"),
      gcpAt(0.45, 0.9, "bottom"),
    ];
    const projectedGcps = wgs84Gcps.map((gcp) => {
      const [lon, lat] = proj4("WGS84", crs, [gcp.lon, gcp.lat]);
      return { ...gcp, lon, lat };
    });

    const result = buildGeoRefFromGcpsCrs(projectedGcps, PAGE_W, PAGE_H, crs);
    const [actualLon, actualLat] = result.geo.topLeftToLonLat(
      wgs84Gcps[0]!.fx * PAGE_W,
      wgs84Gcps[0]!.fy * PAGE_H,
    );

    expect(actualLon).toBeCloseTo(wgs84Gcps[0]!.lon, 7);
    expect(actualLat).toBeCloseTo(wgs84Gcps[0]!.lat, 7);
  });

  it("accepts the CRS84 aliases used by acquisition GCP files", () => {
    const gcps = [
      gcpAt(0.1, 0.12, "top-left"),
      gcpAt(0.88, 0.15, "top-right"),
      gcpAt(0.45, 0.9, "bottom"),
    ];

    for (const crs of [
      "CRS84",
      "OGC:CRS84",
      "urn:ogc:def:crs:OGC:1.3:CRS84",
      "urn:ogc:def:crs:EPSG::4326",
    ]) {
      const result = buildGeoRefFromGcpsCrs(gcps, PAGE_W, PAGE_H, crs);
      const [actualLon, actualLat] = result.geo.topLeftToLonLat(
        gcps[0]!.fx * PAGE_W,
        gcps[0]!.fy * PAGE_H,
      );

      expect(actualLon).toBeCloseTo(gcps[0]!.lon, 7);
      expect(actualLat).toBeCloseTo(gcps[0]!.lat, 7);
    }
  });

  it("classifies bbox-corner controls as non-independent for real-GCP serving", () => {
    const bboxGcps = [
      { ...gcpAt(0.1, 0.1, "map bbox northwest -> cadastre bbox northwest") },
      { ...gcpAt(0.9, 0.1, "map bbox northeast -> cadastre bbox northeast") },
      { ...gcpAt(0.1, 0.9, "map bbox southwest -> cadastre bbox southwest") },
    ];
    expect(gcpLooksBboxDerived(bboxGcps[0]!)).toBe(true);
    expect(() => assertIndependentGcps(bboxGcps, PAGE_W, PAGE_H)).toThrow(/independent non-bbox/);
    expect(() =>
      assertIndependentGcps(
        bboxGcps.map((g) => ({ ...g, independent: true })),
        PAGE_W,
        PAGE_H,
      ),
    ).toThrow(/independent non-bbox/);

    const realGcps = [
      { ...gcpAt(0.1, 0.12, "parcel corner match"), source: "cadastre-parcel-corner-match", independent: true },
      { ...gcpAt(0.88, 0.15, "street intersection match"), source: "cadastre-parcel-corner-match", independent: true },
      { ...gcpAt(0.45, 0.9, "municipal-boundary vertex"), source: "cadastre-boundary-vertex", independent: true },
    ];
    expect(assertIndependentGcps(realGcps, PAGE_W, PAGE_H).independentCount).toBe(3);
  });
});
