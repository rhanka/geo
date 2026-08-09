import { describe, expect, it } from "vitest";

import { selectCaptureWorklistWindow } from "./served-zonage-proof-v1-v2-capture-scope.js";

describe("served proof v1-v2 capture scope", () => {
  it("keeps the first worklist targets when the default offset is zero", () => {
    const worklist = [
      { slug: "alpha", source: "zones-v1-proof-url", urls: ["https://data.example.test/a.geojson"] },
      { slug: "beta", source: "zones-v1-proof-url", urls: ["https://data.example.test/b.geojson"] },
    ];

    expect(selectCaptureWorklistWindow(worklist, 0, 1)).toEqual([worklist[0]]);
  });
});
