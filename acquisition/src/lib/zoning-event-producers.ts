/**
 * Model A — geo as a PURE PRODUCER of the artefacts the zoning-event
 * remediation runner (#258) ingests to LINK / RETRACT living phantoms.
 *
 * SoT = the runner's exported Zod schemas
 * (`zoning-event-remediation-runner.ts`). These 5 functions are PURE: typed
 * inputs → plain objects that satisfy the EXACT exported schemas and every
 * cross-artefact bind imposed by `evidenceForCity`
 * (SPEC_EVOL_MODEL_A_ZONING_EVENT_PRODUCER.md §2). They NEVER fetch, NEVER touch
 * S3, NEVER call capturedFetch, and NEVER reach the served boundary
 * (`serveZoningEvents` / `executeZoningEventRemediation` stay out of this lot).
 *
 * The durable references a receipt carries — capture run/manifest keys, the CAS
 * PDF/text keys and their `sha256:` digests — are INPUTS produced upstream by
 * the owner-gated capture lot (L3). A producer CAPITALISES that proof into the
 * exact contractual shape; it does NOT invent a digest or a span. Where the
 * runner requires a canonical key (`capture/_runs/<run_id>/run.json` and
 * `.../manifest.jsonl`), the producer DERIVES it from `run_id`, so that bind
 * holds by construction rather than by caller discipline.
 */
import type { z } from "zod";

import {
  type ExhaustionReceiptSchema,
  type PvLinkReceiptSchema,
  type PvTextExtractionReceiptSchema,
  type SourceNoMatchReceiptSchema,
  type ZoningEventRemediationInventory,
  ZONING_EVENT_REMEDIATION_INVENTORY_CONTRACT,
} from "./zoning-event-remediation-runner.js";
import {
  ZONING_EVENT_EXHAUSTION_CONTRACT,
  ZONING_EVENT_EXHAUSTION_RECEIPT_CONTRACT,
  ZONING_EVENT_PV_LINK_RECEIPT_CONTRACT,
  ZONING_EVENT_PV_TEXT_EXTRACTION_RECEIPT_CONTRACT,
  ZONING_EVENT_SOURCE_NO_MATCH_RECEIPT_CONTRACT,
  type DurableEvidenceObjectRef,
  type Sha256Ref,
} from "./zoning-event-remediation.js";

export type ZoningEventPvLinkReceipt = z.infer<typeof PvLinkReceiptSchema>;
export type ZoningEventPvTextExtractionReceipt = z.infer<typeof PvTextExtractionReceiptSchema>;
export type ZoningEventExhaustionReceipt = z.infer<typeof ExhaustionReceiptSchema>;
export type ZoningEventSourceNoMatchReceipt = z.infer<typeof SourceNoMatchReceiptSchema>;
export type ZoningEventProducedInventory = ZoningEventRemediationInventory;

/**
 * Canonical capture-run keys the runner cross-checks against `run.run_id`
 * (`evidenceForCity`, runner:287/402). `run_id` must not smuggle a path
 * separator or a `.`/`..` segment through — that would break the durable
 * ObjectKey the runner also validates.
 */
function assertRunId(runId: string, label: string): void {
  if (runId.length === 0 || runId.includes("/") || runId.split(/[/.]/).includes("..") || runId.includes("..")) {
    throw new Error(`${label}: run_id invalide pour une clé de capture canonique (${JSON.stringify(runId)})`);
  }
}

function captureRunRef(runId: string, sha256: Sha256Ref): DurableEvidenceObjectRef {
  return { key: `capture/_runs/${runId}/run.json`, sha256 };
}

function captureManifestRef(runId: string, sha256: Sha256Ref): DurableEvidenceObjectRef {
  return { key: `capture/_runs/${runId}/manifest.jsonl`, sha256 };
}

// ─────────────────────────────────────────────────────────────────────────────
// A1 — zoning-event-pv-link-receipt/v1
// ─────────────────────────────────────────────────────────────────────────────

