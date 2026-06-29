import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseRoleEvaluation } from "./role-evaluation-parser.js";

const here = dirname(fileURLToPath(import.meta.url));
const samplesDir = join(
  here,
  "_spikes",
  "roles-evaluation-fonciere-mamh",
  "samples",
);

const VALLEYFIELD_XML = readFileSync(
  join(samplesDir, "RL70052_2026.first-record.xml"),
  "utf-8",
);
const BEAUHARNOIS_XML = readFileSync(
  join(samplesDir, "RL70022_2026.first-record.xml"),
  "utf-8",
);

/**
 * REAL data assertions — every number below is verbatim from the committed MAMH
 * role XML samples (anti-invention). No field is fabricated.
 */
describe("parseRoleEvaluation (REAL MAMH role XML)", () => {
  it("extracts the municipality code and year from the header", () => {
    const role = parseRoleEvaluation(VALLEYFIELD_XML);
    expect(role.codeMamh).toBe("70052");
    expect(role.year).toBe("2026");
  });

  it("extracts every NO_LOT (RL0103Ax) as a distinct lot mention", () => {
    const role = parseRoleEvaluation(VALLEYFIELD_XML);
    // The first record lists 5 cadastre lots.
    expect(role.units).toHaveLength(1);
    const unit = role.units[0]!;
    expect(unit.noLots).toEqual([
      "4193751",
      "4193752",
      "5559304",
      "5650993",
      "5650994",
    ]);
  });

  it("assembles the matricule from RL0104A/B/C", () => {
    const role = parseRoleEvaluation(VALLEYFIELD_XML);
    expect(role.units[0]!.matricule).toBe("5114-86-8189");
  });

  it("reads the total role value (RL0404A) and reference date (RL0401A)", () => {
    const role = parseRoleEvaluation(VALLEYFIELD_XML);
    const unit = role.units[0]!;
    // RL0404A (valeur totale de l'immeuble) — equals RL0402A here (terrain only).
    expect(unit.valeur).toBe(2748500);
    expect(unit.valeurTerrain).toBe(2748500);
    expect(unit.valeurDate).toBe("2024-07-01");
  });

  it("never invents an owner (PII excluded — always non-disponible)", () => {
    const role = parseRoleEvaluation(VALLEYFIELD_XML);
    expect(role.units[0]!.owner).toBe("non-disponible");
  });

  it("parses the Beauharnois sample (different code + lot)", () => {
    const role = parseRoleEvaluation(BEAUHARNOIS_XML);
    expect(role.codeMamh).toBe("70022");
    expect(role.units[0]!.noLots).toContain("4716029");
    expect(role.units[0]!.valeur).toBe(444000);
  });

  it("is tolerant: an empty document yields zero units, no throw", () => {
    const role = parseRoleEvaluation("<RL></RL>");
    expect(role.units).toHaveLength(0);
    expect(role.codeMamh).toBe("non-disponible");
  });
});
