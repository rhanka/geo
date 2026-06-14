import type { FeatureCollection } from "@sentropic/geo-core";
import { getDataset, validateSourceManifest } from "@sentropic/geo-core";
import type { NormalizeContext } from "@sentropic/geo-core";
import { describe, expect, it } from "vitest";

import {
  // manifests + ids
  cptaqManifest,
  bdziManifest,
  grhqManifest,
  CPTAQ_SOURCE_ID,
  BDZI_SOURCE_ID,
  GRHQ_SOURCE_ID,
  CPTAQ_LAYER_POLYGON,
  BDZI_LAYER_POLYGONS,
  GRHQ_LAYER_WATERBODIES,
  GRHQ_LAYER_NETWORK,
  DATASET_ZONE_AGRICOLE,
  DATASET_FLOOD_ZONES,
  DATASET_WATERBODIES,
  DATASET_NETWORK,
  // normalizers
  cptaqNormalizer,
  bdziNormalizer,
  grhqNormalizer,
  registerSources,
  type RegisteredSource,
} from "./index.js";

/** A minimal fake FeatureCollection with one polygon feature carrying `properties`. */
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
          [-74.2, 45.22],
          [-74.07, 45.22],
          [-74.07, 45.32],
          [-74.2, 45.32],
          [-74.2, 45.22],
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

// ── manifests ────────────────────────────────────────────────────────────────

describe("manifests", () => {
  it("each constraint manifest is a valid SourceManifest", () => {
    for (const m of [cptaqManifest, bdziManifest, grhqManifest]) {
      const result = validateSourceManifest(m);
      expect(result.ok, JSON.stringify((result as { errors?: string[] }).errors)).toBe(true);
    }
  });

  it("declares CA-QC jurisdiction and CC-BY 4.0 for all three", () => {
    for (const m of [cptaqManifest, bdziManifest, grhqManifest]) {
      expect(m.jurisdiction).toEqual({ country: "CA", subdivision: "CA-QC" });
      expect(m.license).toBe("cc-by-4.0");
      expect(m.kind).toBe("administrative");
    }
  });

  it("pins the real source ids", () => {
    expect(cptaqManifest.id).toBe("ca-qc/cptaq-zone-agricole");
    expect(bdziManifest.id).toBe("ca-qc/bdzi-flood-zones");
    expect(grhqManifest.id).toBe("ca-qc/grhq-hydrography");
    expect(CPTAQ_SOURCE_ID).toBe(cptaqManifest.id);
    expect(BDZI_SOURCE_ID).toBe(bdziManifest.id);
    expect(GRHQ_SOURCE_ID).toBe(grhqManifest.id);
  });

  it("CPTAQ: SHP ZIP of the transposed zone_agricole_s layer", () => {
    const ds = getDataset(cptaqManifest, DATASET_ZONE_AGRICOLE);
    expect(ds?.format).toBe("shp");
    expect(ds?.url).toBe(
      "https://carto.cptaq.gouv.qc.ca/data/shapefiles/ZA_transposee.zip",
    );
    expect(ds?.layer).toBe(CPTAQ_LAYER_POLYGON);
    expect(ds?.query?.simplify).toBeTypeOf("number");
  });

  it("BDZI: ArcGIS REST EnviroWeb MapServer layer 22, GeoJSON WGS84", () => {
    const ds = getDataset(bdziManifest, DATASET_FLOOD_ZONES);
    expect(ds?.format).toBe("arcgis-rest");
    expect(ds?.url).toBe(
      "https://www.servicesgeo.enviroweb.gouv.qc.ca/donnees/rest/services/Public/Themes_publics/MapServer",
    );
    expect(ds?.layer).toBe(22);
    expect(ds?.layer).toBe(BDZI_LAYER_POLYGONS);
    expect(ds?.crs).toBe("EPSG:4326");
    expect(ds?.query?.f).toBe("geojson");
    expect(ds?.query?.outSR).toBe(4326);
  });

  it("GRHQ: two ArcGIS REST layers (104 waterbodies, 101 network)", () => {
    expect(grhqManifest.datasets).toHaveLength(2);
    const water = getDataset(grhqManifest, DATASET_WATERBODIES);
    const network = getDataset(grhqManifest, DATASET_NETWORK);
    expect(water?.format).toBe("arcgis-rest");
    expect(water?.layer).toBe(GRHQ_LAYER_WATERBODIES);
    expect(water?.layer).toBe(104);
    expect(water?.query?.simplify).toBeTypeOf("number");
    expect(network?.layer).toBe(GRHQ_LAYER_NETWORK);
    expect(network?.layer).toBe(101);
    // Linear network keeps full geometry (no simplify).
    expect(network?.query?.simplify).toBeUndefined();
    for (const ds of grhqManifest.datasets) {
      expect(ds.url).toBe(
        "https://www.servicesgeo.enviroweb.gouv.qc.ca/donnees/rest/services/Public/Themes_publics/MapServer",
      );
      expect(ds.crs).toBe("EPSG:4326");
    }
  });
});

