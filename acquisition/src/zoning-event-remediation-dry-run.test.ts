import { describe, expect, it } from "vitest";

import { assertZoningEventRemediationDryRunArgs } from "./zoning-event-remediation-dry-run.js";

describe("zoning-event-remediation dry-run CLI", () => {
  it("has no apply/publish escape hatch", () => {
    expect(() => assertZoningEventRemediationDryRunArgs([
      "--audit=work/coverage/audit.json",
      "--inventory=work/coverage/inventory.json",
      "--output=work/coverage/dry-run.json",
      "--concurrency=4",
    ])).not.toThrow();
    expect(() => assertZoningEventRemediationDryRunArgs(["--apply=true"])).toThrow(/inconnue\/interdite/);
    expect(() => assertZoningEventRemediationDryRunArgs(["--publish=true"])).toThrow(/inconnue\/interdite/);
  });
});
