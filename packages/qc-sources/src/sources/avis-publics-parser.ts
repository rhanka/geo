import { z } from "zod";

/**
 * Pure parser for the Salaberry-de-Valleyfield "Avis publics" index page —
 * the proven ÉV11 parser, promoted out of the API automation service into the
 * sources package so the RECUEIL SourceAdapter and the legacy automation
 * connector share ONE implementation (No Legacy Fallback: no duplicate logic).
 *
 * The page is plain public HTML (Craft CMS) listing notices as anchors that
 * link to public PDFs:
 *
 *   <a class="icon-block icon-block--is-link" href="...notice.pdf" download>
 *     ...
 *     <div class="icon-block__title">Dérogations mineures du 20 mai 2026</div>
 *     <div class="icon-block__text icon-block__date">20 mai 2026</div>
 *   </a>
 *
 * Nothing is fabricated: a field absent from the page becomes "non-disponible".
 */

export const AVIS_PUBLICS_SOURCE_URL =
  "https://www.ville.valleyfield.qc.ca/avis-publics";

/**
 * Beauharnois avis-publics index — a SECOND CMS (WordPress block editor) whose
 * markup differs from Valleyfield's Craft theme: notices are `<details>` blocks
 * (`<summary>` title + `<p>` body) linking PDFs via `wp-block-file`. The shared
 * parser dispatches on markup so ONE module covers both cities (No Legacy
 * Fallback: no duplicate parser).
 */
export const AVIS_PUBLICS_BEAUHARNOIS_SOURCE_URL =
  "https://ville.beauharnois.qc.ca/la-ville/administration-et-vie-democratique/avis-publics";

/** Placeholder used wherever a field cannot be extracted (anti-invention). */
export const NON_DISPONIBLE = "non-disponible";

/** Notice kinds we can infer from the title / filename (Québec municipal). */
export const AvisType = z.enum([
  "derogation-mineure",
  "ppcmoi",
  "consultation",
  "registre-referendaire",
  "entree-en-vigueur",
  "projet-reglement",
  "alienation",
  "vente-pour-taxes",
  "autre",
]);
export type AvisTypeT = z.infer<typeof AvisType>;

export const AvisPublicItem = z.object({
  /** Human-readable notice title, verbatim from the page. */
  title: z.string().min(1),
  /** Notice date as displayed on the page (e.g. "20 mai 2026"), or NON_DISPONIBLE. */
  dateLabel: z.string().min(1),
  /** ISO date (YYYY-MM-DD) parsed from dateLabel when possible, else NON_DISPONIBLE. */
  dateIso: z.string().min(1),
  /** Absolute URL of the notice PDF. */
  url: z.string().url(),
  /** Inferred notice kind. */
  type: AvisType,
  /** Bylaw / file references found in the title (e.g. "150-49"), if any. */
  bylaws: z.array(z.string()).default([]),
});
export type AvisPublicItemT = z.infer<typeof AvisPublicItem>;

const FRENCH_MONTHS: Record<string, string> = {
  janvier: "01", février: "02", fevrier: "02", mars: "03", avril: "04",
  mai: "05", juin: "06", juillet: "07", août: "08", aout: "08",
  septembre: "09", octobre: "10", novembre: "11", décembre: "12", decembre: "12",
};

/** Decode the small set of HTML entities the source emits in titles. */
function decodeEntities(raw: string): string {
  return raw
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&laquo;/g, "«")
    .replace(/&raquo;/g, "»")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&eacute;/g, "é")
    .replace(/&egrave;/g, "è")
    .replace(/&agrave;/g, "à")
    .replace(/\s+/g, " ")
    .trim();
}

