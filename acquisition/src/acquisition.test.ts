import { describe, it, expect } from "vitest";

import { norm } from "./cadastre-clip-sda.js";
import { slugify, parseRole } from "./role-foncier.js";
import { chooseEpsg, computeLotAttrs } from "./lot-attrs-geom.js";
import { representativePoint, strictPointInPolygon } from "./lib/geo.js";
import { inferRoleSchema } from "./lib/parquet.js";
import {
  findPolygonizeCandidateLayers,
  polygonizeLineworkWithTurf,
} from "./recompose-zones-pdf.js";

describe("norm (cadastre-clip-sda slug canonicalisation)", () => {
  it("strips accents and apostrophes, collapses separators", () => {
    expect(norm("Baie-D'Urfé")).toBe("baie-durfe");
    expect(norm("Montréal")).toBe("montreal");
    expect(norm("Sainte-Cécile-de-Milton")).toBe("sainte-cecile-de-milton");
    expect(norm("  --Foo--Bar-- ")).toBe("foo-bar");
  });
});

describe("slugify (role-foncier index key — ASCII-destructive, parity with .py)", () => {
  it("drops non-ASCII (Montréal -> montral)", () => {
    expect(slugify("Montréal")).toBe("montral");
    expect(slugify("Saint-Raymond")).toBe("saint-raymond");
    expect(slugify("Saint-Frédéric")).toBe("saint-frdric");
  });
});

describe("chooseEpsg (MTM/UTM zone selection — identical thresholds to .py)", () => {
  it("maps longitude to the MTM/UTM zone", () => {
    expect(chooseEpsg(-71.9)).toBe(32187); // MTM 7
    expect(chooseEpsg(-73.6)).toBe(32188); // MTM 8
    expect(chooseEpsg(-76.6)).toBe(32189); // MTM 9
    expect(chooseEpsg(-79.6)).toBe(32190); // MTM 10
    expect(chooseEpsg(-83)).toBe(32617); // UTM 17N
    expect(chooseEpsg(-66.5)).toBe(32619); // UTM 19N
  });
});

describe("representativePoint + strictPointInPolygon (anti-invention PIP)", () => {
  const square = {
    type: "Polygon" as const,
    coordinates: [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
    ],
  };
  it("returns an interior point", () => {
    const p = representativePoint(square);
    expect(p).not.toBeNull();
    expect(strictPointInPolygon(p!, square)).toBe(true);
  });
  it("strict PIP excludes a point exactly on the boundary (shapely contains parity)", () => {
    expect(strictPointInPolygon([5, 0], square)).toBe(false); // on edge
    expect(strictPointInPolygon([5, 5], square)).toBe(true); // interior
    expect(strictPointInPolygon([20, 20], square)).toBe(false); // outside
  });
  it("returns null for non-polygon / missing geometry", () => {
    expect(representativePoint(null)).toBeNull();
    expect(representativePoint({ type: "Point", coordinates: [0, 0] })).toBeNull();
  });
});

describe("computeLotAttrs (geometric attrs, anti-invention nulls)", () => {
  it("computes area/perimeter for a ~100m square near Montréal and nulls for empty geom", () => {
    // ~0.001deg square near lon -73.6: area should be a few thousand m².
    const lot = {
      type: "Feature" as const,
      properties: { NO_LOT: "1 234 567" },
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [
            [-73.6, 45.5],
            [-73.599, 45.5],
            [-73.599, 45.501],
            [-73.6, 45.501],
            [-73.6, 45.5],
          ],
        ],
      },
    };
    const a = computeLotAttrs(lot);
    expect(a.no_lot).toBe("1 234 567");
    expect(a._epsg_used).toBe(32188);
    expect(a.superficie_m2).toBeGreaterThan(5000);
    expect(a.superficie_m2).toBeLessThan(12000);
    expect(a.perimetre_m).toBeGreaterThan(300);
    expect(a.frontage_m).not.toBeNull();
    expect(a.profondeur_m).not.toBeNull();

    const empty = computeLotAttrs({
      type: "Feature",
      properties: {},
      geometry: null as never,
    });
    expect(empty.superficie_m2).toBeNull();
    expect(empty.frontage_m).toBeNull();
  });
});

