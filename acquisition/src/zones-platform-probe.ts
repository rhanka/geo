/**
 * zones-platform-probe.ts — DÉTECTION STATIQUE (sans Chromium) des plateformes
 * GIS d'une liste de villes, en suivant les liens CROSS-HOST (sous-domaines
 * `geo.`/`carte.`/`sig.`) que le crawler obscura (same-host only) rate.
 *
 * But : tester l'hypothèse "des portails JMap/IGO/WFS se cachent derrière un
 * sous-domaine dédié → classés `none` à tort". Lit le site de l'annuaire, la
 * home + quelques sous-pages carto/urbanisme, agrège TOUS les liens/scripts/
 * iframes (cross-host autorisé), sonde des sous-domaines courants, et classe la
 * plateforme par marqueurs. Lecture seule, aucun dépôt.
 *
 * USAGE : npx tsx src/zones-platform-probe.ts --slugs a,b,c [--out f.json]
 *         npx tsx src/zones-platform-probe.ts --slugs-file path [--conc 12]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { websiteForSlug } from "../../packages/geo-sources-americas/ca-qc/municipalities/municipal-directory.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 12_000;

type Platform = "jmap" | "igo" | "goazimut" | "arcgis" | "wfs" | "carto" | "azimut" | "none";

// Marqueurs par plateforme (URL ou texte). Ordre = priorité de classement.
const MARKERS: Array<{ p: Platform; re: RegExp }> = [
  { p: "jmap", re: /jmap|k2geospatial|kheops|carte_publique/i },
  { p: "goazimut", re: /goazimut|gonet|gis\d{2,3}-\d{2}/i },
  { p: "igo", re: /carte-igo|infra-geo|geoegl|igo2|geoportail/i },
  { p: "azimut", re: /azimut/i },
  { p: "arcgis", re: /arcgis\.com|FeatureServer|MapServer|services\d*\.arcgis|webappviewer|experience\.arcgis|appbuilder/i },
  { p: "carto", re: /carto\.com|cartodb|maps\.app|mapbox/i },
  { p: "wfs", re: /GetCapabilities|service=wfs|\/wfs\b|geoserver|qgis.*server/i },
];

const CARTO_LINK_RE = /carte|g[ée]oportail|cartograph|zonage|urbanis|interactiv|matrice|\bsig\b|g[ée]omati|services?[-_]en[-_]ligne|géomatique/i;

interface SlugResult {
  slug: string; site: string | null;
  platforms: Platform[];
  evidence: Record<string, string>; // platform -> sample URL/marker
  hostsSeen: string[];
  subdomainHits: string[];
  status: "portal-found" | "none" | "no-site" | "fetch-fail";
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

async function fetchText(url: string, timeoutMs = TIMEOUT): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: { "user-agent": UA, accept: "text/html,*/*" } });
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") ?? "";
    if (!/html|xml|json|text/i.test(ct)) return null;
    const buf = await r.arrayBuffer();
    return Buffer.from(buf).toString("utf8").slice(0, 800_000);
  } catch { return null; } finally { clearTimeout(t); }
}

