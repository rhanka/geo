import { describe, expect, it } from "vitest";

import {
  serializeManifestLine,
  type CaptureManifestLine,
  type CaptureRunHeader,
} from "../../../packages/qc-sources/src/capture/index.js";
import {
  captureProofIndexEntryFromManifest,
  hasCaptureProof,
  materializeCaptureProofIndex,
  parseCaptureProofIndex,
  serializeCaptureProofIndex,
} from "./capture-proof-index.js";

const url = "https://services.example/FeatureServer/0/query?where=1%3D1&f=geojson";
const sha256 = `sha256:${"a".repeat(64)}` as const;

function line(overrides: Partial<CaptureManifestLine> = {}): CaptureManifestLine {
  return {
    run_id: "zones-20260810T020304Z-audet",
    lane: "zones",
    source: "zones-arcgis",
    slugs: ["audet"],
    url,
    method: "GET",
    attempt: 1,
    requested_at: "2026-08-10T02:03:04.000Z",
    retrieved_at: "2026-08-10T02:03:05.000Z",
    http_status: 200,
    redirect_chain: [],
    final_url: url,
    content_type: "application/geo+json",
    bytes: 123,
    sha256,
    storage_key: `raw/zones-arcgis/cas/${"a".repeat(64)}.geojson`,
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

function header(runId: string, overrides: Partial<CaptureRunHeader> = {}): CaptureRunHeader {
  return {
    run_id: runId,
    lane: "zones",
    execution: "cluster",
    git_sha: "a".repeat(40),
    worklist: "registry/capture-worklists/zones/test.json",
    started_at: "2026-08-10T02:03:04.000Z",
    finished_at: "2026-08-10T02:03:06.000Z",
    exit_code: 0,
    user_agent: "geo-test/1",
    egress: "direct",
    via_obscura: false,
    counts: { attempts: 1, ok: 1, failed: 0, dedup: 0, bytes: 123 },
    ...overrides,
  };
}

describe("capture proof index", () => {
  it("projects a successful durable manifest row into a canonical tuple", () => {
    const entry = captureProofIndexEntryFromManifest(line(), "capture/_runs/zones-20260810T020304Z-audet/manifest.jsonl", 4);
    expect(entry).toMatchObject({ url, sha256, manifest_line: 4, run_id: "zones-20260810T020304Z-audet" });
    const bytes = serializeCaptureProofIndex([entry!]);
    expect(parseCaptureProofIndex(Buffer.from(bytes))).toEqual([entry]);
    expect(hasCaptureProof([entry!], { url, retrieved_at: entry!.retrieved_at, sha256 })).toBe(true);
    expect(hasCaptureProof([entry!], { url, retrieved_at: "2026-08-10T02:03:06.000Z", sha256 })).toBe(false);
  });

  it("does not index failures, redactions, non-CAS rows, or malformed source receipts", () => {
    for (const candidate of [
      line({ http_status: 404 }), line({ error: "HTTP 404" }), line({ redacted: true }),
      line({ robots: "unknown" }), line({ storage_key: null }), line({ sha256: null }), line({ retrieved_at: "not-a-date" }),
    ]) {
      expect(captureProofIndexEntryFromManifest(candidate, "capture/_runs/zones-run/manifest.jsonl", 0)).toBeNull();
    }
  });

  it("refuses non-canonical or duplicate index bytes", () => {
    const entry = captureProofIndexEntryFromManifest(line(), "capture/_runs/zones-20260810T020304Z-audet/manifest.jsonl", 0)!;
    const canonical = serializeCaptureProofIndex([entry]);
    expect(() => parseCaptureProofIndex(Buffer.from(`${canonical}${JSON.stringify(entry)}\n`))).toThrow(/duplicate/);
    const reordered = {
      sha256: entry.sha256,
      url: entry.url,
      retrieved_at: entry.retrieved_at,
      run_id: entry.run_id,
      manifest_key: entry.manifest_key,
      manifest_line: entry.manifest_line,
      storage_key: entry.storage_key,
    };
    expect(() => parseCaptureProofIndex(Buffer.from(`${JSON.stringify(reordered)}\n`))).toThrow(/not canonical/);
  });

  it("reconstructs a deterministic index from durable manifests only", async () => {
    const firstKey = "capture/_runs/zones-20260810T020304Z-a/manifest.jsonl";
    const secondKey = "capture/_runs/zones-20260810T020304Z-z/manifest.jsonl";
    const first = line({ run_id: "zones-20260810T020304Z-a" });
    const second = line({ run_id: "zones-20260810T020304Z-z" });
    const bytes = await materializeCaptureProofIndex({
      // Deliberately reverse the listing: the projection must choose `firstKey`.
      listManifestKeys: async () => [secondKey, firstKey],
      getBytes: async (key) => key.endsWith("/manifest.jsonl")
        ? Buffer.from(`${serializeManifestLine(key === firstKey ? first : second)}\n`)
        : Buffer.from(JSON.stringify(header(key.includes("-a/") ? first.run_id : second.run_id))),
    });
    expect(parseCaptureProofIndex(Buffer.from(bytes))).toEqual([
      expect.objectContaining({ manifest_key: firstKey, run_id: first.run_id, url, sha256 }),
    ]);
  });

  it("fails closed on a manifest outside the durable run namespace", async () => {
    await expect(materializeCaptureProofIndex({
      listManifestKeys: async () => ["work/manifest.jsonl"],
      getBytes: async () => Buffer.from(""),
    })).rejects.toThrow(/unexpected manifest key/);
  });

  it("refuses a manifest whose run is not a completed cluster capture", async () => {
    const key = "capture/_runs/zones-20260810T020304Z-audet/manifest.jsonl";
    await expect(materializeCaptureProofIndex({
      listManifestKeys: async () => [key],
      getBytes: async (requested) => requested === key
        ? Buffer.from(`${serializeManifestLine(line())}\n`)
        : Buffer.from(JSON.stringify(header("zones-20260810T020304Z-audet", { execution: "local" }))),
    })).rejects.toThrow(/not a completed cluster capture/);
  });
});
