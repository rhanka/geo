/**
 * Pure rules for the B' "find ANOTHER density document" campaign.
 *
 * Network I/O deliberately lives outside this module.  The cluster runner feeds
 * it HTML, sitemap, CDX and document text that have already passed through
 * `capturedFetch`; unit tests can therefore exercise every scope and
 * anti-invention gate without a live municipal host.
 */
import { createHash } from "node:crypto";

import { candidatePagesForCity } from "./grille-discovery.js";

export const DENSITY_DISCOVERY_CONTRACT = "density-document-discovery/v1" as const;
export const DENSITY_DISCOVERY_SCOPE_COUNT = 56;
export const DENSITY_DISCOVERY_LOT_SIZE = 12;

export interface DensityDiscoveryBaselineRow {
  slug: string;
  category: string | null;
  manifest_source_url: string | null;
  manifest_snapshot: string | null;
}

export interface DensityDiscoveryBaseline {
  classification_version?: unknown;
  rows?: unknown;
}

export interface DensityDiscoveryIdentity {
  slug: string;
  name: string;
  mamhCode: string;
  website: string;
}

export interface DensityDiscoveryTarget extends DensityDiscoveryIdentity {
  excludedSourceUrl: string | null;
  excludedSourceSha256: string | null;
  excludedSourceStorageKey: string | null;
  baselineSnapshot: string | null;
}

export interface DensityDiscoveryWorklist {
  contract: typeof DENSITY_DISCOVERY_CONTRACT;
  baselineKey: string;
  baselineSha256: string;
  lot: number;
  lots: number;
  targets: DensityDiscoveryTarget[];
}

export type DiscoveryStrategy =
  | "sibling"
  | "zone-sheet"
  | "sitemap"
  | "sig"
  | "wayback";

export interface DiscoverySeed {
  url: string;
  strategy: DiscoveryStrategy;
  kind: "html" | "sitemap" | "cdx";
}

export interface DiscoveredLink {
  url: string;
  title: string;
  strategy: DiscoveryStrategy;
  score: number;
  reasons: string[];
  sourceUrl: string;
}

export interface CdxDocument {
  timestamp: string;
  originalUrl: string;
  mime: string | null;
  status: number | null;
  digest: string | null;
  length: number | null;
}

export interface DensityTextHit {
  page: number;
  label:
    | "densite"
    | "logements-hectare"
    | "nombre-logements"
    | "cos"
    | "terrain-par-logement";
  verbatim: string;
}

export interface DensityNormValueHit {
  page: number;
  label: DensityTextHit["label"];
  zoneCodes: string[];
  rawValues: string[];
  unit:
    | "logements/hectare"
    | "logements/batiment"
    | "logements/terrain"
    | "cos"
    | "terrain/logement"
    | "densite-explicite";
  verbatim: string;
}

