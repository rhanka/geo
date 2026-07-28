import { describe, expect, it } from "vitest";

import {
  buildDensityDiscoveryResumeWorklists,
  buildDensityDiscoverySeeds,
  densityTextHits,
  densityNormValueHits,
  discoverDensityLinks,
  equivalentDocumentUrl,
  hasHardProjectMarker,
  interestingCdxDocuments,
  interestingSitemapLocations,
  parseCdxDocuments,
  parseDensityDiscoveryBaseline,
  sitemapLocations,
  stableDensityDiscoveryLots,
  waybackScope,
  waybackSnapshotOriginalUrl,
  type DensityDiscoveryTarget,
  type DensityDiscoveryWorklist,
} from "./density-document-discovery.js";

const target: DensityDiscoveryTarget = {
  slug: "saint-exemple",
  name: "Saint-Exemple",
  mamhCode: "12345",
  website: "https://municipalites-du-quebec.ca/saint-exemple",
  excludedSourceUrl: "https://municipalites-du-quebec.ca/saint-exemple/docs/zonage.pdf",
  excludedSourceSha256: "a".repeat(64),
  excludedSourceStorageKey: "sources/qc-zonage-grilles/saint-exemple.pdf",
  baselineSnapshot: "2026-07-20",
};

describe("density document discovery closed scope", () => {
  it("should require exactly the 56 acquired-without-density slugs", () => {
    const rows = Array.from({ length: 56 }, (_, index) => ({
      slug: `ville-${String(index).padStart(2, "0")}`,
      category: "acquise_sans_densite",
      manifest_source_url: "https://example.test/grille.pdf",
      manifest_snapshot: "2026-07-20",
    }));
    expect(parseDensityDiscoveryBaseline({ rows })).toHaveLength(56);
    expect(() => parseDensityDiscoveryBaseline({ rows: rows.slice(0, 55) })).toThrow(/attendu 56/);
    expect(() => parseDensityDiscoveryBaseline({ rows: [...rows, rows[0]] })).toThrow(/attendu 56/);
  });

  it("should create stable short lots of 12,12,12,12,8", () => {
    expect(stableDensityDiscoveryLots(Array.from({ length: 56 }, (_, index) => index)).map((lot) => lot.length))
      .toEqual([12, 12, 12, 12, 8]);
  });

  it("should resume only measured pending slugs in immutable short lots", () => {
    const worklists: DensityDiscoveryWorklist[] = [0, 12, 24].map((offset, index) => ({
      contract: "density-document-discovery/v1",
      baselineKey: "work/coverage/baseline.json",
      baselineSha256: "a".repeat(64),
      lot: index + 1,
      lots: 3,
      targets: Array.from({ length: 12 }, (_, item) => ({
        ...target,
        slug: `ville-${String(offset + item).padStart(2, "0")}`,
      })),
    }));
    const pending = new Set(Array.from({ length: 25 }, (_, index) => `ville-${String(index).padStart(2, "0")}`));
    const resume = buildDensityDiscoveryResumeWorklists(worklists, pending, 6);
    expect(resume.map((lot) => lot.targets.length)).toEqual([9, 8, 8]);
    expect(resume.map((lot) => lot.lot)).toEqual([6, 7, 8]);
    expect(resume.every((lot) => lot.lots === 8)).toBe(true);
    expect(() =>
      buildDensityDiscoveryResumeWorklists(worklists, new Set(["hors-perimetre"]), 6),
    ).toThrow(/hors périmètre/);
  });
});

describe("density document discovery seeds", () => {
  it("should keep a shared-host municipal path in the Wayback scope", () => {
    expect(waybackScope(target.website)).toBe("municipalites-du-quebec.ca/saint-exemple");
  });

  it("should search siblings, sitemaps and CDX without refetching the excluded PDF", () => {
    const seeds = buildDensityDiscoverySeeds(target);
    expect(seeds.some((seed) => seed.url === target.excludedSourceUrl)).toBe(false);
    expect(seeds.some((seed) => seed.url === "https://municipalites-du-quebec.ca/saint-exemple/docs/")).toBe(true);
    expect(seeds.some((seed) => seed.kind === "sitemap")).toBe(true);
    const cdx = seeds.find((seed) => seed.kind === "cdx");
    expect(cdx?.url).toContain("municipalites-du-quebec.ca%2Fsaint-exemple");
  });

  it("should retain an excluded HTML portal as navigation to another document", () => {
    const portal = "https://ville.example/reglements-en-vigueur";
    const seeds = buildDensityDiscoverySeeds({
      ...target,
      website: "https://ville.example",
      excludedSourceUrl: portal,
    });
    expect(seeds).toContainEqual({
      url: portal,
      strategy: "sibling",
      kind: "html",
    });
  });
});

