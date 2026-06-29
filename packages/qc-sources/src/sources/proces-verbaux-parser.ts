import { z } from "zod";

/**
 * Pure parser + zonage-change detector for municipal procès-verbaux (PV) text.
 *
 * A PV is the verbatim transcript of a municipal council session. This module
 * implements WP A.2.2: given the plain text of a PV (HTML or pdftotext output),
 * detect the "avis de motion → n° règlement → changement de zonage" chain that
 * signals a residential densification opportunity.
 *
 * ANTI-INVENTION (rules/MASTER.md §Scraping Policy + Fair Benchmarking §ABSOLUTE):
 * - Nothing is fabricated. A field is only populated when the pattern matches
 *   verbatim bytes from the real document.
 * - High-precision rules first: `avis de motion` + `règlement de zonage` wording
 *   is required to fire the `changementZonage: true` flag.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Item schema
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Document type carried by an enumerated index item.
 *
 *  - "proces-verbal"   — the verbatim transcript (the value-bearing document).
 *  - "ordre-du-jour"   — the agenda published before a session (kept but typed
 *                        so downstream can de-prioritise / skip it).
 *  - "document"        — a PV-section document whose subtype is undetermined.
 */
export const PvDocType = z.enum(["proces-verbal", "ordre-du-jour", "document"]);
export type PvDocTypeT = z.infer<typeof PvDocType>;

/** One PV item enumerated by the index page (before fetching the full text). */
export const PvIndexItem = z.object({
  /** Title / file name of the PV as displayed in the index. */
  title: z.string().min(1),
  /** Absolute URL of the PV document (HTML or PDF). */
  url: z.string().url(),
  /**
   * ISO date when parseable from the title/context, else NON_DISPONIBLE.
   * Full dates yield "YYYY-MM-DD"; month-year-only labels yield "YYYY-MM".
   */
  dateIso: z.string().min(1),
  /** Human-readable date label from the index, verbatim. */
  dateLabel: z.string().min(1),
  /** Whether the link is a procès-verbal, an ordre-du-jour, or undetermined. */
  docType: PvDocType,
});
export type PvIndexItemT = z.infer<typeof PvIndexItem>;

// ─────────────────────────────────────────────────────────────────────────────
// Detection result
// ─────────────────────────────────────────────────────────────────────────────

/** Result of `detectZonageChange` applied to the plain text of one PV. */
export const ZonageChangeDetection = z.object({
  /**
   * True when the text contains an "avis de motion" (or closely related wording
   * such as "avis de motion a été donné", "il donne avis de motion") in the
   * context of a règlement.
   */
  avisDeMotion: z.boolean(),
  /**
   * Règlement numbers that are themselves the OBJECT of an avis de motion for a
   * zonage change (new/proposed règlement numbers).  Only populated when the
   * immediate item context contains "zonage" / "règlement de zonage" /
   * "règlement d'urbanisme".  Empty when no zonage motion is detected.
   *
   * Anti-over-aggregation rule: each context is bounded by the enclosing
   * paragraph (previous and next \n\n), preventing cross-item contamination.
   * The règlement being MODIFIED ("modifiant le règlement de zonage numéro Y")
   * is excluded when a distinct NEW number exists in the same context; when
   * the modified number is the only one present (e.g. Châteauguay Z-3001),
   * it is retained.
   *
   * Verbatim, no fabrication.
   */
  reglementNumbers: z.array(z.string()),
  /**
   * True only when ALL THREE conditions hold (high-precision rule):
   *   1. `avisDeMotion` is true.
   *   2. At least one règlement number is present.
   *   3. The matching context explicitly names a change to the zonage / zoning.
   */
  changementZonage: z.boolean(),
  /**
   * Excerpt(s) of the verbatim PV text that triggered each positive detection,
   * limited to ~200 chars around the match for traceability.  Empty when
   * nothing fired.
   */
  excerpts: z.array(z.string()),
  /**
   * Zone codes mentioned in the same paragraph as the detected motion
   * (e.g. "H-521", "H-609").  Best-effort, may be empty.
   */
  zoneRefs: z.array(z.string()),
  /**
   * Free-text hint about the density type authorised, extracted verbatim when
   * the text mentions multi-family or densification keywords in the context of
   * the motion.  Null when absent (anti-invention).
   */
  densiteAutorisee: z.string().nullable(),
});
export type ZonageChangeDetectionT = z.infer<typeof ZonageChangeDetection>;

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

export const PV_NON_DISPONIBLE = "non-disponible";

/** Trim an excerpt to ~200 characters, centred on the match position. */
function trimExcerpt(text: string, matchIndex: number, window = 200): string {
  const half = Math.floor(window / 2);
  const start = Math.max(0, matchIndex - half);
  const end = Math.min(text.length, matchIndex + half);
  const raw = text.slice(start, end).replace(/\s+/g, " ").trim();
  return (start > 0 ? "…" : "") + raw + (end < text.length ? "…" : "");
}

// ─────────────────────────────────────────────────────────────────────────────
// Index-page parsers
// ─────────────────────────────────────────────────────────────────────────────

const FRENCH_MONTHS_PV: Record<string, string> = {
  janvier: "01", février: "02", fevrier: "02", mars: "03", avril: "04",
  mai: "05", juin: "06", juillet: "07", août: "08", aout: "08",
  septembre: "09", octobre: "10", novembre: "11",
  décembre: "12", decembre: "12",
};

/**
 * Extract an ISO date from a human label, most specific first:
 *   - "séance du 10 mars 2025" / "10 mars 2025"  → "2025-03-10"
 *   - "2025-03-10" / "2025/03/10"                → "2025-03-10"
 *   - "Mars 2025" (month + year, no day)         → "2025-03"  (YYYY-MM)
 *   - "pv-2025-03" (filename year-month)          → "2025-03"
 * Returns NON_DISPONIBLE when nothing parses.
 *
 * The month-only form (YYYY-MM) is intentional: many flat-list municipalities
 * label PVs by month ("Mars 2025") with no day. A YYYY-MM string still sorts
 * and window-filters correctly (lexicographic ≥/≤ against YYYY-MM-DD bounds).
 */