const HTTP_RE = /^https?:\/\//i;
const DOCUMENT_EXT_RE = /\.(?:pdf|xlsx?|xlsm|ods)(?:[?#].*)?$/i;
const OPAQUE_DOCUMENT_RE =
  /\/(?:file-\d+|document(?:s)?(?:\/|[?#])|telecharg(?:er|ement)|download|media\/|fichiers?upload\/)/i;
const PAGE_INTEREST_RE =
  /urbanism|zonage|reglement|r[eè]glement|amenagement|am[eé]nagement|grille|specification|sp[eé]cification|annexe|densit|logement|habitation|occupation|norme|usage|sig|geomatique|g[eé]omatique/i;
const DOCUMENT_INTEREST_RE =
  /grille|specification|sp[eé]cification|annexe|zonage|densit|logements?|habitation|occupation|normes?|usages?|cos(?:\b|_)|zone[-_ ]?[a-z]{1,4}[-_ ]?\d/i;
const PROJECT_RE =
  /\b(?:premier|1er|deuxi[eè]me|second|2e)[-_ ]+projet\b|\bprojet[-_ ]+de[-_ ]+r[eè]glement\b|\bavis[-_ ]+(?:public|de[-_ ]+motion)\b|\bpour[-_ ]adoption\b/i;
const SIG_HOST_RE =
  /(?:arcgis\.com|arcgisonline\.com|maps\.arcgis\.com|experience\.arcgis\.com|geocentriq|goazimut|gonet|jmap|vplus)/i;

function fold(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function isHttpUrl(value: string): boolean {
  if (!HTTP_RE.test(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Treat scheme/www aliases of the same path as the same document identity.
 * Municipal sites routinely redirect between those aliases; accepting one as
 * "another document" would merely reinterpret the excluded source.
 */
export function equivalentDocumentUrl(left: string, right: string): boolean {
  try {
    const identity = (value: string): string => {
      const parsed = new URL(value);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
      const port = parsed.port && !(
        (parsed.protocol === "http:" && parsed.port === "80")
        || (parsed.protocol === "https:" && parsed.port === "443")
      ) ? `:${parsed.port}` : "";
      const path = safeDecodeUrl(parsed.pathname).replace(/\/+$/, "") || "/";
      parsed.searchParams.delete("utm_source");
      parsed.searchParams.delete("utm_medium");
      parsed.searchParams.delete("utm_campaign");
      parsed.searchParams.sort();
      return `${host}${port}${path}${parsed.search}`;
    };
    return identity(left) === identity(right);
  } catch {
    return false;
  }
}

function canonicalUrl(value: string): string {
  const parsed = new URL(value);
  parsed.hash = "";
  if ((parsed.protocol === "https:" && parsed.port === "443") || (parsed.protocol === "http:" && parsed.port === "80")) {
    parsed.port = "";
  }
  return parsed.href;
}

export function sha256Hex(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function parseDensityDiscoveryBaseline(value: unknown): DensityDiscoveryBaselineRow[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as DensityDiscoveryBaseline).rows)) {
    throw new Error("baseline densité invalide: rows[] requis");
  }
  const rows = (value as { rows: unknown[] }).rows
    .filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
    .filter((row) => row["category"] === "acquise_sans_densite")
    .map((row): DensityDiscoveryBaselineRow => {
      const slug = row["slug"];
      if (typeof slug !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
        throw new Error(`slug baseline invalide: ${String(slug)}`);
      }
      return {
        slug,
        category: "acquise_sans_densite",
        manifest_source_url:
          typeof row["manifest_source_url"] === "string" ? row["manifest_source_url"] : null,
        manifest_snapshot:
          typeof row["manifest_snapshot"] === "string" ? row["manifest_snapshot"] : null,
      };
    })
    .sort((left, right) => left.slug.localeCompare(right.slug));
  const unique = new Set(rows.map((row) => row.slug));
  if (rows.length !== DENSITY_DISCOVERY_SCOPE_COUNT || unique.size !== DENSITY_DISCOVERY_SCOPE_COUNT) {
    throw new Error(
      `périmètre densité invalide: ${rows.length} lignes / ${unique.size} slugs, attendu ${DENSITY_DISCOVERY_SCOPE_COUNT}`,
    );
  }
  return rows;
}

export function stableDensityDiscoveryLots<T>(values: readonly T[]): T[][] {
  if (values.length !== DENSITY_DISCOVERY_SCOPE_COUNT) {
    throw new Error(`lots refusés hors univers fermé de ${DENSITY_DISCOVERY_SCOPE_COUNT}`);
  }
  const lots: T[][] = [];
  for (let offset = 0; offset < values.length; offset += DENSITY_DISCOVERY_LOT_SIZE) {
    lots.push(values.slice(offset, offset + DENSITY_DISCOVERY_LOT_SIZE));
  }
  return lots;
}

export function parseDensityDiscoveryWorklist(value: unknown): DensityDiscoveryWorklist {
  if (!value || typeof value !== "object") throw new Error("worklist densité invalide");
  const raw = value as Partial<DensityDiscoveryWorklist>;
  if (raw.contract !== DENSITY_DISCOVERY_CONTRACT) throw new Error("contrat worklist densité invalide");
  if (
    typeof raw.baselineKey !== "string"
    || !raw.baselineKey
    || typeof raw.baselineSha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(raw.baselineSha256)
    || !Number.isInteger(raw.lot)
    || !Number.isInteger(raw.lots)
    || (raw.lot ?? 0) < 1
    || (raw.lots ?? 0) < 1
    || !Array.isArray(raw.targets)
    || raw.targets.length < 1
    || raw.targets.length > DENSITY_DISCOVERY_LOT_SIZE
  ) {
    throw new Error("métadonnées worklist densité invalides");
  }
  const targets = raw.targets.map((target) => {
    if (
      !target
      || typeof target !== "object"
      || typeof target.slug !== "string"
      || typeof target.name !== "string"
      || typeof target.mamhCode !== "string"
      || typeof target.website !== "string"
      || !isHttpUrl(target.website)
      || (target.excludedSourceUrl !== null && (typeof target.excludedSourceUrl !== "string" || !isHttpUrl(target.excludedSourceUrl)))
      || (target.excludedSourceSha256 !== null && (typeof target.excludedSourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(target.excludedSourceSha256)))
      || (target.excludedSourceStorageKey !== null && typeof target.excludedSourceStorageKey !== "string")
      || (target.baselineSnapshot !== null && typeof target.baselineSnapshot !== "string")
    ) {
      throw new Error("cible worklist densité invalide");
    }
    return target;
  });
  if (new Set(targets.map((target) => target.slug)).size !== targets.length) {
    throw new Error("worklist densité contient un slug dupliqué");
  }
  const lot = raw.lot;
  const lots = raw.lots;
  if (lot === undefined || lots === undefined) throw new Error("numéros de lot absents");
  return {
    contract: DENSITY_DISCOVERY_CONTRACT,
    baselineKey: raw.baselineKey,
    baselineSha256: raw.baselineSha256,
    lot,
    lots,
    targets,
  };
}

/**
 * Repartition only unfinished targets from immutable worklists. The caller
 * supplies the measured pending slugs; unknown/out-of-scope slugs are refused.
 * Original targets (including old-source exclusions) are copied verbatim.
 */
export function buildDensityDiscoveryResumeWorklists(
  worklists: readonly DensityDiscoveryWorklist[],
  pendingSlugs: ReadonlySet<string>,
  firstLot: number,
): DensityDiscoveryWorklist[] {
  if (!Number.isInteger(firstLot) || firstLot < 1) throw new Error("firstLot invalide");
  if (worklists.length === 0) throw new Error("worklists source absentes");
  const baselines = new Set(
    worklists.map((worklist) => `${worklist.baselineKey}:${worklist.baselineSha256}`),
  );
  if (baselines.size !== 1) throw new Error("baselines de reprise incompatibles");
  const allTargets = worklists.flatMap((worklist) => worklist.targets);
  const bySlug = new Map(allTargets.map((target) => [target.slug, target]));
  if (bySlug.size !== allTargets.length) throw new Error("slug dupliqué dans les worklists source");
  const unknown = [...pendingSlugs].filter((slug) => !bySlug.has(slug));
  if (unknown.length > 0) throw new Error(`reprise hors périmètre: ${unknown.join(",")}`);
  const pending = [...pendingSlugs]
    .sort((left, right) => left.localeCompare(right))
    .map((slug) => bySlug.get(slug)!);
  if (pending.length === 0) return [];
  const lotCount = Math.ceil(pending.length / DENSITY_DISCOVERY_LOT_SIZE);
  const totalLots = firstLot + lotCount - 1;
  const first = worklists[0]!;
  const output: DensityDiscoveryWorklist[] = [];
  const baseSize = Math.floor(pending.length / lotCount);
  const largerLots = pending.length % lotCount;
  let offset = 0;
  for (let lotIndex = 0; lotIndex < lotCount; lotIndex++) {
    const size = baseSize + (lotIndex < largerLots ? 1 : 0);
    output.push(parseDensityDiscoveryWorklist({
      contract: DENSITY_DISCOVERY_CONTRACT,
      baselineKey: first.baselineKey,
      baselineSha256: first.baselineSha256,
      lot: firstLot + output.length,
      lots: totalLots,
      targets: pending.slice(offset, offset + size),
    }));
    offset += size;
  }
  return output;
}

function addSeed(
  seeds: DiscoverySeed[],
  seen: Set<string>,
  url: string,
  strategy: DiscoveryStrategy,
  kind: DiscoverySeed["kind"],
): void {
  if (!isHttpUrl(url)) return;
  const canonical = canonicalUrl(url);
  if (seen.has(canonical)) return;
  seen.add(canonical);
  seeds.push({ url: canonical, strategy, kind });
}

function directoryPage(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!DOCUMENT_EXT_RE.test(parsed.pathname) && !OPAQUE_DOCUMENT_RE.test(parsed.pathname)) {
      return parsed.href;
    }
    const slash = parsed.pathname.lastIndexOf("/");
    parsed.pathname = slash >= 0 ? parsed.pathname.slice(0, slash + 1) : "/";
    parsed.search = "";
    parsed.hash = "";
    return parsed.href;
  } catch {
    return null;
  }
}

/** Preserve the municipality path on shared hosts; never expand to the whole host. */
export function waybackScope(website: string): string {
  const parsed = new URL(website);
  const path = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.host.replace(/^www\./i, "")}${path}`;
}

export function buildDensityDiscoverySeeds(target: DensityDiscoveryTarget): DiscoverySeed[] {
  const seeds: DiscoverySeed[] = [];
  const seen = new Set<string>();
  for (const page of candidatePagesForCity(target.website)) {
    addSeed(seeds, seen, page, "sibling", "html");
  }
  const site = new URL(target.website);
  for (const path of ["/sitemap.xml", "/sitemap_index.xml", "/wp-sitemap.xml"]) {
    addSeed(seeds, seen, new URL(path, site.origin).href, "sitemap", "sitemap");
  }
  if (target.excludedSourceUrl) {
    const parent = directoryPage(target.excludedSourceUrl);
    if (parent) {
      const isNavigationPage = canonicalUrl(parent) === canonicalUrl(target.excludedSourceUrl);
      addSeed(seeds, seen, parent, isNavigationPage ? "sibling" : "sibling", "html");
      const sourceOrigin = new URL(target.excludedSourceUrl).origin;
      addSeed(seeds, seen, `${sourceOrigin}/sitemap.xml`, "sitemap", "sitemap");
      addSeed(seeds, seen, `${sourceOrigin}/wp-sitemap.xml`, "sitemap", "sitemap");
    }
  }
  const scope = waybackScope(target.website);
  const cdx = new URL("https://web.archive.org/cdx/search/cdx");
  cdx.searchParams.set("url", `${scope}*`);
  cdx.searchParams.set("output", "text");
  cdx.searchParams.set("fl", "timestamp,original,mimetype,statuscode,digest,length");
  cdx.searchParams.append("filter", "statuscode:200");
  cdx.searchParams.set("collapse", "urlkey");
  cdx.searchParams.set("limit", "5000");
  addSeed(seeds, seen, cdx.href, "wayback", "cdx");
  return seeds;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function scoreLink(title: string, url: string): { score: number; reasons: string[]; strategy: DiscoveryStrategy } {
  const haystack = fold(`${title} ${safeDecodeUrl(url)}`);
  const reasons: string[] = [];
  let score = 0;
  let strategy: DiscoveryStrategy = "sibling";
  const signal = (re: RegExp, points: number, reason: string): void => {
    if (!re.test(haystack)) return;
    score += points;
    reasons.push(reason);
  };
  signal(/densit/, 10, "densité");
  signal(/logements?.{0,12}hectare|log[-_. /]?ha/, 10, "logements/hectare");
  signal(/coefficient.{0,15}occupation|(?:^|[^a-z])cos(?:[^a-z]|$)/, 8, "COS");
  signal(/terrain.{0,20}logement/, 8, "terrain/logement");
  signal(/grille/, 6, "grille");
  signal(/specification/, 5, "spécifications");
  signal(/annexe/, 3, "annexe");
  signal(/zonage/, 3, "zonage");
  signal(/usages?.{0,10}normes?/, 5, "usages/normes");
  if (/zone[-_ ]?[a-z]{1,4}[-_ ]?\d/.test(haystack)) {
    score += 4;
    reasons.push("fiche de zone");
    strategy = "zone-sheet";
  }
  if (SIG_HOST_RE.test(url)) {
    score += 4;
    reasons.push("portail SIG");
    strategy = "sig";
  }
  if (PROJECT_RE.test(haystack)) {
    score -= 100;
    reasons.push("projet/avis exclu");
  }
  return { score, reasons, strategy };
}

export function safeDecodeUrl(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function discoverDensityLinks(
  body: string,
  sourceUrl: string,
  excludedSourceUrl: string | null,
): { documents: DiscoveredLink[]; pages: DiscoveredLink[] } {
  const documents: DiscoveredLink[] = [];
  const pages: DiscoveredLink[] = [];
  const seen = new Set<string>();
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of body.matchAll(anchorRe)) {
    const attrs = match[1] ?? "";
    const href = attrs.match(/(?:^|\s)href\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href || /^(?:#|javascript:|mailto:|tel:|data:)/i.test(href.trim())) continue;
    let url: string;
    try {
      url = canonicalUrl(new URL(decodeEntities(href.trim()), sourceUrl).href);
    } catch {
      continue;
    }
    if (excludedSourceUrl && equivalentDocumentUrl(url, excludedSourceUrl)) continue;
    if (seen.has(url)) continue;
    const title = decodeEntities((match[2] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    const scored = scoreLink(title, url);
    const documentLike = DOCUMENT_EXT_RE.test(url) || OPAQUE_DOCUMENT_RE.test(url);
    if (documentLike && scored.score >= 3) {
      seen.add(url);
      documents.push({
        url,
        title,
        strategy: scored.strategy,
        score: scored.score,
        reasons: scored.reasons,
        sourceUrl,
      });
      continue;
    }
    if (!documentLike && PAGE_INTEREST_RE.test(fold(`${title} ${url}`)) && scored.score > -50) {
      seen.add(url);
      pages.push({
        url,
        title,
        strategy: scored.strategy,
        score: scored.score,
        reasons: scored.reasons,
        sourceUrl,
      });
    }
  }
  documents.sort((left, right) => right.score - left.score || left.url.localeCompare(right.url));
  pages.sort((left, right) => right.score - left.score || left.url.localeCompare(right.url));
  return { documents, pages };
}

export function sitemapLocations(xml: string, sourceUrl: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of xml.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)) {
    const raw = decodeEntities((match[1] ?? "").trim());
    try {
      const url = canonicalUrl(new URL(raw, sourceUrl).href);
      if (seen.has(url)) continue;
      seen.add(url);
      out.push(url);
    } catch {
      // A malformed sitemap entry is evidence of neither presence nor absence.
    }
  }
  return out;
}

export function interestingSitemapLocations(urls: readonly string[]): {
  documents: string[];
  pages: string[];
  sitemaps: string[];
} {
  const documents: string[] = [];
  const pages: string[] = [];
  const sitemaps: string[] = [];
  for (const url of urls) {
    const haystack = fold(safeDecodeUrl(url));
    if (/sitemap.*\.xml(?:[?#].*)?$/.test(haystack)) {
      sitemaps.push(url);
    } else if ((DOCUMENT_EXT_RE.test(url) || OPAQUE_DOCUMENT_RE.test(url)) && DOCUMENT_INTEREST_RE.test(haystack) && !PROJECT_RE.test(haystack)) {
      documents.push(url);
    } else if (PAGE_INTEREST_RE.test(haystack) && !PROJECT_RE.test(haystack)) {
      pages.push(url);
    }
  }
  return { documents, pages, sitemaps };
}

export function parseCdxDocuments(text: string): CdxDocument[] {
  const out: CdxDocument[] = [];
  const seen = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("<")) continue;
    const [timestamp, originalUrl, mimeRaw, statusRaw, digestRaw, lengthRaw] = line.split(/\s+/);
    if (!timestamp || !/^\d{14}$/.test(timestamp) || !originalUrl || !isHttpUrl(originalUrl)) continue;
    if (seen.has(originalUrl)) continue;
    const status = statusRaw && /^\d+$/.test(statusRaw) ? Number(statusRaw) : null;
    if (status !== null && status !== 200) continue;
    seen.add(originalUrl);
    out.push({
      timestamp,
      originalUrl,
      mime: mimeRaw && mimeRaw !== "-" ? mimeRaw : null,
      status,
      digest: digestRaw && digestRaw !== "-" ? digestRaw : null,
      length: lengthRaw && /^\d+$/.test(lengthRaw) ? Number(lengthRaw) : null,
    });
  }
  return out;
}

export function interestingCdxDocuments(rows: readonly CdxDocument[]): CdxDocument[] {
  return rows
    .filter((row) => {
      const haystack = fold(safeDecodeUrl(row.originalUrl));
      const documentLike = DOCUMENT_EXT_RE.test(row.originalUrl) || /pdf|spreadsheet|excel/.test(row.mime ?? "");
      return documentLike && DOCUMENT_INTEREST_RE.test(haystack) && !PROJECT_RE.test(haystack);
    })
    .sort((left, right) => {
      const l = scoreLink("", left.originalUrl).score;
      const r = scoreLink("", right.originalUrl).score;
      return r - l || right.timestamp.localeCompare(left.timestamp);
    });
}

export function waybackSnapshotUrl(row: Pick<CdxDocument, "timestamp" | "originalUrl">): string {
  return `https://web.archive.org/web/${row.timestamp}id_/${row.originalUrl}`;
}

export function waybackSnapshotOriginalUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.hostname.toLowerCase() !== "web.archive.org") return null;
    const path = safeDecodeUrl(parsed.pathname + parsed.search);
    return /^\/web\/\d{14}(?:id_)?\/(https?:\/\/.+)$/i.exec(path)?.[1] ?? null;
  } catch {
    return null;
  }
}

const DENSITY_PATTERNS: ReadonlyArray<{
  label: DensityTextHit["label"];
  re: RegExp;
}> = [
  { label: "densite", re: /\bdensit[eé]\s+(?:brute|nette|r[eé]sidentielle)?/i },
  { label: "logements-hectare", re: /\b(?:logements?|log\.?|unit[eé]s?)\s*(?:\/|par|[àa])\s*(?:l['’]\s*)?hectare\b|\blog\.?\s*\/\s*ha\b/i },
  { label: "nombre-logements", re: /\bnombre\s+(?:minimal|maximal|maximum|minimum)?\s*(?:de\s+)?logements?\b/i },
  { label: "cos", re: /\bcoefficient\s+d['’]\s*occupation\s+du\s+sol\b|\bC\.?\s*O\.?\s*S\.?\b/i },
  { label: "terrain-par-logement", re: /\bsuperficie\s+minimale\s+(?:de\s+)?terrain\s+par\s+logement\b/i },
];

/** Candidate signals only. A caller must still prove zone + value/unit + legal date. */
export function densityTextHits(text: string, maxHits = 40): DensityTextHit[] {
  const hits: DensityTextHit[] = [];
  const pages = text.split("\f");
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex] ?? "";
    const lines = page.split(/\r?\n/);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex] ?? "";
      for (const pattern of DENSITY_PATTERNS) {
        if (!pattern.re.test(line)) continue;
        const context = lines
          .slice(Math.max(0, lineIndex - 1), Math.min(lines.length, lineIndex + 2))
          .map((value) => value.trim())
          .filter(Boolean)
          .join(" ")
          .replace(/\s+/g, " ")
          .slice(0, 500);
        hits.push({ page: pageIndex + 1, label: pattern.label, verbatim: context });
        if (hits.length >= maxHits) return hits;
      }
    }
  }
  return hits;
}

function numericTokens(value: string): string[] {
  return [...value.matchAll(/(?<![A-Za-zÀ-ÿ])\d+(?:[.,]\d+)?(?:\s*\/\s*\d+(?:[.,]\d+)?)?/g)]
    .map((match) => match[0]!.replace(/\s+/g, ""));
}

/**
 * Stronger than densityTextHits: retain only passages where the native text
 * carries a numeric norm next to the density label. This still does not decide
 * legal force or fold anything.
 */
export function densityNormValueHits(text: string, maxHits = 80): DensityNormValueHit[] {
  const hits: DensityNormValueHit[] = [];
  for (const [pageIndex, page] of text.split("\f").entries()) {
    const zoneCodes = [...new Set(
      [...page.matchAll(/\bZONE\s*:?\s+([A-Z0-9][A-Z0-9._ -]{0,20})/gi)]
        .map((match) => (match[1] ?? "").trim().split(/\s{2,}/)[0] ?? "")
        .filter(Boolean),
    )].slice(0, 12);
    const lines = page.split(/\r?\n/);
    for (const line of lines) {
      const rules: Array<{
        label: DensityTextHit["label"];
        unit: DensityNormValueHit["unit"];
        re: RegExp;
      }> = [
        {
          label: "logements-hectare",
          unit: "logements/hectare",
          re: /(?:logements?|log\.?|unit[eé]s?)\s*(?:\/|par|[àa])\s*(?:l['’]\s*)?hectare(?:\s+maximum)?\s*[:=-]?\s*(.+)$/i,
        },
        {
          label: "nombre-logements",
          unit: "logements/terrain",
          re: /nombre\s+de\s+logements?\s*(?:\/|par)\s*terrains?\s*\((?:min|max)[^)]*\)\s*[:=-]?\s*(.+)$/i,
        },
        {
          label: "nombre-logements",
          unit: "logements/batiment",
          re: /nombre\s+(?:(?:minimal|maximal|maximum|minimum)\s+)?(?:de\s+)?logements?(?:\s+par\s+b[âa]timent)?\s*[:=-]?\s*(.+)$/i,
        },
        {
          label: "nombre-logements",
          unit: "logements/batiment",
          re: /nombre\s+de\s+logements?\s+par\s+b[âa]timent\s*[:=-]?\s*(.+)$/i,
        },
        {
          label: "cos",
          unit: "cos",
          re: /(?:coefficient\s+d['’]\s*occupation\s+du\s+sol|C\.?\s*O\.?\s*S\.?)(?:\s+maximum)?\s*[:=-]?\s*(.+)$/i,
        },
        {
          label: "terrain-par-logement",
          unit: "terrain/logement",
          re: /superficie\s+minimale\s+(?:de\s+)?terrain\s+par\s+logement\s*[:=-]?\s*(.+)$/i,
        },
        {
          label: "densite",
          unit: "densite-explicite",
          re: /densit[eé]\s+(?:brute|nette|r[eé]sidentielle)?\s*[:=-]\s*(.+)$/i,
        },
      ];
      for (const rule of rules) {
        const match = rule.re.exec(line);
        if (!match) continue;
        const values = numericTokens(match[1] ?? "");
        if (values.length === 0) continue;
        hits.push({
          page: pageIndex + 1,
          label: rule.label,
          zoneCodes,
          rawValues: values.slice(0, 24),
          unit: rule.unit,
          verbatim: line.trim().replace(/\s+/g, " ").slice(0, 1_200),
        });
        if (hits.length >= maxHits) return hits;
        break;
      }
    }
  }
  return hits;
}

export function hasHardProjectMarker(titleAndText: string): boolean {
  return PROJECT_RE.test(titleAndText);
}
