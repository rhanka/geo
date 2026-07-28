import { describe, expect, it } from "vitest";

import {
  isHttpsCaptureUrl,
  manifestUrlMatchesServedEnvelope,
  MissingSha256RestampRefusal,
  planMissingSha256ProofRestamp,
  selectEquivalentManifestReceipt,
} from "./served-zonage-proof-url-restamp.js";

const KEY = "normalized/ca-qc-zonage/qc-zonage-alpha.geojson";
const ARTIFACT = `s3://sentropic-geo/${KEY}`;
const URL = "https://data.example.org/zoning/alpha";
const SHA = `sha256:${"a".repeat(64)}` as const;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function served(): Record<string, unknown> {
  return {
    type: "FeatureCollection",
    features: [{
      geometry: { type: "Point", coordinates: [0, 0] },
      properties: {
        zone_code: "R-1",
        proof: {
          schema_version: "1.0",
          sources: {
            geometry: { status: "available", artifact_uri: ARTIFACT, upstream_uri: URL },
            regulation: { status: "unavailable", artifact_uri: null, upstream_uri: null },
          },
          zone: null,
          gaps: [],
        },
      },
    }],
  };
}

const attestation = () => ({
  artifactUri: ARTIFACT,
  replacementUrl: URL,
  sha256: SHA,
  storage_key: `raw/zones-v1-proof-url/cas/${"a".repeat(64)}.json`,
  retrieved_at: "2026-07-27T22:00:00.000Z",
  manifest_key: "capture/_runs/zones-20260727T220000Z-0/manifest.jsonl",
  line_index: 4,
});

interface TestManifestReceipt {
  storage_key: string;
  url: string;
  sha256: `sha256:${string}`;
  retrieved_at: string;
  manifest_key: string;
  line_index: number;
}

const receipt = (overrides: Partial<TestManifestReceipt> = {}): TestManifestReceipt => ({
  storage_key: `raw/zones-v1-proof-url/cas/${"a".repeat(64)}.json`,
  url: URL,
  sha256: SHA,
  retrieved_at: "2026-07-27T22:00:00.000Z",
  manifest_key: "capture/_runs/zones-20260727T220000Z-0/manifest.jsonl",
  line_index: 4,
  ...overrides,
});

describe("missing-SHA v1 proof restamp plan", () => {
  it("accepts an HTTPS geometry endpoint whose query is required by ArcGIS", () => {
    expect(isHttpsCaptureUrl("https://services.example.org/FeatureServer/0/query?where=1%3D1&f=geojson")).toBe(true);
    expect(isHttpsCaptureUrl("http://services.example.org/FeatureServer/0/query?f=geojson")).toBe(false);
  });

  it("matches an ArcGIS query receipt to the served layer endpoint", () => {
    const endpoint = "https://services.example.org/arcgis/rest/services/Zonage/FeatureServer/5";
    const captureUrl = `${endpoint}/query?where=1%3D1&outFields=*&f=geojson`;
    expect(manifestUrlMatchesServedEnvelope(captureUrl, endpoint)).toBe(true);
  });

  it("never matches an ArcGIS query receipt to a different served layer endpoint", () => {
    const captureUrl = "https://services.example.org/arcgis/rest/services/Zonage/FeatureServer/5/query?where=1%3D1&outFields=*&f=geojson";
    const otherEndpoint = "https://services.example.org/arcgis/rest/services/Zonage/FeatureServer/6";
    expect(manifestUrlMatchesServedEnvelope(captureUrl, otherEndpoint)).toBe(false);
  });

  it("chooses one deterministic manifest line when replayed jobs kept the same CAS receipt", () => {
    const first = receipt({ retrieved_at: "2026-07-28T04:00:00.000Z", manifest_key: "capture/_runs/zones-a/manifest.jsonl", line_index: 1 });
    const replay = receipt({ retrieved_at: "2026-07-28T04:01:00.000Z", manifest_key: "capture/_runs/zones-b/manifest.jsonl", line_index: 2 });
    expect(selectEquivalentManifestReceipt([replay, first])).toEqual(first);
    expect(selectEquivalentManifestReceipt([first, receipt({ sha256: `sha256:${"b".repeat(64)}` })])).toBeNull();
  });

  it("couples the manifest URL and SHA without changing geometry or sibling proof fields", () => {
    const current = served();
    const { next, attestations } = planMissingSha256ProofRestamp(KEY, current, [attestation()]);
    const geometry = (next.features as any)[0].properties.proof.sources.geometry;
    expect(geometry).toEqual({ status: "available", artifact_uri: URL, upstream_uri: URL, sha256: SHA });
    expect((next.features as any)[0].geometry).toEqual((current.features as any)[0].geometry);
    expect(attestations).toEqual([attestation()]);
  });

  it("refuses an attestation whose URL does not exactly match the served envelope", () => {
    const current = served();
    const wrong = { ...attestation(), replacementUrl: "https://data.example.org/zoning/other" };
    expect(() => planMissingSha256ProofRestamp(KEY, current, [wrong])).toThrow(/manifest-url-does-not-match-served-envelope/);
  });

  it("refuses to overwrite an already-present SHA-256", () => {
    const current: any = clone(served());
    current.features[0].properties.proof.sources.geometry.sha256 = SHA;
    expect(() => planMissingSha256ProofRestamp(KEY, current, [attestation()])).toThrow(MissingSha256RestampRefusal);
    expect(() => planMissingSha256ProofRestamp(KEY, current, [attestation()])).toThrow(/envelope-sha256-present-or-malformed/);
  });
});
