import { z } from "zod";

/**
 * Pure parser for the Salaberry-de-Valleyfield "Règlements d'urbanisme" source —
 * the regulatory backbone behind the avis/designation events (WP4 Source #5).
 *
 * Two artifacts are parseable:
 *   1. the public HTML *listing* (Craft CMS) of bylaw detail pages, and
 *   2. the *text of a single règlement*, extracted from its public PDF via
 *      `pdftotext` (see `reglements-urbanisme-valleyfield.ts`). A règlement is a
 *      plain-text legal document: a header (`RÈGLEMENT 150-51`), a recital block,
 *      and numbered articles that name the base bylaw and the zones they modify.
 *
 * Everything is ANTI-INVENTION: a Bylaw or Zone exists only when its number/code
 * is present verbatim in the bytes. Nothing is fabricated; a field absent from
 * the document never becomes an entity.
 */

/** The public urbanisme-bylaw listing (Craft CMS), filtered to the category. */
export const REGLEMENTS_URBANISME_SOURCE_URL =
  "https://www.ville.valleyfield.qc.ca/reglements-municipaux?cat=reglement-durbanisme&terme=";

/** Public CloudFront CDN prefix that serves the bylaw PDFs (same CDN as avis). */
export const REGLEMENTS_URBANISME_PDF_PREFIX =
  "https://dua3m7xvptjbw.cloudfront.net/documents/reglements/";

/**
 * Placeholder used wherever a field cannot be extracted (anti-invention).
 * Module-prefixed so the package barrel (`export *`) does not collide with the
 * avis parser's identically-valued `REGLEMENT_NON_DISPONIBLE`.
 */
export const REGLEMENT_NON_DISPONIBLE = "non-disponible";

/**
 * A bylaw reference, e.g. "Règlement 450-02", "Règlement 150" or the header
 * "RÈGLEMENT 150-51". The number is only captured when it is introduced by the
 * word "Règlement"/"RÈGLEMENT" (ANTI-INVENTION: a bare 2–3 digit number in the
 * body — an article id like "Article 17", or the numeric tail of a zone code
 * like "521" in "H-521" — is NOT a bylaw and is never captured). A trailing `-NN`
 * amendment generation is optional. Global + case-insensitive.
 */
const BYLAW_REF_RE = /R[ÈE]GLEMENT\s+(\d{2,3}(?:-\d{1,3})?)\b/gi;

/**
 * A zone code as displayed on the Valleyfield zoning grid, e.g. "H-521",
 * "C-627-3", "I-918", "REC-137". The prefix is 1–4 uppercase letters (the
 * land-use family: H habitation, C commerce, U utilité publique, I industrie,
 * P parc, A agricole, plus multi-letter families like REC), followed by a 2–4
 * digit zone id and an optional `-N` sub-zone. Anchored so a bare bylaw number
 * (no letter prefix) is NEVER mistaken for a zone (anti-invention).
 */
const ZONE_CODE_RE = /\b[A-Z]{1,4}-\d{2,4}(?:-\d{1,3})?\b/g;

/** First letter of a zone code → coarse land-use kind (matches OntoZone.ZoneKind). */
export const ZONE_KIND_BY_PREFIX: Record<string, string> = {
  H: "H",
  C: "C",
  U: "U",
  I: "I",
  P: "P",
  A: "A",
};

/** Map a zone code to its coarse kind; unknown / multi-letter prefixes → "autre". */
export function zoneKindOf(code: string): string {
  const prefix = code.split("-")[0] ?? "";
  // Only a single-letter prefix in the known land-use set maps to a kind; a
  // multi-letter family (e.g. "REC") is real but coarse-classified "autre".
  if (prefix.length === 1 && prefix in ZONE_KIND_BY_PREFIX) {
    return ZONE_KIND_BY_PREFIX[prefix]!;
  }
  return "autre";
}

