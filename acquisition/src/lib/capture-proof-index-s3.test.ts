import { describe, expect, it, vi } from "vitest";

import { serializeManifestLine, type CaptureManifestLine, type CaptureRunHeader } from "../../../packages/qc-sources/src/capture/index.js";
import { publishCaptureProofIndex } from "./capture-proof-index.js";
import { s3CaptureProofIndexStore } from "./capture-proof-index-s3.js";

const runId = "zones-20260810T020304Z-audet";
const manifestKey = `capture/_runs/${runId}/manifest.jsonl`;
const headerKey = `capture/_runs/${runId}/run.json`;

function line(): CaptureManifestLine {
  return {
    run_id: runId,
    lane: "zones",
    source: "zones-arcgis",
    slugs: ["audet"],
    url: "https://services.example/FeatureServer/0/query?where=1%3D1&f=geojson",
    method: "GET",
    attempt: 1,
    requested_at: "2026-08-10T02:03:04.000Z",
    retrieved_at: "2026-08-10T02:03:05.000Z",
    http_status: 200,
    redirect_chain: [],
    final_url: "https://services.example/FeatureServer/0/query?where=1%3D1&f=geojson",
    content_type: "application/geo+json",
    bytes: 123,
    sha256: `sha256:${"a".repeat(64)}`,
    storage_key: `raw/zones-arcgis/cas/${"a".repeat(64)}.geojson`,
    dedup: false,
    error: null,
    user_agent: "geo-test/1",
    via_obscura: false,
    egress: "direct",
    robots: "allowed",
    redacted: false,
  };
}

function header(): CaptureRunHeader {
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
  };
}

async function* body(bytes: Buffer): AsyncIterable<Buffer> {
  yield bytes;
}

describe("s3CaptureProofIndexStore", () => {
  it("lists only run manifests and conditionally writes the pinned snapshot", async () => {
    const stored = new Map<string, Buffer>([
      [manifestKey, Buffer.from(`${serializeManifestLine(line())}\n`)],
      [headerKey, Buffer.from(JSON.stringify(header()))],
    ]);
    const s3 = {
      send: vi.fn(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        if (command.constructor.name === "ListObjectsV2Command") {
          return { Contents: [{ Key: manifestKey }, { Key: headerKey }, { Key: "capture/_runs/x/spool/body" }] };
        }
        if (command.constructor.name === "GetObjectCommand") {
          const key = command.input["Key"] as string;
          return { Body: body(stored.get(key)!) };
        }
        if (command.constructor.name === "PutObjectCommand") {
          const key = command.input["Key"] as string;
          expect(command.input["IfNoneMatch"]).toBe("*");
          stored.set(key, Buffer.from(command.input["Body"] as Buffer));
          return {};
        }
        throw new Error(`unexpected ${command.constructor.name}`);
      }),
    };

    const published = await publishCaptureProofIndex(s3CaptureProofIndexStore(s3 as never));

    expect(published.key).toMatch(/^capture\/_index\/by-sha256\/[a-f0-9]{64}\.jsonl$/);
    expect(stored.get(published.key)!.toString("utf8")).toContain('"run_id":"zones-20260810T020304Z-audet"');
    expect(s3.send.mock.calls.filter(([command]) => command.constructor.name === "GetObjectCommand"))
      .toHaveLength(2);
  });
});