function extractIsoFromLabel(label: string): string {
  const lower = label.toLowerCase();

  // 1. Full French date: "10 mars 2025" or ordinal "1er octobre 2025"
  //    ("1er"/"1ᵉʳ"/"2e" — the ordinal suffix is consumed, not the day digit).
  const full = lower.match(
    /(\d{1,2})(?:er|re|e|ère|ème|ᵉʳ|ᵉ)?\s+([a-zàâçéèêëîïôûù]+)\s+(\d{4})/i,
  );
  if (full?.[1] && full[2] && full[3]) {
    const month = FRENCH_MONTHS_PV[full[2]];
    if (month) return `${full[3]}-${month}-${full[1].padStart(2, "0")}`;
  }

  // 2. ISO-ish numeric date: "2025-03-10" or "2025/03/10".
  const iso = lower.match(/\b(\d{4})[-/](\d{2})[-/](\d{2})\b/);
  if (iso?.[1] && iso[2] && iso[3]) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // 3. Month + year only: "mars 2025".
  const monthYear = lower.match(/\b([a-zàâçéèêëîïôûù]+)\s+(\d{4})\b/i);
  if (monthYear?.[1] && monthYear[2]) {
    const month = FRENCH_MONTHS_PV[monthYear[1]];
    if (month) return `${monthYear[2]}-${month}`;
  }

  // 4. Filename year-month: "pv-2025-03" / "2025_03".
  const fileYm = lower.match(/\b(20\d{2})[-_](0[1-9]|1[0-2])\b/);
  if (fileYm?.[1] && fileYm[2]) return `${fileYm[1]}-${fileYm[2]}`;

  return PV_NON_DISPONIBLE;
}

/** Decode minimal HTML entities in a fragment. */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&eacute;/g, "é")
    .replace(/&egrave;/g, "è")
    .replace(/&ecirc;/g, "ê")
    .replace(/&agrave;/g, "à")
    .replace(/&laquo;/g, "«")
    .replace(/&raquo;/g, "»")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip all HTML tags from a fragment. */
function stripTags(s: string): string {
  return decodeHtmlEntities(s.replace(/<[^>]+>/g, " "));
}

/**
 * Resolve an href (possibly relative) against a base URL.
 *
 * Handles every relative form WHATWG URL resolution supports, which the old
 * parser did not: protocol-relative (`//host/x`), root-absolute (`/x`),
 * directory-relative (`./x`, `../../x`) and bare-path (`x/y.pdf`). The base is
 * the document's effective base: a `<base href>` when the page declares one,
 * otherwise the index URL.
 *
 * Returns null for in-page anchors (`#…`), `javascript:`/`mailto:`/`tel:` URIs
 * and anything that fails to resolve to an http(s) URL.
 */
