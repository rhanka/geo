/**
 * Golden test for the T1 cadastre-aggregation port (t1-zones.ts).
 *
 * The Python legacy producer (`work/legacy-geo-quebec/saint-mathieu/
 * build_zones.py`) was run on saint-mathieu's georeferenced labels
 * (`code_points_wgs84.json`) + cadastre (`cadastre.geojson`) and produced
 * `zones_stats.json`. This test runs the TypeScript port on the SAME inputs and
 * asserts it reproduces the golden stats — proving the anti-Python port is
 * faithful (the critical T1 recipe).
 *
 * Inputs are large (cadastre 41 MB) and live under `work/legacy-geo-quebec/`,
 * which is deliberately gitignored (.gitignore) — this is an INTEGRATION test
 * that only runs on a checkout carrying the local legacy dataset. When a fixture
 * is missing the whole suite is EXPLICITLY skipped (loud warning naming the
 * missing files); it is never silently passed. Note that vitest still executes a
 * `describe.skipIf` factory at collection time, so the fixtures are read LAZILY
 * inside `beforeAll` — otherwise the skipped suite would still crash on ENOENT.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { FeatureCollection } from "geojson";
import { describe, it, expect, beforeAll } from "vitest";

import {
  buildZones,
  SAINT_MATHIEU_LAT0,
  type CodePoint,
  type T1Stats,
} from "./t1-zones.js";

const LEGACY = resolve(
  __dirname,
  "../../../work/legacy-geo-quebec/saint-mathieu",
);
const FIXTURES = [
  `${LEGACY}/cadastre.geojson`,
  `${LEGACY}/code_points_wgs84.json`,
  `${LEGACY}/zones_stats.json`,
];
const missingFixtures = FIXTURES.filter((p) => !existsSync(p));
const haveFixtures = missingFixtures.length === 0;

if (!haveFixtures) {
  console.warn(
    `[SKIP] t1-zones.test.ts — integration test requiring the local legacy ` +
      `dataset work/legacy-geo-quebec/ (gitignored, ~40 MB). Missing fixture(s): ` +
      `${missingFixtures.join(", ")}.`,
  );
}

describe.skipIf(!haveFixtures)("T1 cadastre-aggregation — saint-mathieu golden", () => {
  let stats: T1Stats;
  let golden: T1Stats;

  beforeAll(() => {
    const cadastre = JSON.parse(
      readFileSync(`${LEGACY}/cadastre.geojson`, "utf8"),
    ) as FeatureCollection;
    const codePoints = JSON.parse(
      readFileSync(`${LEGACY}/code_points_wgs84.json`, "utf8"),
    ) as CodePoint[];
    golden = JSON.parse(
      readFileSync(`${LEGACY}/zones_stats.json`, "utf8"),
    ) as T1Stats;

    stats = buildZones(cadastre, codePoints, {
      lat0: SAINT_MATHIEU_LAT0,
      cutoffM: 1500,
      dissolve: false, // stats are union-free; geometry dissolve tested separately
    }).stats;
  }, 600_000); // 41 MB de cadastre + agrégation : bien au-delà du timeout par défaut

  it("reproduces the code-point inventory exactly", () => {
    expect(stats.n_lots_total).toBe(golden.n_lots_total);
    expect(stats.n_code_points).toBe(golden.n_code_points);
    expect(stats.n_distinct_codes).toBe(golden.n_distinct_codes);
    expect(stats.n_multi_spot_codes).toBe(golden.n_multi_spot_codes);
    expect(stats.multi_spot_codes).toEqual(golden.multi_spot_codes);
  });

  it("reproduces the nearest-label assignment exactly", () => {
    expect(stats.n_lots_assigned).toBe(golden.n_lots_assigned);
    expect(stats.n_lots_unassigned).toBe(golden.n_lots_unassigned);
    expect(stats.n_lots_unassigned_1000m).toBe(golden.n_lots_unassigned_1000m);
    expect(stats.n_lots_unassigned_1500m).toBe(golden.n_lots_unassigned_1500m);
    expect(stats.n_zone_features).toBe(golden.n_zone_features);
    expect(stats.n_empty_labels).toBe(golden.n_empty_labels);
  });

  it("reproduces the distance distribution", () => {
    // min/median/p90/max are bit-exact (GEOS interior-point parity); the mean
    // matches to <1cm over 24 532 lots (a handful hit a degenerate widest-
    // interval tie giving a cm-level interior point, never a different label).
    expect(stats.dist_m.min).toBeCloseTo(golden.dist_m.min, 6);
    expect(stats.dist_m.median).toBeCloseTo(golden.dist_m.median, 6);
    expect(stats.dist_m.p90).toBeCloseTo(golden.dist_m.p90, 6);
    expect(stats.dist_m.max).toBeCloseTo(golden.dist_m.max, 6);
    expect(stats.dist_m.mean).toBeCloseTo(golden.dist_m.mean, 2);
  });

  it("reproduces the areas (1e-3 km²)", () => {
    expect(stats.total_cadastre_area_km2).toBeCloseTo(golden.total_cadastre_area_km2, 3);
    expect(stats.total_zoned_area_km2).toBeCloseTo(golden.total_zoned_area_km2, 3);
    expect(stats.pct_area_covered).toBeCloseTo(golden.pct_area_covered, 1);
  });

  it("reproduces per-feature lot counts and areas", () => {
    const key = (s: { zone_code: string; n_lots: number }): string =>
      `${s.zone_code}#${s.n_lots}`;
    const goldByKey = new Map<string, number>();
    for (const s of golden.per_feature) goldByKey.set(key(s), s.area_km2);
    expect(stats.per_feature.length).toBe(golden.per_feature.length);
    let matched = 0;
    for (const s of stats.per_feature) {
      const g = goldByKey.get(key(s));
      if (g !== undefined) {
        expect(s.area_km2).toBeCloseTo(g, 2);
        matched++;
      }
    }
    // Every feature must line up by (zone_code, n_lots).
    expect(matched).toBe(stats.per_feature.length);
  });
});
