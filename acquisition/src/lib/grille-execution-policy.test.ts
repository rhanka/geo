import { describe, expect, it } from "vitest";

import { pageLimitForNativeFirstRoute } from "./grille-execution-policy.js";

describe("pageLimitForNativeFirstRoute", () => {
  it("does not let a zero paid budget throttle the native-only pass", () => {
    expect(pageLimitForNativeFirstRoute(47, 0.001, 0, true)).toBe(47);
  });

  it("keeps the paid route within its budget-derived page cap", () => {
    expect(pageLimitForNativeFirstRoute(47, 0.01, 0.05, false)).toBe(5);
  });

  it("never returns more pages than the caller selected", () => {
    expect(pageLimitForNativeFirstRoute(3, 0.01, 2, false)).toBe(3);
  });
});
