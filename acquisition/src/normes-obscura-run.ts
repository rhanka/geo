/**
 * normes-obscura-run.ts — débloque les GRILLES de zonage des villes dont la page
 * urbanisme/règlements est JS-WALLED (CMS gestionweblex & co). La liste des
 * documents (dont le règlement de zonage / la grille des spécifications) est
 * injectée par JavaScript et INVISIBLE à un fetch statique — la discovery statique
 * `grille-discovery-run.ts` y voit 0 lien PDF (faux plateau). On rend la page en
 * Chromium HEADLESS (CDP), on extrait du DOM RENDU l'URL du document de grille
 * (handler gestionweblex `document.ashx?documentid=` OU lien `.pdf` classé grille),
 * on télécharge le(s) PDF candidat(s), on les CLASSE avec la même garde-fou de
 * contenu que la discovery statique, et on émet un manifest compatible
 * `zonage-norms-batch.ts` (qui reste l'EXTRACTEUR — native/multizone/vision).
 *
 * C'est l'analogue normes de `pv-obscura-run.ts` (qui a débloqué les PV via
 * gestionweblex). Cet outil NE FAIT QUE la DISCOVERY+TÉLÉCHARGEMENT+manifest ;
 * l'extraction et le dépôt restent au batch existant (clé Mistral, budget, dépôt
 * registry/qc-zonage-norms/, anti-invention ≥3 zone_codes). On ne ré-implémente
 * AUCUN parseur de grille.
 *
 * RÉUTILISATION (rien réinventé) :
 *   - la classe `Browser` CDP corrigée de `pv-obscura-run.ts` (port=0 +
 *     DevToolsActivePort anti-collision ; `visit()` = DOM rendu ; `close()` =
 *     SIGKILL + rmSync du profil chromium).
 *   - `classifyGrilleLink` (modèle de mots-clés FR grille) de `grille-discovery.ts`
 *     pour SCORER les liens du DOM rendu (label/url).
 *   - `classifyGrillePdf` + `gateGrilleCandidate` (garde anti-impostor : rejette
 *     plan-image / règlement-texte) de `grille-pdf-classifier.ts`.
 *   - `locateGrillePages` + `pdfToPageTexts` de `grille-page-locator.ts`, et
 *     `isGrillePage`/`parseGrillePage` de `grille-specifications-parser.ts`, pour
 *     décider native/multizone/vision et BORNER first/last (le même `decideRoute…`
 *     que `grille-discovery-run.ts`).
 *
 * ANTI-INVENTION STRICTE : seuls des liens RÉELLEMENT présents dans le DOM rendu
 * sont retenus ; un PDF classé `plan-image` (carte) ou `reglement` (texte légal
 * sans table) est REJETÉ, jamais déposé comme grille. Le dépôt final (≥3 zone_codes
 * réels) reste la responsabilité du batch ; cet outil ne dépose rien en S3.
 *
 * HYGIÈNE INFRA : MAX 1 chromium (un seul `Browser` partagé, villes séquentielles).
 * Chaque profil chromium est nettoyé en fin de run. Les PDF téléchargés vont dans
 * `work/zonage-norms/<slug>/grille.pdf` (consommés par le batch) ; à nettoyer
 * après extraction (le batch ne les supprime pas).
 *
 * USAGE :
 *   # probe (rend + liste les candidats grille, AUCUN téléchargement) :
 *   npx tsx src/normes-obscura-run.ts --urls "saint-gilles=https://www.st-gilles.qc.ca/pages/proces-verbaux" --probe
 *   # discovery réelle (rend + télécharge le meilleur grille.pdf + manifest) :
 *   npx tsx src/normes-obscura-run.ts --urls "a=https://…,b=https://…" --download \
 *       --manifest ../work/delegation-mass/normes-obscura-manifest.json
 *
 * Options :
 *   --urls slug=startUrl,…   villes ; startUrl = page règlements/PV/urbanisme rendue.
 *   --download               télécharger le meilleur PDF → work/zonage-norms/<slug>/grille.pdf
 *                            et l'émettre dans le manifest (défaut : off → --probe).
 *   --probe                  rendu + liste des candidats, aucun téléchargement.
 *   --manifest FILE          chemin du manifest émis (défaut delegation-mass/normes-obscura-manifest.json).
 *   --nav-ms MS              délai de rendu JS par page (défaut 9000).
 *   --max-follow N           liens nav urbanisme/zonage/règlement à suivre (défaut 6).
 *   --max-eval N             PDF candidats à télécharger+classer par ville (défaut 8).
 *   --threshold N            seuil du classifieur de lien (défaut 4).
 *   --delay-ms MS            délai de politesse entre fetchs PDF (défaut 1200).
 *   --out FILE               chemin du rapport JSON.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifyGrilleLink,
  PV_USER_AGENT,
} from "../../packages/qc-sources/src/sources/grille-discovery.js";
import {
  classifyGrillePdf,
  gateGrilleCandidate,
  type GrillePdfClass,
} from "../../packages/qc-sources/src/sources/grille-pdf-classifier.js";
import {
  locateGrillePages,
  pdfToPageTexts,
  type GrilleLocation,
} from "../../packages/qc-sources/src/sources/grille-page-locator.js";
import {
  isGrillePage,
  parseGrillePage,
} from "../../packages/qc-sources/src/sources/grille-specifications-parser.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ACQ = resolve(HERE, ".."); // acquisition/
const REPO = resolve(ACQ, ".."); // geo/
const WORK_DIR = join(REPO, "work", "zonage-norms");

const REAL_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const CHROME_CANDIDATES = [
  process.env["CHROME_BIN"],
  `${process.env["HOME"]}/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`,
  "/snap/bin/chromium",
].filter(Boolean) as string[];

function resolveChrome(): string | null {
  for (const c of CHROME_CANDIDATES) if (existsSync(c)) return c;
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Doc-href detection on the RENDERED DOM (gestionweblex handler + generic) ────
// Mirrors pv-obscura's isDocHref: the gestionweblex SaaS injects its documents as
// `apps.gestionweblex.ca/doc-list/handlers/document.ashx?documentid=<uuid>` anchors
// (and `gestionweblex.ca/files/<id>`) which carry no `.pdf` extension, plus normal
// `.pdf`/`.doc` links and generic download endpoints. The shared static parser
// structurally routes gestionweblex to obscura, so — being the obscura voie — we
// read these real anchors from the rendered DOM ourselves.
const GWL_DOC_RE =
  /gestionweblex\.ca\/(?:doc-list\/handlers\/document\.ashx\?[^"'<> ]*documentid=|files\/)/i;
const STD_DOC_RE = /\.(?:pdf|docx?|odt)(?:[?#].*)?$/i;
const STD_DOWNLOAD_RE =
  /[?&](?:download|telechargement|getfile|fichier|file|attachment)=|\/(?:download|telecharger|getfile|fichier)[/?]/i;

function isDocHref(url: string): boolean {
  return GWL_DOC_RE.test(url) || STD_DOC_RE.test(url) || STD_DOWNLOAD_RE.test(url);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/gi, "&")
    .replace(/&#0?39;|&apos;|&rsquo;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function labelText(inner: string): string {
  return decodeEntities(inner.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

// ── Grille DOC candidate extraction from a rendered DOM ─────────────────────────

interface DocCandidate {
  url: string;
  title: string;
  score: number;
  matched: readonly string[];
  sourceUrl: string;
}

/**
 * Extract grille-PDF candidates from a RENDERED DOM: every <a> whose href is a
 * document (gestionweblex handler / .pdf / download endpoint) AND whose
 * `classifyGrilleLink(label, url)` score clears `threshold`. Best-score-first,
 * de-duplicated by URL. Anti-invention: only real anchors of the rendered DOM.
 */
