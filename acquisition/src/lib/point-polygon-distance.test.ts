import { describe, expect, it } from "vitest";

import { metersPerDegree, pointToPolygonsBoundaryMeters, type Poly } from "./point-polygon-distance.js";

// Un carré de zone autour de la latitude québécoise (~45,6°), en EPSG:4326.
// bornes lon [-73.001, -72.999], lat [45.599, 45.601].
const SQUARE: Poly = [[
  [-73.001, 45.599],
  [-72.999, 45.599],
  [-72.999, 45.601],
  [-73.001, 45.601],
  [-73.001, 45.599],
]];

describe("metersPerDegree (WGS84, lat ~45,6°)", () => {
  it("longitude nettement plus courte que latitude (cos φ)", () => {
    const { lat, lon } = metersPerDegree(45.6);
    // Référence projConstants : mlat = 111320 (plat), mlon = 111320·cos(45,6°) ≈ 77900.
    expect(lat).toBe(111320);
    expect(lon).toBeGreaterThan(77700);
    expect(lon).toBeLessThan(78100);
  });
});

describe("pointToPolygonsBoundaryMeters (ENU local, mètres)", () => {
  it("point sur le bord est ~0 m", () => {
    const d = pointToPolygonsBoundaryMeters([-72.999, 45.6], [SQUARE]);
    expect(d).toBeLessThan(0.5);
  });

  it("0,0001° à l'est du bord est ≈ 7,8 m (cohérent T=10m)", () => {
    // lat 45,6 : 0,0001° lon ≈ 7,8 m.
    const d = pointToPolygonsBoundaryMeters([-72.9989, 45.6], [SQUARE]);
    expect(d).toBeGreaterThan(7.3);
    expect(d).toBeLessThan(8.3);
  });

  it("0,0005° à l'est du bord est ≈ 39 m (bande mismatch 10–50m)", () => {
    const d = pointToPolygonsBoundaryMeters([-72.9985, 45.6], [SQUARE]);
    expect(d).toBeGreaterThan(35);
    expect(d).toBeLessThan(43);
  });

  it("0,001° à l'est du bord est ≈ 78 m (résidu >50m)", () => {
    const d = pointToPolygonsBoundaryMeters([-72.998, 45.6], [SQUARE]);
    expect(d).toBeGreaterThan(74);
    expect(d).toBeLessThan(82);
  });

  it("point intérieur renvoie la distance au bord le plus proche (>0), pas 0", () => {
    // centre du carré : ~à mi-hauteur/largeur. Bord le plus proche = est/ouest
    // (0,001° lon ≈ 78 m) plus proche que nord/sud (0,001° lat ≈ 111 m).
    const d = pointToPolygonsBoundaryMeters([-73.0, 45.6], [SQUARE]);
    expect(d).toBeGreaterThan(74);
    expect(d).toBeLessThan(82);
  });

  it("coin nord-est : distance diagonale (hypoténuse) au sommet", () => {
    // 0,0001° est + 0,0001° nord du coin (-72.999, 45.601) → hors, ~hypot(7,8 ; 11,1)≈13,6 m
    const d = pointToPolygonsBoundaryMeters([-72.9989, 45.6011], [SQUARE]);
    expect(d).toBeGreaterThan(12);
    expect(d).toBeLessThan(15);
  });

  it("polygones vides → Infinity (anti-invention, aucune distance fabriquée)", () => {
    expect(pointToPolygonsBoundaryMeters([-73, 45.6], [])).toBe(Infinity);
    expect(pointToPolygonsBoundaryMeters([-73, 45.6], [[[]]])).toBe(Infinity);
  });
});