function resolveHref(href: string, base: string): string | null {
  const raw = decodeHtmlEntities(href).trim();
  if (!raw) return null;
  if (/^(?:#|javascript:|mailto:|tel:|data:)/i.test(raw)) return null;
  try {
    const resolved = new URL(raw, base);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      return null;
    }
    // Drop the fragment; keep query (it may be the document selector).
    resolved.hash = "";
    return resolved.href;
  } catch {
    return null;
  }
}

/**
 * Normalise a URL to its registrable site (host with a leading "www." stripped),
 * lower-cased. Used for same-site comparison so `www.beloeil.ca` and `beloeil.ca`
 * match while `sto.ca` vs `gatineau.ca` stay distinct. Returns null on a
 * malformed URL.
 */
function registrableSite(u: string): string | null {
  try {
    return new URL(u).host.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Read the document's `<base href>` if present, else fall back to the index URL. */
function effectiveBase(html: string, indexUrl: string): string {
  const m = html.match(/<base\b[^>]*href=["']([^"']+)["']/i);
  if (m?.[1]) {
    try {
      return new URL(m[1], indexUrl).href;
    } catch {
      // Malformed <base> — ignore, use the index URL.
    }
  }
  return indexUrl;
}

/** True when the href points at a PV-style document (PDF, DOC, or a download endpoint). */
function looksLikeDocumentHref(url: string): boolean {
  return (
    /\.(?:pdf|docx?|odt)(?:[?#].*)?$/i.test(url) ||
    /[?&](?:download|telechargement|getfile|fichier|file|attachment)=/i.test(url) ||
    /\/(?:download|telecharger|getfile|fichier)[/?]/i.test(url)
  );
}

const ODJ_LABEL_RE = /ordre\s+du\s+jour|\bodj\b|^od[-_ ]|\bagenda\b/i;
const PV_LABEL_RE =
  /proc[èe]s[-\s]?verbal|proc[èe]s[-\s]?verbaux|\bpv\b|s[ée]ance|\bprocès\b/i;
const SESSION_MONTH_LABEL_RE =
  /\b(?:janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\b/i;

/** Classify a document link by its label + filename (best-effort, never throws). */
function classifyDocType(label: string, url: string): PvDocTypeT {
  const hay = `${label} ${url}`;
  if (ODJ_LABEL_RE.test(hay)) return "ordre-du-jour";
  if (PV_LABEL_RE.test(hay) || /\bpv[-_]/i.test(url)) return "proces-verbal";
  return "document";
}

/**
 * Parse a WordPress-style or plain HTML PV index page.
 *
 * Strategy: scan every `<a href>` in the page and KEEP a link when EITHER
 *   - its label looks like a PV / séance / ordre-du-jour, OR
 *   - the href points at a document (`.pdf`/`.doc(x)`/download endpoint),
 * after resolving the href against the document's effective base (a `<base
 * href>` when present, else the index URL). Links to a different host than the
 * index are dropped (anti sto.ca / outbound capture). Tolerates a wide range of
 * CMS markups (WordPress, October, Drupal, static HTML, .php flat lists)
 * because every Québec municipality page is different.
 *
 * JS-rendered families (gestionweblex SaaS, ASP.NET portals) emit ZERO links
 * from the static HTML — callers should consult `detectIndexRenderMode` first
 * and route those to the headless-browser (obscura) path rather than trusting
 * an empty/erroneous static parse.
 */
export function parsePvIndex(html: string, baseUrl: string): PvIndexItemT[] {
  const items: PvIndexItemT[] = [];
  const seen = new Set<string>();

  // JS-rendered families (gestionweblex SaaS, ASP.NET portals) inject the PV
  // list at runtime; the static HTML holds only chrome/nav. Returning nothing
  // is the honest outcome — the caller routes these to obscura. Emitting the
  // sibling nav links would be worse than empty (false documents).
  if (detectIndexRenderMode(html).requiresBrowser) return items;

  const base = effectiveBase(html, baseUrl);
  // Allowed sites: the index site AND the effective-base site, by registrable
  // domain (leading "www." stripped). Used ONLY to gate NON-document outbound
  // links: a municipality routinely hosts PV PDFs on a different domain/subdomain
  // (CDN, ville.X.qc.ca, a document portal), so a *document* link is kept even
  // cross-site, while a non-document outbound link (sto.ca header nav, social
  // media) is dropped — that is what made gatineau capture sto.ca at the pilot.
  const allowedSites = new Set<string>();
  for (const u of [baseUrl, base]) {
    const site = registrableSite(u);
    if (site) allowedSites.add(site);
  }

  // Match every <a …>…</a> in the page.
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(anchorRe)) {
    const attrs = m[1] ?? "";
    const inner = stripTags(m[2] ?? "");

    const hrefMatch =
      attrs.match(/(?:^|\s)href=["']([^"']+)["']/i);
    const url = resolveHref(hrefMatch?.[1] ?? "", base);
    if (!url) continue;

    // Accept links that are clearly PV documents.
    const isDoc = looksLikeDocumentHref(url);
    const labelLower = inner.toLowerCase();
    const isPvLabel =
      PV_LABEL_RE.test(labelLower) || ODJ_LABEL_RE.test(labelLower);

    // Drop NON-document outbound links (sto.ca header nav, social media). A
    // document link is kept even cross-site because municipalities legitimately
    // host PV PDFs on a separate domain/subdomain (e.g. boisbriand.ca index →
    // ville.boisbriand.qc.ca CDN). This is what prevented gatineau capturing
    // sto.ca while keeping every legitimate cross-domain PDF.
    if (!isDoc && allowedSites.size > 0) {
      const site = registrableSite(url);
      if (!site || !allowedSites.has(site)) continue;
    }

    // A document href is accepted regardless of label wording (flat lists label
    // PVs only by month, e.g. "Mars 2025"). A non-document href is accepted only
    // when the label itself is PV-ish AND it is not a bare same-site navigation
    // page (those are filtered out below by the document/keyword requirement).
    if (!isDoc && !isPvLabel) continue;

    if (seen.has(url)) continue;
    seen.add(url);

    const title = inner || url.split("/").pop() || url;
    // For month-only labels with no month name in the visible text, fall back to
    // the filename (e.g. "pv-2025-03.pdf") to recover a YYYY-MM date.
    const dateSource = SESSION_MONTH_LABEL_RE.test(title) || /\d{4}/.test(title)
      ? title
      : `${title} ${url}`;
    const dateIso = extractIsoFromLabel(dateSource);
    const parsed = PvIndexItem.safeParse({
      title,
      url,
      dateIso,
      dateLabel: title,
      docType: classifyDocType(title, url),
    });
    if (parsed.success) items.push(parsed.data);
  }

  return items;
}

// ─────────────────────────────────────────────────────────────────────────────
// Render-mode detection (obscura routing)
// ─────────────────────────────────────────────────────────────────────────────

/** Result of `detectIndexRenderMode`. */
export interface IndexRenderMode {
  /** True when the PV list is rendered client-side (needs a headless browser). */
  requiresBrowser: boolean;
  /** Short, verbatim reason (the matched marker) for traceability. */
  reason: string;
}

/**
 * JS-rendered / SaaS index families whose PV list is injected at runtime. For
 * these the static HTML carries no usable document link, so a static parse
 * silently returns nothing (or, worse, captures sibling/outbound links). The
 * RECUEIL job must route these to the headless-browser (obscura) path.
 *
 * Each marker is a substring matched against the raw index HTML, most specific
 * first. Markers are taken verbatim from the real pages (gestionweblex SaaS,
 * gatineau ASP.NET portal) — see proces-verbaux-link-extraction.fixture.ts.
 */
const BROWSER_REQUIRED_MARKERS: ReadonlyArray<{ marker: RegExp; reason: string }> = [
  { marker: /apps\.gestionweblex\.ca\/+doc-list/i, reason: "gestionweblex doc-list (client-side rendered)" },
  { marker: /gestionweblex\.ca\/+doc-list\/assets\/list\.ashx/i, reason: "gestionweblex doc-list list.ashx (client-side rendered)" },
  { marker: /id=["']liste-documents["'][^>]*>\s*<!--/i, reason: "ASP.NET portal — document list injected by scripts.js" },
  { marker: /default\.aspx[^"']*proces_verbaux/i, reason: "ASP.NET default.aspx portal (postback-rendered)" },
];

/**
 * Decide whether a PV index page can be parsed from its static HTML, or whether
 * it needs a headless browser (obscura). Returns `requiresBrowser: true` with a
 * verbatim reason for the JS-rendered families above; otherwise false.
 *
 * Pure + side-effect-free: callers gate on it BEFORE trusting `parsePvIndex`.
 */
export function detectIndexRenderMode(html: string): IndexRenderMode {
  for (const { marker, reason } of BROWSER_REQUIRED_MARKERS) {
    if (marker.test(html)) return { requiresBrowser: true, reason };
  }
  return { requiresBrowser: false, reason: "static HTML" };
}

/**
 * Filter a list of PV index items to those whose date falls within [since, until].
 *
 * Conservative by design (anti-false-negative — we would rather fetch one extra
 * PV than miss a zonage change):
 *   - NON_DISPONIBLE dates are always included.
 *   - Month-only dates ("YYYY-MM") are expanded to their whole-month span
 *     [YYYY-MM-01, YYYY-MM-31] and kept when that span OVERLAPS the window, so a
 *     PV labelled only by month near a window boundary is not silently dropped.
 */
export function filterPvByWindow(
  items: PvIndexItemT[],
  since: string,
  until: string,
): PvIndexItemT[] {
  return items.filter((item) => {
    if (item.dateIso === PV_NON_DISPONIBLE) return true;
    // Month-only "YYYY-MM": overlap test against the whole month.
    if (/^\d{4}-\d{2}$/.test(item.dateIso)) {
      const monthStart = `${item.dateIso}-01`;
      const monthEnd = `${item.dateIso}-31`;
      return monthStart <= until && monthEnd >= since;
    }
    return item.dateIso >= since && item.dateIso <= until;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Zonage-change detector
// ─────────────────────────────────────────────────────────────────────────────

/**
 * High-precision regex patterns for the "avis de motion → règlement de zonage"
 * chain in Québec municipal PV text.
 *
 * Rule: `avis de motion` fires only when:
 *   1. The phrase "avis de motion" (or "avis de motion a été donné", "donne avis
 *      de motion") appears.
 *   2. Within the same paragraph (~400 chars), a règlement number is cited AND
 *      the text references "zonage" (directly or via "règlement de zonage" /
 *      "règlement d'urbanisme" / "modifier le règlement").
 *
 * Multi-family / densification keywords (habitation multifamiliale, bifamiliale,
 * logements multiples, densification, maison de chambres, …) are used to populate
 * `densiteAutorisee` when present in the same context.
 *
 * Nothing is invented: the detector fires ONLY on verbatim bytes.
 */
const AVIS_MOTION_RE =
  /(?:avis\s+de\s+motion(?:\s+a\s+[eé]t[eé]\s+donn[eé])?|(?:donne|doit\s+donner|lui\s+donne)\s+avis\s+de\s+motion)/gi;

/**
 * Règlement-number pattern (Québec municipal numbering):
 *  - Sequential (Valleyfield style): 150-49, 209-47, 216-34, 701-102
 *    → 2–3 digits "-" 1–3 digits
 *  - Year-prefixed (Beauharnois / newer style): 2024-58, 2025-11
 *    → (19|20)YY "-" 1–3 digits
 * Both must be preceded by "règlement" to avoid false positives on lot ids.
 */
const REGLEMENT_NUMBER_RE =
  /r[eè]glement\s+(?:n(?:[o°º]|um[eé]ro)?\s*\.?\s*)?(\d{2,4}-\d{1,4})\b/gi;

/**
 * Z-prefix règlement-number pattern for municipalities using letter-prefixed
 * numbering (e.g. Châteauguay: Z-3001, G-062-22; Mirabel: U-2300).
 *
 * PRECISION GUARD: requires the full phrase "règlement de zonage" immediately
 * before the letter-prefix number. This prevents misidentifying zone codes
 * (e.g. "zone C-754") or non-zonage bylaws ("règlement de construction Z-3300")
 * as règlement numbers.  Group 1 captures the letter-prefixed number.
 *
 * Extended (2026-06): allows an optional n°/nº/numéro between "zonage" and
 * the letter-prefix code, to handle municipalities like Mirabel that write
 * "règlement de zonage numéro U-2300" (with "numéro" interposed).
 * Precision is preserved: the "règlement de zonage" prefix is still required.
 */
const REGLEMENT_ZONAGE_LETTER_RE =
  /r[eè]glement\s+de\s+zonage\s+(?:n(?:[o°º]|um[eé]ro)?\s*[.°º]?\s*)?([A-Z]-\d{3,4})\b/gi;

/**
 * Non-hyphenated integer règlement-number pattern for municipalities using
 * sequential plain-integer numbering (e.g. Deux-Montagnes: 1767, 1768;
 * Saint-Eustache: 1998, 1675).
 *
 * ANTI-FAUX-POSITIF guards:
 *   1. The integer must be immediately preceded by "règlement [optional zonage
 *      qualifier] n°/nº/no/numéro" — bare integers (years, lot counts,
 *      article numbers) are never matched.
 *   2. The pattern is ONLY applied by `extractReglementNumbers` when the
 *      context window already contains a ZONAGE_KEYWORDS_RE match.
 *   3. Negative lookahead `(?!-\d)` prevents matching the integer prefix of
 *      a hyphenated number (e.g. "1200-93" would give "1200" without this).
 *
 * Handles: nº (U+00BA masculine ordinal), n° (U+00B0 degree sign), no, numéro.
 * Group 1 captures the 3-or-4-digit integer.
 */
const REGLEMENT_NOHYPHEN_RE =
  /r[eè]gl(?:ement)?\s*[.]?\s+(?:(?:de\s+)?(?:zonage|lotissement|construction)\s+|d[''']urbanisme\s+)?n(?:[o°º]|um[eé]ro)?\s*[.°º]?\s*(\d{3,4})\b(?!-\d)/gi;

/**
 * V-prefix règlement-number pattern for municipalities using compound-prefix
 * numbering (e.g. Saint-Rémi: V654-2026-33, V655-2026-03).
 *
 * Format: one uppercase letter + 2–4 digits + "-" + 4-digit year + "-" + 1–3 digits.
 *
 * PRECISION GUARD: only applied when the surrounding context window already
 * contains a "règlement de zonage" keyword (checked by the caller), preventing
 * false positives from other V-prefix bylaws such as tarification (V700-2026-09).
 * Group 1 captures the full V-prefix number.
 */
const REGLEMENT_VPREFIX_RE =
  /r[eè]glement\s+(?:n(?:[o°]|um[eé]ro)?\s*\.?\s*)?([A-Z]\d{2,4}-\d{4}-\d{1,3})\b/gi;

/**
 * Multi-letter-prefix règlement-number pattern for municipalities using 2–4
 * uppercase-letter prefixes (e.g. Lorraine: URB-03-17; Coteau-du-Lac: URB-400).
 *
 * Format: 2–4 uppercase letters + "-" + 2–4 digits + optional "-" + 1–3 digits.
 * Examples: URB-400, URB-03-17.
 *
 * ANTI-FAUX-POSITIF guards:
 *   1. The code must be immediately preceded by "règlement" (with optional
 *      "de zonage / de l'urbanisme" qualifier and optional n°/nº/numéro).
 *      This prevents capturing zone codes like RO-2, I-133 (those are never
 *      preceded by "règlement" — they follow "zone" or "zones").
 *   2. This pattern is ONLY applied by `extractReglementNumbers` when the
 *      context window already contains a ZONAGE_KEYWORDS_RE match, preventing
 *      false positives from non-zonage bylaws with multi-letter prefixes
 *      (e.g. Boisbriand RV-1787-1 tarifs, RV-1796 réserve financière —
 *      their avis de motion context has no "zonage" keyword).
 *   3. Single-digit codes (e.g. RO-2, RO-7 as zone references) have 1 digit
 *      after the dash — they do NOT satisfy \d{2,4} (min 2 digits), so they
 *      are never captured by this pattern (captured as zoneRefs instead via
 *      ZONE_CODE_CONTEXT_RE when preceded by "zone ").
 *
 * Group 1 captures the full multi-letter-prefix number (e.g. "URB-400",
 * "URB-03-17").
 */
const REGLEMENT_MULTIPREFIX_RE =
  /r[eè]glement\s+(?:de\s+(?:zonage|l[''']urbanisme)\s+)?(?:n(?:[o°º]|um[eé]ro)?\s*[.°º]?\s*)?([A-Z]{2,4}-\d{2,4}(?:-\d{1,3})?)\b/gi;

/** Zone code pattern (matches Valleyfield codes like H-521, C-627-3). All-uppercase. */
const ZONE_CODE_RE = /\b([A-Z]{1,4}-\d{2,4}(?:-\d{1,3})?)\b/g;

/**
 * Mixed-case zone code pattern for municipalities using non-standard casing
 * (e.g. Sainte-Martine: MxtV-2).
 *
 * PRECISION GUARD: requires the literal word "zone " immediately before the
 * code. This ensures only genuine zone designators are captured and prevents
 * ordinary words or règlement numbers from being mistaken for zone codes.
 * Allows 1–4 letters (mixed case) followed by "-" and 1–4 digits.
 * Group 1 captures the zone code (preserving verbatim casing).
 */
const ZONE_CODE_CONTEXT_RE = /\bzone\s+([A-Za-z]{1,4}-\d{1,4}(?:-\d{1,3})?)\b/gi;

/**
 * Keywords that indicate a change to the zoning bylaw (high-precision).
 *
 * Only ZONING-SPECIFIC terms qualify. Generic "modifier le règlement" /
 * "modification du règlement" were intentionally removed: they match any bylaw
 * amendment (e.g. a circulation or borrowing bylaw) and caused false positives
 * (e.g. Sainte-Catherine 2026-05, a circulation bylaw). Genuine zoning changes
 * always reference "zonage" or "règlement d'urbanisme" (verified across the
 * Saint-Damase, Saint-Constant and Valleyfield fixtures).
 */
const ZONAGE_KEYWORDS_RE =
  /\b(?:zonage|r[eè]glement\s+de\s+zonage|r[eè]glement\s+d[''']urbanisme)\b/i;

/** Multi-family / densification keywords (best-effort, only for densiteAutorisee). */
const DENSITE_RE =
  /(?:habitation\s+multifamiliale|bifamiliale|trifamiliale|maison\s+de\s+chambres|logements?\s+multiples?|logements?\s+locatifs?|densification|multi\s*[-–]\s*logements?|maison\s+de\s+rapport|plex\b|duplex\b|triplex\b|quadruplex\b|immeuble\s+(?:r[eé]sidentiel|locatif)|appartements?\s+(?:ou\s+)?logements?|r[eé]sidentiel\s+(?:multi|densif))/i;

/**
 * Extract all règlement numbers cited in a text window (case-insensitive,
 * deduped, verbatim).
 *
 * Handles five numbering styles:
 *   - Hyphenated digit-only (e.g. 1926-26, 2024-58): via REGLEMENT_NUMBER_RE
 *   - Single-letter-prefix zonage bylaws (e.g. Z-3001, U-2300): via
 *     REGLEMENT_ZONAGE_LETTER_RE (requires "règlement de zonage" prefix, with
 *     optional n°/numéro interposed for Mirabel-style "zonage numéro U-2300")
 *   - Compound V-prefix zonage bylaws (e.g. V654-2026-33): via REGLEMENT_VPREFIX_RE
 *     (only applied when the context already contains a "règlement de zonage"
 *     keyword, preventing false positives from non-zonage V-prefix bylaws such as
 *     tarification — V700-2026-09)
 *   - Non-hyphenated 3-4 digit integers (e.g. 1767, 1998): via REGLEMENT_NOHYPHEN_RE
 *     (only applied when the context already contains a ZONAGE_KEYWORDS_RE match,
 *     AND the number is immediately preceded by "règlement n°/nº/no/numéro" —
 *     never captures bare integers like years or lot counts)
 *   - Multi-letter-prefix zonage bylaws (e.g. URB-400, URB-03-17): via
 *     REGLEMENT_MULTIPREFIX_RE (only applied when the context already contains a
 *     ZONAGE_KEYWORDS_RE match, preventing false positives from non-zonage
 *     multi-prefix bylaws such as Boisbriand RV-1787-1 tarifs, RV-1796 réserve)
 */
function extractReglementNumbers(window: string): string[] {
  const numbers: string[] = [];
  const re = new RegExp(REGLEMENT_NUMBER_RE.source, "gi");
  for (const m of window.matchAll(re)) {
    if (m[1]) numbers.push(m[1]);
  }
  const reZ = new RegExp(REGLEMENT_ZONAGE_LETTER_RE.source, "gi");
  for (const m of window.matchAll(reZ)) {
    if (m[1]) numbers.push(m[1]);
  }
  // V-prefix compound numbers (e.g. V654-2026-33): only apply when context
  // explicitly references "règlement de zonage" to avoid catching non-zonage
  // V-prefix bylaws (e.g. tarification V700-2026-09).
  if (ZONAGE_KEYWORDS_RE.test(window)) {
    const reV = new RegExp(REGLEMENT_VPREFIX_RE.source, "gi");
    for (const m of window.matchAll(reV)) {
      if (m[1]) numbers.push(m[1]);
    }
    // Non-hyphenated integers (e.g. Deux-Montagnes 1767, Saint-Eustache 1998):
    // only applied in a confirmed zonage context to prevent false positives.
    const reNH = new RegExp(REGLEMENT_NOHYPHEN_RE.source, "gi");
    for (const m of window.matchAll(reNH)) {
      if (m[1]) numbers.push(m[1]);
    }
    // Multi-letter-prefix numbers (e.g. URB-400, URB-03-17): only applied in a
    // confirmed zonage context to prevent false positives from non-zonage bylaws
    // that use similar prefixes (Boisbriand RV-1787-1 tarifs, RV-1796 réserve).
    const reMP = new RegExp(REGLEMENT_MULTIPREFIX_RE.source, "gi");
    for (const m of window.matchAll(reMP)) {
      if (m[1]) numbers.push(m[1]);
    }
  }
  return Array.from(new Set(numbers));
}

/**
 * Extract zone codes from a text window (deduped), excluding codes that are
 * actually règlement numbers.
 *
 * Two passes:
 *   Pass A — standard all-uppercase codes (ZONE_CODE_RE): matches H-521, C-627-3.
 *   Pass B — mixed-case codes preceded by "zone " (ZONE_CODE_CONTEXT_RE): matches
 *     MxtV-2 and similar non-standard municipal zone designators that cannot be
 *     captured by the all-uppercase pattern.
 *
 * Two-pass exclusion (applied to both):
 *   1. Any code already captured by `reglementNumbers` (e.g. Z-3001 captured
 *      via REGLEMENT_ZONAGE_LETTER_RE) is excluded from zoneRefs.
 *   2. Any code immediately preceded (within 40 chars) by the word "règlement"
 *      (with or without context "de zonage", "de construction", etc.) is
 *      excluded — those are bylaw identifiers, not zone designators.
 *      Example: "règlement de construction Z-3300" → Z-3300 excluded.
 *
 * This prevents pollution of the form zoneRefs=[C-754,C-810,H-812,Z-3001,Z-3300]
 * and produces the expected zoneRefs=[C-754,C-810,H-812].
 * For Sainte-Martine, "zone MxtV-2" is captured by Pass B → zoneRefs=[MxtV-2].
 */
function extractZoneCodes(window: string, reglementNumbers: string[] = []): string[] {
  const reglementSet = new Set(reglementNumbers.map((r) => r.toUpperCase()));
  const codes: string[] = [];

  // Pass A: standard all-uppercase zone codes.
  const re = new RegExp(ZONE_CODE_RE.source, "g");
  for (const m of window.matchAll(re)) {
    const code = m[1];
    if (!code) continue;
    // Exclude codes already identified as règlement numbers.
    if (reglementSet.has(code.toUpperCase())) continue;
    // Exclude codes preceded by "règlement" within 40 chars (bylaw identifiers).
    const matchStart = m.index ?? 0;
    const lookback = window.slice(Math.max(0, matchStart - 40), matchStart);
    if (/r[eè]glement\b/i.test(lookback)) continue;
    codes.push(code);
  }

  // Pass B: mixed-case zone codes that require the "zone " context prefix.
  // Only captures codes NOT already found by Pass A (case-insensitive dedup).
  const existingUpper = new Set(codes.map((c) => c.toUpperCase()));
  const reCtx = new RegExp(ZONE_CODE_CONTEXT_RE.source, "gi");
  for (const m of window.matchAll(reCtx)) {
    const code = m[1];
    if (!code) continue;
    // Exclude if already in règlement numbers or already captured by Pass A.
    if (reglementSet.has(code.toUpperCase())) continue;
    if (existingUpper.has(code.toUpperCase())) continue;
    codes.push(code);
  }

  return Array.from(new Set(codes));
}

/**
 * Pattern that matches a règlement number appearing as the TARGET of a
 * "modifiant" / "amendant" clause, e.g.:
 *   "modifiant le règlement de zonage numéro 2019-342"
 *   "amendant le règlement de zonage numéro V654-2017-00"
 *   "modifiant le règlement d'urbanisme numéro 150-49"
 *
 * Group 1 captures the number of the EXISTING (modified) règlement — NOT the
 * new proposed règlement that is the actual object of the avis de motion.
 *
 * Five sub-patterns cover all numbering styles:
 *   - Hyphenated digit-only modified numbers (e.g. 2019-342): MODIFIANT_REGLEMENT_RE
 *   - V-prefix modified numbers (e.g. V654-2017-00): MODIFIANT_REGLEMENT_VPREFIX_RE
 *   - Non-hyphenated integers in parenthetical form (e.g. 1733 from
 *     "modifiant le Règlement de zonage (Règl. n°1733)"): MODIFIANT_NOHYPHEN_RE
 *   - Non-hyphenated integers in replacement form (e.g. 1675 from
 *     "remplacer le règlement numéro 1675 en vigueur"): REMPLACER_NOHYPHEN_RE
 *   - Multi-letter-prefix modified numbers (e.g. URB-03 from
 *     "modifiant le « Règlement URB-03 sur le zonage »"): MODIFIANT_REGLEMENT_MULTIPREFIX_RE
 *
 * Used to distinguish new règlements (proposed) from referenced/modified ones
 * when both appear in the same context window.  If the context contains ONLY
 * modified règlement numbers (e.g. Châteauguay "modifiant le règlement de
 * zonage Z-3001" with no separate new number), the modified numbers are kept.
 */
const MODIFIANT_REGLEMENT_RE =
  /(?:modifiant|amendant)\s+le\s+r[eè]glement\s+(?:de\s+zonage|d[''']urbanisme)\s+(?:n(?:[o°]|um[eé]ro)?\s*\.?\s*)?(\d{2,4}-\d{1,4})\b/gi;

/** Same as MODIFIANT_REGLEMENT_RE but for V-prefix compound numbers (e.g. V654-2017-00). */
const MODIFIANT_REGLEMENT_VPREFIX_RE =
  /(?:modifiant|amendant)\s+le\s+r[eè]glement\s+(?:de\s+zonage|d[''']urbanisme)\s+(?:n(?:[o°]|um[eé]ro)?\s*\.?\s*)?([A-Z]\d{2,4}-\d{4}-\d{1,3})\b/gi;

/**
 * Non-hyphenated modified règlement numbers in parenthetical form.
 * Matches "modifiant le Règlement de zonage (Règl. n°1733)" → 1733.
 * Used for Deux-Montagnes-style resolutions where the base bylaw number
 * appears in parentheses after the zonage qualifier.
 */
const MODIFIANT_NOHYPHEN_RE =
  /(?:modifiant|amendant)\s+le\s+r[eè]gl(?:ement)?\.?\s+(?:de\s+zonage|d[''']urbanisme)\s+\(?r[eè]gl\.\s+n[°º]\s*(\d{3,4})\)?/gi;

/**
 * Non-hyphenated replacement règlement numbers.
 * Matches "remplacer le règlement numéro 1675 en vigueur" → 1675.
 * Requires n°/nº/no/numéro prefix (never captures bare integers).
 * Used for Saint-Eustache-style resolutions where a complete bylaw is replaced.
 */
const REMPLACER_NOHYPHEN_RE =
  /(?:remplacer|remplaçant|abroger|abrog[eé])\s+(?:le\s+)?r[eè]gl(?:ement)?\.?\s*(?:n[o°º]|num[eé]ro)\s*[.°º]?\s*(\d{3,4})\b(?!-\d)/gi;

/**
 * Multi-letter-prefix modified règlement numbers.
 *
 * Matches the OLD/existing zonage règlement when the text reads:
 *   "modifiant le [«] Règlement URB-03 sur le zonage"
 *   "modifiant le Règlement URB-03-00"
 *   "amendant le Règlement URB-400 de zonage"
 *
 * The "«" guillemet and optional qualifiers between "le" and "Règlement" are
 * handled by allowing any non-letter characters ([\W]*) between "le " and
 * "règlement".  Group 1 captures the multi-letter-prefix number.
 *
 * Used to distinguish the NEW proposed règlement (URB-03-17) from the OLD
 * modified règlement (URB-03) when both appear in the same context window.
 */
const MODIFIANT_REGLEMENT_MULTIPREFIX_RE =
  /(?:modifiant|amendant)\s+le\s+[\W]*r[eè]glement\s+([A-Z]{2,4}-\d{2,4}(?:-\d{1,3})?)\b/gi;

/**
 * Extract règlement numbers that are the TARGET of a "modifiant" / "amendant"
 * / "remplacer" clause within a context window (i.e. the OLD règlement being
 * amended or replaced, not the new proposed one).  Returns an empty set when
 * none are found.
 *
 * Handles hyphenated digit-only (2019-342), V-prefix (V654-2017-00),
 * non-hyphenated parenthetical (Règl. n°1733), replacement (numéro 1675),
 * and multi-letter-prefix (URB-03) forms.  These are EXCLUDED from
 * `reglementNumbers` when distinct new règlement numbers exist in the same
 * context.
 */
function extractModifiedReglementNumbers(window: string): Set<string> {
  const modified = new Set<string>();
  const re = new RegExp(MODIFIANT_REGLEMENT_RE.source, "gi");
  for (const m of window.matchAll(re)) {
    if (m[1]) modified.add(m[1]);
  }
  const reV = new RegExp(MODIFIANT_REGLEMENT_VPREFIX_RE.source, "gi");
  for (const m of window.matchAll(reV)) {
    if (m[1]) modified.add(m[1]);
  }
  const reNH = new RegExp(MODIFIANT_NOHYPHEN_RE.source, "gi");
  for (const m of window.matchAll(reNH)) {
    if (m[1]) modified.add(m[1]);
  }
  const reR = new RegExp(REMPLACER_NOHYPHEN_RE.source, "gi");
  for (const m of window.matchAll(reR)) {
    if (m[1]) modified.add(m[1]);
  }
  // Multi-letter-prefix modified règlements (e.g. URB-03 from
  // "modifiant le « Règlement URB-03 sur le zonage »").
  const reMP = new RegExp(MODIFIANT_REGLEMENT_MULTIPREFIX_RE.source, "gi");
  for (const m of window.matchAll(reMP)) {
    if (m[1]) modified.add(m[1]);
  }
  return modified;
}

/**
 * Given the full set of extracted règlement numbers and the set of "modified"
 * règlement numbers from "modifiant le règlement de zonage numéro Y" clauses,
 * return the subset that are genuinely NEW (the object of the avis de motion).
 *
 * Rule:
 *   - If there exist numbers NOT in the modified set → return only those.
 *   - If ALL extracted numbers are in the modified set (Châteauguay pattern:
 *     "modifiant le règlement de zonage Z-3001" with no distinct new number)
 *     → return all of them (the modified number is the best proxy for the
 *     règlement being changed).
 *
 * This preserves Châteauguay's Z-3001 and Saint-Constant's 1926-26 while
 * excluding 2019-342 (Sainte-Martine) and 1528-17 (Saint-Constant) from the
 * output when those modified-rule numbers appear alongside distinct new numbers.
 */
function filterNewReglements(
  allNumbers: string[],
  modifiedNumbers: Set<string>,
): string[] {
  const newNumbers = allNumbers.filter((n) => !modifiedNumbers.has(n));
  return newNumbers.length > 0 ? newNumbers : allNumbers;
}

/**
 * Regex to detect the PAST-TENSE reference form of "avis de motion":
 * "avis de motion a été donné".
 *
 * These appear in ATTENDU QUE / CONSIDÉRANT QUE clauses within the adoption
 * section of a resolution (e.g. "Attendu qu'un avis de motion a été donné lors
 * de la séance du …").  They reference a motion that was ALREADY given in a
 * previous clause — the relevant règlement information is in the FORWARD
 * direction (the "Que le conseil adopte … le règlement numéro X…" clause),
 * NOT in the backward direction.
 *
 * For these past-tense matches we suppress the backward window entirely to
 * prevent backward contamination from preceding Attendu clauses that may
 * reference other règlements (Sainte-Martine 2026-510 adoption section
 * references "modifié par le projet de Règlement numéro 2026-509").
 */
const AVIS_MOTION_PAST_TENSE_RE = /avis\s+de\s+motion\s+a\s+[eé]t[eé]\s+donn[eé]/i;

/**
 * Detect "avis de motion → changement de zonage" in the plain text of a PV.
 *
 * Algorithm:
 *   1. Find every occurrence of `AVIS_MOTION_RE` in the text.
 *   2. For each match, extract a context window:
 *      - ACTIVE form ("Donne avis de motion", "Avis de motion est donné"):
 *        backward window capped at the previous \n\n AND ±400 chars.  This
 *        handles PVs where the section header names the règlement BEFORE the
 *        motion phrase (Saint-Damase pattern) while preventing cross-item
 *        backward contamination (Sainte-Martine 2026-510 vs 2026-509).
 *      - PAST-TENSE form ("avis de motion a été donné"): ZERO backward window.
 *        These appear in ATTENDU QUE clauses; the règlement being adopted is
 *        named FORWARD.  Backward context only risks picking up references to
 *        other règlements from preceding Attendu lines.
 *      - BOTH forms: forward window capped at the next \n\n AND ±400 chars,
 *        preventing cross-item contamination (Vaudreuil-Dorion pattern).
 *      - EXTENDED FORWARD (ACTIVE form only): when the standard first-paragraph
 *        forward window already contains a règlement number but NO zonage keyword,
 *        the window is extended to the SECOND \n\n (capped at 800 chars total).
 *        This handles multi-paragraph resolution blocks where the section header
 *        names the règlement in one paragraph and the "règlement de zonage" clause
 *        appears in the next paragraph (Sainte-Thérèse ATTENDU → Sur proposition).
 *        Anti-FP guard: extension only fires when the first forward para has a
 *        règlement number — this prevents extending into the NEXT agenda item
 *        (Vaudreuil-Dorion: the forward para after the motion has no règlement
 *        number, so no extension occurs and changementZonage stays false).
 *   3. Within that window, look for a règlement number AND a zonage keyword.
 *   4. If both are present → `changementZonage: true` (high-precision).
 *      Only règlement numbers from zonage contexts are added to
 *      `reglementNumbers`; non-zonage motions do NOT contribute to the list.
 *   5. Modified-règlement exclusion: when the context contains both a NEW
 *      règlement number (the object of the avis de motion) and an OLD one (via
 *      "modifiant le règlement de zonage numéro Y" or "remplacer le règlement
 *      numéro Y"), only the new number is kept in `reglementNumbers`.  When
 *      only the old number exists (Châteauguay Z-3001: "d'un règlement modifiant
 *      le règlement de zonage Z-3001"), it is retained as the best identifier.
 *   6. If only a motion is present but no règlement/zonage → `avisDeMotion: true`
 *      but `changementZonage: false` (medium-confidence, reported separately).
 *
 * Returns a typed `ZonageChangeDetectionT` — never throws.
 */
export function detectZonageChange(pvText: string): ZonageChangeDetectionT {
  const allReglementNumbers: string[] = [];
  const allZoneRefs: string[] = [];
  const excerpts: string[] = [];
  let foundAvisDeMotion = false;
  let foundChangement = false;
  let densiteAutorisee: string | null = null;

  const WINDOW = 400; // chars each side of the motion phrase

  const motionRe = new RegExp(AVIS_MOTION_RE.source, "gi");
  for (const m of pvText.matchAll(motionRe)) {
    const idx = m.index ?? 0;
    const matchEnd = idx + (m[0]?.length ?? 0);
    const isPastTense = AVIS_MOTION_PAST_TENSE_RE.test(m[0] ?? "");

    // Backward window:
    //   - Past-tense form: zero backward window (règlement info is in the
    //     forward "Que le conseil adopte…" clause, not behind the match).
    //   - Active form: capped at the previous \n\n paragraph separator AND at
    //     400 chars before the match, whichever is MORE recent.
    let ctxStart: number;
    if (isPastTense) {
      ctxStart = idx;
    } else {
      const prevParaBreak = pvText.lastIndexOf("\n\n", idx);
      ctxStart = prevParaBreak === -1
        ? Math.max(0, idx - WINDOW)
        : Math.max(prevParaBreak + 2, idx - WINDOW);
    }

    // Forward window: standard cap at the next \n\n AND 400 chars.
    // Extended cap (ACTIVE form only): when the first forward paragraph already
    // contains a règlement number but NO zonage keyword, extend to the second
    // \n\n (capped at 800 chars total).  This covers multi-paragraph resolution
    // blocks (Sainte-Thérèse: ATTENDU para → Sur proposition para with zonage).
    // Anti-FP: only extends when the first para has a règlement number, which
    // prevents reaching into the next unrelated agenda item (Vaudreuil-Dorion).
    const nextParaBreak1 = pvText.indexOf("\n\n", matchEnd);
    const nextParaBreak2 = nextParaBreak1 !== -1
      ? pvText.indexOf("\n\n", nextParaBreak1 + 2)
      : -1;

    let ctxEnd: number;
    if (!isPastTense && nextParaBreak2 !== -1) {
      // Check the first forward para for a règlement number (without zonage)
      const fwdPara1End = nextParaBreak1 === -1 ? pvText.length : nextParaBreak1;
      const fwdPara1 = pvText.slice(matchEnd, fwdPara1End);
      const fwdHasRegl = new RegExp(REGLEMENT_NUMBER_RE.source, "gi").test(fwdPara1);
      const fwdHasZonage = ZONAGE_KEYWORDS_RE.test(fwdPara1);
      if (fwdHasRegl && !fwdHasZonage) {
        // Extend to second paragraph break (max 800 chars forward)
        ctxEnd = Math.min(matchEnd + WINDOW * 2, nextParaBreak2);
      } else {
        ctxEnd = nextParaBreak1 === -1
          ? Math.min(pvText.length, matchEnd + WINDOW)
          : Math.min(matchEnd + WINDOW, nextParaBreak1);
      }
    } else {
      ctxEnd = nextParaBreak1 === -1
        ? Math.min(pvText.length, matchEnd + WINDOW)
        : Math.min(matchEnd + WINDOW, nextParaBreak1);
    }

    const ctx = pvText.slice(ctxStart, ctxEnd);

    const regNumbers = extractReglementNumbers(ctx);
    const hasZonageKw = ZONAGE_KEYWORDS_RE.test(ctx);
    // Pass regNumbers so that règlement identifiers (e.g. Z-3001) are not
    // also listed as zone codes in zoneRefs.
    const zoneCodes = extractZoneCodes(ctx, regNumbers);
    const densMatch = ctx.match(DENSITE_RE);

    foundAvisDeMotion = true;

    if (regNumbers.length > 0 && hasZonageKw) {
      foundChangement = true;
      // Precision filter: exclude the MODIFIED règlement number ("modifiant le
      // règlement de zonage numéro Y") when a distinct NEW number exists.
      const modifiedNums = extractModifiedReglementNumbers(ctx);
      const newNums = filterNewReglements(regNumbers, modifiedNums);
      allReglementNumbers.push(...newNums);
      allZoneRefs.push(...zoneCodes);
      excerpts.push(trimExcerpt(pvText, idx));
      if (densMatch && !densiteAutorisee) {
        densiteAutorisee = densMatch[0].replace(/\s+/g, " ").trim();
      }
    } else if (regNumbers.length > 0) {
      // Motion with règlement but no explicit zonage keyword — avisDeMotion
      // reported, but règlement numbers are NOT added to reglementNumbers
      // (which is reserved for zonage-specific règlements only).
      excerpts.push(trimExcerpt(pvText, idx));
    }
  }

  return ZonageChangeDetection.parse({
    avisDeMotion: foundAvisDeMotion,
    reglementNumbers: Array.from(new Set(allReglementNumbers)),
    changementZonage: foundChangement,
    excerpts,
    zoneRefs: Array.from(new Set(allZoneRefs)),
    densiteAutorisee,
  });
}
