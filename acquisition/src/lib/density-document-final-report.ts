/** Pure adjudication helpers for the nominative 56-slug density report. */

export interface FinalCandidate {
  url: string;
  retrievedAt: string;
  disposition: string;
  normValueHits: Array<{
    page?: unknown;
    zoneCodes?: unknown;
    rawValues?: unknown;
    unit?: unknown;
    verbatim?: unknown;
  }>;
  dateSignals?: string[];
}

export interface FoundDensityDocument {
  url: string;
  captureDate: string;
  documentDateSignals: string[];
  verbatimDensityPassages: string[];
}

export const PROJECT_DOCUMENT_URL =
  /(?:^|[\/_-])projets?[-_/]r[eè]glements?(?:[\/_-]|$)|(?:^|[\/_-])(?:premier|1er|second|2e)[-_/]projet(?:[\/_-]|$)/i;

/** Resolve the municipal owner host even when the captured URL is a Wayback id_ URL. */
export function originalDocumentHost(url: string): string {
  const parsed = new URL(url);
  if (parsed.hostname.toLowerCase() !== "web.archive.org") {
    return parsed.hostname.toLowerCase().replace(/^www\./, "");
  }
  const archived = parsed.pathname.match(/^\/web\/[^/]+\/(https?:\/\/.+)$/i)?.[1];
  if (!archived) throw new Error(`URL Wayback sans original: ${url}`);
  return new URL(decodeURI(archived)).hostname.toLowerCase().replace(/^www\./, "");
}

/**
 * A document counts only when the native review found a printed numeric passage.
 * Explicit manual exclusions handle the small class of layout false positives
 * (e.g. an amendment DATE aligned after an empty density row).
 */
export function foundDensityDocuments(
  candidates: readonly FinalCandidate[],
  excluded: ReadonlyMap<string, string>,
): FoundDensityDocument[] {
  const output: FoundDensityDocument[] = [];
  for (const candidate of candidates) {
    if (
      candidate.disposition !== "candidate_review_required"
      || candidate.normValueHits.length === 0
      || PROJECT_DOCUMENT_URL.test(candidate.url)
      || excluded.has(candidate.url)
    ) continue;
    const passages = candidate.normValueHits
      .map((hit) => typeof hit.verbatim === "string" ? hit.verbatim.trim() : "")
      .filter(Boolean);
    if (passages.length === 0) continue;
    output.push({
      url: candidate.url,
      captureDate: candidate.retrievedAt.slice(0, 10),
      documentDateSignals: (candidate.dateSignals ?? []).slice(0, 20),
      verbatimDensityPassages: [...new Set(passages)].slice(0, 8),
    });
  }
  return output;
}

export function documentedNoDocumentReason(
  status: string,
  reason: string,
  blockers: readonly string[],
): string {
  if (status === "no_density_signal_in_captured_documents") {
    return blockers.length > 0
      ? `${reason}; incidents de capture documentés: ${blockers.join(" | ")}`
      : reason;
  }
  if (status === "capture_or_native_parse_blocked") {
    return `${reason}; blocages: ${blockers.join(" | ") || "non détaillés"}`;
  }
  return reason;
}
