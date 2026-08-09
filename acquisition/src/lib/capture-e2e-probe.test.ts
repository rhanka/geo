import { describe, expect, it } from "vitest";

import { runIdsFromManifestKeys } from "../_capture-e2e-probe.js";

describe("runIdsFromManifestKeys", () => {
  it("keeps only manifests belonging to the requested immutable run prefix", () => {
    expect(runIdsFromManifestKeys([
      "capture/_runs/zones-20260727T211700Z-0-a/manifest.jsonl",
      "capture/_runs/zones-20260727T211700Z-1-b/manifest.jsonl",
      "capture/_runs/zones-20260727T211700Z-1-b/run.json",
      "capture/_runs/zones-20260727T211701Z-0-c/manifest.jsonl",
    ], "zones-20260727T211700Z-")).toEqual([
      "zones-20260727T211700Z-0-a",
      "zones-20260727T211700Z-1-b",
    ]);
  });
});
