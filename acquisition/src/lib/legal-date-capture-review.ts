/**
 * Read-only helpers for the legal-date acquisition lane.
 *
 * They only expose captured verbatim material worth legal review.  In
 * particular, a link, a date-shaped string, or a MRC meeting minute never
 * establishes an entry-into-force date on its own.
 */

export type LegalDateTextState =
  | "native-text"
  | "native-text-absent"
  | "extractor-error"
  | "non-text-container";
export type LegalDateSourceHint =
  | "avis-public-candidate"
  | "certificat-mrc-candidate"
  | "pv-mrc-ambiguous"
  | "legal-date-context";

export interface LegalDateFragment {
  hint: LegalDateSourceHint;
  /** PDF page when form-feed delimiters are available; otherwise deliberately null. */
  page: number | null;
  verbatim: string;
}

export interface LegalDateFollowUp {
  url: string;
  hint: LegalDateSourceHint;
  external_host: boolean;
}

const LEGAL_HINT = /avis\s+public|certificat\s+de\s+conformit|conformit|entr[ée]e?\s+en\s+vigueur|promulgation|proc[èe]s[-\s]*verb(?:al|aux)|\bpv\b|s[ée]ance\s+du\s+conseil|r[èe]glement\s+(?:de\s+)?zonage|urbanisme/i;
const AVIS_HINT = /avis\s+public|entr[ée]e?\s+en\s+vigueur|promulgation/i;
const CERTIFICAT_HINT = /certificat\s+de\s+conformit|certificat|conformit/i;
const PV_HINT = /proc[èe]s[-\s]*verb(?:al|aux)|\bpv\b|s[ée]ance\s+du\s+conseil/i;

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function decodeHref(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&#x2f;/gi, "/")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

/** Classifies the extraction result without calling a missing text layer a miss. */
export function legalDateTextState(text: string | null, blocker: string | null): LegalDateTextState {
  if (text !== null) return "native-text";
  if (blocker === "pdf-without-native-text-layer") return "native-text-absent";
  if (blocker?.startsWith("pdftotext-exit-")) return "extractor-error";
  return "non-text-container";
}

/**
 * A source class is deliberately only a review hint.  A `pv-mrc-ambiguous`
 * result is never upgraded here: art. 137.3 requires the delivered certificate,
 * not merely the MRC deliberation that can precede it.
 */
export function legalDateSourceHint(value: string): LegalDateSourceHint | null {
  const discoverable = value.replace(/[-_./]+/g, " ");
  if (!LEGAL_HINT.test(discoverable)) return null;
  if (CERTIFICAT_HINT.test(discoverable)) return "certificat-mrc-candidate";
  if (AVIS_HINT.test(discoverable)) return "avis-public-candidate";
  if (PV_HINT.test(discoverable)) return "pv-mrc-ambiguous";
  return "legal-date-context";
}

/** Returns short printed contexts only; it neither parses nor validates a date. */
export function legalDateFragments(text: string, max = 24): LegalDateFragment[] {
  const out: LegalDateFragment[] = [];
  const seen = new Set<string>();
  const pages = text.split("\f");
  for (const [pageIndex, page] of pages.entries()) {
    const lines = page.split(/\r?\n/);
    for (let index = 0; index < lines.length && out.length < max; index++) {
      const line = lines[index] ?? "";
      const hint = legalDateSourceHint(line);
      if (hint === null) continue;
      const verbatim = compact(lines
        .slice(Math.max(0, index - 1), Math.min(lines.length, index + 2))
        .join(" "))
        .slice(0, 900);
      if (!verbatim || seen.has(`${hint}\u0000${verbatim}`)) continue;
      seen.add(`${hint}\u0000${verbatim}`);
      out.push({ hint, page: pages.length > 1 ? pageIndex + 1 : null, verbatim });
    }
  }
  return out;
}

/**
 * Extract only explicitly linked http(s) documents/pages whose own label or URL
 * bears a legal-date discovery fragment.  The caller must capture a returned
 * URL before reading it; no request happens in this helper.
 */
export function legalDateFollowUps(html: string, baseUrl: string, max = 80): LegalDateFollowUp[] {
  const base = new URL(baseUrl);
  const out: LegalDateFollowUp[] = [];
  const seen = new Set<string>();
  const href = /href\s*=\s*(["'])(.*?)\1/gi;
  const sitemapLoc = /<loc\b[^>]*>\s*([^<]+?)\s*<\/loc>/gi;
  const rawLinks = [
    ...[...html.matchAll(href)].map((match) => match[2] ?? ""),
    ...[...html.matchAll(sitemapLoc)].map((match) => match[1] ?? ""),
  ];
  for (const candidate of rawLinks) {
    const raw = decodeHref(candidate).trim();
    if (!raw || raw.startsWith("#") || /^(?:mailto:|tel:|javascript:)/i.test(raw)) continue;
    let url: URL;
    try {
      url = new URL(raw, base);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    url.hash = "";
    const hint = legalDateSourceHint(`${raw} ${url.pathname}`);
    if (hint === null || seen.has(url.href)) continue;
    seen.add(url.href);
    out.push({ url: url.href, hint, external_host: url.host !== base.host });
    if (out.length >= max) break;
  }
  return out;
}
