import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  computeEventId,
  zoningEventsKeys,
  type ZoningEvent,
  type ZoningEventsDocument,
} from "../zoning-events-emit.js";
import {
  executeZoningEventRemediation,
  linkSourceFromGenericPv,
  linkZoningEventSource,
  materializeZoningEventRemediation,
  planZoningEventRemediation,
  retractZoningEvent,
  zoningEventRemediationArtifactSha256,
  ZONING_EVENT_EXHAUSTION_CONTRACT,
  ZONING_EVENT_OWNER_GO_CONTRACT,
  ZONING_EVENT_REMEDIATION_DRY_RUN_CONTRACT,
  type ZoningEventExhaustionProof,
  type ZoningEventLinkSource,
  type ZoningEventsWholeSetStore,
} from "./zoning-event-remediation.js";

const PDF = "https://example.test/pv.pdf";
const SHA_A = `sha256:${"a".repeat(64)}` as const;
const SHA_B = `sha256:${"b".repeat(64)}` as const;

function event(id: string, overrides: Partial<ZoningEvent> = {}): ZoningEvent {
  return {
    event_id: id,
    version: 1,
    supersedes: null,
    state: "active",
    muni: "ville-test",
    bylaw_numero: "2026-101",
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
    ...overrides,
  };
}

function document(events: ZoningEvent[]): ZoningEventsDocument {
  return {
    type: "FeatureCollection",
    as_of: "2026-08-23T00:00:00Z",
    complete: true,
    muni: "ville-test",
    events,
    features: events.map((entry) => ({ type: "Feature", geometry: null, properties: entry })),
  };
}

const source: ZoningEventLinkSource = {
  url: PDF,
  source_span: "Règlement numéro 2026-101 modifiant le Règlement de zonage numéro 2019-342",
  as_of_date: "2026-06-10",
  producer: "geo",
};

const exhaustion: ZoningEventExhaustionProof = {
  contract: ZONING_EVENT_EXHAUSTION_CONTRACT,
  status: "exhausted",
  run_refs: [{ key: "capture/_runs/example/receipt.json", sha256: SHA_A }],
  checked_sources: [{ source_ref: "pv:example", outcome: "no-source" }],
  as_of: "2026-08-23T00:00:00Z",
};

function memoryStore(seed: ZoningEventsDocument): {
  store: ZoningEventsWholeSetStore;
  data: Map<string, Buffer>;
  written: Map<string, ZoningEventsDocument>;
} {
  const data = new Map<string, Buffer>();
  for (const key of zoningEventsKeys(seed.muni)) data.set(key, Buffer.from(JSON.stringify(seed)));
  const written = new Map<string, ZoningEventsDocument>();
  return {
    store: {
      async getExisting(key) {
        return data.get(key) ?? null;
      },
      async commitWholeSetIfUnchanged(input) {
        for (const key of input.keys) {
          const current = data.get(key);
          const actual = current
            ? `sha256:${createHash("sha256").update(current).digest("hex")}`
            : null;
          if (actual !== input.expected_sha256) throw new Error(`CAS divergent ${key}`);
        }
        for (const key of input.keys) {
          data.set(key, input.body);
          written.set(key, JSON.parse(input.body.toString("utf8")) as ZoningEventsDocument);
        }
      },
    },
    data,
    written,
  };
}

describe("LINK and RETRACT mutations", () => {
  it("LINK preserves event_id, fills every source field, and increments version", () => {
    const before = event(computeEventId("ville-test", PDF, "2026-101"));
    const linked = linkZoningEventSource(before, source);
    expect(linked).toMatchObject({
      event_id: before.event_id,
      version: 2,
      state: "active",
      url_pdf: PDF,
      extrait_brut: source.source_span,
      provenance: {
        source_url: PDF,
        source_span: source.source_span,
        as_of_date: "2026-06-10",
        producer: "geo",
      },
    });
  });

  it("requires a generic-PV detection and an exact verbatim span before LINK", () => {
    const span = "Règlement numéro 2026-101 modifiant le Règlement de zonage numéro 2019-342";
    const pvText = `Avis de motion\n\nDonne avis de motion pour le ${span}.`;
    expect(linkSourceFromGenericPv({
      ...source,
      source_span: span,
      pv_text: pvText,
      detector_reglement_numero: "2026-101",
    })).toEqual({ ...source, source_span: span });
    expect(() => linkSourceFromGenericPv({
      ...source,
      source_span: `${span} inventé`,
      pv_text: pvText,
      detector_reglement_numero: "2026-101",
    })).toThrow(/non verbatim/);
  });

  it("RETRACT requires closed exhaustion proof and emits a versioned tombstone", () => {
    const before = event("retract-me");
    expect(retractZoningEvent(before, exhaustion)).toMatchObject({
      event_id: "retract-me",
      version: 2,
      state: "retracted",
    });
    expect(() => retractZoningEvent(before, { ...exhaustion, run_refs: [] })).toThrow(/run_refs/);
    expect(() => retractZoningEvent(before, { ...exhaustion, as_of: "2026-02-30" })).toThrow(/ISO-8601|YYYY-MM-DD/);
  });
});