/** "20 mai 2026" -> "2026-05-20". Returns NON_DISPONIBLE when unparseable. */
export function frenchDateToIso(label: string): string {
  const m = label
    .trim()
    .toLowerCase()
    .match(/^(\d{1,2})\s+([a-zàâçéèêëîïôûù]+)\s+(\d{4})$/i);
  if (!m || !m[1] || !m[2] || !m[3]) return NON_DISPONIBLE;
  const day = m[1].padStart(2, "0");
  const month = FRENCH_MONTHS[m[2]];
  if (!month) return NON_DISPONIBLE;
  return `${m[3]}-${month}-${day}`;
}

/**
 * Infer notice kind from the title (best-effort, never invented). Recognizes
 * both the French notice phrasing (Valleyfield Craft titles + Beauharnois
 * `<summary>` titles) AND the Beauharnois filename codes (`AP_DM` dérogation
 * mineure, `AEV` avis d'entrée en vigueur, `PROJETREG` projet de règlement)
 * so a bare WordPress file-block label still classifies.
 */
export function inferAvisType(title: string): AvisTypeT {
  const t = title.toLowerCase();
  if (t.includes("dérogation") || t.includes("derogation") || /\bap[_\s-]*dm\b/.test(t))
    return "derogation-mineure";
  if (t.includes("ppcmoi")) return "ppcmoi";
  if (t.includes("registre") || t.includes("référendaire") || t.includes("referendaire"))
    return "registre-referendaire";
  // Beauharnois "AEV_REG…" = Avis d'Entrée En Vigueur (filename code). The code
  // is underscore-separated (AEV_REG_2026-11), so an end-`\b` would fail before
  // the `_` (a word char); match a standalone `aev` token or one followed by a
  // separator (`_`, space, dash) or end-of-string.
  if (
    t.includes("entrée en vigueur") ||
    t.includes("entree en vigueur") ||
    /\baev(?:[_\s-]|$)/.test(t)
  )
    return "entree-en-vigueur";
  if (t.includes("consultation")) return "consultation";
  if (t.includes("projet") && (t.includes("règlement") || t.includes("reglement")))
    return "projet-reglement";
  if (/\bprojetreg\b/.test(t)) return "projet-reglement";
  if (t.includes("aliénation") || t.includes("alienation")) return "alienation";
  if (t.includes("vente pour") || t.includes("défaut de paiement") || t.includes("defaut de paiement"))
    return "vente-pour-taxes";
  return "autre";
}

/**
 * Extract bylaw references from notice text. Two REAL municipal numbering
 * schemes are recognized, both anchored on word boundaries (never invented):
 *   - Valleyfield / sequential:  "150-49", "209-47", "216-34", "701-102"
 *     (2–3 digits "-" 1–3 digits).
 *   - Beauharnois / year-prefixed: "2026-11", "2026-07", "2022-18"
 *     ((19|20)YY "-" 1–3 digits) — a 4-digit-year règlement number.
 * The `YYYY-NNNN` dérogation file id (e.g. "DM-2026-0037") is intentionally NOT
 * a bylaw: it is captured separately as the DesignationEvent's specific id.
 */
export function extractBylaws(title: string): string[] {
  const sequential = title.match(/\b\d{2,3}-\d{1,3}\b/g) ?? [];
  const yearPrefixed = title.match(/\b(?:19|20)\d{2}-\d{1,3}\b/g) ?? [];
  return Array.from(new Set([...sequential, ...yearPrefixed]));
}

/** Strip all tags from an HTML fragment and decode the entities we emit. */
function stripTags(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]+>/g, " "));
}

/**
 * Parse the Valleyfield (Craft CMS) avis-publics HTML: each notice is one anchor
 * with class "icon-block icon-block--is-link" carrying title + date sub-divs.
 */
