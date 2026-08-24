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
  ZONING_EVENT_REMEDIATION_INVENTORY_CONTRACT,
} from "./zoning-event-remediation-runner.js";
import {
  ZONING_EVENT_EXHAUSTION_CONTRACT,
  ZONING_EVENT_EXHAUSTION_RECEIPT_CONTRACT,
  ZONING_EVENT_PV_LINK_RECEIPT_CONTRACT,
  ZONING_EVENT_PV_TEXT_EXTRACTION_RECEIPT_CONTRACT,
  type Sha256Ref,
} from "./zoning-event-remediation.js";

function sha(value: string | Buffer): Sha256Ref {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

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

describe("buildZoningEventRemediationDryRun", () => {
  it("verifies durable evidence and produces a closed LINK-before-RETRACT plan", async () => {
    const body = Buffer.from(JSON.stringify(document()));
    const collectionSha = sha(body);
    const cohortSha = sha("ville-test\n");
    const auditValue = audit(collectionSha, cohortSha);
    const auditSha = sha(`${JSON.stringify(auditValue, null, 2)}\n`);
    const span = "Règlement numéro 2026-101 modifiant le Règlement de zonage numéro 2019-342";
    const pv = Buffer.from(`Avis de motion\n\nDonne avis de motion pour le ${span}.`);
    const pvTextRef = { key: "capture/_runs/unit/pv.txt", sha256: sha(pv) };
    const pdf = Buffer.from("%PDF-1.7 synthetic in-memory unit fixture");
    const pdfSha = sha(pdf);
    const pdfRef = { key: `raw/pv-unit/cas/${pdfSha.slice("sha256:".length)}.pdf`, sha256: pdfSha };
    const captureRunKey = "capture/_runs/unit/run.json";
    const captureRun = Buffer.from(JSON.stringify({
      run_id: "unit",
      lane: "pv",
      execution: "cluster",
      git_sha: "a".repeat(40),
      worklist: "capture/worklists/unit.json",
      started_at: "2026-06-10T00:00:00.000Z",
      finished_at: "2026-06-10T00:01:00.000Z",
      exit_code: 0,
      user_agent: "geo-test/1",
      egress: "direct",
      via_obscura: false,
      counts: { attempts: 1, ok: 1, failed: 0, dedup: 0, bytes: pdf.length },
    }));
    const captureManifestKey = "capture/_runs/unit/manifest.jsonl";
    const captureManifest = Buffer.from(`${JSON.stringify({
      run_id: "unit",
      lane: "pv",
      source: "proces-verbaux-test",
      slugs: ["ville-test"],
      url: "https://example.test/pv.pdf",
      method: "GET",
      attempt: 1,
      requested_at: "2026-06-10T00:00:00.000Z",
      retrieved_at: "2026-06-10T00:00:01.000Z",
      http_status: 200,
      redirect_chain: [],
      final_url: "https://example.test/pv.pdf",
      content_type: "application/pdf",
      bytes: pdf.length,
      sha256: pdfRef.sha256,
      storage_key: pdfRef.key,
      dedup: false,
      error: null,
      user_agent: "geo-test/1",
      via_obscura: false,
      egress: "direct",
      robots: "allowed",
      redacted: false,
    })}\n`);
    const textExtractionReceiptKey = "capture/_runs/unit/pv-text-extraction-link.json";
    const textExtractionReceipt = Buffer.from(JSON.stringify({
      contract: ZONING_EVENT_PV_TEXT_EXTRACTION_RECEIPT_CONTRACT,
      status: "extracted",
      receipt_key: textExtractionReceiptKey,
      run_id: "unit",
      source_url: "https://example.test/pv.pdf",
      captured_pdf_ref: pdfRef,
      pv_text_ref: pvTextRef,
      extraction_tool: "pdftotext/unit-test",
      extracted_at: "2026-06-10T00:00:02.000Z",
    }));
    const linkReceiptKey = "capture/link-receipt.json";
    const linkReceipt = Buffer.from(JSON.stringify({
      contract: ZONING_EVENT_PV_LINK_RECEIPT_CONTRACT,
      status: "source-found",
      receipt_key: linkReceiptKey,
      event_id: "link",
      target_bylaw_numero: "026-101",
      detector_reglement_numero: "2026-101",
      source_url: "https://example.test/pv.pdf",
      source_span: span,
      as_of_date: "2026-06-10",
      producer: "geo",
      capture_run_ref: { key: captureRunKey, sha256: sha(captureRun) },
      capture_manifest_ref: { key: captureManifestKey, sha256: sha(captureManifest) },
      captured_pdf_ref: pdfRef,
      pv_text_ref: pvTextRef,
      text_extraction_receipt_ref: {
        key: textExtractionReceiptKey,
        sha256: sha(textExtractionReceipt),
      },
    }));
    const exhaustionReceiptKey = "capture/run.json";
    const exhaustionReceipt = Buffer.from(JSON.stringify({
      contract: ZONING_EVENT_EXHAUSTION_RECEIPT_CONTRACT,
      status: "exhausted",
      receipt_key: exhaustionReceiptKey,
      event_id: "retract",
      checked_sources: [{ source_ref: "pv:index", outcome: "no-source" }],
      as_of: "2026-08-23T00:00:00Z",
    }));
    const rawInventory = {
      contract: ZONING_EVENT_REMEDIATION_INVENTORY_CONTRACT,
      cohort_sha256: cohortSha,
      audit_sha256: auditSha,
      authenticated: {
        origin: "immo-extraction",
        extraction_ref: "d52af7",
        via: "geo-cond",
        h2a_envelope_id: "env:inventory",
      },
      cities: [{
        slug: "ville-test",
        collection_sha256: collectionSha,
        events: [
          { event_id: "link", resolution: { kind: "link", evidence_ref: {
            key: linkReceiptKey, sha256: sha(linkReceipt),
          } } },
          { event_id: "retract", resolution: { kind: "retract", exhaustion: {
            contract: ZONING_EVENT_EXHAUSTION_CONTRACT,
            status: "exhausted",
            run_refs: [{ key: exhaustionReceiptKey, sha256: sha(exhaustionReceipt) }],
            checked_sources: [{ source_ref: "pv:index", outcome: "no-source" }],
            as_of: "2026-08-23T00:00:00Z",
          } } },
        ],
      }],
    };
    const inventoryBytes = `${JSON.stringify(rawInventory, null, 2)}\n`;
    const inventory = parseZoningEventRemediationInventory(rawInventory);
    const evidence = new Map([
      [pvTextRef.key, pv],
      [pdfRef.key, pdf],
      [captureRunKey, captureRun],
      [captureManifestKey, captureManifest],
      [textExtractionReceiptKey, textExtractionReceipt],
      [linkReceiptKey, linkReceipt],
      [exhaustionReceiptKey, exhaustionReceipt],
    ]);
    const report = await buildZoningEventRemediationDryRun(
      auditValue,
      inventory,
      { auditSha256: auditSha, inventorySha256: sha(inventoryBytes) },
      async () => ({ document: document(), sha256: collectionSha }),
      async (key) => evidence.get(key)!,
    );
    expect(report.executable).toBe(true);
    expect(report.totals).toMatchObject({
      cities_unknown: 0, living_phantoms: 2, to_link: 1, to_retract: 1, blocked: 0,
    });
    expect(report.cities[0]!.plan?.to_link[0]).toMatchObject({
      event_id: "link",
      source: { url: "https://example.test/pv.pdf", source_span: span },
      mapping: { target_bylaw_numero: "026-101", detector_reglement_numero: "2026-101" },
    });
  });

  it("turns a semantically unrelated durable receipt into unknown, never RETRACT", async () => {
    const value = document();
    const body = Buffer.from(JSON.stringify(value));
    const collectionSha = sha(body);
    const cohortSha = sha("ville-test\n");
    const auditValue = audit(collectionSha, cohortSha);
    const auditSha = sha(`${JSON.stringify(auditValue, null, 2)}\n`);
    const unrelatedReceipt = Buffer.from(JSON.stringify({
      contract: ZONING_EVENT_EXHAUSTION_RECEIPT_CONTRACT,
      status: "exhausted",
      receipt_key: "capture/run.json",
      event_id: "retract",
      checked_sources: [{ source_ref: "pv:unrelated", outcome: "no-source" }],
      as_of: "2026-08-23T00:00:00Z",
    }));
    const rawInventory = {
      contract: ZONING_EVENT_REMEDIATION_INVENTORY_CONTRACT,
      cohort_sha256: cohortSha,
      audit_sha256: auditSha,
      authenticated: {
        origin: "immo-extraction", extraction_ref: "d52af7", via: "geo-cond", h2a_envelope_id: "env:x",
      },
      cities: [{
        slug: "ville-test", collection_sha256: collectionSha,
        events: [{ event_id: "retract", resolution: { kind: "retract", exhaustion: {
          contract: ZONING_EVENT_EXHAUSTION_CONTRACT,
          status: "exhausted",
          run_refs: [{ key: "capture/run.json", sha256: sha(unrelatedReceipt) }],
          checked_sources: [{ source_ref: "pv:index", outcome: "no-source" }],
          as_of: "2026-08-23T00:00:00Z",
        } } }],
      }],
    };
    const report = await buildZoningEventRemediationDryRun(
      auditValue,
      parseZoningEventRemediationInventory(rawInventory),
      { auditSha256: auditSha, inventorySha256: sha(JSON.stringify(rawInventory)) },
      async () => ({ document: value, sha256: collectionSha }),
      async () => unrelatedReceipt,
    );
    expect(report.executable).toBe(false);
    expect(report.totals.cities_unknown).toBe(1);
    expect(report.totals.to_retract).toBe(0);
    expect(report.cities[0]!.error).toMatch(/sources reçues\/inventaire divergentes/);
  });
});