describe("planZoningEventRemediation", () => {
  it("plans every living phantom, gives LINK priority, and blocks missing proof", () => {
    const value = document([
      event("link"),
      event("retract"),
      event("blocked"),
      event("already-sourced", { url_pdf: "https://example.test/source.pdf" }),
      event("old-tombstone", { state: "retracted" }),
    ]);
    const plan = planZoningEventRemediation(
      value,
      [
        {
          event_id: "link",
          link_source: source,
          link_mapping: { target_bylaw_numero: "2026-101", detector_reglement_numero: "2026-101" },
          exhaustion,
        },
        { event_id: "retract", exhaustion },
      ],
      {
        collectionKey: zoningEventsKeys("ville-test")[1]!,
        collectionSha256: SHA_A,
        inventorySha256: SHA_B,
      },
    );
    expect(plan.to_link.map((item) => item.event_id)).toEqual(["link"]);
    expect(plan.to_retract.map((item) => item.event_id)).toEqual(["retract"]);
    expect(plan.blocked.map((item) => item.event_id)).toEqual(["blocked"]);
    expect(plan.counts).toEqual({ living_phantoms: 3, to_link: 1, to_retract: 1, blocked: 1 });
    expect(() => materializeZoningEventRemediation(value, plan)).toThrow(/bloqué/);
    expect(() => planZoningEventRemediation(
      value,
      [{
        event_id: "link",
        link_source: source,
        link_mapping: { target_bylaw_numero: "026-101", detector_reglement_numero: "2026-101" },
      }],
      {
        collectionKey: zoningEventsKeys("ville-test")[1]!,
        collectionSha256: SHA_A,
        inventorySha256: SHA_B,
      },
    )).toThrow(/mapping LINK/);
  });
});

