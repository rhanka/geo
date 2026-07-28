/**
 * Native, fail-closed review of a NEW density-document candidate.
 *
 * This module never turns a textual hint into a verified norm. It only locates
 * verbatim passages worth human/legal review. Verification still requires the
 * municipality owner, an in-force document date, a zone, and a value with its
 * unit. A missing text layer is explicitly inconclusive.
 */
import { spawnSync } from "node:child_process";

import {
  densityTextHits,
  hasHardProjectMarker,
  type DensityTextHit,
} from "../../../packages/qc-sources/src/sources/density-document-discovery.js";
import { readWorkbook } from "./xlsx.js";

export type NativeDocumentKind = "pdf" | "xlsx" | "xls" | "text" | "unknown";
export type NativeReviewDisposition =
  | "candidate_review_required"
  | "no_density_signal"
  | "project_excluded"
  | "native_parse_blocked";

export interface NativeTextResult {
  kind: NativeDocumentKind;
  extractor: "pdftotext-layout" | "xlsx-verbatim-cells" | "utf8" | null;
  text: string | null;
  blocker: string | null;
}

export interface NativeDensityReview extends NativeTextResult {
  disposition: NativeReviewDisposition;
  hits: DensityTextHit[];
}

function kindOf(bytes: Buffer): NativeDocumentKind {
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return "xlsx";
  if (bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
    return "xls";
  }
  const prefix = bytes.subarray(0, 128).toString("utf8");
  if (/^\s*(?:<!doctype|<html|<\?xml|[{[])/i.test(prefix)) return "text";
  return "unknown";
}

export function extractNativeDocumentText(bytes: Buffer): NativeTextResult {
  const kind = kindOf(bytes);
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
      const workbook = readWorkbook(bytes);
      const text = workbook.sheetNames
        .map((sheet) => [
          `FEUILLE: ${sheet}`,
          ...(workbook.sheets[sheet] ?? []).map((row) => row.join("\t")),
        ].join("\n"))
        .join("\f");
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
    return { kind, extractor: null, text: null, blocker: "legacy-xls-native-parser-unavailable" };
  }
  if (kind === "text") {
    const text = bytes.toString("utf8");
    return text.trim()
      ? { kind, extractor: "utf8", text, blocker: null }
      : { kind, extractor: "utf8", text: null, blocker: "empty-text-document" };
  }
  return { kind, extractor: null, text: null, blocker: "unknown-document-container" };
}

export function reviewNativeDensityDocument(bytes: Buffer, titleAndUrl = ""): NativeDensityReview {
  const native = extractNativeDocumentText(bytes);
  if (native.text === null) {
    return { ...native, disposition: "native_parse_blocked", hits: [] };
  }
  if (hasHardProjectMarker(`${titleAndUrl}\n${native.text.slice(0, 250_000)}`)) {
    return { ...native, disposition: "project_excluded", hits: [] };
  }
  const hits = densityTextHits(native.text);
  return {
    ...native,
    disposition: hits.length > 0 ? "candidate_review_required" : "no_density_signal",
    hits,
  };
}
