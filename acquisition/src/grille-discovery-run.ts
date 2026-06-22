/**
 * CLI runner — discover grille-de-zonage PDFs per municipality and emit a
 * candidate manifest the normes batch can consume directly.
 *
 * It REUSES the procès-verbaux crawler infra (see
 * `packages/qc-sources/src/sources/grille-discovery.ts`): the same `parsePvIndex`
 * link scanner, `detectIndexRenderMode` JS-render guard, honest `PV_USER_AGENT`,
 * typed `PvSourceFetchError`, and the `ALL_PV_CITIES` registry. For each muni it
 * walks the urbanisme/règlements pages derived from the configured PV index URL,
 * classifies PDF links with the FR grille keyword model, then CONFIRMS each
 * candidate `pdfUrl` is actually reachable (HTTP 200, PDF content-type) before it
 * is written out — anti-invention: a guessed/404 URL never lands in the manifest.
 *
 * Output: `work/zonage-norms/discovered.json` in the SAME shape as
 * `work/zonage-norms/munis.json` ({ munis: [{ slug, route, pages, first, last,
 * reglement, sourceUrl }] }), so it feeds `zonage-norms-batch.ts` unchanged. The
 * batch still expects a local `work/zonage-norms/<slug>/grille.pdf`; pass
 * `--download` to fetch each confirmed PDF into that path here.
 *
 * This repo is Node/TS end-to-end (NO Python). Run via tsx:
 *   # prove it on 2-3 munis, write the manifest, no downloads:
 *   npx tsx src/grille-discovery-run.ts --limit 3
 *   # full province + download the PDFs + probe native/vision route:
 *   npx tsx src/grille-discovery-run.ts --download --route-guess --delay-ms 2000
 *
 * Flags:
 *   --limit N        only the first N munis from ALL_PV_CITIES (default: all)
 *   --slugs a,b,c    restrict to these slugs (overrides --limit)
 *   --out PATH       manifest path (default work/zonage-norms/discovered.json)
 *   --download       download each confirmed PDF to work/zonage-norms/<slug>/grille.pdf
 *   --route-guess    probe the downloaded PDF text layer to set routeGuess (native|vision)
 *   --delay-ms N     politeness delay between page/PDF fetches (default 1500)
 *   --threshold N    classifier acceptance threshold (default 4)
 *   --timeout-ms N   per-fetch timeout (default 15000)
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALL_PV_CITIES,
  PV_USER_AGENT,
  PvSourceFetchError,
  candidatePagesForCity,
  discoverGrillesForCity,
  type GrilleCandidate,
  type PvFetchLike,
} from "../../packages/qc-sources/src/sources/grille-discovery.js";
import {
  isGrillePage,
  parseGrillePage,
} from "../../packages/qc-sources/src/sources/grille-specifications-parser.js";
import {
  locateGrillePages,
  type GrilleLocation,
} from "../../packages/qc-sources/src/sources/grille-page-locator.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ACQ = resolve(HERE, ".."); // acquisition/
const REPO = resolve(ACQ, ".."); // geo/
const WORK_DIR = join(REPO, "work", "zonage-norms");

// ── args ─────────────────────────────────────────────────────────────────────

interface Args {
  limit?: number;
  slugs?: string[];
  out: string;
  download: boolean;
  routeGuess: boolean;
  delayMs: number;
  threshold: number;
  timeoutMs: number;
}

function parseArgs(argv: string[]): Args {
  const get = (k: string): string | undefined => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const has = (k: string): boolean => argv.includes(`--${k}`);
  const limitRaw = get("limit");
  const slugsRaw = get("slugs");
  return {
    ...(limitRaw ? { limit: Number(limitRaw) } : {}),
    ...(slugsRaw ? { slugs: slugsRaw.split(",").map((s) => s.trim()).filter(Boolean) } : {}),
    out: get("out") ?? join(WORK_DIR, "discovered.json"),
    download: has("download"),
    routeGuess: has("route-guess"),
    delayMs: Number(get("delay-ms") ?? "1500"),
    threshold: Number(get("threshold") ?? "4"),
    timeoutMs: Number(get("timeout-ms") ?? "15000"),
  };
}

// ── manifest model (mirrors work/zonage-norms/munis.json) ──────────────────────

interface ManifestMuni {
  slug: string;
  route: "auto" | "native" | "vision" | "multizone";
  pages?: number;
  first?: number;
  last?: number;
  reglement?: string;
  sourceUrl: string;
  /** Discovery provenance (extra fields are ignored by the batch). */
  discoveredFrom?: string;
  scoreClassif?: number;
  titre?: string;
  /** Grille-locator diagnostics (provenance for the route/first/last decision). */
  grillePageCount?: number;
  locatorConfidence?: number;
  routeReason?: string;
}

// ── HTTP confirmation (HEAD then GET fallback) ─────────────────────────────────

interface ConfirmResult {
  ok: boolean;
  status: number;
  contentType: string;
  bytes?: Uint8Array;
}

/**
 * Confirm a PDF URL is reachable. Tries HEAD first (cheap); if the server does
 * not support HEAD (405/501) or omits a content-type, falls back to GET. When
 * `wantBytes` is true the GET body is returned so the caller can save/probe it.
 */