describe("executeZoningEventRemediation", () => {
  it("refuses a mismatched owner-go and otherwise re-emits the whole set to both keys", async () => {
    const value = document([event("link"), event("retract"), event("unchanged", { url_pdf: PDF })]);
    const valueBytes = Buffer.from(JSON.stringify(value));
    const collectionSha = `sha256:${createHash("sha256").update(valueBytes).digest("hex")}` as const;
    const plan = planZoningEventRemediation(
      value,
      [
        {
          event_id: "link",
          link_source: source,
          link_mapping: { target_bylaw_numero: "2026-101", detector_reglement_numero: "2026-101" },
        },
        { event_id: "retract", exhaustion },
      ],
      {
        collectionKey: zoningEventsKeys("ville-test")[1]!,
        collectionSha256: collectionSha,
        inventorySha256: SHA_B,
      },
    );
    const ownerGo = {
      contract: ZONING_EVENT_OWNER_GO_CONTRACT,
      via: "geo-cond" as const,
      owner_go_direct: true as const,
      owner_instance: "owner:direct",
      geo_cond_instance: "claude:geo-cond",
      inventory_sha256: SHA_B,
      dry_run_sha256: SHA_A,
      h2a_envelope_id: "env:owner-go",
      h2a_session_id: "sess:geo-cond",
    };
    const dryRun = {
      contract: ZONING_EVENT_REMEDIATION_DRY_RUN_CONTRACT,
      dry_run: true as const,
      executable: true,
      audit_sha256: SHA_A,
      inventory_sha256: SHA_B,
      cohort: { sha256: SHA_A, expected_count: 1, slugs: ["ville-test"] },
      authenticated: {
        origin: "immo-extraction" as const,
        extraction_ref: "d52af7",
        via: "geo-cond" as const,
        h2a_envelope_id: "env:inventory",
      },
      totals: {
        cities_total: 1,
        cities_planned: 1,
        cities_unknown: 0,
        living_phantoms: 2,
        to_link: 1,
        to_retract: 1,
        blocked: 0,
      },
      cities: [{
        slug: "ville-test",
        collection_key: zoningEventsKeys("ville-test")[1]!,
        audit_collection_sha256: collectionSha,
        current_collection_sha256: collectionSha,
        dry_run_state: "planned" as const,
        error: null,
        plan,
      }],
    };
    ownerGo.dry_run_sha256 = zoningEventRemediationArtifactSha256(dryRun);
    const memory = memoryStore(value);
    const ownerEnvelope = {
      protocol: "sentropic.h2a",
      version: "0.1",
      id: ownerGo.h2a_envelope_id,
      type: "event",
      actor: { instance: ownerGo.owner_instance, role: "OWNER", scope: "scope:default" },
      body: {
        kind: "zoning-event-remediation-owner-go",
        via: "geo-cond",
        owner_go_direct: true,
        owner_instance: ownerGo.owner_instance,
        geo_cond_instance: ownerGo.geo_cond_instance,
        inventory_sha256: ownerGo.inventory_sha256,
        dry_run_sha256: ownerGo.dry_run_sha256,
        h2a_session_id: ownerGo.h2a_session_id,
      },
    };
    const geoCondSession = {
      sessionId: ownerGo.h2a_session_id,
      instance: ownerGo.geo_cond_instance,
      state: "live",
    };
    const h2a = {
      readH2aEnvelope: async () => ownerEnvelope,
      readH2aSession: async () => geoCondSession,
    };

    await expect(executeZoningEventRemediation(
      "ville-test",
      dryRun,
      { ...ownerGo, dry_run_sha256: SHA_A },
      { asOf: "2026-08-24T00:00:00Z", ...h2a, store: memory.store },
    )).rejects.toThrow(/dry-run exact/);
    expect(memory.written.size).toBe(0);

    const staleMemory = memoryStore(value);
    staleMemory.data.set(zoningEventsKeys("ville-test")[1]!, Buffer.from(`${valueBytes.toString("utf8")} `));
    await expect(executeZoningEventRemediation(
      "ville-test",
      dryRun,
      ownerGo,
      { asOf: "2026-08-24T00:00:00Z", ...h2a, store: staleMemory.store },
    )).rejects.toThrow(/layout servi modifié\/divergent/);
    expect(staleMemory.written.size).toBe(0);
    expect(memory.written.size).toBe(0);

    const hiddenUnknown = {
      ...dryRun,
      cities: [{ ...dryRun.cities[0]!, dry_run_state: "unknown" as const, plan: null }],
    };
    const hiddenUnknownGo = {
      ...ownerGo,
      dry_run_sha256: zoningEventRemediationArtifactSha256(hiddenUnknown),
    };
    await expect(executeZoningEventRemediation(
      "ville-test",
      hiddenUnknown,
      hiddenUnknownGo,
      { asOf: "2026-08-24T00:00:00Z", ...h2a, store: memory.store },
    )).rejects.toThrow(/comptes\/exécutabilité/);
    expect(memory.written.size).toBe(0);

    await expect(executeZoningEventRemediation(
      "ville-test",
      dryRun,
      ownerGo,
      {
        asOf: "2026-08-24T00:00:00Z",
        readH2aEnvelope: async () => ({
          ...ownerEnvelope,
          actor: { instance: "owner:forged", role: "OWNER", scope: "scope:default" },
        }),
        readH2aSession: h2a.readH2aSession,
        store: memory.store,
      },
    )).rejects.toThrow(/enveloppe h2a owner DIRECT/);
    expect(memory.written.size).toBe(0);

    const result = await executeZoningEventRemediation(
      "ville-test",
      dryRun,
      ownerGo,
      { asOf: "2026-08-24T00:00:00Z", ...h2a, store: memory.store },
    );
    expect(result.keys).toEqual(zoningEventsKeys("ville-test"));
    expect(result.document.events).toHaveLength(3);
    expect(result.document.events.find((entry) => entry.event_id === "link")).toMatchObject({
      version: 2,
      url_pdf: PDF,
    });
    expect(result.document.events.find((entry) => entry.event_id === "retract")).toMatchObject({
      version: 2,
      state: "retracted",
    });
    for (const key of zoningEventsKeys("ville-test")) {
      expect(memory.written.get(key)?.events).toHaveLength(3);
    }
  });
});
