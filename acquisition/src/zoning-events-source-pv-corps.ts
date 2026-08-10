/**
 * First zoning-event source adapter: captured PV / ordre-du-jour material
 * already semantic-indexed by `pv-graphify-semantic`.
 *
 * Reports contain the original document URL, immutable CAS source identity,
 * Graphify citations, regulations and served-zone-aware zone citations.  This
* adapter deliberately accepts a candidate only from a single verbatim
* citation declaring a neutral zoning-event marker, or from a bounded
* regulation-to-zone adjacency whose two citations remain verbatim.  It does
* not turn unrelated facts elsewhere in the same document into an event.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { DetectedEventCandidate, ZoningEventSourceAdapter } from "./zoning-events-detect-emit.js";
import type { ZoningEventType } from "./zoning-events-emit.js";
import { classifyMunicipalZoningEventType } from "./zoning-events-type-classification.js";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const COVERAGE = resolve(ROOT, "work", "coverage");
const GRAPHIFY_REPORT = /^pv-graphify-semantic-real-universe-\d{8}-batch-\d{2}(?:-part-\d+)?\.json$/u;

interface Citation {
  readonly source_location: string;
  readonly quote: string;
}

interface Entity {
  readonly label: string;
  readonly legal_quality?: string;
  readonly citation: Citation;
}

interface ReportDocument {
  readonly slug: string | null;
  readonly url: string | null;
  readonly storage_key: string;
  readonly outcome: string | null;
  readonly entities: Record<string, readonly Entity[]>;
}

export interface PvCorpsGraphifySemanticAdapterOptions {
  /** Injectable for unit tests; production discovers all committed reports. */
  readonly reportPaths?: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function entity(value: unknown): Entity | null {
  if (!isRecord(value)) return null;
  const label = stringOrNull(value.label);
  const citationValue = value.citation;
  if (label === null || !isRecord(citationValue)) return null;
  const quote = stringOrNull(citationValue.quote);
  const sourceLocation = stringOrNull(citationValue.source_location);
  if (quote === null || sourceLocation === null) return null;
  return {
    label,
    ...(typeof value.legal_quality === "string" ? { legal_quality: value.legal_quality } : {}),
    citation: { source_location: sourceLocation, quote },
  };
}

function reportDocument(value: unknown): ReportDocument | null {
  if (!isRecord(value)) return null;
  const storageKey = stringOrNull(value.storage_key);
  if (storageKey === null || !isRecord(value.entities)) return null;
  const entities: Record<string, readonly Entity[]> = {};
  for (const [kind, raw] of Object.entries(value.entities)) {
    if (!Array.isArray(raw)) continue;
    entities[kind] = raw.map(entity).filter((item): item is Entity => item !== null);
  }
  return {
    slug: stringOrNull(value.slug),
    url: stringOrNull(value.url),
    storage_key: storageKey,
    outcome: stringOrNull(value.outcome),
    entities,
  };
}

function loadReportDocuments(path: string): ReportDocument[] {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!isRecord(parsed) || !Array.isArray(parsed.documents)) return [];
  return parsed.documents.map(reportDocument).filter((item): item is ReportDocument => item !== null);
}

function defaultReportPaths(): string[] {
  return readdirSync(COVERAGE)
    .filter((name) => GRAPHIFY_REPORT.test(name))
    .map((name) => resolve(COVERAGE, name))
    .sort((left, right) => left.localeCompare(right));
}

function typeFromVerbatim(quote: string): ZoningEventType | null {
  const type = classifyMunicipalZoningEventType(quote);
  // A Graphify entity is not itself a decision heading.  Preserve this
  // adapter's existing event-selection boundary: a vague entity does not
  // become a synthetic event merely because the classifier calls it `autre`.
  return type === "autre" ? null : type;
}

