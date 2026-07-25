/**
 * Minimal, dependency-free XLSX reader (Node/TS only — no Python, no new npm dep).
 *
 * An .xlsx IS a ZIP of XML parts. We read the ZIP central directory, inflate the
 * entries we need with `node:zlib`, and project a worksheet into rows of VERBATIM
 * cell strings. It exists because an official municipal open-data grille (Ville de
 * Québec publishes `vdq-zonage-grille.xlsx` under CC-BY) is a strictly better norms
 * source than OCR: the cell text IS the by-law text, so "verbatim-or-null" holds by
 * construction and the extraction cost is $0.
 *
 * SCOPE — deliberately the smallest thing that reads a real municipal export:
 *   • ZIP: STORED (0) and DEFLATE (8) entries; the 4-byte-header central directory.
 *   • Cells: shared strings (`t="s"`), inline strings, numbers, booleans.
 *   • Row/col placement is driven by each cell's `r="B7"` reference, so BLANK cells
 *     keep their column index — a sparse sheet can NEVER shift a column silently
 *     (the anti-column-shift guard-rail of docs/spec/normes-extraction-retenu.md §6).
 * NOT supported (and not needed here): encryption, formulas' cached rich text,
 * ZIP64, styles/number-format application (dates are returned as their raw serial —
 * the caller decides, since a wrong date is worse than an honest serial).
 */
import { inflateRawSync } from "node:zlib";

/** One decompressed ZIP entry. */
export interface ZipEntry {
  name: string;
  data: Buffer;
}

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
/** ZIP spec: the End-Of-Central-Directory comment is at most 64 KiB. */
const MAX_EOCD_SCAN = 66_000;

/**
 * Read a ZIP container's entries. Throws on anything it does not understand
 * rather than returning partial data (fail-closed: a silently truncated grille
 * would publish nulls that look like real "not regulated" cells).
 */
export function unzipEntries(buf: Buffer): ZipEntry[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - MAX_EOCD_SCAN; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("xlsx: End-Of-Central-Directory introuvable (pas un ZIP/XLSX)");
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== SIG_CENTRAL) {
      throw new Error(`xlsx: signature central-directory invalide à l'entrée ${n}`);
    }
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString("utf8");
    // The LOCAL header's extra field may differ in length from the central one,
    // so the payload offset must be recomputed from the local header itself.
    const localNameLen = buf.readUInt16LE(localOff + 26);
    const localExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + localNameLen + localExtraLen;
    const raw = buf.subarray(start, start + compSize);
    if (method !== 0 && method !== 8) {
      throw new Error(`xlsx: méthode de compression ${method} non supportée (${name})`);
    }
    out.push({ name, data: method === 0 ? Buffer.from(raw) : inflateRawSync(raw) });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Resolve the XML entity escapes OOXML actually emits. `&amp;` LAST (un-escape order). */
export function decodeXmlText(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9A-Fa-f]+);/g, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

/**
 * Parse `xl/sharedStrings.xml` into its ordered table. A shared string may be split
 * across several `<t>` runs (rich text); they are concatenated in document order,
 * which is what the cell actually displays.
 */
export function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const si of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    let s = "";
    for (const t of si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) s += decodeXmlText(t[1]);
    out.push(s);
  }
  return out;
}

/** `"BC7"` → 0-based column index (54). Returns null when the ref is unparsable. */
export function columnIndex(ref: string): number | null {
  const m = /^([A-Z]+)\d+$/.exec(ref);
  if (!m) return null;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Project a worksheet XML into rows of verbatim cell strings.
 *
 * Cells are placed at the column their `r` reference names, so a sparse row keeps
 * every later column at its true index (blank → `""`). Numbers/dates are returned
 * as their RAW stored text (a date is its Excel serial): this reader never
 * interprets, so it can never invent.
 */
export function parseSheetRows(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1] ?? "";
      const body = cm[2] ?? "";
      const type = (/t="([^"]+)"/.exec(attrs) ?? [])[1] ?? "";
      let v = "";
      if (type === "inlineStr") {
        for (const t of body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) v += decodeXmlText(t[1]);
      } else {
        const vm = /<v>([\s\S]*?)<\/v>/.exec(body);
        if (vm) {
          const raw = decodeXmlText(vm[1]);
          v = type === "s" ? (shared[Number(raw)] ?? "") : raw;
        }
      }
      const ref = (/r="([A-Z]+\d+)"/.exec(attrs) ?? [])[1] ?? "";
      const idx = ref ? columnIndex(ref) : null;
      const at = idx ?? cells.length;
      while (cells.length < at) cells.push("");
      cells[at] = v;
    }
    rows.push(cells);
  }
  return rows;
}

/** A workbook projected to what this pipeline needs: sheet name → rows. */
export interface Workbook {
  sheetNames: string[];
  sheets: Record<string, string[][]>;
}

/**
 * Read an .xlsx buffer into rows per sheet, in workbook (tab) order.
 *
 * Sheet order comes from `xl/workbook.xml`; the r:id → part mapping comes from the
 * workbook rels, so a workbook whose sheetN.xml files are not in tab order (common
 * after an editor round-trip) still reads correctly.
 */
export function readWorkbook(buf: Buffer): Workbook {
  const entries = unzipEntries(buf);
  const byName = new Map(entries.map((e) => [e.name, e.data]));
  const ssPart = byName.get("xl/sharedStrings.xml");
  const shared = ssPart ? parseSharedStrings(ssPart.toString("utf8")) : [];
  const wbPart = byName.get("xl/workbook.xml");
  if (!wbPart) throw new Error("xlsx: xl/workbook.xml absent");
  const relsPart = byName.get("xl/_rels/workbook.xml.rels");
  const relTarget = new Map<string, string>();
  if (relsPart) {
    for (const m of relsPart.toString("utf8").matchAll(/<Relationship\b([^>]*)\/>/g)) {
      const id = (/Id="([^"]+)"/.exec(m[1]) ?? [])[1];
      const target = (/Target="([^"]+)"/.exec(m[1]) ?? [])[1];
      if (id && target) relTarget.set(id, target.replace(/^\/?(xl\/)?/, "xl/"));
    }
  }
  const sheetNames: string[] = [];
  const sheets: Record<string, string[][]> = {};
  let fallback = 0;
  for (const m of wbPart.toString("utf8").matchAll(/<sheet\b([^>]*)\/>/g)) {
    const name = decodeXmlText((/name="([^"]+)"/.exec(m[1]) ?? [])[1] ?? "");
    const rid = (/r:id="([^"]+)"/.exec(m[1]) ?? [])[1] ?? "";
    fallback += 1;
    const part = relTarget.get(rid) ?? `xl/worksheets/sheet${fallback}.xml`;
    const data = byName.get(part);
    if (!name || !data) continue;
    sheetNames.push(name);
    sheets[name] = parseSheetRows(data.toString("utf8"), shared);
  }
  return { sheetNames, sheets };
}
