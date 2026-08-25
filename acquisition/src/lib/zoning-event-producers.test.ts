import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  zoningEventsKeys,
  type ZoningEvent,
  type ZoningEventsDocument,
} from "../zoning-events-emit.js";
import {
  type ZoningEventSourceAuditReport,
  ZONING_EVENT_AUDIT_CONTRACT,
} from "./zoning-event-source-audit-runner.js";
import {
  buildZoningEventRemediationDryRun,
  parseZoningEventRemediationInventory,
  ExhaustionReceiptSchema,
  InventorySchema,
  PvLinkReceiptSchema,
  PvTextExtractionReceiptSchema,
  SourceNoMatchReceiptSchema,
} from "./zoning-event-remediation-runner.js";
import type { Sha256Ref } from "./zoning-event-remediation.js";
import {
  produceZoningEventExhaustionReceipt,
  produceZoningEventPvLinkReceipt,
  produceZoningEventPvTextExtractionReceipt,
  produceZoningEventRemediationInventory,
  produceZoningEventSourceNoMatchReceipt,
} from "./zoning-event-producers.js";

// ─── Synthetic city fixtures (INLINE only, zero work/coverage reads) ──────────

function sha(value: string | Buffer): Sha256Ref {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

/** Two living phantoms (no source anywhere): one will LINK, one will RETRACT. */
function event(id: string): ZoningEvent {
  return {
    event_id: id,
    version: 1,
    supersedes: null,
    state: "active",
    muni: "ville-test",
    bylaw_numero: id === "link" ? "026-101" : "026-102",
    type: "projet-reglement",
    date_iso: "2026-04-14",
    detection_state: "detected",
    zone_codes_resolus: [],
    zone_codes_non_resolus: [],
    nb_unites_max: null,
    effet_densifiant_ref: null,
    url_pdf: "",
    extrait_brut: "",
    confidence: 0.9,
    provenance: { producer: "geo", source_span: "", source_url: "", as_of_date: "2026-06-10" },
  };
}

function document(): ZoningEventsDocument {
  const events = [event("link"), event("retract")];
  return {
    type: "FeatureCollection",
    as_of: "2026-08-23T00:00:00Z",
    complete: true,
    muni: "ville-test",
    events,
    features: events.map((entry) => ({ type: "Feature", geometry: null, properties: entry })),
  };
}

function audit(collectionSha: Sha256Ref, cohortSha: Sha256Ref): ZoningEventSourceAuditReport {
  return {
    contract: ZONING_EVENT_AUDIT_CONTRACT,
    cohort: { source: "cohort.tsv", sha256: cohortSha, expected_count: 1, slugs: ["ville-test"] },
    selected_layout: "nested",
    source_fields: ["url_pdf", "provenance.source_url"],
    totals: {
      cities_total: 1, cities_audited: 1, cities_unknown: 0,
      events_total: 2, living_events: 2, retracted_events: 0,
      has_source: 0, invalid_source: 0, no_source: 2,
      living_phantoms: 2, living_invalid_source: 0, living_no_source: 2,
    },
    cities: [{
      slug: "ville-test",
      collection_key: zoningEventsKeys("ville-test")[1]!,
      collection_sha256: collectionSha,
      audit_state: "audited",
      document_as_of: "2026-08-23T00:00:00Z",
      complete: true,
      read_error: null,
      counts: {
        events_total: 2, living_events: 2, retracted_events: 0,
        has_source: 0, invalid_source: 0, no_source: 2,
        living_phantoms: 2, living_invalid_source: 0, living_no_source: 2,
      },
      events: [],
    }],
  };
}

// ─── Synthetic CAPTURE bytes (what L3 would deposit; here in-memory only) ─────
// The producers never build these; they only carry the durable refs to them.

const RUN_ID = "unit";
const CAPTURE_RUN_KEY = `capture/_runs/${RUN_ID}/run.json`;
const CAPTURE_MANIFEST_KEY = `capture/_runs/${RUN_ID}/manifest.jsonl`;
const PDF_URL = "https://example.test/pv.pdf";
const INDEX_URL = "https://example.test/pv-index";
// Proven span/text: detectGenericPvZonageChange fires changementZonage + 2026-101.
const SPAN = "Règlement numéro 2026-101 modifiant le Règlement de zonage numéro 2019-342";
const DETECTOR_REGLEMENT = "2026-101";
const GIT_SHA = "a".repeat(40);

function captureRunBytes(pdfLen: number, indexLen: number): Buffer {
  return Buffer.from(JSON.stringify({
    run_id: RUN_ID,
    lane: "pv",
    execution: "cluster",
    git_sha: GIT_SHA,
    worklist: "capture/worklists/unit.json",
    started_at: "2026-06-10T00:00:00.000Z",
    finished_at: "2026-06-10T00:01:00.000Z",
    exit_code: 0,
    user_agent: "geo-test/1",
    egress: "direct",
    via_obscura: false,
    counts: { attempts: 2, ok: 2, failed: 0, dedup: 0, bytes: pdfLen + indexLen },
  }));
}

function captureManifestBytes(
  pdfRef: { key: string; sha256: Sha256Ref },
  indexRef: { key: string; sha256: Sha256Ref },
  pdfLen: number,
  indexLen: number,
): Buffer {
  return Buffer.from(`${JSON.stringify({
    run_id: RUN_ID, lane: "pv", source: "proces-verbaux-test", slugs: ["ville-test"],
    url: PDF_URL, method: "GET", attempt: 1,
    requested_at: "2026-06-10T00:00:00.000Z", retrieved_at: "2026-06-10T00:00:01.000Z",
    http_status: 200, redirect_chain: [], final_url: PDF_URL,
    content_type: "application/pdf", bytes: pdfLen,
    sha256: pdfRef.sha256, storage_key: pdfRef.key,
    dedup: false, error: null, user_agent: "geo-test/1", via_obscura: false,
    egress: "direct", robots: "allowed", redacted: false,
  })}\n${JSON.stringify({
    run_id: RUN_ID, lane: "pv", source: "proces-verbaux-test", slugs: ["ville-test"],
    url: INDEX_URL, method: "GET", attempt: 1,
    requested_at: "2026-06-10T00:00:02.000Z", retrieved_at: "2026-06-10T00:00:03.000Z",
    http_status: 200, redirect_chain: [], final_url: INDEX_URL,
    content_type: "text/html", bytes: indexLen,
    sha256: indexRef.sha256, storage_key: indexRef.key,
    dedup: false, error: null, user_agent: "geo-test/1", via_obscura: false,
    egress: "direct", robots: "allowed", redacted: false,
  })}\n`);
}

describe("zoning-event producers (Model A A0-A4)", () => {
  it("a produced coherent set (1 LINK + 1 RETRACT) parses the exported schemas AND drives the real runner to executable", async () => {
    // Served collection + audit (inputs, not producer outputs).
    const collectionSha = sha(Buffer.from(JSON.stringify(document())));
    const cohortSha = sha("ville-test\n");
    const auditValue = audit(collectionSha, cohortSha);
    const auditSha = sha(`${JSON.stringify(auditValue, null, 2)}\n`);

    // Capture bytes + their durable CAS/run refs (L3 inputs, synthesized inline).
    const pv = Buffer.from(`Avis de motion\n\nDonne avis de motion pour le ${SPAN}.`);
    const pdf = Buffer.from("%PDF-1.7 synthetic in-memory unit fixture");
    const indexBytes = Buffer.from("<html><body>PV index without target source</body></html>");
    const pdfSha = sha(pdf);
    const indexSha = sha(indexBytes);
    const pvTextRef = { key: `capture/_runs/${RUN_ID}/pv.txt`, sha256: sha(pv) };
    const pdfRef = { key: `raw/pv-unit/cas/${pdfSha.slice("sha256:".length)}.pdf`, sha256: pdfSha };
    const indexRef = { key: `raw/pv-unit/cas/${indexSha.slice("sha256:".length)}.html`, sha256: indexSha };
    const captureRun = captureRunBytes(pdf.length, indexBytes.length);
    const captureManifest = captureManifestBytes(pdfRef, indexRef, pdf.length, indexBytes.length);
    const captureRunSha = sha(captureRun);
    const captureManifestSha = sha(captureManifest);

    // A2 — PDF→text extraction receipt.
    const textExtractionReceiptKey = `capture/_runs/${RUN_ID}/pv-text-extraction-link.json`;
    const textExtractionReceipt = produceZoningEventPvTextExtractionReceipt({
      receipt_key: textExtractionReceiptKey,
      run_id: RUN_ID,
      source_url: PDF_URL,
      captured_pdf_ref: pdfRef,
      pv_text_ref: pvTextRef,
      extraction_tool: "pdftotext/unit-test",
      extracted_at: "2026-06-10T00:00:02.000Z",
    });
    const textExtractionReceiptBytes = Buffer.from(JSON.stringify(textExtractionReceipt));
    const textExtractionReceiptRef = { key: textExtractionReceiptKey, sha256: sha(textExtractionReceiptBytes) };

    // A1 — PV LINK receipt.
    const linkReceiptKey = "capture/link-receipt.json";
    const linkReceipt = produceZoningEventPvLinkReceipt({
      receipt_key: linkReceiptKey,
      event_id: "link",
      target_bylaw_numero: "026-101",
      detector_reglement_numero: DETECTOR_REGLEMENT,
      source_url: PDF_URL,
      source_span: SPAN,
      as_of_date: "2026-06-10",
      producer: "geo",
      run_id: RUN_ID,
      capture_run_sha256: captureRunSha,
      capture_manifest_sha256: captureManifestSha,
      captured_pdf_ref: pdfRef,
      pv_text_ref: pvTextRef,
      text_extraction_receipt_ref: textExtractionReceiptRef,
    });
    const linkReceiptBytes = Buffer.from(JSON.stringify(linkReceipt));
    const linkReceiptRef = { key: linkReceiptKey, sha256: sha(linkReceiptBytes) };

    // A3 — per-source no-match receipts (one per checked gisement).
    const noMatchPdfReceiptKey = `capture/_runs/${RUN_ID}/no-match-retract-pdf.json`;
    const noMatchPdfReceipt = produceZoningEventSourceNoMatchReceipt({
      receipt_key: noMatchPdfReceiptKey,
      event_id: "retract",
      run_id: RUN_ID,
      source_ref: PDF_URL,
      captured_object_ref: pdfRef,
      detector: "immo-extraction/d52af7",
      detector_git_sha: GIT_SHA,
      extracted_at: "2026-06-10T00:00:04.000Z",
    });
    const noMatchPdfReceiptBytes = Buffer.from(JSON.stringify(noMatchPdfReceipt));
    const noMatchPdfReceiptRef = { key: noMatchPdfReceiptKey, sha256: sha(noMatchPdfReceiptBytes) };

    const noMatchIndexReceiptKey = `capture/_runs/${RUN_ID}/no-match-retract-index.json`;
    const noMatchIndexReceipt = produceZoningEventSourceNoMatchReceipt({
      receipt_key: noMatchIndexReceiptKey,
      event_id: "retract",
      run_id: RUN_ID,
      source_ref: INDEX_URL,
      captured_object_ref: indexRef,
      detector: "immo-extraction/d52af7",
      detector_git_sha: GIT_SHA,
      extracted_at: "2026-06-10T00:00:04.000Z",
    });
    const noMatchIndexReceiptBytes = Buffer.from(JSON.stringify(noMatchIndexReceipt));
    const noMatchIndexReceiptRef = { key: noMatchIndexReceiptKey, sha256: sha(noMatchIndexReceiptBytes) };

    // A4 — extraction-exhaustion receipt (partitions the successful PV lines).
    const exhaustionReceiptKey = `capture/_runs/${RUN_ID}/exhaustion-retract.json`;
    const exhaustionReceipt = produceZoningEventExhaustionReceipt({
      receipt_key: exhaustionReceiptKey,
      event_id: "retract",
      run_id: RUN_ID,
      capture_run_sha256: captureRunSha,
      capture_manifest_sha256: captureManifestSha,
      checked_sources: [
        { source_ref: PDF_URL, evidence: [{ manifest_line_index: 0, extraction_receipt_ref: noMatchPdfReceiptRef }] },
        { source_ref: INDEX_URL, evidence: [{ manifest_line_index: 1, extraction_receipt_ref: noMatchIndexReceiptRef }] },
      ],
      as_of: "2026-08-23T00:00:00Z",
    });
    const exhaustionReceiptBytes = Buffer.from(JSON.stringify(exhaustionReceipt));
    const exhaustionReceiptRef = { key: exhaustionReceiptKey, sha256: sha(exhaustionReceiptBytes) };

    // A0 — the top-level inventory tying LINK + RETRACT to their receipts.
    const inventory = produceZoningEventRemediationInventory({
      cohort_sha256: cohortSha,
      audit_sha256: auditSha,
      authenticated: { extraction_ref: "d52af7", h2a_envelope_id: "env:inventory" },
      cities: [{
        slug: "ville-test",
        collection_sha256: collectionSha,
        events: [
          { event_id: "link", kind: "link", evidence_ref: linkReceiptRef },
          {
            event_id: "retract",
            kind: "retract",
            exhaustion: {
              run_refs: [exhaustionReceiptRef],
              checked_sources: [
                { source_ref: PDF_URL, outcome: "no-source" },
                { source_ref: INDEX_URL, outcome: "no-source" },
              ],
              as_of: "2026-08-23T00:00:00Z",
            },
          },
        ],
      }],
    });

    // (1) CONFORMANCE — every produced artefact parses the EXPORTED runner schema.
    expect(() => PvTextExtractionReceiptSchema.parse(textExtractionReceipt)).not.toThrow();
    expect(() => PvLinkReceiptSchema.parse(linkReceipt)).not.toThrow();
    expect(() => SourceNoMatchReceiptSchema.parse(noMatchPdfReceipt)).not.toThrow();
    expect(() => SourceNoMatchReceiptSchema.parse(noMatchIndexReceipt)).not.toThrow();
    expect(() => ExhaustionReceiptSchema.parse(exhaustionReceipt)).not.toThrow();
    expect(() => InventorySchema.parse(inventory)).not.toThrow();

    // (2) REAL INGESTION — the runner's actual parse+bind path over the produced set.
    const inventorySha = sha(`${JSON.stringify(inventory, null, 2)}\n`);
    const evidence = new Map<string, Buffer>([
      [pvTextRef.key, pv],
      [pdfRef.key, pdf],
      [indexRef.key, indexBytes],
      [CAPTURE_RUN_KEY, captureRun],
      [CAPTURE_MANIFEST_KEY, captureManifest],
      [textExtractionReceiptKey, textExtractionReceiptBytes],
      [linkReceiptKey, linkReceiptBytes],
      [noMatchPdfReceiptKey, noMatchPdfReceiptBytes],
      [noMatchIndexReceiptKey, noMatchIndexReceiptBytes],
      [exhaustionReceiptKey, exhaustionReceiptBytes],
    ]);

    const report = await buildZoningEventRemediationDryRun(
      auditValue,
      parseZoningEventRemediationInventory(inventory),
      { auditSha256: auditSha, inventorySha256: inventorySha },
      async () => ({ document: document(), sha256: collectionSha }),
      async (key) => {
        const bytes = evidence.get(key);
        if (bytes === undefined) throw new Error(`preuve durable absente du fixture: ${key}`);
        return bytes;
      },
    );

    // (3) City executable, zero unknown — the whole set resolved without throwing.
    expect(report.cities[0]!.error).toBeNull();
    expect(report.executable).toBe(true);
    expect(report.totals).toMatchObject({
      cities_unknown: 0,
      living_phantoms: 2,
      to_link: 1,
      to_retract: 1,
      blocked: 0,
    });
    expect(report.cities[0]!.plan?.to_link[0]).toMatchObject({
      event_id: "link",
      action: "link",
      source: { url: PDF_URL, source_span: SPAN },
      mapping: { target_bylaw_numero: "026-101", detector_reglement_numero: DETECTOR_REGLEMENT },
    });
    expect(report.cities[0]!.plan?.to_retract[0]).toMatchObject({
      event_id: "retract",
      action: "retract",
    });
  });

  it("refuses to fabricate: producers throw rather than emit an artefact that breaks a bind", () => {
    // A1: a span that does not carry the explicit reglement number can never LINK.
    expect(() => produceZoningEventPvLinkReceipt({
      receipt_key: "capture/link-receipt.json",
      event_id: "link",
      target_bylaw_numero: "026-101",
      detector_reglement_numero: "2026-101",
      source_url: "https://example.test/pv.pdf",
      source_span: "Un extrait sans le numéro explicite",
      as_of_date: "2026-06-10",
      producer: "geo",
      run_id: "unit",
      capture_run_sha256: sha("run"),
      capture_manifest_sha256: sha("manifest"),
      captured_pdf_ref: { key: "raw/pv-unit/cas/deadbeef.pdf", sha256: sha("pdf") },
      pv_text_ref: { key: "capture/_runs/unit/pv.txt", sha256: sha("pv") },
      text_extraction_receipt_ref: { key: "capture/_runs/unit/x.json", sha256: sha("x") },
    })).toThrow(/detector_reglement_numero/);

    // A4: an exhaustion claim with no covered manifest line is not exhaustion.
    expect(() => produceZoningEventExhaustionReceipt({
      receipt_key: "capture/_runs/unit/exhaustion.json",
      event_id: "retract",
      run_id: "unit",
      capture_run_sha256: sha("run"),
      capture_manifest_sha256: sha("manifest"),
      checked_sources: [{ source_ref: "https://example.test/pv-index", evidence: [] }],
      as_of: "2026-08-23T00:00:00Z",
    })).toThrow(/sans ligne de preuve/);

    // Canonical run key: a run_id smuggling a path separator is rejected.
    expect(() => produceZoningEventExhaustionReceipt({
      receipt_key: "capture/_runs/unit/exhaustion.json",
      event_id: "retract",
      run_id: "unit/../evil",
      capture_run_sha256: sha("run"),
      capture_manifest_sha256: sha("manifest"),
      checked_sources: [{
        source_ref: "https://example.test/pv-index",
        evidence: [{ manifest_line_index: 0, extraction_receipt_ref: { key: "capture/_runs/unit/x.json", sha256: sha("x") } }],
      }],
      as_of: "2026-08-23T00:00:00Z",
    })).toThrow(/run_id invalide/);
  });
});
