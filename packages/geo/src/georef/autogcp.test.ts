/**
 * Unit tests for pure auto-GCP vector/cadastre compute.
 *
 * The acquisition source test already pins the orientation gate; these tests
 * pin the newly exported network-free / file-free part of t2-autogcp: SVG path
 * parsing, cadastre vertex matching, residual pruning, and auto-seed selection.
 */
import type { FeatureCollection, Geometry, Position } from "@sentropic/geo-core";
import { describe, expect, it } from "vitest";

import {
  deriveAutoSeedGcpsFromVectors,
  deriveAutonomousGcpsFromVectors,
  parseSvgVectorPoints,
  type Pt,
} from "./autogcp.js";
import type { Gcp, GcpFile } from "./gcp.js";

const PAGE_W = 1000;
const PAGE_H = 800;
const LON0 = -74;
const LAT0 = 45;
const DEG_PER_PT = 0.00001;
const LON_DEG_PER_PT = DEG_PER_PT / Math.cos((LAT0 * Math.PI) / 180);

function lonLatFromPage(p: Pt): [number, number] {
  return [LON0 + p.x * LON_DEG_PER_PT, LAT0 + (PAGE_H - p.y) * DEG_PER_PT];
}

function seedGcp(fx: number, fy: number): Gcp {
  const [lon, lat] = lonLatFromPage({ x: fx * PAGE_W, y: fy * PAGE_H });
  return { fx, fy, lon, lat, source: "manual-seed", independent: true };
}

function seedFile(): GcpFile {
  return {
    slug: "synthetic",
    pdf: "synthetic.pdf",
    page: 1,
    pageW: PAGE_W,
    pageH: PAGE_H,
    gcps: [seedGcp(0, 0), seedGcp(1, 0), seedGcp(1, 1), seedGcp(0, 1)],
  };
}

function gridPoints(cols: number, rows: number, margin = 100): Pt[] {
  const out: Pt[] = [];
  for (let iy = 0; iy < rows; iy++) {
    for (let ix = 0; ix < cols; ix++) {
      out.push({
        x: margin + (ix * (PAGE_W - 2 * margin)) / Math.max(1, cols - 1),
        y: margin + (iy * (PAGE_H - 2 * margin)) / Math.max(1, rows - 1),
      });
    }
  }
  return out;
}

function irregularPoints(cols: number, rows: number): Pt[] {
  return gridPoints(cols, rows).map((p, i) => ({
    x: p.x + ((i * 37) % 23) - 11,
    y: p.y + ((i * 53) % 19) - 9,
  }));
}

function cadastreFromPagePoints(points: Pt[]): FeatureCollection<Geometry | null> {
  const ring: Position[] = points.map((p) => {
    const [lon, lat] = lonLatFromPage(p);
    return [lon, lat];
  });
  ring.push(ring[0]!);
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: null,
        geometry: {
          type: "Polygon",
          coordinates: [ring],
        },
      },
    ],
  };
}

describe("parseSvgVectorPoints", () => {
  it("extracts stroked path vertices, applies transforms, and respects the neatline", () => {
    const svg = [
      '<svg width="200pt" height="100pt">',
      "<defs></defs>",
      '<path d="M 10 10 L 80 10 L 80 50" stroke="black" fill="none" transform="matrix(1 0 0 1 5 0)"/>',
      '<path d="M 150 10 L 190 10" stroke="black" fill="none"/>',
      '<path d="M 20 90 L 60 90" fill="red" stroke="black"/>',
      "</svg>",
    ].join("");

    const pts = parseSvgVectorPoints(svg, {
      pageW: 200,
      pageH: 100,
      neatline: { fx0: 0, fy0: 0, fx1: 0.5, fy1: 0.7 },
    });

    expect(pts).toEqual([
      { x: 15, y: 10 },
      { x: 85, y: 10 },
      { x: 85, y: 50 },
    ]);
  });
});

describe("deriveAutonomousGcpsFromVectors", () => {
  it("matches page vector vertices to cadastre vertices and emits independent GCPs", () => {
    const pagePoints = gridPoints(5, 4);
    const report = deriveAutonomousGcpsFromVectors({
      slug: "synthetic",
      pageW: PAGE_W,
      pageH: PAGE_H,
      seed: seedFile(),
      cadastre: cadastreFromPagePoints(pagePoints),
      pagePoints,
      minGcps: 8,
      maxGcps: 20,
      maxCandidateDistanceM: 2,
      maxResidualM: 0.5,
    });

    expect(report.pass).toBe(true);
    expect(report.seed_candidate_matches).toBe(pagePoints.length);
    expect(report.selected_gcps).toBeGreaterThanOrEqual(8);
    expect(report.residual_max_m).toBeLessThan(0.001);
    expect(report.gcp_file?.gcps.every((g) => g.source === "cadastre-parcel-corner-match")).toBe(true);
    expect(report.gcp_file?.gcps.every((g) => g.independent === true)).toBe(true);
  });
});

describe("deriveAutoSeedGcpsFromVectors", () => {
  it("builds coarse bbox seeds from in-memory vectors and serves the north-up candidate", () => {
    const pagePoints = irregularPoints(10, 6);
    const report = deriveAutoSeedGcpsFromVectors({
      slug: "synthetic",
      pdf: "synthetic.pdf",
      page: 1,
      pageW: PAGE_W,
      pageH: PAGE_H,
      cadastre: cadastreFromPagePoints(pagePoints),
      pagePoints,
      minGcps: 8,
      maxGcps: 20,
      maxCandidateDistanceM: 2,
      maxResidualM: 0.5,
    });

    expect(report.pass).toBe(true);
    expect(report.best?.rotation).toBe(0);
    expect(report.gcp_file?.gcps.length).toBeGreaterThanOrEqual(8);
    expect(report.affine_gate?.pass).toBe(true);
  });
});
