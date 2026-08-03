import { describe, expect, it } from "vitest";

import { DEFAULT_CAPTURE_SOURCE, buildCaptureTargets } from "./pv-decouverte-worklist.js";

const candidates = [
  { slug: "terrebonne", candidate_url: "https://terrebonne.ca/a.pdf" },
  { slug: "terrebonne", candidate_url: "https://terrebonne.ca/b.pdf" },
  { slug: "laval", candidate_url: "https://laval.ca/c.pdf" },
] as const;

describe("buildCaptureTargets", () => {
  it("défaut opérationnel = pv-index (clé raw/pv-index/cas/ de la couverture)", () => {
    expect(DEFAULT_CAPTURE_SOURCE).toBe("pv-index");
  });

  it("--source=pv-index : chaque cible porte source=pv-index", () => {
    const targets = buildCaptureTargets(candidates, "pv-index", 0);
    expect(targets.map((target) => target.source)).toEqual(["pv-index", "pv-index"]);
    expect(targets.map((target) => target.slug)).toEqual(["laval", "terrebonne"]);
    expect(targets.find((target) => target.slug === "terrebonne")?.urls).toEqual([
      "https://terrebonne.ca/a.pdf",
      "https://terrebonne.ca/b.pdf",
    ]);
  });

  it("--source=pv-discovery : la valeur explicite est propagée telle quelle", () => {
    const targets = buildCaptureTargets(candidates, "pv-discovery", 0);
    expect(targets.every((target) => target.source === "pv-discovery")).toBe(true);
  });

  it("respecte le plafond par municipalité", () => {
    const targets = buildCaptureTargets(candidates, "pv-index", 1);
    expect(targets.find((target) => target.slug === "terrebonne")?.urls).toEqual([
      "https://terrebonne.ca/a.pdf",
    ]);
  });

  it("écarte les municipalités sans URL", () => {
    const targets = buildCaptureTargets([], "pv-index", 0);
    expect(targets).toEqual([]);
  });
});
