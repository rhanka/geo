/** Network-free unit coverage for the qc-zoning-events recall gate. */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  parseCohortFile,
  parseImmoDesignationEvents,
  partitionEventSets,
  runRecallGate,
  setRecallFor,
  type NaturalKeyEvent,
} from "./zoning-events-recall-gate.js";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const GEO_FIXTURE = join(HERE, "__fixtures__/zoning-events-recall-gate.geo.json");
const IMMO_FIXTURE = join(HERE, "__fixtures__/zoning-events-recall-gate.immo.json");
const CROSSWALK_FIXTURE = JSON.parse(readFileSync(
  join(HERE, "__fixtures__/zoning-events-recall-gate.crosswalk.json"),
  "utf8",
)) as {
  synonym: { geo_type: string; immo_kind: string; source_url: string };
  unmapped: { geo_type: string; immo_kind: string; source_url: string };
};

function event(
  side: "geo" | "immo",
  sourceUrl: string | null,
  bylawNumero: string | null,
  type = "ppcmoi",
): NaturalKeyEvent {
  return {
    side,
    natural_key: {
      muni: "coaticook",
      source_url_norm: sourceUrl,
      date_iso: "2026-02-10",
      type,
    },
    secondary_natural_key: bylawNumero === null
      ? null
      : { muni: "coaticook", bylaw_numero_norm: bylawNumero.toLowerCase(), type, date_iso: "2026-02-10" },
    source_fields: {
      event_id: side === "geo" ? "geo-id" : null,
      muni: "coaticook",
      source_url: sourceUrl,
      date_iso: "2026-02-10",
      type,
      bylaw_numero: bylawNumero,
      zone_ref: null,
      no_lot: null,
    },
  };
}

describe("parseImmoDesignationEvents", () => {
  it("should map only documented candidate fields and canonicalize an absent category to autre", () => {
    const [mapped, unknown] = parseImmoDesignationEvents([
      {
        city_slug: "coaticook",
        node_id: "immo-co-100",
        kind: "PPCMOI",
        date: "2026-02-10",
        bylaw_numero: "CO-100",
        url_pdf: "https://COATICOOK.ca/docs/a.pdf?utm_source=immo",
        zone_codes: ["CO-1"],
        no_lot: null,
      },
      {},
    ]);

    expect(mapped?.natural_key).toEqual({
      muni: "coaticook",
      source_url_norm: "https://coaticook.ca/docs/a.pdf",
      date_iso: "2026-02-10",
      type: "ppcmoi",
    });
    expect(mapped?.source_fields.zone_ref).toEqual(["CO-1"]);
    expect(mapped?.source_fields.event_id).toBe("immo-co-100");
    expect(unknown?.natural_key).toEqual({ muni: null, source_url_norm: null, date_iso: null, type: "autre" });
    expect(unknown?.secondary_natural_key).toBeNull();
  });
});

