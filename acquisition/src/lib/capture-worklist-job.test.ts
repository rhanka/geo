/** Preuve locale du contrat produit par le Job de capture, sans réseau ni S3. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CaptureRun,
  captureWorklist,
  parseManifestJsonl,
  type CaptureFetchLike,
  type CaptureHttpResponse,
  type CaptureObjectStore,
} from "../../../packages/qc-sources/src/capture/index.js";
import { RobotsCache } from "../../../packages/qc-sources/src/sources/robots-txt.js";
import { capturedRobotsFetch } from "../capture-worklist-run.js";
import { jobManifest, kubectlApplyArgs, parseArgs } from "../k8s-capture-run.js";
import { verifyRawCapturePayload } from "./zone-provenance-raw-capture.js";
import { captureReceiptFromManifest } from "./zone-provenance-quality.js";

function fakeStore(): CaptureObjectStore & {
  objects: Map<string, { body: Uint8Array | string; contentType?: string }>;
  puts: string[];
} {
  const objects = new Map<string, { body: Uint8Array | string; contentType?: string }>();
  const puts: string[] = [];
  return {
    objects,
    puts,
    head: async (key) => objects.has(key),
    put: async (key, body, contentType) => {
      puts.push(key);
      objects.set(key, { body, ...(contentType === undefined ? {} : { contentType }) });
    },
  };
}

function response(status: number, body = "", contentType = "application/json"): CaptureHttpResponse {
  const bytes = new TextEncoder().encode(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => name.toLowerCase() === "content-type" ? contentType : null },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  };
}

describe("capture worklist job contract", () => {
  it("declares a non-root image and a writable scratch group in the submitted Job", () => {
    const args = {
      lane: "normes" as const,
      worklistPath: "/tmp/worklist.json",
      kubeconfig: "/tmp/ovh.conf",
      shards: 1,
      concurrency: 1,
      image: "registry.example/geo-capture:test",
      allowUnpinnedImage: false,
      namespace: "geo",
      runStamp: "20260726T120000Z",
      delayMs: 0,
      maxBytes: 1024,
      memoryLimitMi: 176,
      egress: "direct" as const,
      dryRun: false,
      laneGatedCapture: false,
    };
    const manifest = jobManifest(args, "registry/capture-worklists/normes-20260726T120000Z.json");
    expect(manifest).toContain("securityContext:\n        # The capture image declares USER 1000:1000. EmptyDir is\n        # mounted at /scratch for its redacted temporary log, so grant that\n        # group ownership before the non-root entrypoint starts.\n        fsGroup: 1000\n        runAsNonRoot: true");
    expect(manifest).toContain("memory: 176Mi");
    expect(manifest).toContain("memory: 120Mi");
    expect(manifest).toContain("cpu: 60m");
    expect(manifest).toContain("cpu: 150m");

    expect(jobManifest({ ...args, memoryLimitMi: 512 }, "registry/capture-worklists/normes-20260726T120000Z.json"))
      .toContain("memory: 512Mi");

    const dockerfile = readFileSync(resolve(import.meta.dirname, "../../../deploy/capture-job/Dockerfile"), "utf8");
    expect(dockerfile).toContain("USER 1000:1000");
    const template = readFileSync(resolve(import.meta.dirname, "../../../deploy/capture-job/job-capture.yaml"), "utf8");
    expect(template).toContain("memory: 176Mi");
    expect(template).toContain("memory: 120Mi");
    expect(template).toContain("cpu: 60m");
    expect(template).toContain("cpu: 150m");
  });

  it("accepts an explicit memory limit for a single-pod large-body recovery", () => {
    expect(parseArgs([
      "--lane", "zones", "--worklist", "/tmp/worklist.json", "--kubeconfig", "/tmp/ovh.conf",
      "--memory-limit-mi", "512",
    ])).toMatchObject({ memoryLimitMi: 512 });
  });

  it("passes the explicit kubeconfig and namespace to kubectl", () => {
    expect(kubectlApplyArgs({ kubeconfig: "/tmp/ovh.conf", namespace: "geo" })).toEqual([
      "--kubeconfig", "/tmp/ovh.conf", "-n", "geo", "apply", "-f", "-",
    ]);
  });

  it("produit une capture joinable par la mesure v2 et conserve le 404 sans CAS", async () => {
    const store = fakeStore();
    const run = new CaptureRun({
      runId: "zones-20260726T120000Z-0-testpod",
      lane: "zones",
      store,
      userAgent: "sentropic-geo/0.1",
      execution: "cluster",
      worklist: "registry/capture-worklists/zones-20260726T120000Z.json",
      echo: null,
    });
    const okUrl = "https://services3.arcgis.com/example/FeatureServer/0/query?f=geojson";
    const failedUrl = "https://ville.example/absent.geojson";
    const fetchImpl: CaptureFetchLike = async (url) => {
      if (url === okUrl) return response(200, '{"type":"FeatureCollection","features":[]}');
      if (url === failedUrl) return response(404, "not found", "text/plain");
      throw new Error(`URL inattendue: ${url}`);
    };

    await captureWorklist({
      run,
      targets: [
        { slug: "mont-saint-hilaire", source: "zones-arcgis", urls: [okUrl] },
        { slug: "saint-frederic", source: "zones-arcgis", urls: [failedUrl] },
      ],
      delayMs: 0,
      wait: async () => undefined,
      fetchImpl,
    });
    await run.finish(0);

    const lines = parseManifestJsonl(String(store.objects.get(run.keys.manifest)!.body));
    expect(lines).toHaveLength(2);
    const receipt = captureReceiptFromManifest(lines[0]!, run.keys.manifest, 0);
    expect(receipt).not.toBeNull();
    const raw = store.objects.get(receipt!.storage_key)!;
    const meta = JSON.parse(String(store.objects.get(`${receipt!.storage_key}.meta.json`)!.body));
    expect(verifyRawCapturePayload(receipt!, raw.body as Uint8Array, meta)).toMatchObject({
      verified: true,
      reason: null,
    });

    // L'échec est une donnée durable de manifeste, sans octet ni preuve joinable.
    expect(lines[1]).toMatchObject({ http_status: 404, sha256: null, storage_key: null });
    expect(captureReceiptFromManifest(lines[1]!, run.keys.manifest, 1)).toBeNull();
    expect(store.puts.filter((key) => key.startsWith("raw/"))).toHaveLength(2); // CAS + sidecar seulement.
    expect(store.objects.has(run.keys.log)).toBe(true);
    expect(store.objects.has(run.keys.header)).toBe(true);
  });

  it("capture aussi robots.txt puis respecte un Disallow sans fetcher la cible", async () => {
    const store = fakeStore();
    const run = new CaptureRun({
      runId: "zones-20260726T120000Z-0-testpod",
      lane: "zones",
      store,
      userAgent: "sentropic-geo/0.1",
      execution: "cluster",
      echo: null,
    });
    const targetUrl = "https://ville.example/prive/zones.geojson";
    const robotsUrl = "https://ville.example/robots.txt";
    const robotsTransport: CaptureFetchLike = async (url) => {
      if (url !== robotsUrl) throw new Error(`robots URL inattendue: ${url}`);
      return response(200, "User-agent: *\nDisallow: /prive\n", "text/plain");
    };
    let targetCalls = 0;
    const targetFetch: CaptureFetchLike = async () => {
      targetCalls++;
      return response(200, "should-not-be-called");
    };
    const robots = new RobotsCache({
      userAgent: "sentropic-geo/0.1",
      fetchImpl: capturedRobotsFetch(run, robotsTransport),
      log: (message) => run.log(message),
    });

    const result = await captureWorklist({
      run,
      targets: [{ slug: "saint-frederic", source: "zones-arcgis", urls: [targetUrl] }],
      delayMs: 0,
      fetchImpl: targetFetch,
      robots,
    });
    await run.finish(0);

    expect(targetCalls).toBe(0);
    expect(result).toMatchObject({ attempted: 1, succeeded: 0, failed: 1, durable: 0 });
    const lines = parseManifestJsonl(String(store.objects.get(run.keys.manifest)!.body));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ source: "robots-txt", http_status: 200, storage_key: expect.stringContaining("raw/robots-txt/cas/") });
    expect(lines[1]).toMatchObject({ source: "zones-arcgis", robots: "disallowed", error: "robots-disallowed", sha256: null });
  });
});
