/**
 * pv-obscura-run.ts — récupère les INDEX de procès-verbaux (PV) des villes dont
 * la page d'index est JS-WALLED : la liste des PV est injectée par JavaScript et
 * INVISIBLE à un fetch statique (le scraper statique y voit 0 PV même en fenêtre
 * 10 ans). On rend la `pvIndexUrl` en Chromium HEADLESS (CDP), on récupère le
 * HTML *rendu*, puis on le passe au parser PV existant — `pvEntriesFromHtml` de
 * `pv-gonet-run.ts` — qui applique la même garde-fou qualité (lien PV-identifié,
 * pas d'ordre-du-jour, contexte de page). Si ≥1 vrai PV est extrait du DOM rendu,
 * on dépose un manifest idempotent `registry/qc-pv/<slug>/index.json` en S3.
 *
 * RÉUTILISATION (ne réinvente pas) :
 *   - la classe `Browser` CDP de `zones-obscura-run.ts` (remote-debugging-port=0 +
 *     lecture DevToolsActivePort anti-collision ; `visit()` = DOM rendu ; `close()`
 *     fait rmSync du profil chromium).
 *   - `pvEntriesFromHtml` + `extractPvNavigationLinks` de `pv-gonet-run.ts` (le
 *     parser + la garde-fou qualité, appliqués au DOM RENDU au lieu du HTML statique).
 *   - le format manifest `registry/qc-pv/<slug>/index.json` (putBytes).
 *
 * ANTI-INVENTION STRICTE : seuls des liens PV RÉELLEMENT présents dans le DOM rendu
 * (et retenus par la garde-fou de `pvEntriesFromHtml`) sont déposés ; jamais
 * inventés. Si le rendu donne 0 PV réel → SKIP justifié, aucun dépôt. Le manifest
 * ne contient QUE les entrées extraites.
 *
 * HYGIÈNE INFRA : MAX 1 chromium (un seul `Browser` partagé, séquentiel). Chaque
 * profil est nettoyé (`close()` → rmSync) en fin de run. NE met PAS à jour la
 * matrice (S3 = source de vérité ; `coverage-reconcile.ts` réconciliera).
 *
 * USAGE :
 *   # rendu seul (voir ce qui sort, aucun dépôt) :
 *   npx tsx src/pv-obscura-run.ts --slugs marston=https://www.munmarston.qc.ca/pages/proces-verbaux --no-deposit
 *   # plusieurs villes, dépôt S3 :
 *   npx tsx src/pv-obscura-run.ts --slugs "a=https://…,b=https://…" --deposit
 *   # une ville, URL via flag dédié :
 *   npx tsx src/pv-obscura-run.ts --slugs marston --pv-index-url https://… --deposit
 *
 * Options :
 *   --slugs a=url,b=url   villes ; chaque item est `slug` OU `slug=pvIndexUrl`.
 *   --pv-index-url URL    pvIndexUrl appliquée aux slugs sans `=url` explicite.
 *   --deposit/--no-deposit  écrire (ou non) le manifest en S3 (défaut : non).
 *   --window-days N       ne garder que les PV datés ≤ N jours (0 = aucun filtre,
 *                         défaut 0) ; les entrées sans date sont toujours gardées.
 *   --nav-ms MS           délai de rendu JS par page (défaut 12000).
 *   --max-follow N        si l'index rend 0 PV, suivre jusqu'à N liens "PV/séances"
 *                         rendus (même site) et re-rendre (défaut 4).
 *   --max-path-probes N   si toujours 0 PV, RENDRE jusqu'à N chemins PV canoniques
 *                         (`/conseil-municipal/proces-verbaux/`, …) — récupère les
 *                         sites JS-wall dont le menu d'accueil n'est PAS des ancres
 *                         exploitables (shadow-DOM / builders : vplus, etc.) où la
 *                         page PV canonique rend pourtant la liste complète. 0 =
 *                         désactivé (défaut 10).
 *   --force               réécrire un manifest déjà présent en S3 (défaut : skip).
 *   --out FILE            chemin du rapport JSON.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { S3Client } from "@aws-sdk/client-s3";
import { s3Client, putBytes, exists } from "./lib/s3.js";
import { websiteForSlug } from "../../packages/geo-sources-americas/src/ca-qc/municipalities/municipal-directory.js";
import {
  pvEntriesFromHtml,
  extractPvNavigationLinks,
  type PvManifestEntry,
} from "./pv-gonet-run.js";
import { PV_USER_AGENT } from "../../packages/qc-sources/src/sources/proces-verbaux-generic.js";

// ── Extraction sur DOM rendu : gestionweblex doc-list (et docs génériques) ─────
// La famille SaaS `gestionweblex` (sites `*/pages/proces-verbaux`,
// `*/pages/seances-du-conseil`) injecte la liste des PV par JavaScript sous forme
// d'ancres `https://apps.gestionweblex.ca/doc-list/handlers/document.ashx?documentid=<uuid>`
// (label = « 9 août 2010 (séance ordinaire) »). Le parser PARTAGÉ `parsePvIndex`
// court-circuite VOLONTAIREMENT ces pages (`detectIndexRenderMode.requiresBrowser`)
// pour les router vers obscura, ET son `looksLikeDocumentUrl` ne reconnaît pas le
// handler `.ashx?documentid=` (ni les `gestionweblex.ca/files/<id>`). Étant la
// voie obscura, on extrait donc ces liens RÉELS du DOM RENDU nous-mêmes, avec la
// même garde-fou qualité (PV-identifié, jamais d'ordre-du-jour). Anti-invention :
// uniquement des ancres réellement présentes dans le DOM rendu.
const GWL_DOC_RE =
  /gestionweblex\.ca\/(?:doc-list\/handlers\/document\.ashx\?[^"'<> ]*documentid=|files\/)/i;
const STD_DOC_RE =
  /\.(?:pdf|docx?|odt)(?:[?#].*)?$/i;
const STD_DOWNLOAD_RE =
  /[?&](?:download|telechargement|getfile|fichier|file|attachment)=|\/(?:download|telecharger|getfile|fichier)[/?]/i;
const PV_KW_RE =
  /proc[èeé]s[-\s]?verb(?:al|aux)|\bpv\b|proces[-_]?verbal|s[ée]ances?|conseil municipal/i;
const OBSCURA_ODJ_RE = /ordre[-\s]du[-\s]jour|\bodj\b|\bagenda\b/i;
const FRENCH_MONTHS: Record<string, string> = {
  janvier: "01", février: "02", fevrier: "02", mars: "03", avril: "04", mai: "05",
  juin: "06", juillet: "07", août: "08", aout: "08", septembre: "09", octobre: "10",
  novembre: "11", décembre: "12", decembre: "12",
};

function decodeEntities(s: string): string {
  return s.replace(/&amp;/gi, "&").replace(/&#0?39;|&apos;|&rsquo;/gi, "'")
    .replace(/&quot;/gi, '"').replace(/&nbsp;/gi, " ").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
}
function labelText(inner: string): string {
  return decodeEntities(inner.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
/** ISO date from a French/ISO label, else undefined (publishedAt is optional). */
function isoFromLabel(label: string): string | undefined {
  const l = label.toLowerCase();
  const full = l.match(/(\d{1,2})(?:er|re|e|ère|ème)?\s+([a-zàâçéèêëîïôûù]+)\s+(\d{4})/i);
  if (full?.[1] && full[2] && full[3]) { const mo = FRENCH_MONTHS[full[2]]; if (mo) return `${full[3]}-${mo}-${full[1].padStart(2, "0")}`; }
  const iso = l.match(/\b(\d{4})[-/](\d{2})[-/](\d{2})\b/);
  if (iso?.[1] && iso[2] && iso[3]) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const my = l.match(/\b([a-zàâçéèêëîïôûù]+)\s+(\d{4})\b/i);
  if (my?.[1] && my[2]) { const mo = FRENCH_MONTHS[my[1]]; if (mo) return `${my[2]}-${mo}`; }
  return undefined;
}
function isDocHref(url: string): boolean {
  return GWL_DOC_RE.test(url) || STD_DOC_RE.test(url) || STD_DOWNLOAD_RE.test(url);
}
/**
 * Extract PV entries from a RENDERED DOM, covering the gestionweblex doc-list
 * handler (and generic document hrefs) that the shared `parsePvIndex` routes to
 * obscura. Quality-gated: keep a link only when it is a document href AND it is
 * PV-identified (label/url names a procès-verbal / séance) AND it is NOT an
 * ordre-du-jour. No fabrication — every entry is a real anchor in the DOM.
 */
function extractGestionweblexEntries(dom: string, baseUrl: string): PvManifestEntry[] {
  const out: PvManifestEntry[] = [];
  const seen = new Set<string>();
  for (const m of dom.matchAll(/<a\b[^>]*\shref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: string;
    try { url = new URL(decodeEntities(m[1]!), baseUrl).href; } catch { continue; }
    if (!/^https?:/i.test(url) || !isDocHref(url)) continue;
    const label = labelText(m[2] ?? "");
    const hay = `${label} ${url}`;
    if (OBSCURA_ODJ_RE.test(hay)) continue;          // jamais d'ordre-du-jour
    if (!PV_KW_RE.test(hay)) continue;               // PV-identifié obligatoire
    if (seen.has(url)) continue;
    seen.add(url);
    const iso = isoFromLabel(label);
    out.push({
      url,
      ...(label ? { title: label } : {}),
      ...(iso ? { publishedAt: iso } : {}),
      contentType: GWL_DOC_RE.test(url) ? "application/pdf" : contentTypeFor(url),
    });
  }
  return out;
}
function contentTypeFor(url: string): string {
  if (/\.pdf(?:[?#].*)?$/i.test(url)) return "application/pdf";
  if (/\.docx?(?:[?#].*)?$/i.test(url)) return "application/msword";
  if (/\.odt(?:[?#].*)?$/i.test(url)) return "application/vnd.oasis.opendocument.text";
  return "application/octet-stream";
}
/**
 * Famille CMS « fichiers_documents » (sites municipaux QC type villagehowick.com,
 * tres-st-sacrement.ca, stanbridge-station.ca, …). La liste PV rendue est un
 * tableau où chaque séance est DEUX ancres séparées que `parsePvIndex` ne sait pas
 * réassocier :
 *   <a href="…/documents/?id=89">2026-05-04 : Séance ordinaire</a>   ← titre+date
 *   <a href="…/docs/fichiers_documents/89.pdf">89.pdf</a>             ← fichier réel
 * Le `.pdf` porte un nom inutile (« 89.pdf ») donc la garde-fou générale le rejette
 * (ni mot-clé PV, ni date). On RÉ-ASSOCIE par le NUMÉRO (id=N ↔ N.pdf — convention
 * du CMS), en n'émettant que les paires dont le LABEL `?id=N` est explicitement
 * PV-identifié par mot-clé (séance/procès-verbal — PAS la seule date, sinon les
 * docs d'urbanisme « Plan d'urbanisme (mars 2020) » passeraient). Anti-invention :
 * l'URL émise est l'ancre `.pdf` RÉELLE du DOM ; le titre vient de l'ancre sœur réelle.
 */
function extractHowickCmsEntries(dom: string, baseUrl: string): PvManifestEntry[] {
  const labelById = new Map<string, string>();
  for (const m of dom.matchAll(/<a\b[^>]*\shref=["'][^"']*[?&]id=(\d+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const id = m[1]!; const label = labelText(m[2] ?? "");
    if (label && !labelById.has(id)) labelById.set(id, label);
  }
  const out: PvManifestEntry[] = [];
  const seen = new Set<string>();
  for (const m of dom.matchAll(/<a\b[^>]*\shref=["']([^"']*fichiers_documents\/(\d+)\.pdf)["']/gi)) {
    let url: string;
    try { url = new URL(decodeEntities(m[1]!), baseUrl).href; } catch { continue; }
    const label = labelById.get(m[2]!);
    if (!label) continue;
    if (OBSCURA_ODJ_RE.test(label)) continue;        // jamais d'ordre-du-jour
    if (!PV_KW_RE.test(label)) continue;             // mot-clé PV obligatoire (pas date seule)
    if (seen.has(url)) continue;
    seen.add(url);
    const iso = isoFromLabel(label);
    out.push({ url, title: label, ...(iso ? { publishedAt: iso } : {}), contentType: "application/pdf" });
  }
  return out;
}
/**
 * PV entries from a rendered DOM: first the shared quality-gated parser
 * (`pvEntriesFromHtml`, covers JS sites that render normal .pdf links), then the
 * gestionweblex/obscura extractor for what the shared parser structurally defers,
 * then the « fichiers_documents » CMS family (id↔pdf re-association).
 * Merged + de-duplicated by URL.
 */
function pvEntriesFromRenderedDom(dom: string, baseUrl: string): PvManifestEntry[] {
  const out: PvManifestEntry[] = [];
  const seen = new Set<string>();
  for (const e of [
    ...pvEntriesFromHtml(dom, baseUrl),
    ...extractGestionweblexEntries(dom, baseUrl),
    ...extractHowickCmsEntries(dom, baseUrl),
  ]) {
    if (seen.has(e.url)) continue;
    seen.add(e.url);
    out.push(e);
  }
  return out;
}

// ── Constantes ────────────────────────────────────────────────────────────────
const HERE = dirname(fileURLToPath(import.meta.url));
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

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

// ── Chemins PV canoniques (rendus en dernier recours) ──────────────────────────
// Beaucoup de sites JS-wall (builders à menu en shadow-DOM, SaaS « vplus », etc.)
// ne rendent AUCUNE ancre PV exploitable sur la page d'accueil : `extractPvNavigationLinks`
// y voit 0 lien à suivre. Mais leur page PV CANONIQUE (`/conseil-municipal/proces-verbaux/`,
// `/seances-du-conseil/`, …) rend, elle, la liste complète des PV (.pdf/.doc/handler).
// On rend donc directement un sous-ensemble curé de ces chemins (les plus productifs,
// ordre de fréquence décroissante) quand accueil + nav-follow donnent 0 PV. Liste
// courte VOLONTAIREMENT (coût d'un rendu headless par chemin) : on s'arrête au 1er
// chemin qui rend ≥3 PV réels. Anti-invention : on n'extrait que ce que le DOM rend.
const CANONICAL_PV_PATHS = [
  "/conseil-municipal/proces-verbaux/",
  "/seances-du-conseil/",
  "/proces-verbaux/",
  "/proces-verbaux",
  "/vie-democratique/seances-du-conseil/",
  "/municipalite/proces-verbaux/",
  "/conseil-municipal/seances-du-conseil/",
  "/conseil-municipal/",
  "/vie-democratique/proces-verbaux/",
  "/conseil/proces-verbaux/",
  "/ordres-du-jour-et-proces-verbaux/",
  "/la-ville/vie-democratique/seances-du-conseil/",
  "/administration/seances-et-proces-verbaux/",
  "/mairie/seances-du-conseil/",
];

// ── Args ──────────────────────────────────────────────────────────────────────
interface SlugTarget { slug: string; pvIndexUrl: string | null }
interface Args {
  targets: SlugTarget[];
  deposit: boolean;
  windowDays: number;
  navMs: number;
  maxFollow: number;
  pathProbes: number;
  force: boolean;
  outFile?: string;
}
function parseArgs(argv: string[]): Args {
  const get = (k: string): string | undefined => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const has = (k: string) => argv.includes(`--${k}`);
  const urlAll = get("pv-index-url");
  const targets: SlugTarget[] = (get("slugs") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((item) => {
      const eq = item.indexOf("=");
      if (eq > 0) return { slug: item.slice(0, eq).trim(), pvIndexUrl: item.slice(eq + 1).trim() };
      return { slug: item, pvIndexUrl: urlAll ?? null };
    });
  return {
    targets,
    deposit: has("deposit") && !has("no-deposit"),
    windowDays: Number(get("window-days") ?? 0),
    navMs: Number(get("nav-ms") ?? 12_000),
    maxFollow: Number(get("max-follow") ?? 4),
    pathProbes: Number(get("max-path-probes") ?? 10),
    force: has("force"),
    ...(get("out") ? { outFile: get("out") } : {}),
  };
}

// ── CDP minimal (Chromium headless) — adapté de zones-obscura-run.ts ───────────
class Browser {
  private proc: ChildProcess;
  private ws!: WebSocket;
  private profile: string;
  private port: number;
  private msgId = 0;
  private pending = new Map<number, (m: { result?: unknown; error?: unknown }) => void>();

  private constructor(proc: ChildProcess, profile: string, port: number) {
    this.proc = proc; this.profile = profile; this.port = port;
  }

  static async launch(chrome: string): Promise<Browser> {
    // Port 0 → chromium choisit un port libre (écrit dans <profile>/DevToolsActivePort).
    // Évite les collisions de port quand plusieurs lanes lancent chromium en //.
    const profile = mkdtempSync(join(tmpdir(), "pv-obscura-"));
    const proc = spawn(chrome, [
      "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
      "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions",
      // Beaucoup de sites municipaux QC ont un certificat TLS cassé (CN/SAN qui ne
      // matche pas le hostname, certificat « Plesk » par défaut, auto-signé). Sans
      // ce flag, chromium rend l'interstitiel d'erreur (net::ERR_CERT_*) au lieu de
      // la page → 0 PV (faux négatif). curl -k confirme que le contenu EST servi ;
      // on charge donc malgré le cert (lecture seule, anti-invention inchangée :
      // on n'extrait que les liens PV réellement présents dans le DOM rendu).
      "--ignore-certificate-errors",
      `--remote-debugging-port=0`, `--user-data-dir=${profile}`, "about:blank",
    ], { stdio: ["ignore", "ignore", "ignore"] });
    const b = new Browser(proc, profile, 0);
    const wsUrl = await b.waitDevtools();
    b.ws = new WebSocket(wsUrl);
    await new Promise<void>((res, rej) => { b.ws.onopen = () => res(); b.ws.onerror = () => rej(new Error("ws error")); });
    b.ws.onmessage = (ev: MessageEvent): void => {
      let m: { id?: number };
      try { m = JSON.parse(ev.data as string); } catch { return; }
      if (m.id && b.pending.has(m.id)) { b.pending.get(m.id)!(m as never); b.pending.delete(m.id); }
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
            if (r.ok) { const j = (await r.json()) as { webSocketDebuggerUrl: string }; return j.webSocketDebuggerUrl; }
          }
        }
      } catch { /* not up yet */ }
      await sleep(250);
    }
    throw new Error("devtools endpoint never came up");
  }

  private send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<{ result?: unknown; error?: unknown }> {
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
      const created = (await this.send("Target.createTarget", { url: "about:blank" })).result as { targetId: string };
      targetId = created.targetId;
      const attached = (await this.send("Target.attachToTarget", { targetId, flatten: true })).result as { sessionId: string };
      const sid = attached.sessionId;
      await this.send("Network.setUserAgentOverride", { userAgent: REAL_UA }, sid);
      await this.send("Page.enable", {}, sid);
      await this.send("Page.navigate", { url }, sid);
      await sleep(navMs);
      let dom = "";
      try {
        const evalRes = (await this.send("Runtime.evaluate", {
          expression: "document.documentElement ? document.documentElement.outerHTML : ''",
          returnByValue: true,
        }, sid)).result as { result?: { value?: string } };
        dom = evalRes?.result?.value ?? "";
      } catch { /* dom optional */ }
      return dom;
    } finally {
      if (targetId) { try { await this.send("Target.closeTarget", { targetId }); } catch { /* ignore */ } }
    }
  }

  close(): void {
    try { this.ws?.close(); } catch { /* ignore */ }
    try { this.proc.kill("SIGKILL"); } catch { /* ignore */ }
    try { rmSync(this.profile, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

// ── Fenêtre temporelle (optionnelle) ──────────────────────────────────────────
/** Keep an entry if undated OR its date is within `windowDays` of now. windowDays<=0 → keep all. */
function withinWindow(entry: PvManifestEntry, windowDays: number): boolean {
  if (windowDays <= 0 || !entry.publishedAt) return true;
  const t = Date.parse(entry.publishedAt);
  if (!Number.isFinite(t)) return true; // unparseable date → keep (anti-invention: don't drop a real ref on a date-format guess)
  return t >= Date.now() - windowDays * 86_400_000;
}

// ── Manifest ──────────────────────────────────────────────────────────────────
function manifestKey(slug: string): string { return `registry/qc-pv/${slug}/index.json`; }

interface PvObscuraManifest {
  _note: string;
  _generatedAt: string;
  slug: string;
  sourceId: string;
  pvIndexUrl: string;
  discoveryTrack: "js-walled-render";
  renderEngine: "chromium-cdp";
  userAgent: string;
  windowDays: number;
  count: number;
  entries: PvManifestEntry[];
}

// ── Traitement d'une ville ────────────────────────────────────────────────────
type Status =
  | "deposited"
  | "probe-ok"        // PV extraits mais --no-deposit
  | "skip-existing"
  | "no-pv-rendered"  // rendu OK mais 0 PV réel (JS-wall non extractible / scroll-click/auth)
  | "no-url"
  | "render-failed"
  | "error";

interface SlugResult {
  slug: string;
  pvIndexUrl: string | null;
  status: Status;
  finalIndexUrl?: string;
  count: number;
  deposited: boolean;
  domLen?: number;
  followed?: number;
  pathProbed?: number;
  detail: string;
}

async function processCity(t: SlugTarget, browser: Browser, s3: S3Client | null, args: Args): Promise<SlugResult> {
  const pvIndexUrl = t.pvIndexUrl ?? websiteForSlug(t.slug) ?? null;
  const base: SlugResult = { slug: t.slug, pvIndexUrl, status: "no-url", count: 0, deposited: false, detail: "" };
  if (!pvIndexUrl) return { ...base, detail: "aucune pvIndexUrl (ni --slugs slug=url, ni --pv-index-url, ni annuaire)" };

  // Idempotence : ne re-rend pas une ville déjà déposée (sauf --force).
  if (s3 && args.deposit && !args.force && (await exists(s3, manifestKey(t.slug)))) {
    return { ...base, status: "skip-existing", detail: "manifest déjà en S3 (--force pour réécrire)" };
  }

  // 1) Rendu de la pvIndexUrl elle-même.
  const dom = await browser.visit(pvIndexUrl, args.navMs);
  if (!dom) return { ...base, status: "render-failed", detail: `rendu vide @ ${pvIndexUrl}` };

  let best: { url: string; entries: PvManifestEntry[] } = { url: pvIndexUrl, entries: pvEntriesFromRenderedDom(dom, pvIndexUrl) };
  let followed = 0;
  let pathProbed = 0;
  const tried = new Set<string>([pvIndexUrl]);

  // 2) Si l'index rend 0 PV, suivre les liens "PV/séances" rendus (même site) et
  //    re-rendre. Beaucoup de sites éclatent leurs PV sur PLUSIEURS sous-pages par
  //    année (CMS « fichiers_documents » : `?c=7&sc=2` 2025, `?c=7&sc=4` 2026, …).
  //    On ACCUMULE donc les PV de toutes les sous-pages suivies (dédupe par URL)
  //    au lieu de s'arrêter à la première non vide — sinon on perd les autres années.
  if (best.entries.length === 0) {
    const navLinks = extractPvNavigationLinks(dom, pvIndexUrl).slice(0, args.maxFollow);
    const merged = new Map<string, PvManifestEntry>();
    let firstHit = "";
    for (const link of navLinks) {
      tried.add(link);
      followed++;
      const subDom = await browser.visit(link, args.navMs);
      if (!subDom) continue;
      const subEntries = pvEntriesFromRenderedDom(subDom, link);
      if (subEntries.length > 0 && !firstHit) firstHit = link;
      for (const e of subEntries) if (!merged.has(e.url)) merged.set(e.url, e);
    }
    if (merged.size > best.entries.length) best = { url: firstHit || pvIndexUrl, entries: [...merged.values()] };
  }

  // 3) Toujours 0 PV : RENDRE les chemins PV canoniques de l'origine. Récupère les
  //    sites JS-wall dont l'accueil n'a aucune ancre PV exploitable (menu shadow-DOM,
  //    builders « vplus », etc.) mais dont la page PV canonique rend la liste complète.
  if (best.entries.length === 0 && args.pathProbes > 0) {
    let origin: string;
    try { origin = new URL(pvIndexUrl).origin; } catch { origin = ""; }
    if (origin) {
      for (const path of CANONICAL_PV_PATHS) {
        if (pathProbed >= args.pathProbes) break;
        const url = `${origin}${path}`;
        if (tried.has(url)) continue;
        tried.add(url);
        pathProbed++;
        const probeDom = await browser.visit(url, args.navMs);
        if (!probeDom) continue;
        const probeEntries = pvEntriesFromRenderedDom(probeDom, url);
        if (probeEntries.length > best.entries.length) best = { url, entries: probeEntries };
        if (best.entries.length >= 3) break; // 1er chemin clairement PV suffit
      }
    }
  }

  const entries = best.entries.filter((e) => withinWindow(e, args.windowDays));
  base.finalIndexUrl = best.url;
  base.domLen = dom.length;
  base.followed = followed;
  base.pathProbed = pathProbed;
  base.count = entries.length;

  // 4) Anti-invention : 0 PV réel rendu → SKIP justifié, aucun dépôt.
  if (entries.length === 0) {
    const navCount = extractPvNavigationLinks(dom, pvIndexUrl).length;
    return {
      ...base,
      status: "no-pv-rendered",
      detail: `rendu OK (domLen=${dom.length}, navLinks=${navCount}, suivis=${followed}, chemins=${pathProbed}) mais 0 PV réel extrait — JS-wall non extractible (scroll/clic/auth ?) ou index réellement vide`,
    };
  }

  // 5) Dépôt (ou probe si --no-deposit).
  const manifest: PvObscuraManifest = {
    _note:
      "PV index discovered by pv-obscura-run.ts (headless render of a JS-walled index). " +
      "The municipal PV list is injected by JavaScript and invisible to a static fetch; " +
      "Chromium (CDP) rendered the DOM and pvEntriesFromHtml (pv-gonet-run.ts) parsed real " +
      "PV document links from it, quality-gated to PV-identified documents. No fabrication.",
    _generatedAt: new Date().toISOString(),
    slug: t.slug,
    sourceId: `proces-verbaux-${t.slug}`,
    pvIndexUrl: best.url,
    discoveryTrack: "js-walled-render",
    renderEngine: "chromium-cdp",
    userAgent: PV_USER_AGENT,
    windowDays: args.windowDays,
    count: entries.length,
    entries,
  };

  if (args.deposit && s3) {
    await putBytes(s3, manifestKey(t.slug), JSON.stringify(manifest, null, 2) + "\n", "application/json");
    return { ...base, status: "deposited", deposited: true, detail: `${entries.length} PV → s3://${manifestKey(t.slug)} @ ${best.url}` };
  }
  return { ...base, status: "probe-ok", detail: `PROBE OK (non déposé) : ${entries.length} PV @ ${best.url}` };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.targets.length === 0) {
    console.error("usage: --slugs slug=url[,slug=url] [--pv-index-url URL] [--deposit|--no-deposit] [--window-days N] [--nav-ms MS] [--max-follow N] [--max-path-probes N] [--force]");
    process.exit(2);
  }

  const chrome = resolveChrome();
  if (!chrome) { console.error("[pv-obscura] AUCUN binaire Chromium — abandon"); process.exit(1); }
  console.error(`[pv-obscura] chromium=${chrome} villes=${args.targets.length} deposit=${args.deposit} window=${args.windowDays}d navMs=${args.navMs}`);

  const s3 = args.deposit ? s3Client() : null;
  const results: SlugResult[] = [];

  // MAX 1 chromium : un seul Browser partagé, villes traitées séquentiellement.
  const browser = await Browser.launch(chrome);
  try {
    for (let i = 0; i < args.targets.length; i++) {
      const t = args.targets[i]!;
      let r: SlugResult;
      try { r = await processCity(t, browser, s3, args); }
      catch (e) { r = { slug: t.slug, pvIndexUrl: t.pvIndexUrl, status: "error", count: 0, deposited: false, detail: e instanceof Error ? e.message : String(e) }; }
      results.push(r);
      console.error(`[${i + 1}/${args.targets.length}] ${r.status.padEnd(16)} ${t.slug} :: ${r.detail}`);
    }
  } finally {
    browser.close(); // SIGKILL + rmSync du profil chromium
  }

  const byStatus: Record<string, number> = {};
  for (const r of results) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const deposited = results.filter((r) => r.deposited).map((r) => r.slug);
  const jsWallExtractible = results.filter((r) => r.status === "deposited" || r.status === "probe-ok").map((r) => r.slug);

  const report = {
    generatedAt: new Date().toISOString(),
    deposit: args.deposit,
    windowDays: args.windowDays,
    byStatus,
    extractible: jsWallExtractible,
    deposited,
    results,
  };
  const out = args.outFile ?? resolve(HERE, "../../work/delegation-mass/pv-obscura-run-report.json");
  writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  console.error(`\n=== STATUS ${JSON.stringify(byStatus)}`);
  console.error(`extractibles=${jsWallExtractible.length} [${jsWallExtractible.join(",")}]`);
  console.error(`déposés=${deposited.length} [${deposited.join(",")}]`);
  console.error(`rapport → ${out}`);
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
