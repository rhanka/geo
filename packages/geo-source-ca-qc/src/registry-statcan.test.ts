import type { FeatureCollection } from "@sentropic/geo-core";
import { getDataset, makeGeoId, validateSourceManifest } from "@sentropic/geo-core";
import type { NormalizeContext } from "@sentropic/geo-acquire";
import { describe, expect, it } from "vitest";

import rawRegistry from "./municipalities/municipalities.qc.json" with { type: "json" };

import {
  QC_MUNICIPALITIES,
  bySlug,
  byName,
  byCode,
  normalizeName,
  isMunicipality,
  validateMunicipalities,
  type Municipality,
  CSD_SOURCE_ID,
  DATASET_MUNICIPALITIES_POLYGONS,
  STATCAN_CSD_SERVICE_URL,
  STATCAN_CSD_SIMPLIFY,
  STATCAN_CSD_FIELDS,
  CSDTYPE_PRIORITY,
  statcanCsdManifest,
  statcanCsdNormalizer,
  makeStatCanCsdNormalizer,
  registerStatCanCsdSource,
} from "./index.js";

// ── registry ─────────────────────────────────────────────────────────────────

describe("QC municipality registry", () => {
  it("loads exactly 1106 entries", () => {
    expect(QC_MUNICIPALITIES).toHaveLength(1106);
  });

  it("carries only geographic fields (no immo business fields)", () => {
    const sample = QC_MUNICIPALITIES[0];
    expect(sample).toBeDefined();
    const keys = Object.keys(sample ?? {});
    for (const banned of ["priorityRank", "excluded", "excludedReason", "deprioritized"]) {
      expect(keys).not.toContain(banned);
    }
  });

  it("validates as a Municipality[] with unique slugs", () => {
    const result = validateMunicipalities(QC_MUNICIPALITIES);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1106);
  });

  it("rejects non-arrays and entries missing required fields", () => {
    expect(validateMunicipalities({}).ok).toBe(false);
    expect(validateMunicipalities([{ slug: "x" }]).ok).toBe(false);
    expect(isMunicipality({ slug: "x", name: "X" })).toBe(false);
    expect(
      isMunicipality({
        slug: "x",
        name: "X",
        mrc: null,
        lat: 45,
        lon: -73,
        population: null,
        distanceToMtlKm: 0,
      }),
    ).toBe(true);
  });

  it("stays in sync with the canonical registry JSON (1106, same slugs)", () => {
    const raw = rawRegistry as Array<{ slug: string }>;
    expect(raw).toHaveLength(1106);
    const jsonSlugs = new Set(raw.map((e) => e.slug));
    const dataSlugs = new Set(QC_MUNICIPALITIES.map((m) => m.slug));
    expect(dataSlugs).toEqual(jsonSlugs);
  });

  it("bySlug resolves a known municipality", () => {
    const westmount = bySlug("westmount");
    expect(westmount?.name).toBe("Westmount");
    expect(westmount?.mrc).toBeNull();
    expect(bySlug("does-not-exist")).toBeUndefined();
  });

  it("byName matches NFD-normalized (accents/apostrophe/case insensitive)", () => {
    // "Côte-Saint-Luc" is in the registry; query with stripped accents + upper case.
    const byPlain = byName("cote-saint-luc");
    const byAccented = byName("Côte-Saint-Luc");
    const byUpper = byName("CÔTE-SAINT-LUC");
    expect(byPlain.length).toBeGreaterThan(0);
    expect(byPlain.map((m) => m.slug)).toContain("cote-saint-luc");
    expect(byAccented).toEqual(byPlain);
    expect(byUpper).toEqual(byPlain);
  });

  it("normalizeName strips accents and apostrophes", () => {
    expect(normalizeName("L'Île-Perrot")).toBe("lile-perrot");
    expect(normalizeName("Montréal-Ouest")).toBe("montreal-ouest");
  });

  it("byCode is empty on the bare registry (no native MUS_CO_GEO)", () => {
    // The registry carries no geographic code; codes come from the polygon join.
    expect(byCode("2466023")).toBeUndefined();
  });
});

// ── StatCan CSD manifest ─────────────────────────────────────────────────────

