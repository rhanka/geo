import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { isUsableNormsSourceUrl } from "./zonage-norms-source-url.js";

describe("isUsableNormsSourceUrl", () => {
  it("rejects the https non-disponible sentinel that caused a fetch failure", () => {
    expect(isUsableNormsSourceUrl("https://non-disponible")).toBe(false);
  });

  it("accepts Chelsea's official Annex 2 download endpoint", () => {
    const munis = JSON.parse(readFileSync(new URL("../../../work/zonage-norms/munis.json", import.meta.url), "utf8")) as {
      munis: Array<{ slug: string; sourceUrl?: string }>;
    };
    const chelsea = munis.munis.find((entry) => entry.slug === "chelsea");
    expect(chelsea?.sourceUrl).toBe("https://www.chelsea.ca/download_file/view/8284/279");
    expect(isUsableNormsSourceUrl(chelsea?.sourceUrl)).toBe(true);
  });
});
