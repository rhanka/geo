/**
 * Read-only zoning-event detector for municipal PV and public-notice PDFs.
 *
 * The caller supplies a document inventory (municipality + URL only).  The
 * detector reads the source text, not an immo event projection: every emitted
 * candidate is anchored to an exact text span from that document.  Network
 * reads go through capturedFetch with an in-memory store and `store: false`,
 * so this local analysis never publishes a capture or a zoning event.
 */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";

import {
  CaptureRun,
  capturedFetch,
  type CaptureObjectStore,
} from "../../packages/qc-sources/src/capture/index.js";

import type { DetectedEventCandidate, ZoningEventSourceAdapter } from "./zoning-events-detect-emit.js";
import type { ZoningEventType } from "./zoning-events-emit.js";
import { classifyMunicipalZoningEventType } from "./zoning-events-type-classification.js";

const MAX_PDF_BYTES = 40 * 1024 * 1024;
const PDF_TEXT_TIMEOUT_MS = 45_000;
const USER_AGENT = "sentropic-geo-zoning-events-read-only/1.0";

export interface AvisPublicsSource {
  readonly city_slug: string;
  readonly url: string;
}

export interface AvisPublicsText {
  /** Exact `pdftotext -layout` projection of the fetched source bytes. */
  readonly text: string;
}

export type AvisPublicsTextReader = (source: AvisPublicsSource) => Promise<AvisPublicsText>;

export type AvisPublicsSourceState = "text-layer" | "scan-sans-couche-texte" | "read-error";

export interface AvisPublicsSourceObservation {
  readonly city_slug: string;
  readonly url: string;
  readonly state: AvisPublicsSourceState;
  readonly text_chars: number;
  readonly candidates_detected: number;
  readonly reason: string | null;
}

export interface AvisPublicsAdapter extends ZoningEventSourceAdapter {
  readonly observations: readonly AvisPublicsSourceObservation[];
}

export interface AvisPublicsAdapterOptions {
  readonly sources: readonly AvisPublicsSource[];
  readonly readText: AvisPublicsTextReader;
}

class MemoryCaptureStore implements CaptureObjectStore {
  async head(): Promise<boolean> { return false; }
  async put(): Promise<void> { /* Local detection deliberately does not persist bytes. */ }
}

/**
 * A capture run whose complete manifest and bodies stay in process memory.
 * It is a read-only analysis control, never a production-capture attestation.
 */
export function openReadOnlyZoningEventsRun(): CaptureRun {
  return new CaptureRun({
    runId: `zoning-events-read-only-${randomUUID()}`,
    lane: "pv",
    store: new MemoryCaptureStore(),
    userAgent: USER_AGENT,
    execution: "local",
    echo: null,
    flushEvery: 1,
  });
}

function collectPdfText(bytes: Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("pdftotext", ["-q", "-layout", "-enc", "UTF-8", "-", "-"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`pdftotext timeout après ${PDF_TEXT_TIMEOUT_MS}ms`));
    }, PDF_TEXT_TIMEOUT_MS);
    const finish = (error: Error | null, text = ""): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error !== null) reject(error);
      else resolve(text);
    };
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", (error) => finish(error));
    child.once("close", (code) => {
      const error = Buffer.concat(stderr).toString("utf8").trim();
      if (code !== 0) {
        finish(new Error(`pdftotext exit=${String(code)}${error ? `: ${error.slice(0, 400)}` : ""}`));
        return;
      }
      finish(null, Buffer.concat(stdout).toString("utf8"));
    });
    child.stdin.end(bytes);
  });
}

/**
 * Build the production text reader. `store:false` is intentional: source
 * capture belongs to the cluster; this adapter only observes existing public
 * documents for a local dry-run.
 */
export function readOnlyPdfTextReader(run: CaptureRun): AvisPublicsTextReader {
  return async (source) => {
    const result = await capturedFetch(source.url, {
      headers: { accept: "application/pdf,application/octet-stream;q=0.9,*/*;q=0.1" },
    }, {
      run,
      source: "zoning-events-avis-publics-read-only",
      slugs: [source.city_slug],
      store: false,
      retainBody: true,
      timeoutMs: 30_000,
      maxBytes: MAX_PDF_BYTES,
    });
    if (!result.ok || result.bytes === null) {
      throw new Error(`lecture source impossible: ${result.line.error ?? `HTTP ${String(result.line.http_status)}`}`);
    }
    const text = await collectPdfText(result.bytes);
    return { text };
  };
}

