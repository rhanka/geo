/**
 * pv-discover-unlisted.ts — Découverte automatique des PV pour les ~545 villes
 * absentes de ALL_PV_CITIES (status "to-research" dans coverage-matrix.json).
 *
 * Pour chaque ville:
 *   1. Récupère l'URL du site municipal via websiteForSlug
 *   2. Tente une liste de chemins canoniques PV (patterns QC courants)
 *   3. Vérifie HTTP 200 + contenu PV détectable (liens PDF, mots-clés)
 *   4. Dépose registry/qc-pv/<slug>/index.json en S3 si trouvé
 *
 * ANTI-INVENTION: seules les URLs réellement accessibles HTTP 200 avec
 * liens PDF/PV détectables sont enregistrées.
 *
 * Usage:
 *   npx tsx src/pv-discover-unlisted.ts --dry-run --limit 10
 *   npx tsx src/pv-discover-unlisted.ts --batch 0 --delay-ms 2000
 *   npx tsx src/pv-discover-unlisted.ts --slugs terrebonne,repentigny
 */

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { websiteForSlug } from "../../packages/geo-sources-americas/dist/ca-qc/municipalities/municipal-directory.js";
import { ALL_PV_CITIES, PV_USER_AGENT, type PvFetchLike } from "../../packages/qc-sources/src/sources/proces-verbaux-generic.js";
import type { RawDocumentRef } from "../../packages/qc-sources/src/SourceAdapter.js";
import { s3Client, exists, putBytes } from "./lib/s3.js";

// ── Config ───────────────────────────────────────────────────────────────────

const COVERAGE_MATRIX_PATH = "/home/antoinefa/src/geo/work/coverage/coverage-matrix.json";
const TIMEOUT_MS = 12_000;
const ROBOTS_TIMEOUT_MS = 5_000;
const DEFAULT_DELAY_MS = 2_000;

// Chemins PV canoniques pour les sites municipaux QC (ordre de probabilité)
const PV_PATH_CANDIDATES = [
  "/conseil-municipal/proces-verbaux/",
  "/municipalite/proces-verbaux/",
  "/seances-du-conseil/",
  "/la-ville/vie-democratique/seances-du-conseil/",
  "/ville/vie-democratique/seances-du-conseil/",
  "/mairie/seances-du-conseil/",
  "/ma-municipalite/vie-democratique/seances-du-conseil/",
  "/municipalite/vie-democratique/seances-du-conseil/",
  "/la-municipalite/vie-democratique/seances-du-conseil/",
  "/conseil-municipal/seances-du-conseil/",
  "/administration/seances-et-proces-verbaux/",
  "/vie-democratique/seances-du-conseil/",
  "/vie-municipale/vie-democratique/seances-du-conseil/",
  "/fr/municipalite/conseil-municipal/seances-du-conseil/",
  "/fr/la-ville/administration/seances-et-proces-verbaux",
  "/affaires-municipales/seances-du-conseil/",
  "/seances-conseil/",
  "/conseil-municipal/",
  "/proces-verbaux/",
  "/conseil-et-administration/proces-verbaux/",
  "/vie-democratique/proces-verbaux/",
  "/documents-publics/",
  "/democratie/seances-du-conseil/",
  "/la-ville/democratie/seances-du-conseil/",
  "/mairie-et-vie-municipale/seances-du-conseil/",
  "/fr/seances-du-conseil",
  "/fr/vie-democratique/seances-du-conseil/",
  "/fr/services-aux-citoyens/greffe/proces-verbaux-ordres-du-jour",
  "/municipalite/conseil-municipal/seances-du-conseil/",
  "/gestion-municipale/proces-verbaux/",
  "/notre-municipalite/vie-democratique/seances-du-conseil",
  "/conseil-municipal/calendriers-des-seances-ordres-du-jour-et-proces-verbaux/",
  "/vie-municipale/conseil-municipal/ordre-du-jour-et-proces-verbaux/",
  "/administration-municipale/seances-du-conseil/",
  "/municipalite/administration-et-finance/seances-du-conseil/",
  "/communications/proces-verbaux-seances/",
  "/seances-publiques/",
  "/ordre-du-jour-et-proces-verbaux/",
  "/ordres-du-jour-et-proces-verbaux/",
  "/fr/ma-ville/votre-conseil/ordres-du-jour-et-proces-verbaux",
  "/fr/ma-ville/vie-democratique/ordres-du-jour-et-proces-verbaux/",
  "/fr/vie-democratique/seances-du-conseil/categories/seances-du-conseil-2026",
  "/la-ville/conseil-municipal/seances-du-conseil/",
  "/seances-du-conseil-2026/",
  "/greffe/seance-du-conseil/",
  "/citoyens/greffe/seance-du-conseil/",
  "/vie-democratique/seances-du-conseil-municipal/",
  "/democratie-et-participation-citoyenne/seances-du-conseil",
  "/assemblee-du-conseil-municipal/",
  "/assemblees-du-conseil-municipal/",
  // Additional patterns for October CMS cities
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
  "/assemblee-ordinaire/",
  "/seance-extraordinaire/",
  "/archives-de-seances/",
  "/actes-du-conseil/",
  "/publications/proces-verbaux/",
];

