import { describe, expect, it } from "vitest";

import type { ZoningEvent, ZoningEventsDocument } from "../zoning-events-emit.js";
import {
  auditZoningEventSourceCohort,
  parseZoningEventCohortTsv,
} from "./zoning-event-source-audit-runner.js";

function served(slug: string, source: string): ZoningEventsDocument {
  const entry: ZoningEvent = {
    event_id: `${slug}-event`,
    version: 1,
    supersedes: null,
    state: "active",
    muni: slug,
    bylaw_numero: null,
    type: "autre",
    date_iso: "2026-01-01",
    detection_state: "detected",
    zone_codes_resolus: [],
    zone_codes_non_resolus: [],
    nb_unites_max: null,
    effet_densifiant_ref: null,
    url_pdf: source,
    extrait_brut: "",
    confidence: 0.5,
    provenance: { producer: "geo", source_span: "", source_url: "", as_of_date: "2026-01-01" },
  };
  return {
    type: "FeatureCollection",
    as_of: "2026-08-23T00:00:00Z",
    complete: true,
    muni: slug,
    events: [entry],
    features: [{ type: "Feature", geometry: null, properties: entry }],
  };
}

describe("parseZoningEventCohortTsv", () => {
  it("parses a headered TSV, sorts slugs, and rejects duplicates", () => {
    expect(parseZoningEventCohortTsv("slug\tselection\nzeta\tB\nalpha\tB\n")).toEqual(["alpha", "zeta"]);
    expect(() => parseZoningEventCohortTsv("alpha\nalpha\n")).toThrow(/dupliqué/);
  });
});

describe("auditZoningEventSourceCohort", () => {
  it("reads only nested served keys and keeps read failures unknown", async () => {
    const keys: string[] = [];
    const report = await auditZoningEventSourceCohort(
      {
        source: "work/coverage/cohort.tsv",
        sha256: `sha256:${"a".repeat(64)}`,
        expected_count: 2,
        slugs: ["zeta", "alpha"],
      },
      async (slug, key) => {
        keys.push(key);
        if (slug === "zeta") throw new Error("NoSuchKey");
        return { document: served(slug, ""), sha256: `sha256:${"b".repeat(64)}` };
      },
      { concurrency: 1 },
    );

    expect(keys).toEqual([
      "normalized/ca-qc-zoning-events/qc-zoning-events-alpha/qc-zoning-events-alpha.geojson",
      "normalized/ca-qc-zoning-events/qc-zoning-events-zeta/qc-zoning-events-zeta.geojson",
    ]);
    expect(report.cities.map((city) => city.slug)).toEqual(["alpha", "zeta"]);
    expect(report.totals).toMatchObject({
      cities_total: 2,
      cities_audited: 1,
      cities_unknown: 1,
      events_total: 1,
      no_source: 1,
      living_phantoms: 1,
    });
    expect(report.cities[1]).toMatchObject({
      audit_state: "unknown",
      collection_sha256: null,
      counts: null,
      events: [],
    });
  });
});
