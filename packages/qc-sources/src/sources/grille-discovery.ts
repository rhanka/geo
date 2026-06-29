/**
 * Grille-de-zonage discovery — REUSES the procès-verbaux (PV) crawler infra.
 *
 * The bottleneck for the "normes de zonage" pipeline is DISCOVERING the grille
 * PDFs (grille des spécifications / grille des normes / règlement de zonage).
 * Those PDFs live in the SAME "urbanisme / règlements / publications" sections
 * of the SAME municipal sites the PV crawler already visits. So instead of a new
 * crawler we re-use the frozen, tested PV primitives:
 *
 *   - `parsePvIndex(html, baseUrl)` — the generic `<a href>` scanner that resolves
 *     relative hrefs against the page's effective base and surfaces EVERY document
 *     link (.pdf/.doc/download endpoint), keeping cross-site document links (a muni
 *     routinely hosts PDFs on a CDN/subdomain) while dropping outbound nav. We feed
 *     it urbanisme/règlements pages instead of the PV index page.
 *   - `detectIndexRenderMode(html)` — flags JS-rendered SaaS families (gestionweblex,
 *     ASP.NET portals) whose static HTML carries no link, so we route them out
 *     honestly instead of trusting an empty parse.
 *   - `PvFetchLike` / `PV_USER_AGENT` / `PvSourceFetchError` — the same injectable,
 *     identifiable fetch abstraction (honest UA, typed errors, never thrown to the
 *     wild).
 *   - `ALL_PV_CITIES` — the single source of truth of configured municipalities
 *     (slug + index URL), reused to enumerate which sites to walk.
 *
 * ANTI-INVENTION (rules/MASTER.md §Scraping Policy): this MODULE only classifies
 * links extracted VERBATIM from real fetched HTML. It never fabricates a URL. The
 * caller (the CLI runner) is responsible for confirming each emitted `pdfUrl` is
 * actually reachable (HTTP 200) before it lands in a manifest — discovery proposes,
 * confirmation disposes.
 *
 * This file ADDS capability; it does NOT touch the PV adapter or the grille
 * parsers/extractors (`grille-*.ts`), which run in a detached batch.
 */
import {
  detectIndexRenderMode,
  parsePvIndex,
  type PvIndexItemT,
} from "./proces-verbaux-parser.js";
import {
  ALL_PV_CITIES,
  PV_USER_AGENT,
  PvSourceFetchError,
  type PvFetchLike,
} from "./proces-verbaux-generic.js";
import { RobotsCache } from "./robots-txt.js";

// Re-export the reused PV primitives so a runner can import everything from here.
export { PV_USER_AGENT, PvSourceFetchError, ALL_PV_CITIES, RobotsCache };
export type { PvFetchLike, PvIndexItemT };

// ─────────────────────────────────────────────────────────────────────────────
// Classifier — does this link look like a grille / règlement de zonage PDF?
// ─────────────────────────────────────────────────────────────────────────────

