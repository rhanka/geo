import type { FeatureCollection } from "@sentropic/geo-core";
import { getDataset, validateSourceManifest } from "@sentropic/geo-core";
import type { NormalizeContext } from "@sentropic/geo-core";
import { describe, expect, it } from "vitest";

import {
  // manifest + ids
  manifest,
  cadastreManifest,
  CADASTRE_SOURCE_ID,
  CADASTRE_SERVICE_URL,
  CADASTRE_LAYER_LOTS,
  CADASTRE_FIELD_NO_LOT,
  DATASET_LOTS,
  // normalizer
  normalizer,
  cadastreNormalizer,
  CADASTRE_GEOID_KIND,
  // registry
  registerSource,
  type RegisteredSource,
} from "./index.js";

/** A minimal fake cadastre FeatureCollection: one lot polygon carrying `properties`. */
function fc(
  properties: Record<string, unknown>,
  id?: string | number,
): FeatureCollection {
  const feature: FeatureCollection["features"][number] = {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-74.16, 45.24],
          [-74.07, 45.24],
          [-74.07, 45.32],
          [-74.16, 45.32],
          [-74.16, 45.24],
        ],
      ],
    },
    properties,
  };
  if (id !== undefined) feature.id = id;
  return { type: "FeatureCollection", features: [feature] };
}

function ctxFor(
  source: RegisteredSource["manifest"],
  datasetId: string,
): NormalizeContext {
  const dataset = getDataset(source, datasetId);
  if (!dataset) throw new Error(`missing dataset ${datasetId}`);
  return { manifest: source, dataset };
}

// ── manifest ───────────────────────────────────────────────────────────────────

describe("cadastre manifest", () => {
  it("is a valid SourceManifest", () => {
    const result = validateSourceManifest(manifest);
    expect(
      result.ok,
      JSON.stringify((result as { errors?: string[] }).errors),
    ).toBe(true);
  });

  it("re-exports the same manifest under both names", () => {
    expect(cadastreManifest).toBe(manifest);
  });

  it("declares CA-QC jurisdiction, CC-BY 4.0, administrative kind", () => {
    expect(manifest.jurisdiction).toEqual({ country: "CA", subdivision: "CA-QC" });
    expect(manifest.license).toBe("cc-by-4.0");
    expect(manifest.kind).toBe("administrative");
  });

  it("pins the real source id", () => {
    expect(manifest.id).toBe("ca-qc/cadastre");
    expect(CADASTRE_SOURCE_ID).toBe(manifest.id);
  });

  it("captures the real cadastre-allégé ArcGIS REST endpoint (layer 0, GeoJSON WGS84)", () => {
    const ds = getDataset(manifest, DATASET_LOTS);
    expect(ds?.format).toBe("arcgis-rest");
    expect(ds?.url).toBe(
      "https://geo.environnement.gouv.qc.ca/donnees/rest/services/Reference/Cadastre_allege/MapServer",
    );
    expect(ds?.url).toBe(CADASTRE_SERVICE_URL);
    expect(ds?.layer).toBe(0);
    expect(ds?.layer).toBe(CADASTRE_LAYER_LOTS);
    expect(ds?.crs).toBe("EPSG:4326");
    expect(ds?.query?.outFields).toBe("NO_LOT");
    expect(ds?.query?.outFields).toBe(CADASTRE_FIELD_NO_LOT);
    expect(ds?.query?.outSR).toBe(4326);
    expect(ds?.query?.f).toBe("geojson");
    expect(ds?.query?.simplify).toBeTypeOf("number");
  });
});

// ── registerSource ───────────────────────────────────────────────────────────

describe("registerSource", () => {
  it("returns the cadastre source with a normalizer for every dataset", () => {
    const source = registerSource();
    expect(source.manifest.id).toBe("ca-qc/cadastre");
    for (const dataset of source.manifest.datasets) {
      expect(typeof source.normalizers[dataset.id]).toBe("function");
    }
  });
});

// ── normalizer ───────────────────────────────────────────────────────────────

describe("cadastreNormalizer", () => {
  it("re-exports the same normalizer under both names", () => {
    expect(normalizer).toBe(cadastreNormalizer);
  });

  it("maps a cadastre lot polygon to AdminProperties keyed by NO_LOT", () => {
    const out = cadastreNormalizer(
      fc({ NO_LOT: "4193751" }),
      ctxFor(manifest, DATASET_LOTS),
    );
    const props = out.features[0]?.properties;
    expect(props?.name).toBe("4193751");
    expect(props?.code).toBe("4193751");
    expect(props?.noLot).toBe("4193751");
    expect(props?.geoId).toBe("ca/qc/lot/4193751");
    expect(props?.level).toBe("locality");
    expect(props?.country).toBe("CA");
  });

  it("preserves NO_LOT spaces verbatim and slugifies them in the geoId", () => {
    const out = cadastreNormalizer(
      fc({ NO_LOT: "4 516 943" }),
      ctxFor(manifest, DATASET_LOTS),
    );
    const props = out.features[0]?.properties;
    // Verbatim string (spaces preserved) on the human-facing fields…
    expect(props?.noLot).toBe("4 516 943");
    expect(props?.name).toBe("4 516 943");
    expect(props?.code).toBe("4 516 943");
    // …but the canonical id is slugified (ca/qc/lot/<kind>).
    expect(props?.geoId).toBe("ca/qc/lot/4-516-943");
    expect(CADASTRE_GEOID_KIND).toBe("lot");
  });

  it("maps a municipality code only when the feature actually carries one", () => {
    const without = cadastreNormalizer(
      fc({ NO_LOT: "4193752" }),
      ctxFor(manifest, DATASET_LOTS),
    );
    expect(without.features[0]?.properties?.municipalityCode).toBeUndefined();

    const withCode = cadastreNormalizer(
      fc({ NO_LOT: "4193753", CO_MUNCP: "70052" }),
      ctxFor(manifest, DATASET_LOTS),
    );
    const props = withCode.features[0]?.properties;
    expect(props?.municipalityCode).toBe("70052");
    // Original attribute preserved too.
    expect(props?.CO_MUNCP).toBe("70052");
  });

  it("falls back to the feature id when NO_LOT is absent", () => {
    const out = cadastreNormalizer(
      fc({}, 777),
      ctxFor(manifest, DATASET_LOTS),
    );
    const props = out.features[0]?.properties;
    expect(props?.noLot).toBe("777");
    expect(props?.geoId).toBe("ca/qc/lot/777");
  });

  it("rejects a non-FeatureCollection payload", () => {
    expect(() =>
      cadastreNormalizer({ nope: true }, ctxFor(manifest, DATASET_LOTS)),
    ).toThrow();
  });
});
