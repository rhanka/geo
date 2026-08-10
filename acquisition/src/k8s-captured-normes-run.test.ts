import { describe, expect, it } from "vitest";

import { jobManifest, jobName } from "./k8s-captured-normes-run.js";

describe("captured normes Mistral job", () => {
  const referenceKey = "registry/normes-captured-references/run-123/1.json";

  it("derives a stable DNS-safe job name from the exact reference", () => {
    expect(jobName(referenceKey)).toMatch(/^geo-normes-mistral-[a-f0-9]{20}$/);
    expect(jobName(referenceKey)).toBe(jobName(referenceKey));
  });

  it("uses only the captured bridge, S3 and Mistral secret references", () => {
    const manifest = jobManifest({
      referenceKey,
      kubeconfig: "/tmp/ovh.kubeconfig",
      image: "rg.fr-par.scw.cloud/sentropic-geo/normes-job:test",
      namespace: "geo",
      budgetUsd: 5,
    });
    expect(manifest).toContain('value: "captured"');
    expect(manifest).toContain(`value: "${referenceKey}"`);
    expect(manifest).toContain("name: mistral-credentials");
    expect(manifest).toContain("name: geo-s3-credentials");
    expect(manifest).toContain('value: "--dns-result-order=ipv4first"');
    expect(manifest).toContain('value: "10"');
    expect(manifest).not.toContain("MODE=full");
    expect(manifest).not.toContain("zonage-norms-batch");
  });
});
