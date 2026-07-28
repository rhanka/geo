/**
 * Native, fail-closed review of a NEW density-document candidate.
 *
 * This module never turns a textual hint into a verified norm. It only locates
 * verbatim passages worth human/legal review. Verification still requires the
 * municipality owner, an in-force document date, a zone, and a value with its
 * unit. A missing text layer is explicitly inconclusive.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  densityNormValueHits,
  densityTextHits,
  hasHardProjectMarker,
  type DensityTextHit,
  type DensityNormValueHit,
} from "../../../packages/qc-sources/src/sources/density-document-discovery.js";
import { readWorkbook } from "./xlsx.js";

export type NativeDocumentKind = "pdf" | "xlsx" | "xls" | "docx" | "doc" | "text" | "unknown";
export type NativeReviewDisposition =
  | "candidate_review_required"
  | "no_density_signal"
  | "project_excluded"
  | "native_parse_blocked";

export interface NativeTextResult {
  kind: NativeDocumentKind;
  extractor: "pdftotext-layout" | "xlsx-verbatim-cells" | "libreoffice-text" | "utf8" | null;
  text: string | null;
  blocker: string | null;
}

export interface NativeDensityReview extends NativeTextResult {
  disposition: NativeReviewDisposition;
  hits: DensityTextHit[];
  normValueHits: DensityNormValueHit[];
  openingVerbatim: string | null;
  dateSignals: string[];
  identitySignals: string[];
}

export interface NativeExtractionOptions {
  xlsToXlsx?: (bytes: Buffer) => Buffer;
  officeToText?: (bytes: Buffer, extension: "doc" | "docx") => string;
  municipalityName?: string;
  sourceName?: string;
}

export interface CapturedWaybackRangePart {
  start: number;
  end: number;
  last: boolean;
  bytes: Buffer;
}

export interface WaybackAssembly {
  bytes: Buffer | null;
  blocker: string | null;
}

const LEGAL_DATE =
  String.raw`(?:\d{1,2}(?:er)?\s+(?:janv(?:ier)?|f[ée]v(?:rier)?|mars|avr(?:il)?|mai|juin|juil(?:let)?|ao[uû]t|sept(?:embre)?|oct(?:obre)?|nov(?:embre)?|d[ée]c(?:embre)?)\.?\s+\d{4}|\d{4}-\d{2}-\d{2})`;
const FINAL_ADOPTION = new RegExp(
  String.raw`\b(?:Adoption(?:\s+du\s+r[èe]glement)?|R[èe]glement\s+adopt[ée]\s+le)\s*:\s*${LEGAL_DATE}\b`,
  "i",
);
/**
 * A chronology row saying "Adoption du projet de règlement" is not itself a
 * project marker when the same document also prints a dated final adoption.
 * Entry into force remains a separate legal-review requirement: its absence
 * must not hide an adopted document from review. A project marker in the source
 * title/URL remains absolute.
 */
export function hasDatedFinalAdoption(text: string): boolean {
  return FINAL_ADOPTION.test(text);
}