/** Strip diacritics + lowercase so "spécifications" matches "specifications". */
function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Weighted FR keyword signals for grille-de-zonage PDFs. Each entry contributes
 * its weight to a link's classification score when it appears in the folded
 * "title + url" haystack. Tuned so a STRONG anchor (an explicit "grille des
 * specifications" / "grille des normes") alone clears the default threshold,
 * while weaker, ambiguous hints (a bare "annexe" or "urbanisme") need company.
 */
interface KeywordSignal {
  readonly re: RegExp;
  readonly weight: number;
  readonly label: string;
}

const GRILLE_SIGNALS: readonly KeywordSignal[] = [
  // Strong, near-unambiguous grille markers. "grilles?" handles the common
  // plural anchor "Grilles des spécifications" (e.g. portneuf) the same as the
  // singular "Grille des spécifications".
  { re: /grilles?\s+des?\s+specifications?/, weight: 6, label: "grille des spécifications" },
  { re: /grilles?\s+des?\s+normes?/, weight: 6, label: "grille des normes" },
  { re: /grilles?\s+des?\s+usages?/, weight: 5, label: "grille des usages" },
  { re: /grilles?[-_\s]*(de[-_\s]*)?zonage/, weight: 5, label: "grille de zonage" },
  { re: /reglement\s+de\s+zonage/, weight: 5, label: "règlement de zonage" },
  { re: /usages?\s+et\s+normes?/, weight: 4, label: "usages et normes" },
  // Base-codification preference (rerank fix): the codified BASE règlement de zonage
  // is the one that actually carries the grille — prefer it over the amendments that
  // merely "modify" it. A "codification administrative" / "à jour au" / "refondu(e)"
  // title is the base; this boost lifts it above same-named amendments at eval time.
  { re: /codification\s+administrative/, weight: 4, label: "codification administrative" },
  { re: /\ba\s+jour\s+au\b|consolidation|consolide|refondue?/, weight: 2, label: "codification/à jour" },
  // Medium markers — meaningful but appear in many municipal docs.
  { re: /\bgrilles?\b/, weight: 3, label: "grille" },
  { re: /\bzonage\b/, weight: 3, label: "zonage" },
  { re: /specifications?\b/, weight: 2, label: "spécifications" },
  // Weak/contextual — boost only, never decisive on their own.
  { re: /\burbanisme\b/, weight: 1, label: "urbanisme" },
  { re: /\bannexe\b/, weight: 1, label: "annexe" },
  { re: /\bnormes?\b/, weight: 1, label: "normes" },
];

/**
 * Negative signals: titles/urls that look superficially related but are NOT a
 * grille (PIIA, lotissement, construction, PPCMOI…). They subtract from the
 * score to keep false positives down without hard-excluding (a doc could be a
 * combined règlement).
 */
const GRILLE_NEGATIVE_SIGNALS: readonly KeywordSignal[] = [
  { re: /\bpiia\b|integration\s+architecturale/, weight: 3, label: "PIIA" },
  { re: /lotissement/, weight: 2, label: "lotissement" },
  { re: /\bppcmoi\b/, weight: 2, label: "PPCMOI" },
  { re: /derogation/, weight: 2, label: "dérogation" },
  { re: /permis\s+et\s+certificat/, weight: 2, label: "permis et certificats" },
  { re: /proces[-\s]?verba/, weight: 4, label: "procès-verbal (PV, not a grille)" },
  { re: /ordre\s+du\s+jour/, weight: 4, label: "ordre du jour" },
  // Amendment penalty (rerank fix): a "… modifiant/amendant le règlement de zonage"
  // or a "projet de règlement / avis de motion" is an AMENDMENT, not the base grille.
  // The base codification never carries these words, so penalising them ranks the
  // amendments below the base (and drops the noisier ones below threshold).
  { re: /\bmodifiant\b/, weight: 4, label: "modifiant (amendement)" },
  { re: /\bamend(?:ant|ement|er)\b/, weight: 4, label: "amendement" },
  { re: /projet\s+(?:de\s+reglement|d['e ]?\s*adoption)/, weight: 3, label: "projet de règlement" },
  { re: /avis\s+de\s+motion/, weight: 3, label: "avis de motion" },
  // Livestock-distance-table false positive (anti-faux-positif fix): an "annexe …
  // élevage / installation d'élevage / unités animales / distances séparatrices /
  // gestion des odeurs" is the agricultural distance-separation table, NOT the
  // zoning grille des spécifications.
  {
    re: /elevage|unites?\s+animales?|distances?\s+separatrices?|gestion\s+des\s+odeurs/,
    weight: 3,
    label: "élevage/installations (distances, pas grille)",
  },
];

/** Result of scoring one candidate link. */
export interface GrilleClassification {
  /** Net classification score (positive signals minus negative signals). */
  readonly score: number;
  /** Verbatim labels of the matched positive signals (traceability). */
  readonly matched: readonly string[];
  /** Verbatim labels of the matched negative signals (traceability). */
  readonly penalised: readonly string[];
}

/** Default acceptance threshold; one strong anchor (weight 5–6) clears it. */
export const GRILLE_SCORE_THRESHOLD = 4;

/**
 * Score a single link (title + url) against the FR grille keyword model.
 * Pure, never throws. The score is the sum of matched positive weights minus
 * matched negative weights.
 */
export function classifyGrilleLink(title: string, url: string): GrilleClassification {
  const hay = `${fold(title)} ${fold(url)}`;
  let score = 0;
  const matched: string[] = [];
  for (const sig of GRILLE_SIGNALS) {
    if (sig.re.test(hay)) {
      score += sig.weight;
      matched.push(sig.label);
    }
  }
  const penalised: string[] = [];
  for (const sig of GRILLE_NEGATIVE_SIGNALS) {
    if (sig.re.test(hay)) {
      score -= sig.weight;
      penalised.push(sig.label);
    }
  }
  return { score, matched, penalised };
}

// ─────────────────────────────────────────────────────────────────────────────
// Candidate model
// ─────────────────────────────────────────────────────────────────────────────

/** Heuristic route hint for the normes batch (the runner re-decides precisely). */
export type GrilleRouteGuess = "native" | "vision";

/** One discovered grille-PDF candidate for a municipality. */
export interface GrilleCandidate {
  /** Municipality slug (matches the radar registry, e.g. "saint-alban"). */
  readonly slug: string;
  /** The page URL on which the PDF link was found (provenance). */
  readonly sourceUrl: string;
  /** Absolute URL of the candidate grille PDF (must be confirmed 200 by caller). */
  readonly pdfUrl: string;
  /** Verbatim link title / anchor text from the page. */
  readonly titre: string;
  /** Classifier score (higher = more confidently a grille). */
  readonly scoreClassif: number;
  /** Matched positive keyword labels (traceability). */
  readonly matched: readonly string[];
  /** OPTIONAL heuristic route hint; only set once a PDF's text layer is probed. */
  readonly routeGuess?: GrilleRouteGuess;
}

// ─────────────────────────────────────────────────────────────────────────────
// Page-level discovery (pure, given fetched HTML)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract grille-PDF candidates from ONE already-fetched page's HTML.
 *
 * Reuses `parsePvIndex` to surface every document link, then keeps only PDF
 * links whose classifier score clears `threshold`. JS-rendered pages (whose
 * static HTML carries no link) are reported via `renderRequiresBrowser` so the
 * caller can route them out honestly rather than trust an empty parse.
 */
export function discoverGrillesInHtml(
  html: string,
  pageUrl: string,
  slug: string,
  threshold = GRILLE_SCORE_THRESHOLD,
): { candidates: GrilleCandidate[]; renderRequiresBrowser: boolean } {
  const mode = detectIndexRenderMode(html);
  if (mode.requiresBrowser) {
    return { candidates: [], renderRequiresBrowser: true };
  }

  const links: PvIndexItemT[] = parsePvIndex(html, pageUrl);
  const candidates: GrilleCandidate[] = [];
  for (const link of links) {
    // Only PDF links are grille candidates (the normes pipeline ingests PDFs).
    if (!/\.pdf(?:[?#].*)?$/i.test(link.url)) continue;
    const cls = classifyGrilleLink(link.title, link.url);
    if (cls.score < threshold) continue;
    candidates.push({
      slug,
      sourceUrl: pageUrl,
      pdfUrl: link.url,
      titre: link.title,
      scoreClassif: cls.score,
      matched: cls.matched,
    });
  }
  // Best score first; de-dup by pdfUrl keeping the highest-scored occurrence.
  candidates.sort((a, b) => b.scoreClassif - a.scoreClassif);
  const seen = new Set<string>();
  const deduped: GrilleCandidate[] = [];
  for (const c of candidates) {
    if (seen.has(c.pdfUrl)) continue;
    seen.add(c.pdfUrl);
    deduped.push(c);
  }
  return { candidates: deduped, renderRequiresBrowser: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2-hop: internal sub-page link extraction (same domain, depth 1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Anchor/url keywords that mark a sub-page worth following for a grille (urbanisme,
 * zonage, règlement, aménagement, grille). Folded-text match. Tuned to the FR
 * municipal vocabulary so we only follow links that plausibly lead to the
 * zoning grille, never the whole site.
 */
const SUBPAGE_FOLLOW_RE =
  /urbanism|zonage|r[eè]glement|reglement|amenagement|am[eé]nagement|grille|specification|sp[eé]cification|permis|reglementation/;

/** Anchors we must never follow (login, cart, social, language switch, media). */
const SUBPAGE_SKIP_RE =
  /facebook|twitter|instagram|linkedin|youtube|mailto:|tel:|\/(?:en|es)\/|login|connexion|panier|cart/;

/** One internal sub-page link discovered for the 2-hop crawl. */
export interface InternalLink {
  /** Absolute URL of the sub-page (same registrable site as the source page). */
  readonly url: string;
  /** Verbatim anchor text (traceability). */
  readonly anchor: string;
}

/** Registrable site (host minus leading "www."), or null on a malformed URL. */
function registrableSite(u: string): string | null {
  try {
    return new URL(u).host.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Extract SAME-SITE, non-document sub-page links from an already-fetched page
 * whose anchor text or href evokes urbanisme/zonage/règlement/grille. These are
 * the depth-1 hops the 2-hop crawl follows when a page yields no grille PDF in
 * direct anchors. PDF/doc links are NOT returned here (those are handled by
 * `discoverGrillesInHtml`); only navigable HTML sub-pages are.
 *
 * Pure; resolves relative hrefs against the page's effective base via the same
 * WHATWG resolution `parsePvIndex` uses (here re-derived locally to avoid
 * exporting internals from the PV parser). Returns at most `max` links, deduped,
 * highest-signal first (an explicit "grille"/"zonage" anchor before a bare
 * "règlements" hub).
 */
export function extractInternalSubpages(
  html: string,
  pageUrl: string,
  max = 5,
): InternalLink[] {
  if (detectIndexRenderMode(html).requiresBrowser) return [];
  const baseSite = registrableSite(pageUrl);
  // Effective base: a <base href> when declared, else the page URL.
  let base = pageUrl;
  const bm = html.match(/<base\b[^>]*href=["']([^"']+)["']/i);
  if (bm?.[1]) {
    try {
      base = new URL(bm[1], pageUrl).href;
    } catch {
      base = pageUrl;
    }
  }

  interface Scored {
    readonly link: InternalLink;
    readonly score: number;
  }
  const scored: Scored[] = [];
  const seen = new Set<string>();
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(anchorRe)) {
    const attrs = m[1] ?? "";
    const anchor = (m[2] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const hrefMatch = attrs.match(/(?:^|\s)href=["']([^"']+)["']/i);
    const rawHref = hrefMatch?.[1];
    if (!rawHref) continue;
    if (/^(?:#|javascript:|mailto:|tel:|data:)/i.test(rawHref.trim())) continue;

    let abs: string;
    try {
      const u = new URL(rawHref, base);
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      u.hash = "";
      abs = u.href;
    } catch {
      continue;
    }

    // Same registrable site only (a sub-page hop must stay on the muni site).
    const site = registrableSite(abs);
    if (!site || site !== baseSite) continue;
    // Skip the page we are already on (self-link) and document links (those are
    // grille candidates, handled by discoverGrillesInHtml, not sub-page hops).
    if (abs === pageUrl) continue;
    if (/\.(?:pdf|docx?|odt)(?:[?#].*)?$/i.test(abs)) continue;

    const hay = fold(`${anchor} ${abs}`);
    if (SUBPAGE_SKIP_RE.test(hay)) continue;
    if (!SUBPAGE_FOLLOW_RE.test(hay)) continue;
    if (seen.has(abs)) continue;
    seen.add(abs);

    // Prefer the strongest sub-page hints (grille/zonage/specification) so the
    // bounded budget is spent on the most promising hops first.
    let score = 1;
    if (/grille|specification|sp[eé]cification/.test(hay)) score += 4;
    if (/zonage/.test(hay)) score += 3;
    if (/urbanism/.test(hay)) score += 2;
    if (/r[eè]glement|reglement/.test(hay)) score += 1;
    scored.push({ link: { url: abs, anchor: anchor || abs }, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map((s) => s.link);
}

// ─────────────────────────────────────────────────────────────────────────────
// Candidate urbanisme/règlements page derivation (per municipality)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Common FR path fragments where Québec municipalities publish their zoning
 * grille / règlement de zonage. Used to derive candidate pages from a site root
 * when the PV index URL alone does not surface grilles. These are PROBED (the
 * runner keeps only the ones returning HTTP 200); a 404 is silently skipped, so
 * no URL is fabricated into the output — only links found on a real 200 page are
 * ever emitted.
 */
export const URBANISME_PATH_HINTS: readonly string[] = [
  "urbanisme",
  "urbanisme-et-environnement",
  "services/urbanisme",
  "services-aux-citoyens/urbanisme",
  "reglements",
  "reglements-municipaux",
  "reglementation",
  "reglementation-municipale",
  "reglements-durbanisme",
  "amenagement-et-urbanisme",
  "permis-et-reglements",
];

/**
 * Build the ordered list of candidate page URLs to crawl for one municipality.
 *
 * Strategy (cheapest/most-likely first):
 *   1. The configured PV index page itself — grilles are sometimes linked from
 *      the same "documents publics" hub, and it is already confirmed reachable.
 *   2. The site root.
 *   3. Site-root + each urbanisme/règlements path hint.
 *
 * The caller probes each (HTTP 200 gate) and skips the misses, so this returns a
 * candidate SET, never a claim that the URLs exist.
 */
export function candidatePagesForCity(pvIndexUrl: string): string[] {
  const pages: string[] = [];
  const seen = new Set<string>();
  const add = (u: string): void => {
    if (!seen.has(u)) {
      seen.add(u);
      pages.push(u);
    }
  };
  add(pvIndexUrl);
  let origin: string | null = null;
  try {
    origin = new URL(pvIndexUrl).origin;
  } catch {
    origin = null;
  }
  if (origin) {
    add(`${origin}/`);
    for (const hint of URBANISME_PATH_HINTS) {
      add(`${origin}/${hint}`);
    }
  }
  return pages;
}

// ─────────────────────────────────────────────────────────────────────────────
// City-level discovery (impure: fetches pages, but injectable fetch)
// ─────────────────────────────────────────────────────────────────────────────

/** Options for `discoverGrillesForCity`. */
export interface DiscoverCityOptions {
  /** Injected fetch (defaults to globalThis.fetch). Same shape as the PV adapter. */
  readonly fetchImpl?: PvFetchLike;
  /** Per-fetch timeout in ms. */
  readonly timeoutMs?: number;
  /** Classifier acceptance threshold. */
  readonly threshold?: number;
  /** Stop after this many pages produce ≥1 candidate (cap network cost). */
  readonly maxPagesWithHits?: number;
  /** Pages to crawl; defaults to `candidatePagesForCity(pvIndexUrl)`. */
  readonly pages?: readonly string[];
  /** Politeness delay between page fetches, ms (default 0 — caller may set). */
  readonly delayMs?: number;
  /**
   * Max crawl depth. 1 (default) = single-hop (the derived candidate pages only).
   * 2 = follow up to `maxSubpagesPerCity` same-domain urbanisme/zonage sub-pages
   * from pages that produced no direct grille PDF (depth-1 hop, robots-gated).
   */
  readonly maxHops?: number;
  /** Max sub-pages followed per municipality in 2-hop mode (default 5). */
  readonly maxSubpagesPerCity?: number;
  /**
   * Robots gate. When provided, every page/sub-page URL is checked with
   * `isAllowed(url)` before fetching (Disallow ⇒ skipped, recorded), and the
   * effective inter-fetch delay is `max(delayMs, crawlDelayMs(domain))`. Pass a
   * shared `RobotsCache` so robots.txt is fetched once per domain across the run.
   * When omitted, no robots gating is applied (back-compat for existing callers).
   */
  readonly robots?: RobotsCache;
}

/** Per-page outcome for traceability/debugging. */
export interface PageProbeResult {
  readonly pageUrl: string;
  readonly status:
    | "ok"
    | "skipped-non-200"
    | "skipped-non-html"
    | "render-js"
    | "robots-disallow"
    | "error";
  readonly httpStatus?: number;
  readonly nCandidates: number;
  /** Crawl hop this page was reached at (1 = derived candidate, 2 = sub-page). */
  readonly hop?: number;
  readonly detail?: string;
}

/** Aggregate result of crawling one municipality for grille candidates. */
export interface CityDiscoveryResult {
  readonly slug: string;
  readonly candidates: GrilleCandidate[];
  readonly probes: PageProbeResult[];
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** Sleep helper for politeness between fetches. */
function delay(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * Fetch HTML with the honest PV user-agent + a timeout, returning the decoded
 * text or a typed `PvSourceFetchError`. Mirrors the PV adapter's
 * `fetchWithTimeout`, kept local so this module does not need the adapter class.
 */
async function fetchHtml(
  fetchImpl: PvFetchLike,
  url: string,
  timeoutMs: number,
): Promise<{ html: string; status: number; contentType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res: Awaited<ReturnType<PvFetchLike>>;
    try {
      res = await fetchImpl(url, {
        signal: controller.signal,
        headers: { "user-agent": PV_USER_AGENT, accept: "text/html,*/*" },
      });
    } catch (e) {
      const isAbort = e instanceof Error && e.name === "AbortError";
      throw new PvSourceFetchError(
        isAbort ? "timeout" : "network",
        e instanceof Error ? e.message : String(e),
        url,
      );
    }
    if (!res.ok) {
      throw new PvSourceFetchError("http", `HTTP ${res.status}`, url);
    }
    const contentType = res.headers.get("content-type") ?? "";
    const html = new TextDecoder("utf-8").decode(
      new Uint8Array(await res.arrayBuffer()),
    );
    return { html, status: res.status, contentType };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Crawl one municipality's candidate pages and return scored grille PDF
 * candidates. Pages that 404 / aren't HTML / are JS-rendered / are robots-
 * Disallowed are skipped and recorded in `probes` (no fabrication). The caller
 * is still responsible for confirming each `pdfUrl` is HTTP 200 before trusting
 * it in a manifest.
 *
 * SINGLE-HOP (maxHops=1, default): only the derived candidate pages are probed.
 * 2-HOP (maxHops=2): when the derived pages produce NO grille PDF, follow up to
 * `maxSubpagesPerCity` same-domain urbanisme/zonage/règlement sub-pages found on
 * those pages (depth 1 only), classifying their PDFs identically. Every fetch
 * (hop 1 AND hop 2) is robots-gated when a `RobotsCache` is supplied, and the
 * inter-fetch delay is `max(delayMs, crawlDelayMs(domain))`.
 */
export async function discoverGrillesForCity(
  slug: string,
  pvIndexUrl: string,
  opts: DiscoverCityOptions = {},
): Promise<CityDiscoveryResult> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as PvFetchLike);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const threshold = opts.threshold ?? GRILLE_SCORE_THRESHOLD;
  const maxPagesWithHits = opts.maxPagesWithHits ?? 3;
  const baseDelayMs = opts.delayMs ?? 0;
  const maxHops = opts.maxHops ?? 1;
  const maxSubpages = opts.maxSubpagesPerCity ?? 5;
  const robots = opts.robots;
  const pages = opts.pages ?? candidatePagesForCity(pvIndexUrl);

  const probes: PageProbeResult[] = [];
  const byUrl = new Map<string, GrilleCandidate>();
  let pagesWithHits = 0;
  // Collected depth-1 sub-page links (only used when maxHops >= 2).
  const subpageQueue: InternalLink[] = [];
  const subpageSeen = new Set<string>();
  // True once at least one fetch has happened (to gate the leading delay).
  let fetched = false;

  /** Effective politeness delay for a URL: max(baseDelay, robots crawl-delay). */
  const effectiveDelayMs = async (url: string): Promise<number> => {
    if (!robots) return baseDelayMs;
    const cd = await robots.crawlDelayMs(url);
    return cd === null ? baseDelayMs : Math.max(baseDelayMs, cd);
  };

  /**
   * Probe ONE already-allowed page: fetch, classify direct grille PDFs, and (in
   * 2-hop mode, on a 200 HTML page with no direct hit) harvest sub-page links.
   * Returns the number of direct candidates found.
   */
  const probePage = async (pageUrl: string, hop: number): Promise<number> => {
    try {
      const { html, status, contentType } = await fetchHtml(fetchImpl, pageUrl, timeoutMs);
      if (contentType && !/html/i.test(contentType)) {
        probes.push({ pageUrl, status: "skipped-non-html", httpStatus: status, nCandidates: 0, hop, detail: contentType });
        return 0;
      }
      const { candidates, renderRequiresBrowser } = discoverGrillesInHtml(
        html,
        pageUrl,
        slug,
        threshold,
      );
      if (renderRequiresBrowser) {
        probes.push({ pageUrl, status: "render-js", httpStatus: status, nCandidates: 0, hop });
        return 0;
      }
      for (const c of candidates) {
        const existing = byUrl.get(c.pdfUrl);
        if (!existing || c.scoreClassif > existing.scoreClassif) byUrl.set(c.pdfUrl, c);
      }
      probes.push({ pageUrl, status: "ok", httpStatus: status, nCandidates: candidates.length, hop });
      // 2-hop: only harvest sub-pages from hop-1 pages that yielded NO direct
      // grille PDF (a page with a hit needs no deeper follow).
      if (maxHops >= 2 && hop === 1 && candidates.length === 0) {
        for (const link of extractInternalSubpages(html, pageUrl, maxSubpages)) {
          if (subpageSeen.has(link.url)) continue;
          subpageSeen.add(link.url);
          subpageQueue.push(link);
        }
      }
      return candidates.length;
    } catch (e) {
      if (e instanceof PvSourceFetchError) {
        const status = e.kind === "http" ? "skipped-non-200" : "error";
        probes.push({ pageUrl, status, nCandidates: 0, hop, detail: e.message });
      } else {
        probes.push({ pageUrl, status: "error", nCandidates: 0, hop, detail: String(e) });
      }
      return 0;
    }
  };

  /** Robots-gate + politeness-delay wrapper around `probePage`. */
  const guardedProbe = async (pageUrl: string, hop: number): Promise<number> => {
    if (robots && !(await robots.isAllowed(pageUrl))) {
      probes.push({ pageUrl, status: "robots-disallow", nCandidates: 0, hop });
      return 0;
    }
    if (fetched) {
      const d = await effectiveDelayMs(pageUrl);
      if (d > 0) await delay(d);
    }
    fetched = true;
    return probePage(pageUrl, hop);
  };

  // ── HOP 1: the derived candidate pages ──────────────────────────────────────
  for (const pageUrl of pages) {
    if (pageUrl === undefined) continue;
    const n = await guardedProbe(pageUrl, 1);
    if (n > 0) {
      pagesWithHits++;
      if (pagesWithHits >= maxPagesWithHits) break;
    }
  }

  // ── HOP 2: bounded same-domain sub-pages, only if hop 1 found nothing ───────
  if (maxHops >= 2 && byUrl.size === 0 && subpageQueue.length > 0) {
    const budget = subpageQueue.slice(0, maxSubpages);
    for (const link of budget) {
      const n = await guardedProbe(link.url, 2);
      if (n > 0) {
        pagesWithHits++;
        if (pagesWithHits >= maxPagesWithHits) break;
      }
    }
  }

  const candidates = [...byUrl.values()].sort((a, b) => b.scoreClassif - a.scoreClassif);
  return { slug, candidates, probes };
}
