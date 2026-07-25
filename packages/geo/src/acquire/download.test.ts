import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { download, sha256Hex } from "./download.js";

describe("download cache", () => {
  let cacheDir: string;

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), "geo-acquire-dl-"));
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  function fakeFetch(body: string): typeof fetch {
    return vi.fn(async () =>
      new Response(body, { status: 200, statusText: "OK" }),
    ) as unknown as typeof fetch;
  }

  it("misses then hits the cache, with a stable sha256", async () => {
    const url = "https://example.test/data.geojson";
    const body = '{"type":"FeatureCollection","features":[]}';
    const fetchImpl = fakeFetch(body);

    const first = await download(url, { cacheDir, fetchImpl });
    expect(first.fromCache).toBe(false);
    expect(first.text()).toBe(body);
    expect(first.sha256).toBe(sha256Hex(body));

    const second = await download(url, { cacheDir, fetchImpl });
    expect(second.fromCache).toBe(true);
    expect(second.sha256).toBe(first.sha256);
    expect(second.text()).toBe(body);

    // Network was used exactly once (second served from disk).
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("re-fetches when force is set", async () => {
    const url = "https://example.test/data.geojson";
    const fetchImpl = fakeFetch("payload");

    await download(url, { cacheDir, fetchImpl });
    const forced = await download(url, { cacheDir, fetchImpl, force: true });

    expect(forced.fromCache).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws on a non-ok response", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("nope", { status: 404, statusText: "Not Found" }),
    ) as unknown as typeof fetch;

    await expect(
      download("https://example.test/missing", { cacheDir, fetchImpl }),
    ).rejects.toThrow(/404/);
  });
});