describe("density document discovery link recall", () => {
  it("should treat scheme and www aliases as the same excluded document", () => {
    expect(equivalentDocumentUrl(
      "https://www.municipaliteauclair.ca/media/grille.xls",
      "http://municipaliteauclair.ca/media/grille.xls",
    )).toBe(true);
    expect(equivalentDocumentUrl(
      "https://municipaliteauclair.ca/media/autre-grille.xls",
      "https://municipaliteauclair.ca/media/grille.xls",
    )).toBe(false);
  });

  it("should accept an opaque sibling, a spreadsheet and a zone sheet while excluding a project", () => {
    const html = `
      <a href="/file-18340">Grille des usages et normes</a>
      <a href="/docs/normes.xlsx">Spécifications et logements/ha</a>
      <a href="/zones/H-115-12-2020.pdf">Zone H-115</a>
      <a href="/docs/premier-projet-grille.pdf">Premier projet de règlement — grille</a>
      <a href="/docs/current.pdf">Document déjà acquis</a>
    `;
    const result = discoverDensityLinks(
      html,
      "https://ville.example/urbanisme/",
      "https://ville.example/docs/current.pdf",
    );
    expect(result.documents.map((link) => link.url).sort()).toEqual([
      "https://ville.example/docs/normes.xlsx",
      "https://ville.example/file-18340",
      "https://ville.example/zones/H-115-12-2020.pdf",
    ].sort());
    expect(result.documents.find((link) => link.url.includes("H-115"))?.strategy).toBe("zone-sheet");
  });

  it("should surface a linked municipal SIG as a candidate page", () => {
    const result = discoverDensityLinks(
      `<a href="https://experience.arcgis.com/experience/abc123">Portail cartographique de zonage</a>`,
      "https://ville.example/urbanisme",
      null,
    );
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]?.strategy).toBe("sig");
  });
});

describe("sitemap and CDX discovery", () => {
  it("should recover the original URL from a raw Wayback snapshot", () => {
    expect(waybackSnapshotOriginalUrl(
      "https://web.archive.org/web/20240118122714id_/http://batiscan.ca/docs/grille.pdf",
    )).toBe("http://batiscan.ca/docs/grille.pdf");
    expect(waybackSnapshotOriginalUrl("https://ville.example/grille.pdf")).toBeNull();
  });

  it("should follow child sitemaps and retain density documents", () => {
    const urls = sitemapLocations(
      `<sitemapindex>
        <sitemap><loc>https://ville.example/wp-sitemap-posts-page-1.xml</loc></sitemap>
        <url><loc>https://ville.example/docs/annexe-grille-densite.pdf</loc></url>
        <url><loc>https://ville.example/loisirs</loc></url>
      </sitemapindex>`,
      "https://ville.example/sitemap.xml",
    );
    expect(interestingSitemapLocations(urls)).toEqual({
      documents: ["https://ville.example/docs/annexe-grille-densite.pdf"],
      pages: [],
      sitemaps: ["https://ville.example/wp-sitemap-posts-page-1.xml"],
    });
  });

  it("should parse real CDX rows and hard-exclude project documents", () => {
    const rows = parseCdxDocuments([
      "20250101000000 https://ville.example/grille-densite.pdf application/pdf 200 ABC 1234",
      "20240101000000 https://ville.example/premier-projet-grille.pdf application/pdf 200 DEF 2345",
      "bad row",
    ].join("\n"));
    expect(rows).toHaveLength(2);
    expect(interestingCdxDocuments(rows).map((row) => row.originalUrl))
      .toEqual(["https://ville.example/grille-densite.pdf"]);
  });
});

describe("native density text signals", () => {
  it("should return page-numbered verbatim signals without claiming a norm or effect", () => {
    const hits = densityTextHits(
      "Zone H-1\nDensité nette : 20 logements à l'hectare\n\fZone H-2\nCOS maximal 0,5\n",
    );
    expect(hits).toEqual([
      {
        page: 1,
        label: "densite",
        verbatim: "Zone H-1 Densité nette : 20 logements à l'hectare",
      },
      {
        page: 1,
        label: "logements-hectare",
        verbatim: "Zone H-1 Densité nette : 20 logements à l'hectare",
      },
      {
        page: 2,
        label: "cos",
        verbatim: "Zone H-2 COS maximal 0,5",
      },
    ]);
  });

  it("should require numeric values next to the native density label", () => {
    const text = [
      "ZONE: H1",
      "Nombre de logement par bâtiment     1/1  2/3  4/9",
      "Coefficient d’occupation du sol maximum",
      "\fZONE: H-2",
      "Logement / Hectare maximum          24",
    ].join("\n");
    expect(densityNormValueHits(text)).toEqual([
      expect.objectContaining({
        page: 1,
        zoneCodes: ["H1"],
        rawValues: ["1/1", "2/3", "4/9"],
        unit: "logements/batiment",
      }),
      expect.objectContaining({
        page: 2,
        zoneCodes: ["H-2"],
        rawValues: ["24"],
        unit: "logements/hectare",
      }),
    ]);
  });

  it("should not promote an empty density row", () => {
    expect(densityNormValueHits(
      "ZONE: A-152\nCoefficient d'emprise au sol maximum\nLogement / Hectare maximum\n",
    )).toEqual([]);
  });

  it("should reject every explicit project form before legal validation", () => {
    expect(hasHardProjectMarker("1er projet de règlement")).toBe(true);
    expect(hasHardProjectMarker("Deuxième projet")).toBe(true);
    expect(hasHardProjectMarker("Avis public pour adoption")).toBe(true);
    expect(hasHardProjectMarker("Codification administrative à jour")).toBe(false);
  });
});
