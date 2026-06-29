/**
 * pv-obscura-probe.ts — MESURE honnête du sous-ensemble PV `to-research`
 * récupérable via une session headless (obscura) vs vraiment mort.
 *
 * Pour un échantillon de villes PV `to-research` (avec site web), classe le
 * site municipal en 4 catégories à partir d'un fetch HTTP **statique** :
 *
 *   DEAD        — DNS fail / connexion refusée / timeout / 404 persistant.
 *                 Irrécupérable même en headless.
 *   JS-WALL     — 200 mais contenu = challenge Cloudflare / "Enable JavaScript"
 *                 / SPA vide / portail GoNet-GoAzimut JS. Récupérable en headless.
 *   STATIC-MISS — 200 HTML statique mais aucun lien PV trouvé par les regex
 *                 actuelles. Améliorable sans headless (élargir les patterns).
 *   STATIC-HIT  — 200 HTML statique AVEC liens PV PDF (le scraper statique aurait
 *                 pu déposer ; "to-research" probablement par robots ou non-run).
 *
 * Étape headless optionnelle (`--render`) : sur les JS-WALL, rend la page avec
 * Chromium headless (`--dump-dom`), ré-extrait les liens PV PDF réels. Avec
 * `--deposit`, dépose `registry/qc-pv/<slug>/index.json` en S3.
 *
 * ANTI-INVENTION : seuls des refs PDF réellement présentes dans le DOM rendu
 * (HTTP-vérifiables) sont déposées. Robots RESPECTÉ (jamais d'override).
 *
 * Usage :
 *   npx tsx src/pv-obscura-probe.ts --sample 25                  # classement seul
 *   npx tsx src/pv-obscura-probe.ts --sample 25 --render --max-render 3
 *   npx tsx src/pv-obscura-probe.ts --sample 25 --render --deposit --max-render 3
 *   npx tsx src/pv-obscura-probe.ts --slugs foo,bar --render
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { websiteForSlug } from "../../packages/geo-sources-americas/src/ca-qc/municipalities/municipal-directory.js";
import {
  ALL_PV_CITIES,
  PV_USER_AGENT,
  type PvFetchLike,
} from "../../packages/qc-sources/src/sources/proces-verbaux-generic.js";
import { s3Client, exists, putBytes } from "./lib/s3.js";

const execFileP = promisify(execFile);

// ── Config ───────────────────────────────────────────────────────────────────

const COVERAGE_MATRIX_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../work/coverage/coverage-matrix.json",
);
const TIMEOUT_MS = 6_000;
const ROBOTS_TIMEOUT_MS = 4_000;
const DEFAULT_DELAY_MS = 800;

// Candidate PV sub-paths probed only if the homepage is reachable (bounded).
const PV_SUBPATHS = [
  "/conseil-municipal/proces-verbaux/",
  "/seances-du-conseil/",
  "/vie-democratique/seances-du-conseil/",
  "/proces-verbaux/",
  "/ordre-du-jour-et-proces-verbaux/",
  "/conseil-municipal/",
];

const CHROME_CANDIDATES = [
  process.env["CHROME_BIN"],
  `${process.env["HOME"]}/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`,
  `${process.env["HOME"]}/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell`,
  "/snap/bin/chromium",
].filter(Boolean) as string[];

function resolveChrome(): string | null {
  for (const c of CHROME_CANDIDATES) if (existsSync(c)) return c;
  return null;
}

// ── Args ──────────────────────────────────────────────────────────────────────

interface Args {
  sample: number;
  slugs?: string[];
  delayMs: number;
  render: boolean;
  deposit: boolean;
  maxRender: number;
  outFile?: string;
  seed: number;
}

function parseArgs(argv: string[]): Args {
  const get = (k: string): string | undefined => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const has = (k: string) => argv.includes(`--${k}`);
  return {
    sample: Number(get("sample") ?? 25),
    slugs: get("slugs")?.split(",").map(s => s.trim()).filter(Boolean),
    delayMs: Number(get("delay-ms") ?? DEFAULT_DELAY_MS),
    render: has("render"),
    deposit: has("deposit"),
    maxRender: Number(get("max-render") ?? 3),
    outFile: get("out"),
    seed: Number(get("seed") ?? 42),
  };
}

// ── City selection ────────────────────────────────────────────────────────────

function loadToResearchWithSite(): string[] {
  const raw = JSON.parse(readFileSync(COVERAGE_MATRIX_PATH, "utf8")) as {
    cities?: Record<string, { pv?: { status?: string } }>;
  };
  const cities = raw.cities ?? {};
  const registered = new Set(ALL_PV_CITIES.map(e => e.config.citySlug));
  return Object.keys(cities).filter(
    s => cities[s]?.pv?.status === "to-research" && !registered.has(s) && !!websiteForSlug(s),
  );
}

// Deterministic pseudo-random sample (seeded) for reproducibility.
function sample<T>(arr: T[], n: number, seed: number): T[] {
  const a = [...arr];
  let s = seed >>> 0;
  const rng = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a.slice(0, n);
}

// ── Robots ──────────────────────────────────────────────────────────────────

const robotsCache = new Map<string, string | null>();
async function getRobotsTxt(origin: string, f: PvFetchLike): Promise<string | null> {
  if (robotsCache.has(origin)) return robotsCache.get(origin) ?? null;
  try {
    const res = await f(`${origin}/robots.txt`, {
      signal: AbortSignal.timeout(ROBOTS_TIMEOUT_MS),
      headers: { "user-agent": PV_USER_AGENT },
    });
    if (!res.ok) { robotsCache.set(origin, null); return null; }
    const txt = new TextDecoder().decode(new Uint8Array(await res.arrayBuffer()));
    robotsCache.set(origin, txt);
    return txt;
  } catch { robotsCache.set(origin, null); return null; }
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

// ── Static fetch ──────────────────────────────────────────────────────────────

interface FetchResult { ok: boolean; status: number; html: string; ctype: string }
async function fetchUrl(url: string, f: PvFetchLike, timeoutMs: number): Promise<FetchResult | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await f(url, {
        signal: controller.signal,
        headers: { "user-agent": PV_USER_AGENT, accept: "text/html,*/*" },
      });
      const ct = res.headers.get("content-type") ?? "";
      let html = "";
      if (ct.includes("text/html") || ct.includes("text/plain") || ct === "") {
        html = new TextDecoder("utf-8").decode(new Uint8Array(await res.arrayBuffer()));
      }
      return { ok: res.ok, status: res.status, html, ctype: ct };
    } finally { clearTimeout(timer); }
  } catch { return null; }
}

