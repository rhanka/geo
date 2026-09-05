import { describe, it, expect } from "vitest";
import { readTileKey } from "./session-mint.js";

describe("readTileKey (fail-closed)", () => {
  it("throws when the key is absent or blank", () => {
    expect(() => readTileKey({})).toThrow(/GOOGLE_TILE_KEY absent/);
    expect(() => readTileKey({ GOOGLE_TILE_KEY: "   " })).toThrow(/GOOGLE_TILE_KEY absent/);
  });
  it("returns the trimmed key when set", () => {
    expect(readTileKey({ GOOGLE_TILE_KEY: " k123 " })).toBe("k123");
  });
});