function dateFromSourceRef(url: string): string | null {
  // The date is accepted only when the *source document identity itself*
  // carries an unambiguous ISO/year-month-day token; no current date or crawl
  // date is ever substituted.
  const matches = [...url.matchAll(/(?:^|[^0-9])((?:19|20)\d{2})[-_./](0[1-9]|1[0-2])[-_./](0[1-9]|[12]\d|3[01])(?:[^0-9]|$)/gu)];
  if (matches.length !== 1) return null;
  const match = matches[0]!;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function pageFromLocation(location: string): number | null {
  const match = /(?:page|p)[.:\s]+(\d+)/iu.exec(location);
  return match?.[1] === undefined ? null : Number(match[1]);
}

function lineFromLocation(location: string): number | null {
  const match = /line:(\d+)/iu.exec(location);
  return match?.[1] === undefined ? null : Number(match[1]);
}

function stableAnchor(document: ReportDocument, citation: Citation): string {
  // Source CAS + Graphify's intrinsic source locator + hash of the exact quote.
  // Unlike an array index, it survives report reordering and keeps identity tied
  // to the source wording that licensed this candidate.
  const quoteHash = createHash("sha256").update(citation.quote, "utf8").digest("hex");
  return `pv-graphify:${document.storage_key}:${citation.source_location}:${quoteHash}`;
}

function candidatesFromDocument(document: ReportDocument): DetectedEventCandidate[] {
  if (document.outcome !== "INDEXED" || document.url === null || document.slug === null) return [];
  const dateIso = dateFromSourceRef(document.url);
  if (dateIso === null) return [];
  const candidates: DetectedEventCandidate[] = [];
  for (const [kind, entities] of Object.entries(document.entities)) {
    for (const item of entities) {
      const type = typeFromVerbatim(item.citation.quote);
      if (type === null) continue;
      const zones = kind === "Zone" ? [{ mention_brute: item.label, page: pageFromLocation(item.citation.source_location) }] : [];
      const regulation = kind === "Regulation" ? item.label : null;
      candidates.push({
        source_ref: document.storage_key,
        detection_anchor: stableAnchor(document, item.citation),
        type,
        date_iso: dateIso,
        bylaw_numero: regulation,
        zone_mentions: zones,
        extrait_brut: item.citation.quote,
        url_pdf: document.url,
      });
    }
  }

  // Graphify keeps the source locations of the two semantic facts separately:
  // a Regulation heading can be on line N and its zone list on N+1/N+2.  Join
  // only that bounded, verbatim adjacency — never merely co-occurrence in a
  // PDF — to recognize a zoning *projet de règlement*.  This is specifically
  // the PV-corps/ordre-du-jour shape the semantic index was built to retain.
  for (const regulation of document.entities.Regulation ?? []) {
    const normalized = regulation.citation.quote
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/gu, "")
      .toLowerCase();
    if (!/\b(?:premier|second)?\s*projet\b/u.test(normalized)) continue;
    const regulationLine = lineFromLocation(regulation.citation.source_location);
    if (regulationLine === null) continue;
    const zones = (document.entities.Zone ?? []).filter((zone) => {
      const line = lineFromLocation(zone.citation.source_location);
      return line !== null && line > regulationLine && line - regulationLine <= 2;
    });
    if (zones.length === 0) continue;
    const span = [regulation.citation.quote, ...zones.map((zone) => zone.citation.quote)].join("\n");
    const zoneAnchor = zones
      .map((zone) => `${zone.citation.source_location}:${createHash("sha256").update(zone.citation.quote, "utf8").digest("hex")}`)
      .join("|");
    candidates.push({
      source_ref: document.storage_key,
      detection_anchor: `${stableAnchor(document, regulation.citation)}:adjacent-zones:${zoneAnchor}`,
      type: "projet-reglement",
      date_iso: dateIso,
      bylaw_numero: regulation.label,
      zone_mentions: zones.map((zone) => ({
        mention_brute: zone.label,
        page: pageFromLocation(zone.citation.source_location),
      })),
      extrait_brut: span,
      url_pdf: document.url,
    });
  }
  return candidates;
}

/**
 * Read committed Graphify semantic reports and expose only source-verbatim
 * zoning candidates.  It does not fetch or recapture URLs, and it does not
 * emit candidates from a filename, an immo handoff, or an inferred title.
 */
export function pvCorpsGraphifySemanticAdapter(
  options: PvCorpsGraphifySemanticAdapterOptions = {},
): ZoningEventSourceAdapter {
  const reports = options.reportPaths ?? defaultReportPaths();
  return {
    name: "pv-corps-graphify-semantic",
    async detect(citySlug) {
      const found = reports
        .flatMap(loadReportDocuments)
        .filter((document) => document.slug === citySlug)
        .flatMap(candidatesFromDocument);
      const byIdentity = new Map<string, DetectedEventCandidate>();
      for (const candidate of found) {
        const key = `${candidate.source_ref}\u0000${candidate.detection_anchor}`;
        byIdentity.set(key, candidate);
      }
      return [...byIdentity.values()].sort((left, right) => {
        const byRef = left.source_ref.localeCompare(right.source_ref);
        return byRef === 0 ? left.detection_anchor.localeCompare(right.detection_anchor) : byRef;
      });
    },
  };
}
