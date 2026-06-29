import { describe, expect, it } from "vitest";

import { parseAdressesQuebec } from "./adresses-quebec-parser.js";
import {
  adressesQuebecBeauharnoisJson,
  adressesQuebecValleyfieldJson,
} from "./adresses-quebec.fixture.js";

describe("parseAdressesQuebec (REAL committed terrAPI bytes, anti-invention)", () => {
  it("parses the REAL Salaberry addresses verbatim (code / nom / nbUnite)", () => {
    const { adresses } = parseAdressesQuebec(adressesQuebecValleyfieldJson());
    expect(adresses).toHaveLength(3);
    const first = adresses[0]!;
    expect(first.code).toBe("000464c34bfd4f25862f208af2e3dbf5J6S6A5");
    expect(first.nom).toBe(
      "24 rue Paquette, Salaberry-de-Valleyfield J6S6A5",
    );
    expect(first.nbUnite).toBe(1);
    expect(adresses.map((a) => a.nom)).toEqual([
      "24 rue Paquette, Salaberry-de-Valleyfield J6S6A5",
      "561 avenue de Grande-Île, Salaberry-de-Valleyfield J6S3N5",
      "310 boulevard Pie-XII, Salaberry-de-Valleyfield J6S6P7",
    ]);
  });

  it("parses the REAL Beauharnois addresses verbatim (different municipality)", () => {
    const { adresses } = parseAdressesQuebec(adressesQuebecBeauharnoisJson());
    expect(adresses).toHaveLength(3);
    expect(adresses.map((a) => a.nom)).toEqual([
      "279 chemin Saint-Louis, Beauharnois J6N2J3",
      "28 rue Trudeau, Beauharnois J6N2L4",
      "568 2 rue Richard, Beauharnois J6N2P3",
    ]);
    // Province-wide Adresses Québec key, verbatim.
    expect(adresses[0]!.code).toBe("0002bd87474842c68253f14f49c39f05J6N2J3");
  });

  it("never fabricates coordinates or lots — the sample carries NO geometry", () => {
    // The committed sample was fetched with geometry=0: no `geometry` member and
    // no lot number exists in the bytes, so the parser shape has no geom/lot field.
    const parsed = parseAdressesQuebec(adressesQuebecValleyfieldJson());
    for (const a of parsed.adresses) {
      expect(a).not.toHaveProperty("geom");
      expect(a).not.toHaveProperty("geometry");
      expect(a).not.toHaveProperty("noLot");
    }
  });

  it("drops a feature missing code or nom (anti-invention), keeps the valid ones", () => {
    const json = JSON.stringify({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { code: "X1", nom: "1 rue A", nbUnite: "2" } },
        { type: "Feature", properties: { code: "", nom: "no code" } },
        { type: "Feature", properties: { nom: "missing code" } },
        { type: "Feature", properties: { code: "X2" } },
      ],
    });
    const { adresses } = parseAdressesQuebec(json);
    expect(adresses).toHaveLength(1);
    expect(adresses[0]!.code).toBe("X1");
    expect(adresses[0]!.nbUnite).toBe(2);
  });

  it("yields nbUnite=null when absent/unparseable (never invents a count)", () => {
    const json = JSON.stringify({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { code: "X1", nom: "1 rue A", nbUnite: "n/a" } },
        { type: "Feature", properties: { code: "X2", nom: "2 rue B" } },
      ],
    });
    const { adresses } = parseAdressesQuebec(json);
    expect(adresses[0]!.nbUnite).toBeNull();
    expect(adresses[1]!.nbUnite).toBeNull();
  });

  it("returns an empty list on non-JSON or a non-array features (never throws)", () => {
    expect(parseAdressesQuebec("not json").adresses).toEqual([]);
    expect(parseAdressesQuebec("{}").adresses).toEqual([]);
    expect(
      parseAdressesQuebec(JSON.stringify({ features: "nope" })).adresses,
    ).toEqual([]);
  });
});
