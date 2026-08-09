import { existsSync, readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  columnIndex,
  decodeXmlText,
  parseSharedStrings,
  parseSheetRows,
  readWorkbook,
  unzipEntries,
} from "./xlsx.js";

/** Build a real (tiny) ZIP so the reader is tested against bytes, not a mock. */
function makeZip(files: { name: string; content: string }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, "utf8");
    const raw = Buffer.from(f.content, "utf8");
    const comp = deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8); // DEFLATE
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(Buffer.concat([local, nameBuf, comp]));

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10); // DEFLATE
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, nameBuf]));
    offset += 30 + nameBuf.length + comp.length;
  }
  const localsBuf = Buffer.concat(locals);
  const centralsBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralsBuf.length, 12);
  eocd.writeUInt32LE(localsBuf.length, 16);
  return Buffer.concat([localsBuf, centralsBuf, eocd]);
}

describe("columnIndex", () => {
  it("maps A/Z/AA/BC to 0-based indices", () => {
    expect(columnIndex("A1")).toBe(0);
    expect(columnIndex("Z1")).toBe(25);
    expect(columnIndex("AA1")).toBe(26);
    expect(columnIndex("BC7")).toBe(54);
  });
  it("returns null on an unparsable ref rather than guessing 0", () => {
    expect(columnIndex("")).toBeNull();
    expect(columnIndex("7")).toBeNull();
  });
});

describe("decodeXmlText", () => {
  it("un-escapes entities, resolving &amp; last so &amp;lt; stays literal", () => {
    expect(decodeXmlText("marge &lt; 3 m &amp; POS")).toBe("marge < 3 m & POS");
    expect(decodeXmlText("&amp;lt;")).toBe("&lt;");
    expect(decodeXmlText("Sup. min. (m&#178;)")).toBe("Sup. min. (m²)");
    expect(decodeXmlText("&#x41;-1")).toBe("A-1");
  });
});

describe("parseSharedStrings", () => {
  it("concatenates rich-text runs inside one <si>", () => {
    const xml =
      "<sst><si><t>Zone</t></si><si><r><t>Hauteur </t></r><r><t>max. (m)</t></r></si></sst>";
    expect(parseSharedStrings(xml)).toEqual(["Zone", "Hauteur max. (m)"]);
  });
});

describe("parseSheetRows", () => {
  const shared = ["Zone", "Hauteur max. (m)", "11001Ra"];

  it("places cells at their r= column, so a blank keeps later columns aligned", () => {
    // B is absent entirely: C must still land at index 2, never slide into 1.
    const xml = `<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row></sheetData>`;
    expect(parseSheetRows(xml, shared)).toEqual([["Zone", "", "Hauteur max. (m)"]]);
  });

  it("reads shared, inline, numeric and self-closing empty cells", () => {
    const xml =
      `<sheetData><row r="5">` +
      `<c r="A5" t="s"><v>2</v></c>` +
      `<c r="B5" t="inlineStr"><is><t>R.V.Q. 2910</t></is></c>` +
      `<c r="C5"><v>15</v></c>` +
      `<c r="D5"/>` +
      `</row></sheetData>`;
    expect(parseSheetRows(xml, shared)).toEqual([["11001Ra", "R.V.Q. 2910", "15", ""]]);
  });

  it("returns a date as its raw serial — it never interprets", () => {
    const xml = `<sheetData><row r="5"><c r="A5" s="3"><v>44372</v></c></row></sheetData>`;
    expect(parseSheetRows(xml, shared)).toEqual([["44372"]]);
  });
});

describe("unzipEntries", () => {
  it("round-trips a DEFLATE zip", () => {
    const zip = makeZip([{ name: "a.xml", content: "<x>hello</x>" }]);
    const entries = unzipEntries(zip);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("a.xml");
    expect(entries[0].data.toString("utf8")).toBe("<x>hello</x>");
  });

  it("throws (fail-closed) when the buffer is not a zip", () => {
    expect(() => unzipEntries(Buffer.from("not a zip at all"))).toThrow(/End-Of-Central-Directory/);
  });
});

describe("readWorkbook", () => {
  it("reads sheets in tab order via the workbook rels", () => {
    const zip = makeZip([
      {
        name: "xl/workbook.xml",
        content:
          `<workbook><sheets>` +
          `<sheet name="Modifications" sheetId="1" r:id="rId7"/>` +
          `<sheet name="Feuil1" sheetId="2" r:id="rId8"/>` +
          `</sheets></workbook>`,
      },
      {
        name: "xl/_rels/workbook.xml.rels",
        content:
          `<Relationships>` +
          `<Relationship Id="rId7" Target="worksheets/sheet2.xml"/>` +
          `<Relationship Id="rId8" Target="worksheets/sheet1.xml"/>` +
          `</Relationships>`,
      },
      {
        name: "xl/sharedStrings.xml",
        content: "<sst><si><t>Zone</t></si></sst>",
      },
      {
        name: "xl/worksheets/sheet1.xml",
        content: `<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData>`,
      },
      {
        name: "xl/worksheets/sheet2.xml",
        content: `<sheetData><row r="1"><c r="A1"><v>300</v></c></row></sheetData>`,
      },
    ]);
    const wb = readWorkbook(zip);
    // Tab order is Modifications, Feuil1 — even though it maps to sheet2/sheet1.
    expect(wb.sheetNames).toEqual(["Modifications", "Feuil1"]);
    expect(wb.sheets["Modifications"]).toEqual([["300"]]);
    expect(wb.sheets["Feuil1"]).toEqual([["Zone"]]);
  });
});

// Golden check against the REAL Ville-de-Québec open-data export when it is staged
// locally (it is a 1.6 MB binary, deliberately not committed).
const VDQ = "work/zonage-norms/quebec/vdq-zonage-grille.xlsx";
describe.runIf(existsSync(VDQ))("readWorkbook — vdq-zonage-grille.xlsx (réel)", () => {
  it("maps each tab to its OWN part via the rels (rId1→sheet1), not by file order", () => {
    const wb = readWorkbook(readFileSync(VDQ));
    expect(wb.sheetNames).toEqual(["Modifications", "Feuil1"]);
    // The grille lives in the tab named "Modifications" (rId1 → sheet1.xml); the
    // 161-row "Feuil1" is the annex. Resolving by file order would swap them.
    expect(wb.sheets["Modifications"].length).toBeGreaterThan(4000);
    expect(wb.sheets["Feuil1"].length).toBeLessThan(500);
  });

  it("exposes the grille header row and zone codes verbatim", () => {
    const wb = readWorkbook(readFileSync(VDQ));
    const rows = wb.sheets["Modifications"];
    expect(rows[3][0]).toBe("Zone");
    expect(rows[3][1]).toBe("Dernier règlement ayant modifié la zone");
    expect(rows[4][0]).toMatch(/^\d+[A-Za-z]+$/);
  });
});