// Patterns alternatifs spéciaux
const ALTERNATE_URL_PATTERNS = [
  // municipalites-du-quebec.com (portail générique pour petites municipalités)
  (slug: string) => `https://municipalites-du-quebec.com/${slug}/f-pv-2026.php`,
  (slug: string) => `https://municipalites-du-quebec.ca/${slug}/pdf_procesverbaux/`,
];

// ── Args ──────────────────────────────────────────────────────────────────────

interface Args {
  batch?: number;
  slugs?: string[];
  limit?: number;
  delayMs: number;
  dryRun: boolean;
  force: boolean;
  timeoutMs: number;
  noRobots: boolean;
  outFile?: string;
}

function parseArgs(argv: string[]): Args {
  const get = (k: string): string | undefined => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const has = (k: string) => argv.includes(`--${k}`);

  return {
    batch: get("batch") !== undefined ? Number(get("batch")) : undefined,
    slugs: get("slugs")?.split(",").map(s => s.trim()).filter(Boolean),
    limit: get("limit") !== undefined ? Number(get("limit")) : undefined,
    delayMs: Number(get("delay-ms") ?? DEFAULT_DELAY_MS),
    dryRun: has("dry-run"),
    force: has("force"),
    timeoutMs: Number(get("timeout-ms") ?? TIMEOUT_MS),
    noRobots: has("no-robots"),
    outFile: get("out"),
  };
}

// ── City selection ────────────────────────────────────────────────────────────

function loadCoverageMatrix(): Record<string, { pv?: { status?: string } }> {
  if (!existsSync(COVERAGE_MATRIX_PATH)) return {};
  const raw = JSON.parse(readFileSync(COVERAGE_MATRIX_PATH, "utf8")) as {
    cities?: Record<string, { pv?: { status?: string } }>;
  };
  return raw.cities ?? {};
}

function registeredSlugs(): Set<string> {
  return new Set(ALL_PV_CITIES.map(e => e.config.citySlug));
}

function selectCities(args: Args): string[] {
  // Explicit slugs override everything
  if (args.slugs && args.slugs.length > 0) return args.slugs;

  // Load matrix to find "to-research" cities
  const matrix = loadCoverageMatrix();
  const registered = registeredSlugs();

  const toResearch = Object.keys(matrix).filter(slug => {
    const pv = matrix[slug]?.pv;
    return pv?.status === "to-research" && !registered.has(slug);
  });

  // Apply batch split if --batch is set
  if (args.batch !== undefined) {
    const BATCH_SIZE = Math.ceil(toResearch.length / 8);
    const start = args.batch * BATCH_SIZE;
    const chunk = toResearch.slice(start, start + BATCH_SIZE);
    return args.limit !== undefined ? chunk.slice(0, args.limit) : chunk;
  }

  return args.limit !== undefined ? toResearch.slice(0, args.limit) : toResearch;
}

// ── Robots.txt cache ──────────────────────────────────────────────────────────

const robotsCache = new Map<string, string | null>();

async function getRobotsTxt(origin: string, fetchImpl: PvFetchLike): Promise<string | null> {
  if (robotsCache.has(origin)) return robotsCache.get(origin) ?? null;
  try {
    const res = await fetchImpl(`${origin}/robots.txt`, {
      signal: AbortSignal.timeout(ROBOTS_TIMEOUT_MS),
      headers: { "user-agent": PV_USER_AGENT },
    });
    if (!res.ok) { robotsCache.set(origin, null); return null; }
    const buf = await res.arrayBuffer();
    const txt = new TextDecoder().decode(new Uint8Array(buf));
    robotsCache.set(origin, txt);
    return txt;
  } catch {
    robotsCache.set(origin, null);
    return null;
  }
}

