/**
 * Discover PV indexes for municipalities whose official site links to
 * GoNet/GoAzimut, without mistaking the GoNet map itself for a PV source.
 *
 * Context: many PG Solutions municipal sites expose a GoNet/GoAzimut map link
 * (`goazimut.com/GOnet6/?m=<code>`). The existing broad discoverer treated that
 * marker as "obscura" and stopped early. This runner uses the marker only to
 * select the city, then stays on robots-allowed municipal pages to find real
 * council procès-verbal PDF/DOC links.
 *
 * It writes one idempotent manifest per city:
 *   registry/qc-pv/<slug>/index.json
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { websiteForSlug } from "../../packages/geo-sources-americas/dist/ca-qc/municipalities/municipal-directory.js";
import { parsePvIndex, type PvIndexItemT } from "../../packages/qc-sources/src/sources/proces-verbaux-parser.js";
import { PV_USER_AGENT, type PvFetchLike } from "../../packages/qc-sources/src/sources/proces-verbaux-generic.js";
import { RobotsCache } from "../../packages/qc-sources/src/sources/robots-txt.js";

import { exists, putBytes, s3Client } from "./lib/s3.js";

const COVERAGE_MATRIX_PATH = "work/coverage/coverage-matrix.json";
const COVERAGE_MATRIX_FALLBACK_PATH = "../work/coverage/coverage-matrix.json";
const DEFAULT_DELAY_MS = 1500;
const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_CITY_TIMEOUT_MS = 45000;
const DEFAULT_MAX_PV_CANDIDATES = 80;
const DEFAULT_MAX_GONET_CANDIDATES = 10;

const GOAZIMUT_HOST_RE = /(?:^|\.)goazimut\.com$/i;
const GONET_TEXT_RE = /\b(?:go\s*net|gonet|goazimut|matrice graphique|r[oô]le d[’']?[ée]valuation)\b/i;
const PV_NAV_RE =
  /proc[èeé]s[-\s]?verb(?:al|aux)|\bpv\b|s[ée]ances?(?:\s+du\s+conseil)?|conseil municipal|ordre[-\s]du[-\s]jour|documents publics/i;
const PV_DOC_RE =
  /proc[èeé]s[-\s]?verb(?:al|aux)|\bpv\b|proces[-_]?verbal|procesverbal|seances?[-_]?du[-_]?conseil/i;
const ODJ_RE = /ordre[-\s]du[-\s]jour|\bodj\b|\bagenda\b/i;

const PV_PATH_CANDIDATES = [
  "/conseil-municipal/proces-verbaux/",
  "/municipalite/proces-verbaux/",
  "/proces-verbaux/",
  "/documents-publics/proces-verbaux/",
  "/la-ville/vie-democratique/seances-du-conseil/",
  "/ville/vie-democratique/seances-du-conseil/",
  "/mairie/seances-du-conseil/",
  "/ma-municipalite/vie-democratique/seances-du-conseil/",
  "/municipalite/vie-democratique/seances-du-conseil/",
  "/la-municipalite/vie-democratique/seances-du-conseil/",
  "/seances-du-conseil/",
  "/conseil-municipal/seances-du-conseil/",
  "/municipalite/conseil-municipal/seances-du-conseil/",
  "/administration/seances-et-proces-verbaux/",
  "/vie-democratique/seances-du-conseil/",
  "/vie-municipale/vie-democratique/seances-du-conseil/",
  "/fr/municipalite/conseil-municipal/seances-du-conseil/",
  "/fr/la-ville/administration/seances-et-proces-verbaux",
  "/affaires-municipales/seances-du-conseil/",
  "/seances-conseil/",
  "/conseil-municipal/",
  "/conseil-et-administration/proces-verbaux/",
  "/vie-democratique/proces-verbaux/",
  "/documents-publics/",
  "/democratie/seances-du-conseil/",
  "/la-ville/democratie/seances-du-conseil/",
  "/mairie-et-vie-municipale/seances-du-conseil/",
  "/fr/seances-du-conseil",
  "/fr/vie-democratique/seances-du-conseil/",
  "/fr/services-aux-citoyens/greffe/proces-verbaux-ordres-du-jour",
  "/gestion-municipale/proces-verbaux/",
  "/notre-municipalite/vie-democratique/seances-du-conseil",
  "/conseil-municipal/calendriers-des-seances-ordres-du-jour-et-proces-verbaux/",
  "/vie-municipale/conseil-municipal/ordre-du-jour-et-proces-verbaux/",
  "/administration-municipale/seances-du-conseil/",
  "/municipalite/administration-et-finance/seances-du-conseil/",
  "/communications/proces-verbaux-seances/",
  "/seances-publiques/",
  "/seances-du-conseil-proces-verbaux/",
  "/ordre-du-jour-et-proces-verbaux/",
  "/ordres-du-jour-et-proces-verbaux/",
  "/fr/administration-municipale/conseil-municipal/proces-verbaux-et-videoconferences/",
  "/fr/ma-ville/conseil-municipal/seances-du-conseil",
  "/fr/ma-ville/votre-conseil/ordres-du-jour-et-proces-verbaux",
  "/fr/ma-ville/vie-democratique/ordres-du-jour-et-proces-verbaux/",
  "/fr/vie-democratique/seances-du-conseil/categories/seances-du-conseil-2026",
  "/fr/municipalite/vie-municipale/seances-du-conseil-proces-verbaux/",
  "/ville-menu/vie-municipale/seances-du-conseil/",
  "/documents-publics/seances-du-conseil-municipal/",
  "/la-ville/conseil-municipal/seances-du-conseil/",
  "/seances-du-conseil-2026/",
  "/greffe/seance-du-conseil/",
  "/citoyens/greffe/seance-du-conseil/",
  "/vie-democratique/seances-du-conseil-municipal/",
  "/democratie-et-participation-citoyenne/seances-du-conseil",
  "/assemblee-du-conseil-municipal/",
  "/assemblees-du-conseil-municipal/",
  "/ville/vos-elus/proces-verbaux",
  "/ville/vos-elus/seances-du-conseil",
  "/administration/seances-du-conseil/",
  "/la-ville/conseil-municipal/",
  "/ma-ville/vie-democratique/seances-du-conseil/",
  "/fr/greffe/seances-du-conseil/",
  "/conseil/proces-verbaux/",
  "/vie-citoyenne/conseil-municipal/seances/",
  "/mairie/administration/proces-verbaux/",
  "/administration-et-services/conseil-municipal/seances-du-conseil/",
  "/fr/votre-ville/seances-du-conseil",
  "/votre-ville/conseil/seances-du-conseil/",
  "/fr/la-municipalite/greffe/seances-du-conseil/",
  "/la-ville/vie-municipale/seances-du-conseil/",
  "/archives-de-seances/",
  "/actes-du-conseil/",
  "/publications/proces-verbaux/",
];

type CoverageStatus = "done" | "planned" | "to-research";

interface CoverageMatrix {
  readonly cities?: Record<string, { readonly pv?: { readonly status?: CoverageStatus } }>;
}

interface Args {
  readonly slugs?: string[];
  readonly limit?: number;
  readonly statuses: CoverageStatus[];
  readonly delayMs: number;
  readonly timeoutMs: number;
  readonly cityTimeoutMs: number;
  readonly dryRun: boolean;
  readonly force: boolean;
  readonly robots: boolean;
  readonly maxPvCandidates: number;
  readonly maxGoNetCandidates: number;
  readonly outFile?: string;
}

interface FetchedHtml {
  readonly url: string;
  readonly status: number;
  readonly html: string;
}

interface Deadline {
  readonly stopAtMs: number;
}

export interface GoNetLink {
  readonly url: string;
  readonly muniCode?: string;
}

interface AnchorLink {
  readonly url: string;
  readonly label: string;
}

export interface PvManifestEntry {
  readonly url: string;
  readonly title?: string;
  readonly publishedAt?: string;
  readonly contentType?: string;
}

interface PvCandidateResult {
  readonly pvIndexUrl: string;
  readonly entries: PvManifestEntry[];
}

interface CityOutcome {
  readonly slug: string;
  readonly siteUrl: string | null;
  readonly goNetLinks: GoNetLink[];
  readonly outcome:
    | "skip-existing"
    | "no-website"
    | "not-gonet"
    | "not-found"
    | "robots-skip"
    | "dry-run"
    | "deposited"
    | "error";
  readonly pvIndexUrl?: string;
  readonly count?: number;
  readonly reason?: string;
}

interface PvIndexManifest {
  readonly _note: string;
  readonly _generatedAt: string;
  readonly slug: string;
  readonly sourceId: string;
  readonly pvIndexUrl: string;
  readonly discoveryTrack: "gonet-adjacent-site";
  readonly goNetLinks: GoNetLink[];
  readonly userAgent: string;
  readonly count: number;
  readonly entries: PvManifestEntry[];
}

function parseArgs(argv: string[]): Args {
  const get = (k: string): string | undefined => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const has = (k: string): boolean => argv.includes(`--${k}`);
  const slugsRaw = get("slugs");
  const statusesRaw = get("statuses") ?? "planned,to-research";
  return {
    ...(slugsRaw
      ? { slugs: slugsRaw.split(",").map((s) => s.trim()).filter(Boolean) }
      : {}),
    ...(get("limit") ? { limit: Number(get("limit")) } : {}),
    statuses: statusesRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean) as CoverageStatus[],
    delayMs: Number(get("delay-ms") ?? DEFAULT_DELAY_MS),
    timeoutMs: Number(get("timeout-ms") ?? DEFAULT_TIMEOUT_MS),
    cityTimeoutMs: Number(get("city-timeout-ms") ?? DEFAULT_CITY_TIMEOUT_MS),
    dryRun: has("dry-run"),
    force: has("force"),
    robots: !has("no-robots"),
    maxPvCandidates: Number(get("max-pv-candidates") ?? DEFAULT_MAX_PV_CANDIDATES),
    maxGoNetCandidates: Number(get("max-gonet-candidates") ?? DEFAULT_MAX_GONET_CANDIDATES),
    outFile: get("out"),
  };
}

function manifestKey(slug: string): string {
  return `registry/qc-pv/${slug}/index.json`;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#0?38;|&amp;/gi, "&")
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .trim();
}

function stripTags(s: string): string {
  return decodeHtmlEntities(s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
}

function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizedHost(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function sameSite(a: string, b: string): boolean {
  const ah = normalizedHost(a);
  const bh = normalizedHost(b);
  if (!ah || !bh) return false;
  return ah === bh || ah.endsWith(`.${bh}`) || bh.endsWith(`.${ah}`);
}

function canonicalUrl(url: string): string {
  const u = new URL(url);
  u.hash = "";
  return u.href;
}

function normalizeMaybeGoogleRedirect(url: string): string {
  try {
    const u = new URL(decodeHtmlEntities(url));
    if (u.hostname === "www.google.com" && u.pathname === "/url") {
      const q = u.searchParams.get("q");
      if (q && isHttpUrl(q)) return q;
    }
    return u.href;
  } catch {
    return decodeHtmlEntities(url);
  }
}

function isGoAzimutUrl(url: string): boolean {
  try {
    const u = new URL(normalizeMaybeGoogleRedirect(url));
    return GOAZIMUT_HOST_RE.test(u.hostname) && /\/GOnet6\//i.test(u.pathname);
  } catch {
    return false;
  }
}

function muniCodeFromGoNetUrl(url: string): string | undefined {
  const normalized = normalizeMaybeGoogleRedirect(url);
  try {
    const u = new URL(normalized);
    const m = u.searchParams.get("m");
    if (m && /^\d{4,5}$/.test(m)) return m.padStart(5, "0");
    const bare = u.search.replace(/^\?/, "").match(/(?:^|&)(?:m=)?(\d{4,5})(?:&|$)/);
    return bare?.[1]?.padStart(5, "0");
  } catch {
    const bare = normalized.match(/[?&](?:m=)?(\d{4,5})(?:&|$)/);
    return bare?.[1]?.padStart(5, "0");
  }
}

export function extractGoNetLinks(html: string, baseUrl: string): GoNetLink[] {
  const out: GoNetLink[] = [];
  const seen = new Set<string>();
  for (const link of extractAnchors(html, baseUrl)) {
    const normalized = normalizeMaybeGoogleRedirect(link.url);
    if (!isGoAzimutUrl(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push({
      url: normalized,
      ...(muniCodeFromGoNetUrl(normalized) ? { muniCode: muniCodeFromGoNetUrl(normalized) } : {}),
    });
  }
  return out;
}

function extractAnchors(html: string, baseUrl: string): AnchorLink[] {
  const links: AnchorLink[] = [];
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(anchorRe)) {
    const attrs = m[1] ?? "";
    const href = attrs.match(/(?:^|\s)href=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    try {
      const url = canonicalUrl(new URL(decodeHtmlEntities(href), baseUrl).href);
      if (!isHttpUrl(url)) continue;
      links.push({ url, label: stripTags(m[2] ?? "") });
    } catch {
      // Ignore malformed hrefs.
    }
  }
  return links;
}

function uniqueUrls(urls: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    if (!isHttpUrl(raw)) continue;
    const url = canonicalUrl(raw);
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

export function extractGoNetProbeLinks(html: string, baseUrl: string): string[] {
  return uniqueUrls(
    extractAnchors(html, baseUrl)
      .filter((l) => sameSite(l.url, baseUrl))
      .filter((l) => GONET_TEXT_RE.test(`${l.label} ${l.url}`))
      .map((l) => l.url),
  );
}

export function extractPvNavigationLinks(html: string, baseUrl: string): string[] {
  return uniqueUrls(
    extractAnchors(html, baseUrl)
      .filter((l) => sameSite(l.url, baseUrl))
      .filter((l) => !isGoAzimutUrl(l.url))
      .filter((l) => PV_NAV_RE.test(`${l.label} ${l.url}`))
      .map((l) => l.url),
  );
}

function looksLikeDocumentUrl(url: string): boolean {
  return /\.(?:pdf|docx?|odt)(?:[?#].*)?$/i.test(url);
}

function contentTypeFor(url: string): string {
  return /\.pdf(?:[?#].*)?$/i.test(url) ? "application/pdf" : "application/octet-stream";
}

export function pvEntriesFromHtml(html: string, baseUrl: string): PvManifestEntry[] {
  const items = parsePvIndex(html, baseUrl);
  return pvEntriesFromItems(items);
}

export function pvEntriesFromItems(items: readonly PvIndexItemT[]): PvManifestEntry[] {
  const seen = new Set<string>();
  const entries: PvManifestEntry[] = [];
  for (const item of items) {
    if (!looksLikeDocumentUrl(item.url)) continue;
    const hay = `${item.title} ${item.url}`;
    if (ODJ_RE.test(hay)) continue;
    if (!PV_DOC_RE.test(hay)) continue;
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    entries.push({
      url: item.url,
      title: item.title,
      ...(item.dateIso !== "non-disponible" ? { publishedAt: item.dateIso } : {}),
      contentType: contentTypeFor(item.url),
    });
  }
  return entries;
}

function scorePvCandidate(url: string, entries: readonly PvManifestEntry[]): number {
  const u = url.toLowerCase();
  let score = entries.length * 100;
  if (/proc|verbaux|verbal|\bpv\b/.test(u)) score += 40;
  if (/seances?|conseil/.test(u)) score += 10;
  return score;
}

function addDefaultPvPaths(siteUrl: string, urls: Set<string>): void {
  const base = siteUrl.replace(/\/$/, "");
  for (const path of PV_PATH_CANDIDATES) urls.add(`${base}${path}`);
}

function selectSlugs(args: Args): string[] {
  if (args.slugs && args.slugs.length > 0) return args.slugs;
  const matrixPath = existsSync(COVERAGE_MATRIX_PATH)
    ? COVERAGE_MATRIX_PATH
    : resolve(COVERAGE_MATRIX_FALLBACK_PATH);
  const raw = existsSync(matrixPath)
    ? (JSON.parse(readFileSync(matrixPath, "utf8")) as CoverageMatrix)
    : {};
  const statuses = new Set(args.statuses);
  const slugs = Object.entries(raw.cities ?? {})
    .filter(([, c]) => c.pv?.status && statuses.has(c.pv.status))
    .map(([slug]) => slug);
  return args.limit !== undefined ? slugs.slice(0, args.limit) : slugs;
}

async function politeDelay(ms: number): Promise<void> {
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
}

function deadlineExpired(deadline?: Deadline): boolean {
  return deadline !== undefined && Date.now() >= deadline.stopAtMs;
}

function remainingMs(deadline: Deadline | undefined, fallbackMs: number): number {
  if (!deadline) return fallbackMs;
  return Math.max(1, Math.min(fallbackMs, deadline.stopAtMs - Date.now()));
}

class Fetcher {
  private readonly robots?: RobotsCache;
  private readonly fetchImpl: PvFetchLike;
  private readonly timeoutMs: number;
  private readonly delayMs: number;
  private fetched = 0;

  constructor(opts: {
    readonly fetchImpl: PvFetchLike;
    readonly timeoutMs: number;
    readonly delayMs: number;
    readonly robots?: RobotsCache;
  }) {
    this.fetchImpl = opts.fetchImpl;
    this.timeoutMs = opts.timeoutMs;
    this.delayMs = opts.delayMs;
    this.robots = opts.robots;
  }

  async html(url: string, deadline?: Deadline): Promise<FetchedHtml | "robots" | null> {
    if (deadlineExpired(deadline)) return null;
    if (this.robots && !(await this.robots.isAllowed(url))) return "robots";
    const crawlDelay = this.robots ? ((await this.robots.crawlDelayMs(url)) ?? 0) : 0;
    if (deadlineExpired(deadline)) return null;
    if (this.fetched > 0) {
      const delay = Math.max(this.delayMs, crawlDelay);
      const remainingForDelay = remainingMs(deadline, delay);
      await politeDelay(Math.min(delay, Math.max(0, remainingForDelay - 250)));
    }
    if (deadlineExpired(deadline)) return null;
    this.fetched++;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remainingMs(deadline, this.timeoutMs));
    try {
      const res = await this.fetchImpl(url, {
        signal: controller.signal,
        headers: { "user-agent": PV_USER_AGENT, accept: "text/html,*/*" },
      });
      const ct = res.headers.get("content-type") ?? "";
      if (!res.ok || !/html|text/i.test(ct)) return null;
      const html = new TextDecoder("utf-8").decode(new Uint8Array(await res.arrayBuffer()));
      return { url, status: res.status, html };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

