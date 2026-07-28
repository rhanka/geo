import { describe, expect, it } from "vitest";

import {
  discoverFollowups,
  regulationSearchCatalogs,
  retryableFollowupUrls,
} from "./category-a-gisements-followups.js";
import type { CategoryAGisementTarget } from "./category-a-gisements-worklist.js";

describe("category A captured catalog followups", () => {
  it("extracts a hidden WordPress media PDF using its title context", () => {
    const result = discoverFollowups(JSON.stringify([{
      title: { rendered: "Grille des usages et des normes" },
      source_url: "https://ville.example/wp-content/uploads/2024/01/12345.pdf",
    }]), "https://ville.example/wp-json/wp/v2/media");
    expect(result.documents).toEqual([
      "https://ville.example/wp-content/uploads/2024/01/12345.pdf",
    ]);
  });

  it("keeps both live http and archived CDX document URLs", () => {
    const result = discoverFollowups(JSON.stringify([
      ["original", "timestamp", "statuscode"],
      ["http://ville.example/docs/annexe-grille.pdf", "20240102030405", "200"],
    ]), "https://web.archive.org/cdx/search/cdx");
    expect(result.documents).toContain("http://ville.example/docs/annexe-grille.pdf");
    expect(result.documents).toContain(
      "https://web.archive.org/web/20240102030405id_/http://ville.example/docs/annexe-grille.pdf",
    );
  });

  it("recurses into child sitemaps and ArcGIS item/service metadata", () => {
    const sitemap = discoverFollowups(
      "<sitemapindex><sitemap><loc>https://ville.example/post-sitemap.xml</loc></sitemap></sitemapindex>",
      "https://ville.example/sitemap.xml",
    );
    expect(sitemap.catalogs).toContain("https://ville.example/post-sitemap.xml");

    const arcgis = discoverFollowups(JSON.stringify({
      results: [{
        id: "0123456789abcdef0123456789abcdef",
        title: "Zonage municipal",
        url: "https://services.example/arcgis/rest/services/Zonage/FeatureServer",
      }],
    }), "https://www.arcgis.com/sharing/rest/search?f=json");
    expect(arcgis.catalogs).toContain(
      "https://www.arcgis.com/sharing/rest/content/items/0123456789abcdef0123456789abcdef/data?f=json",
    );
    expect(arcgis.catalogs).toContain(
      "https://services.example/arcgis/rest/services/Zonage/FeatureServer?f=pjson",
    );
  });

  it("follows numeric PDF anchors and ArcGIS Lien fields without inventing a URL", () => {
    const html = discoverFollowups(
      '<a href="/files/12345.pdf">Règlement de zonage et ses grilles</a>',
      "https://mrc.example/centre-documentaire/",
    );
    expect(html.documents).toEqual(["https://mrc.example/files/12345.pdf"]);

    const service = discoverFollowups(JSON.stringify({
      layers: [{ id: 7, name: "Zonage" }],
    }), "https://services.example/arcgis/rest/services/Zonage/FeatureServer?f=pjson");
    expect(service.catalogs).toContain(
      "https://services.example/arcgis/rest/services/Zonage/FeatureServer/7/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=2000&f=json",
    );

    const rows = discoverFollowups(JSON.stringify({
      features: [{ attributes: { Code: "A-1", Lien: "https://ville.example/docs/grille-A-1.pdf" } }],
    }), "https://services.example/FeatureServer/7/query?f=json");
    expect(rows.documents).toContain("https://ville.example/docs/grille-A-1.pdf");
  });

  it("does not inherit a catalog page subject into unrelated links", () => {
    const result = discoverFollowups(
      [
        '<a href="/files/annexe-budget.pdf">Annexe au budget</a>',
        '<a href="/files/projet-reglement-zonage.pdf">Projet de règlement de zonage</a>',
        '<a href="/files/reglement-zonage.pdf">Règlement de zonage</a>',
      ].join(""),
      "https://mrc.example/reglements-urbanisme/",
    );
    expect(result.documents).toEqual(["https://mrc.example/files/reglement-zonage.pdf"]);
  });

  it("uses sitemaps for child indexes and direct subject documents, not every matching page slug", () => {
    const result = discoverFollowups(
      [
        "<urlset>",
        "<url><loc>https://mrc.example/reglement-123/</loc></url>",
        "<url><loc>https://mrc.example/reglement-zonage.pdf</loc></url>",
        "<url><loc>https://mrc.example/zonage-municipal/</loc></url>",
        "</urlset>",
      ].join(""),
      "https://mrc.example/post-sitemap.xml",
    );
    expect(result.documents).toEqual(["https://mrc.example/reglement-zonage.pdf"]);
    expect(result.catalogs).toEqual([]);
  });

  it("does not recurse through incidental WordPress API relation routes", () => {
    const result = discoverFollowups(
      '<a href="https://mrc.example/wp-json/wp/v2/comments?post=42">urbanisme</a>',
      "https://mrc.example/",
    );
    expect(result.catalogs).toEqual([]);
  });

  it("retries opaque hosts with explicit http and www variants", () => {
    expect(retryableFollowupUrls("https://www.batiscan.ca/sitemap.xml"))
      .toEqual([
        "http://batiscan.ca/sitemap.xml",
        "http://www.batiscan.ca/sitemap.xml",
        "https://batiscan.ca/sitemap.xml",
        "https://www.batiscan.ca/sitemap.xml",
      ]);
    expect(retryableFollowupUrls("https://web.archive.org/cdx/search/cdx?url=x"))
      .toEqual(["https://web.archive.org/cdx/search/cdx?url=x"]);
  });

  it("turns a hidden regulation number into municipal and MRC CMS searches", () => {
    const target: CategoryAGisementTarget = {
      slug: "petite-riviere-saint-francois",
      name: "Petite-Rivière-Saint-François",
      website: "https://www.petiteriviere.com",
      mrcName: "MRC de Charlevoix",
      mrcPortals: ["https://mrccharlevoix.ca"],
    };
    expect(regulationSearchCatalogs(
      "https://www.petiteriviere.com/uploads/RÈGLEMENT-NO-641-MODIFIANT-LE-RÈGLEMENT-DE-ZONAGE-603.pdf",
      target,
    )).toEqual([
      "https://mrccharlevoix.ca/?s=603",
      "https://mrccharlevoix.ca/?s=641",
      "https://mrccharlevoix.ca/wp-json/wp/v2/media?search=603&per_page=100",
      "https://mrccharlevoix.ca/wp-json/wp/v2/media?search=641&per_page=100",
      "https://www.petiteriviere.com/?s=603",
      "https://www.petiteriviere.com/?s=641",
      "https://www.petiteriviere.com/wp-json/wp/v2/media?search=603&per_page=100",
      "https://www.petiteriviere.com/wp-json/wp/v2/media?search=641&per_page=100",
    ]);
  });
});
