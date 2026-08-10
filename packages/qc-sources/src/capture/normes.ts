/**
 * Contracts for the NORMES path that starts from a durable cluster capture.
 *
 * A URL is not an identity: the exact run, manifest line, CAS key and digest are
 * carried through to the extraction receipt. This module is pure so every runner
 * can reject an unprovable reference before it reaches an OCR provider.
 */
import { z } from "zod";

import {
  CaptureManifestLineSchema,
  CaptureRunHeaderSchema,
  captureRunKeys,
  type CaptureManifestLine,
  type CaptureRunHeader,
} from "./manifest.js";
import {
  discoverGrillesInHtml,
  extractInternalSubpages,
  type GrilleCandidate,
} from "../sources/grille-discovery.js";

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const SHA_RE = /^sha256:[a-f0-9]{64}$/;
const CAS_RE = /^raw\/[a-z0-9][a-z0-9._-]*\/cas\/[a-f0-9]{64}\.[a-z0-9]+$/;

export const CapturedNormesReferenceSchema = z.object({
  slug: z.string().regex(SLUG_RE),
  run_id: z.string().min(1),
  manifest_key: z.string().min(1),
  line_index: z.number().int().nonnegative(),
  url: z.string().url(),
  final_url: z.string().url(),
  retrieved_at: z.string().datetime(),
  sha256: z.string().regex(SHA_RE),
  storage_key: z.string().regex(CAS_RE),
  /** Immutable HTML-derived selection that justified a second-phase PDF capture. */
  selection_key: z.string().min(1).nullable(),
}).strict();
export type CapturedNormesReference = z.infer<typeof CapturedNormesReferenceSchema>;

export const CapturedNormesPdfSelectionSchema = z.object({
  contract: z.literal("captured-normes-pdf-selection/v1"),
  generated_at: z.string().datetime(),
  source_capture: CapturedNormesReferenceSchema,
  candidates: z.array(z.object({
    slug: z.string().regex(SLUG_RE),
    pdf_url: z.string().url(),
    titre: z.string(),
    score_classif: z.number(),
    matched: z.array(z.string()),
  }).strict()),
}).strict();
export type CapturedNormesPdfSelection = z.infer<typeof CapturedNormesPdfSelectionSchema>;

/** Bounded same-site HTML links verbatim-derived from one captured source page. */
export const CapturedNormesSubpageSelectionSchema = z.object({
  contract: z.literal("captured-normes-subpage-selection/v1"),
  generated_at: z.string().datetime(),
  source_capture: CapturedNormesReferenceSchema,
  subpages: z.array(z.object({
    url: z.string().url(),
    anchor: z.string().min(1),
  }).strict()).max(5),
}).strict();
export type CapturedNormesSubpageSelection = z.infer<typeof CapturedNormesSubpageSelectionSchema>;

/**
 * A second-phase PDF can be justified either by a classified PDF link or by a
 * bounded, verbatim urbanisme subpage link whose response later proves to be a
 * PDF. Both controls remain immutable and schema-validated.
 */
export const CapturedNormesPdfCaptureSelectionSchema = z.union([
  CapturedNormesPdfSelectionSchema,
  CapturedNormesSubpageSelectionSchema,
]);
export type CapturedNormesPdfCaptureSelection = z.infer<typeof CapturedNormesPdfCaptureSelectionSchema>;

/** Immutable closure for the HTML discovery phase, including an honest no-grid outcome. */
export const CapturedNormesDiscoveryReceiptSchema = z.object({
  contract: z.literal("captured-normes-discovery-receipt/v1"),
  generated_at: z.string().datetime(),
  capture: CapturedNormesReferenceSchema,
  selection_key: z.string().min(1),
  candidate_count: z.number().int().nonnegative(),
  status: z.enum(["candidates", "refused"]),
  refusal: z.string().min(1).nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.status === "candidates" && (value.candidate_count === 0 || value.refusal !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "candidates receipt requires candidates and no refusal" });
  }
  if (value.status === "refused" && (value.candidate_count !== 0 || value.refusal === null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "refused receipt requires zero candidates and a reason" });
  }
});
export type CapturedNormesDiscoveryReceipt = z.infer<typeof CapturedNormesDiscoveryReceiptSchema>;

