import { describe, expect, it } from "vitest";

import { parseZonesArcgisReplacementWorklist } from "./lib/zones-arcgis-replacement-worklist.js";
import {
  jobManifest,
  parseArgs,
  replacementCaptureRunId,
  replacementCaptureWorklistKey,
} from "./zones-arcgis-replacement-capture-submit.js";

const IMAGE = "ghcr.io/rhanka/geo-capture@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const worklist = parseZonesArcgisReplacementWorklist({
  contract: "zones-arcgis-replacement/v1",
  targets: [{
    slug: "audet",
    source: "zones-arcgis",
    layer: "https://services.example/FeatureServer/0",
    municipality_filter: { field: "MUNICIPAL", value: "Audet" },
    zone_field: "ZONE",
    max_distance_km: 8,
  }],
});

describe("ArcGIS replacement cluster submitter", () => {
  const args = parseArgs([
    "--worklist", "/tmp/audet.json", "--kubeconfig", "/tmp/ovh.kubeconfig", "--image", IMAGE,
    "--run-stamp", "20260810T020304Z", "--git-sha", "a".repeat(40),
  ]);

  it("requires a digest-pinned image and preserves one city in the run identity", () => {
    expect(() => parseArgs(["--worklist", "/tmp/w.json", "--kubeconfig", "/tmp/k", "--image", "ghcr.io/rhanka/geo-capture:latest"]))
      .toThrow(/@sha256/);
    expect(replacementCaptureRunId(worklist, args.runStamp)).toBe("zones-20260810T020304Z-audet");
    expect(replacementCaptureWorklistKey(worklist, args.runStamp)).toMatch(
      /^registry\/capture-worklists\/zones-arcgis-replacement\/audet-20260810T020304Z-[a-f0-9]{16}\.json$/,
    );
  });

  it("submits a no-retry capture-only Job with exact receipt inputs", () => {
    const key = replacementCaptureWorklistKey(worklist, args.runStamp);
    const manifest = jobManifest(args, key, worklist);
    expect(manifest).toContain("backoffLimit: 0");
    expect(manifest).toContain("CAPTURE_RUNNER\n              value: \"src/zones-arcgis-replacement-capture-run.ts\"");
    expect(manifest).toContain("WORKLIST_SHA256");
    expect(manifest).toContain("RUN_ID\n              value: \"zones-20260810T020304Z-audet\"");
    expect(manifest).toContain("geo.run-id: \"zones-20260810T020304Z-audet\"");
    expect(manifest).toContain("GEO_CAPTURE_EXECUTION\n              value: \"cluster\"");
    expect(manifest).toContain("NODE_OPTIONS\n              value: \"--dns-result-order=ipv4first\"");
    expect(manifest).toContain("AWS_MAX_ATTEMPTS\n              value: \"10\"");
    expect(manifest).toContain("memory: 512Mi");
    expect(manifest).toContain(IMAGE);
  });
});
