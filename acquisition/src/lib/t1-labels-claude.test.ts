import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { GeoRef } from "./t1-georef.js";
import { extractLabelsClaude, loadClaudeReads } from "./t1-labels-claude.js";

function fakeGeo(): GeoRef {
  return {
    bbox: [0, 0, 100, 100],
    pageW: 100,
    pageH: 100,
    proj4def: "epsg:4326",
    crsName: "test",
    corners: [],
    maxResidualM: 0,
    scaleMPerPt: 1,
    pageToLonLat: (x, y) => [x / 100, y / 100],
    topLeftToLonLat: (x, yTopDown) => [x / 100, (100 - yTopDown) / 100],
  };
}

describe("t1-labels-claude", () => {
  it("loads both { labels:[...] } and bare [...] read files", () => {
    const dir = mkdtempSync(join(tmpdir(), "claude-reads-"));
    const a = join(dir, "a.json");
    const b = join(dir, "b.json");
    writeFileSync(a, JSON.stringify({ labels: [{ code: "4-V", x: 0.1, y: 0.2 }] }));
    writeFileSync(b, JSON.stringify([{ code: "13-I", x: 0.3, y: 0.4 }]));
    expect(loadClaudeReads(a)).toEqual([{ text: "4-V", x: 0.1, y: 0.2 }]);
    expect(loadClaudeReads(b)).toEqual([{ text: "13-I", x: 0.3, y: 0.4 }]);
  });

  it("DICT is authority: accepts a single-digit-prefix code the heuristic would drop", () => {
    // "4-V" / "1-AF" fail the lettered-prefix ZONE_CODE_RE, but they are verbatim
    // in the by-law grille dict, so the lane must keep them (the glyph-recalage fix).
    const res = extractLabelsClaude(
      [
        { text: "4-V", x: 0.25, y: 0.25 },
        { text: "1-AF", x: 0.5, y: 0.5 },
      ],
      fakeGeo(),
      ["4-V", "1-AF", "11-R"],
    );
    expect(res.codePoints.map((p) => p.code).sort()).toEqual(["1-AF", "4-V"]);
    expect(res.nValidated).toBe(2);
    expect(res.nRejected).toBe(0);
    expect(res.ocr_engine).toBe("claude-4.8-vision");
  });

  it("rejects a cadastral lot number that is not a real zone code", () => {
    // "35-P" passes the generic regex but is NOT in the dict → dropped, never kept.
    const res = extractLabelsClaude(
      [
        { text: "35-P", x: 0.2, y: 0.2 },
        { text: "12-R", x: 0.6, y: 0.6 },
      ],
      fakeGeo(),
      ["12-R", "13-I"],
    );
    expect(res.codePoints.map((p) => p.code)).toEqual(["12-R"]);
    expect(res.rejectSamples).toContain("not-in-dictionary:1");
  });
});
