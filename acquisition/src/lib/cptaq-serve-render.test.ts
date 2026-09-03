import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  cptaqServeJobName,
  cptaqServeRunSlug,
  renderCptaqServeJob,
  K8S_LABEL_VALUE_MAX,
} from "./cptaq-serve-render.js";

// The REAL committed template — the exact artifact k8s applies. Reading it here couples
// the test to the template: a placeholder rename without a render update fails this test.
const TEMPLATE_PATH = fileURLToPath(
  new URL("../../../deploy/constraints/cptaq-serve-job.yaml", import.meta.url),
);
const tmpl = readFileSync(TEMPLATE_PATH, "utf8");

// A representative LONG run stamp — the exact shape that broke `kubectl apply` (the
// derived pod `job-name` label exceeded 63 chars).
const LONG_RUN = "constraints-20260901T131718Z-0-542687d9-0d5d-4d82-ba23-85fb18e35108";
const RAW_KEY = `raw/cptaq/cas/${"a".repeat(64)}.bin`;
const MANIFEST_KEY = `capture/_runs/${LONG_RUN}/manifest.jsonl`;
const params = { runStamp: LONG_RUN, rawCasKey: RAW_KEY, captureManifestKey: MANIFEST_KEY };

/** All k8s label VALUES in a rendered manifest (matches `key: "value"` and `key: value`). */
function labelValues(yaml: string): string[] {
  const out: string[] = [];
  for (const m of yaml.matchAll(/\b(?:geo\.run|geo\.stage|app\.kubernetes\.io\/component):\s*"?([^",}\n]+)"?/g)) {
    out.push(m[1]!.trim());
  }
  return out;
}

describe("cptaqServeRunSlug / cptaqServeJobName", () => {
  it("slug is 12 lowercase hex, deterministic", () => {
    expect(cptaqServeRunSlug(LONG_RUN)).toMatch(/^[0-9a-f]{12}$/);
    expect(cptaqServeRunSlug(LONG_RUN)).toBe(cptaqServeRunSlug(LONG_RUN));
  });
  it("job name is bounded ≤63 even for the long run stamp that broke apply", () => {
    // Documents the exact bug: the naive `cptaq-serve-<runStamp>` overflowed 63.
    expect(`cptaq-serve-${LONG_RUN}`.length).toBeGreaterThan(K8S_LABEL_VALUE_MAX);
    expect(cptaqServeJobName(LONG_RUN).length).toBeLessThanOrEqual(K8S_LABEL_VALUE_MAX);
    expect(cptaqServeJobName(LONG_RUN)).toBe(`cptaq-serve-${cptaqServeRunSlug(LONG_RUN)}`);
  });
});

describe("renderCptaqServeJob (deployability contract)", () => {
  const out = renderCptaqServeJob(tmpl, params);

  it("metadata.name ≤63 (= the auto job-name pod label bound)", () => {
    const name = out.match(/^\s*name:\s*(\S+)/m)?.[1];
    expect(name).toBe(cptaqServeJobName(LONG_RUN));
    expect(name!.length).toBeLessThanOrEqual(K8S_LABEL_VALUE_MAX);
  });

  it("every label value ≤63", () => {
    const values = labelValues(out);
    expect(values.length).toBeGreaterThan(0);
    for (const v of values) expect(v.length).toBeLessThanOrEqual(K8S_LABEL_VALUE_MAX);
  });

  it("no REPLACE_* placeholder survives", () => {
    expect(out).not.toMatch(/REPLACE_/);
  });

  it("full run identity kept in the run-id annotation", () => {
    expect(out).toContain(`geo.sentropic/run-id: "${LONG_RUN}"`);
  });

  it("proof-bound keys substituted verbatim", () => {
    expect(out).toContain(RAW_KEY);
    expect(out).toContain(MANIFEST_KEY);
  });

  it("is deterministic", () => {
    expect(renderCptaqServeJob(tmpl, params)).toBe(out);
  });

  it("throws on an unsubstituted placeholder rather than shipping it", () => {
    expect(() => renderCptaqServeJob("name: cptaq-serve-REPLACE_JOB_SLUG\nx: REPLACE_MISSING", params))
      .toThrow(/unsubstituted placeholder REPLACE_MISSING/);
  });
});
