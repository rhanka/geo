/**
 * t1-georef.test.ts — regression guard for the large-GeoPDF hardening.
 *
 * A very large règlement GeoPDF (e.g. cantley 2020) used to throw
 * `Invalid string length` because `inflatePdfText` concatenated every inflated
 * stream + the whole raw file into one latin1 string past V8's ~512 MB cap.
 * These pure-function tests prove the assembler now (1) skips oversized drawing
 * streams without stringifying them, (2) still keeps the tiny georef dict
 * streams, (3) bounds the assembled string, and (4) yields a clean null (→ the
 * caller ABORTS) instead of throwing when a big PDF carries no parseable georef.
 */
import zlib from "node:zlib";

import { describe, it, expect } from "vitest";

import { inflatePdfText, extractGeoRef } from "./t1-georef.js";

function pdfWithStream(payload: Buffer, tail = ""): Buffer {
  const z = zlib.deflateSync(payload);
  return Buffer.concat([
    Buffer.from("%PDF-1.5\n1 0 obj\n<< >>\nstream\n"),
    z,
    Buffer.from("\nendstream\nendobj\n"),
    Buffer.from(tail, "latin1"),
  ]);
}

// A ~1 km neatline so the affine page→projected fit is sub-metre (as real
// municipal GeoPDFs are), matching the "georef-perfect ~0.00 m" targets.
const GEO_TAIL =
  "/VP [ << /BBox [0 0 100 100] /Measure << /Subtype /GEO " +
  "/Bounds [0 0 0 1 1 1 1 0] /GPTS [45.50 -73.50 45.51 -73.50 45.51 -73.49 45.50 -73.49] " +
  '/GCS << /WKT (PROJCS["NAD83 / MTM 8",PROJECTION["Transverse_Mercator"],' +
  'PARAMETER["Central_Meridian",-73.5],PARAMETER["Latitude_Of_Origin",0],' +
  'PARAMETER["Scale_Factor",0.9999],PARAMETER["False_Easting",304800],' +
  'PARAMETER["False_Northing",0]]) >> >> >> ] /MediaBox [0 0 100 100]';

describe("inflatePdfText — anti Invalid string length", () => {
  it("skips an oversized drawing stream without throwing, keeps raw georef markers", () => {
    const payload = Buffer.alloc(2_000_000, 0x20); // 2 MB of spaces, no georef marker
    const buf = pdfWithStream(payload, GEO_TAIL);
    // maxInflateBytes below the payload → the big stream is skipped, never stringified.
    const hay = inflatePdfText(buf, { maxInflateBytes: 4096 });
    expect(hay).toContain("/GPTS"); // raw georef preserved
    expect(hay.length).toBeLessThan(200_000); // the 2 MB drawing stream is excluded
  });

  it("keeps a georef-bearing inflated object stream", () => {
    const objstm = Buffer.from(
      "<< /Subtype /GEO /Bounds [0 0 0 1 1 1 1 0] /GPTS [45 -73 46 -73 46 -72 45 -72] >>",
    );
    const hay = inflatePdfText(pdfWithStream(objstm, "/MediaBox [0 0 100 100]"));
    expect(hay).toContain("/GPTS");
  });

  it("bounds the assembled string to maxChars (no unbounded concat)", () => {
    const parts: Buffer[] = [Buffer.from("%PDF-1.5\n")];
    for (let k = 0; k < 20; k++) {
      const objstm = Buffer.concat([Buffer.from("/GPTS marker "), Buffer.alloc(50_000, 0x41)]);
      parts.push(Buffer.from("stream\n"), zlib.deflateSync(objstm), Buffer.from("\nendstream\n"));
    }
    const hay = inflatePdfText(Buffer.concat(parts), { maxChars: 10_000 });
    expect(hay.length).toBeLessThanOrEqual(10_000);
  });

  it("returns null (clean abort) on a large non-georef PDF instead of throwing", () => {
    const buf = pdfWithStream(Buffer.alloc(3_000_000, 0x20), "/MediaBox [0 0 100 100]");
    expect(() => extractGeoRef(buf)).not.toThrow();
    expect(extractGeoRef(buf)).toBeNull();
  });

  it("still extracts embedded georef from a small GeoPDF (no regression)", () => {
    const geo = extractGeoRef(pdfWithStream(Buffer.from("draw ops"), GEO_TAIL));
    expect(geo).not.toBeNull();
    expect(geo!.maxResidualM).toBeLessThan(2);
  });
});
