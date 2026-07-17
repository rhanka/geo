import { describe, expect, it } from "vitest";

import { categoryFor, zoneCodeOf } from "./fold-usage-dominant.js";

describe("fold-usage-dominant zone-code selection", () => {
  it("matches a regulatory prefix on a digit-first SIG code", () => {
    const prefixes = { P: "commercial", H: "residentiel", REC: "environnemental", AAF: "agricole" } as const;

    expect(zoneCodeOf({ zone_code: "64 P" })).toBe("64 P");
    expect(categoryFor(zoneCodeOf({ zone_code: "64 P" })!, prefixes)).toBe("commercial");
    expect(categoryFor(zoneCodeOf({ zone_code: "22 H" })!, prefixes)).toBe("residentiel");
    expect(categoryFor(zoneCodeOf({ zone_code: "004-Rec" })!, prefixes)).toBe("environnemental");
    expect(categoryFor(zoneCodeOf({ zone_code: "29-Aaf" })!, prefixes)).toBe("agricole");
  });

  it("keeps an explicit raw-code map working during the prefix transition", () => {
    expect(categoryFor(zoneCodeOf({ zone_code: "22 H" })!, { "22 H": "residentiel", H: null })).toBe("residentiel");
  });

  it("keeps an already letter-first code matchable", () => {
    expect(zoneCodeOf({ zone_code: "Ra5" })).toBe("Ra5");
    expect(categoryFor(zoneCodeOf({ zone_code: "Ra5" })!, { RA: "residentiel" })).toBe("residentiel");
  });
});