async function discoverGoNetEvidence(
  siteUrl: string,
  home: FetchedHtml,
  fetcher: Fetcher,
  maxProbeLinks: number,
  deadline: Deadline,
): Promise<GoNetLink[]> {
  const links = new Map<string, GoNetLink>();
  for (const l of extractGoNetLinks(home.html, home.url)) links.set(l.url, l);
  if (links.size > 0) return [...links.values()];
  if (!GONET_TEXT_RE.test(home.html)) return [];

  const probes = extractGoNetProbeLinks(home.html, home.url).slice(0, maxProbeLinks);
  for (const url of probes) {
    if (deadlineExpired(deadline)) break;
    const res = await fetcher.html(url, deadline);
    if (!res || res === "robots") continue;
    for (const l of extractGoNetLinks(res.html, res.url)) links.set(l.url, l);
  }
  if (links.size > 0) return [...links.values()];

  // Text-only evidence is weaker than a link but still identifies the site as
  // GoNet-adjacent; keep the original site URL as traceability.
  return [{ url: siteUrl }];
}

async function discoverPvIndex(
  siteUrl: string,
  home: FetchedHtml,
  fetcher: Fetcher,
  maxCandidates: number,
  deadline: Deadline,
): Promise<PvCandidateResult | null> {
  const candidates = new Set<string>();
  for (const url of extractPvNavigationLinks(home.html, home.url)) candidates.add(url);
  addDefaultPvPaths(siteUrl, candidates);

  let best: PvCandidateResult | null = null;
  const pending = uniqueUrls(candidates);
  const queued = new Set(pending);
  const visited = new Set<string>();
  for (let i = 0; i < pending.length && visited.size < maxCandidates; i++) {
    const url = pending[i]!;
    if (visited.has(url)) continue;
    visited.add(url);
    if (deadlineExpired(deadline)) break;
    const res = await fetcher.html(url, deadline);
    if (!res || res === "robots") continue;
    const entries = pvEntriesFromHtml(res.html, res.url);
    if (entries.length === 0) {
      for (const nested of extractPvNavigationLinks(res.html, res.url)) {
        for (const normalized of uniqueUrls([nested])) {
          if (visited.has(normalized) || queued.has(normalized)) continue;
          queued.add(normalized);
          pending.push(normalized);
        }
      }
      continue;
    }
    const candidate = { pvIndexUrl: res.url, entries };
    if (!best || scorePvCandidate(candidate.pvIndexUrl, candidate.entries) > scorePvCandidate(best.pvIndexUrl, best.entries)) {
      best = candidate;
    }
  }
  return best;
}

