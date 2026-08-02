import { describe, expect, it } from "vitest";

import { classifyCapturedSha, lineForControlTarget } from "./served-zonage-proof-v1-v2-capture-assess.js";

const served: `sha256:${string}` = `sha256:${"a".repeat(64)}`;
const changed: `sha256:${string}` = `sha256:${"b".repeat(64)}`;

describe("served proof v1-v2 capture assessment", () => {
  it("keeps a changed fetched SHA distinct from a transport or 404 outcome", () => {
    expect(classifyCapturedSha(200, served, true, [served])).toBe("SHA_IDENTIQUE");
    expect(classifyCapturedSha(200, changed, true, [served])).toBe("SHA_DIFFERENT");
    expect(classifyCapturedSha(404, null, false, [served])).toBe("HTTP_404");
    expect(classifyCapturedSha(200, served, false, [served])).toBe("AUTRE");
  });

  it("keeps same-URL captures separate by their named collection", () => {
    const url = "https://example.test/zones.geojson";
    const lines = [
      { source: "zones-v2-verifiable", url, slugs: ["alpha"] },
      { source: "zones-v2-verifiable", url, slugs: ["beta"] },
    ];

    expect(lineForControlTarget({ slug: "alpha", source: "zones-v2-verifiable", url }, lines)).toBe(lines[0]);
    expect(lineForControlTarget({ slug: "beta", source: "zones-v2-verifiable", url }, lines)).toBe(lines[1]);
  });
});