function isAllowedByRobots(robots: string | null, path: string): boolean {
  if (!robots) return true;
  let active = false;
  for (const raw of robots.split("\n")) {
    const ln = raw.trim();
    if (ln.toLowerCase().startsWith("user-agent:")) {
      const ua = ln.slice("user-agent:".length).trim();
      active = ua === "*" || ua.toLowerCase().includes("radar");
    }
    if (active && ln.toLowerCase().startsWith("disallow:")) {
      const dis = ln.slice("disallow:".length).trim();
      if (dis && path.startsWith(dis)) return false;
    }
  }
  return true;
}

// ── HTTP probe ────────────────────────────────────────────────────────────────

async function fetchUrl(
  url: string,
  fetchImpl: PvFetchLike,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; html: string } | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        signal: controller.signal,
        headers: { "user-agent": PV_USER_AGENT, accept: "text/html,*/*" },
      });
      clearTimeout(timer);
      if (!res.ok) return { ok: false, status: res.status, html: "" };
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("text/html") && !ct.includes("text/plain")) {
        return { ok: false, status: res.status, html: "" };
      }
      const buf = await res.arrayBuffer();
      const html = new TextDecoder("utf-8").decode(new Uint8Array(buf));
      return { ok: true, status: res.status, html };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

// ── PV content detection ──────────────────────────────────────────────────────

interface PvEntry {
  url: string;
  title?: string;
  contentType: string;
}

function extractPvEntries(html: string, baseUrl: string): PvEntry[] {
  const entries: PvEntry[] = [];
  const seen = new Set<string>();

  // Extract PDF links
  const pdfRe = /href=["']([^"']*\.pdf[^"']*)/gi;
  let m: RegExpExecArray | null;
  while ((m = pdfRe.exec(html)) !== null) {
    try {
      const url = new URL(m[1], baseUrl).href;
      if (!seen.has(url)) {
        seen.add(url);
        entries.push({ url, contentType: "application/pdf" });
      }
    } catch { /* skip invalid */ }
  }

  return entries.slice(0, 100);
}

function hasPvContext(html: string): boolean {
  return /proc[eèé]s.verbal|s[eéè]ance|conseil\s+municipal|ordre.du.jour/i.test(html);
}

function detectCms(url: string, html: string): string {
  if (url.includes("municipalites-du-quebec")) return "municipalites-du-quebec.com";
  if (html.includes("/storage/app/media")) return "October";
  if (html.includes("/wp-content/uploads") || html.includes("wp-json")) return "WordPress";
  if (html.includes("gestionweblex") || html.includes("GestionWeblex")) return "GestionWeblex";
  if (html.includes("goazimut") || html.includes("gonet") || html.includes("GoAzimut")) return "GoNet/GoAzimut";
  if (html.includes("idesign") || html.includes("i-design")) return "iDesign";
  if (html.includes("/statamic/") || html.includes("Statamic")) return "Statamic";
  if (html.includes("October") || html.includes("october-")) return "October";
  if (html.includes("/drupal") || html.includes("Drupal")) return "Drupal";
  if (html.includes("ASP.NET") || html.includes("__VIEWSTATE")) return "ASP.NET";
  return "unknown";
}

// ── S3 key ─────────────────────────────────────────────────────────────────────

function manifestKey(slug: string): string {
  return `registry/qc-pv/${slug}/index.json`;
}

// ── Home page crawl: find PV link from site homepage ─────────────────────────

/**
 * Fetch the site homepage and extract any link that looks like a PV/séances page.
 * Returns candidate internal URLs found in nav/menu links.
 */
async function findPvLinkFromHomepage(
  siteUrl: string,
  fetchImpl: PvFetchLike,
  timeoutMs: number,
): Promise<string[]> {
  const res = await fetchUrl(siteUrl + "/", fetchImpl, timeoutMs);
  if (!res?.ok || !res.html) return [];
  const html = res.html;

  // Look for anchor tags that contain PV/séance keywords
  const hrefRe = /href=["']([^"'#]+)["'][^>]*>[^<]*(?:proc[eèé]s.verbal|s[eèé]ance|conseil|ordre.du.jour|assembl[eèé]e)[^<]*/gi;
  const found: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null) {
    try {
      const u = new URL(m[1], siteUrl).href;
      // Only internal links
      if (u.startsWith(siteUrl)) {
        found.push(u);
      }
    } catch { /* skip */ }
  }

  // Also try the reverse: href containing PV/séance keywords in the href itself
  const hrefKeyRe = /href=["']([^"'#]*(?:proc[eèé]s.verbaux?|s[eèé]ances|conseil|ordres?-du-jour)[^"'#]*)["']/gi;
  while ((m = hrefKeyRe.exec(html)) !== null) {
    try {
      const u = new URL(m[1], siteUrl).href;
      if (u.startsWith(siteUrl)) {
        found.push(u);
      }
    } catch { /* skip */ }
  }

  return [...new Set(found)].slice(0, 10);
}

