import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isStale, parseIso8601Duration, refresh, type LedgerEntry } from "./refresh.js";
import type { FetchResult } from "./fetch.js";

describe("parseIso8601Duration", () => {
  it("parses common durations to ms", () => {
    expect(parseIso8601Duration("P1Y")).toBe(365 * 86_400_000);
    expect(parseIso8601Duration("P30D")).toBe(30 * 86_400_000);
    expect(parseIso8601Duration("PT1H")).toBe(3_600_000);
  });
  it("returns null for non-durations", () => {
    expect(parseIso8601Duration("annual")).toBeNull();
    expect(parseIso8601Duration("P")).toBeNull();
  });
});

describe("isStale", () => {
  const now = new Date("2026-06-13T00:00:00Z");
  it("is stale when never fetched", () => {
    expect(isStale({ manifestRef: "x#y" }, now)).toBe(true);
  });
  it("is stale when cadence elapsed", () => {
    const e: LedgerEntry = { manifestRef: "x#y", lastFetchedAt: "2024-01-01T00:00:00Z", updateCadence: "P1Y" };
    expect(isStale(e, now)).toBe(true);
  });
  it("is fresh within cadence", () => {
    const e: LedgerEntry = { manifestRef: "x#y", lastFetchedAt: "2026-06-01T00:00:00Z", updateCadence: "P1Y" };
    expect(isStale(e, now)).toBe(false);
  });
});

describe("refresh", () => {
  let dir: string;
  const now = new Date("2026-06-13T00:00:00Z");

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "geo-cli-req-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function fakeFetch(): typeof import("./fetch.js").fetchSource {
    return vi.fn(
      async (sourceId: string, datasetId: string | undefined): Promise<FetchResult> => ({
        outDir: "/tmp/out",
        datasets: [
          {
            sourceId,
            datasetId: datasetId ?? "all",
            count: 5,
            license: "cc-by-4.0",
            attribution: "© test",
            geojsonPath: "/tmp/out/x.geojson",
            metaPath: "/tmp/out/x.meta.json",
          },
        ],
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ) as any;
  }

  it("refreshes only stale entries with --stale and updates the ledger", async () => {
    const stalePath = join(dir, "ca-qc__qc-regions.json");
    const freshPath = join(dir, "ca-qc__qc-mrc.json");
    await writeFile(
      stalePath,
      JSON.stringify({ manifestRef: "ca-qc/sda#qc-regions", lastFetchedAt: "2020-01-01T00:00:00Z", updateCadence: "P1Y" }),
    );
    await writeFile(
      freshPath,
      JSON.stringify({ manifestRef: "ca-qc/sda#qc-mrc", lastFetchedAt: "2026-06-12T00:00:00Z", updateCadence: "P1Y" }),
    );

    const fetchSource = fakeFetch();
    const result = await refresh({ stale: true, requestsDir: dir, now }, { fetchSource });

    const byRef = Object.fromEntries(result.entries.map((e) => [e.manifestRef, e]));
    expect(byRef["ca-qc/sda#qc-regions"]?.refreshed).toBe(true);
    expect(byRef["ca-qc/sda#qc-mrc"]?.refreshed).toBe(false);
    expect(fetchSource).toHaveBeenCalledTimes(1);
    expect(fetchSource).toHaveBeenCalledWith("ca-qc/sda", "qc-regions", {}, expect.anything());

    // The stale ledger entry was rewritten with a new lastFetchedAt.
    const updated = JSON.parse(await readFile(stalePath, "utf8")) as LedgerEntry;
    expect(updated.lastFetchedAt).toBe(now.toISOString());
    expect(updated.status).toBe("fetched");
  });

  it("refreshes every entry without --stale", async () => {
    await writeFile(
      join(dir, "a.json"),
      JSON.stringify({ manifestRef: "ca-qc/sda#qc-regions", lastFetchedAt: "2026-06-12T00:00:00Z", updateCadence: "P1Y" }),
    );
    const fetchSource = fakeFetch();
    const result = await refresh({ requestsDir: dir, now }, { fetchSource });
    expect(result.entries[0]?.refreshed).toBe(true);
    expect(fetchSource).toHaveBeenCalledTimes(1);
  });

  it("returns empty when the requests dir is missing", async () => {
    const result = await refresh({ requestsDir: join(dir, "nope"), now }, { fetchSource: fakeFetch() });
    expect(result.entries).toEqual([]);
  });
});
