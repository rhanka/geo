import { describe, expect, it } from "vitest";

import { buildDensityDiscoveryWorklist } from "./density-document-discovery-worklist.js";

function baseline(): string {
  return JSON.stringify({
    rows: Array.from({ length: 56 }, (_, index) => ({
      slug: `ville-${String(index).padStart(2, "0")}`,
      category: "acquise_sans_densite",
      manifest_source_url: index === 0 ? "non-disponible" : `https://ville-${index}.example/grille.pdf`,
      manifest_snapshot: "2026-07-20",
    })),
  });
}

function directory(): string {
  return JSON.stringify({
    entries: Object.fromEntries(Array.from({ length: 56 }, (_, index) => {
      const slug = `ville-${String(index).padStart(2, "0")}`;
      return [slug, {
        slug,
        name: `Ville ${index}`,
        mamhCode: String(index).padStart(5, "0"),
        website: `https://ville-${index}.example`,
      }];
    })),
  });
}

describe("density document discovery worklist", () => {
  it("should materialise only the requested stable lot and preserve the previous-document exclusion", () => {
    const previous = new Map([
      ["ville-12", { key: "sources/qc-zonage-grilles/ville-12.pdf", sha256: "b".repeat(64) }],
    ]);
    const worklist = buildDensityDiscoveryWorklist(baseline(), directory(), 2, previous);
    expect(worklist.targets).toHaveLength(12);
    expect(worklist.targets[0]).toMatchObject({
      slug: "ville-12",
      excludedSourceUrl: "https://ville-12.example/grille.pdf",
      excludedSourceSha256: "b".repeat(64),
      excludedSourceStorageKey: "sources/qc-zonage-grilles/ville-12.pdf",
    });
    expect(worklist.targets.at(-1)?.slug).toBe("ville-23");
  });

  it("should keep an unavailable old source explicit instead of inventing an URL", () => {
    const worklist = buildDensityDiscoveryWorklist(baseline(), directory(), 1, new Map());
    expect(worklist.targets[0]).toMatchObject({
      slug: "ville-00",
      excludedSourceUrl: null,
      excludedSourceSha256: null,
      excludedSourceStorageKey: null,
    });
  });

  it("should reject a directory that cannot prove the MAMH identity", () => {
    const bad = JSON.parse(directory()) as { entries: Record<string, unknown> };
    delete bad.entries["ville-00"];
    expect(() => buildDensityDiscoveryWorklist(baseline(), JSON.stringify(bad), 1, new Map()))
      .toThrow(/identité MAMH incomplète/);
  });
});