function fold(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLocaleLowerCase("fr-CA");
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function pageTexts(text: string): readonly string[] {
  return text.replace(/\r\n/gu, "\n").split("\f");
}

function isoDate(year: string, month: number, day: number): string | null {
  const date = new Date(Date.UTC(Number(year), month - 1, day));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const FRENCH_MONTHS: ReadonlyMap<string, number> = new Map([
  ["janvier", 1], ["fevrier", 2], ["mars", 3], ["avril", 4], ["mai", 5], ["juin", 6],
  ["juillet", 7], ["aout", 8], ["septembre", 9], ["octobre", 10], ["novembre", 11], ["decembre", 12],
]);

/** Date from the document body only; the filename and crawl time are never used. */
export function dateFromDocumentText(text: string): string | null {
  const head = pageTexts(text).slice(0, 2).join("\n");
  const numeric = /\b((?:19|20)\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/gu.exec(head);
  if (numeric) return isoDate(numeric[1]!, Number(numeric[2]), Number(numeric[3]));
  const french = /\b(0?[1-9]|[12]\d|3[01])(?:er)?\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\s+((?:19|20)\d{2})\b/gu.exec(fold(head));
  if (french) return isoDate(french[3]!, FRENCH_MONTHS.get(french[2]!)!, Number(french[1]));
  const dayFirst = /\b(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.]((?:19|20)\d{2})\b/gu.exec(head);
  if (dayFirst) return isoDate(dayFirst[3]!, Number(dayFirst[2]), Number(dayFirst[1]));
  return null;
}

function typeFromVerbatim(span: string): ZoningEventType | null {
  const type = classifyMunicipalZoningEventType(span);
  // A numbered council decision alone is not a zoning-event detection.  Keep
  // the explicit PIIA catch-all already admitted by this adapter, but do not
  // manufacture an event for a wholly vague decision just because the pure
  // classifier honestly calls its type `autre`.
  return type === "autre" && !/\bpiia\b/u.test(fold(span)) ? null : type;
}

function sourceSpan(lines: readonly string[], index: number): string {
  const start = Math.max(0, index - 1);
  let end = Math.min(lines.length, index + 16);
  for (let cursor = index + 1; cursor < end; cursor += 1) {
    if (isDecisionHeaderLine(lines[cursor] ?? "")) {
      end = cursor;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trim();
}

/** A numbered agenda item or a municipal resolution, never a prose recital. */
function isDecisionHeaderLine(line: string): boolean {
  return /^\s*(?:(?:\d{2}-\d{2}-\d{4,6}\s+)?\d+(?:\.\d+)+|(?:19|20)\d{2}-\d{2}-\d{3,})\b/u.test(line);
}

function fallbackTypeFromMarker(line: string): ZoningEventType | null {
  const type = typeFromVerbatim(line);
  if (type !== "ppcmoi" && type !== "cptaq") return null;
  return type;
}

function uniqueZoneMentions(span: string, page: number): DetectedEventCandidate["zone_mentions"] {
  const mentions: { mention_brute: string; page: number }[] = [];
  const seen = new Set<string>();
  const code = /\b[A-Z]{1,8}(?:[\s-]?\d{1,5})?\b/gu;
  const contexts = [...span.matchAll(/\bzone(?:s)?\b[\s\S]{0,180}/giu)];
  for (const context of contexts) {
    for (const match of context[0].matchAll(code)) {
      const raw = match[0]!.trim();
      const folded = fold(raw);
      if (folded === "zone" || /^[a-z]+$/u.test(folded)) continue;
      const key = `${page}\u0000${raw}`;
      if (!seen.has(key)) {
        seen.add(key);
        mentions.push({ mention_brute: raw, page });
      }
    }
  }
  return mentions;
}

function bylawFromVerbatim(span: string): string | null {
  const match = /\breglement\s+(?:numero|n[°o])?\s*([0-9][0-9A-Za-z.-]*(?:\s*\([0-9]{4}\))?)/iu.exec(span);
  return match?.[1]?.trim() ?? null;
}

/**
 * A source-derived legal reference folds a table-of-contents repeat and its
 * later signed resolution into one detected event. It is deliberately not an
 * immo key and is used only for intra-document de-duplication.
 */
function sourceEventReference(candidate: DetectedEventCandidate): string | null {
  const span = candidate.extrait_brut;
  if (candidate.type === "ppcmoi") {
    const address = /\b([0-9][0-9 -]{0,12},\s*(?:rue|avenue|boulevard|chemin)\s+[^\n,(]{2,80})/iu.exec(span)?.[1];
    if (address) return `ppcmoi-address:${fold(address).replace(/[^a-z0-9]+/gu, " ").trim().replace(/\s+/gu, " ")}`;
    const heading = span.split("\n").find((line) => /\bppcmoi\b/iu.test(line));
    if (heading) {
      const afterMarker = heading.split(/\bppcmoi\b/iu)[1];
      const title = afterMarker === undefined ? "" : fold(afterMarker).replace(/[^a-z0-9]+/gu, " ").trim();
      if (title) return `ppcmoi-title:${title}`;
    }
  }
  const patterns = [
    /\bPPCMOI\s*((?:19|20)\d{2}[- ]\d{3,5})\b/iu,
    /\bDM\s*((?:19|20)\d{2}[- ]\d{3,5})\b/iu,
    /\b(?:resolution|résolution)\s*((?:19|20)\d{2}-\d{2}-\d{3,6})\b/iu,
    /\breglement\s+(?:numero|n[°o])?\s*([0-9][0-9A-Za-z.-]*)/iu,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(span);
    if (match?.[1]) return `${candidate.type}:${fold(match[1])}`;
  }
  return null;
}

function sourceEvidenceRank(candidate: DetectedEventCandidate): number {
  const span = fold(candidate.extrait_brut);
  let rank = candidate.extrait_brut.length;
  if (/\b(?:resolution|résolution)\b/u.test(span)) rank += 10_000;
  if (/\b(?:adopte|adoption|avis de motion|decision|décision)\b/u.test(span)) rank += 1_000;
  return rank;
}

function deduplicateSourceEvents(candidates: readonly DetectedEventCandidate[]): DetectedEventCandidate[] {
  const unique = new Map<string, DetectedEventCandidate>();
  for (const candidate of candidates) {
    const reference = sourceEventReference(candidate);
    const key = reference === null
      ? `${candidate.source_ref}\u0000${candidate.detection_anchor}`
      : `${candidate.source_ref}\u0000${reference}`;
    const existing = unique.get(key);
    if (existing === undefined || sourceEvidenceRank(candidate) > sourceEvidenceRank(existing)) unique.set(key, candidate);
  }
  return [...unique.values()].sort((left, right) => left.detection_anchor.localeCompare(right.detection_anchor));
}

/** Pure source-text extraction, exported for network-free regression tests. */
export function detectAvisPublicsDocument(source: AvisPublicsSource, text: string): DetectedEventCandidate[] {
  const dateIso = dateFromDocumentText(text);
  if (dateIso === null) return [];
  const candidates: DetectedEventCandidate[] = [];
  for (const [pageIndex, page] of pageTexts(text).entries()) {
    const lines = page.split("\n");
    for (const [lineIndex, line] of lines.entries()) {
      if (!isDecisionHeaderLine(line)) continue;
      const span = sourceSpan(lines, lineIndex);
      if (!span) continue;
      const type = typeFromVerbatim(span);
      if (type === null) continue;
      // The anchor is solely a hash of exact source wording. It is neither a
      // scan ordinal nor an immo-derived identifier.
      const anchor = `avis-publics:${sha256(span)}`;
      candidates.push({
        source_ref: source.url,
        detection_anchor: anchor,
        type,
        date_iso: dateIso,
        bylaw_numero: bylawFromVerbatim(span),
        zone_mentions: uniqueZoneMentions(span, pageIndex + 1),
        extrait_brut: span,
        url_pdf: source.url,
      });
    }
  }
  // Some short PVs expose a CPTAQ/PPCMOI decision only in its source-verbatim
  // recitals, without a numbered heading on the same page. Keep exactly the
  // first such marker *only when* no numbered decision already names that
  // neutral type. This is a bounded source-text fallback, not co-occurrence.
  const headingTypes = new Set(candidates.map((candidate) => candidate.type));
  for (const [pageIndex, page] of pageTexts(text).entries()) {
    const lines = page.split("\n");
    for (const [lineIndex, line] of lines.entries()) {
      const type = fallbackTypeFromMarker(line);
      if (type === null || headingTypes.has(type)) continue;
      const span = sourceSpan(lines, lineIndex);
      const anchor = `avis-publics:${sha256(span)}`;
      candidates.push({
        source_ref: source.url,
        detection_anchor: anchor,
        type,
        date_iso: dateIso,
        bylaw_numero: bylawFromVerbatim(span),
        zone_mentions: uniqueZoneMentions(span, pageIndex + 1),
        extrait_brut: span,
        url_pdf: source.url,
      });
      headingTypes.add(type);
    }
  }
  return deduplicateSourceEvents(candidates);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Detect directly from the configured public documents. Errors and scans are
 * retained as named observations, never converted into synthetic candidates.
 */
export function avisPublicsTextAdapter(options: AvisPublicsAdapterOptions): AvisPublicsAdapter {
  const observations: AvisPublicsSourceObservation[] = [];
  const sources = [...options.sources].sort((left, right) => (
    left.city_slug.localeCompare(right.city_slug) || left.url.localeCompare(right.url)
  ));
  return {
    name: "avis-publics-text-layer",
    get observations() { return observations; },
    async detect(citySlug) {
      const found: DetectedEventCandidate[] = [];
      for (const source of sources.filter((entry) => entry.city_slug === citySlug)) {
        try {
          const result = await options.readText(source);
          const text = result.text.trim();
          if (!text) {
            observations.push({ city_slug: source.city_slug, url: source.url, state: "scan-sans-couche-texte", text_chars: 0, candidates_detected: 0, reason: "pdftotext ne rend aucun caractère" });
            continue;
          }
          const candidates = detectAvisPublicsDocument(source, text);
          observations.push({ city_slug: source.city_slug, url: source.url, state: "text-layer", text_chars: text.length, candidates_detected: candidates.length, reason: null });
          found.push(...candidates);
        } catch (error) {
          observations.push({ city_slug: source.city_slug, url: source.url, state: "read-error", text_chars: 0, candidates_detected: 0, reason: errorText(error) });
        }
      }
      return deduplicateSourceEvents(found);
    },
  };
}