// ── Main discovery for one city ──────────────────────────────────────────────

type Outcome =
  | { kind: "skip-existing" }
  | { kind: "no-website" }
  | { kind: "scraped"; pvIndexUrl: string; count: number; cms: string }
  | { kind: "not-found"; tried: number }
  | { kind: "obscura"; reason: string }
  | { kind: "error"; reason: string };

async function discoverCity(
  slug: string,
  opts: {
    s3: ReturnType<typeof s3Client> | null;
    fetchImpl: PvFetchLike;
    timeoutMs: number;
    delayMs: number;
    force: boolean;
    noRobots: boolean;
    dryRun: boolean;
  },
): Promise<Outcome> {
  const { s3, fetchImpl, timeoutMs, force, noRobots, dryRun } = opts;
  const key = manifestKey(slug);

  // Idempotent skip
  if (s3 && !force && (await exists(s3, key))) {
    return { kind: "skip-existing" };
  }

  // Get base URL
  const siteUrl = websiteForSlug(slug);

  // Build candidate list
  const candidates: string[] = [];

  // 1. municipalites-du-quebec.com patterns first (fast check for small towns)
  for (const fn of ALTERNATE_URL_PATTERNS) {
    candidates.push(fn(slug));
  }

  // 2. Paths on the municipal site
  if (siteUrl) {
    const base = siteUrl.replace(/\/$/, "");
    for (const path of PV_PATH_CANDIDATES) {
      candidates.push(`${base}${path}`);
    }
  } else {
    // Try to guess the site URL from slug
    const guesses = [
      `https://www.municipalite.${slug}.qc.ca`,
      `https://www.${slug}.ca`,
      `https://${slug}.ca`,
      `https://municipalite.${slug}.qc.ca`,
    ];
    for (const g of guesses) {
      for (const path of PV_PATH_CANDIDATES.slice(0, 8)) {
        candidates.push(`${g}${path}`);
      }
    }
  }

  // Also try to discover via homepage crawl (additional candidates)
  if (siteUrl) {
    const homeLinks = await findPvLinkFromHomepage(siteUrl, fetchImpl, timeoutMs);
    candidates.push(...homeLinks);
  }

  let tried = 0;
  const robotsChecked = new Map<string, string | null>();

  for (const url of [...new Set(candidates)]) {
    let origin: URL;
    try {
      origin = new URL(url);
    } catch { continue; }

    // Robots check (cached per origin)
    if (!noRobots) {
      const originKey = origin.origin;
      if (!robotsChecked.has(originKey)) {
        const robots = await getRobotsTxt(originKey, fetchImpl);
        robotsChecked.set(originKey, robots);
      }
      const robots = robotsChecked.get(originKey) ?? null;
      if (!isAllowedByRobots(robots, origin.pathname)) continue;
    }

    tried++;
    const res = await fetchUrl(url, fetchImpl, timeoutMs);
    if (!res || !res.ok) continue;

    const html = res.html;

    // Check for Cloudflare / JS walls (obscura)
    if (
      html.includes("challenges.cloudflare.com") ||
      html.includes("Just a moment") ||
      html.includes("Enable JavaScript and cookies") ||
      html.includes("cf-browser-verification")
    ) {
      // This city's site is behind CF — note it but keep trying other URLs
      continue;
    }

    // Check for JS-only portals (GoNet, GoAzimut)
    if (
      html.includes("goazimut") ||
      html.includes("gonet") ||
      (html.includes("GoAzimut") || html.includes("GONet"))
    ) {
      return { kind: "obscura", reason: "GoNet/GoAzimut portal" };
    }

    if (!hasPvContext(html)) continue;

    const entries = extractPvEntries(html, url);
    if (entries.length === 0) continue;

    const cms = detectCms(url, html);

    const manifest = {
      _note:
        "PV index discovered by pv-discover-unlisted.ts (auto-discovery). " +
        "URL verified HTTP 200 with PV link extraction. No fabrication. " +
        "Each entry is a real PDF ref from the live pvIndexUrl.",
      _generatedAt: new Date().toISOString(),
      slug,
      sourceId: `proces-verbaux-${slug}`,
      pvIndexUrl: url,
      windowDays: 183,
      userAgent: PV_USER_AGENT,
      count: entries.length,
      entries,
    };

    if (s3 && !dryRun) {
      await putBytes(
        s3,
        key,
        JSON.stringify(manifest, null, 2) + "\n",
        "application/json",
      );
    }

    return { kind: "scraped", pvIndexUrl: url, count: entries.length, cms };
  }

  if (tried === 0) return { kind: "no-website" };
  return { kind: "not-found", tried };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const fetchImpl = globalThis.fetch as unknown as PvFetchLike;
  const cities = selectCities(args);
  const s3 = args.dryRun ? null : s3Client();

  console.error(
    `[pv-discover] ${cities.length} cities` +
    (args.batch !== undefined ? ` batch=${args.batch}` : "") +
    ` delay=${args.delayMs}ms dry-run=${args.dryRun} force=${args.force}`,
  );

  const stats = {
    scraped: 0,
    notFound: 0,
    skipExisting: 0,
    noWebsite: 0,
    obscura: 0,
    errors: 0,
  };
  const cms: Record<string, number> = {};
  const scraped: { slug: string; url: string; count: number; cms: string }[] = [];
  const notFound: string[] = [];
  const obscura: { slug: string; reason: string }[] = [];

  for (let i = 0; i < cities.length; i++) {
    const slug = cities[i]!;

    // Politeness delay between fetches
    if (i > 0) await new Promise(r => setTimeout(r, args.delayMs));

    let outcome: Outcome;
    try {
      outcome = await discoverCity(slug, {
        s3,
        fetchImpl,
        timeoutMs: args.timeoutMs,
        delayMs: args.delayMs,
        force: args.force,
        noRobots: args.noRobots,
        dryRun: args.dryRun,
      });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      stats.errors++;
      console.error(`ERR ${slug}: ${reason}`);
      continue;
    }

    switch (outcome.kind) {
      case "scraped":
        stats.scraped++;
        cms[outcome.cms] = (cms[outcome.cms] ?? 0) + 1;
        scraped.push({ slug, url: outcome.pvIndexUrl, count: outcome.count, cms: outcome.cms });
        console.error(`OK  [${i+1}/${cities.length}] ${slug}: ${outcome.count} PV @ ${outcome.pvIndexUrl} (${outcome.cms})`);
        if (!args.dryRun) {
          console.error(`  → s3://registry/qc-pv/${slug}/index.json`);
        }
        break;
      case "not-found":
        stats.notFound++;
        notFound.push(slug);
        console.error(`--- [${i+1}/${cities.length}] ${slug}: not found (${outcome.tried} tried)`);
        break;
      case "skip-existing":
        stats.skipExisting++;
        console.error(`>>> [${i+1}/${cities.length}] ${slug}: already exists`);
        break;
      case "no-website":
        stats.noWebsite++;
        notFound.push(slug);
        console.error(`??? [${i+1}/${cities.length}] ${slug}: no website in directory`);
        break;
      case "obscura":
        stats.obscura++;
        obscura.push({ slug, reason: outcome.reason });
        console.error(`JS  [${i+1}/${cities.length}] ${slug}: obscura (${outcome.reason})`);
        break;
      case "error":
        stats.errors++;
        console.error(`ERR [${i+1}/${cities.length}] ${slug}: ${outcome.reason}`);
        break;
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    batch: args.batch,
    stats,
    cms,
    scraped,
    notFound,
    obscura,
  };

  console.error(`\n=== FIN pv-discover ===`);
  console.error(
    `scraped=${stats.scraped} notFound=${stats.notFound} skip=${stats.skipExisting}` +
    ` noWebsite=${stats.noWebsite} obscura=${stats.obscura} errors=${stats.errors}`,
  );
  console.error(`CMS: ${JSON.stringify(cms)}`);

  if (args.outFile) {
    writeFileSync(args.outFile, JSON.stringify(report, null, 2) + "\n");
    console.error(`Report written to ${args.outFile}`);
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