export interface ProduceZoningEventPvLinkReceiptInput {
  /** Durable object key; MUST equal the inventory link `evidence_ref.key` (runner:273). */
  receipt_key: string;
  event_id: string;
  /** Current `bylaw_numero` of the living event (runner mapping bind, remediation:374). */
  target_bylaw_numero: string;
  /** Explicit new-règlement number the generic PV detector must confirm. */
  detector_reglement_numero: string;
  source_url: string;
  /** Verbatim span; occurs byte-for-byte in the captured PV text and carries the number. */
  source_span: string;
  as_of_date: string;
  producer: string;
  /** Canonical capture run id; the run/manifest keys are derived from it. */
  run_id: string;
  capture_run_sha256: Sha256Ref;
  capture_manifest_sha256: Sha256Ref;
  captured_pdf_ref: DurableEvidenceObjectRef;
  pv_text_ref: DurableEvidenceObjectRef;
  text_extraction_receipt_ref: DurableEvidenceObjectRef;
}

/**
 * A1 — the LINK receipt. Emits the exact `PvLinkReceiptSchema` shape and binds
 * the canonical run/manifest keys to `run_id`. Fails early on the one span bind
 * derivable from the inputs alone (`source_span ⊇ detector_reglement_numero`,
 * remediation:221); the pv_text ⊇ span and detector-confirmation binds require
 * the captured bytes and are enforced by the runner during ingestion.
 */
