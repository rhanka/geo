import { describe, expect, it } from "vitest";

import { readReadyPvRealUniverse } from "./pv-graphify-real-universe.js";

describe("readReadyPvRealUniverse", () => {
  it("selects the complete READY universe rather than the initial balanced batch", () => {
    const universe = {
      contract: "pv-graphify-semantic-real-universe/v1",
      batch: {
        selected_documents: [{ storage_key: "batch-only" }],
      },
      real_universe: {
        documents: [
          {
            storage_key: "cas-ready-1",
            source_status: "READY",
            slug: "alpha",
            municipality_name: "Alpha",
            url: "https://example.test/alpha.pdf",
          },
          {
            storage_key: "cas-unscoped",
            source_status: "NO_TERMINAL_PV_MANIFEST",
          },
          {
            storage_key: "cas-ready-2",
            source_status: "READY",
            slug: "bravo",
            municipality_name: "Bravo",
            url: "https://example.test/bravo.pdf",
          },
        ],
      },
    };

    expect(readReadyPvRealUniverse(universe, "fixture").map((document) => document.storage_key))
      .toEqual(["cas-ready-1", "cas-ready-2"]);
  });
});
