import { describe, expect, it } from "vitest";

import {
  TERRAPI_ADRESSES_BEAUHARNOIS_JSON,
  TERRAPI_ADRESSES_VALLEYFIELD_JSON,
} from "./fixtures.js";
import { parseQcCivicAddresses } from "./parser.js";

describe("parseQcCivicAddresses (terrAPI FeatureCollection → public addresses)", () => {
  it("parses the Valleyfield sample verbatim (anti-invention, no geometry)", () => {
    const { adresses } = parseQcCivicAddresses(TERRAPI_ADRESSES_VALLEYFIELD_JSON);
    expect(adresses).toHaveLength(3);
    expect(adresses[0]).toEqual({
      code: "000464c34bfd4f25862f208af2e3dbf5J6S6A5",
      nom: "24 rue Paquette, Salaberry-de-Valleyfield J6S6A5",
      nbUnite: 1,
    });
    // No geometry / no lot ever fabricated.
    expect(adresses[0]).not.toHaveProperty("geom");
    expect(adresses[0]).not.toHaveProperty("geometry");
  });

  it("parses the Beauharnois sample (different municipality)", () => {
    const { adresses } = parseQcCivicAddresses(TERRAPI_ADRESSES_BEAUHARNOIS_JSON);
    expect(adresses).toHaveLength(2);
    expect(adresses[0]?.nom).toBe("279 chemin Saint-Louis, Beauharnois J6N2J3");
  });

  it("coerces a string nbUnite to an integer count", () => {
    const { adresses } = parseQcCivicAddresses(
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          { type: "Feature", properties: { code: "abc", nom: "1 rue X, Y", nbUnite: "4" } },
        ],
      }),
    );
    expect(adresses[0]?.nbUnite).toBe(4);
  });

  it("yields null nbUnite when absent or unparseable (anti-invention)", () => {
    const { adresses } = parseQcCivicAddresses(
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          { type: "Feature", properties: { code: "abc", nom: "1 rue X, Y" } },
          { type: "Feature", properties: { code: "def", nom: "2 rue X, Y", nbUnite: "n/a" } },
        ],
      }),
    );
    expect(adresses[0]?.nbUnite).toBeNull();
    expect(adresses[1]?.nbUnite).toBeNull();
  });

  it("skips features missing code or nom (never invented)", () => {
    const { adresses } = parseQcCivicAddresses(
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          { type: "Feature", properties: { nom: "no code, Y" } },
          { type: "Feature", properties: { code: "x" } },
          { type: "Feature", properties: { code: "ok", nom: "3 rue X, Y", nbUnite: "1" } },
        ],
      }),
    );
    expect(adresses).toHaveLength(1);
    expect(adresses[0]?.code).toBe("ok");
  });

  it("returns an empty list for non-JSON or a non-array features (never throws)", () => {
    expect(parseQcCivicAddresses("not json").adresses).toEqual([]);
    expect(parseQcCivicAddresses(JSON.stringify({ features: "nope" })).adresses).toEqual([]);
  });
});
