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
