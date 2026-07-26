import { describe, expect, it } from "vitest";

import { proofFromFetched } from "./zonage-proof.js";
import {
  captureManifestKeyFromListedRest,
  captureReceiptFromManifest,
  classifyServedCollection,
  proofTuple,
  selectServedZoneCollections,
  type VerifiedCaptureReceipt,
} from "./zone-provenance-quality.js";

const proof = proofFromFetched({
  url: "https://data.example.test/zones.geojson",
  type: "geojson-officiel",
  method: "natif",
  reliability: "directe",
  bytes: "received bytes",
  retrievedAt: "2026-07-26T15:00:00Z",
});

function collection(geometrySource: unknown = proof) {
  return {
    type: "FeatureCollection",
    proof: { schema_version: "2.0", geometry_source: geometrySource },
    features: [{
      type: "Feature",
      properties: {
        zone_source_url: proof.url,
        zone_source_level: "documented",
        proof: { schema_version: "2.0", geometry_source: geometrySource },
      },
    }],
  };
}

function verifiedCapture(): VerifiedCaptureReceipt {
  return {
    manifest_key: "capture/_runs/zones-20260726T150000Z-0/manifest.jsonl",
    line_index: 0,
    storage_key: `raw/zones/cas/${proof.sha256.slice("sha256:".length)}.json`,
    url: proof.url,
    retrieved_at: proof.retrieved_at,
    sha256: proof.sha256,
    raw_sha256_verified: true,
  };
}

describe("zone provenance quality", () => {
  it("counts a complete served proof only when the exact capture tuple was re-hashed", () => {
    const capture = verifiedCapture();
    const result = classifyServedCollection(collection(), new Map([[proofTuple(proof), capture]]));
    expect(result).toMatchObject({ status: "v2", reason: "verified-v2-capture", capture });
  });

  it("does not promote a proof without sha256 to v2", () => {
    const incomplete = { ...proof, sha256: null };
    expect(classifyServedCollection(collection(incomplete), new Map([[proofTuple(proof), verifiedCapture()]])).status).toBe("acceptable");
  });

  it("does not promote a proof without a real url to v2", () => {
    const incomplete = { ...proof, url: null };
    expect(classifyServedCollection(collection(incomplete), new Map([[proofTuple(proof), verifiedCapture()]])).status).toBe("acceptable");
  });

  it("does not promote a collection the served writer would reject for a missing source url", () => {
    const invalid = collection();
    delete (invalid.features[0]!.properties as Record<string, unknown>).zone_source_url;
    expect(classifyServedCollection(invalid, new Map([[proofTuple(proof), verifiedCapture()]])).status).toBe("acceptable");
  });

  it("does not invent v2 for a collection with no proof", () => {
    const noProof = { type: "FeatureCollection", features: [{ properties: { zone_source_level: "documented" } }] };
    expect(classifyServedCollection(noProof).status).toBe("acceptable");
  });

  it("keeps a structurally complete proof out of v2 when no capture is attached", () => {
    const result = classifyServedCollection(collection());
    expect(result).toMatchObject({ status: "acceptable", reason: "proof-without-attachable-capture", capture: null });
  });

  it("requires the exact retrieved_at value in the capture join", () => {
    const capture = { ...verifiedCapture(), retrieved_at: "2026-07-26T15:00:01Z" };
    expect(classifyServedCollection(collection(), new Map([[proofTuple(capture), capture]])).status).toBe("acceptable");
  });

  it("chooses the nested object geo-api serves when both layouts coexist", () => {
    const prefix = "normalized/ca-qc-zonage/";
    expect(selectServedZoneCollections([
      `${prefix}qc-zonage-alpha.geojson`,
      `${prefix}qc-zonage-alpha/qc-zonage-alpha.geojson`,
      `${prefix}qc-zonage-beta.geojson`,
      `${prefix}_replaced/qc-zonage-ignored.geojson`,
    ])).toEqual([
      {
        slug: "alpha",
        key: `${prefix}qc-zonage-alpha/qc-zonage-alpha.geojson`,
        layout: "nested",
        alternatives: [`${prefix}qc-zonage-alpha.geojson`],
      },
      { slug: "beta", key: `${prefix}qc-zonage-beta.geojson`, layout: "flat", alternatives: [] },
    ]);
  });

  it("keeps the uppercase T and Z from a normative capture run id", () => {
    expect(captureManifestKeyFromListedRest("zones-20260726T150000Z-0/")).toBe(
      "capture/_runs/zones-20260726T150000Z-0/manifest.jsonl",
    );
    expect(captureManifestKeyFromListedRest("zones-20260726T150000Z-0/extra/")).toBeNull();
  });

  it("accepts a capture receipt only when the manifest CAS key agrees with the declared sha", () => {
    const good = captureReceiptFromManifest({
      run_id: "zones-20260726T150000Z-0", lane: "zones", source: "zones", slugs: ["alpha"], url: proof.url,
      method: "GET", attempt: 1, requested_at: "2026-07-26T15:00:00Z", retrieved_at: proof.retrieved_at,
      http_status: 200, redirect_chain: [], final_url: proof.url, content_type: "application/json", bytes: 14,
      sha256: proof.sha256, storage_key: verifiedCapture().storage_key, dedup: false, error: null,
      user_agent: "test", via_obscura: false, egress: "direct", robots: "allowed", redacted: false,
    }, "capture/_runs/zones-20260726T150000Z-0/manifest.jsonl", 0);
    expect(good).toMatchObject({ url: proof.url, sha256: proof.sha256 });
  });
});
