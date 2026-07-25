import { describe, expect, it } from "vitest";
import { attributionLine, canRedistribute, resolveLicense } from "./license.js";

describe("resolveLicense", () => {
  it("resolves the CKAN 'cc-by' alias to CC-BY 4.0", () => {
    const license = resolveLicense("cc-by");
    expect(license.id).toBe("cc-by-4.0");
    expect(license.redistributable).toBe(true);
    expect(license.attributionRequired).toBe(true);
  });

  it("is case-insensitive and trims", () => {
    expect(resolveLicense("  CC-BY-4.0 ").id).toBe("cc-by-4.0");
  });

  it("defaults unknown identifiers to the conservative non-redistributable license", () => {
    const license = resolveLicense("some-bespoke-terms");
    expect(license.id).toBe("unknown");
    expect(license.redistributable).toBe(false);
  });

  it("passes through an inline License object", () => {
    const inline = {
      id: "cc0-1.0" as const,
      title: "CC0",
      redistributable: true,
      attributionRequired: false,
    };
    expect(resolveLicense(inline)).toBe(inline);
  });
});

describe("canRedistribute", () => {
  it("is true for open licenses and false for proprietary/unknown", () => {
    expect(canRedistribute("cc-by")).toBe(true);
    expect(canRedistribute("ogl-ca")).toBe(true);
    expect(canRedistribute("proprietary")).toBe(false);
    expect(canRedistribute(undefined)).toBe(false);
  });
});

describe("attributionLine", () => {
  it("includes the provider and license when attribution is required", () => {
    const line = attributionLine("Gouvernement du Québec", resolveLicense("cc-by"));
    expect(line).toContain("Gouvernement du Québec");
    expect(line).toContain("Attribution");
  });

  it("returns just the provider when attribution is not required", () => {
    expect(attributionLine("Acme", resolveLicense("cc0"))).toBe("Acme");
  });
});
