import { describe, expect, it } from "vitest";

import type { CaptureManifestLine } from "../../../packages/qc-sources/src/capture/index.js";

import {
  classifyRawCaptureAuditBaseline,
  type RawCaptureAuditBaseline,
  type RawCaptureAuditManifestLine,
} from "./zone-provenance-raw-capture-audit.js";

const baseline: RawCaptureAuditBaseline = {
  city_slug: "alpha",
  collection_key: "normalized/ca-qc-zonage/qc-zonage-alpha.geojson",
  proof: {
    url: "https://data.example.test/zones?city=alpha",
    retrieved_at: "2026-07-26T12:00:00.000Z",
    sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  },
};

function manifest(overrides: Partial<CaptureManifestLine> = {}): RawCaptureAuditManifestLine {
  const line: CaptureManifestLine = {
    run_id: "zones-20260726T120000Z-0",
    lane: "zones",
    source: "zones-wfs",
    slugs: ["alpha"],
    url: baseline.proof.url,
    method: "GET",
    attempt: 1,
    requested_at: "2026-07-26T11:59:59.000Z",
    retrieved_at: baseline.proof.retrieved_at,
    http_status: 200,
    redirect_chain: [],
    final_url: baseline.proof.url,
    content_type: "application/json",
    bytes: 1,
    sha256: baseline.proof.sha256,
    storage_key: "raw/zones-wfs/cas/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json",
    dedup: false,
    error: null,
    user_agent: "test",
    via_obscura: false,
    egress: "direct",
    robots: "allowed",
    redacted: false,
    ...overrides,
  };
  return {
    manifest_key: "capture/_runs/zones-20260726T120000Z-0/manifest.jsonl",
    line_index: 0,
    line,
    receipt: null,
  };
}

describe("raw capture audit classification", () => {
  it("reports cause a only when no manifest line names the served city", () => {
    expect(classifyRawCaptureAuditBaseline(baseline, [manifest({ slugs: ["beta"] })])).toEqual({
      cause: "a",
      reason: "no-manifest-line-for-city-slug",
      manifest_lines_for_city: 0,
    });
  });

  it("reports the one verbatim tuple difference only after two fields agree", () => {
    const result = classifyRawCaptureAuditBaseline(baseline, [manifest({
      retrieved_at: "2026-07-26T12:00:01.000Z",
    })]);
    expect(result).toMatchObject({
      cause: "b",
      reason: "manifest-line-shares-two-proof-fields",
      fields_differ: [{
        field: "retrieved_at",
        served: "2026-07-26T12:00:00.000Z",
        manifest: "2026-07-26T12:00:01.000Z",
      }],
    });
  });

  it("does not call a same-city but unidentifying line a tuple mismatch", () => {
    const result = classifyRawCaptureAuditBaseline(baseline, [manifest({
      url: "https://data.example.test/zones?city=other",
      retrieved_at: "2026-07-26T12:00:01.000Z",
    })]);
    expect(result).toMatchObject({
      cause: "d",
      reason: "manifest-lines-for-city-do-not-identify-the-served-fetch",
    });
  });

  it("keeps an exact tuple pending until its CAS payload is verified", () => {
    const entry = manifest();
    entry.receipt = {
      manifest_key: entry.manifest_key,
      line_index: entry.line_index,
      storage_key: entry.line.storage_key!,
      url: baseline.proof.url,
      retrieved_at: baseline.proof.retrieved_at,
      sha256: baseline.proof.sha256,
    };
    expect(classifyRawCaptureAuditBaseline(baseline, [entry])).toMatchObject({
      cause: "d",
      reason: "matching-manifest-receipt-awaits-cas-verification",
      receipt: entry.receipt,
    });
  });
});
