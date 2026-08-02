/** Network-free unit coverage for the qc-zoning-events recall gate. */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  parseImmoDesignationEvents,
  partitionEventSets,
  runRecallGate,
  type NaturalKeyEvent,
} from "./zoning-events-recall-gate.js";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const GEO_FIXTURE = join(HERE, "__fixtures__/zoning-events-recall-gate.geo.json");
const IMMO_FIXTURE = join(HERE, "__fixtures__/zoning-events-recall-gate.immo.json");

function event(
  side: "geo" | "immo",
  sourceUrl: string | null,
  bylawNumero: string | null,
): NaturalKeyEvent {
  return {
    side,
    natural_key: {
      muni: "coaticook",
      source_url_norm: sourceUrl,
      date_iso: "2026-02-10",
      type: "ppcmoi",
    },
    secondary_natural_key: bylawNumero === null
      ? null
      : { muni: "coaticook", bylaw_numero_norm: bylawNumero.toLowerCase(), type: "ppcmoi", date_iso: "2026-02-10" },
    source_fields: {
      event_id: side === "geo" ? "geo-id" : null,
      muni: "coaticook",
      source_url: sourceUrl,
      date_iso: "2026-02-10",
      type: "ppcmoi",
      bylaw_numero: bylawNumero,
      zone_ref: null,
      no_lot: null,
    },
  };
}

describe("parseImmoDesignationEvents", () => {
  it("should map only documented candidate fields and keep absent components null", () => {
    const [mapped, unknown] = parseImmoDesignationEvents([
      {
        city_slug: "coaticook",
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
    expect(unknown?.natural_key).toEqual({ muni: null, source_url_norm: null, date_iso: null, type: null });
    expect(unknown?.secondary_natural_key).toBeNull();
  });
});

describe("partitionEventSets", () => {
  it("should use the unique exact secondary bylaw key only after the natural key does not match", () => {
    const partition = partitionEventSets(
      [event("geo", "https://coaticook.ca/docs/geo.pdf", "CO-100")],
      [event("immo", "https://coaticook.ca/docs/immo.pdf", "CO-100")],
    );

    expect(partition.matched).toHaveLength(1);
    expect(partition.matched[0]?.match_kind).toBe("secondary_bylaw_key");
    expect(partition.missed).toHaveLength(0);
    expect(partition.extra).toHaveLength(0);
  });

  it("should leave duplicate secondary keys unpaired instead of forcing an ambiguous match", () => {
    const partition = partitionEventSets(
      [
        event("geo", "https://coaticook.ca/docs/geo-a.pdf", "CO-100"),
        event("geo", "https://coaticook.ca/docs/geo-b.pdf", "CO-100"),
      ],
      [event("immo", "https://coaticook.ca/docs/immo.pdf", "CO-100")],
    );

    expect(partition.matched).toHaveLength(0);
    expect(partition.missed).toHaveLength(1);
    expect(partition.extra).toHaveLength(2);
    expect(partition.missed[0]?.unmatched_reason).toBe("secondary_bylaw_key_ambiguous");
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
