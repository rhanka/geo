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

import { inflatePdfText, extractGeoRef, viewportGeoRefs } from "./t1-georef.js";

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

/**
 * A `/VP` array element may be an INDIRECT reference (`/VP [ 141 0 R ]`) instead
 * of an inline `<< … >>` dict — both are legal per ISO 32000. The walker only
 * split inline dicts, so an indirect viewport yielded ZERO georefs and t1-build
 * ABORTed with "no /VP /Measure /GEO georeferencing found" on a PDF that carries
 * a perfectly good one.
 *
 * MEASURED (2026-07-17, shard 0/1): `sainte-justine-de-newton` — a real municipal
 * GeoPDF (ANNEXE A, règlement 414, `/Subtype /GEO`, WKT `NAD_1983_CSRS_MTM_8`
 * = EPSG 2950, `/Subtype /RL` absent so NOT the §2.1 CAD false positive) was
 * classed "not a GeoPDF" and pushed onto the chamfer/T3 raster lane, where it
 * failed. The georef was there all along. This is a silent FALSE NEGATIVE, and
 * likely transverse to every plan exported by the same toolchain.
 */
describe("viewportGeoRefs — a /VP element may be an INDIRECT reference", () => {
  const MEASURE =
    "/Measure << /Subtype /GEO /Bounds [0 0 0 1 1 1 1 0] " +
    "/GPTS [45.50 -73.50 45.51 -73.50 45.51 -73.49 45.50 -73.49] " +
    '/GCS << /WKT (PROJCS["NAD83 / MTM 8",PROJECTION["Transverse_Mercator"],' +
    'PARAMETER["Central_Meridian",-73.5],PARAMETER["Latitude_Of_Origin",0],' +
    'PARAMETER["Scale_Factor",0.9999],PARAMETER["False_Easting",304800],' +
    'PARAMETER["False_Northing",0]]) >> >>';

  it("resolves `/VP [ N 0 R ]` (the sainte-justine-de-newton false negative)", () => {
    const hay =
      "/VP [ 141 0 R ] /MediaBox [0 0 100 100]\n" +
      `141 0 obj\n<< /BBox [0 0 100 100] ${MEASURE} >>\nendobj\n`;
    const vps = viewportGeoRefs(hay);
    expect(vps).toHaveLength(1);
    expect(vps[0]!.bbox).toEqual([0, 0, 100, 100]);
    expect(vps[0]!.gpts).toHaveLength(8);
    expect(vps[0]!.wkt).toContain("PROJCS");
  });

  it("still splits inline viewport dicts (no regression)", () => {
    const vps = viewportGeoRefs(GEO_TAIL);
    expect(vps).toHaveLength(1);
    expect(vps[0]!.gpts).toHaveLength(8);
  });

  it("handles a MIXED array: inline dict + indirect ref side by side", () => {
    const hay =
      `/VP [ << /BBox [0 0 50 50] ${MEASURE} >> 141 0 R ] /MediaBox [0 0 100 100]\n` +
      `141 0 obj\n<< /BBox [0 0 100 100] ${MEASURE} >>\nendobj\n`;
    const vps = viewportGeoRefs(hay);
    expect(vps).toHaveLength(2);
    expect(vps.map((v) => v.bbox[2])).toEqual([50, 100]);
  });
});

/**
 * The viewport an indirect `/VP [ 141 0 R ]` points at is very often NOT a
 * top-level `141 0 obj … endobj`: it lives inside a COMPRESSED OBJECT STREAM
 * (`/Type /ObjStm`, PDF 1.5+). Once inflated, those objects lose the
 * `N 0 obj … endobj` syntax entirely — they are just bodies concatenated behind
 * a `num offset num offset …` header — so `resolveObj()` found nothing and the
 * indirect-ref fix above could not fire.
 *
 * MEASURED (2026-07-17, shard 0/1): a corpus sweep of 446 plan PDFs
 * (`_zones-geopdf-falseneg-sweep.ts`) found **39 files with `/Subtype /GEO` but
 * ZERO readable viewports**, versus 40 readable ones — the parser was blind to
 * HALF the embedded-georef gisement. Affected slugs include sacre-coeur,
 * saint-polycarpe, saint-clet, bonaventure, duhamel, ogden, rawdon, oka.
 *
 * Fix: re-emit an ObjStm's objects in `N 0 obj … endobj` form at inflate time,
 * so every downstream reader (resolveObj, viewportGeoRefs, geoMeasures) works
 * unchanged.
 */
