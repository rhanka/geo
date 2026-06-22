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

// Re-export the reused PV primitives so a runner can import everything from here.
export { PV_USER_AGENT, PvSourceFetchError, ALL_PV_CITIES };
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
  // Strong, near-unambiguous grille markers.
  { re: /grille\s+des?\s+specifications?/, weight: 6, label: "grille des spécifications" },
  { re: /grille\s+des?\s+normes?/, weight: 6, label: "grille des normes" },
  { re: /grille\s+des?\s+usages?/, weight: 5, label: "grille des usages" },
  { re: /grille[-_\s]*(de[-_\s]*)?zonage/, weight: 5, label: "grille de zonage" },
  { re: /reglement\s+de\s+zonage/, weight: 5, label: "règlement de zonage" },
  { re: /usages?\s+et\s+normes?/, weight: 4, label: "usages et normes" },
  // Medium markers — meaningful but appear in many municipal docs.
  { re: /\bgrille\b/, weight: 3, label: "grille" },
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
}

/** Per-page outcome for traceability/debugging. */
export interface PageProbeResult {
  readonly pageUrl: string;
  readonly status: "ok" | "skipped-non-200" | "skipped-non-html" | "render-js" | "error";
  readonly httpStatus?: number;
  readonly nCandidates: number;
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
 * candidates. Pages that 404 / aren't HTML / are JS-rendered are skipped and
 * recorded in `probes` (no fabrication). The caller is still responsible for
 * confirming each `pdfUrl` is HTTP 200 before trusting it in a manifest.
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
  const delayMs = opts.delayMs ?? 0;
  const pages = opts.pages ?? candidatePagesForCity(pvIndexUrl);

  const probes: PageProbeResult[] = [];
  const byUrl = new Map<string, GrilleCandidate>();
  let pagesWithHits = 0;

  for (let i = 0; i < pages.length; i++) {
    const pageUrl = pages[i];
    if (pageUrl === undefined) continue;
    if (delayMs > 0 && i > 0) await delay(delayMs);
    try {
      const { html, status, contentType } = await fetchHtml(fetchImpl, pageUrl, timeoutMs);
      if (contentType && !/html/i.test(contentType)) {
        probes.push({ pageUrl, status: "skipped-non-html", httpStatus: status, nCandidates: 0, detail: contentType });
        continue;
      }
      const { candidates, renderRequiresBrowser } = discoverGrillesInHtml(
        html,
        pageUrl,
        slug,
        threshold,
      );
      if (renderRequiresBrowser) {
        probes.push({ pageUrl, status: "render-js", httpStatus: status, nCandidates: 0 });
        continue;
      }
      for (const c of candidates) {
        const existing = byUrl.get(c.pdfUrl);
        if (!existing || c.scoreClassif > existing.scoreClassif) byUrl.set(c.pdfUrl, c);
      }
      probes.push({ pageUrl, status: "ok", httpStatus: status, nCandidates: candidates.length });
      if (candidates.length > 0) {
        pagesWithHits++;
        if (pagesWithHits >= maxPagesWithHits) break;
      }
    } catch (e) {
      if (e instanceof PvSourceFetchError) {
        const status = e.kind === "http" ? "skipped-non-200" : "error";
        probes.push({ pageUrl, status, nCandidates: 0, detail: e.message });
      } else {
        probes.push({ pageUrl, status: "error", nCandidates: 0, detail: String(e) });
      }
    }
  }

  const candidates = [...byUrl.values()].sort((a, b) => b.scoreClassif - a.scoreClassif);
  return { slug, candidates, probes };
}
