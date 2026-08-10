import { describe, expect, it } from "vitest";

import {
  CapturedNormesCampaignEntrySchema,
  CapturedNormesCampaignPlanSchema,
  CapturedNormesSourceAbsenceReceiptSchema,
  CapturedNormesExtractionReceiptSchema,
  CapturedNormesDiscoveryReceiptSchema,
  CapturedNormesDiscoveryRunReceiptSchema,
  assertCapturedNormesReference,
  assertCapturedNormesCampaignEvidence,
  selectionIncludesPdfCaptureUrl,
  selectNormesPdfCandidates,
  selectNormesSubpages,
} from "./normes.js";
import type { CapturedNormesExtractionReceipt } from "./normes.js";
import { parseCaptureWorklist } from "./worklist.js";

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

  it("keeps a bounded internal urbanisme link without inventing a URL", () => {
    const selected = selectNormesSubpages(
      '<a href="/services/urbanisme">Service de l’urbanisme</a><a href="/video/reglement.mp4">Règlement vidéo</a><a href="https://example.org">Externe</a>',
      reference,
    );
    expect(selected.subpages).toEqual([{ url: "https://sra.quebec/services/urbanisme", anchor: "Service de l’urbanisme" }]);
  });
});

describe("selectionIncludesPdfCaptureUrl", () => {
  it("accepts only an exact URL from a same-city subpage selection", () => {
    const selection = selectNormesSubpages(
      '<a href="/reglements/zonage">Règlement de zonage</a>',
      reference,
    );
    expect(selectionIncludesPdfCaptureUrl(selection, reference.slug, "https://sra.quebec/reglements/zonage")).toBe(true);
    expect(selectionIncludesPdfCaptureUrl(selection, reference.slug, "https://sra.quebec/reglements/autre")).toBe(false);
    expect(selectionIncludesPdfCaptureUrl(selection, "another-city", "https://sra.quebec/reglements/zonage")).toBe(false);
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

describe("CapturedNormesCampaignPlanSchema", () => {
  const city = (slug: string) => ({
    slug,
    outcome: "no-grid" as const,
    discovery_run_receipt_key: `registry/normes-captured-discovery-run-receipts/run/${slug}.json`,
    extraction_receipt_keys: [],
  });

  it("requires exactly ten unique city outcomes", () => {
    const plan = {
      campaign: "normes-col3-20260810",
      closed_at: "2026-08-10T01:02:00.000Z",
      cities: Array.from({ length: 10 }, (_value, index) => city(`city-${index}`)),
    };
    expect(CapturedNormesCampaignPlanSchema.safeParse(plan).success).toBe(true);
    expect(CapturedNormesCampaignPlanSchema.safeParse({
      ...plan,
      cities: [...plan.cities.slice(0, 9), city("city-0")],
    }).success).toBe(false);
  });

  it("requires a Mistral receipt for every Mistral outcome", () => {
    const base = city("city-0");
    expect(CapturedNormesCampaignEntrySchema.safeParse({
      ...base,
      outcome: "mistral-below-gate",
    }).success).toBe(false);
    expect(CapturedNormesCampaignEntrySchema.safeParse({
      ...base,
      outcome: "mistral-deposited",
    }).success).toBe(false);
    expect(CapturedNormesCampaignEntrySchema.safeParse({
      ...base,
      outcome: "mistral-refused",
    }).success).toBe(false);
    expect(CapturedNormesCampaignEntrySchema.safeParse({
      ...base,
      extraction_receipt_keys: ["registry/normes-captured-receipts/abcdef.json"],
    }).success).toBe(false);
  });

  it("closes a no-official-source city only from its immutable MAMH absence receipt", () => {
    const absence = {
      contract: "captured-normes-source-absence-receipt/v1",
      slug: "city-absence",
      status: "no-official-source" as const,
      directory_sha256: SHA,
      directory: {
        schema: "qc-municipal-directory/v1",
        generated_at: "2026-06-16T00:52:48.516Z",
        source: {
          name: "MAMH — Répertoire des municipalités du Québec",
          dataset: "repertoire-des-municipalites-du-quebec",
          dataset_url: "https://www.donneesquebec.ca/recherche/dataset/repertoire-des-municipalites-du-quebec",
          resource_url: "https://donneesouvertes.affmunqc.net/repertoire/MUN.csv",
          license: "cc-by-4.0",
          field: "mweb",
          join_key: "nfd-normalized-name",
        },
      },
      entry: {
        slug: "city-absence",
        name: "City Absence",
        mamh_code: "12345",
        mamh_name: "City Absence",
        designation: "Municipalité",
        website: null,
        source: "mamh-repertoire",
        verified_at: "2026-06-15",
      },
    };
    const entry = {
      slug: absence.slug,
      outcome: "no-official-source" as const,
      source_absence_receipt_key: "registry/normes-captured-source-absence-receipts/city-absence/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json",
      extraction_receipt_keys: [],
    };
    expect(CapturedNormesSourceAbsenceReceiptSchema.safeParse(absence).success).toBe(true);
    expect(CapturedNormesCampaignEntrySchema.safeParse(entry).success).toBe(true);
    expect(() => assertCapturedNormesCampaignEvidence(entry, null, [], absence)).not.toThrow();
    expect(CapturedNormesSourceAbsenceReceiptSchema.safeParse({
      ...absence,
      entry: { ...absence.entry, website: "https://invented.example" },
    }).success).toBe(false);
    expect(() => assertCapturedNormesCampaignEvidence(entry, null, [], {
      ...absence,
      entry: { ...absence.entry, slug: "another-city" },
    })).toThrow();
  });

  it("accepts a deposited Mistral receipt tied to its discovery PDF selection", () => {
    const entry = {
      ...city(reference.slug),
      outcome: "mistral-deposited" as const,
      extraction_receipt_keys: ["registry/normes-captured-receipts/abcdef.json"],
    };
    const discovery = {
      contract: "captured-normes-discovery-run-receipt/v1",
      generated_at: "2026-08-10T01:02:00.000Z",
      run_id: RUN,
      manifest_key: MANIFEST,
      slug: reference.slug,
      attempts: [],
      page_receipt_keys: ["registry/normes-captured-discovery-receipts/run/1.json"],
      candidate_count: 1,
      status: "candidates",
      refusal: null,
    };
    const selection = {
      contract: "captured-normes-pdf-selection/v1",
      generated_at: reference.retrieved_at,
      source_capture: reference,
      candidates: [{ slug: reference.slug, pdf_url: reference.url, titre: "Grille", score_classif: 6, matched: ["grille"] }],
    };
    const receipt = {
      contract: "captured-normes-extraction-receipt/v1",
      generated_at: "2026-08-10T01:02:00.000Z",
      capture: reference,
      engine: "mistral-schema",
      methode: "ocr/mistral-schema",
      pages: [1],
      budget_usd: 1,
      status: "deposited" as const,
      parquet_key: "registry/qc-zonage-norms/qc-zonage-norms-saint-roch-de-lachigan.parquet",
      refusal: null,
    } satisfies CapturedNormesExtractionReceipt;
    expect(() => assertCapturedNormesCampaignEvidence(entry, discovery, [{ receipt, selection }])).not.toThrow();
  });

  it("accepts an explicit non-gate Mistral refusal tied to its discovery PDF selection", () => {
    const entry = {
      ...city(reference.slug),
      outcome: "mistral-refused" as const,
      extraction_receipt_keys: ["registry/normes-captured-receipts/abcdef.json"],
    };
    const discovery = {
      contract: "captured-normes-discovery-run-receipt/v1",
      generated_at: "2026-08-10T01:02:00.000Z",
      run_id: RUN,
      manifest_key: MANIFEST,
      slug: reference.slug,
      attempts: [],
      page_receipt_keys: ["registry/normes-captured-discovery-receipts/run/1.json"],
      candidate_count: 1,
      status: "candidates",
      refusal: null,
    };
    const selection = {
      contract: "captured-normes-pdf-selection/v1",
      generated_at: reference.retrieved_at,
      source_capture: reference,
      candidates: [{ slug: reference.slug, pdf_url: reference.url, titre: "Grille", score_classif: 6, matched: ["grille"] }],
    };
    const receipt = {
      contract: "captured-normes-extraction-receipt/v1",
      generated_at: "2026-08-10T01:02:00.000Z",
      capture: reference,
      engine: "mistral-schema",
      methode: "ocr/mistral-schema",
      pages: [],
      budget_usd: 1,
      status: "refused" as const,
      parquet_key: null,
      refusal: "existing norms parquet without captured bridge receipt: registry/qc-zonage-norms/example.parquet",
    } satisfies CapturedNormesExtractionReceipt;
    expect(() => assertCapturedNormesCampaignEvidence(entry, discovery, [{ receipt, selection }])).not.toThrow();
  });

  it("accepts a deposited PDF that was a verbatim direct subpage link", () => {
    const directUrl = "https://sra.quebec/reglements/zonage";
    const directCapture = { ...reference, url: directUrl, final_url: `${directUrl}.pdf` };
    const entry = {
      ...city(reference.slug),
      outcome: "mistral-deposited" as const,
      extraction_receipt_keys: ["registry/normes-captured-receipts/abcdef.json"],
    };
    const discovery = {
      contract: "captured-normes-discovery-run-receipt/v1",
      generated_at: "2026-08-10T01:02:00.000Z",
      run_id: RUN,
      manifest_key: MANIFEST,
      slug: reference.slug,
      attempts: [],
      page_receipt_keys: ["registry/normes-captured-discovery-receipts/run/1.json"],
      candidate_count: 0,
      status: "refused",
      refusal: "no classified grille PDF candidate in eligible captured HTML",
    };
    const selection = {
      contract: "captured-normes-subpage-selection/v1",
      generated_at: reference.retrieved_at,
      source_capture: reference,
      subpages: [{ url: directUrl, anchor: "Règlement de zonage" }],
    };
    const receipt = {
      contract: "captured-normes-extraction-receipt/v1",
      generated_at: "2026-08-10T01:02:00.000Z",
      capture: directCapture,
      engine: "mistral-schema",
      methode: "ocr/mistral-schema",
      pages: [1],
      budget_usd: 1,
      status: "deposited" as const,
      parquet_key: "registry/qc-zonage-norms/qc-zonage-norms-saint-roch-de-lachigan.parquet",
      refusal: null,
    } satisfies CapturedNormesExtractionReceipt;
    expect(() => assertCapturedNormesCampaignEvidence(entry, discovery, [{ receipt, selection }])).not.toThrow();
  });
});

describe("captured normes derived worklist", () => {
  it("keeps the immutable subpage-selection key in the validated capture control", () => {
    const parsed = parseCaptureWorklist([{
      slug: reference.slug,
      source: "normes-grille-discovery",
      urls: ["https://sra.quebec/urbanisme"],
      derivation: {
        kind: "captured-normes-subpages/v1",
        selection_key: "registry/normes-captured-subpages/example/1.json",
      },
    }]);
    expect(parsed[0]!.derivation?.selection_key).toContain("normes-captured-subpages");
  });

  it("accepts the immutable PDF selection as the derivation of a PDF capture", () => {
    const parsed = parseCaptureWorklist([{
      slug: reference.slug,
      source: "normes-grille-pdf",
      urls: [reference.url],
      derivation: {
        kind: "captured-normes-pdf-selection/v1",
        selection_key: "registry/normes-captured-discovery/example/1.json",
      },
    }]);
    expect(parsed[0]!.derivation?.kind).toBe("captured-normes-pdf-selection/v1");
  });

  it("accepts an immutable subpage selection for a PDF that has no URL suffix", () => {
    const parsed = parseCaptureWorklist([{
      slug: reference.slug,
      source: "normes-grille-pdf",
      urls: ["https://sra.quebec/reglements/zonage"],
      derivation: {
        kind: "captured-normes-subpages/v1",
        selection_key: "registry/normes-captured-subpages/example/1.json",
      },
    }]);
    expect(parsed[0]!.derivation?.kind).toBe("captured-normes-subpages/v1");
  });
});
