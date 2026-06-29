/**
 * zones-gdal-discover.ts — CHEAP poppler pre-filter that builds a manifest of
 * candidate ZONING-PLAN GeoPDFs for the GDAL-on-k8s recompose validation pass.
 *
 * CONTEXT (why this exists):
 *   `recompose-zones-pdf.ts` can rebuild real zone polygons from a *vector*
 *   georeferenced zoning-plan PDF (TYPE A). The ONLY authoritative test of
 *   recompose-ability is GDAL (`ogr2ogr` extract + spatial-join ≥3 codes) — which
 *   is absent locally. This tool does the cheap part with poppler (present
 *   locally): discover one zoning-PLAN map PDF per municipality, then keep as a
 *   CANDIDATE only PDFs that carry GeoPDF georef markers AND zone-code text. The
 *   manifest it emits is fed to a GDAL-on-k8s pod that runs the faithful test.
 *
 *   It REUSES the procès-verbaux/grille crawler primitives (parsePvIndex,
 *   candidatePagesForCity, RobotsCache, PV_USER_AGENT, ALL_PV_CITIES) — robots ON,
 *   bounded, honest UA. Unlike grille-discovery (which keeps grids and REJECTS
 *   plan/carte), this keeps the plan/carte zoning MAP and rejects grids/text.
 *
 * USAGE:
 *   npx tsx src/zones-gdal-discover.ts --slugs a,b,c [--out PATH]
 *   npx tsx src/zones-gdal-discover.ts --to-research --limit 150 --offset 0
 *   npx tsx src/zones-gdal-discover.ts --to-research --2hop --delay-ms 1200
 *
 * FLAGS:
 *   --slugs a,b,c     restrict to these slugs
 *   --to-research     use coverage-matrix zones=to-research ∩ ALL_PV_CITIES
 *   --limit N         cap number of cities (after offset)
 *   --offset N        skip first N cities (sharding)
 *   --out PATH        manifest path (default work/zonage-norms/zones-gdal-candidates.json)
 *   --max-eval N      max plan PDFs downloaded+classified per city (default 3)
 *   --max-mb N        size cap per PDF download in MB (default 90)
 *   --delay-ms N      politeness floor between fetches (default 1200)
 *   --timeout-ms N    per-fetch timeout (default 15000)
 *   --2hop            follow up to 5 same-domain urbanisme sub-pages
 *
 * Node/TS pure. Robots honoured. No secret printed. Anti-invention: a URL is only
 * a candidate after a confirmed 200 + %PDF + local poppler GeoPDF markers.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALL_PV_CITIES,
  PV_USER_AGENT,
  RobotsCache,
  candidatePagesForCity,
  URBANISME_PATH_HINTS,
} from "../../packages/qc-sources/src/sources/grille-discovery.js";
import {
  parsePvIndex,
  type PvIndexItemT,
} from "../../packages/qc-sources/src/sources/proces-verbaux-parser.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ACQ = resolve(HERE, "..");
const REPO = resolve(ACQ, "..");
const WORK_DIR = join(REPO, "work", "zonage-norms");
const MATRIX = join(REPO, "work", "coverage", "coverage-matrix.json");

interface Args {
  slugs?: string[];
  toResearch: boolean;
  limit?: number;
  offset: number;
  out: string;
  maxEval: number;
  maxMb: number;
  delayMs: number;
  timeoutMs: number;
  twoHop: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (k: string): string | undefined => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const has = (k: string): boolean => argv.includes(`--${k}`);
  const slugsRaw = get("slugs");
  const limitRaw = get("limit");
  return {
    ...(slugsRaw ? { slugs: slugsRaw.split(",").map((s) => s.trim()).filter(Boolean) } : {}),
    toResearch: has("to-research"),
    ...(limitRaw ? { limit: Number(limitRaw) } : {}),
    offset: Number(get("offset") ?? "0"),
    out: get("out") ?? join(WORK_DIR, "zones-gdal-candidates.json"),
    maxEval: Number(get("max-eval") ?? "3"),
    maxMb: Number(get("max-mb") ?? "90"),
    delayMs: Number(get("delay-ms") ?? "1200"),
    timeoutMs: Number(get("timeout-ms") ?? "15000"),
    twoHop: has("2hop"),
  };
}

// ── zoning-PLAN map keyword model ────────────────────────────────────────────
// Positive: this link looks like a zoning *map/plan* (the thing GDAL can vectorise).
// Negative: grids/specs/text-of-bylaw (not a map) → never a recompose candidate.
const PLAN_POS =
  /(plan[\s_-]*(de[\s_-]*)?zonage|zonage[\s_-]*plan|carte[\s_-]*(de[\s_-]*)?zonage|plan[\s_-]*des[\s_-]*affectation|affectation[\s_-]*(du[\s_-]*)?sol|\bpz[\s_._-]|plan[\s_-]*d.urbanisme.*carte)/i;
const PLAN_NEG =
  /(grille|sp[eé]cification|matrice|usages?[\s_-]*(et|principa)|normes?|tableau|index|proc[eè]s|verbal|ordre[\s_-]*du[\s_-]*jour)/i;

function looksLikePlanLink(item: PvIndexItemT): boolean {
  const hay = `${item.title ?? ""} ${item.url}`.toLowerCase();
  if (!hay.endsWith(".pdf") && !/\.pdf(\?|#|$)/.test(item.url.toLowerCase())) return false;
  if (PLAN_NEG.test(hay)) return false;
  return PLAN_POS.test(hay);
}

// ── zone-code token model (same spirit as recompose-zones-pdf) ───────────────
const ZONE_CODE_RE = /^(?:[A-Z]{1,4}[-.]?\d{0,4}[A-Za-z]?|\d{1,4}-[A-Za-z]{1,5})$/;
const ZONE_STOP = new Set(["de","du","des","la","le","les","et","plan","zone","zonage","page","nord","sud","est","ouest"]);
function countZoneTokens(text: string): number {
  const toks = text.split(/[\s,;:()/\[\]]+/);
  const uniq = new Set<string>();
  for (const t0 of toks) {
    const t = t0.trim();
    if (t.length < 2 || t.length > 8) continue;
    if (ZONE_STOP.has(t.toLowerCase())) continue;
    if (/^\d+$/.test(t)) continue; // pure numbers = lots, not zone codes
    if (!/[A-Za-z]/.test(t) || !/\d/.test(t)) continue; // need a letter AND a digit
    if (ZONE_CODE_RE.test(t)) uniq.add(t.toUpperCase());
  }
  return uniq.size;
}

// ── GeoPDF marker scan (raw bytes) + poppler probes ──────────────────────────
const GEO_MARKERS = ["/Measure", "/GPTS", "/LPTS", "/Viewport", "/GCS", "GEOGCS", "PROJCS", "/Bounds"];
function scanGeoMarkers(buf: Buffer): string[] {
  const s = buf.toString("latin1");
  return GEO_MARKERS.filter((m) => s.includes(m));
}
function pdfProducer(path: string): string {
  try {
    const out = execFileSync("pdfinfo", [path], { encoding: "utf8", timeout: 20_000 });
    const m = out.match(/(?:Producer|Creator):\s*(.+)/i);
    return m ? m[1]!.trim() : "";
  } catch {
    return "";
  }
}
function pdfText(path: string): string {
  try {
    return execFileSync("pdftotext", ["-q", path, "-"], {
      encoding: "utf8",
      timeout: 40_000,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return "";
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function fetchText(url: string, ua: string, timeoutMs: number): Promise<string | null> {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { "user-agent": ua, accept: "text/html" }, signal: ctl.signal });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!/html|text/i.test(ct)) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(to);
  }
}

async function downloadPdf(url: string, dest: string, ua: string, timeoutMs: number, maxMb: number): Promise<boolean> {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), timeoutMs * 4);
  try {
    const res = await fetch(url, { headers: { "user-agent": ua, accept: "application/pdf" }, signal: ctl.signal });
    if (!res.ok) return false;
    const ct = res.headers.get("content-type") ?? "";
    const cl = Number(res.headers.get("content-length") ?? "0");
    if (cl && cl > maxMb * 1024 * 1024) return false;
    if (ct && !/pdf|octet-stream/i.test(ct) && !url.toLowerCase().includes(".pdf")) return false;
    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab);
    if (buf.length > maxMb * 1024 * 1024) return false;
    if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") return false;
    writeFileSync(dest, buf);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(to);
  }
}

interface Candidate {
  slug: string;
  pdfUrl: string;
  sourceUrl: string;
  title: string;
  sizeMB: number;
  producer: string;
  geoMarkers: string[];
  zoneTokens: number;
  isGeoCandidate: boolean;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const ua = PV_USER_AGENT;
  const robots = new RobotsCache({ userAgent: ua });

  // Build city list: {slug, pvIndexUrl}
  const pvBySlug = new Map<string, string>();
  for (const e of ALL_PV_CITIES) {
    if (!pvBySlug.has(e.config.citySlug)) pvBySlug.set(e.config.citySlug, e.config.pvIndexUrl);
  }

  let slugs: string[];
  if (args.slugs && args.slugs.length) {
    slugs = args.slugs;
  } else if (args.toResearch) {
    const m = JSON.parse(readFileSync(MATRIX, "utf8")) as { cities: Record<string, { zones?: { status?: string } }> };
    slugs = Object.entries(m.cities)
      .filter(([, c]) => c.zones?.status === "to-research")
      .map(([s]) => s)
      .filter((s) => pvBySlug.has(s));
    slugs.sort();
  } else {
    slugs = [...pvBySlug.keys()].sort();
  }
  slugs = slugs.slice(args.offset, args.limit ? args.offset + args.limit : undefined);

  console.error(`[zones-discover] ${slugs.length} cities (offset=${args.offset} limit=${args.limit ?? "all"})`);

  const tmpDir = join("/tmp", `zones-discover-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  const candidates: Candidate[] = [];
  const stats = { cities: 0, planLinks: 0, downloaded: 0, geoCandidates: 0, noPlanLink: 0 };

  for (const slug of slugs) {
    stats.cities++;
    const pvIndexUrl = pvBySlug.get(slug);
    if (!pvIndexUrl) continue;
    let pages = candidatePagesForCity(pvIndexUrl);
    const seenPlan = new Set<string>();
    const planLinks: PvIndexItemT[] = [];
    let origin: string | null = null;
    try { origin = new URL(pvIndexUrl).origin; } catch { origin = null; }

    // hop-1
    const subPages = new Set<string>();
    for (const page of pages) {
      try {
        if (!(await robots.isAllowed(page))) continue;
      } catch { /* permissive */ }
      const html = await fetchText(page, ua, args.timeoutMs);
      await sleep(args.delayMs);
      if (!html) continue;
      const links = parsePvIndex(html, page);
      for (const l of links) {
        if (looksLikePlanLink(l) && !seenPlan.has(l.url)) {
          seenPlan.add(l.url);
          planLinks.push(l);
        }
        // collect candidate urbanisme sub-pages for 2hop
        if (args.twoHop && origin && l.url.startsWith(origin) && !/\.pdf/i.test(l.url)) {
          const lo = l.url.toLowerCase();
          if (URBANISME_PATH_HINTS.some((h) => lo.includes(h.split("/")[0]!)) || /zonage|urbanisme|reglement/.test(lo)) {
            if (subPages.size < 5) subPages.add(l.url);
          }
        }
      }
    }
    // hop-2 (only if no plan link found yet)
    if (args.twoHop && planLinks.length === 0 && subPages.size) {
      for (const sp of subPages) {
        try { if (!(await robots.isAllowed(sp))) continue; } catch { /* */ }
        const html = await fetchText(sp, ua, args.timeoutMs);
        await sleep(args.delayMs);
        if (!html) continue;
        for (const l of parsePvIndex(html, sp)) {
          if (looksLikePlanLink(l) && !seenPlan.has(l.url)) { seenPlan.add(l.url); planLinks.push(l); }
        }
      }
    }

    if (planLinks.length === 0) { stats.noPlanLink++; continue; }
    stats.planLinks += planLinks.length;

    // Download + poppler-classify up to maxEval plan PDFs
    let evaluated = 0;
    for (const l of planLinks) {
      if (evaluated >= args.maxEval) break;
      try { if (!(await robots.isAllowed(l.url))) continue; } catch { /* */ }
      const dest = join(tmpDir, `${slug}-${evaluated}.pdf`);
      const ok = await downloadPdf(l.url, dest, ua, args.timeoutMs, args.maxMb);
      await sleep(args.delayMs);
      if (!ok) continue;
      evaluated++;
      stats.downloaded++;
      const buf = readFileSync(dest);
      const sizeMB = +(statSync(dest).size / 1024 / 1024).toFixed(2);
      const geoMarkers = scanGeoMarkers(buf);
      const producer = pdfProducer(dest);
      const zoneTokens = countZoneTokens(pdfText(dest));
      const isGeoCandidate =
        geoMarkers.length >= 1 && (zoneTokens >= 3 || /esri|arcgis|arcmap|qgis|adobe|geo/i.test(producer));
      candidates.push({
        slug, pdfUrl: l.url, sourceUrl: pvIndexUrl, title: l.title ?? "",
        sizeMB, producer, geoMarkers, zoneTokens, isGeoCandidate,
      });
      if (isGeoCandidate) stats.geoCandidates++;
      console.error(
        `[${slug}] ${isGeoCandidate ? "GEO-CAND" : "drop"} markers=[${geoMarkers.join(",")}] zoneTok=${zoneTokens} prod="${producer.slice(0, 40)}" ${sizeMB}MB ${l.url.slice(-60)}`,
      );
      try { rmSync(dest); } catch { /* */ }
    }
  }

  // Emit manifest (only geo candidates feed the GDAL pass; keep drops for audit)
  const geoCands = candidates.filter((c) => c.isGeoCandidate);
  mkdirSync(dirname(args.out), { recursive: true });
  const prev: Candidate[] = existsSync(args.out)
    ? (() => { try { return JSON.parse(readFileSync(args.out, "utf8")).candidates ?? []; } catch { return []; } })()
    : [];
  const byUrl = new Map<string, Candidate>();
  for (const c of [...prev, ...geoCands]) byUrl.set(`${c.slug}|${c.pdfUrl}`, c);
  const merged = [...byUrl.values()];
  writeFileSync(args.out, JSON.stringify({ generatedAt: new Date().toISOString(), stats, candidates: merged }, null, 2));
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }

  console.error(`\n[zones-discover] SUMMARY ${JSON.stringify(stats)}`);
  console.error(`[zones-discover] GeoPDF candidates this run: ${geoCands.length} | manifest total: ${merged.length} → ${args.out}`);
  for (const c of geoCands) console.error(`  CAND ${c.slug}  zoneTok=${c.zoneTokens}  ${c.pdfUrl}`);
}

main().catch((e: unknown) => { console.error("[zones-discover] FATAL:", e); process.exit(1); });
