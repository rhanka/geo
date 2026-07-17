import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { readEntries } from "./fold-effet-densifiant.js";

const ROOT = join(__dirname, "..", "..");

/** Write a one-entry artifact to a temp file and return its path. */
function artifactFile(entry: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "effet-densifiant-test-"));
  const path = join(dir, "a.json");
  writeFileSync(path, JSON.stringify([entry]), "utf8");
  return path;
}

const base = {
  zone_code: "H-3",
  source_avant: "x",
  source_apres: "y",
  methode: "explicit" as const,
  confidence: "high",
  steve_coherence: "match" as const,
  effet_densifiant_delta: null,
};

describe("readEntries cross-field anti-invention lock", () => {
  it("rejects densifie with null counts (the structural hole a fleet lane must not have)", () => {
    const path = artifactFile({ ...base, densite_avant: null, densite_apres: null, effet_densifiant: "densifie" });
    expect(() => readEntries(path)).toThrow(/compteur null.*doit être 'inconnu'/);
  });

  it("rejects an effet that contradicts the counts (3->2 cannot be densifie)", () => {
    const path = artifactFile({ ...base, densite_avant: 3, densite_apres: 2, effet_densifiant: "densifie" });
    expect(() => readEntries(path)).toThrow(/contredit les compteurs 3->2.*dérivé=reduit/);
  });

  it("rejects stable when the counts actually rise", () => {
    const path = artifactFile({ ...base, densite_avant: 1, densite_apres: 3, effet_densifiant: "stable" });
    expect(() => readEntries(path)).toThrow(/dérivé=densifie/);
  });

  it("accepts a real densification (1->3 = densifie)", () => {
    const path = artifactFile({ ...base, densite_avant: 1, densite_apres: 3, effet_densifiant: "densifie" });
    expect(readEntries(path).get("H-3")?.effet_densifiant).toBe("densifie");
  });

  it("accepts inconnu when a count is null", () => {
    const path = artifactFile({ ...base, densite_avant: 2, densite_apres: null, effet_densifiant: "inconnu" });
    expect(readEntries(path).get("H-3")?.effet_densifiant).toBe("inconnu");
  });
});

describe("golden: the 3 hand-served artifacts satisfy the lock", () => {
  // Regression gate (both reviewers): the lane must reproduce the manually served cities,
  // and those artifacts must themselves be internally consistent under the new invariant.
  for (const slug of ["saint-stanislas-de-kostka", "sutton", "saint-raphael", "coaticook"]) {
    it(`${slug} passes readEntries without throwing`, () => {
      const path = join(ROOT, "work", "effet-densifiant", `${slug}.json`);
      const entries = readEntries(path);
      expect(entries.size).toBeGreaterThan(0);
      // Every served densifie/reduit/stable must be numerically justified.
      for (const e of entries.values()) {
        if (e.effet_densifiant === "densifie") expect(e.densite_apres! > e.densite_avant!).toBe(true);
        if (e.effet_densifiant === "reduit") expect(e.densite_apres! < e.densite_avant!).toBe(true);
        if (e.effet_densifiant === "inconnu") {
          expect(e.densite_avant === null || e.densite_apres === null).toBe(true);
        }
      }
    });
  }
});