describe("StatCan CSD manifest", () => {
  it("is a valid SourceManifest", () => {
    expect(validateSourceManifest(statcanCsdManifest).ok).toBe(true);
  });

  it("declares the CSD source under OGL-Canada for QC municipalities", () => {
    expect(statcanCsdManifest.id).toBe("ca-qc/statcan-csd");
    expect(statcanCsdManifest.id).toBe(CSD_SOURCE_ID);
    expect(statcanCsdManifest.kind).toBe("administrative");
    expect(statcanCsdManifest.jurisdiction).toEqual({
      country: "CA",
      subdivision: "CA-QC",
      level: "municipality",
    });
    expect(statcanCsdManifest.license).toBe("ogl-ca");
  });

  it("captures the real StatCan CSD endpoint, query and simplify", () => {
    const ds = getDataset(statcanCsdManifest, DATASET_MUNICIPALITIES_POLYGONS);
    expect(ds?.format).toBe("arcgis-rest");
    expect(ds?.url).toBe(STATCAN_CSD_SERVICE_URL);
    expect(STATCAN_CSD_SERVICE_URL).toContain("geo.statcan.gc.ca");
    expect(STATCAN_CSD_SERVICE_URL).toContain("lcsd000a25s_e/MapServer");
    expect(ds?.layer).toBe(0);
    expect(ds?.adminLevel).toBe("municipality");
    expect(ds?.crs).toBe("EPSG:4326");
    expect(ds?.query?.where).toBe("PRUID='24'");
    expect(ds?.query?.outFields).toBe(STATCAN_CSD_FIELDS);
    expect(ds?.query?.f).toBe("geojson");
    expect(ds?.query?.simplify).toBe(STATCAN_CSD_SIMPLIFY);
    expect(ds?.query?.simplify).toBe(0.0005);
  });

  it("preserves immo's CSDTYPE tiebreak priority (V wins)", () => {
    expect(CSDTYPE_PRIORITY["V"]).toBe(1);
    expect(CSDTYPE_PRIORITY["VL"]).toBe(2);
    expect(CSDTYPE_PRIORITY["NO"]).toBe(100);
  });
});

// ── StatCan CSD normalizer + registry join ───────────────────────────────────

function ctx(): NormalizeContext {
  const dataset = getDataset(statcanCsdManifest, DATASET_MUNICIPALITIES_POLYGONS);
  if (!dataset) throw new Error("missing CSD dataset");
  return { manifest: statcanCsdManifest, dataset };
}

/** A tiny fake CSD FeatureCollection (StatCan field spellings). */
function csdFc(
  features: Array<{
    CSDUID: string;
    CSDNAME: string;
    CDUID?: string;
    CDNAME?: string;
    CSDTYPE?: string;
  }>,
): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: features.map((properties) => ({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-73.6, 45.5],
            [-73.5, 45.5],
            [-73.5, 45.6],
            [-73.6, 45.5],
          ],
        ],
      },
      properties,
    })),
  };
}

describe("statcanCsdNormalizer", () => {
  it("maps a CSD feature to AdminProperties with the geoId from CSDUID", () => {
    const out = statcanCsdNormalizer(
      csdFc([{ CSDUID: "2466023", CSDNAME: "Montréal", CDNAME: "Montréal", CSDTYPE: "V" }]),
      ctx(),
    );
    const props = out.features[0]?.properties;
    expect(props?.name).toBe("Montréal");
    expect(props?.level).toBe("municipality");
    expect(props?.country).toBe("CA");
    expect(props?.code).toBe("2466023");
    expect(props?.geoId).toBe(makeGeoId("ca", "qc", "municipality", "2466023"));
    expect(props?.geoId).toBe("ca/qc/municipality/2466023");
    // Original CSD attributes preserved.
    expect(props?.CSDTYPE).toBe("V");
  });

  it("joins a CSD polygon to the QC registry by NFD-normalized name", () => {
    // "Westmount" exists in the registry (slug westmount, mrc null).
    const out = statcanCsdNormalizer(
      csdFc([{ CSDUID: "2466007", CSDNAME: "Westmount", CSDTYPE: "V" }]),
      ctx(),
    );
    const props = out.features[0]?.properties;
    expect(props?.citySlug).toBe("westmount");
    expect(props?.mrc).toBeNull();
  });

  it("leaves unmatched CSD features without a registry slug", () => {
    const out = statcanCsdNormalizer(
      csdFc([{ CSDUID: "2499999", CSDNAME: "Zzz Territoire Inexistant" }]),
      ctx(),
    );
    const props = out.features[0]?.properties;
    expect(props?.code).toBe("2499999");
    expect(props?.citySlug).toBeUndefined();
  });

  it("disambiguates same-name candidates by MRC (CDNAME)", () => {
    const fakeRegistry: Municipality[] = [
      { slug: "saint-louis-a", name: "Saint-Louis", mrc: "Kamouraska", lat: 47, lon: -69, population: null, distanceToMtlKm: 400 },
      { slug: "saint-louis-b", name: "Saint-Louis", mrc: "Le Haut-Richelieu", lat: 45, lon: -73, population: null, distanceToMtlKm: 40 },
    ];
    const normalizer = makeStatCanCsdNormalizer(fakeRegistry);
    const out = normalizer(
      csdFc([{ CSDUID: "2456083", CSDNAME: "Saint-Louis", CDNAME: "Le Haut-Richelieu", CSDTYPE: "MÉ" }]),
      ctx(),
    );
    expect(out.features[0]?.properties.citySlug).toBe("saint-louis-b");
  });

  it("rejects a non-FeatureCollection payload", () => {
    expect(() => statcanCsdNormalizer({ nope: true }, ctx())).toThrow();
  });
});

describe("registerStatCanCsdSource", () => {
  it("returns the manifest and a normalizer for the polygons dataset", () => {
    const reg = registerStatCanCsdSource();
    expect(reg.manifest).toBe(statcanCsdManifest);
    expect(typeof reg.normalizers[DATASET_MUNICIPALITIES_POLYGONS]).toBe("function");
  });
});