describe("partitionEventSets", () => {
  it("should never let a bylaw number relax exact document identity", () => {
    const partition = partitionEventSets(
      [event("geo", "https://coaticook.ca/docs/geo.pdf", "CO-100")],
      [event("immo", "https://coaticook.ca/docs/immo.pdf", "CO-100")],
    );

    expect(partition.matched).toHaveLength(0);
    expect(partition.missed[0]?.unmatched_reason).toBe("identity_not_aligned");
    expect(partition.extra[0]?.unmatched_reason).toBe("identity_not_aligned");
  });

  it("should match a vendorized synonym but never force an unmapped piia category", () => {
    const synonymImmo = parseImmoDesignationEvents([{
      city_slug: "coaticook",
      kind: CROSSWALK_FIXTURE.synonym.immo_kind,
      date: "2026-02-10",
      source_url: CROSSWALK_FIXTURE.synonym.source_url,
    }])[0]!;
    const synonym = partitionEventSets([
      event("geo", CROSSWALK_FIXTURE.synonym.source_url, null, CROSSWALK_FIXTURE.synonym.geo_type),
    ], [synonymImmo]);
    expect(synonymImmo.natural_key.type).toBe("modification_zonage");
    expect(synonym.matched[0]?.match_kind).toBe("identity_crosswalk");

    const unmappedImmo = parseImmoDesignationEvents([{
      city_slug: "coaticook",
      kind: CROSSWALK_FIXTURE.unmapped.immo_kind,
      date: "2026-02-10",
      source_url: CROSSWALK_FIXTURE.unmapped.source_url,
    }])[0]!;
    const unmapped = partitionEventSets([
      event("geo", CROSSWALK_FIXTURE.unmapped.source_url, null, CROSSWALK_FIXTURE.unmapped.geo_type),
    ], [unmappedImmo]);
    expect(unmapped.matched).toHaveLength(0);
    expect(unmapped.missed[0]?.unmatched_reason).toBe("immo_kind_hors_map");
  });

  it("should leave duplicate crosswalk candidates unpaired instead of double-counting", () => {
    const immo = parseImmoDesignationEvents([{
      city_slug: "coaticook",
      kind: "rezonage",
      date: "2026-02-10",
      source_url: "https://coaticook.ca/docs/geo.pdf",
    }])[0]!;
    const partition = partitionEventSets(
      [
        event("geo", "https://coaticook.ca/docs/geo.pdf", null, "changement-de-zonage"),
        event("geo", "https://coaticook.ca/docs/geo.pdf", null, "changement-de-zonage"),
      ],
      [immo],
    );

    expect(partition.matched).toHaveLength(0);
    expect(partition.missed).toHaveLength(1);
    expect(partition.extra).toHaveLength(2);
    expect(partition.missed[0]?.unmatched_reason).toBe("crosswalk_match_ambiguous");
  });
});

describe("setRecallFor", () => {
  it("should score duplicate exact doc-and-type events as a multiset while retaining strict recall separately", () => {
    const geo = Array.from({ length: 5 }, () => event("geo", "https://coaticook.ca/docs/shared.pdf", null));
    const immo = Array.from({ length: 3 }, () => event("immo", "https://coaticook.ca/docs/shared.pdf", null));

    const setRecall = setRecallFor(geo, immo);
    expect(setRecall).toMatchObject({
      denominator: 85,
      matched: 3,
      missed: 0,
      immo_events: 3,
      geo_events: 5,
      over_split: 2,
      recall: 3 / 85,
      precision: 3 / 5,
    });
    expect(setRecall.groups).toEqual([{
      key: {
        muni: "coaticook",
        source_url_norm: "https://coaticook.ca/docs/shared.pdf",
        date_iso: "2026-02-10",
        crosswalked_type: "ppcmoi",
      },
      immo_count: 3,
      geo_count: 5,
      matched: 3,
      over_split: 2,
    }]);
    expect(partitionEventSets(geo, immo).matched).toHaveLength(0);
  });

  it("should leave an unmapped piia immo event missed instead of creating an autre group", () => {
    const immo = parseImmoDesignationEvents([{
      city_slug: "coaticook",
      kind: "piia",
      date: "2026-02-10",
      source_url: "https://coaticook.ca/docs/piia.pdf",
    }]);
    const result = setRecallFor([
      event("geo", "https://coaticook.ca/docs/piia.pdf", null, "autre"),
    ], immo);

    expect(result).toMatchObject({
      matched: 0,
      missed: 1,
      over_split: 0,
      geo_unmatchable: 1,
      recall: 0,
      precision: 0,
      groups: [],
    });
    expect(result.missed_immo[0]?.unmatched_reason).toBe("immo_kind_hors_map");
  });
});

