import { describe, expect, it } from "vitest";

import { DEFAULT_IMAGE, jobManifest, jobName } from "./k8s-captured-normes-run.js";

describe("captured normes Mistral job", () => {
  const referenceKey = "registry/normes-captured-references/run-123/1.json";
  const image = "rg.fr-par.scw.cloud/sentropic-geo/normes-job:test";

  it("defaults to the published captured-Mistral bridge image", () => {
    expect(DEFAULT_IMAGE).toBe("rg.fr-par.scw.cloud/sentropic-geo/normes-job:captured-mistral-ba5b1b69");
  });

  it("derives a stable DNS-safe job name from the exact reference and image", () => {
    expect(jobName(referenceKey, image)).toMatch(/^geo-normes-mistral-[a-f0-9]{20}$/);
    expect(jobName(referenceKey, image)).toBe(jobName(referenceKey, image));
    expect(jobName(referenceKey, image)).not.toBe(jobName(referenceKey, `${image}-fixed`));
  });

  it("uses only the captured bridge, S3 and Mistral secret references", () => {
    const manifest = jobManifest({
      referenceKey,
      kubeconfig: "/tmp/ovh.kubeconfig",
      image,
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