/**
 * Closes one bounded discovery run for a city, including runs with no readable
 * HTML line. Per-page receipts retain successful HTML provenance; this
 * aggregate prevents a transport failure from disappearing as an empty result.
 */
export const CapturedNormesDiscoveryRunReceiptSchema = z.object({
  contract: z.literal("captured-normes-discovery-run-receipt/v1"),
  generated_at: z.string().datetime(),
  run_id: z.string().min(1),
  manifest_key: z.string().min(1),
  slug: z.string().regex(SLUG_RE),
  attempts: z.array(z.object({
    line_index: z.number().int().nonnegative(),
    url: z.string().url(),
    final_url: z.string().url().nullable(),
    http_status: z.number().int().nullable(),
    content_type: z.string().nullable(),
    storage_key: z.string().nullable(),
    sha256: z.string().nullable(),
    error: z.string().nullable(),
  }).strict()),
  page_receipt_keys: z.array(z.string().min(1)),
  candidate_count: z.number().int().nonnegative(),
  status: z.enum(["candidates", "refused"]),
  refusal: z.string().min(1).nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.status === "candidates" && (value.candidate_count === 0 || value.refusal !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "candidates run receipt requires candidates and no refusal" });
  }
  if (value.status === "refused" && (value.candidate_count !== 0 || value.refusal === null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "refused run receipt requires zero candidates and a reason" });
  }
});
export type CapturedNormesDiscoveryRunReceipt = z.infer<typeof CapturedNormesDiscoveryRunReceiptSchema>;

export const CapturedNormesExtractionReceiptSchema = z.object({
  contract: z.literal("captured-normes-extraction-receipt/v1"),
  generated_at: z.string().datetime(),
  capture: CapturedNormesReferenceSchema,
  engine: z.literal("mistral-schema"),
  methode: z.literal("ocr/mistral-schema"),
  pages: z.array(z.number().int().positive()),
  budget_usd: z.number().finite().positive(),
  status: z.enum(["deposited", "refused"]),
  parquet_key: z.string().min(1).nullable(),
  refusal: z.string().min(1).nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.status === "deposited" && value.parquet_key === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["parquet_key"], message: "parquet_key required for deposited receipt" });
  }
  if (value.status === "deposited" && value.pages.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pages"], message: "pages required for deposited receipt" });
  }
  if (value.status === "deposited" && value.refusal !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["refusal"], message: "refusal must be null for deposited receipt" });
  }
  if (value.status === "refused" && value.parquet_key !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["parquet_key"], message: "parquet_key must be null for refused receipt" });
  }
  if (value.status === "refused" && value.refusal === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["refusal"], message: "refusal required for refused receipt" });
  }
  if (value.capture.selection_key === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["capture", "selection_key"], message: "PDF extraction requires an immutable discovery selection" });
  }
});
export type CapturedNormesExtractionReceipt = z.infer<typeof CapturedNormesExtractionReceiptSchema>;

/**
 * Durable evidence that the authoritative MAMH directory names a municipality
 * but declares no municipal website. This is intentionally not a discovery
 * receipt: no URL is available to capture without inventing one.
 */
export const CapturedNormesSourceAbsenceReceiptSchema = z.object({
  contract: z.literal("captured-normes-source-absence-receipt/v1"),
  slug: z.string().regex(SLUG_RE),
  status: z.literal("no-official-source"),
  directory_sha256: z.string().regex(SHA_RE),
  directory: z.object({
    schema: z.literal("qc-municipal-directory/v1"),
    generated_at: z.string().datetime(),
    source: z.object({
      name: z.literal("MAMH — Répertoire des municipalités du Québec"),
      dataset: z.literal("repertoire-des-municipalites-du-quebec"),
      dataset_url: z.string().url(),
      resource_url: z.string().url(),
      license: z.literal("cc-by-4.0"),
      field: z.literal("mweb"),
      join_key: z.literal("nfd-normalized-name"),
    }).strict(),
  }).strict(),
  entry: z.object({
    slug: z.string().regex(SLUG_RE),
    name: z.string().min(1),
    mamh_code: z.string().min(1),
    mamh_name: z.string().min(1),
    designation: z.string().min(1),
    website: z.null(),
    source: z.literal("mamh-repertoire"),
    verified_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).strict(),
}).strict().superRefine((value, ctx) => {
  if (value.entry.slug !== value.slug) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["entry", "slug"], message: "absence receipt entry slug must match receipt slug" });
  }
});
export type CapturedNormesSourceAbsenceReceipt = z.infer<typeof CapturedNormesSourceAbsenceReceiptSchema>;

