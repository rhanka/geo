import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { captureRunKeys, serializeManifestLine, type CaptureManifestLine } from "../../../packages/qc-sources/src/capture/index.js";
import { parseZonesArcgisReplacementWorklist, serializeZonesArcgisReplacementWorklist } from "./zones-arcgis-replacement-worklist.js";
import { verifyZonesArcgisReplacementReceipt, type ReplacementReceiptReader } from "./zones-arcgis-replacement-receipt.js";

const runId = "zones-20260810T020304Z-audet";
const captureGitSha = "a".repeat(40);
const worklistKey = "registry/capture-worklists/zones-arcgis-replacement/audet-20260810T020304Z-0123456789abcdef.json";
const worklist = parseZonesArcgisReplacementWorklist({
  contract: "zones-arcgis-replacement/v1",
  targets: [{
    slug: "audet",
    source: "zones-arcgis" as const,
    layer: "https://services.example/FeatureServer/0",
    municipality_filter: { field: "MUNICIPAL", value: "Audet" },
    zone_field: "ZONE",
    max_distance_km: 8,
    allow_deprecated: [],
  }],
});
const expectedUrl = "https://services.example/FeatureServer/0/query?where=MUNICIPAL%20%3D%20%27Audet%27&outFields=ZONE&outSR=4326&geometryPrecision=6&resultOffset=0&resultRecordCount=20000&f=geojson";
const payload = Buffer.from(JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [-70, 45] }, properties: { ZONE: "A-1" } }] }));
const digest = createHash("sha256").update(payload).digest("hex");
const worklistBytes = Buffer.from(serializeZonesArcgisReplacementWorklist(worklist));
const worklistSha256 = `sha256:${createHash("sha256").update(worklistBytes).digest("hex")}` as const;
const storageKey = `raw/zones-arcgis/cas/${digest}.json`;

function targetLine(overrides: Partial<CaptureManifestLine> = {}): CaptureManifestLine {
  return {
    run_id: runId,
    lane: "zones",
    source: "zones-arcgis",
    slugs: ["audet"],
    url: expectedUrl,
    method: "GET",
    attempt: 1,
    requested_at: "2026-08-10T02:03:04.000Z",
    retrieved_at: "2026-08-10T02:03:05.000Z",
    http_status: 200,
    redirect_chain: [],
    final_url: expectedUrl,
    content_type: "application/geo+json",
    bytes: payload.length,
    sha256: `sha256:${digest}`,
    storage_key: storageKey,
    dedup: false,
    error: null,
    user_agent: "geo-test/1",
    via_obscura: false,
    egress: "direct",
    robots: "allowed",
    redacted: false,
    ...overrides,
  };
}

function reader(overrides: Record<string, Buffer> = {}): ReplacementReceiptReader {
  const keys = captureRunKeys(runId);
  const objects: Record<string, Buffer> = {
    [worklistKey]: worklistBytes,
    [keys.header]: Buffer.from(JSON.stringify({
      run_id: runId, lane: "zones", execution: "cluster", git_sha: captureGitSha, worklist: worklistKey,
      started_at: "2026-08-10T02:03:04.000Z", finished_at: "2026-08-10T02:03:06.000Z", exit_code: 0,
      user_agent: "geo-test/1", egress: "direct", via_obscura: false,
      counts: { attempts: 2, ok: 2, failed: 0, dedup: 0, bytes: payload.length },
    })),
    [keys.manifest]: Buffer.from(`${serializeManifestLine(targetLine())}\n`),
    [keys.log]: Buffer.from("capture completed\n"),
    [storageKey]: payload,
    [`${storageKey}.meta.json`]: Buffer.from(JSON.stringify({
      sourceUrl: expectedUrl, sha256: digest, fetchedAt: "2026-08-10T02:03:05.000Z", storageKey,
      provenance: { version: "capturedFetch/1", userAgent: "geo-test/1", viaObscura: false },
    })),
    ...overrides,
  };
  return { getBytes: async (key) => {
    const value = objects[key];
    if (!value) throw new Error(`missing ${key}`);
    return value;
  } };
}

const input = {
  runId, worklistKey, worklistSha256, captureGitSha,
  completedJob: { runId, succeeded: 1, failed: 0, completionTime: "2026-08-10T02:03:06.000Z" },
};

describe("zones ArcGIS replacement deposit receipt", () => {
  it("requires the completed cluster Job, canonical worklist, run triplet and byte-identical CAS", async () => {
    const verified = await verifyZonesArcgisReplacementReceipt(reader(), input);
    expect(verified.proof).toMatchObject({ url: expectedUrl, retrieved_at: "2026-08-10T02:03:05.000Z", sha256: `sha256:${digest}` });
    expect(verified.capture.storage_key).toBe(storageKey);
    expect(verified.geojson.features).toHaveLength(1);
  });

  it("refuses the declarative run.json alone when the Kubernetes Job did not succeed", async () => {
    await expect(verifyZonesArcgisReplacementReceipt(reader(), {
      ...input, completedJob: { ...input.completedJob, failed: 1 },
    })).rejects.toThrow(/Kubernetes capture Job/);
  });

  it("refuses a target row with a different URL, unknown robots verdict, or altered CAS", async () => {
    const keys = captureRunKeys(runId);
    const manifest = (line: CaptureManifestLine) => ({ [keys.manifest]: Buffer.from(`${serializeManifestLine(line)}\n`) });
    await expect(verifyZonesArcgisReplacementReceipt(reader(manifest(targetLine({ url: "https://services.example/FeatureServer/0/query?where=1%3D1" }))), input)).rejects.toThrow(/exact successful/);
    await expect(verifyZonesArcgisReplacementReceipt(reader(manifest(targetLine({ robots: "unknown" }))), input)).rejects.toThrow(/exact successful/);
    await expect(verifyZonesArcgisReplacementReceipt(reader({ [storageKey]: Buffer.from("tampered") }), input)).rejects.toThrow(/raw CAS receipt/);
  });
});
