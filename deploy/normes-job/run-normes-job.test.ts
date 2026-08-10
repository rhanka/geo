import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const entrypoint = readFileSync(new URL("./run-normes-job.sh", import.meta.url), "utf8");

describe("normes captured job entrypoint", () => {
  it("treats a durable bridge refusal as a successful Kubernetes completion", () => {
    expect(entrypoint).toContain('if [ "$bridge_status" -eq 2 ]; then');
    expect(entrypoint).toContain("captured extraction refused with durable S3 receipt");
  });
});
