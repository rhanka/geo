import { describe, expect, it } from "vitest";

import { computeEventId, type ZoningEvent, type ZoningEventsDocument } from "../zoning-events-emit.js";
import {
  classifyZoningEventSource,
  observeZoningEventSources,
} from "./zoning-event-source-audit.js";

function event(overrides: Partial<ZoningEvent> = {}): ZoningEvent {
  return {
    event_id: computeEventId("sainte-martine", "pv-2026-04", "026-511"),
    version: 1,
    supersedes: null,
    state: "active",
    muni: "sainte-martine",
    bylaw_numero: "026-511",
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
    provenance: {
      producer: "geo",
      source_span: "",
      source_url: "",
      as_of_date: "2026-06-10",
    },
    ...overrides,
  };
}

function document(events: ZoningEvent[]): ZoningEventsDocument {
  return {
    type: "FeatureCollection",
    as_of: "2026-08-23T00:00:00Z",
    complete: true,
    muni: "sainte-martine",
    events,
    features: events.map((entry) => ({ type: "Feature", geometry: null, properties: entry })),
  };
}

describe("classifyZoningEventSource", () => {
  it("classifies an exact HTTP(S) URL from either default source field", () => {
    expect(classifyZoningEventSource(event({ url_pdf: "https://example.test/pv.pdf" }))).toEqual({
      source_state: "has-source",
      source_url: "https://example.test/pv.pdf",
      source_field: "url_pdf",
    });
    expect(classifyZoningEventSource(event({
      provenance: {
        producer: "geo",
        source_span: "span",
        source_url: "http://example.test/pv.pdf",
        as_of_date: "2026-06-10",
      },
    }))).toMatchObject({ source_state: "has-source", source_field: "provenance.source_url" });
  });

  it("distinguishes invalid values from absent values", () => {
    expect(classifyZoningEventSource(event({ url_pdf: "ftp://example.test/pv.pdf" }))).toEqual({
      source_state: "invalid-source",
      source_url: "ftp://example.test/pv.pdf",
      source_field: "url_pdf",
    });
    expect(classifyZoningEventSource(event())).toEqual({
      source_state: "no-source",
      source_url: null,
      source_field: null,
    });
  });

  it("uses parameterized source fields without silently consulting the defaults", () => {
    const custom = event({ url_pdf: "https://ignored.test/pv.pdf" }) as ZoningEvent & { source?: { pdf?: string } };
    custom.source = { pdf: "https://custom.test/source.pdf" };
    expect(classifyZoningEventSource(custom, ["source.pdf"])).toEqual({
      source_state: "has-source",
      source_url: "https://custom.test/source.pdf",
      source_field: "source.pdf",
    });
    expect(classifyZoningEventSource(custom, ["missing.path"]).source_state).toBe("no-source");
  });
});

describe("observeZoningEventSources", () => {
  it("reports per-event rows and excludes retracted events from the living phantom set", () => {
    const valid = event({ event_id: "valid", url_pdf: "https://example.test/a.pdf" });
    const missing = event({ event_id: "missing" });
    const invalid = event({ event_id: "invalid", url_pdf: "not-a-url" });
    const retracted = event({ event_id: "retracted", state: "retracted", url_pdf: "" });

    const observed = observeZoningEventSources(document([retracted, missing, valid, invalid]));
    expect(observed.events.map((entry) => entry.event_id)).toEqual([
      "invalid",
      "missing",
      "retracted",
      "valid",
    ]);
    expect(observed.counts).toEqual({
      events_total: 4,
      living_events: 3,
      retracted_events: 1,
      has_source: 1,
      invalid_source: 1,
      no_source: 2,
      living_phantoms: 2,
      living_invalid_source: 1,
      living_no_source: 1,
    });
    expect(observed.events.find((entry) => entry.event_id === "retracted")?.is_living_phantom).toBe(false);
  });

  it("fails closed when the flat and geo-api feature mirrors diverge", () => {
    const value = document([event({ event_id: "a" })]);
    value.features[0]!.properties = event({ event_id: "b" });
    expect(() => observeZoningEventSources(value)).toThrow(/miroir/);
  });
});