/** One bylaw extracted from a règlement document or listing entry. */
export const ReglementBylaw = z.object({
  /** City-scoped règlement number, verbatim (e.g. "150-51", "450"). */
  numero: z.string().min(1),
  /** Whether this is the document's own number (header) or a referenced bylaw. */
  role: z.enum(["primary", "referenced"]),
});
export type ReglementBylawT = z.infer<typeof ReglementBylaw>;

/** One zone code extracted from a règlement document, verbatim. */
export const ReglementZone = z.object({
  /** Displayed zone code, verbatim (e.g. "H-521", "C-627-3", "REC-137"). */
  code: z.string().min(1),
  /** Coarse land-use kind derived from the prefix ("H"|"C"|…|"autre"). */
  kind: z.string().min(1),
});
export type ReglementZoneT = z.infer<typeof ReglementZone>;

/** The structured result of parsing one règlement document's text. */
export const ReglementDocument = z.object({
  /** The document's own règlement number (header `RÈGLEMENT NNN-NN`), or REGLEMENT_NON_DISPONIBLE. */
  primaryNumero: z.string().min(1),
  /** Verbatim title line (e.g. "Règlement modifiant le Règlement 150 …"), or REGLEMENT_NON_DISPONIBLE. */
  titre: z.string().min(1),
  /** Every bylaw number present (primary + referenced), de-duplicated, in order. */
  bylaws: z.array(ReglementBylaw).default([]),
  /** Every zone code present, de-duplicated, in order of first appearance. */
  zones: z.array(ReglementZone).default([]),
});
export type ReglementDocumentT = z.infer<typeof ReglementDocument>;

