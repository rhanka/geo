import { describe, expect, it } from "vitest";

import {
  CAMERA_FOV_RADIANS,
  DEFAULT_PITCH_MAX_DEG,
  type GeoViewport,
  NORMALIZED_CAMERA_CONVENTION,
  NORMALIZED_ZOOM,
  maxProjectionError,
  normalizeBearing,
  normalizeViewport,
  oneCssPixelLongitudeProbe,
  viewportError,
  worldSizeCssPx,
} from "./viewport.js";

const base: GeoViewport = { center: [-71.2, 46.8], zoom: 8, bearing: 0, pitch: 0 };

describe("normalized zoom + camera constants (§1.5.1)", () => {
  it("world size = tileSize · 2^zoom", () => {
    expect(worldSizeCssPx(0)).toBe(512);
    expect(worldSizeCssPx(3)).toBe(512 * 8);
    expect(NORMALIZED_ZOOM.tileSize).toBe(512);
    expect(NORMALIZED_ZOOM.relativeAltitude).toBe(1.5);
    expect(DEFAULT_PITCH_MAX_DEG).toBe(60);
  });

  it("FOV is derived from the relative altitude (2·atan(0.5/1.5))", () => {
    expect(CAMERA_FOV_RADIANS).toBeCloseTo(2 * Math.atan(0.5 / 1.5), 12);
    expect(NORMALIZED_CAMERA_CONVENTION.altitude).toBe(NORMALIZED_ZOOM.relativeAltitude);
  });
});

describe("normalizeBearing / normalizeViewport", () => {
  it("normalizes bearing into [0, 360)", () => {
    expect(normalizeBearing(370)).toBe(10);
    expect(normalizeBearing(-10)).toBe(350);
    expect(normalizeBearing(360)).toBe(0);
  });

  it("normalizes a valid viewport (bearing mod 360, center/zoom/pitch preserved)", () => {
    expect(normalizeViewport({ ...base, bearing: 450 })).toEqual({ center: [-71.2, 46.8], zoom: 8, bearing: 90, pitch: 0 });
  });

  it("hard-fails on a non-finite value or an out-of-domain pitch", () => {
    expect(() => normalizeViewport({ ...base, zoom: Number.NaN })).toThrow(/nombres finis/);
    expect(() => normalizeViewport({ ...base, pitch: 61 })).toThrow(/domaine commun/);
    expect(() => normalizeViewport({ ...base, pitch: -1 })).toThrow(/domaine commun/);
  });
});

describe("viewport round-trip / equivalence errors (§1.5, the freeze-gate motif)", () => {
  it("normalization preserves a valid viewport within zero error (except bearing wrap)", () => {
    const err = viewportError(normalizeViewport(base), base);
    expect(err.centerDegrees).toBe(0);
    expect(err.zoom).toBe(0);
    expect(err.pitchDegrees).toBe(0);
    expect(err.bearingDegrees).toBe(0);
  });

  it("bearing error is an angular distance (359° vs 1° = 2°)", () => {
    expect(viewportError({ ...base, bearing: 359 }, { ...base, bearing: 1 }).bearingDegrees).toBeCloseTo(2, 12);
  });

  it("maxProjectionError: 0 for identical projected lists, throws on size mismatch", () => {
    expect(maxProjectionError([[0, 0]], [[0, 0]])).toBe(0);
    expect(maxProjectionError([[0, 0]], [[3, 4]])).toBeCloseTo(5, 12);
    expect(() => maxProjectionError([[0, 0]], [])).toThrow(/tailles différentes/);
  });

  it("oneCssPixelLongitudeProbe sits one CSS pixel east of center at the given zoom", () => {
    const probe = oneCssPixelLongitudeProbe(base);
    expect(probe[0] - base.center[0]).toBeCloseTo(360 / worldSizeCssPx(base.zoom), 12);
    expect(probe[1]).toBe(base.center[1]);
  });
});