async function confirmPdf(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
  wantBytes: boolean,
): Promise<ConfirmResult> {
  const headers = { "user-agent": PV_USER_AGENT, accept: "application/pdf,*/*" };
  const withTimeout = async (init: RequestInit): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(url, { ...init, headers, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  let needGet = wantBytes;
  if (!wantBytes) {
    try {
      const head = await withTimeout({ method: "HEAD" });
      const ct = head.headers.get("content-type") ?? "";
      if (head.ok && /pdf/i.test(ct)) return { ok: true, status: head.status, contentType: ct };
      if (head.status === 405 || head.status === 501 || (head.ok && !ct)) {
        needGet = true; // HEAD unsupported / inconclusive → confirm via GET
      } else {
        return { ok: head.ok && /pdf/i.test(ct), status: head.status, contentType: ct };
      }
    } catch {
      needGet = true; // some CDNs reject HEAD outright
    }
  }

  if (needGet) {
    const res = await withTimeout({ method: "GET" });
    const ct = res.headers.get("content-type") ?? "";
    if (!res.ok) return { ok: false, status: res.status, contentType: ct };
    const buf = new Uint8Array(await res.arrayBuffer());
    // Magic-byte check: a real PDF starts with "%PDF". Tolerates a missing/wrong
    // content-type (common on misconfigured municipal CDNs) without inventing.
    const isPdf = /pdf/i.test(ct) || (buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46);
    return { ok: isPdf, status: res.status, contentType: ct, ...(wantBytes ? { bytes: buf } : {}) };
  }
  return { ok: false, status: 0, contentType: "" };
}

// ── route decision via the frozen parser + grille-page locator ─────────────────

interface RouteProbe {
  route: ManifestMuni["route"];
  first?: number;
  last?: number;
  grillePageCount?: number;
  confidence?: number;
  reason: string;
}

/** Split a `pdftotext -layout` projection into per-page texts (drop the trailing FF). */
function pdfToPageTexts(pdfPath: string): string[] | null {
  const r = spawnSync("pdftotext", ["-q", "-layout", "-enc", "UTF-8", pdfPath, "-"], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.status !== 0) return null;
  const parts = (r.stdout ?? "").split("\f");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/**
 * Decide the EXACT route from the downloaded PDF, replacing the old "lots of text
 * → native" density heuristic that mis-routed VERTICAL grilles to the horizontal
 * native parser (which then returned 0 rows). The precise decision is:
 *
 *   1. NATIVE — probe every page with the FROZEN `parseGrillePage` (the Sherbrooke
 *      horizontal parser). If any page is accepted with ≥1 zone row, the grille is
 *      a native-text horizontal table → route="native" ($0, no page bounds needed).
 *   2. MULTIZONE / VISION — otherwise LOCATE the grille pages by text signal. When
 *      found, BOUND the vision pass to [firstPage,lastPage] and pick the extractor
 *      by the locator's layout hint: a one-zone-per-page annex → "vision" (single-
 *      zone), a transposed multi-zone sheet → "multizone".
 *   3. AUTO — when no grille page is detected at all (image-only scan whose text
 *      layer is empty, or a bylaw that doesn't embed the table), DO NOT guess a
 *      range: leave route="auto" with no bounds and flag it for investigation
 *      (anti-invention — the batch's idempotent skip keeps it from depositing junk).
 */
function decideRoute(pdfPath: string, sourceUrl: string): RouteProbe {
  const pages = pdfToPageTexts(pdfPath);
  if (pages === null) {
    return { route: "auto", reason: "pdftotext failed — leave auto for investigation" };
  }
  const snapshot = new Date().toISOString().slice(0, 10);

  // (1) native horizontal grille?
  let nativeRows = 0;
  let nativeGrillePages = 0;
  for (const p of pages) {
    if (!isGrillePage(p).isGrille) continue;
    nativeGrillePages++;
    const res = parseGrillePage(p, { source_url: sourceUrl, snapshot });
    if (!res.rejected) nativeRows += res.zones.length;
  }
  if (nativeGrillePages > 0 && nativeRows > 0) {
    return {
      route: "native",
      reason: `native: ${nativeGrillePages} header-anchored pages, ${nativeRows} accepted rows`,
    };
  }

  // (2) locate grille pages → bounded multizone / vision.
  const loc: GrilleLocation | null = locateGrillePages(pages);
  if (loc) {
    const route = loc.layout === "one-zone-per-page" ? "vision" : "multizone";
    return {
      route,
      first: loc.firstPage,
      last: loc.lastPage,
      grillePageCount: loc.grillePageCount,
      confidence: loc.confidence,
      reason: `${route}: grille pages ${loc.firstPage}..${loc.lastPage} (${loc.grillePageCount} pages, ${loc.layout}, conf=${loc.confidence})`,
    };
  }

  // (3) nothing detectable in the text layer → investigate, never invent a range.
  return {
    route: "auto",
    reason: "no native grille rows and no grille page located (image-only scan?) — left auto for investigation",
  };
}

function pdfPageCount(pdfPath: string): number | undefined {
  const r = spawnSync("pdfinfo", [pdfPath], { encoding: "utf8" });
  const m = r.stdout?.match(/Pages:\s+(\d+)/);
  return m?.[1] ? Number(m[1]) : undefined;
}

// ── main ───────────────────────────────────────────────────────────────────────

function selectCities(args: Args): { slug: string; pvIndexUrl: string }[] {
  let entries = ALL_PV_CITIES.map((e) => ({
    slug: e.config.citySlug,
    pvIndexUrl: e.config.pvIndexUrl,
  }));
  // De-dup by slug (the registry has a few repeated configs).
  const bySlug = new Map<string, { slug: string; pvIndexUrl: string }>();
  for (const e of entries) if (!bySlug.has(e.slug)) bySlug.set(e.slug, e);
  entries = [...bySlug.values()];

  if (args.slugs && args.slugs.length > 0) {
    const want = new Set(args.slugs);
    return entries.filter((e) => want.has(e.slug));
  }
  if (args.limit !== undefined) return entries.slice(0, args.limit);
  return entries;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const fetchImpl = globalThis.fetch;
  const cities = selectCities(args);
  console.error(
    `[grille-discovery] ${cities.length} muni(s)` +
      (args.download ? " (+download)" : "") +
      (args.routeGuess ? " (+routeGuess)" : ""),
  );

  const munis: ManifestMuni[] = [];
  let confirmed = 0;
  let cityHits = 0;

  for (const city of cities) {
    console.error(`=== ${city.slug} ===`);
    let result;
    try {
      result = await discoverGrillesForCity(city.slug, city.pvIndexUrl, {
        fetchImpl: fetchImpl as unknown as PvFetchLike,
        timeoutMs: args.timeoutMs,
        threshold: args.threshold,
        delayMs: args.delayMs,
      });
    } catch (e) {
      console.error(`  crawl error: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    const probedPages = result.probes.length;
    const okPages = result.probes.filter((p) => p.status === "ok").length;
    console.error(
      `  pages probed=${probedPages} ok=${okPages} candidates=${result.candidates.length}` +
        ` (${candidatePagesForCity(city.pvIndexUrl).length} derived)`,
    );

    // Confirm candidates best-score-first; keep the FIRST confirmed PDF per muni.
    let picked: ManifestMuni | undefined;
    for (const cand of result.candidates) {
      if (args.delayMs > 0) await new Promise((r) => setTimeout(r, args.delayMs));
      let conf: ConfirmResult;
      try {
        conf = await confirmPdf(fetchImpl, cand.pdfUrl, args.timeoutMs, args.download);
      } catch (e) {
        console.error(
          `  [skip] ${cand.pdfUrl} — ${e instanceof PvSourceFetchError ? e.message : String(e)}`,
        );
        continue;
      }
      if (!conf.ok) {
        console.error(`  [skip] HTTP ${conf.status} ${cand.pdfUrl}`);
        continue;
      }
      confirmed++;
      console.error(`  [200] score=${cand.scoreClassif} ${cand.pdfUrl}`);
      picked = buildMuni(cand);

      if (args.download && conf.bytes) {
        const dir = join(WORK_DIR, cand.slug);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        const pdfPath = join(dir, "grille.pdf");
        writeFileSync(pdfPath, conf.bytes);
        const pages = pdfPageCount(pdfPath);
        if (pages) picked.pages = pages;
        if (args.routeGuess) {
          const probe = decideRoute(pdfPath, cand.pdfUrl);
          picked.route = probe.route;
          if (probe.first !== undefined) picked.first = probe.first;
          if (probe.last !== undefined) picked.last = probe.last;
          if (probe.grillePageCount !== undefined) picked.grillePageCount = probe.grillePageCount;
          if (probe.confidence !== undefined) picked.locatorConfidence = probe.confidence;
          picked.routeReason = probe.reason;
          console.error(`  [route] ${probe.reason}`);
        }
      }
      break; // first confirmed candidate per muni is enough for the manifest
    }

    if (picked) {
      munis.push(picked);
      cityHits++;
    } else {
      console.error(`  no confirmed grille PDF`);
    }
  }

  const outDir = dirname(args.out);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const payload = {
    _note:
      "Candidate grille manifest discovered by grille-discovery-run.ts (reuses the PV crawler). " +
      "Every sourceUrl was confirmed HTTP 200 + PDF at discovery time. route is a heuristic guess; " +
      "zonage-norms-run.ts re-decides native|multizone|vision precisely. Same shape as munis.json.",
    _generatedAt: new Date().toISOString(),
    munis,
  };
  writeFileSync(args.out, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.error(
    `=== FIN DISCOVERY: munis=${munis.length}/${cities.length} confirmed=${confirmed} → ${args.out} ===`,
  );
}

function buildMuni(cand: GrilleCandidate): ManifestMuni {
  return {
    slug: cand.slug,
    route: "auto",
    sourceUrl: cand.pdfUrl,
    discoveredFrom: cand.sourceUrl,
    scoreClassif: cand.scoreClassif,
    titre: cand.titre,
  };
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
