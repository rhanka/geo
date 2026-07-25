/**
 * Tests — QC municipal website directory (MAMH-sourced) + its manifest.
 *
 * Hermetic: validates the embedded directory's shape, coverage invariants, the
 * NFD-name join consistency with the registry, and the manifest validity. No
 * network.
 */
import { validateSourceManifest } from "@sentropic/geo-core";
import { describe, expect, it } from "vitest";

import { QC_MUNICIPALITIES, normalizeName } from "./municipalities.js";
import {
  QC_MUNICIPAL_DIRECTORY,
  websiteForSlug,
  directoryEntry,
  directoryWebsites,
} from "./municipal-directory.js";
import {
  municipalDirectoryManifest,
  MUNICIPAL_DIRECTORY_SOURCE_ID,
  DATASET_MUNICIPAL_DIRECTORY,
} from "./municipal-directory-manifest.js";

describe("QC_MUNICIPAL_DIRECTORY", () => {
  it("is CC-BY 4.0 MAMH-sourced with consistent stats", () => {
    expect(QC_MUNICIPAL_DIRECTORY.source.license).toBe("cc-by-4.0");
    expect(QC_MUNICIPAL_DIRECTORY.source.dataset).toBe(
      "repertoire-des-municipalites-du-quebec",
    );
    const entries = Object.values(QC_MUNICIPAL_DIRECTORY.entries);
    expect(entries.length).toBe(QC_MUNICIPAL_DIRECTORY.stats.matched);
    const withWeb = entries.filter((e) => e.website !== null).length;
    expect(withWeb).toBe(QC_MUNICIPAL_DIRECTORY.stats.withWebsite);
  });

  it("covers the large majority of the registry (≥98%)", () => {
    const total = QC_MUNICIPALITIES.length;
    const matched = QC_MUNICIPAL_DIRECTORY.stats.matched;
    expect(matched / total).toBeGreaterThanOrEqual(0.98);
    // at least 95% of the registry has a website
    expect(QC_MUNICIPAL_DIRECTORY.stats.withWebsite / total).toBeGreaterThanOrEqual(0.95);
  });

  it("keys every entry by a real registry slug", () => {
    const regSlugs = new Set(QC_MUNICIPALITIES.map((m) => m.slug));
    for (const slug of Object.keys(QC_MUNICIPAL_DIRECTORY.entries)) {
      expect(regSlugs.has(slug)).toBe(true);
    }
  });

  it("normalizes every website to https", () => {
    for (const e of Object.values(QC_MUNICIPAL_DIRECTORY.entries)) {
      if (e.website !== null) {
        expect(e.website.startsWith("https://")).toBe(true);
      }
    }
  });

  it("join is name-consistent (entry name matches registry name, modulo aliases)", () => {
    const regBySlug = new Map(QC_MUNICIPALITIES.map((m) => [m.slug, m]));
    for (const e of Object.values(QC_MUNICIPAL_DIRECTORY.entries)) {
      const reg = regBySlug.get(e.slug);
      expect(reg).toBeDefined();
      // The directory `name` is the registry name; mamhName may differ only by
      // disambiguator/locale (aliases). The normalized names line up for the
      // non-aliased majority.
      expect(e.name).toBe(reg?.name);
      void normalizeName; // join key lives in the build script; sanity-import only.
    }
  });

  it("websiteForSlug / directoryEntry resolve known slugs", () => {
    const first = Object.values(QC_MUNICIPAL_DIRECTORY.entries).find(
      (e) => e.website !== null,
    )!;
    expect(websiteForSlug(first.slug)).toBe(first.website);
    expect(directoryEntry(first.slug)?.mamhCode).toBe(first.mamhCode);
    expect(websiteForSlug("___not_a_slug___")).toBeNull();
    expect(directoryEntry("___not_a_slug___")).toBeUndefined();
  });

  it("directoryWebsites yields only entries with a website, sorted by slug", () => {
    const pairs = directoryWebsites();
    expect(pairs.length).toBe(QC_MUNICIPAL_DIRECTORY.stats.withWebsite);
    for (const [, url] of pairs) expect(url).toMatch(/^https:\/\//);
    const slugs = pairs.map((p) => p[0]);
    expect([...slugs].sort()).toEqual(slugs);
  });
});

describe("municipalDirectoryManifest", () => {
  it("is a valid SourceManifest (CC-BY 4.0, CSV)", () => {
    const res = validateSourceManifest(municipalDirectoryManifest);
    expect(res.ok).toBe(true);
    expect(municipalDirectoryManifest.id).toBe(MUNICIPAL_DIRECTORY_SOURCE_ID);
    expect(municipalDirectoryManifest.license).toBe("cc-by-4.0");
    expect(municipalDirectoryManifest.datasets[0]?.id).toBe(
      DATASET_MUNICIPAL_DIRECTORY,
    );
    expect(municipalDirectoryManifest.datasets[0]?.format).toBe("csv");
    expect(municipalDirectoryManifest.datasets[0]?.url).toMatch(/MUN\.csv$/);
  });
});