function kindOf(bytes: Buffer, sourceName = ""): NativeDocumentKind {
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    return /\.docx?(?:$|[?#])/i.test(sourceName) ? "docx" : "xlsx";
  }
  if (bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
    return /\.doc(?:$|[?#])/i.test(sourceName) ? "doc" : "xls";
  }
  const prefix = bytes.subarray(0, 128).toString("utf8");
  if (/^\s*(?:<!doctype|<html|<\?xml|[{[])/i.test(prefix)) return "text";
  return "unknown";
}

/**
 * Reassemble only contiguous, full responses whose final requested byte is
 * explicitly marked. Partial/gapped/replayed responses remain inconclusive.
 */
export function assembleWaybackPdfRanges(
  firstMiB: Buffer,
  parts: readonly CapturedWaybackRangePart[],
): WaybackAssembly {
  if (firstMiB.length !== 1_048_576 || kindOf(firstMiB) !== "pdf") {
    return { bytes: null, blocker: "wayback-first-part-is-not-truncated-pdf-mib" };
  }
  const chunks = [firstMiB];
  let expectedStart = firstMiB.length;
  let completed = false;
  for (const part of [...parts].sort((left, right) => left.start - right.start)) {
    if (part.start !== expectedStart || part.end < part.start) {
      return { bytes: null, blocker: `wayback-range-gap-at-${expectedStart}` };
    }
    const expectedBytes = part.end - part.start + 1;
    if (part.bytes.length !== expectedBytes) {
      return {
        bytes: null,
        blocker: `wayback-range-size-${part.start}-${part.end}:expected-${expectedBytes}-got-${part.bytes.length}`,
      };
    }
    if (kindOf(part.bytes) === "pdf") {
      return { bytes: null, blocker: `wayback-range-ignored-at-${part.start}` };
    }
    chunks.push(part.bytes);
    expectedStart += part.bytes.length;
    if (part.last) {
      completed = true;
      break;
    }
  }
  return completed
    ? { bytes: Buffer.concat(chunks), blocker: null }
    : { bytes: null, blocker: "wayback-ranges-incomplete" };
}

function workbookText(bytes: Buffer): string {
  const workbook = readWorkbook(bytes);
  return workbook.sheetNames
    .map((sheet) => [
      `FEUILLE: ${sheet}`,
      ...(workbook.sheets[sheet] ?? []).map((row) => row.join("\t")),
    ].join("\n"))
    .join("\f");
}

/** Convert a legacy BIFF/OLE workbook without interpreting any cell value. */
export function convertLegacyXlsToXlsx(bytes: Buffer): Buffer {
  const directory = mkdtempSync(join(tmpdir(), "geo-density-xls-"));
  const input = join(directory, "input.xls");
  const output = join(directory, "input.xlsx");
  const profile = pathToFileURL(join(directory, "libreoffice-profile")).href;
  try {
    writeFileSync(input, bytes);
    const result = spawnSync(
      "libreoffice",
      [
        `-env:UserInstallation=${profile}`,
        "--headless",
        "--convert-to",
        "xlsx",
        "--outdir",
        directory,
        input,
      ],
      { encoding: "utf8", timeout: 45_000, maxBuffer: 4 * 1024 * 1024 },
    );
    if (result.status !== 0) {
      throw new Error(
        `libreoffice-exit-${String(result.status)}:${`${result.stderr ?? ""} ${result.stdout ?? ""}`.trim().slice(0, 240)}`,
      );
    }
    return readFileSync(output);
  } finally {
    // The directory is uniquely created by this function and contains only
    // transient analysis artifacts; captured source bytes remain in S3 CAS.
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Extrait le texte d'un ancien DOC/DOCX sans OCR ni interprétation de valeur. */
export function convertOfficeDocumentToText(
  bytes: Buffer,
  extension: "doc" | "docx",
): string {
  const directory = mkdtempSync(join(tmpdir(), "geo-density-doc-"));
  const input = join(directory, `input.${extension}`);
  const output = join(directory, "input.txt");
  const profile = pathToFileURL(join(directory, "libreoffice-profile")).href;
  try {
    writeFileSync(input, bytes);
    const result = spawnSync(
      "libreoffice",
      [
        `-env:UserInstallation=${profile}`,
        "--headless",
        "--convert-to",
        "txt:Text",
        "--outdir",
        directory,
        input,
      ],
      { encoding: "utf8", timeout: 45_000, maxBuffer: 4 * 1024 * 1024 },
    );
    if (result.status !== 0) {
      throw new Error(
        `libreoffice-exit-${String(result.status)}:`
        + `${`${result.stderr ?? ""} ${result.stdout ?? ""}`.trim().slice(0, 240)}`,
      );
    }
    return readFileSync(output, "utf8");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function extractNativeDocumentText(
  bytes: Buffer,
  options: NativeExtractionOptions = {},
): NativeTextResult {
  const kind = kindOf(bytes, options.sourceName);
  if (kind === "pdf") {
    const result = spawnSync(
      "pdftotext",
      ["-q", "-layout", "-enc", "UTF-8", "-", "-"],
      { input: bytes, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
    );
    if (result.status !== 0) {
      return {
        kind,
        extractor: "pdftotext-layout",
        text: null,
        blocker: `pdftotext-exit-${String(result.status)}:${(result.stderr ?? "").trim().slice(0, 240)}`,
      };
    }
    const text = result.stdout ?? "";
    if (!text.trim()) {
      return { kind, extractor: "pdftotext-layout", text: null, blocker: "pdf-without-native-text-layer" };
    }
    return { kind, extractor: "pdftotext-layout", text, blocker: null };
  }
  if (kind === "xlsx") {
    try {
      const text = workbookText(bytes);
      return text.trim()
        ? { kind, extractor: "xlsx-verbatim-cells", text, blocker: null }
        : { kind, extractor: "xlsx-verbatim-cells", text: null, blocker: "xlsx-without-verbatim-cells" };
    } catch (error) {
      return {
        kind,
        extractor: "xlsx-verbatim-cells",
        text: null,
        blocker: `xlsx-parse:${error instanceof Error ? error.message : String(error)}`.slice(0, 300),
      };
    }
  }
  if (kind === "xls") {
    try {
      const text = workbookText((options.xlsToXlsx ?? convertLegacyXlsToXlsx)(bytes));
      return text.trim()
        ? { kind, extractor: "xlsx-verbatim-cells", text, blocker: null }
        : { kind, extractor: "xlsx-verbatim-cells", text: null, blocker: "xls-without-verbatim-cells" };
    } catch (error) {
      return {
        kind,
        extractor: "xlsx-verbatim-cells",
        text: null,
        blocker: `xls-native-convert:${error instanceof Error ? error.message : String(error)}`.slice(0, 300),
      };
    }
  }
  if (kind === "doc" || kind === "docx") {
    try {
      const text = (options.officeToText ?? convertOfficeDocumentToText)(bytes, kind);
      return text.trim()
        ? { kind, extractor: "libreoffice-text", text, blocker: null }
        : { kind, extractor: "libreoffice-text", text: null, blocker: `${kind}-without-native-text` };
    } catch (error) {
      return {
        kind,
        extractor: "libreoffice-text",
        text: null,
        blocker: `${kind}-native-convert:${error instanceof Error ? error.message : String(error)}`.slice(0, 300),
      };
    }
  }
  if (kind === "text") {
    const text = bytes.toString("utf8");
    return text.trim()
      ? { kind, extractor: "utf8", text, blocker: null }
      : { kind, extractor: "utf8", text: null, blocker: "empty-text-document" };
  }
  return { kind, extractor: null, text: null, blocker: "unknown-document-container" };
}

export function reviewNativeDensityDocument(
  bytes: Buffer,
  titleAndUrl = "",
  options: NativeExtractionOptions = {},
): NativeDensityReview {
  const native = extractNativeDocumentText(bytes, { ...options, sourceName: titleAndUrl });
  if (native.text === null) {
    return {
      ...native,
      disposition: "native_parse_blocked",
      hits: [],
      normValueHits: [],
      openingVerbatim: null,
      dateSignals: [],
      identitySignals: [],
    };
  }
  const lines = native.text.split(/\r?\n/);
  const openingVerbatim = lines.slice(0, 100).join("\n").trim().slice(0, 8_000) || null;
  const contexts = (predicate: (line: string) => boolean, max: number): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < lines.length && out.length < max; index++) {
      if (!predicate(lines[index] ?? "")) continue;
      const context = lines
        .slice(Math.max(0, index - 1), Math.min(lines.length, index + 2))
        .map((line) => line.trim())
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .slice(0, 700);
      if (!context || seen.has(context)) continue;
      seen.add(context);
      out.push(context);
    }
    return out;
  };
  const dateSignals = contexts(
    (line) => /entr[eé]e\s+en\s+vigueur|adopt[eé]|codification|mise\s+[àa]\s+jour|r[eè]glement\s+(?:num[eé]ro|n[o°])|\b(?:19|20)\d{2}\b/i.test(line),
    20,
  );
  const foldedName = (options.municipalityName ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const identitySignals = foldedName
    ? contexts((line) => line
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .includes(foldedName), 12)
    : [];
  const reviewText = native.text.slice(0, 250_000);
  const projectExcluded =
    hasHardProjectMarker(titleAndUrl)
    || (hasHardProjectMarker(reviewText) && !hasDatedFinalAdoption(reviewText));
  if (projectExcluded) {
    return {
      ...native,
      disposition: "project_excluded",
      hits: [],
      normValueHits: [],
      openingVerbatim,
      dateSignals,
      identitySignals,
    };
  }
  const hits = densityTextHits(native.text);
  const normValueHits = densityNormValueHits(native.text);
  return {
    ...native,
    disposition: hits.length > 0 ? "candidate_review_required" : "no_density_signal",
    hits,
    normValueHits,
    openingVerbatim,
    dateSignals,
    identitySignals,
  };
}
