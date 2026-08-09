import { describe, expect, it } from "vitest";

import {
  DEFAULT_CAPTURE_USER_AGENT,
  captureUserAgentFromEnv,
} from "./capture-s3.js";

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

describe("captureUserAgentFromEnv", () => {
  it("uses a deterministic browser User-Agent when CAPTURE_USER_AGENT is absent or blank", () => {
    expect(DEFAULT_CAPTURE_USER_AGENT).toBe(BROWSER_USER_AGENT);
    expect(captureUserAgentFromEnv({})).toBe(BROWSER_USER_AGENT);
    expect(captureUserAgentFromEnv({ CAPTURE_USER_AGENT: "   " })).toBe(BROWSER_USER_AGENT);
  });

  it("uses the explicitly configured CAPTURE_USER_AGENT after trimming it", () => {
    expect(captureUserAgentFromEnv({ CAPTURE_USER_AGENT: "  Municipality-compatible UA/1.0  " })).toBe(
      "Municipality-compatible UA/1.0",
    );
  });
});
