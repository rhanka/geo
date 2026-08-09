import { describe, expect, it } from "vitest";

import { detectRasterCorners, edgeMaskFromGray, parsePgm, patchEdgeScore, type GrayImage } from "./t2-raster-register.js";

function blank(width: number, height: number, value = 255): GrayImage {
  return { width, height, data: new Uint8Array(width * height).fill(value) };
}

function setPixel(img: GrayImage, x: number, y: number, value: number): void {
  img.data[y * img.width + x] = value;
}

function drawCross(img: GrayImage, cx: number, cy: number): void {
  for (let x = cx - 8; x <= cx + 8; x++) setPixel(img, x, cy, 0);
  for (let y = cy - 8; y <= cy + 8; y++) setPixel(img, cx, y, 0);
}

describe("t2-raster-register image helpers", () => {
  it("parses binary PGM bytes", () => {
    const pgm = Buffer.concat([Buffer.from("P5\n2 2\n255\n", "ascii"), Buffer.from([0, 127, 200, 255])]);
    expect(parsePgm(pgm)).toEqual({
      width: 2,
      height: 2,
      data: new Uint8Array([0, 127, 200, 255]),
    });
  });

  it("detects a strong raster corner in a simple cross", () => {
    const img = blank(48, 48);
    drawCross(img, 24, 24);
    const edges = edgeMaskFromGray(img, 40, 120);
    const corners = detectRasterCorners(img, edges, {
      maxPoints: 20,
      pageW: 48,
      pageH: 48,
      scale: 1,
      minDistancePx: 4,
    });
    expect(corners.some((p) => Math.abs(p.x - 24) <= 3 && Math.abs(p.y - 24) <= 3)).toBe(true);
  });

  it("scores matching edge patches higher than unrelated patches", () => {
    const a = blank(48, 48);
    const b = blank(48, 48);
    const c = blank(48, 48);
    drawCross(a, 24, 24);
    drawCross(b, 25, 23);
    drawCross(c, 8, 8);
    const ae = edgeMaskFromGray(a, 40, 120);
    const be = edgeMaskFromGray(b, 40, 120);
    const ce = edgeMaskFromGray(c, 40, 120);
    expect(patchEdgeScore(ae, be, 24, 24, 25, 23)).toBeGreaterThan(0.7);
    expect(patchEdgeScore(ae, ce, 24, 24, 24, 24)).toBeLessThan(0.2);
  });
});
