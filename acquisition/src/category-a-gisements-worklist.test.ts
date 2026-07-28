import { describe, expect, it } from "vitest";

import { categoryAGisementsWorklists } from "./category-a-gisements-worklist.js";

describe("category A untried deposits worklists", () => {
  it("keeps the exact 17-slug scope in short 6/6/5 lots", () => {
    const lots = categoryAGisementsWorklists();
    expect(lots.map((lot) => lot.length)).toEqual([6, 6, 5]);
    expect(lots.flat().map((target) => target.slug)).toEqual([
      "lislet",
      "notre-dame-du-rosaire",
      "saint-francois-de-la-riviere-du-sud",
      "batiscan",
      "gaspe",
      "levis",
      "petite-riviere-saint-francois",
      "pont-rouge",
      "saint-benoit-labre",
      "saint-bruno-de-montarville",
      "saint-come-liniere",
      "saint-denis-de-la-bouteillerie",
      "saint-elie-de-caxton",
      "saint-ours",
      "sutton",
      "tres-saint-redempteur",
      "saint-alphonse",
    ]);
  });

  it("tries every required source family and scopes CDX to a domain", () => {
    for (const target of categoryAGisementsWorklists().flat()) {
      expect(target.urls.some((url) => url.includes("/wp-json/wp/v2/media"))).toBe(true);
      expect(target.urls.some((url) => url.includes("/storage/app/media"))).toBe(true);
      expect(target.urls.some((url) => /\/sitemap(?:_index)?\.xml$/.test(new URL(url).pathname))).toBe(true);
      expect(target.urls.some((url) => url.includes("/centre-documentaire/"))).toBe(true);
      expect(target.urls.some((url) => {
        const parsed = new URL(url);
        return parsed.hostname === "web.archive.org"
          && parsed.searchParams.get("matchType") === "domain"
          && parsed.searchParams.get("url")?.endsWith("/*") === true;
      })).toBe(true);
      expect(target.urls.some((url) => new URL(url).hostname === "www.arcgis.com")).toBe(true);
    }
  });
});