// ── PV extraction ─────────────────────────────────────────────────────────────

interface PvEntry { url: string; title?: string; contentType: string }
function extractPvEntries(html: string, baseUrl: string): PvEntry[] {
  const entries: PvEntry[] = [];
  const seen = new Set<string>();
  const pdfRe = /href=["']([^"']*\.pdf[^"']*)/gi;
  let m: RegExpExecArray | null;
  while ((m = pdfRe.exec(html)) !== null) {
    try {
      const url = new URL(m[1]!, baseUrl).href;
      if (!seen.has(url)) { seen.add(url); entries.push({ url, contentType: "application/pdf" }); }
    } catch { /* skip */ }
  }
  return entries.slice(0, 100);
}
function hasPvContext(html: string): boolean {
  return /proc[eèé]s.verbal|s[eéè]ance|conseil\s+municipal|ordre.du.jour/i.test(html);
}

// ── JS-wall signal ────────────────────────────────────────────────────────────

interface WallSignal { wall: boolean; reason: string }
function detectJsWall(html: string): WallSignal {
  if (html.includes("challenges.cloudflare.com") || html.includes("cf-browser-verification") ||
      /just a moment/i.test(html) || html.includes("/cdn-cgi/challenge-platform/"))
    return { wall: true, reason: "cloudflare-challenge" };
  if (/enable javascript and cookies|please enable javascript|you need to enable javascript/i.test(html))
    return { wall: true, reason: "enable-js" };
  if (/goazimut|gonet|GoAzimut|GONet/i.test(html))
    return { wall: true, reason: "gonet-goazimut" };
  // SPA-empty heuristic: short body, framework root div, no anchors.
  const bodyLen = html.length;
  const hasRoot = /<div[^>]+id=["'](app|root|__nuxt|__next)["']/i.test(html) ||
                  html.includes("window.__NUXT__") || html.includes("__NEXT_DATA__") ||
                  html.includes("ng-version") || html.includes("data-reactroot");
  const anchorCount = (html.match(/<a\b/gi) ?? []).length;
  if (hasRoot && anchorCount < 3 && bodyLen < 60_000)
    return { wall: true, reason: "spa-empty" };
  return { wall: false, reason: "" };
}

// ── Headless render via Chromium --dump-dom ─────────────────────────────────────

async function renderDom(chrome: string, url: string, budgetMs = 9_000): Promise<string | null> {
  try {
    const { stdout } = await execFileP(chrome, [
      "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
      "--hide-scrollbars", "--mute-audio", "--no-first-run",
      `--user-agent=${PV_USER_AGENT}`,
      `--virtual-time-budget=${budgetMs}`,
      "--dump-dom", url,
    ], { timeout: budgetMs + 15_000, maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } catch { return null; }
}

// ── Classification ──────────────────────────────────────────────────────────────

type Category = "DEAD" | "JS-WALL" | "STATIC-MISS" | "STATIC-HIT";
interface ClassResult {
  slug: string;
  site: string;
  category: Category;
  detail: string;
  bestUrl?: string;       // robots-allowed JS-wall URL worth rendering
  wallReason?: string;
  staticEntries?: number;
}

async function probeUrl(url: string, f: PvFetchLike): Promise<FetchResult | null | "robots"> {
  let origin: URL;
  try { origin = new URL(url); } catch { return null; }
  const robots = await getRobotsTxt(origin.origin, f);
  if (!isAllowedByRobots(robots, origin.pathname)) return "robots";
  return fetchUrl(url, f, TIMEOUT_MS);
}

async function classify(slug: string, f: PvFetchLike, delayMs: number): Promise<ClassResult> {
  const site = websiteForSlug(slug)!.replace(/\/$/, "");

  // 1) Homepage first — strongest liveness signal, lets us short-circuit DEAD.
  const home = await probeUrl(`${site}/`, f);
  if (home === "robots") {
    return { slug, site, category: "DEAD", detail: "robots-blocked homepage" };
  }
  if (home === null) {
    return { slug, site, category: "DEAD", detail: "homepage fetch failed (dns/conn/timeout)" };
  }

  let wall: { url: string; reason: string } | null = null;
  let staticHit: { url: string; count: number } | null = null;
  let any200Static = false;

  const consider = (url: string, res: FetchResult) => {
    if (!res.ok) return;
    const w = detectJsWall(res.html);
    if (w.wall) { if (!wall) wall = { url, reason: w.reason }; return; }
    any200Static = true;
    const entries = extractPvEntries(res.html, url);
    if (entries.length > 0 && hasPvContext(res.html)) {
      if (!staticHit || entries.length > staticHit.count) staticHit = { url, count: entries.length };
    }
  };

  if (home.ok) consider(`${site}/`, home);
  const homeFailed = !home.ok; // 4xx/5xx homepage but origin reachable

  // 2) A bounded set of PV sub-paths (only if reachable). Stop on first static-hit.
  for (const path of PV_SUBPATHS) {
    if (staticHit) break;
    await new Promise(r => setTimeout(r, delayMs));
    const res = await probeUrl(`${site}${path}`, f);
    if (res === "robots" || res === null) continue;
    consider(`${site}${path}`, res);
  }

  if (staticHit) { const sh = staticHit as { url: string; count: number }; return { slug, site, category: "STATIC-HIT", detail: `${sh.count} pdf @ ${sh.url}`, staticEntries: sh.count, bestUrl: sh.url }; }
  if (wall) { const w = wall as { url: string; reason: string }; return { slug, site, category: "JS-WALL", detail: w.reason, bestUrl: w.url, wallReason: w.reason }; }
  if (any200Static) return { slug, site, category: "STATIC-MISS", detail: "200 static, no pv-pdf links via current regex" };
  if (homeFailed) return { slug, site, category: "DEAD", detail: `homepage ${home.status}, no reachable PV subpath` };
  return { slug, site, category: "STATIC-MISS", detail: "200 but no usable content" };
}

// ── Manifest ──────────────────────────────────────────────────────────────────

function manifestKey(slug: string): string { return `registry/qc-pv/${slug}/index.json`; }

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const f = globalThis.fetch as unknown as PvFetchLike;

  const pool = loadToResearchWithSite();
  const slugs = args.slugs && args.slugs.length > 0
    ? args.slugs
    : sample(pool, args.sample, args.seed);

  console.error(`[obscura-probe] pool(to-research+site)=${pool.length} sample=${slugs.length} render=${args.render} deposit=${args.deposit}`);

  const results: ClassResult[] = [];
  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i]!;
    let r: ClassResult;
    try { r = await classify(slug, f, args.delayMs); }
    catch (e) { r = { slug, site: websiteForSlug(slug) ?? "", category: "DEAD", detail: `err ${e instanceof Error ? e.message : String(e)}` }; }
    results.push(r);
    console.error(`[${i + 1}/${slugs.length}] ${r.category.padEnd(11)} ${slug}  ${r.detail}`);
    await new Promise(res => setTimeout(res, args.delayMs));
  }

  const counts: Record<Category, number> = { DEAD: 0, "JS-WALL": 0, "STATIC-MISS": 0, "STATIC-HIT": 0 };
  for (const r of results) counts[r.category]++;

  // ── Headless proof on JS-WALL ────────────────────────────────────────────────
  const renderResults: { slug: string; url: string; rendered: boolean; pdfCount: number; deposited: boolean; note: string }[] = [];
  if (args.render) {
    const chrome = resolveChrome();
    if (!chrome) {
      console.error("[render] NO CHROMIUM BINARY FOUND — skipping headless proof");
    } else {
      console.error(`[render] chromium = ${chrome}`);
      const s3 = args.deposit ? s3Client() : null;
      const targets = results.filter(r => r.category === "JS-WALL" && r.bestUrl).slice(0, args.maxRender);
      for (const t of targets) {
        const url = t.bestUrl!;
        console.error(`[render] ${t.slug} <- ${url} (${t.wallReason})`);
        const dom = await renderDom(chrome, url);
        if (!dom) { renderResults.push({ slug: t.slug, url, rendered: false, pdfCount: 0, deposited: false, note: "render-failed/timeout" }); continue; }
        const stillWall = detectJsWall(dom);
        const entries = extractPvEntries(dom, url);
        const ctx = hasPvContext(dom);
        let deposited = false;
        let note = `domLen=${dom.length} pdf=${entries.length} ctx=${ctx} stillWall=${stillWall.wall ? stillWall.reason : "no"}`;
        if (entries.length > 0 && ctx && s3) {
          const key = manifestKey(t.slug);
          if (await exists(s3, key)) { note += " (manifest-exists, skip)"; }
          else {
            const manifest = {
              _note: "PV index discovered by pv-obscura-probe.ts (headless render). DOM rendered by Chromium --dump-dom; each entry is a real PDF href present in the rendered DOM. No fabrication.",
              _generatedAt: new Date().toISOString(),
              slug: t.slug,
              sourceId: `proces-verbaux-${t.slug}`,
              pvIndexUrl: url,
              windowDays: 183,
              userAgent: PV_USER_AGENT,
              renderEngine: "chromium-headless-dump-dom",
              count: entries.length,
              entries,
            };
            await putBytes(s3, key, JSON.stringify(manifest, null, 2) + "\n", "application/json");
            deposited = true;
            note += ` -> s3://${key}`;
          }
        }
        renderResults.push({ slug: t.slug, url, rendered: true, pdfCount: entries.length, deposited, note });
        console.error(`[render]   ${note}`);
      }
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    pool: pool.length,
    sampleSize: slugs.length,
    seed: args.seed,
    counts,
    results,
    render: { enabled: args.render, deposit: args.deposit, results: renderResults },
  };

  console.error(`\n=== COUNTS (sample=${slugs.length}) ===`);
  console.error(JSON.stringify(counts));
  const deposited = renderResults.filter(r => r.deposited).map(r => r.slug);
  if (args.render) console.error(`rendered=${renderResults.filter(r => r.rendered).length} deposited=${deposited.length} [${deposited.join(",")}]`);

  const out = args.outFile ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../work/delegation-mass/pv-obscura-probe-report.json");
  writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  console.error(`report -> ${out}`);
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