describe("inflatePdfText — objects compressed in an /ObjStm are re-emitted", () => {
  const MEASURE_OBJ =
    "<< /GCS 143 0 R /Bounds [0 0 0 1 1 1 1 0] " +
    "/GPTS [45.50 -73.50 45.51 -73.50 45.51 -73.49 45.50 -73.49] /Subtype /GEO /Type /Measure >>";
  const GCS_OBJ =
    '<< /EPSG 2950 /Type /PROJCS /WKT (PROJCS["NAD83 / MTM 8",PROJECTION["Transverse_Mercator"],' +
    'PARAMETER["Central_Meridian",-73.5],PARAMETER["Latitude_Of_Origin",0],' +
    'PARAMETER["Scale_Factor",0.9999],PARAMETER["False_Easting",304800],' +
    'PARAMETER["False_Northing",0]]) >>';

  /** Build a real PDF 1.5 object stream: `num off num off …` header, then bodies. */
  function objStmPdf(objects: Array<[number, string]>, tail: string): Buffer {
    let body = "";
    const pairs: string[] = [];
    for (const [num, src] of objects) {
      pairs.push(`${num} ${body.length}`);
      body += src + "\n";
    }
    const header = pairs.join(" ") + "\n";
    const payload = Buffer.from(header + body, "latin1");
    const dict = `<< /Type /ObjStm /N ${objects.length} /First ${header.length} /Filter /FlateDecode >>`;
    return Buffer.concat([
      Buffer.from(`%PDF-1.5\n5 0 obj\n${dict}\nstream\n`, "latin1"),
      zlib.deflateSync(payload),
      Buffer.from(`\nendstream\nendobj\n${tail}`, "latin1"),
    ]);
  }

  const VIEWPORT_OBJ = "<< /BBox [0 0 100 100] /Measure 142 0 R /Type /Viewport >>";

  it("reads the georef when viewport+measure+GCS are ALL inside an /ObjStm", () => {
    const buf = objStmPdf(
      [
        [141, VIEWPORT_OBJ],
        [142, MEASURE_OBJ],
        [143, GCS_OBJ],
      ],
      "/VP [ 141 0 R ] /MediaBox [0 0 100 100]",
    );
    const vps = viewportGeoRefs(inflatePdfText(buf));
    expect(vps).toHaveLength(1);
    expect(vps[0]!.bbox).toEqual([0, 0, 100, 100]);
    expect(vps[0]!.gpts).toHaveLength(8);
    expect(vps[0]!.wkt).toContain("NAD83 / MTM 8");
  });

  it("end-to-end: extractGeoRef no longer ABORTs on an ObjStm-compressed GeoPDF", () => {
    const buf = objStmPdf(
      [
        [141, VIEWPORT_OBJ],
        [142, MEASURE_OBJ],
        [143, GCS_OBJ],
      ],
      "/VP [ 141 0 R ] /MediaBox [0 0 100 100]",
    );
    const geo = extractGeoRef(buf);
    expect(geo).not.toBeNull();
    expect(geo!.maxResidualM).toBeLessThan(2);
  });

  it("re-emits objects with their TRUE object numbers (offset table is honoured)", () => {
    const buf = objStmPdf(
      [
        [141, VIEWPORT_OBJ],
        [142, MEASURE_OBJ],
        [143, GCS_OBJ],
      ],
      "/VP [ 141 0 R ] /MediaBox [0 0 100 100]",
    );
    const hay = inflatePdfText(buf);
    expect(hay).toContain("141 0 obj");
    expect(hay).toContain("142 0 obj");
    expect(hay).toContain("143 0 obj");
    // The body must land under its OWN number, not a neighbour's.
    expect(/142 0 obj[\s\S]{0,200}?\/Subtype \/GEO/.test(hay)).toBe(true);
  });

  it("leaves a NON-ObjStm georef stream untouched (no regression)", () => {
    const objstm = Buffer.from(
      "<< /Subtype /GEO /Bounds [0 0 0 1 1 1 1 0] /GPTS [45 -73 46 -73 46 -72 45 -72] >>",
    );
    const hay = inflatePdfText(pdfWithStream(objstm, "/MediaBox [0 0 100 100]"));
    expect(hay).toContain("/GPTS");
    expect(hay).not.toContain(" 0 obj\n<< /Subtype /GEO"); // not re-emitted: it is no ObjStm
  });

  it("falls back to the raw inflated text when the ObjStm header is malformed", () => {
    // /First points past the payload → offsets unusable; must not throw, must keep text.
    const payload = Buffer.from("garbage-header\n<< /GPTS [45 -73 46 -73 46 -72 45 -72] >>\n", "latin1");
    const dict = "<< /Type /ObjStm /N 2 /First 99999 /Filter /FlateDecode >>";
    const buf = Buffer.concat([
      Buffer.from(`%PDF-1.5\n5 0 obj\n${dict}\nstream\n`, "latin1"),
      zlib.deflateSync(payload),
      Buffer.from("\nendstream\nendobj\n/MediaBox [0 0 100 100]", "latin1"),
    ]);
    expect(() => inflatePdfText(buf)).not.toThrow();
    expect(inflatePdfText(buf)).toContain("/GPTS");
  });
});