/** Explicit outcome for one city in a bounded captured-normes campaign. */
export const CapturedNormesCampaignOutcomeSchema = z.enum([
  "no-grid",
  "unreachable",
  "http-forbidden",
  "no-official-source",
  "mistral-below-gate",
  "mistral-refused",
  "mistral-deposited",
]);

export const CapturedNormesCampaignEntrySchema = z.object({
  slug: z.string().regex(SLUG_RE),
  outcome: CapturedNormesCampaignOutcomeSchema,
  discovery_run_receipt_key: z.string().regex(/^registry\/normes-captured-discovery-run-receipts\/(?:v\d+\/)?[^/]+\/[^/]+\.json$/).optional(),
  source_absence_receipt_key: z.string().regex(/^registry\/normes-captured-source-absence-receipts\/[a-z0-9][a-z0-9-]*\/[a-f0-9]{64}\.json$/).optional(),
  extraction_receipt_keys: z.array(z.string().regex(/^registry\/normes-captured-receipts\/[a-f0-9]+\.json$/)).max(8),
}).strict().superRefine((value, ctx) => {
  if (value.outcome === "no-official-source") {
    if (value.discovery_run_receipt_key !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["discovery_run_receipt_key"], message: "no-official-source cannot claim a discovery run" });
    }
    if (value.source_absence_receipt_key === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["source_absence_receipt_key"], message: "no-official-source requires an immutable source absence receipt" });
    }
    if (value.extraction_receipt_keys.length !== 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["extraction_receipt_keys"], message: "no-official-source cannot carry OCR receipts" });
    }
    return;
  }
  if (value.discovery_run_receipt_key === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["discovery_run_receipt_key"], message: "captured discovery outcomes require a discovery run receipt" });
  }
  if (value.source_absence_receipt_key !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["source_absence_receipt_key"], message: "only no-official-source may carry a source absence receipt" });
  }
  const mistralOutcome = value.outcome === "mistral-below-gate" || value.outcome === "mistral-refused" || value.outcome === "mistral-deposited";
  if (mistralOutcome && value.extraction_receipt_keys.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${value.outcome} requires extraction receipts` });
  }
  if (!mistralOutcome && value.extraction_receipt_keys.length > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "only Mistral outcomes may carry extraction receipts" });
  }
});
export type CapturedNormesCampaignEntry = z.infer<typeof CapturedNormesCampaignEntrySchema>;

/** Parsed immutable evidence consumed by the campaign closer for one OCR pass. */
export interface CapturedNormesCampaignExtractionEvidence {
  readonly receipt: CapturedNormesExtractionReceipt;
  readonly selection: unknown;
}

/**
 * Validates a city closure entirely from immutable receipts. A successful OCR
 * result is an explicit campaign outcome, not an omission. The selection is
 * re-parsed and joined back to the discovery run so an arbitrary parquet or
 * another city's PDF cannot be smuggled into the closed partition.
 */
export function assertCapturedNormesCampaignEvidence(
  entryValue: CapturedNormesCampaignEntry | unknown,
  discoveryValue: CapturedNormesDiscoveryRunReceipt | unknown | null,
  evidence: readonly CapturedNormesCampaignExtractionEvidence[],
  sourceAbsenceValue: CapturedNormesSourceAbsenceReceipt | unknown | null = null,
): void {
  const entry = CapturedNormesCampaignEntrySchema.parse(entryValue);
  if (entry.outcome === "no-official-source") {
    if (discoveryValue !== null || evidence.length !== 0) {
      throw new Error(`${entry.slug}: no-official-source cannot consume discovery or OCR evidence`);
    }
    const absence = CapturedNormesSourceAbsenceReceiptSchema.parse(sourceAbsenceValue);
    if (absence.slug !== entry.slug || absence.status !== "no-official-source" || absence.entry.website !== null) {
      throw new Error(`${entry.slug}: source absence receipt does not prove its declared absence`);
    }
    return;
  }
  const discovery = CapturedNormesDiscoveryRunReceiptSchema.parse(discoveryValue);
  if (discovery.slug !== entry.slug) throw new Error(`${entry.slug}: discovery receipt slug mismatch`);
  if (entry.extraction_receipt_keys.length !== evidence.length) {
    throw new Error(`${entry.slug}: extraction evidence count mismatch`);
  }

  if (entry.outcome === "no-grid") {
    if (discovery.status !== "refused" || discovery.refusal !== "no classified grille PDF candidate in eligible captured HTML") {
      throw new Error(`${entry.slug}: no-grid requires an eligible HTML no-grid refusal`);
    }
    return;
  }
  if (entry.outcome === "unreachable") {
    if (discovery.status !== "refused" || discovery.attempts.some((attempt) => attempt.http_status === 200)) {
      throw new Error(`${entry.slug}: unreachable receipt contains an HTTP 200 attempt`);
    }
    return;
  }
  if (entry.outcome === "http-forbidden") {
    if (discovery.status !== "refused" || !discovery.attempts.some((attempt) => attempt.http_status === 403)) {
      throw new Error(`${entry.slug}: http-forbidden requires an HTTP 403 attempt`);
    }
    return;
  }

  for (const item of evidence) {
    const receipt = CapturedNormesExtractionReceiptSchema.parse(item.receipt);
    if (receipt.capture.slug !== entry.slug || receipt.capture.selection_key === null) {
      throw new Error(`${entry.slug}: extraction receipt does not name its city and selection`);
    }
    const selection = CapturedNormesPdfCaptureSelectionSchema.parse(item.selection);
    if (
      selection.source_capture.slug !== entry.slug ||
      selection.source_capture.run_id !== discovery.run_id ||
      selection.source_capture.manifest_key !== discovery.manifest_key ||
      !selectionIncludesPdfCaptureUrl(selection, entry.slug, receipt.capture.url)
    ) {
      throw new Error(`${entry.slug}: extraction selection is not derived from this discovery run`);
    }
    const directSubpage = selection.contract === "captured-normes-subpage-selection/v1";
    const discoverySupportsSelection = discovery.status === "candidates" || (
      directSubpage &&
      discovery.status === "refused" &&
      discovery.refusal === "no classified grille PDF candidate in eligible captured HTML"
    );
    if (!discoverySupportsSelection) {
      throw new Error(`${entry.slug}: discovery receipt does not support the extraction selection`);
    }
    if (entry.outcome === "mistral-deposited") {
      if (receipt.status !== "deposited" || receipt.parquet_key === null) {
        throw new Error(`${entry.slug}: mistral-deposited requires deposited parquet receipts`);
      }
    } else if (entry.outcome === "mistral-below-gate" && (
      receipt.status !== "refused" || !receipt.refusal?.startsWith("below deposit gate:")
    )) {
      throw new Error(`${entry.slug}: mistral-below-gate requires below-gate refusals`);
    } else if (entry.outcome === "mistral-refused" && (receipt.status !== "refused" || receipt.refusal === null)) {
      throw new Error(`${entry.slug}: mistral-refused requires an explicit refusal receipt`);
    }
  }
}

/** Committed input control: one closed, finite city partition. */
export const CapturedNormesCampaignPlanSchema = z.object({
  campaign: z.string().regex(/^normes-col\d+-\d{8}$/),
  closed_at: z.string().datetime(),
  cities: z.array(CapturedNormesCampaignEntrySchema).length(10),
}).strict().superRefine((value, ctx) => {
  const seen = new Set<string>();
  for (const [index, city] of value.cities.entries()) {
    if (seen.has(city.slug)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cities", index, "slug"], message: "city slug must be unique" });
    }
    seen.add(city.slug);
  }
});
export type CapturedNormesCampaignPlan = z.infer<typeof CapturedNormesCampaignPlanSchema>;

/** Immutable S3 closure receipt. A closed partition never means city complete. */
export const CapturedNormesCampaignReceiptSchema = z.object({
  contract: z.literal("captured-normes-campaign-receipt/v1"),
  campaign: z.string().regex(/^normes-col\d+-\d{8}$/),
  closed_at: z.string().datetime(),
  status: z.literal("closed"),
  cities: z.array(CapturedNormesCampaignEntrySchema).length(10),
}).strict();
export type CapturedNormesCampaignReceipt = z.infer<typeof CapturedNormesCampaignReceiptSchema>;

/**
 * Validates that a reference names one successful cluster NORMES capture line.
 * Byte and sidecar verification remain I/O concerns for the materializer.
 */
export function assertCapturedNormesReference(
  value: unknown,
  headerValue: CaptureRunHeader | unknown,
  lineValue: CaptureManifestLine | unknown,
): CapturedNormesReference {
  const reference = CapturedNormesReferenceSchema.parse(value);
  const header = CaptureRunHeaderSchema.parse(headerValue);
  const line = CaptureManifestLineSchema.parse(lineValue);
  const keys = captureRunKeys(reference.run_id);

  if (header.run_id !== reference.run_id) throw new Error("capture run_id mismatch");
  if (reference.manifest_key !== keys.manifest) throw new Error("capture manifest_key mismatch");
  if (header.execution !== "cluster") throw new Error("capture execution must be cluster");
  if (header.lane !== "normes" || line.lane !== "normes") throw new Error("capture lane must be normes");
  if (header.finished_at === null || header.exit_code !== 0) throw new Error("capture run is not successful and terminal");
  if (!line.slugs.includes(reference.slug)) throw new Error("capture line does not include slug");
  if (line.method !== "GET" || line.http_status === null || line.http_status < 200 || line.http_status >= 300) {
    throw new Error("capture line is not a successful GET");
  }
  if (line.redacted) throw new Error("capture line is redacted");
  if (
    line.url !== reference.url
    || line.final_url !== reference.final_url
    || line.retrieved_at !== reference.retrieved_at
    || line.sha256 !== reference.sha256
    || line.storage_key !== reference.storage_key
  ) {
    throw new Error("capture reference does not match manifest line");
  }
  return reference;
}

/**
 * Derives only verbatim PDF links from a previously captured HTML document.
 * It performs no network operation; a later cluster capture must confirm each URL.
 */
export function selectNormesPdfCandidates(
  html: string,
  sourceCapture: CapturedNormesReference,
): CapturedNormesPdfSelection {
  const { candidates } = discoverGrillesInHtml(html, sourceCapture.final_url, sourceCapture.slug);
  return CapturedNormesPdfSelectionSchema.parse({
    contract: "captured-normes-pdf-selection/v1",
    // The source capture timestamp is stable, so re-running the selection for
    // the same CAS receipt produces byte-identical immutable S3 control data.
    generated_at: sourceCapture.retrieved_at,
    source_capture: sourceCapture,
    candidates: candidates.map((candidate: GrilleCandidate) => ({
      slug: candidate.slug,
      pdf_url: candidate.pdfUrl,
      titre: candidate.titre,
      score_classif: candidate.scoreClassif,
      matched: [...candidate.matched],
    })),
  });
}

/**
 * Emits at most five same-site urbanisme/règlement HTML hops already named by
 * captured markup. They are candidates only: a later cluster capture decides
 * whether each is readable and whether it actually exposes a classified PDF.
 */
export function selectNormesSubpages(
  html: string,
  sourceCapture: CapturedNormesReference,
): CapturedNormesSubpageSelection {
  return CapturedNormesSubpageSelectionSchema.parse({
    contract: "captured-normes-subpage-selection/v1",
    generated_at: sourceCapture.retrieved_at,
    source_capture: sourceCapture,
    subpages: extractInternalSubpages(html, sourceCapture.final_url),
  });
}

/**
 * Confirms that one exact PDF capture URL was justified by its immutable
 * selection. A subpage selection is intentionally accepted only for its own
 * city and only when it carries that exact verbatim URL; the later CAS gate
 * still proves that the response is an actual PDF.
 */
export function selectionIncludesPdfCaptureUrl(selectionValue: unknown, slug: string, url: string): boolean {
  const selection = CapturedNormesPdfCaptureSelectionSchema.parse(selectionValue);
  if (selection.source_capture.slug !== slug) return false;
  if (selection.contract === "captured-normes-pdf-selection/v1") {
    return selection.candidates.some((candidate) => candidate.slug === slug && candidate.pdf_url === url);
  }
  return selection.subpages.some((subpage) => subpage.url === url);
}