function extractGrilleDocCandidates(
  dom: string,
  baseUrl: string,
  threshold: number,
): DocCandidate[] {
  const out: DocCandidate[] = [];
  const seen = new Set<string>();
  for (const m of dom.matchAll(/<a\b[^>]*\shref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: string;
    try {
      url = new URL(decodeEntities(m[1]!), baseUrl).href;
    } catch {
      continue;
    }
    if (!/^https?:/i.test(url) || !isDocHref(url)) continue;
    if (seen.has(url)) continue;
    const title = labelText(m[2] ?? "");
    const cls = classifyGrilleLink(title, url);
    if (cls.score < threshold) continue;
    seen.add(url);
    out.push({ url, title, score: cls.score, matched: cls.matched, sourceUrl: baseUrl });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

// ── Same-site nav-link harvest from a rendered DOM (urbanisme/zonage/règlement) ──
// Like grille-discovery's extractInternalSubpages, but WITHOUT the requiresBrowser
// guard (the rendered gestionweblex DOM still carries the marker, which would make
// the shared function bail). We follow only same-site HTML pages whose anchor/url
// names urbanisme/zonage/règlement/grille — where the grille really lives.
const NAV_FOLLOW_RE =
  /urbanism|zonage|r[eè]glement|reglement|amenagement|am[eé]nagement|grille|specification|sp[eé]cification|reglementation/i;
const NAV_SKIP_RE =
  /facebook|twitter|instagram|linkedin|youtube|mailto:|tel:|\/(?:en|es)\/|login|connexion|panier|cart|proces[-_]?verba|seance/i;

function registrableSite(u: string): string | null {
  try {
    return new URL(u).host.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

interface NavLink {
  url: string;
  anchor: string;
  score: number;
}

function extractGrilleNavLinks(dom: string, pageUrl: string, max: number): NavLink[] {
  const baseSite = registrableSite(pageUrl);
  const scored: NavLink[] = [];
  const seen = new Set<string>();
  for (const m of dom.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = m[1] ?? "";
    const anchor = labelText(m[2] ?? "");
    const hrefMatch = attrs.match(/(?:^|\s)href=["']([^"']+)["']/i);
    const rawHref = hrefMatch?.[1];
    if (!rawHref) continue;
    if (/^(?:#|javascript:|mailto:|tel:|data:)/i.test(rawHref.trim())) continue;
    let abs: string;
    try {
      const u = new URL(decodeEntities(rawHref), pageUrl);
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      u.hash = "";
      abs = u.href;
    } catch {
      continue;
    }
    const site = registrableSite(abs);
    if (!site || site !== baseSite) continue;
    if (abs === pageUrl) continue;
    if (isDocHref(abs)) continue; // doc links are grille candidates, not nav hops
    const hay = `${anchor} ${abs}`;
    if (NAV_SKIP_RE.test(hay)) continue;
    if (!NAV_FOLLOW_RE.test(hay)) continue;
    if (seen.has(abs)) continue;
    seen.add(abs);
    let score = 1;
    if (/grille|specification|sp[eé]cification/i.test(hay)) score += 4;
    if (/zonage/i.test(hay)) score += 3;
    if (/urbanism/i.test(hay)) score += 2;
    if (/r[eè]glement|reglement/i.test(hay)) score += 1;
    scored.push({ url: abs, anchor: anchor || abs, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, max);
}

// ── CDP minimal (Chromium headless) — repris de pv-obscura-run.ts ──────────────
class Browser {
  private proc: ChildProcess;
  private ws!: WebSocket;
  private profile: string;
  private port: number;
  private msgId = 0;
  private pending = new Map<number, (m: { result?: unknown; error?: unknown }) => void>();

  private constructor(proc: ChildProcess, profile: string, port: number) {
    this.proc = proc;
    this.profile = profile;
    this.port = port;
  }

  static async launch(chrome: string): Promise<Browser> {
    const profile = mkdtempSync(join(tmpdir(), "normes-obscura-"));
    const proc = spawn(
      chrome,
      [
        "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
        "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions",
        `--remote-debugging-port=0`, `--user-data-dir=${profile}`, "about:blank",
      ],
      { stdio: ["ignore", "ignore", "ignore"] },
    );
    const b = new Browser(proc, profile, 0);
    const wsUrl = await b.waitDevtools();
    b.ws = new WebSocket(wsUrl);
    await new Promise<void>((res, rej) => {
      b.ws.onopen = () => res();
      b.ws.onerror = () => rej(new Error("ws error"));
    });
    b.ws.onmessage = (ev: MessageEvent): void => {
      let m: { id?: number };
      try {
        m = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (m.id && b.pending.has(m.id)) {
        b.pending.get(m.id)!(m as never);
        b.pending.delete(m.id);
      }
    };
    return b;
  }

  private async waitDevtools(): Promise<string> {
    const portFile = join(this.profile, "DevToolsActivePort");
    for (let i = 0; i < 80; i++) {
      try {
        if (existsSync(portFile)) {
          const realPort = Number(readFileSync(portFile, "utf8").trim().split("\n")[0]);
          if (realPort > 0) {
            this.port = realPort;
            const r = await fetch(`http://127.0.0.1:${this.port}/json/version`);
            if (r.ok) {
              const j = (await r.json()) as { webSocketDebuggerUrl: string };
              return j.webSocketDebuggerUrl;
            }
          }
        }
      } catch {
        /* not up yet */
      }
      await sleep(250);
    }
    throw new Error("devtools endpoint never came up");
  }

  private send(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<{ result?: unknown; error?: unknown }> {
    const id = ++this.msgId;
    return new Promise((res) => {
      this.pending.set(id, res);
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  /** Navigate to a URL in a fresh tab; return the rendered DOM (closes the tab). */
  async visit(url: string, navMs: number): Promise<string> {
    let targetId: string | undefined;
    try {
      const created = (await this.send("Target.createTarget", { url: "about:blank" }))
        .result as { targetId: string };
      targetId = created.targetId;
      const attached = (await this.send("Target.attachToTarget", { targetId, flatten: true }))
        .result as { sessionId: string };
      const sid = attached.sessionId;
      await this.send("Network.setUserAgentOverride", { userAgent: REAL_UA }, sid);
      await this.send("Page.enable", {}, sid);
      await this.send("Page.navigate", { url }, sid);
      await sleep(navMs);
      let dom = "";
      try {
        const evalRes = (await this.send(
          "Runtime.evaluate",
          {
            expression: "document.documentElement ? document.documentElement.outerHTML : ''",
            returnByValue: true,
          },
          sid,
        )).result as { result?: { value?: string } };
        dom = evalRes?.result?.value ?? "";
      } catch {
        /* dom optional */
      }
      return dom;
    } finally {
      if (targetId) {
        try {
          await this.send("Target.closeTarget", { targetId });
        } catch {
          /* ignore */
        }
      }
    }
  }

  close(): void {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    try {
      this.proc.kill("SIGKILL");
    } catch {
      /* ignore */
    }
    try {
      rmSync(this.profile, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

// ── Image-grille → vision rescue thresholds (FIX 1) ─────────────────────────────
// When a candidate's LINK is an explicit, high-confidence grille anchor
// (`classifyGrilleLink` ≥ IMAGE_VISION_LINK_SCORE — e.g. "Grille de spécification
// pour le périmètre urbain") BUT the downloaded PDF is an image-only SCAN (empty
// text layer → `classifyGrillePdf` = "plan-image"), it is a REAL grille whose
// table lives in pixels, not a map. We route it to VISION (Mistral reads the image
// grille) instead of rejecting it as a carte — the anti-carte guard still rejects
// every WEAK link (score < threshold). A page-count ceiling protects the Mistral
// budget so a big scanned règlement is never vision-swept whole.
const IMAGE_VISION_LINK_SCORE = 10;
const IMAGE_VISION_MAX_PAGES = 30;

// ── PDF download (anti-invention: magic-byte %PDF, size guard) ──────────────────
const MAX_PDF_BYTES = 80 * 1024 * 1024;

async function downloadPdf(
  url: string,
  timeoutMs: number,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": PV_USER_AGENT, accept: "application/pdf,*/*" },
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > MAX_PDF_BYTES) return null;
    const isPdf =
      /pdf/i.test(ct) ||
      (buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46);
    if (!isPdf) return null;
    return { bytes: buf, contentType: ct };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Route decision via the frozen parser + locator (copie de grille-discovery-run.ts) ──
interface RouteProbe {
  route: "auto" | "native" | "vision" | "multizone";
  first?: number;
  last?: number;
  grillePageCount?: number;
  confidence?: number;
  reason: string;
}

function pagesFromBytes(bytes: Uint8Array): string[] | null {
  const tmp = join(
    tmpdir(),
    `normes-obscura-cand-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`,
  );
  try {
    writeFileSync(tmp, bytes);
    return pdfToPageTexts(tmp);
  } catch {
    return null;
  } finally {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* best-effort */
    }
  }
}

function decideRouteFromPages(pages: string[] | null, sourceUrl: string): RouteProbe {
  if (pages === null) return { route: "auto", reason: "pdftotext failed — leave auto" };
  const snapshot = new Date().toISOString().slice(0, 10);
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
  return {
    route: "auto",
    reason: "no native grille rows and no grille page located (image-only scan?) — auto",
  };
}

// ── Manifest model (mirrors work/zonage-norms/munis.json, consumed by the batch) ──
interface ManifestMuni {
  slug: string;
  route: "auto" | "native" | "vision" | "multizone";
  pages?: number;
  first?: number;
  last?: number;
  reglement?: string;
  sourceUrl: string;
  discoveredFrom?: string;
  scoreClassif?: number;
  titre?: string;
  classifKind?: string;
  grillePageCount?: number;
  locatorConfidence?: number;
  routeReason?: string;
  discoveryTrack?: "js-walled-render";
}

/**
 * Set the muni's route from the probe, rescuing a confirmed grille whose probe
 * stayed "auto" to a bounded route (multizone over zone-header pages, or vision
 * over the grille span). Anti-invention: rescue only fires for kind="grille".
 */
function applyRoute(muni: ManifestMuni, probe: RouteProbe, cls: GrillePdfClass): void {
  let route = probe.route;
  let first = probe.first;
  let last = probe.last;
  let reason = probe.reason;
  if (route === "auto" && cls.kind === "grille") {
    if (cls.signals.zoneHeaderPages >= 1) {
      route = "multizone";
      first = cls.signals.firstZoneHeaderPage;
      last = cls.signals.lastZoneHeaderPage;
      reason = `rescue→multizone: ${cls.signals.zoneHeaderPages} zone-header pages ${first}..${last}`;
    } else if (cls.signals.firstGrillePage >= 1) {
      route = "vision";
      first = cls.signals.firstGrillePage;
      last = cls.signals.lastGrillePage;
      reason = `rescue→vision: grille span ${first}..${last} (${cls.signals.grillePages} pages)`;
    }
  }
  muni.route = route;
  if (first !== undefined) muni.first = first;
  if (last !== undefined) muni.last = last;
  if (cls.signals.grillePages > 0) muni.grillePageCount = cls.signals.grillePages;
  if (probe.confidence !== undefined) muni.locatorConfidence = probe.confidence;
  muni.routeReason = reason;
}

/**
 * FIX 1 — build a VISION manifest entry for a strong-link grille that downloaded as
 * an image-only scan. Returns null (→ normal reject) unless ALL hold:
 *   - the LINK is an explicit grille anchor (`cand.score ≥ IMAGE_VISION_LINK_SCORE`);
 *   - the PDF is an image-only scan (`cls.kind === "plan-image"`);
 *   - the scan is small enough (`pageCount ≤ IMAGE_VISION_MAX_PAGES`) to vision-sweep
 *     whole within the per-muni Mistral budget.
 * Anti-invention: deposit is still gated by the batch's ≥3-zone_codes rule; this only
 * routes a real-but-scanned grille to the extractor that can actually read it.
 */
function imageGrilleVisionRescue(
  t: SlugTarget,
  cand: DocCandidate,
  cls: GrillePdfClass,
): ManifestMuni | null {
  if (cls.kind !== "plan-image") return null;
  if (cand.score < IMAGE_VISION_LINK_SCORE) return null;
  const pc = cls.signals.pageCount;
  if (pc < 1 || pc > IMAGE_VISION_MAX_PAGES) return null;
  return {
    slug: t.slug,
    route: "vision",
    sourceUrl: cand.url,
    discoveredFrom: cand.sourceUrl,
    scoreClassif: cand.score,
    titre: cand.title,
    classifKind: cls.kind,
    discoveryTrack: "js-walled-render",
    first: 1,
    last: pc,
    routeReason: `rescue→vision: strong grille link (score ${cand.score}) but image-only scan (${cls.signals.avgCharsPerPage} chars/page over ${pc} p) — Mistral reads the image grille`,
  };
}

function pdfPageCount(pdfPath: string): number | undefined {
  const r = spawnSync("pdfinfo", [pdfPath], { encoding: "utf8" });
  const m = r.stdout?.match(/Pages:\s+(\d+)/);
  return m?.[1] ? Number(m[1]) : undefined;
}

// ── Args ────────────────────────────────────────────────────────────────────────
interface SlugTarget {
  slug: string;
  startUrl: string;
}
interface Args {
  targets: SlugTarget[];
  download: boolean;
  manifestPath: string;
  navMs: number;
  maxFollow: number;
  maxEval: number;
  threshold: number;
  delayMs: number;
  timeoutMs: number;
  outFile: string;
}

function parseArgs(argv: string[]): Args {
  const get = (k: string): string | undefined => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const has = (k: string): boolean => argv.includes(`--${k}`);
  const targets: SlugTarget[] = (get("urls") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((item) => {
      const eq = item.indexOf("=");
      if (eq <= 0) throw new Error(`--urls item must be slug=url, got "${item}"`);
      return { slug: item.slice(0, eq).trim(), startUrl: item.slice(eq + 1).trim() };
    });
  return {
    targets,
    download: has("download") && !has("probe"),
    manifestPath:
      get("manifest") ?? join(REPO, "work", "delegation-mass", "normes-obscura-manifest.json"),
    navMs: Number(get("nav-ms") ?? 9000),
    maxFollow: Number(get("max-follow") ?? 6),
    // Wider default (rerank fix): download+pdftotext are free, only Mistral costs, so
    // we eval more candidates to reach the base codification past the amendments; the
    // `best.priority >= 3` early break still short-circuits once a real grille lands.
    maxEval: Number(get("max-eval") ?? 8),
    threshold: Number(get("threshold") ?? 4),
    delayMs: Number(get("delay-ms") ?? 1200),
    timeoutMs: Number(get("timeout-ms") ?? 30000),
    outFile:
      get("out") ?? join(REPO, "work", "delegation-mass", "normes-obscura-run-report.json"),
  };
}

// ── Per-city processing ──────────────────────────────────────────────────────────
type Status =
  | "deposited-pdf" // grille PDF found via render, classed kept, written + manifest
  | "probe-ok" // candidates found (render), but --probe (no download)
  | "kept-no-download" // candidates found but every download/classify rejected
  | "no-grille-rendered" // render OK but 0 grille doc candidate in DOM
  | "render-failed"
  | "error";

interface SlugResult {
  slug: string;
  startUrl: string;
  status: Status;
  candidatesFound: number;
  topCandidates: { url: string; title: string; score: number }[];
  rendered: number;
  classifKind?: string;
  route?: string;
  routeReason?: string;
  pdfBytes?: number;
  detail: string;
}

interface ViableCandidate {
  muni: ManifestMuni;
  bytes: Uint8Array;
  priority: number;
  grillePages: number;
  score: number;
}

function isBetter(a: ViableCandidate, b: ViableCandidate): boolean {
  if (a.priority !== b.priority) return a.priority > b.priority;
  if (a.grillePages !== b.grillePages) return a.grillePages > b.grillePages;
  return a.score > b.score;
}

async function processCity(
  t: SlugTarget,
  browser: Browser,
  args: Args,
  manifestOut: ManifestMuni[],
): Promise<SlugResult> {
  const base: SlugResult = {
    slug: t.slug,
    startUrl: t.startUrl,
    status: "render-failed",
    candidatesFound: 0,
    topCandidates: [],
    rendered: 0,
    detail: "",
  };

  // 1) Render the start page; collect grille doc candidates + nav links.
  const startDom = await browser.visit(t.startUrl, args.navMs);
  base.rendered = 1;
  if (!startDom) return { ...base, status: "render-failed", detail: `rendu vide @ ${t.startUrl}` };

  const byUrl = new Map<string, DocCandidate>();
  for (const c of extractGrilleDocCandidates(startDom, t.startUrl, args.threshold)) {
    if (!byUrl.has(c.url)) byUrl.set(c.url, c);
  }
  const navLinks = extractGrilleNavLinks(startDom, t.startUrl, args.maxFollow);

  // 2) Follow nav links (best-first), render each, collect candidates. Stop early
  //    once a STRONG candidate (score ≥ 6 — explicit "grille des …" / "règlement de
  //    zonage") is in hand.
  const hasStrong = (): boolean => [...byUrl.values()].some((c) => c.score >= 6);
  for (const link of navLinks) {
    if (hasStrong()) break;
    const subDom = await browser.visit(link.url, args.navMs);
    base.rendered++;
    if (!subDom) continue;
    for (const c of extractGrilleDocCandidates(subDom, link.url, args.threshold)) {
      if (!byUrl.has(c.url)) byUrl.set(c.url, c);
    }
  }

  const candidates = [...byUrl.values()].sort((a, b) => b.score - a.score);
  base.candidatesFound = candidates.length;
  base.topCandidates = candidates.slice(0, 5).map((c) => ({ url: c.url, title: c.title, score: c.score }));

  if (candidates.length === 0) {
    return {
      ...base,
      status: "no-grille-rendered",
      detail: `rendu OK (${base.rendered} page(s), navLinks=${navLinks.length}) mais 0 candidat grille — grille absente du site, derrière clic/auth, ou non-PDF`,
    };
  }

  // 3) Probe mode: report candidates, no download.
  if (!args.download) {
    return {
      ...base,
      status: "probe-ok",
      detail: `PROBE: ${candidates.length} candidat(s) grille (top score=${candidates[0]!.score}) — non téléchargé`,
    };
  }

  // 4) Download + classify candidates (best-first, up to maxEval), pick the best
  //    real grille (content-gated). Reject plan-image / règlement-texte.
  let best: ViableCandidate | undefined;
  let evaluated = 0;
  let rejected = 0;
  const rejectKinds: string[] = [];
  for (const cand of candidates) {
    if (best && best.priority >= 3) break;
    if (evaluated >= args.maxEval) break;
    if (args.delayMs > 0) await sleep(args.delayMs);
    const dl = await downloadPdf(cand.url, args.timeoutMs);
    if (!dl) {
      continue;
    }
    evaluated++;
    const pages = pagesFromBytes(dl.bytes);
    const cls = classifyGrillePdf(pages ?? []);
    const probe = decideRouteFromPages(pages, cand.url);
    const gate = gateGrilleCandidate(cls, probe.route !== "auto");
    if (!gate.keep) {
      // FIX 1 — image-grille → vision rescue. A STRONG, explicit grille LINK whose
      // PDF is an image-only scan (`plan-image`) is a real grille whose table is in
      // pixels; route the whole (small) scan to VISION instead of rejecting it as a
      // carte. The anti-carte guard still rejects every weaker link.
      const rescue = imageGrilleVisionRescue(t, cand, cls);
      if (!rescue) {
        rejected++;
        rejectKinds.push(cls.kind);
        continue;
      }
      const viable: ViableCandidate = {
        muni: rescue,
        bytes: dl.bytes,
        priority: 3, // beats a false bounded grille and triggers the early break
        grillePages: cls.signals.grillePages,
        score: cand.score,
      };
      if (!best || isBetter(viable, best)) best = viable;
      continue;
    }
    const muni: ManifestMuni = {
      slug: t.slug,
      route: "auto",
      sourceUrl: cand.url,
      discoveredFrom: cand.sourceUrl,
      scoreClassif: cand.score,
      titre: cand.title,
      classifKind: cls.kind,
      discoveryTrack: "js-walled-render",
    };
    applyRoute(muni, probe, cls);
    const viable: ViableCandidate = {
      muni,
      bytes: dl.bytes,
      priority: gate.priority,
      grillePages: cls.signals.grillePages,
      score: cand.score,
    };
    if (!best || isBetter(viable, best)) best = viable;
  }

  if (!best) {
    return {
      ...base,
      status: "kept-no-download",
      detail: `${candidates.length} candidat(s) mais ${evaluated} téléchargé(s)/classé(s) tous rejetés (${[...new Set(rejectKinds)].join(",") || "download-fail"})`,
    };
  }

  // 5) Write the best PDF to work/zonage-norms/<slug>/grille.pdf + manifest entry.
  const dir = join(WORK_DIR, best.muni.slug);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const pdfPath = join(dir, "grille.pdf");
  writeFileSync(pdfPath, best.bytes);
  const pc = pdfPageCount(pdfPath);
  if (pc) best.muni.pages = pc;
  manifestOut.push(best.muni);

  return {
    ...base,
    status: "deposited-pdf",
    classifKind: best.muni.classifKind ?? "",
    route: best.muni.route,
    routeReason: best.muni.routeReason ?? "",
    pdfBytes: best.bytes.length,
    detail: `grille.pdf écrit (${best.bytes.length} o, ${pc ?? "?"} p), route=${best.muni.route} :: ${best.muni.routeReason ?? ""}`,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.targets.length === 0) {
    console.error(
      "usage: --urls slug=startUrl[,slug=startUrl] [--download|--probe] [--manifest FILE] [--nav-ms MS] [--max-follow N] [--max-eval N] [--threshold N]",
    );
    process.exit(2);
  }
  const chrome = resolveChrome();
  if (!chrome) {
    console.error("[normes-obscura] AUCUN binaire Chromium — abandon");
    process.exit(1);
  }
  console.error(
    `[normes-obscura] chromium=${chrome} villes=${args.targets.length} download=${args.download} navMs=${args.navMs} maxFollow=${args.maxFollow}`,
  );

  const results: SlugResult[] = [];
  const manifestOut: ManifestMuni[] = [];

  // MAX 1 chromium : un seul Browser partagé, villes traitées séquentiellement.
  const browser = await Browser.launch(chrome);
  try {
    for (let i = 0; i < args.targets.length; i++) {
      const t = args.targets[i]!;
      let r: SlugResult;
      try {
        r = await processCity(t, browser, args, manifestOut);
      } catch (e) {
        r = {
          slug: t.slug,
          startUrl: t.startUrl,
          status: "error",
          candidatesFound: 0,
          topCandidates: [],
          rendered: 0,
          detail: e instanceof Error ? e.message : String(e),
        };
      }
      results.push(r);
      console.error(
        `[${i + 1}/${args.targets.length}] ${r.status.padEnd(20)} ${t.slug} :: ${r.detail}`,
      );
    }
  } finally {
    browser.close(); // SIGKILL + rmSync du profil chromium
  }

  // Write the manifest (only when we downloaded real grille PDFs).
  if (args.download && manifestOut.length > 0) {
    const dir = dirname(args.manifestPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const payload = {
      _note:
        "Candidate grille manifest discovered by normes-obscura-run.ts (HEADLESS render of a " +
        "JS-walled urbanisme/règlements page). Each grille PDF was found in the RENDERED DOM " +
        "(gestionweblex doc handler or .pdf), downloaded, and content-classed as a real grille " +
        "(plan-image/règlement-texte rejected). Feed to zonage-norms-batch.ts unchanged.",
      _generatedAt: new Date().toISOString(),
      munis: manifestOut,
    };
    writeFileSync(args.manifestPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
    console.error(`manifest (${manifestOut.length} munis) → ${args.manifestPath}`);
  }

  const byStatus: Record<string, number> = {};
  for (const r of results) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const report = {
    generatedAt: new Date().toISOString(),
    download: args.download,
    byStatus,
    grilleFound: results.filter((r) => r.candidatesFound > 0).map((r) => r.slug),
    pdfWritten: manifestOut.map((m) => m.slug),
    results,
  };
  writeFileSync(args.outFile, JSON.stringify(report, null, 2) + "\n");
  console.error(`\n=== STATUS ${JSON.stringify(byStatus)}`);
  console.error(`grille candidats trouvés (rendu)=${report.grilleFound.length} [${report.grilleFound.join(",")}]`);
  console.error(`grille.pdf écrits=${report.pdfWritten.length} [${report.pdfWritten.join(",")}]`);
  console.error(`rapport → ${args.outFile}`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