/** All href/src/iframe-src/action targets, absolute, cross-host allowed. */
function extractUrls(html: string, base: string): string[] {
  const out = new Set<string>();
  const re = /(?:href|src|action|data-src|data-url|content)\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const raw = (m[1] ?? "").replace(/&amp;/g, "&");
    if (!raw || raw.startsWith("data:") || raw.startsWith("#") || raw.startsWith("mailto:") || raw.startsWith("tel:")) continue;
    try { out.add(new URL(raw, base).href); } catch { /* skip */ }
  }
  // also bare http(s) URLs in inline scripts/JSON config
  for (const u of html.match(/https?:\/\/[a-z0-9.\-]+\.[a-z]{2,}[^\s"'<>)]*/gi) ?? []) out.add(u.replace(/&amp;/g, "&"));
  return [...out];
}

function classify(text: string): { platforms: Platform[]; evidence: Record<string, string> } {
  const platforms: Platform[] = [];
  const evidence: Record<string, string> = {};
  for (const { p, re } of MARKERS) {
    re.lastIndex = 0;
    const m = re.exec(text);
    if (m) {
      if (!platforms.includes(p)) platforms.push(p);
      if (!evidence[p]) {
        // capture a small window around the match for context
        const i = Math.max(0, m.index - 40);
        evidence[p] = text.slice(i, m.index + 80).replace(/\s+/g, " ").trim();
      }
    }
  }
  return { platforms, evidence };
}

function baseDomain(host: string): string {
  // strip leading www.; keep the rest (ville.x.qc.ca → ville.x.qc.ca)
  return host.replace(/^www\./i, "");
}

async function probeSlug(slug: string): Promise<SlugResult> {
  const site = websiteForSlug(slug) ?? null;
  if (!site) return { slug, site: null, platforms: [], evidence: {}, hostsSeen: [], subdomainHits: [], status: "no-site" };
  let host: string;
  try { host = new URL(site).host; } catch { return { slug, site, platforms: [], evidence: {}, hostsSeen: [], subdomainHits: [], status: "fetch-fail" }; }

  const corpus: string[] = [];
  const hostsSeen = new Set<string>();
  const home = await fetchText(site);
  if (home == null) return { slug, site, platforms: [], evidence: {}, hostsSeen: [], subdomainHits: [], status: "fetch-fail" };
  corpus.push(home);

  // carto/urbanisme sub-links (cross-host allowed — KEY difference vs obscura)
  const urls = extractUrls(home, site);
  for (const u of urls) { try { hostsSeen.add(new URL(u).host); } catch { /* */ } }
  const cartoLinks = urls.filter((u) => CARTO_LINK_RE.test(u)).slice(0, 6);
  for (const link of cartoLinks) {
    const t = await fetchText(link);
    if (t) { corpus.push(t); for (const u of extractUrls(t, link)) { try { hostsSeen.add(new URL(u).host); } catch { /* */ } } }
  }

  // probe common GIS subdomains of the registry base domain
  const bd = baseDomain(host);
  const root = bd.replace(/^[a-z0-9-]+\./i, ""); // x.qc.ca from ville.x.qc.ca (best-effort)
  const subCandidates = new Set<string>();
  for (const pref of ["geo", "carte", "sig", "geomatique"]) {
    subCandidates.add(`https://${pref}.${bd}`);
    if (root !== bd) subCandidates.add(`https://${pref}.${root}`);
  }
  const subdomainHits: string[] = [];
  // speculative subdomains: short timeout (most won't resolve)
  await Promise.all([...subCandidates].map(async (sub) => {
    const t = await fetchText(sub, 5_000);
    if (t) { corpus.push(t); subdomainHits.push(sub); try { hostsSeen.add(new URL(sub).host); } catch { /* */ } }
  }));

  const joined = corpus.join("\n");
  const { platforms, evidence } = classify(joined);
  const status: SlugResult["status"] = platforms.length ? "portal-found" : "none";
  return { slug, site, platforms, evidence, hostsSeen: [...hostsSeen].slice(0, 30), subdomainHits, status };
}

async function pool<T, R>(items: T[], conc: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  async function worker(): Promise<void> {
    while (idx < items.length) { const i = idx++; out[i] = await fn(items[i]!, i); }
  }
  await Promise.all(Array.from({ length: Math.min(conc, items.length) }, worker));
  return out;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const get = (k: string): string | undefined => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  let slugs = (get("slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const file = get("slugs-file");
  if (file) slugs = readFileSync(file, "utf8").split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  if (slugs.length === 0) { console.error("usage: --slugs a,b,c | --slugs-file path [--conc N] [--out f]"); process.exit(2); }
  const conc = Number(get("conc") ?? 12);

  console.error(`[probe] ${slugs.length} slugs, conc=${conc}`);
  let done = 0;
  const results = await pool(slugs, conc, async (slug) => {
    const r = await probeSlug(slug);
    done++;
    if (r.platforms.length) console.error(`[${done}/${slugs.length}] ${r.status.padEnd(12)} ${slug} :: [${r.platforms.join(",")}] ${Object.values(r.evidence)[0]?.slice(0, 80) ?? ""}`);
    else if (done % 10 === 0) console.error(`  ...${done}/${slugs.length}`);
    return r;
  });

  const byPlatform: Record<string, number> = {};
  for (const r of results) for (const p of (r.platforms.length ? r.platforms : ["none"])) byPlatform[p] = (byPlatform[p] ?? 0) + 1;
  const byStatus: Record<string, number> = {};
  for (const r of results) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

  const report = { generatedAt: new Date().toISOString(), count: results.length, byStatus, byPlatform, results };
  const out = get("out") ?? resolve(HERE, "../../work/delegation-mass/zones-platform-probe.json");
  writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  console.error(`\n=== byStatus ${JSON.stringify(byStatus)}`);
  console.error(`=== byPlatform ${JSON.stringify(byPlatform)}`);
  console.error(`rapport → ${out}`);
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
