import { describe, expect, it } from "vitest";

import {
  classifyPvCityCapture,
  classifyPvDocumentCapture,
  type AttachablePvCapture,
  type FailedPvCaptureAttempt,
} from "./pv-capture-kpi.js";

const URL_A = "https://ville.example/pv-a.pdf";
const URL_B = "https://ville.example/pv-b.pdf";
const SHA_A = `sha256:${"a".repeat(64)}` as const;

function capture(url: string): AttachablePvCapture {
  return {
    url,
    sha256: SHA_A,
    retrieved_at: "2026-07-26T00:00:00.000Z",
    storage_key: `raw/pv-index/cas/${SHA_A.slice("sha256:".length)}.pdf`,
    manifest_key: "capture/_runs/pv-20260726T000000Z-0/manifest.jsonl",
    line_index: 0,
    source: "pv-index",
  };
}

function failed(url: string): FailedPvCaptureAttempt {
  return {
    url,
    requested_at: "2026-07-26T00:00:00.000Z",
    retrieved_at: null,
    http_status: 404,
    error: "HTTP 404",
    manifest_key: "capture/_runs/pv-20260726T000000Z-0/manifest.jsonl",
    line_index: 1,
  };
}

describe("PV capture KPI", () => {
  it("retains a 404 as a failed attempt instead of CAS evidence", () => {
    expect(classifyPvDocumentCapture(URL_A, { attachable: [], failed: [failed(URL_A)] })).toMatchObject({
      state: "sans_octets",
      captures: [],
      failed_attempts: [{ http_status: 404, error: "HTTP 404" }],
    });
  });

  it("keeps missing index distinct from an indexed city without bytes", () => {
    expect(classifyPvCityCapture(false, [], { attachable: [], failed: [] })).toMatchObject({
      state: "sans_index",
      documents_total: 0,
    });
    expect(classifyPvCityCapture(true, [URL_A], { attachable: [], failed: [] })).toMatchObject({
      state: "index_sans_octets",
      documents_without_octets: 1,
    });
  });

  it("exposes partial capture rather than treating one CAS as city completeness", () => {
    expect(classifyPvCityCapture(true, [URL_A, URL_B], {
      attachable: [capture(URL_A)],
      failed: [failed(URL_B)],
    })).toMatchObject({
      state: "octets_conserves",
      documents_total: 2,
      documents_with_octets: 1,
      documents_without_octets: 1,
      failed_attempts_total: 1,
    });
  });
});