async function processCity(
  slug: string,
  args: Args,
  fetcher: Fetcher,
  s3: ReturnType<typeof s3Client> | null,
): Promise<CityOutcome> {
  const siteUrl = websiteForSlug(slug);
  if (!siteUrl) return { slug, siteUrl: null, goNetLinks: [], outcome: "no-website" };
  const deadline = { stopAtMs: Date.now() + args.cityTimeoutMs };

  const key = manifestKey(slug);
  if (s3 && !args.force && (await exists(s3, key))) {
    return { slug, siteUrl, goNetLinks: [], outcome: "skip-existing" };
  }

  const home = await fetcher.html(siteUrl, deadline);
  if (home === "robots") return { slug, siteUrl, goNetLinks: [], outcome: "robots-skip", reason: "homepage disallowed" };
  if (!home) return { slug, siteUrl, goNetLinks: [], outcome: "error", reason: "homepage fetch failed" };

  const goNetLinks = await discoverGoNetEvidence(siteUrl, home, fetcher, args.maxGoNetCandidates, deadline);
  if (goNetLinks.length === 0) return { slug, siteUrl, goNetLinks, outcome: "not-gonet" };

  const pv = await discoverPvIndex(siteUrl, home, fetcher, args.maxPvCandidates, deadline);
  if (!pv || pv.entries.length === 0) {
    return {
      slug,
      siteUrl,
      goNetLinks,
      outcome: "not-found",
      reason: deadlineExpired(deadline) ? "city timeout before PV document entries found" : "no PV document entries found",
    };
  }

  const manifest: PvIndexManifest = {
    _note:
      "PV index discovered by pv-gonet-run.ts. GoNet/GoAzimut was used only " +
      "as a city-selection signal; entries are real PV document links parsed " +
      "from robots-allowed municipal pages. No fabrication.",
    _generatedAt: new Date().toISOString(),
    slug,
    sourceId: `proces-verbaux-${slug}`,
    pvIndexUrl: pv.pvIndexUrl,
    discoveryTrack: "gonet-adjacent-site",
    goNetLinks,
    userAgent: PV_USER_AGENT,
    count: pv.entries.length,
    entries: pv.entries,
  };

  if (!s3 || args.dryRun) {
    return { slug, siteUrl, goNetLinks, outcome: "dry-run", pvIndexUrl: pv.pvIndexUrl, count: pv.entries.length };
  }

  await putBytes(s3, key, JSON.stringify(manifest, null, 2) + "\n", "application/json");
  return { slug, siteUrl, goNetLinks, outcome: "deposited", pvIndexUrl: pv.pvIndexUrl, count: pv.entries.length };
}