describe("parseCohortFile", () => {
  it("should read a plain slug list, ignoring blanks and comments", () => {
    expect(parseCohortFile("# 167 cohort\nsaint-raymond\n\n  coaticook  \n", "cohort")).toEqual([
      "saint-raymond",
      "coaticook",
    ]);
  });

  it("should read the graph_city_slug column of a TSV in preference to slug", () => {
    const tsv = [
      "priorityRank\tslug\tgraph_city_slug",
      "1\tsaint-damase\tsaint-damase--maria",
      "2\themmingford\themmingford-napierville",
    ].join("\n");
    expect(parseCohortFile(tsv, "cohort")).toEqual(["saint-damase--maria", "hemmingford-napierville"]);
  });

  it("should reject a duplicate slug rather than silently dedup", () => {
    expect(() => parseCohortFile("coaticook\ncoaticook\n", "cohort")).toThrow(/dupliqués/u);
  });

  it("should reject a slug outside [a-z0-9-]", () => {
    expect(() => parseCohortFile("Coaticook\n", "cohort")).toThrow(/slug invalide/u);
  });
});

describe("runRecallGate cohort parameterization", () => {
  it("should score a non-sample cohort slug and honour an explicit denominator", async () => {
    const outputDirectory = mkdtempSync(join(HERE, ".zoning-events-recall-gate-cohort-"));
    try {
      const geo = join(outputDirectory, "geo.json");
      writeFileSync(geo, JSON.stringify([{
        type: "FeatureCollection",
        muni: "granby",
        events: [{
          type: "ppcmoi",
          muni: "granby",
          url_pdf: "https://granby.ca/a.pdf",
          date_iso: "2026-03-01",
          bylaw_numero: null,
          zone_codes_resolus: [],
        }],
      }]));
      const immo = join(outputDirectory, "immo.json");
      writeFileSync(immo, JSON.stringify([{
        node_type: "DesignationEvent",
        city_slug: "granby",
        kind: "ppcmoi",
        date: "2026-03-01",
        source_url: "https://granby.ca/a.pdf",
        zone_ref: null,
        no_lot: null,
      }]));
      const result = await runRecallGate({
        geoEventsPath: geo,
        immoEventsPath: immo,
        cohort: ["granby"],
        denominator: 5,
        outPath: join(outputDirectory, "gate.json"),
        markdownPath: join(outputDirectory, "gate.md"),
      });

      expect(result.report.sample_municipalities).toEqual(["granby"]);
      expect(result.report.cities.map((city) => city.slug)).toEqual(["granby"]);
      const granby = result.report.cities[0]!;
      expect(granby.geo_events).toBe(1);
      expect(granby.immo_events).toBe(1);
      expect(granby.set_recall).toMatchObject({ denominator: 5, matched: 1, recall: 1 / 5 });
      expect(result.report.aggregate.set_recall).toMatchObject({ denominator: 5, matched: 1, recall: 1 / 5 });
      expect(result.report.scoring).toMatchObject({
        set_recall: "Σ_g min(immo_count[g], geo_count[g]) / 5",
        strict_recall: "unique crosswalk pairs / 5",
      });
      expect(readFileSync(result.markdownOutput, "utf8")).toContain("SET-RECALL agrégé : 1/5");
      expect(readFileSync(result.markdownOutput, "utf8")).not.toContain("matched/85");
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  });
});

describe("runRecallGate", () => {
  it("should write the local-fixture closed partition without S3 and fail its recall gate honestly", async () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "zoning-events-recall-gate-"));
    try {
      const result = await runRecallGate({
        geoEventsPath: GEO_FIXTURE,
        immoEventsPath: IMMO_FIXTURE,
        outPath: join(outputDirectory, "gate.json"),
        markdownPath: join(outputDirectory, "gate.md"),
        generatedAt: "2026-08-02T00:00:00.000Z",
      });

      expect(result.exitCode).toBe(1);
      expect(result.report.aggregate).toMatchObject({
        matched: 1,
        missed: 1,
        extra: 1,
        recall: 0.5,
        geo_read_error_count: 0,
      });
      expect(result.report.scoring.headline).toBe("set_recall");
      expect(result.report.aggregate.set_recall).toMatchObject({
        denominator: 85,
        matched: 1,
        missed: 1,
        geo_events: 2,
        over_split: 1,
        recall: 1 / 85,
        precision: 0.5,
      });
      expect(result.report.aggregate.strict_recall.recall_fixed_sample).toBe(1 / 85);
      expect(result.report.cities.find((city) => city.slug === "coaticook")?.partition.missed[0]?.immo?.natural_key.muni)
        .toBe("coaticook");
      expect(result.report.immo_zone_or_lot_population).toEqual({
        designation_events: 2,
        zone_ref: { populated: 2, null_or_unknown: 0 },
        no_lot: { populated: 1, null_or_unknown: 1 },
      });
      expect(result.report.aggregate.immo_signals_excluded).toBe(0);
      expect(existsSync(result.output)).toBe(true);
      expect(readFileSync(result.markdownOutput, "utf8")).toContain("missed coaticook");
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  });

  it("should report an honest zero-geo baseline without failing the recall threshold", async () => {
    const outputDirectory = mkdtempSync(join(HERE, ".zoning-events-recall-gate-baseline-"));
    try {
      const emptyGeo = join(outputDirectory, "empty-geo.json");
      writeFileSync(emptyGeo, JSON.stringify([
        "saint-raymond",
        "saint-stanislas",
        "sutton",
        "coaticook",
        "saint-mathieu-de-beloeil",
        "saint-eustache",
      ].map((muni) => ({ type: "FeatureCollection", muni, events: [] }))));
      const result = await runRecallGate({
        geoEventsPath: emptyGeo,
        immoEventsPath: IMMO_FIXTURE,
        outPath: join(outputDirectory, "baseline.json"),
        markdownPath: join(outputDirectory, "baseline.md"),
      });

      expect(result.exitCode).toBe(0);
      expect(result.report.gate.status).toBe("baseline_geo_not_producing_yet");
      expect(result.report.aggregate).toMatchObject({ matched: 0, missed: 2, extra: 0, recall: 0 });
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  });

  it("should load line-delimited immo JSON and exclude Signals from the DesignationEvent denominator", async () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "zoning-events-recall-gate-ndjson-"));
    try {
      const immoEvents = join(outputDirectory, "handoff.json");
      writeFileSync(immoEvents, [
        {
          node_type: "DesignationEvent",
          city_slug: "coaticook",
          kind: "ppcmoi",
          date: "2026-02-10",
          source_url: "https://coaticook.ca/docs/notice.pdf",
          zone_ref: "CO-1",
          no_lot: null,
        },
        {
          node_type: "Signal",
          city_slug: "coaticook",
          kind: "densification",
          date: "2026-02-10",
          source_url: "https://coaticook.ca/docs/notice.pdf",
          zone_ref: "CO-1",
          no_lot: null,
        },
        {
          city_slug: "coaticook",
          kind: "ppcmoi",
          date: "2026-02-10",
          source_url: "https://coaticook.ca/docs/untyped.pdf",
          zone_ref: null,
          no_lot: null,
        },
      ].map((entry) => JSON.stringify(entry)).join("\n\n"));
      const result = await runRecallGate({
        geoEventsPath: GEO_FIXTURE,
        immoEventsPath: immoEvents,
        outPath: join(outputDirectory, "gate.json"),
        markdownPath: join(outputDirectory, "gate.md"),
      });

      expect(result.report.aggregate).toMatchObject({
        matched: 0,
        missed: 1,
        extra: 2,
        immo_events: 1,
        immo_signals_excluded: 1,
        immo_node_type_missing_or_unknown: 1,
        recall: 0,
      });
      const coaticook = result.report.cities.find((city) => city.slug === "coaticook");
      expect(coaticook).toMatchObject({
        immo_events: 1,
        immo_signals_excluded: 1,
        immo_node_type_missing_or_unknown: 1,
      });
      expect(coaticook?.partition.missed[0]?.immo?.natural_key.type).toBe("ppcmoi");
      expect(result.report.states).toContain("immo_node_type_missing_or_unknown");
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  });
});
