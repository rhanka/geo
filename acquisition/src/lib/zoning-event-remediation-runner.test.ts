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
import { ZONING_EVENT_EXHAUSTION_CONTRACT, type Sha256Ref } from "./zoning-event-remediation.js";

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
    const receipt = Buffer.from('{"status":"exhausted"}\n');
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
          { event_id: "link", resolution: { kind: "link", source: {
            url: "https://example.test/pv.pdf",
            source_span: span,
            as_of_date: "2026-06-10",
            producer: "geo",
            detector_reglement_numero: "2026-101",
            pv_text_ref: { key: "capture/pv.txt", sha256: sha(pv) },
          } } },
          { event_id: "retract", resolution: { kind: "retract", exhaustion: {
            contract: ZONING_EVENT_EXHAUSTION_CONTRACT,
            status: "exhausted",
            run_refs: [{ key: "capture/run.json", sha256: sha(receipt) }],
            checked_sources: [{ source_ref: "pv:index", outcome: "no-source" }],
            as_of: "2026-08-23T00:00:00Z",
          } } },
        ],
      }],
    };
    const inventoryBytes = `${JSON.stringify(rawInventory, null, 2)}\n`;
    const inventory = parseZoningEventRemediationInventory(rawInventory);
    const evidence = new Map([["capture/pv.txt", pv], ["capture/run.json", receipt]]);
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
      event_id: "link", source: { url: "https://example.test/pv.pdf", source_span: span },
    });
  });

  it("turns a changed or unreadable durable proof into unknown, never RETRACT", async () => {
    const value = document();
    const body = Buffer.from(JSON.stringify(value));
    const collectionSha = sha(body);
    const cohortSha = sha("ville-test\n");
    const auditValue = audit(collectionSha, cohortSha);
    const auditSha = sha(`${JSON.stringify(auditValue, null, 2)}\n`);
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
          run_refs: [{ key: "capture/run.json", sha256: sha("expected") }],
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
      async () => Buffer.from("changed"),
    );
    expect(report.executable).toBe(false);
    expect(report.totals.cities_unknown).toBe(1);
    expect(report.totals.to_retract).toBe(0);
    expect(report.cities[0]!.error).toMatch(/SHA divergent/);
  });
});
