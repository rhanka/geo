import { describe, expect, it } from "vitest";

import { parseRole, parseRoleLarge } from "./role-foncier.js";

/** Minimal but structurally faithful MAMH rôle: header + N <RLUEx> siblings. */
function roleXml(units: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<RL><RLM01A>66023</RLM01A><RLM02A>2026</RLM02A>${units}</RL>`
  );
}

// RL0101Ex porte le code générique à 2 lettres du rôle réel (RU = rue).
const UNIT_A =
  `<RLUEx>` +
  `<RL0101><RL0101x><RL0101Ax>1234</RL0101Ax><RL0101Ex>RU</RL0101Ex>` +
  `<RL0101Gx>SAINTE-CATHERINE</RL0101Gx></RL0101x></RL0101>` +
  `<RL0103><RL0103x><RL0103Ax>1000001</RL0103Ax></RL0103x></RL0103>` +
  `<RL0105A>1000</RL0105A><RL0308A>120.5</RL0308A>` +
  `</RLUEx>`;

// Two lots on one unit — the rôle attaches a unit to N matricules.
const UNIT_B =
  `<RLUEx>` +
  `<RL0101><RL0101x><RL0101Ax>50</RL0101Ax><RL0101Gx>Sherbrooke</RL0101Gx></RL0101x></RL0101>` +
  `<RL0103><RL0103x><RL0103Ax>2000001</RL0103Ax></RL0103x>` +
  `<RL0103x><RL0103Ax>2000002</RL0103Ax></RL0103x></RL0103>` +
  `</RLUEx>`;

// No matricule at all -> must be skipped by both paths.
const UNIT_NO_LOT = `<RLUEx><RL0105A>9999</RL0105A></RLUEx>`;

describe("parseRoleLarge (chunked path for rôles above Node's string cap)", () => {
  it("produces exactly the same lookup as the whole-document path", () => {
    const buf = Buffer.from(roleXml(UNIT_A + UNIT_B), "utf8");
    expect(parseRoleLarge(buf)).toEqual(parseRole(buf));
  });

  it("extracts address, matricules and the header code_geo/millésime", () => {
    const out = parseRoleLarge(Buffer.from(roleXml(UNIT_A), "utf8"));
    expect(Object.keys(out)).toEqual(["1000001"]);
    expect(out["1000001"]!.adresse).toBe("1234 rue Sainte-Catherine");
    expect(out["1000001"]!.superficie_batiment_m2).toBe(120.5);
    expect(out["1000001"]!._source_code_geo).toBe("66023");
    expect(out["1000001"]!._source_millesime).toBe("2026");
  });

  it("maps every matricule of a multi-lot unit", () => {
    const out = parseRoleLarge(Buffer.from(roleXml(UNIT_B), "utf8"));
    expect(Object.keys(out).sort()).toEqual(["2000001", "2000002"]);
    expect(out["2000002"]!.adresse).toBe("50 Sherbrooke");
  });

  it("skips a unit without matricule instead of swallowing the next one", () => {
    const out = parseRoleLarge(Buffer.from(roleXml(UNIT_NO_LOT + UNIT_A), "utf8"));
    expect(Object.keys(out)).toEqual(["1000001"]);
  });

  it("keeps the first occurrence but prefers one carrying building area", () => {
    const bare = `<RLUEx><RL0103><RL0103x><RL0103Ax>3000001</RL0103Ax></RL0103x></RL0103></RLUEx>`;
    const withArea =
      `<RLUEx><RL0103><RL0103x><RL0103Ax>3000001</RL0103Ax></RL0103x></RL0103>` +
      `<RL0308A>77</RL0308A></RLUEx>`;
    const buf = Buffer.from(roleXml(bare + withArea), "utf8");
    expect(parseRoleLarge(buf)["3000001"]!.superficie_batiment_m2).toBe(77);
    expect(parseRoleLarge(buf)).toEqual(parseRole(buf));
  });

  it("tolerates a self-closing unit without merging its neighbours", () => {
    const buf = Buffer.from(roleXml(`<RLUEx/>` + UNIT_A), "utf8");
    expect(Object.keys(parseRoleLarge(buf))).toEqual(["1000001"]);
  });

  it("does not mistake a longer tag name for a unit", () => {
    const buf = Buffer.from(roleXml(`<RLUExtra><RL0103Ax>9</RL0103Ax></RLUExtra>` + UNIT_A), "utf8");
    expect(Object.keys(parseRoleLarge(buf))).toEqual(["1000001"]);
  });
});
