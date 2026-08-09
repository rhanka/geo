import { describe, expect, it } from "vitest";

import {
  classifyReglementCityCapture,
  classifyReglementUrlCapture,
  observeReglementUrls,
  type AttachableCapture,
  type FailedCaptureAttempt,
} from "./reglement-capture-kpi.js";

const URL_A = "https://ville.example/reglement-a.pdf";
const URL_B = "https://ville.example/reglement-b.pdf";
const SHA_A = `sha256:${"a".repeat(64)}` as const;
const SHA_B = `sha256:${"b".repeat(64)}` as const;

function capture(url: string, sha256 = SHA_A, retrievedAt = "2026-07-01T00:00:00.000Z"): AttachableCapture {
  return {
    url,
    sha256,
    retrieved_at: retrievedAt,
    storage_key: `raw/reglement-served/cas/${sha256.slice("sha256:".length)}.pdf`,
    manifest_key: "capture/_runs/reglement-20260701T000000Z-0/manifest.jsonl",
    line_index: 0,
    source: "reglement-served",
  };
}

function failed(url: string): FailedCaptureAttempt {
  return {
    url,
    requested_at: "2026-07-01T00:00:00.000Z",
    retrieved_at: null,
    http_status: 404,
    error: "HTTP 404",
    manifest_key: "capture/_runs/reglement-20260701T000000Z-0/manifest.jsonl",
    line_index: 1,
  };
}

describe("règlement capture KPI", () => {
  it("should retain only literal HTTP(S) URLs served on features", () => {
    expect(observeReglementUrls({
      features: [
        { properties: { reglement_url: URL_A } },
        { properties: { reglement_url: URL_A } },
        { properties: { reglement_url: "not-a-url" } },
        { properties: { reglement_url: null } },
      ],
    })).toEqual({
      urls: [URL_A],
      feature_count: 4,
      features_with_reglement_url: 3,
      features_with_http_reglement_url: 2,
      features_with_invalid_reglement_url: 1,
    });
  });

  it("should keep a 404 as a failed attempt rather than invented CAS evidence", () => {
    expect(classifyReglementUrlCapture(URL_A, { attachable: [], failed: [failed(URL_A)] })).toMatchObject({
      state: "jamais_capture",
      captures: [],
      failed_attempts: [{ http_status: 404, error: "HTTP 404" }],
      change: null,
    });
  });

  it("should detect a change only when the same URL has two distinct shas", () => {
    const changed = classifyReglementUrlCapture(URL_A, {
      attachable: [capture(URL_A, SHA_A, "2026-07-01T00:00:00.000Z"), capture(URL_A, SHA_B, "2026-07-02T00:00:00.000Z")],
      failed: [],
    });
    expect(changed).toMatchObject({
      state: "change",
      change: { previous: { sha256: SHA_A }, current: { sha256: SHA_B } },
    });

    expect(classifyReglementUrlCapture(URL_A, {
      attachable: [capture(URL_A, SHA_A), capture(URL_B, SHA_B)],
      failed: [],
    }).state).toBe("capture_inchange");
  });

  it("should keep cities without a served URL unknown and expose partial coverage", () => {
    expect(classifyReglementCityCapture([], { attachable: [], failed: [] }).state).toBe("unknown");
    expect(classifyReglementCityCapture([URL_A, URL_B], {
      attachable: [capture(URL_A)],
      failed: [],
    })).toMatchObject({
      state: "capture_inchange",
      urls_total: 2,
      urls_captured: 1,
      urls_missing_capture: 1,
    });
  });
});
