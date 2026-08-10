import { describe, expect, it } from "vitest";

import {
  CapturedNormesExtractionReceiptSchema,
  CapturedNormesDiscoveryReceiptSchema,
  CapturedNormesDiscoveryRunReceiptSchema,
  assertCapturedNormesReference,
  selectNormesPdfCandidates,
} from "./normes.js";

const RUN = "normes-20260810T011257Z-0-example";
const MANIFEST = `capture/_runs/${RUN}/manifest.jsonl`;
const SHA = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const KEY = "raw/normes-grille-pdf/cas/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pdf";
const reference = {
  slug: "saint-roch-de-lachigan",
  run_id: RUN,
  manifest_key: MANIFEST,
  line_index: 1,
  url: "https://sra.quebec/documents/grille.pdf",
  final_url: "https://sra.quebec/documents/grille.pdf",
  retrieved_at: "2026-08-10T01:00:02.000Z",
  sha256: SHA,
  storage_key: KEY,
  selection_key: "registry/normes-captured-discovery/example/1.json",
};
const header = {
  run_id: RUN, lane: "normes", execution: "cluster", git_sha: "abc", worklist: "registry/capture-worklists/normes.json",
  started_at: "2026-08-10T01:00:00.000Z", finished_at: "2026-08-10T01:01:00.000Z", exit_code: 0,
  user_agent: "test", egress: "direct", via_obscura: false,
  counts: { attempts: 1, ok: 1, failed: 0, dedup: 0, bytes: 10 },
};
const line = {
  run_id: RUN, lane: "normes", source: "normes-grille-pdf", slugs: [reference.slug], url: reference.url,
  method: "GET", attempt: 1, requested_at: "2026-08-10T01:00:01.000Z", retrieved_at: "2026-08-10T01:00:02.000Z",
  http_status: 200, redirect_chain: [], final_url: reference.url, content_type: "application/pdf", bytes: 10,
  sha256: SHA, storage_key: KEY, dedup: false, error: null, user_agent: "test", via_obscura: false,
  egress: "direct", robots: "allowed", redacted: false,
};

describe("assertCapturedNormesReference", () => {
  it("accepts one exact successful cluster normes capture", () => {
    expect(assertCapturedNormesReference(reference, header, line)).toEqual(reference);
  });

  it.each([
    ["local execution", { ...header, execution: "local" }, line],
    ["another lane", { ...header, lane: "pv" }, line],
    ["wrong slug", header, { ...line, slugs: [] }],
    ["redacted url", header, { ...line, redacted: true }],
    ["failed response", header, { ...line, http_status: 404 }],
    ["mismatched raw key", header, { ...line, storage_key: KEY.replace(".pdf", ".html") }],
  ])("rejects %s", (_name, candidateHeader, candidateLine) => {
    expect(() => assertCapturedNormesReference(reference, candidateHeader, candidateLine)).toThrow();
  });
});

describe("selectNormesPdfCandidates", () => {
  it("keeps only verbatim scored PDF links without fetching them", () => {
    const selected = selectNormesPdfCandidates(
      '<a href="/docs/grille-des-specifications.pdf">Grille des spécifications</a><a href="/docs/avis.pdf">Avis</a>',
      reference,
    );
    expect(selected.candidates).toEqual([expect.objectContaining({
      slug: reference.slug,
      pdf_url: "https://sra.quebec/docs/grille-des-specifications.pdf",
    })]);
  });
});

describe("CapturedNormesExtractionReceiptSchema", () => {
  it("requires a parquet only for a deposited result", () => {
    expect(CapturedNormesExtractionReceiptSchema.safeParse({
      contract: "captured-normes-extraction-receipt/v1", generated_at: "2026-08-10T01:02:00.000Z",
      capture: reference, engine: "mistral-schema", methode: "ocr/mistral-schema", pages: [1], budget_usd: 1,
      status: "deposited", parquet_key: null, refusal: null,
    }).success).toBe(false);
  });
});

describe("CapturedNormesDiscoveryReceiptSchema", () => {
  it("requires an explicit reason for an empty candidate partition", () => {
    expect(CapturedNormesDiscoveryReceiptSchema.safeParse({
      contract: "captured-normes-discovery-receipt/v1", generated_at: "2026-08-10T01:02:00.000Z",
      capture: { ...reference, selection_key: null }, selection_key: "registry/normes-captured-discovery/example/1.json",
      candidate_count: 0, status: "refused", refusal: null,
    }).success).toBe(false);
  });
});

describe("CapturedNormesDiscoveryRunReceiptSchema", () => {
  it("closes a failed city run explicitly when no HTML is eligible", () => {
    const receipt = CapturedNormesDiscoveryRunReceiptSchema.parse({
      contract: "captured-normes-discovery-run-receipt/v1", generated_at: "2026-08-10T01:02:00.000Z",
      run_id: RUN, manifest_key: MANIFEST, slug: reference.slug,
      attempts: [{
        line_index: 1, url: reference.url, final_url: null, http_status: null,
        content_type: null, storage_key: null, sha256: null, error: "fetch failed",
      }],
      page_receipt_keys: [], candidate_count: 0, status: "refused",
      refusal: "no successful text/html capture eligible for discovery",
    });
    expect(receipt.status).toBe("refused");
    expect(CapturedNormesDiscoveryRunReceiptSchema.safeParse({ ...receipt, refusal: null }).success).toBe(false);
  });
});