export function produceZoningEventPvLinkReceipt(
  input: ProduceZoningEventPvLinkReceiptInput,
): ZoningEventPvLinkReceipt {
  assertRunId(input.run_id, "A1 pv-link-receipt");
  if (!input.source_span.includes(input.detector_reglement_numero)) {
    throw new Error(
      "A1 pv-link-receipt: source_span ne prouve pas detector_reglement_numero (bind runner remediation:221)",
    );
  }
  return {
    contract: ZONING_EVENT_PV_LINK_RECEIPT_CONTRACT,
    status: "source-found",
    receipt_key: input.receipt_key,
    event_id: input.event_id,
    target_bylaw_numero: input.target_bylaw_numero,
    detector_reglement_numero: input.detector_reglement_numero,
    source_url: input.source_url,
    source_span: input.source_span,
    as_of_date: input.as_of_date,
    producer: input.producer,
    capture_run_ref: captureRunRef(input.run_id, input.capture_run_sha256),
    capture_manifest_ref: captureManifestRef(input.run_id, input.capture_manifest_sha256),
    captured_pdf_ref: input.captured_pdf_ref,
    pv_text_ref: input.pv_text_ref,
    text_extraction_receipt_ref: input.text_extraction_receipt_ref,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// A2 — zoning-event-pv-text-extraction-receipt/v1
// ─────────────────────────────────────────────────────────────────────────────

export interface ProduceZoningEventPvTextExtractionReceiptInput {
  /** MUST equal the A1 `text_extraction_receipt_ref.key` (runner:335). */
  receipt_key: string;
  /** MUST equal the capture run id and the A1 receipt's run (runner:336). */
  run_id: string;
  /** MUST equal the A1 receipt `source_url` (runner:337). */
  source_url: string;
  /** MUST deep-equal the A1 `captured_pdf_ref` (runner:338). */
  captured_pdf_ref: DurableEvidenceObjectRef;
  /** MUST deep-equal the A1 `pv_text_ref` (runner:339). */
  pv_text_ref: DurableEvidenceObjectRef;
  extraction_tool: string;
  /** ISO-8601 datetime. */
  extracted_at: string;
}

/** A2 — the PDF→text extraction receipt the A1 LINK receipt points at. */
export function produceZoningEventPvTextExtractionReceipt(
  input: ProduceZoningEventPvTextExtractionReceiptInput,
): ZoningEventPvTextExtractionReceipt {
  return {
    contract: ZONING_EVENT_PV_TEXT_EXTRACTION_RECEIPT_CONTRACT,
    status: "extracted",
    receipt_key: input.receipt_key,
    run_id: input.run_id,
    source_url: input.source_url,
    captured_pdf_ref: input.captured_pdf_ref,
    pv_text_ref: input.pv_text_ref,
    extraction_tool: input.extraction_tool,
    extracted_at: input.extracted_at,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// A3 — zoning-event-source-no-match-receipt/v1
// ─────────────────────────────────────────────────────────────────────────────

export interface ProduceZoningEventSourceNoMatchReceiptInput {
  /** MUST equal the A4 `evidence[].extraction_receipt_ref.key` (runner:493). */
  receipt_key: string;
  event_id: string;
  /** MUST equal the capture run id (runner:495). */
  run_id: string;
  /** HTTP(S) URL; MUST equal the A4 `checked_sources[].source_ref` (runner:496). */
  source_ref: string;
  /** MUST equal the manifest line `storage_key`/`sha256` for that source (runner:498-499). */
  captured_object_ref: DurableEvidenceObjectRef;
  detector: string;
  /** 40-hex; MUST equal the capture-run header `git_sha` (runner:497). */
  detector_git_sha: string;
  /** ISO-8601 datetime. */
  extracted_at: string;
}

/**
 * A3 — the per-source "extracted, complete, zero matches" receipt that, together
 * with the closed manifest partition, evidences exhaustion. `complete:true` and
 * an empty `matches` set are literals of the contract, never optional.
 */
export function produceZoningEventSourceNoMatchReceipt(
  input: ProduceZoningEventSourceNoMatchReceiptInput,
): ZoningEventSourceNoMatchReceipt {
  return {
    contract: ZONING_EVENT_SOURCE_NO_MATCH_RECEIPT_CONTRACT,
    status: "complete-no-match",
    receipt_key: input.receipt_key,
    event_id: input.event_id,
    run_id: input.run_id,
    source_ref: input.source_ref,
    captured_object_ref: input.captured_object_ref,
    detector: input.detector,
    detector_git_sha: input.detector_git_sha,
    complete: true,
    matches: [],
    extracted_at: input.extracted_at,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// A4 — zoning-event-extraction-exhaustion-receipt/v1
// ─────────────────────────────────────────────────────────────────────────────

export interface ProduceZoningEventExhaustionReceiptEvidence {
  /** Index into the run manifest of a successful PV capture for this source. */
  manifest_line_index: number;
  /** Points at the A3 no-match receipt covering that captured line. */
  extraction_receipt_ref: DurableEvidenceObjectRef;
}

export interface ProduceZoningEventExhaustionReceiptCheckedSource {
  /** HTTP(S) URL of the checked gisement. */
  source_ref: string;
  /** ≥1 covered manifest line, one per successful capture of this source. */
  evidence: ProduceZoningEventExhaustionReceiptEvidence[];
}

export interface ProduceZoningEventExhaustionReceiptInput {
  /** MUST equal the inventory retract `run_refs[].key` (runner:377). */
  receipt_key: string;
  event_id: string;
  /** Canonical capture run id; the run/manifest keys are derived from it. */
  run_id: string;
  capture_run_sha256: Sha256Ref;
  capture_manifest_sha256: Sha256Ref;
  /** ≥1 checked source, each with ≥1 covered manifest line. */
  checked_sources: ProduceZoningEventExhaustionReceiptCheckedSource[];
  /** MUST equal the inventory exhaustion `as_of` (runner:379). */
  as_of: string;
}

/**
 * A4 — the extraction-exhaustion receipt. Emits `outcome:"no-source"` and
 * `kind:"extracted-no-match"` as contract literals and binds the canonical
 * run/manifest keys to `run_id`. Every checked source must carry at least one
 * evidence line — an empty partition can never evidence exhaustion.
 */
export function produceZoningEventExhaustionReceipt(
  input: ProduceZoningEventExhaustionReceiptInput,
): ZoningEventExhaustionReceipt {
  assertRunId(input.run_id, "A4 exhaustion-receipt");
  if (input.checked_sources.length === 0) {
    throw new Error("A4 exhaustion-receipt: au moins une source vérifiée requise (runner:130)");
  }
  for (const source of input.checked_sources) {
    if (source.evidence.length === 0) {
      throw new Error(
        `A4 exhaustion-receipt: source ${source.source_ref} sans ligne de preuve (runner:129)`,
      );
    }
  }
  return {
    contract: ZONING_EVENT_EXHAUSTION_RECEIPT_CONTRACT,
    status: "exhausted",
    receipt_key: input.receipt_key,
    event_id: input.event_id,
    capture_run_ref: captureRunRef(input.run_id, input.capture_run_sha256),
    capture_manifest_ref: captureManifestRef(input.run_id, input.capture_manifest_sha256),
    checked_sources: input.checked_sources.map((source) => ({
      source_ref: source.source_ref,
      outcome: "no-source" as const,
      evidence: source.evidence.map((entry) => ({
        kind: "extracted-no-match" as const,
        manifest_line_index: entry.manifest_line_index,
        extraction_receipt_ref: entry.extraction_receipt_ref,
      })),
    })),
    as_of: input.as_of,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// A0 — zoning-event-remediation-inventory/v1 (top-level artefact)
// ─────────────────────────────────────────────────────────────────────────────

export interface ProduceInventoryLinkEvent {
  event_id: string;
  kind: "link";
  /** Points at the A1 LINK receipt (runner cross-checks key + event_id). */
  evidence_ref: DurableEvidenceObjectRef;
}

export interface ProduceInventoryRetractEvent {
  event_id: string;
  kind: "retract";
  exhaustion: {
    /** Points at the A4 exhaustion receipt(s). */
    run_refs: DurableEvidenceObjectRef[];
    /** Claimed set; MUST equal the union of the A4 receipts' checked sources (runner:516). */
    checked_sources: { source_ref: string; outcome: "no-source" }[];
    as_of: string;
  };
}

export type ProduceInventoryEvent = ProduceInventoryLinkEvent | ProduceInventoryRetractEvent;

export interface ProduceInventoryCity {
  /** Plain served slug; the runner's InventorySchema rejects double-dash MRC forms. */
  slug: string;
  /** MUST equal the audited served collection sha256 (runner:577). */
  collection_sha256: Sha256Ref;
  events: ProduceInventoryEvent[];
}

export interface ProduceZoningEventRemediationInventoryInput {
  cohort_sha256: Sha256Ref;
  audit_sha256: Sha256Ref;
  /** `origin`/`via` are fixed contract literals and are set by the producer. */
  authenticated: { extraction_ref: string; h2a_envelope_id: string };
  cities: ProduceInventoryCity[];
}

/**
 * A0 — the top-level remediation inventory. Without it the runner performs no
 * LINK/RETRACT (SPEC §2). The producer fixes the `authenticated.origin` /
 * `authenticated.via` literals and rejects duplicate slugs / duplicate event_ids
 * (the same invariants `parseZoningEventRemediationInventory` re-checks) so a
 * malformed set fails at production, not only at ingestion.
 */
export function produceZoningEventRemediationInventory(
  input: ProduceZoningEventRemediationInventoryInput,
): ZoningEventProducedInventory {
  const slugs = input.cities.map((city) => city.slug);
  if (new Set(slugs).size !== slugs.length) {
    throw new Error("A0 inventory: slug de ville dupliqué");
  }
  return {
    contract: ZONING_EVENT_REMEDIATION_INVENTORY_CONTRACT,
    cohort_sha256: input.cohort_sha256,
    audit_sha256: input.audit_sha256,
    authenticated: {
      origin: "immo-extraction",
      extraction_ref: input.authenticated.extraction_ref,
      via: "geo-cond",
      h2a_envelope_id: input.authenticated.h2a_envelope_id,
    },
    cities: input.cities.map((city) => {
      const ids = city.events.map((event) => event.event_id);
      if (new Set(ids).size !== ids.length) {
        throw new Error(`A0 inventory ${city.slug}: event_id dupliqué`);
      }
      return {
        slug: city.slug,
        collection_sha256: city.collection_sha256,
        events: city.events.map((event) =>
          event.kind === "link"
            ? {
                event_id: event.event_id,
                resolution: { kind: "link" as const, evidence_ref: event.evidence_ref },
              }
            : {
                event_id: event.event_id,
                resolution: {
                  kind: "retract" as const,
                  exhaustion: {
                    contract: ZONING_EVENT_EXHAUSTION_CONTRACT,
                    status: "exhausted" as const,
                    run_refs: event.exhaustion.run_refs,
                    checked_sources: event.exhaustion.checked_sources.map((source) => ({
                      source_ref: source.source_ref,
                      outcome: "no-source" as const,
                    })),
                    as_of: event.exhaustion.as_of,
                  },
                },
              },
        ),
      };
    }),
  };
}
