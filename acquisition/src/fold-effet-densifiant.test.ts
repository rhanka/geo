import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { configFromArgs, countFeatureProperties, readEntries } from "./fold-effet-densifiant.js";

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

  it("rejects a known effect without both documentary sources", () => {
    const path = artifactFile({ ...base, source_apres: "  ", densite_avant: 2, densite_apres: 2, effet_densifiant: "stable" });
    expect(() => readEntries(path)).toThrow(/source_apres manquante pour effet connu H-3/);
  });
});

describe("runner artifact path", () => {
  it("resolves a slug artifact from the repository root", () => {
    const config = configFromArgs([
      "--slug", "saint-odilon-de-cranbourne",
      "--old-reglement", "324-2014",
      "--new-reglement", "394-2021",
      "--old-millesime", "2015",
      "--new-millesime", "2022",
    ]);
    expect(config.artifact).toBe(join(ROOT, "work", "effet-densifiant", "saint-odilon-de-cranbourne.json"));
  });
});

describe("additive fold observability", () => {
  it("counts every served feature property before and after a fold", () => {
    expect(countFeatureProperties([
      { properties: { zone_code: "A-1", effet_densifiant: "inconnu" } },
      { properties: { zone_code: "A-2" } },
      {},
    ])).toBe(3);
  });
});

describe("golden: the 3 hand-served artifacts satisfy the lock", () => {
  // Regression gate (both reviewers): the lane must reproduce the manually served cities,
  // and those artifacts must themselves be internally consistent under the new invariant.
  for (const slug of ["saint-stanislas-de-kostka", "sutton", "saint-raphael", "coaticook", "saint-odilon-de-cranbourne"]) {
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

describe("readEntries refuses a citation that names a DRAFT by-law", () => {
  // 85 sutton effects reached production citing a document whose page 3 reads
  // "Projet de Règlement de zonage numéro xxxx". The citation was PRESENT, so the
  // existing guard passed it — it never read what the citation said.
  const known = { ...base, densite_avant: 1, densite_apres: 2, effet_densifiant: "densifie" as const };

  it("rejects a `projet de règlement` in source_apres", () => {
    const path = artifactFile({ ...known, source_apres: "358 Annexe B, Projet de Règlement de zonage numéro xxxx" });
    expect(() => readEntries(path)).toThrow(/PROJET de règlement/i);
  });

  it("rejects it unaccented too — the same document prints both forms", () => {
    const path = artifactFile({ ...known, source_avant: "Projet de reglement 115-12-2020 p.3" });
    expect(() => readEntries(path)).toThrow(/PROJET de règlement/i);
  });

  it("rejects an unfilled template number even without the word projet", () => {
    const path = artifactFile({ ...known, source_apres: "Règlement de zonage numéro xxxx, 27 mai 2026" });
    expect(() => readEntries(path)).toThrow(/PROJET de règlement/i);
  });

  it("accepts a citation naming a by-law in force", () => {
    const path = artifactFile({ ...known, source_apres: "Règlement 394-2021 Annexe B p. B-I" });
    expect(readEntries(path).size).toBe(1);
  });

  it("leaves `inconnu` alone: it asserts nothing, so it cites nothing", () => {
    const path = artifactFile({
      ...base, densite_avant: null, densite_apres: null, effet_densifiant: "inconnu" as const,
      source_apres: "Projet de Règlement numéro xxxx",
    });
    expect(readEntries(path).size).toBe(1);
  });
});