describe("parseRole (MAMH role XML — verbatim extraction, null when absent)", () => {
  const xml = `<?xml version="1.0"?><RL><VERSION>2.8</VERSION><RLM01A>34128</RLM01A><RLM02A>2026</RLM02A>
    <RLUEx>
      <RL0103><RL0103x><RL0103Ax>4 623 401</RL0103Ax></RL0103x><RL0103x><RL0103Ax>4623402</RL0103Ax></RL0103x></RL0103>
      <RL0105A>1000</RL0105A><RL0306A>1</RL0306A><RL0307A>1983</RL0307A><RL0307B>R</RL0307B>
      <RL0308A>182.3</RL0308A><RL0311A>1</RL0311A><RL0404A>285500</RL0404A>
    </RLUEx>
    <RLUEx>
      <RL0103><RL0103x><RL0103Ax>9999999</RL0103Ax></RL0103x></RL0103>
      <RL0105A>6000</RL0105A>
    </RLUEx>
  </RL>`;
  it("extracts coded fields verbatim and leaves absent fields null", () => {
    const lk = parseRole(xml);
    expect(Object.keys(lk).sort()).toEqual(["4 623 401", "4623402", "9999999"]);
    const u = lk["4 623 401"]!;
    expect(u.usage_cubf).toBe("1000");
    expect(u.nb_etages_max).toBe(1);
    expect(u.annee_construction).toBe(1983);
    expect(u.superficie_batiment_m2).toBe(182.3);
    expect(u.valeur_immeuble).toBe(285500);
    expect(u.valeur_terrain).toBeNull(); // RL0402A absent
    const u2 = lk["9999999"]!;
    expect(u2.usage_cubf).toBe("6000");
    expect(u2.superficie_batiment_m2).toBeNull();
  });
});

describe("inferRoleSchema (pandas/pyarrow type-inference parity)", () => {
  it("promotes an int column with a null to DOUBLE, keeps clean ints INT64, strings UTF8", () => {
    const rows = [
      { a: 1, b: 1, c: "x", d: 1.5 },
      { a: 2, b: null, c: "y", d: 2 },
    ];
    const { types } = inferRoleSchema(rows);
    expect(types["a"]).toBe("INT64"); // all ints, no null
    expect(types["b"]).toBe("DOUBLE"); // int + null -> float (pandas rule)
    expect(types["c"]).toBe("UTF8");
    expect(types["d"]).toBe("DOUBLE"); // has a fractional value
  });
});

describe("recompose-zones-pdf polygonize support", () => {
  it("selects zoning boundary layers without selecting OCR/glyph label layers", () => {
    expect(
      findPolygonizeCandidateLayers([
        "PDFDECB_tmp_Other_6",
        "PDFDECB_tmp_Layers_Etiquettes_Zonage_-_Default",
        "PDFDECB_tmp_Layers_Périmètre_d'urbanisation",
        "PDFDECB_tmp_Layers_Zonage",
        "Zonage/Limite_de_zone",
      ]),
    ).toEqual(["PDFDECB_tmp_Layers_Zonage", "Zonage/Limite_de_zone"]);
  });

  it("polygonizes a noded line network into real polygons", () => {
    const out = polygonizeLineworkWithTurf({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[0, 0], [1, 0]] } },
        { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[1, 0], [1, 1]] } },
        { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[1, 1], [0, 1]] } },
        { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[0, 1], [0, 0]] } },
      ],
    });

    expect(out.features).toHaveLength(1);
    expect(out.features[0]?.geometry?.type).toBe("Polygon");
  });
});
