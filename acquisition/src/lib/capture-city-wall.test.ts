import { describe, expect, it } from "vitest";

import { classifyCaptureCityWalls } from "./capture-city-wall.js";

const target = {
  slug: "albanel",
  source: "zones-v1-proof-url",
  urls: ["https://source.example.test/zones.geojson"],
};

function line(overrides: Record<string, unknown> = {}) {
  return {
    run_id: "zones-20260810T004157Z-0-pod",
    lane: "zones" as const,
    source: target.source,
    slugs: [target.slug],
    url: target.urls[0],
    method: "GET" as const,
    attempt: 1,
    requested_at: "2026-08-10T00:41:57.000Z",
    retrieved_at: "2026-08-10T00:41:58.000Z",
    http_status: 200,
    redirect_chain: [],
    final_url: target.urls[0],
    content_type: "application/geo+json",
    bytes: 12,
    sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    storage_key: "raw/zones-v1-proof-url/cas/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json",
    dedup: false,
    error: null,
    user_agent: "test",
    via_obscura: false,
    egress: "direct",
    robots: "allowed" as const,
    redacted: false,
    ...overrides,
  };
}

describe("capture city wall classification", () => {
  it("should retain the v2 capture tuple when the cluster received bytes", () => {
    expect(classifyCaptureCityWalls([target], [line()])).toMatchObject([{
      slug: "albanel",
      outcome: "captured-v2-input",
      observations: [{
        run_id: "zones-20260810T004157Z-0-pod",
        retrieved_at: "2026-08-10T00:41:58.000Z",
        sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }],
    }]);
  });

  it("should retain an explicit HTTP 404 wall rather than treating it as captured", () => {
    expect(classifyCaptureCityWalls([target], [line({
      http_status: 404,
      retrieved_at: null,
      content_type: "text/html",
      bytes: null,
      sha256: null,
      storage_key: null,
      dedup: null,
      error: "HTTP 404",
    })])).toMatchObject([{
      slug: "albanel",
      outcome: "wall-http-404",
      observations: [{ outcome: "wall-http-404", sha256: null }],
    }]);
  });

  it("should fail closed when a submitted URL has no manifest observation", () => {
    expect(() => classifyCaptureCityWalls([target], [])).toThrow("exactly one observation");
  });
});