// ── registerSources ──────────────────────────────────────────────────────────

describe("registerSources", () => {
  it("returns three sources, each with a normalizer for every dataset", () => {
    const sources = registerSources();
    expect(sources.map((s) => s.manifest.id)).toEqual([
      "ca-qc/cptaq-zone-agricole",
      "ca-qc/bdzi-flood-zones",
      "ca-qc/grhq-hydrography",
    ]);
    for (const source of sources) {
      for (const dataset of source.manifest.datasets) {
        expect(typeof source.normalizers[dataset.id]).toBe("function");
      }
    }
  });
});

// ── normalizers ──────────────────────────────────────────────────────────────

describe("cptaqNormalizer", () => {
  it("maps a CPTAQ agricultural-zone polygon to AdminProperties", () => {
    const out = cptaqNormalizer(
      fc({ Mrc: "Beauharnois-Salaberry", Zonage: "Agricole", Date_maj: "2026-05-03" }, 42),
      ctxFor(cptaqManifest, DATASET_ZONE_AGRICOLE),
    );
    const props = out.features[0]?.properties;
    expect(props?.name).toBe("Beauharnois-Salaberry");
    expect(props?.code).toBe("42");
    expect(props?.geoId).toBe("ca/qc/cptaq-zone-agricole/42");
    expect(props?.level).toBe("locality");
    expect(props?.country).toBe("CA");
    expect(props?.constraint).toBe("cptaq-zone-agricole");
    // Original SHP attributes preserved.
    expect(props?.Zonage).toBe("Agricole");
  });

  it("rejects a non-FeatureCollection payload", () => {
    expect(() =>
      cptaqNormalizer({ nope: true }, ctxFor(cptaqManifest, DATASET_ZONE_AGRICOLE)),
    ).toThrow();
  });
});

describe("bdziNormalizer", () => {
  it("maps a BDZI flood-zone polygon to AdminProperties", () => {
    const out = bdziNormalizer(
      fc({
        OBJECTID: 837,
        Description: "Zone de grand courant",
        No_rapport: "PDCC 16-019",
        Nm_rapport: "Rivière Saint-Louis",
      }),
      ctxFor(bdziManifest, DATASET_FLOOD_ZONES),
    );
    const props = out.features[0]?.properties;
    expect(props?.name).toBe("Zone de grand courant");
    expect(props?.code).toBe("837");
    expect(props?.geoId).toBe("ca/qc/bdzi-flood-zones/837");
    expect(props?.level).toBe("locality");
    expect(props?.country).toBe("CA");
    expect(props?.constraint).toBe("bdzi-flood-zones");
    expect(props?.No_rapport).toBe("PDCC 16-019");
  });
});

describe("grhqNormalizer", () => {
  it("maps a GRHQ waterbody feature to AdminProperties (preserving TYPECE/PERENNITE)", () => {
    const out = grhqNormalizer(
      fc({ OBJECTID: 104159, TYPECE: 10, PERENNITE: "P", TOPONYME: "Canal de Beauharnois" }),
      ctxFor(grhqManifest, DATASET_WATERBODIES),
    );
    const props = out.features[0]?.properties;
    expect(props?.name).toBe("Canal de Beauharnois");
    expect(props?.code).toBe("104159");
    expect(props?.geoId).toBe("ca/qc/grhq-hydrography/104159");
    expect(props?.level).toBe("locality");
    expect(props?.country).toBe("CA");
    expect(props?.constraint).toBe("grhq-hydrography");
    expect(props?.TYPECE).toBe(10);
    expect(props?.PERENNITE).toBe("P");
  });

  it("falls back to the OBJECTID when a network element is unnamed", () => {
    const out = grhqNormalizer(
      fc({ OBJECTID: 101512, TYPECE: 10, PERENNITE: "I" }),
      ctxFor(grhqManifest, DATASET_NETWORK),
    );
    const props = out.features[0]?.properties;
    expect(props?.name).toBe("101512");
    expect(props?.geoId).toBe("ca/qc/grhq-hydrography/101512");
    expect(props?.constraint).toBe("grhq-hydrography");
  });
});
