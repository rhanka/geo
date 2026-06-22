import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * BOOT-SAFETY contract (prod crash regression guard).
 *
 * The production API bundles @geo/qc-sources into a single file and runs it with
 * plain `node`. The runtime image does NOT ship the dev `_spikes/.../samples/`
 * fixture bytes. So importing @geo/qc-sources (or any module that re-exports its
 * fixtures) MUST NOT touch the filesystem at import time — otherwise the API
 * crashes at boot with ENOENT before it can serve /health.
 *
 * These tests assert the disk-backed fixtures are LAZY: `readFileSync` is never
 * called merely by importing the module; it only runs when a fixture value is
 * actually requested (e.g. a test, or the sample-seeding route).
 */
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

const readFileSyncMock = vi.mocked(readFileSync);

afterEach(() => {
  readFileSyncMock.mockClear();
  vi.resetModules();
});

describe("source fixtures are boot-safe (no filesystem read at import)", () => {
  it("importing role-evaluation-mamh.fixture does not read from disk", async () => {
    await import("./role-evaluation-mamh.fixture.js");
    expect(readFileSyncMock).not.toHaveBeenCalled();
  });

  it("importing adresses-quebec.fixture does not read from disk", async () => {
    await import("./adresses-quebec.fixture.js");
    expect(readFileSyncMock).not.toHaveBeenCalled();
  });

  it("importing the @geo/qc-sources barrel does not read from disk", async () => {
    await import("../index.js");
    expect(readFileSyncMock).not.toHaveBeenCalled();
  });

  it("the lazy accessors still return the REAL committed bytes on demand", async () => {
    const { roleEvaluationMamhValleyfieldXml } = await import(
      "./role-evaluation-mamh.fixture.js"
    );
    const { adressesQuebecValleyfieldJson } = await import(
      "./adresses-quebec.fixture.js"
    );
    expect(roleEvaluationMamhValleyfieldXml()).toContain("4193751");
    expect(adressesQuebecValleyfieldJson()).toContain("FeatureCollection");
  });
});
