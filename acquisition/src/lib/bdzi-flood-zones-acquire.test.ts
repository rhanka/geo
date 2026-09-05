/**
 * Unit tests for the BDZI flood-zones acquire→serve rules.
 *
 * Hermetic: a small in-memory GeoJSON fixture, no network, no S3, no GDAL binary
 * (the ogr2ogr runner + file reader are injected). Validates CRS confirmation,
 * the simplify argv, normalization wiring, the proof-v2 overlay, and the G5
 * readback — the code path the runner will execute on-cluster with the real CAS.
 */
import { describe, it, expect } from "vitest";

import type { CaptureManifestLine } from "../../../packages/qc-sources/src/capture/index.js";
import { proofFromCaptureEntry, type GeometrySourceProof } from "./zonage-proof.js";
import {
  BDZI_CONSTRAINTS_PREFIX,
  BDZI_SERVED_COLLECTION_ID,
  buildBdziSimplifyArgs,
  buildServedBdziOverlay,
  confirmWgs84,
  geometryDigest,
  normalizeBdziCapture,
  overlayBackupKey,
  overlayKeys,
  readbackLayout,
  simplifyGeoJson,
} from "./bdzi-flood-zones-acquire.js";

const HEX64 = "a".repeat(64);
const CAPTURE_URL =
  "https://www.servicesgeo.enviroweb.gouv.qc.ca/donnees/rest/services/Public/Themes_publics/MapServer/22/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson";

/** A WGS84 flood-zone polygon over south-west Québec (Valleyfield area). */
function rawFloodZoneFc(): unknown {
  return {
    type: "FeatureCollection",
    features: [
      {
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
        properties: {
          OBJECTID: 837,
          Description: "Zone de grand courant",
          No_rapport: "PDCC 16-019",
          Nm_rapport: "Rivière Saint-Louis",
        },
      },
    ],
  };
}

/** A minimal but SCHEMA-VALID capture manifest line whose CAS key matches sha256. */
function captureLine(): CaptureManifestLine {
  return {
    run_id: "zones-20260905T120000Z-0",
    lane: "zones",
    source: "bdzi",
    slugs: [],
    url: CAPTURE_URL,
    method: "GET",
    attempt: 1,
    requested_at: "2026-09-05T12:00:00.000Z",
    retrieved_at: "2026-09-05T12:00:01.000Z",
    http_status: 200,
    redirect_chain: [],
    final_url: CAPTURE_URL,
    content_type: "application/geo+json",
    bytes: 4096,
    sha256: `sha256:${HEX64}`,
    storage_key: `raw/bdzi/cas/${HEX64}.geojson`,
    dedup: false,
    error: null,
    user_agent: "sentropic-capture/1.0",
    via_obscura: false,
    egress: "direct",
    robots: "allowed",
    redacted: false,
  };
}

describe("confirmWgs84", () => {
  it("accepts a WGS84 FeatureCollection with no crs member (RFC 7946 default)", () => {
    const r = confirmWgs84(rawFloodZoneFc());
    expect(r.ok).toBe(true);
    expect(r.declared_crs).toBeNull();
    expect(r.within_quebec_envelope).toBe(true);
    expect(r.coordinate_count).toBe(5);
  });

  it("rejects a foreign named CRS", () => {
    const fc = rawFloodZoneFc() as { crs?: unknown };
    fc.crs = { type: "name", properties: { name: "urn:ogc:def:crs:EPSG::32188" } };
    const r = confirmWgs84(fc);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not WGS84/);
  });

  it("accepts an explicit CRS84 name", () => {
    const fc = rawFloodZoneFc() as { crs?: unknown };
    fc.crs = { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } };
    expect(confirmWgs84(fc).ok).toBe(true);
  });

  it("rejects projected-metre coordinates (MTM/UTM, not lon/lat)", () => {
    const r = confirmWgs84({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [[[250000, 5010000], [250100, 5010000], [250000, 5010100], [250000, 5010000]]] },
          properties: {},
        },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/degree range/);
  });

  it("rejects a non-FeatureCollection", () => {
    expect(confirmWgs84({ nope: true }).ok).toBe(false);
  });
});