/** Collapse whitespace and trim (PDF text extraction emits stray newlines). */
function squish(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

/**
 * Extract the document's own règlement number from the header line
 * `RÈGLEMENT 150-51` (or `Règlement 450-02`). Returns REGLEMENT_NON_DISPONIBLE when the
 * header is absent (anti-invention: never guessed from the body).
 */
export function extractPrimaryNumero(text: string): string {
  const m = text.match(/R[ÈE]GLEMENT\s+(\d{2,3}(?:-\d{1,3})?)\b/i);
  return m?.[1] ?? REGLEMENT_NON_DISPONIBLE;
}

/**
 * Extract the verbatim title line — the line after the header that begins with
 * "Règlement …" (typically "Règlement modifiant le Règlement NNN concernant …").
 * Returns REGLEMENT_NON_DISPONIBLE when no such line exists.
 */
export function extractTitre(text: string): string {
  // The header is `RÈGLEMENT NNN-NN`; the title is the FOLLOWING "Règlement …"
  // sentence up to the first recital ("ATTENDU"). Find the header, then the
  // first "Règlement" after it.
  const headerMatch = text.match(/R[ÈE]GLEMENT\s+\d{2,3}(?:-\d{1,3})?\b/i);
  const start = headerMatch ? (headerMatch.index ?? 0) + headerMatch[0].length : 0;
  const rest = text.slice(start);
  const titleMatch = rest.match(/R[èe]glement\s+(?:modifiant|concernant)[\s\S]*?(?=ATTENDU|LE CONSEIL|Article\b)/i);
  if (titleMatch) return squish(titleMatch[0]);
  return REGLEMENT_NON_DISPONIBLE;
}

/**
 * Extract every bylaw number present in the règlement text, de-duplicated and
 * tagged: the document's own header number is `primary`, every OTHER number
 * introduced by the word "Règlement" is `referenced`. ANTI-INVENTION: only a
 * number preceded by "Règlement" is captured — an article id ("Article 17"), a
 * dotted sub-article ("8.10") or the numeric tail of a zone code ("521" in
 * "H-521") is never miscounted as a bylaw.
 */
export function extractReglementBylaws(text: string): ReglementBylawT[] {
  const primary = extractPrimaryNumero(text);
  const seen = new Set<string>();
  const out: ReglementBylawT[] = [];
  if (primary !== REGLEMENT_NON_DISPONIBLE) {
    seen.add(primary);
    out.push({ numero: primary, role: "primary" });
  }
  for (const m of text.matchAll(BYLAW_REF_RE)) {
    const numero = m[1];
    if (!numero || seen.has(numero)) continue;
    seen.add(numero);
    out.push({ numero, role: "referenced" });
  }
  return out;
}

/**
 * Extract every zone code present in the règlement text, de-duplicated in order
 * of first appearance. A code is only captured when it carries a letter prefix
 * (so a bare bylaw number is never miscounted as a zone — anti-invention).
 */
export function extractZones(text: string): ReglementZoneT[] {
  const seen = new Set<string>();
  const out: ReglementZoneT[] = [];
  for (const code of text.match(ZONE_CODE_RE) ?? []) {
    if (seen.has(code)) continue;
    seen.add(code);
    out.push({ code, kind: zoneKindOf(code) });
  }
  return out;
}

/**
 * Parse one règlement document's extracted text into a structured record. Pure
 * and anti-invention: every bylaw number and zone code is verbatim from `text`.
 */
export function parseReglementDocument(text: string): ReglementDocumentT {
  const parsed = ReglementDocument.safeParse({
    primaryNumero: extractPrimaryNumero(text),
    titre: extractTitre(text),
    bylaws: extractReglementBylaws(text),
    zones: extractZones(text),
  });
  if (parsed.success) return parsed.data;
  // Defensive: should never fail since fields default sensibly. Return an empty
  // shell rather than throw (the adapter never throws on a parse).
  return {
    primaryNumero: REGLEMENT_NON_DISPONIBLE,
    titre: REGLEMENT_NON_DISPONIBLE,
    bylaws: [],
    zones: [],
  };
}

/** One bylaw detail-page entry parsed from the public HTML listing. */
export const ReglementListingEntry = z.object({
  /** Absolute detail-page URL. */
  url: z.string().url(),
  /** Bylaw number extracted from the slug (e.g. "150-51"), or REGLEMENT_NON_DISPONIBLE. */
  numero: z.string().min(1),
  /** Human-readable slug-derived title fragment (verbatim path tail). */
  slug: z.string().min(1),
});
export type ReglementListingEntryT = z.infer<typeof ReglementListingEntry>;

/**
 * Parse the public urbanisme-bylaw HTML listing into detail-page entries. Each
 * entry is an anchor whose href points at `/reglements-municipaux/<slug>`; the
 * règlement number is read from the slug (`projet-de-reglement-150-51-…` →
 * "150-51"). Entries with no extractable number keep REGLEMENT_NON_DISPONIBLE. Tolerant of
 * attribute order; nothing is fabricated.
 */
export function parseReglementListing(html: string): ReglementListingEntryT[] {
  const entries: ReglementListingEntryT[] = [];
  const seen = new Set<string>();
  const hrefRe = /href="([^"]*\/reglements-municipaux\/[^"#?]+)"/gi;
  for (const m of html.matchAll(hrefRe)) {
    const href = m[1]?.trim();
    if (!href) continue;
    // Resolve a relative href against the site origin.
    const url = href.startsWith("http")
      ? href
      : `https://www.ville.valleyfield.qc.ca${href.startsWith("/") ? "" : "/"}${href}`;
    if (seen.has(url)) continue;
    seen.add(url);
    const slug = url.split("/reglements-municipaux/")[1] ?? "";
    if (!slug) continue;
    const numMatch = slug.match(/reglement-(\d{2,3}(?:-\d{1,3})?)\b/i);
    const parsed = ReglementListingEntry.safeParse({
      url,
      numero: numMatch?.[1] ?? REGLEMENT_NON_DISPONIBLE,
      slug,
    });
    if (parsed.success) entries.push(parsed.data);
  }
  return entries;
}
