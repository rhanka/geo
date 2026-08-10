/** Network-free unit coverage for the col-20 per-city artifact generator. */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildCol20Artifact, col20Markdown } from "./zoning-events-cohort-col20.js";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));

function geoDoc(muni: string, events: readonly Record<string, unknown>[]): Record<string, unknown> {
  return { type: "FeatureCollection", muni, events };
}

function geoEvent(muni: string, url: string, date: string, type = "ppcmoi"): Record<string, unknown> {
  return { type, muni, url_pdf: url, date_iso: date, bylaw_numero: null, zone_codes_resolus: [] };
}

describe("buildCol20Artifact", () => {
  it("should measure a city with immo ground truth and mark a geo-only city immo-gt-pending", async () => {
    const dir = mkdtempSync(join(HERE, ".col20-measured-"));
    try {
      const geo = join(dir, "geo.json");
      writeFileSync(geo, JSON.stringify([
        geoDoc("granby", [geoEvent("granby", "https://granby.ca/a.pdf", "2026-03-01")]),
        geoDoc("sutton", [geoEvent("sutton", "https://sutton.ca/b.pdf", "2026-03-02")]),
      ]));
      const immo = join(dir, "immo.json");
      writeFileSync(immo, JSON.stringify([{
        node_type: "DesignationEvent",
        city_slug: "granby",
        kind: "ppcmoi",
        date: "2026-03-01",
        source_url: "https://granby.ca/a.pdf",
        zone_ref: null,
        no_lot: null,
      }]));

      const { artifact } = await buildCol20Artifact(
        { cohort: ["granby", "sutton"], cohortSource: "test", geoEventsPath: geo, immoEventsPath: immo, generatedAt: "2026-08-03T00:00:00.000Z" },
        join(dir, "audit"),
      );

      expect(artifact.rows).toEqual([
        {
          slug: "granby",
          geo_events_count: 1,
          immo_gt_available: true,
          immo_gt_events: 1,
          matched: 1,
          recall_pct_si_mesurable: 1,
          statut: "measured",
        },
        {
          slug: "sutton",
          geo_events_count: 1,
          immo_gt_available: false,
          immo_gt_events: 0,
          matched: 0,
          recall_pct_si_mesurable: null,
          statut: "immo-gt-pending",
        },
      ]);
      expect(artifact.summary).toMatchObject({
        measured: 1,
        measured_geo_empty: 0,
        immo_gt_pending: 1,
        geo_events_total: 2,
        cities_with_geo_events: 2,
        immo_gt_events_total: 1,
        matched_total: 1,
      });
      expect(col20Markdown(artifact)).toContain("| granby | 1 | oui | 1/1 | 100.0 % | measured |");
      expect(col20Markdown(artifact)).toContain("immo-gt-pending");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("should mark every city immo-gt-pending when no immo handoff is provided", async () => {
    const dir = mkdtempSync(join(HERE, ".col20-pending-"));
    try {
      const geo = join(dir, "geo.json");
      writeFileSync(geo, JSON.stringify([
        geoDoc("granby", [geoEvent("granby", "https://granby.ca/a.pdf", "2026-03-01")]),
        geoDoc("coaticook", []),
      ]));

      const { artifact } = await buildCol20Artifact(
        { cohort: ["granby", "coaticook"], cohortSource: "test", geoEventsPath: geo, generatedAt: "2026-08-03T00:00:00.000Z" },
        join(dir, "audit"),
      );

      expect(artifact.rows.map((row) => row.statut)).toEqual(["immo-gt-pending", "immo-gt-pending"]);
      expect(artifact.rows.map((row) => row.recall_pct_si_mesurable)).toEqual([null, null]);
      expect(artifact.summary).toMatchObject({ immo_gt_pending: 2, measured: 0, geo_events_total: 1, cities_with_geo_events: 1 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("should mark a city with immo ground truth but no emitted geo events measured-geo-empty", async () => {
    const dir = mkdtempSync(join(HERE, ".col20-empty-"));
    try {
      const geo = join(dir, "geo.json");
      writeFileSync(geo, JSON.stringify([geoDoc("granby", [])]));
      const immo = join(dir, "immo.json");
      writeFileSync(immo, JSON.stringify([{
        node_type: "DesignationEvent",
        city_slug: "granby",
        kind: "ppcmoi",
        date: "2026-03-01",
        source_url: "https://granby.ca/a.pdf",
        zone_ref: null,
        no_lot: null,
      }]));

      const { artifact } = await buildCol20Artifact(
        { cohort: ["granby"], cohortSource: "test", geoEventsPath: geo, immoEventsPath: immo, generatedAt: "2026-08-03T00:00:00.000Z" },
        join(dir, "audit"),
      );

      expect(artifact.rows[0]).toMatchObject({
        geo_events_count: 0,
        immo_gt_available: true,
        immo_gt_events: 1,
        matched: 0,
        recall_pct_si_mesurable: 0,
        statut: "measured-geo-empty",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