describe("buildBdziSimplifyArgs", () => {
  it("mirrors the gdal.ts recipe: GeoJSON, EPSG:4326, Douglas-Peucker 0.0005, RFC7946", () => {
    const args = buildBdziSimplifyArgs("/in.geojson", "/out.geojson");
    expect(args).toContain("-f");
    expect(args).toContain("GeoJSON");
    expect(args.join(" ")).toContain("-t_srs EPSG:4326");
    expect(args.join(" ")).toContain("-simplify 0.0005");
    expect(args.join(" ")).toContain("RFC7946=YES");
    expect(args.join(" ")).toContain("COORDINATE_PRECISION=6");
    // No explicit layer arg (GeoJSON auto-detects its single layer): last two args
    // are the out then in paths.
    expect(args.slice(-2)).toEqual(["/out.geojson", "/in.geojson"]);
  });

  it("honours an explicit tolerance override", () => {
    expect(buildBdziSimplifyArgs("/in", "/out", 0.001).join(" ")).toContain("-simplify 0.001");
  });
});

describe("simplifyGeoJson", () => {
  it("shells ogr2ogr with the simplify argv and returns the emitted GeoJSON", async () => {
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    const emitted = { type: "FeatureCollection", features: [] };
    const { geojson, args } = await simplifyGeoJson({
      inPath: "/raw.geojson",
      outPath: "/simplified.geojson",
      runner: async (file, a) => {
        calls.push({ file, args: a });
        return { stdout: "", stderr: "" };
      },
      readJson: async () => emitted,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.file).toBe("ogr2ogr");
    expect(calls[0]!.args.join(" ")).toContain("-simplify 0.0005");
    expect(args.join(" ")).toContain("-simplify 0.0005");
    expect(geojson).toBe(emitted);
  });

  it("surfaces a missing-GDAL ENOENT with actionable guidance", async () => {
    await expect(
      simplifyGeoJson({
        inPath: "/raw.geojson",
        outPath: "/out.geojson",
        runner: async () => {
          const err = new Error("spawn ogr2ogr ENOENT") as Error & { code?: string };
          err.code = "ENOENT";
          throw err;
        },
      }),
    ).rejects.toThrow(/GDAL\/ogr2ogr required/);
  });
});

describe("normalizeBdziCapture", () => {
  it("wires bdziNormalizer through the manifest ctx (constraint tag, preserved props)", () => {
    const out = normalizeBdziCapture(rawFloodZoneFc());
    expect(out.features).toHaveLength(1);
    const p = out.features[0]!.properties;
    expect(p.constraint).toBe("bdzi-flood-zones");
    expect(p.geoId).toBe("ca/qc/bdzi-flood-zones/837");
    expect(p.code).toBe("837");
    expect(p.name).toBe("Zone de grand courant");
    expect(p.level).toBe("locality");
    expect(p.country).toBe("CA");
    // Verbatim source attributes preserved (no invention).
    expect(p.No_rapport).toBe("PDCC 16-019");
    expect(p.Nm_rapport).toBe("Rivière Saint-Louis");
    expect(p.Description).toBe("Zone de grand courant");
  });
});

describe("buildServedBdziOverlay + proof-v2 from the capture manifest", () => {
  function proof(): GeometrySourceProof {
    return proofFromCaptureEntry(captureLine(), { type: "arcgis", method: "natif", reliability: "directe" });
  }

  it("derives a valid proof-v2 straight from the capture manifest line", () => {
    const p = proof();
    expect(p.url).toBe(CAPTURE_URL);
    expect(p.retrieved_at).toBe("2026-09-05T12:00:01.000Z");
    expect(p.sha256).toBe(`sha256:${HEX64}`);
    expect(p.type).toBe("arcgis");
  });

  it("stamps proof-v2 on the collection and every feature, geometry untouched", () => {
    const normalized = normalizeBdziCapture(rawFloodZoneFc());
    const before = geometryDigest(normalized.features);
    const served = buildServedBdziOverlay(normalized, proof(), {
      tolerance: 0.0005,
      simplifyApplied: true,
      featureCountRaw: 1,
      captureRunId: "zones-20260905T120000Z-0",
    });
    // Collection proof.
    const collProof = served.proof as { schema_version?: string; geometry_source?: GeometrySourceProof };
    expect(collProof.schema_version).toBe("2.0");
    expect(collProof.geometry_source?.sha256).toBe(`sha256:${HEX64}`);
    expect(collProof.geometry_source?.url).toBe(CAPTURE_URL);
    // Per-feature proof + served source identity + preserved constraint tag.
    const fp = served.features[0]!.properties;
    expect((fp.proof as { schema_version?: string }).schema_version).toBe("2.0");
    expect(fp.zone_source_url).toBe(CAPTURE_URL);
    expect(fp.zone_source_level).toBe("documented");
    expect(fp.constraint).toBe("bdzi-flood-zones");
    // Geometry byte-identical (simplify happens BEFORE this; serve never touches it).
    expect(geometryDigest(served.features)).toBe(before);
    // Simplify tolerance + UNIT traced in provenance.
    expect(served.acquisition?.simplify.tolerance).toBe(0.0005);
    expect(served.acquisition?.simplify.unit).toBe("degree");
    expect(served.acquisition?.constraint).toBe("bdzi-flood-zones");
    expect(served.acquisition?.source_crs_confirmed).toBe("EPSG:4326");
  });

  it("refuses an invalid proof", () => {
    const normalized = normalizeBdziCapture(rawFloodZoneFc());
    const bad = { url: "s3://bucket/key", type: "arcgis", method: "natif", reliability: "directe", retrieved_at: "2026-09-05T12:00:01.000Z", sha256: `sha256:${HEX64}` } as unknown as GeometrySourceProof;
    expect(() => buildServedBdziOverlay(normalized, bad)).toThrow();
  });
});

describe("overlayKeys / overlayBackupKey", () => {
  it("both layouts derive the collection id from the file stem", () => {
    const keys = overlayKeys();
    expect(keys.flat).toBe(`${BDZI_CONSTRAINTS_PREFIX}${BDZI_SERVED_COLLECTION_ID}.geojson`);
    expect(keys.nested).toBe(`${BDZI_CONSTRAINTS_PREFIX}${BDZI_SERVED_COLLECTION_ID}/${BDZI_SERVED_COLLECTION_ID}.geojson`);
    expect(keys.flat).toBe("normalized/ca-qc-constraints/qc-bdzi-flood-zones.geojson");
    expect(keys.nested).toBe("normalized/ca-qc-constraints/qc-bdzi-flood-zones/qc-bdzi-flood-zones.geojson");
  });

  it("backup key lands under a _-prefixed segment (index-excluded)", () => {
    const k = overlayBackupKey("flat", "2026-09-05T1204Z");
    expect(k).toContain("/_replaced/");
    expect(k).toContain("qc-bdzi-flood-zones__overlay-prebackup-flat.2026-09-05T1204Z.geojson");
  });

  it("honours a --prefix override", () => {
    expect(overlayKeys("normalized/custom/").flat).toBe("normalized/custom/qc-bdzi-flood-zones.geojson");
  });
});

describe("readbackLayout (G5)", () => {
  function servedFixture() {
    const normalized = normalizeBdziCapture(rawFloodZoneFc());
    const proof = proofFromCaptureEntry(captureLine(), { type: "arcgis", method: "natif", reliability: "directe" });
    const served = buildServedBdziOverlay(normalized, proof);
    const expectation = {
      featureCount: served.features.length,
      geometryDigest: geometryDigest(served.features),
      proofUrl: proof.url,
      proofSha256: proof.sha256,
    };
    return { served, expectation };
  }

  it("passes when the served bytes match the expectation", () => {
    const { served, expectation } = servedFixture();
    const rb = readbackLayout("nested", overlayKeys().nested, served, expectation);
    expect(rb.ok).toBe(true);
    expect(rb.feature_count_matches).toBe(true);
    expect(rb.geometry_digest_byte_exact).toBe(true);
    expect(rb.collection_proof_v2).toBe(true);
    expect(rb.proof_url_matches).toBe(true);
    expect(rb.proof_sha_matches).toBe(true);
    expect(rb.level_documented_all).toBe(true);
    expect(rb.constraint_tag_all).toBe(true);
  });

  it("fails on an absent object", () => {
    const { expectation } = servedFixture();
    const rb = readbackLayout("flat", overlayKeys().flat, null, expectation);
    expect(rb.present).toBe(false);
    expect(rb.ok).toBe(false);
  });

  it("fails on a feature-count / geometry mismatch", () => {
    const { served, expectation } = servedFixture();
    const tampered = { ...served, features: [] };
    const rb = readbackLayout("nested", overlayKeys().nested, tampered, expectation);
    expect(rb.feature_count_matches).toBe(false);
    expect(rb.ok).toBe(false);
  });

  it("fails when a feature loses the documented level", () => {
    const { served, expectation } = servedFixture();
    const tampered = JSON.parse(JSON.stringify(served)) as typeof served;
    tampered.features[0]!.properties.zone_source_level = "candidate";
    const rb = readbackLayout("nested", overlayKeys().nested, tampered, expectation);
    expect(rb.level_documented_all).toBe(false);
    expect(rb.ok).toBe(false);
  });
});