function summarize(outcomes: readonly CityOutcome[]) {
  const stats: Record<string, number> = {};
  for (const o of outcomes) stats[o.outcome] = (stats[o.outcome] ?? 0) + 1;
  return {
    generatedAt: new Date().toISOString(),
    targetCount: outcomes.length,
    goNetIdentified: outcomes.filter((o) => o.goNetLinks.length > 0).length,
    deposited: stats["deposited"] ?? 0,
    dryRunReady: stats["dry-run"] ?? 0,
    stats,
    failures: outcomes
      .filter((o) => o.outcome === "error" || o.outcome === "robots-skip" || o.outcome === "no-website")
      .map((o) => ({ slug: o.slug, siteUrl: o.siteUrl, outcome: o.outcome, reason: o.reason })),
    depositedSlugs: outcomes
      .filter((o) => o.outcome === "deposited" || o.outcome === "dry-run")
      .map((o) => ({ slug: o.slug, pvIndexUrl: o.pvIndexUrl, count: o.count })),
    goNetOnlyNotFound: outcomes
      .filter((o) => o.goNetLinks.length > 0 && o.outcome === "not-found")
      .map((o) => ({ slug: o.slug, siteUrl: o.siteUrl, reason: o.reason })),
  };
}

export async function runPvGoNet(argv: string[]): Promise<ReturnType<typeof summarize>> {
  const args = parseArgs(argv);
  const slugs = selectSlugs(args);
  const fetchImpl = globalThis.fetch as unknown as PvFetchLike;
  const robots = args.robots
    ? new RobotsCache({ fetchImpl, userAgent: PV_USER_AGENT, timeoutMs: args.timeoutMs })
    : undefined;
  const fetcher = new Fetcher({ fetchImpl, timeoutMs: args.timeoutMs, delayMs: args.delayMs, ...(robots ? { robots } : {}) });
  const s3 = args.dryRun ? null : s3Client();
  const outcomes: CityOutcome[] = [];

  console.error(
    `[pv-gonet] targets=${slugs.length} dryRun=${args.dryRun} force=${args.force} robots=${args.robots ? "on" : "OFF"}`,
  );

  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i]!;
    try {
      const outcome = await processCity(slug, args, fetcher, s3);
      outcomes.push(outcome);
      const count = outcome.count !== undefined ? ` count=${outcome.count}` : "";
      const index = outcome.pvIndexUrl ? ` @ ${outcome.pvIndexUrl}` : "";
      const reason = outcome.reason ? ` (${outcome.reason})` : "";
      console.error(`${outcome.outcome.toUpperCase()} [${i + 1}/${slugs.length}] ${slug}${count}${index}${reason}`);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      outcomes.push({ slug, siteUrl: websiteForSlug(slug), goNetLinks: [], outcome: "error", reason });
      console.error(`ERROR [${i + 1}/${slugs.length}] ${slug}: ${reason}`);
    }
  }

  const report = summarize(outcomes);
  if (args.outFile) {
    writeFileSync(args.outFile, JSON.stringify(report, null, 2) + "\n");
    console.error(`Report written to ${args.outFile}`);
  }
  return report;
}

if (process.argv[1]?.endsWith("pv-gonet-run.ts")) {
  runPvGoNet(process.argv.slice(2))
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
    })
    .catch((e: unknown) => {
      console.error(e);
      process.exit(1);
    });
}
