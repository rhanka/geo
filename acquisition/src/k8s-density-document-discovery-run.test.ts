import { describe, expect, it } from "vitest";

import {
  densityWorklistKey,
  jobManifest,
  kubectlApplyArgs,
  parseArgs,
} from "./k8s-density-document-discovery-run.js";

const args = {
  worklistPath: "/repo/acquisition/config/lot-01.json",
  kubeconfig: "/home/user/.kube/ovh.conf",
  namespace: "geo",
  image: "registry.example/geo-capture:test",
  concurrency: 1,
  memoryLimitMi: 480,
  runStamp: "20260728T120000Z",
  gitSha: "a".repeat(40),
  dryRun: false,
};

describe("k8s density document discovery orchestrator", () => {
  it("should submit one indexed completion per slug with no local monitor", () => {
    const manifest = jobManifest(args, "registry/capture-worklists/lot.json", 2, 12);
    expect(manifest).toContain("completionMode: Indexed");
    expect(manifest).toContain("completions: 12");
    expect(manifest).toContain("parallelism: 1");
    expect(manifest).toContain("src/density-document-discovery-run.ts");
    expect(manifest).toContain("memory: 480Mi");
  });

  it("should force the IPv4/S3 retry environment and a stable browser UA", () => {
    const manifest = jobManifest(args, "registry/capture-worklists/lot.json", 1, 8);
    expect(manifest).toContain('value: "--dns-result-order=ipv4first"');
    expect(manifest).toContain('value: "10"');
    expect(manifest).toContain("Mozilla/5.0");
  });

  it("should use an immutable baseline-derived S3 key", () => {
    expect(densityWorklistKey("b".repeat(64), 3))
      .toBe("registry/capture-worklists/normes-density-bbbbbbbbbbbbbbbb-lot-03.json");
  });

  it("should pass the explicit cluster identity to kubectl", () => {
    expect(kubectlApplyArgs(args)).toEqual([
      "--kubeconfig", "/home/user/.kube/ovh.conf", "-n", "geo", "apply", "-f", "-",
    ]);
  });

  it("should reject an unsafe concurrency or malformed stamp before submission", () => {
    expect(() => parseArgs([
      "--worklist", "/tmp/lot.json",
      "--kubeconfig", "/tmp/kube.conf",
      "--git-sha", "a".repeat(40),
      "--run-stamp", "bad",
    ])).toThrow(/run-stamp/);
    expect(() => parseArgs([
      "--worklist", "/tmp/lot.json",
      "--kubeconfig", "/tmp/kube.conf",
      "--git-sha", "a".repeat(40),
      "--run-stamp", "20260728T120000Z",
      "--concurrency", "3",
    ])).toThrow(/concurrency/);
  });
});