function parseAvisPublicsCraft(html: string): AvisPublicItemT[] {
  const items: AvisPublicItemT[] = [];
  // Each notice is one anchor with class "icon-block icon-block--is-link".
  const anchorRe =
    /<a\b[^>]*class="[^"]*icon-block--is-link[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const anchor of html.matchAll(anchorRe)) {
    const block = anchor[0];
    const inner = anchor[1] ?? "";

    const hrefMatch = block.match(/href="([^"]+)"/i);
    const url = hrefMatch?.[1] ? hrefMatch[1].trim() : "";
    if (!/^https?:\/\//i.test(url)) continue;

    const titleMatch = inner.match(
      /class="[^"]*icon-block__title[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    );
    const title = titleMatch?.[1] ? decodeEntities(titleMatch[1]) : "";
    if (!title) continue;

    const dateMatch = inner.match(
      /class="[^"]*icon-block__date[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    );
    const dateLabel = dateMatch?.[1] ? decodeEntities(dateMatch[1]) : NON_DISPONIBLE;
    const dateIso = dateLabel === NON_DISPONIBLE ? NON_DISPONIBLE : frenchDateToIso(dateLabel);

    const parsed = AvisPublicItem.safeParse({
      title,
      dateLabel: dateLabel || NON_DISPONIBLE,
      dateIso,
      url,
      type: inferAvisType(title),
      bylaws: extractBylaws(title),
    });
    if (parsed.success) items.push(parsed.data);
  }
  return items;
}

/**
 * Parse the Beauharnois (WordPress block editor) avis-publics HTML. Each notice
 * is a `<details>` block: the `<summary>` is the verbatim notice title and the
 * `<p class="wp-block-paragraph">` body adds descriptive context (referenced
 * bylaws and cadastre lots). The PDF link is the first `wp-block-file` anchor
 * inside the block. The displayed title + the body text are scanned together for
 * bylaw references so a règlement cited only in prose (e.g. "modifiant le
 * Règlement 2022-18") is still captured. Nothing is invented: an absent field
 * stays NON_DISPONIBLE and a `<details>` block with no PDF link is skipped.
 */
export function parseAvisPublicsWordpress(html: string): AvisPublicItemT[] {
  const items: AvisPublicItemT[] = [];
  const detailsRe = /<details\b[^>]*>([\s\S]*?)<\/details>/gi;
  for (const block of html.matchAll(detailsRe)) {
    const inner = block[1] ?? "";

    const summaryMatch = inner.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i);
    const title = summaryMatch?.[1] ? stripTags(summaryMatch[1]) : "";
    if (!title) continue;

    // First wp-block-file anchor (the canonical PDF), tolerant of attribute order.
    const fileAnchor = inner.match(
      /<a\b[^>]*id="wp-block-file--media-[^"]*"[^>]*href="([^"]+)"[^>]*>/i,
    );
    const url = fileAnchor?.[1] ? fileAnchor[1].trim() : "";
    if (!/^https?:\/\//i.test(url)) continue;

    // Body prose (everything outside the summary) carries extra bylaw/lot context.
    const body = stripTags(inner.replace(/<summary\b[^>]*>[\s\S]*?<\/summary>/i, ""));
    const bylaws = extractBylaws(`${title} ${body}`);

    const parsed = AvisPublicItem.safeParse({
      title,
      dateLabel: NON_DISPONIBLE,
      dateIso: NON_DISPONIBLE,
      url,
      type: inferAvisType(title),
      bylaws,
    });
    if (parsed.success) items.push(parsed.data);
  }
  return items;
}

/**
 * Parse an avis-publics index page into structured notices, dispatching on the
 * CMS markup so ONE module serves both pilot cities:
 *   - Craft (Valleyfield): `icon-block--is-link` anchors.
 *   - WordPress (Beauharnois): `<details>` notice blocks + `wp-block-file` PDFs.
 * Tolerant of attribute order; a field absent from the page is NON_DISPONIBLE.
 */
export function parseAvisPublics(html: string): AvisPublicItemT[] {
  if (/icon-block--is-link/i.test(html)) return parseAvisPublicsCraft(html);
  if (/<details\b/i.test(html)) return parseAvisPublicsWordpress(html);
  // Unknown markup: try Craft first (back-compat), then WordPress.
  const craft = parseAvisPublicsCraft(html);
  return craft.length > 0 ? craft : parseAvisPublicsWordpress(html);
}
