import { describe, expect, it } from "vitest";

import {
  MissingSha256RestampRefusal,
  planMissingSha256ProofRestamp,
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

describe("missing-SHA v1 proof restamp plan", () => {
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
