/**
 * zones-obscura-run.ts — récupère les ZONES municipales via les PORTAILS GIS
 * interactifs (pas des PDF), en pilotant Chromium HEADLESS pour découvrir le
 * backend qui sert les polygones de zonage, puis en l'interrogeant directement.
 *
 * STRATÉGIE (obscura) — pour les ~727 villes `zones=to-research` dont le site a
 * un marqueur ArcGIS mais sans FeatureServer mono-muni trouvable en statique :
 *
 *   1. DÉCOUVERTE headless. On rend la home + les sous-pages "carte/urbanisme/
 *      zonage" via Chromium (`--remote-debugging-port` + CDP). On capture (a) le
 *      DOM rendu et (b) TOUTES les requêtes réseau (XHR/fetch/img/script). On en
 *      extrait des "leads" : item-id de viewer ArcGIS (webappviewer/experience/
 *      instant), URLs FeatureServer/MapServer directes, et marqueurs des autres
 *      plateformes (GoAzimut/GoNet, JMap, IGO, WFS).
 *
 *   2. RÉSOLUTION ArcGIS (sans rendu lourd). Pour chaque item-id, l'API publique
 *      `sharing/rest/content/items/<id>/data` donne le webmap → `operationalLayers`
 *      (URLs FeatureServer). On énumère aussi le catalogue de l'org hôte
 *      (`services.arcgis.com/<org>/.../services`). On cherche une couche de
 *      ZONAGE (titre/champs) avec un champ `zone_code` fiable.
 *
 *   3. VALIDATION + DÉPÔT. La couche doit : être un polygone, avoir un zone_code
 *      non-null ≥50% & ≤24 char, et se situer spatialement sur la muni (centre
 *      d'emprise ≤ --spatial-km du centroïde registre). Agrégat MRC → filtré par
 *      l'attribut municipalité. On normalise au schéma de serving et on dépose
 *      `normalized/ca-qc-zonage/qc-zonage-<slug>.geojson` en S3.
 *
 * ANTI-INVENTION STRICTE : seul un zone_code RÉEL servi par le backend est déposé
 * (jamais reconstruit/deviné). Couche affectation-seule, ou spatial KO, ou
 * zone_code absent → SKIP justifié, aucun dépôt. Aucun secret loggé.
 *
 * NE met PAS à jour la matrice (S3 = source de vérité ; `coverage-reconcile.ts`
 * réconciliera). Écrit un rapport JSON.
 *
 * USAGE :
 *   npx tsx src/zones-obscura-run.ts --slugs saint-barthelemy,roxton --deposit
 *   npx tsx src/zones-obscura-run.ts --slugs foo --no-deposit   (probe/classement seul)
 *   options : --max-carto <n> (déf 3) --nav-ms <ms> (déf 12000) --spatial-km <n> (déf 25)
 *             --out <file>
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { S3Client } from "@aws-sdk/client-s3";
import { s3Client, putBytes, exists } from "./lib/s3.js";
import { websiteForSlug } from "../../packages/geo-sources-americas/ca-qc/municipalities/municipal-directory.js";

// ── Constantes ────────────────────────────────────────────────────────────────
const HERE = dirname(fileURLToPath(import.meta.url));
const MUNIS_PATH = resolve(HERE, "../../packages/qc-sources/src/geo/municipalities.qc.json");
const S3_PREFIX = "normalized/ca-qc-zonage/";
const REAL_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const HTTP_UA = "sentropic-geo/0.1";
const HTTP_TIMEOUT_MS = 8_000;
const MAX_FEATURES = 6_000;

const CHROME_CANDIDATES = [
  process.env["CHROME_BIN"],
  `${process.env["HOME"]}/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`,
  "/snap/bin/chromium",
].filter(Boolean) as string[];

function resolveChrome(): string | null {
  for (const c of CHROME_CANDIDATES) if (existsSync(c)) return c;
  return null;
}

// Champs zone_code plausibles (réutilise la taxonomie de agol-mono-muni-detect).
const ZONE_CODE_FIELD_PATTERNS = [
  /^zone_?code$/i, /^zonage$/i, /^zone$/i, /^zoning$/i, /^num_?zone$/i,
  /^no_?zone$/i, /^code_?zone$/i, /^codezonage$/i, /^designation$/i,
  /^type_?zone$/i, /^class_?zone$/i, /^ZONAGEMUNICIPALID$/i, /^ZonageMuni$/i,
  /^REGZONE$/i, /^ZONE_ID$/i, /^NOM_ZONE$/i, /^etiquette$/i, /^no_zonage$/i,
];
const AFFECTATION_FIELD_PATTERNS = [/affectation/i, /grande_affect/i];
const ZONAGE_TITLE_PATTERNS = [/\bzonage\b/i, /\bzoning\b/i, /\bzones?\b/i, /grille.*zone/i, /regl.*zone/i];
const AFFECTATION_TITLE_PATTERNS = [/\baffectation\b/i, /milieu.*humide/i, /\bpiia\b/i, /inondab/i, /patrimo/i, /contrainte/i];

// Attributs municipalité dans les couches MRC agrégées.
const MUNI_ATTR_CANDIDATES = [
  "mun_nom", "MuniTopo", "municipalite", "Municipalite", "MUNICIPALITE", "NOM_MUN",
  "nom_mun", "NOMMUN", "Municipali", "MUNICIPALI", "muni_nom", "nom_muni", "NomMuni",
  "MUNICIPALITY", "municipality", "VILLE", "Ville", "nom_ville", "MUS_NM_MUN",
];

// ── Types ─────────────────────────────────────────────────────────────────────
interface MuniEntry { slug: string; name: string; mrc: string | null; lat: number; lon: number }
interface GeoFeature { type: "Feature"; geometry: { type: string; coordinates: unknown } | null; properties: Record<string, unknown> }
interface GeoFC { type: "FeatureCollection"; features: GeoFeature[] }

type Platform = "arcgis" | "goazimut" | "jmap" | "igo" | "wfs" | "carto" | "none";

interface Lead {
  arcgisItems: Set<string>;      // item-ids (32-hex)
  arcgisServices: Set<string>;   // FeatureServer/MapServer base URLs
  arcgisOrgs: Set<string>;       // services.arcgis.com org ids
  goazimut: Set<string>;
  jmap: Set<string>;
  igo: Set<string>;
  wfs: Set<string>;
}

interface SlugResult {
  slug: string;
  site: string | null;
  platforms: Platform[];
  viewerUrls: string[];
  zonageLayerUrl?: string;
  zoneCodeField?: string;
  featureCount?: number;
  distanceKm?: number;
  deposited: boolean;
  status: "deposited" | "no-zonage-layer" | "matrice-only" | "no-viewer" | "spatial-fail" | "platform-not-arcgis" | "no-site" | "error";
  detail: string;
}

// ── Args ──────────────────────────────────────────────────────────────────────
interface GonetSeed { slug: string; code: string }
interface Args { slugs: string[]; deposit: boolean; maxCarto: number; navMs: number; spatialKm: number; services: string[]; orgs: string[]; gonetSeeds: GonetSeed[]; outFile?: string }
function parseArgs(argv: string[]): Args {
  const get = (k: string): string | undefined => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const has = (k: string) => argv.includes(`--${k}`);
  const csv = (k: string): string[] => (get(k) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return {
    slugs: csv("slugs"),
    deposit: has("deposit") && !has("no-deposit"),
    maxCarto: Number(get("max-carto") ?? 3),
    navMs: Number(get("nav-ms") ?? 12_000),
    spatialKm: Number(get("spatial-km") ?? 25),
    // Org-seeded mode: skip site crawl, deposit per-muni straight from a known
    // ArcGIS hosted-org id (--org) or explicit FeatureServer URL (--service).
    services: csv("service"),
    orgs: csv("org"),
    // GoNet-seeded mode (discover-once-deposit-many): skip the site crawl and go
    // straight to the GOnet6 viewer for a known municode. Format: slug=municode.
    gonetSeeds: csv("gonet").map((pair) => { const [slug, code] = pair.split("="); return { slug: (slug ?? "").trim(), code: (code ?? "").trim() }; }).filter((s) => s.slug && /^\d{4,5}$/.test(s.code)),
    ...(get("out") ? { outFile: get("out") } : {}),
  };
}

// ── Utilitaires HTTP/géo ──────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
function toSlug(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function stripAdminPrefix(s: string): string {
  return s.replace(/^(municipalit[ée]\s+(du\s+canton\s+de\s+|du\s+|de\s+|des\s+|d')?|ville\s+de\s+|ville\s+|paroisse\s+(de\s+)?|canton\s+(de\s+)?|sd\s+de\s+|vl\s+de\s+)/i, "").trim();
}
/** Recursively yield every [lon,lat] position of a GeoJSON coordinate tree. */
function* positionsOf(coords: unknown): Generator<[number, number]> {
  if (!Array.isArray(coords)) return;
  if (coords.length >= 2 && typeof coords[0] === "number" && typeof coords[1] === "number") {
    yield [coords[0] as number, coords[1] as number];
    return;
  }
  for (const c of coords) yield* positionsOf(c);
}
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371, dLat = ((lat2 - lat1) * Math.PI) / 180, dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchJson<T = unknown>(url: string, timeoutMs = HTTP_TIMEOUT_MS): Promise<T | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": HTTP_UA, accept: "application/json" } });
    if (!r.ok) return null;
    return JSON.parse(await r.text()) as T;
  } catch { return null; } finally { clearTimeout(t); }
}

// ── CDP minimal (Chromium headless via remote-debugging) ──────────────────────
class Browser {
  private proc: ChildProcess;
  private ws!: WebSocket;
  private profile: string;
  private port: number;
  private msgId = 0;
  private pending = new Map<number, (m: { result?: unknown; error?: unknown }) => void>();
  private sink: string[] | null = null; // when set, Network.requestWillBeSent URLs are collected here

  private constructor(proc: ChildProcess, profile: string, port: number) {
    this.proc = proc; this.profile = profile; this.port = port;
  }

  static async launch(chrome: string): Promise<Browser> {
    const port = 9300 + Math.floor(Math.random() * 400);
    const profile = mkdtempSync(join(tmpdir(), "zones-obscura-"));
    const proc = spawn(chrome, [
      "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
      "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions",
      `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank",
    ], { stdio: ["ignore", "ignore", "ignore"] });
    const b = new Browser(proc, profile, port);
    const wsUrl = await b.waitDevtools();
    b.ws = new WebSocket(wsUrl);
    await new Promise<void>((res, rej) => { b.ws.onopen = () => res(); b.ws.onerror = () => rej(new Error("ws error")); });
    // Single persistent handler: resolve pending command responses + collect net.
    b.ws.onmessage = (ev: MessageEvent): void => {
      let m: { id?: number; method?: string; params?: { request?: { url?: string } } };
      try { m = JSON.parse(ev.data as string); } catch { return; }
      if (m.id && b.pending.has(m.id)) { b.pending.get(m.id)!(m as never); b.pending.delete(m.id); }
      if (m.method === "Network.requestWillBeSent" && b.sink && m.params?.request?.url) b.sink.push(m.params.request.url);
    };
    return b;
  }

  private async waitDevtools(): Promise<string> {
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${this.port}/json/version`);
        if (r.ok) { const j = (await r.json()) as { webSocketDebuggerUrl: string }; return j.webSocketDebuggerUrl; }
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

  /** Navigate to a URL in a fresh tab; return rendered DOM + captured request URLs. */
  async visit(url: string, navMs: number): Promise<{ dom: string; requests: string[] }> {
    const requests: string[] = [];
    this.sink = requests;
    let targetId: string | undefined;
    try {
      const created = (await this.send("Target.createTarget", { url: "about:blank" })).result as { targetId: string };
      targetId = created.targetId;
      const attached = (await this.send("Target.attachToTarget", { targetId, flatten: true })).result as { sessionId: string };
      const sid = attached.sessionId;
      await this.send("Network.setUserAgentOverride", { userAgent: REAL_UA }, sid);
      await this.send("Network.enable", {}, sid);
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
      return { dom, requests };
    } finally {
      this.sink = null;
      if (targetId) { try { await this.send("Target.closeTarget", { targetId }); } catch { /* ignore */ } }
    }
  }

  /**
   * Open a tab on `url`, let it render `navMs`, and KEEP the target open so the
   * authenticated page session (cookies, JS state) can be reused for in-page
   * `fetch` calls (GoNet's MapServer is reachable only through its in-session
   * resource proxy). Returns the session id, target id, and the request URLs
   * captured during load. Caller MUST `closeSession(targetId)` when done.
   */
  async openSession(url: string, navMs: number): Promise<{ sid: string; targetId: string; requests: string[] }> {
    const requests: string[] = [];
    this.sink = requests;
    const created = (await this.send("Target.createTarget", { url: "about:blank" })).result as { targetId: string };
    const targetId = created.targetId;
    const attached = (await this.send("Target.attachToTarget", { targetId, flatten: true })).result as { sessionId: string };
    const sid = attached.sessionId;
    await this.send("Network.setUserAgentOverride", { userAgent: REAL_UA }, sid);
    await this.send("Network.enable", {}, sid);
    await this.send("Page.enable", {}, sid);
    await this.send("Page.navigate", { url }, sid);
    await sleep(navMs);
    this.sink = null; // snapshot taken; stop capturing (in-page fetches are not leads)
    return { sid, targetId, requests };
  }

  /**
   * Evaluate an async JS expression in a kept-open session; returns the resolved
   * value as a string. A CDP-level race timeout guarantees the call can never
   * hang the run if the page promise never settles.
   */
  async evalAsync(sid: string, expr: string, timeoutMs = 30_000): Promise<string | null> {
    try {
      const evalP = this.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sid);
      const timed = await Promise.race([
        evalP.then((r) => ({ ok: true as const, r })),
        sleep(timeoutMs).then(() => ({ ok: false as const })),
      ]);
      if (!timed.ok) return null;
      const r = timed.r.result as { result?: { value?: string } };
      return r?.result?.value ?? null;
    } catch { return null; }
  }

  async closeSession(targetId: string): Promise<void> {
    try { await this.send("Target.closeTarget", { targetId }); } catch { /* ignore */ }
  }

  close(): void {
    try { this.ws?.close(); } catch { /* ignore */ }
    try { this.proc.kill("SIGKILL"); } catch { /* ignore */ }
    try { rmSync(this.profile, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

// ── Extraction des leads (DOM + réseau) ───────────────────────────────────────
const ITEM_ID_RE = /[?&#/](?:id|appid|webmap|map|itemId)[=/]([0-9a-f]{32})\b/gi;
const FS_RE = /(https?:\/\/[^\s"'<>]*?\/(?:FeatureServer|MapServer)(?:\/\d+)?)/gi;
const SHARING_ITEM_RE = /\/sharing\/rest\/content\/items\/([0-9a-f]{32})\b/gi;
const ORG_RE = /services(?:\d+)?\.arcgis\.com\/([A-Za-z0-9]{8,})\//gi;

function emptyLead(): Lead {
  return { arcgisItems: new Set(), arcgisServices: new Set(), arcgisOrgs: new Set(), goazimut: new Set(), jmap: new Set(), igo: new Set(), wfs: new Set() };
}
function harvestLeads(text: string, into: Lead): void {
  let m: RegExpExecArray | null;
  for (const re of [ITEM_ID_RE, SHARING_ITEM_RE]) { re.lastIndex = 0; while ((m = re.exec(text))) into.arcgisItems.add(m[1]!.toLowerCase()); }
  FS_RE.lastIndex = 0; while ((m = FS_RE.exec(text))) into.arcgisServices.add(m[1]!.replace(/\/\d+$/, ""));
  ORG_RE.lastIndex = 0; while ((m = ORG_RE.exec(text))) into.arcgisOrgs.add(m[1]!);
  if (/goazimut\.com|gonet/i.test(text)) for (const u of text.match(/https?:\/\/[^\s"'<>]*goazimut\.com[^\s"'<>]*/gi) ?? []) into.goazimut.add(u);
  if (/jmap|k2geospatial|kheops/i.test(text)) for (const u of text.match(/https?:\/\/[^\s"'<>]*(?:jmap|k2geospatial|kheops)[^\s"'<>]*/gi) ?? []) into.jmap.add(u);
  if (/carte-igo|geoportail|infra-geo/i.test(text)) for (const u of text.match(/https?:\/\/[^\s"'<>]*(?:carte-igo|geoportail|infra-geo)[^\s"'<>]*/gi) ?? []) into.igo.add(u);
  for (const u of text.match(/https?:\/\/[^\s"'<>]*(?:wfs|GetCapabilities|GetFeature)[^\s"'<>]*/gi) ?? []) into.wfs.add(u);
}

/** Carto/urbanisme/zonage sub-links from rendered DOM (same-site only). */
function cartoLinks(dom: string, base: string): string[] {
  const out = new Set<string>();
  let baseHost: string;
  try { baseHost = new URL(base).host; } catch { return []; }
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(dom))) {
    const label = (m[2] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const hay = `${label} ${m[1]}`;
    if (!/carte|g[ée]oportail|cartograph|zonage|urbanis|interactiv|matrice|\bsig\b|g[ée]omati/i.test(hay)) continue;
    try {
      const u = new URL(m[1]!, base);
      if (u.host === baseHost) out.add(u.href);
    } catch { /* skip */ }
  }
  return [...out].slice(0, 8);
}

// ── Résolution ArcGIS : item → couches zonage candidates ──────────────────────
interface ArcLayer { url: string; title: string }

async function resolveItemLayers(org: string | null, itemId: string): Promise<ArcLayer[]> {
  // Try a set of portal hosts: any captured *.maps.arcgis.com org + arcgis.com.
  const hosts = new Set<string>(["https://www.arcgis.com"]);
  if (org) hosts.add(`https://${org}`);
  const out: ArcLayer[] = [];
  for (const host of hosts) {
    const data = await fetchJson<Record<string, unknown>>(`${host}/sharing/rest/content/items/${itemId}/data?f=json`);
    if (!data) continue;
    // App config → webmap id, then recurse once.
    const map = data["map"] as { itemId?: string } | undefined;
    const wmId = map?.itemId ?? (data["values"] as { webmap?: string } | undefined)?.webmap;
    let webmap = data;
    if (wmId && wmId !== itemId) {
      const wm = await fetchJson<Record<string, unknown>>(`${host}/sharing/rest/content/items/${wmId}/data?f=json`);
      if (wm) webmap = wm;
    }
    const ops = (webmap["operationalLayers"] as Array<Record<string, unknown>> | undefined) ?? [];
    const pushLayer = (l: Record<string, unknown>): void => {
      const url = l["url"] as string | undefined;
      const title = (l["title"] as string | undefined) ?? "";
      if (url) out.push({ url, title });
      for (const sub of (l["layers"] as Array<Record<string, unknown>> | undefined) ?? []) pushLayer(sub);
    };
    for (const l of ops) pushLayer(l);
    if (out.length) break;
  }
  return out;
}

/** Enumerate a hosted org's full feature-service catalog for zonage candidates. */
async function orgZonageServices(org: string): Promise<ArcLayer[]> {
  const cat = await fetchJson<{ services?: Array<{ name: string; type: string }> }>(`https://services.arcgis.com/${org}/arcgis/rest/services?f=json`);
  const out: ArcLayer[] = [];
  for (const s of cat?.services ?? []) {
    const base = s.name.split("/").pop() ?? s.name;
    if (ZONAGE_TITLE_PATTERNS.some((p) => p.test(base)) && !AFFECTATION_TITLE_PATTERNS.some((p) => p.test(base))) {
      out.push({ url: `https://services.arcgis.com/${org}/arcgis/rest/services/${s.name}/${s.type}`, title: base });
    }
  }
  return out;
}

interface FieldInfo { name: string; type: string }
function pickZoneField(fields: FieldInfo[]): string | null {
  for (const f of fields) {
    if (AFFECTATION_FIELD_PATTERNS.some((p) => p.test(f.name))) continue;
    if (ZONE_CODE_FIELD_PATTERNS.some((p) => p.test(f.name))) return f.name;
  }
  for (const f of fields) {
    if (!/string/i.test(f.type)) continue;
    if (AFFECTATION_FIELD_PATTERNS.some((p) => p.test(f.name))) continue;
    if (/zone/i.test(f.name)) return f.name;
  }
  return null;
}
function pickMuniField(fields: FieldInfo[]): string | null {
  const names = new Set(fields.map((f) => f.name));
  for (const c of MUNI_ATTR_CANDIDATES) if (names.has(c)) return c;
  // Regex fallback: a string field whose name denotes a municipality, but NOT a
  // code/id/geo numeric column.
  for (const f of fields) {
    if (!/string/i.test(f.type)) continue;
    if (/^muni$|^mun$|^mun_?nom$|nom_?mun|^ville$|municipalit/i.test(f.name) && !/code|geo|id$/i.test(f.name)) return f.name;
  }
  return null;
}

interface LayerProbe { layerUrl: string; zoneField: string; muniField: string | null; geometryType: string; extent: ExtentInfo | null; count: number }
interface ExtentInfo { xmin: number; ymin: number; xmax: number; ymax: number; wkid: number }

/** Resolve a service URL into its candidate zonage sub-layer (polygon + zone field). */
async function probeServiceForZonage(serviceUrl: string): Promise<LayerProbe | null> {
  const base = serviceUrl.replace(/\/\d+$/, "");
  const directLayer = /\/\d+$/.test(serviceUrl) ? serviceUrl : null;
  const layerUrls: string[] = [];
  if (directLayer) layerUrls.push(directLayer);
  else {
    const info = await fetchJson<{ layers?: Array<{ id: number; name: string; geometryType?: string }> }>(`${base}?f=json`);
    const layers = info?.layers ?? [];
    if (layers.length === 0) layerUrls.push(`${base}/0`);
    else {
      // Prefer a layer whose name screams zonage; else any polygon layer.
      const ranked = [...layers].sort((a, b) => Number(ZONAGE_TITLE_PATTERNS.some((p) => p.test(b.name))) - Number(ZONAGE_TITLE_PATTERNS.some((p) => p.test(a.name))));
      for (const l of ranked.slice(0, 6)) {
        if (AFFECTATION_TITLE_PATTERNS.some((p) => p.test(l.name)) && !ZONAGE_TITLE_PATTERNS.some((p) => p.test(l.name))) continue;
        if (l.geometryType && !/Polygon/i.test(l.geometryType)) continue;
        layerUrls.push(`${base}/${l.id}`);
      }
    }
  }
  for (const layerUrl of layerUrls) {
    const li = await fetchJson<{ fields?: FieldInfo[]; geometryType?: string; extent?: { xmin: number; ymin: number; xmax: number; ymax: number; spatialReference?: { wkid?: number; latestWkid?: number } } }>(`${layerUrl}?f=json`);
    if (!li || !li.fields) continue;
    if (li.geometryType && !/Polygon/i.test(li.geometryType)) continue;
    const zoneField = pickZoneField(li.fields);
    if (!zoneField) continue;
    const cnt = await fetchJson<{ count?: number }>(`${layerUrl}/query?where=1%3D1&returnCountOnly=true&f=json`);
    const ext = li.extent;
    const extent: ExtentInfo | null = ext ? { xmin: ext.xmin, ymin: ext.ymin, xmax: ext.xmax, ymax: ext.ymax, wkid: ext.spatialReference?.latestWkid ?? ext.spatialReference?.wkid ?? 4326 } : null;
    return { layerUrl, zoneField, muniField: pickMuniField(li.fields), geometryType: li.geometryType ?? "", extent, count: cnt?.count ?? 0 };
  }
  return null;
}

function extentCenterWgs84(e: ExtentInfo): [number, number] | null {
  let lat: number, lon: number;
  if (e.wkid === 4326) { lat = (e.ymin + e.ymax) / 2; lon = (e.xmin + e.xmax) / 2; }
  else if (e.wkid === 102100 || e.wkid === 3857) {
    const cx = (e.xmin + e.xmax) / 2, cy = (e.ymin + e.ymax) / 2;
    lon = (cx / 20037508.342) * 180; lat = (Math.atan(Math.exp((cy / 20037508.342) * Math.PI)) * 360) / Math.PI - 90;
  } else if (Math.abs(e.xmin) <= 180 && Math.abs(e.ymin) <= 90) { lat = (e.ymin + e.ymax) / 2; lon = (e.xmin + e.xmax) / 2; }
  else return null;
  if (lat < 44 || lat > 63 || lon < -80 || lon > -56) return null;
  return [lat, lon];
}
/** Rough extent diagonal in km (to tell mono-muni from MRC-aggregate). */
function extentDiagKm(e: ExtentInfo): number | null {
  const c = extentCenterWgs84(e); if (!c) return null;
  let sw: [number, number], ne: [number, number];
  if (e.wkid === 4326) { sw = [e.ymin, e.xmin]; ne = [e.ymax, e.xmax]; }
  else if (e.wkid === 102100 || e.wkid === 3857) {
    const toLL = (x: number, y: number): [number, number] => [(Math.atan(Math.exp((y / 20037508.342) * Math.PI)) * 360) / Math.PI - 90, (x / 20037508.342) * 180];
    sw = toLL(e.xmin, e.ymin); ne = toLL(e.xmax, e.ymax);
  } else return null;
  return haversineKm(sw[0], sw[1], ne[0], ne[1]);
}

// ── Téléchargement + normalisation + dépôt ────────────────────────────────────
async function fetchFeatures(layerUrl: string, outFields: string, where: string): Promise<GeoFeature[]> {
  const features: GeoFeature[] = [];
  let offset = 0;
  const batch = 1000;
  while (features.length < MAX_FEATURES) {
    const url = `${layerUrl}/query?where=${encodeURIComponent(where)}&outFields=${encodeURIComponent(outFields)}&outSR=4326&geometryPrecision=6&resultOffset=${offset}&resultRecordCount=${batch}&f=geojson`;
    const data = await fetchJson<GeoFC>(url, 20_000);
    if (!data || !Array.isArray(data.features) || data.features.length === 0) break;
    features.push(...data.features);
    offset += data.features.length;
    if (data.features.length < batch) break;
    await sleep(120);
  }
  return features;
}

function normalize(features: GeoFeature[], zoneField: string, serviceUrl: string, confidence = "obscura-zone-vector"): GeoFeature[] {
  return features.map((f) => {
    const raw = f.properties?.[zoneField];
    const zone = raw !== null && raw !== undefined && String(raw).trim() !== "" ? String(raw).trim() : null;
    return { type: "Feature", geometry: f.geometry, properties: { zone_code: zone, kind: null, affectation: null, num_zone: null, source: serviceUrl, confidence } };
  });
}

// ── GoNet / GoAzimut (PG Solutions GOnet6) ────────────────────────────────────
// Le viewer `goazimut.com/GOnet6/?m=<municode>` ouvre une SESSION publique
// (validateUser mode=FORCE_PUBLIC + reCAPTCHA invisible v3 — passe en headless),
// puis charge une couche ArcGIS **MapServer** par-muni servie UNIQUEMENT via un
// proxy authentifié `container/resource-proxy/proxy.jsp?<url>`. La couche de
// zonage réglementaire est nommée "Zonage municipal" (préfixes GoNet GROUP-/NLIST-
// possibles) et porte un champ zone_code réel (ex. `Code`, `zonage`, `No_zone`).
// On rend le viewer pour établir la session, on liste les couches du MapServer
// in-page (cookies/Referer auto), on sélectionne la couche zonage, on la
// télécharge en GeoJSON WGS84 et on dépose — anti-invention identique à l'ArcGIS.
interface GoNetLayer { id: number; name: string; geometryType?: string }

const GONET_PROXY_DEFAULT = "https://www.goazimut.com/container/resource-proxy/proxy.jsp?";
// "Zonage municipal" — pas "Zone verte/inondable/agricole" (zonage agricole CPTAQ),
// pas "Affectation" (grande affectation du SAD), pas labels/annotations.
const GONET_ZONAGE_NAME_RE = /zonage/i;
const GONET_ZONAGE_EXCLUDE_RE = /\b(?:verte?|inondab\w*|agricole|affectat\w*|humide|glissement|emb[âa]cle|conservation|protection|patrimo\w*|hydro\w*|érosion|erosion)\b/i;

function stripGonetPrefix(name: string): string {
  return name.replace(/^(?:GROUP|NLIST|LABEL|HIDDEN|SIG)-\s*/i, "").trim();
}
function isGonetZonageLayer(l: GoNetLayer): boolean {
  if (!/Polygon/i.test(l.geometryType ?? "")) return false;
  if (/^(?:LABEL|HIDDEN)-/i.test(l.name)) return false; // annotations / helpers
  const clean = stripGonetPrefix(l.name);
  return GONET_ZONAGE_NAME_RE.test(clean) && !GONET_ZONAGE_EXCLUDE_RE.test(clean);
}

/** Pick the zone_code field of a (confirmed) GoNet zonage layer. */
function pickGonetZoneField(fields: FieldInfo[]): string | null {
  const usable = fields.filter((f) =>
    /string/i.test(f.type) &&
    !AFFECTATION_FIELD_PATTERNS.some((p) => p.test(f.name)) &&
    !/^shape|shape_|^objectid|^producteur$|^matricule$|^nommuni$|^nom_?mrc$/i.test(f.name));
  for (const f of usable) if (ZONE_CODE_FIELD_PATTERNS.some((p) => p.test(f.name))) return f.name; // zonage/no_zone/…
  for (const f of usable) if (/^code(_?zone)?$/i.test(f.name) || /zone/i.test(f.name)) return f.name; // ex. `Code`
  return usable[0]?.name ?? null; // layer already confirmed "Zonage municipal"
}

/** Canonical GOnet6 viewer URL from any captured goazimut lead carrying a municode. */
function gonetViewerUrl(goazimut: Iterable<string>): string | null {
  for (const u of goazimut) {
    const m = u.match(/[?&]m=(\d{4,5})\b/);
    if (m) return `https://www.goazimut.com/GOnet6/?m=${m[1]}&pl=1`;
  }
  return null;
}
function gonetProxyBase(requests: string[]): string {
  for (const u of requests) { const m = u.match(/^(https?:\/\/[^?]*\/proxy\.jsp)\?/i); if (m) return `${m[1]}?`; }
  return GONET_PROXY_DEFAULT;
}
function gonetMapServerBase(requests: string[]): string | null {
  for (const u of requests) { const m = u.match(/proxy\.jsp\?(https?:\/\/[^?\s"'<>]*?\/MapServer)/i); if (m) return m[1]; }
  return null;
}
/** Build a CDP-evaluable async fetch (self-aborting after 25s) returning response body text. */
function fetchTextExpr(url: string): string {
  return `(async()=>{const c=new AbortController();const t=setTimeout(()=>c.abort(),25000);try{const r=await fetch(${JSON.stringify(url)},{signal:c.signal});return await r.text();}catch(e){return "__ERR__"+((e&&e.message)||e);}finally{clearTimeout(t);}})()`;
}
function parseJsonOrNull<T = Record<string, unknown>>(txt: string | null): T | null {
  if (!txt || txt.startsWith("__ERR__")) return null;
  try { return JSON.parse(txt) as T; } catch { return null; }
}

/** Download every feature of a GoNet MapServer layer via the in-session proxy (OID keyset paging). */
async function gonetFetchFeatures(
  browser: Browser, sid: string, proxy: string, mapBase: string, id: number, zoneField: string, oidField: string,
): Promise<GeoFeature[]> {
  const features: GeoFeature[] = [];
  let lastOid = -1;
  const batch = 1000;
  while (features.length < MAX_FEATURES) {
    const where = encodeURIComponent(`${oidField}>${lastOid}`);
    const of = encodeURIComponent(`${zoneField},${oidField}`);
    const url = `${proxy}${mapBase}/${id}/query?where=${where}&outFields=${of}&orderByFields=${encodeURIComponent(oidField)}` +
      `&returnGeometry=true&outSR=4326&returnZ=false&returnM=false&geometryPrecision=6&resultRecordCount=${batch}&f=geojson`;
    const fc = parseJsonOrNull<GeoFC & { features?: Array<GeoFeature & { id?: number }> }>(await browser.evalAsync(sid, fetchTextExpr(url)));
    if (!fc || !Array.isArray(fc.features) || fc.features.length === 0) break;
    features.push(...fc.features);
    let maxOid = lastOid;
    for (const f of fc.features) {
      const oid = Number((f as { id?: number }).id ?? (f.properties?.[oidField] as number | undefined));
      if (Number.isFinite(oid) && oid > maxOid) maxOid = oid;
    }
    if (maxOid <= lastOid || fc.features.length < batch) break; // last page (or no OID progress)
    lastOid = maxOid;
    await sleep(120);
  }
  return features;
}

/**
 * Extract + validate + deposit the GoNet "Zonage municipal" layer for `slug`.
 * Returns a terminal SlugResult (deposited / no-zonage-layer / spatial-fail).
 */
async function processGonetZonage(
  slug: string, muni: MuniEntry | undefined, viewerUrl: string,
  browser: Browser, s3: S3Client | null, args: Args, base: SlugResult,
): Promise<SlugResult> {
  const session = await browser.openSession(viewerUrl, args.navMs + 8_000);
  try {
    const mapBase = gonetMapServerBase(session.requests);
    if (!mapBase) return { ...base, status: "no-zonage-layer", detail: `gonet: aucune requête proxy MapServer captée (session/recaptcha?) @${viewerUrl}` };
    const proxy = gonetProxyBase(session.requests);

    const info = parseJsonOrNull<{ layers?: GoNetLayer[] }>(await browser.evalAsync(session.sid, fetchTextExpr(`${proxy}${mapBase}/?f=json`)));
    const layers = info?.layers ?? [];
    if (layers.length === 0) return { ...base, status: "no-zonage-layer", detail: `gonet: MapServer sans couches lisibles (${mapBase})` };
    const candidates = layers.filter(isGonetZonageLayer);
    if (candidates.length === 0) return { ...base, status: "no-zonage-layer", detail: `gonet MapServer (${layers.length} couches) sans couche 'Zonage municipal'` };

    // Among zonage-named polygon layers, keep the one with a usable zone field AND
    // the most features (scale variants are duplicated; one may be empty).
    let best: { id: number; name: string; zoneField: string; oidField: string; count: number } | null = null;
    for (const c of candidates.slice(0, 8)) {
      const li = parseJsonOrNull<{ fields?: FieldInfo[] }>(await browser.evalAsync(session.sid, fetchTextExpr(`${proxy}${mapBase}/${c.id}?f=json`)));
      const fields = li?.fields ?? [];
      const zoneField = pickGonetZoneField(fields);
      if (!zoneField) continue;
      const oidField = fields.find((f) => /OID/i.test(f.type))?.name ?? "OBJECTID";
      const cnt = parseJsonOrNull<{ count?: number }>(await browser.evalAsync(session.sid, fetchTextExpr(`${proxy}${mapBase}/${c.id}/query?where=1%3D1&returnCountOnly=true&f=json`)));
      const count = cnt?.count ?? 0;
      if (count <= 0) continue;
      if (!best || count > best.count) best = { id: c.id, name: stripGonetPrefix(c.name), zoneField, oidField, count };
    }
    if (!best) return { ...base, status: "no-zonage-layer", detail: `gonet: couche(s) zonage sans champ zone_code exploitable` };

    const layerUrl = `${mapBase}/${best.id}`;
    const raw = await gonetFetchFeatures(browser, session.sid, proxy, mapBase, best.id, best.zoneField, best.oidField);
    if (raw.length === 0) return { ...base, status: "no-zonage-layer", detail: `gonet: couche ${best.name} (${best.count} attendues) téléchargée vide` };
    const norm = normalize(raw, best.zoneField, layerUrl, "obscura-gonet-vector");

    // Spatial gate (projection-free): the WGS84 features' bbox centre must sit near
    // the registry centroid — catches a wrong-muni MapServer or off-QC data.
    let distanceKm: number | undefined;
    if (muni) {
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity, n = 0;
      for (const f of norm) for (const [x, y] of positionsOf(f.geometry?.coordinates)) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; n++;
      }
      if (n > 0) {
        distanceKm = haversineKm(muni.lat, muni.lon, (miny + maxy) / 2, (minx + maxx) / 2);
        if (distanceKm > Math.max(args.spatialKm, 35)) return { ...base, status: "spatial-fail", detail: `gonet spatial KO: features à ${distanceKm.toFixed(0)}km du centroïde (${layerUrl})` };
      }
    }

    const nonNull = norm.filter((f) => f.properties.zone_code !== null).length;
    if (nonNull / norm.length < 0.5) return { ...base, status: "no-zonage-layer", detail: `gonet couche ${best.name}: zone_code null>50% — rejet` };

    base.zonageLayerUrl = layerUrl;
    base.zoneCodeField = best.zoneField;
    base.featureCount = norm.length;
    if (distanceKm !== undefined) base.distanceKm = distanceKm;

    if (args.deposit && s3) {
      const key = `${S3_PREFIX}qc-zonage-${slug}.geojson`;
      const fc: GeoFC = { type: "FeatureCollection", features: norm };
      await putBytes(s3, key, JSON.stringify(fc), "application/geo+json");
      return { ...base, deposited: true, status: "deposited", detail: `${norm.length} zones (${nonNull} avec zone_code, champ ${best.zoneField}) via GoNet ${layerUrl}` };
    }
    return { ...base, status: "deposited", deposited: false, detail: `PROBE OK (non déposé): ${norm.length} zones (champ ${best.zoneField}) via GoNet ${layerUrl}` };
  } finally {
    await browser.closeSession(session.targetId);
  }
}

// ── Traitement d'une ville ────────────────────────────────────────────────────
async function processCity(slug: string, muni: MuniEntry | undefined, browser: Browser, s3: S3Client | null, args: Args): Promise<SlugResult> {
  const site = websiteForSlug(slug) ?? null;
  const base: SlugResult = { slug, site, platforms: [], viewerUrls: [], deposited: false, status: "no-viewer", detail: "" };
  if (!site) return { ...base, status: "no-site", detail: "aucun site dans l'annuaire" };

  const lead = emptyLead();
  const pagesVisited: string[] = [];

  // 1) home + carto sub-pages, headless, capture DOM + network.
  const dbg = process.env["OBSCURA_DEBUG"] ? (m: string) => console.error(`   · ${slug} ${m} @${Date.now() % 100000}`) : () => {};
  dbg("visit home");
  const home = await browser.visit(site, args.navMs);
  dbg(`home done dom=${home.dom.length} reqs=${home.requests.length}`);
  pagesVisited.push(site);
  harvestLeads(home.dom, lead);
  for (const u of home.requests) harvestLeads(u, lead);
  const carto = cartoLinks(home.dom, site);
  dbg(`carto links=${carto.length}`);
  for (const link of carto.slice(0, args.maxCarto)) {
    dbg(`visit carto ${link}`);
    const v = await browser.visit(link, args.navMs);
    dbg(`carto done dom=${v.dom.length} reqs=${v.requests.length}`);
    pagesVisited.push(link);
    harvestLeads(v.dom, lead);
    for (const u of v.requests) harvestLeads(u, lead);
  }
  dbg(`leads items=${lead.arcgisItems.size} svc=${lead.arcgisServices.size} orgs=${lead.arcgisOrgs.size} goaz=${lead.goazimut.size}`);

  // 2) For ArcGIS viewer item-ids found in carto pages, RENDER the viewer too —
  //    a webappviewer fires the sharing item-data + FeatureServer queries.
  const viewerUrls: string[] = [];
  for (const dom of [home.dom]) {
    for (const m of dom.matchAll(/https?:\/\/[^\s"'<>]*?(?:maps\.arcgis\.com\/apps|experience\.arcgis\.com|arcgis\.com\/apps)[^\s"'<>]*/gi)) viewerUrls.push(m[0].replace(/&amp;/g, "&"));
  }
  // also from carto page DOMs we already harvested item-ids; render first viewer to capture FS queries.
  const firstViewer = viewerUrls[0];
  if (firstViewer) {
    const vv = await browser.visit(firstViewer, args.navMs + 4_000);
    for (const u of vv.requests) harvestLeads(u, lead);
  }

  // Determine platforms present.
  const platforms: Platform[] = [];
  if (lead.arcgisItems.size || lead.arcgisServices.size || lead.arcgisOrgs.size) platforms.push("arcgis");
  if (lead.goazimut.size) platforms.push("goazimut");
  if (lead.jmap.size) platforms.push("jmap");
  if (lead.igo.size) platforms.push("igo");
  if (lead.wfs.size) platforms.push("wfs");
  if (platforms.length === 0) platforms.push("none");
  base.platforms = platforms;
  base.viewerUrls = [...new Set(viewerUrls)].slice(0, 4);

  // 2b) GoNet/GoAzimut (PG Solutions GOnet6): zonage = ArcGIS MapServer servi via
  //     un proxy in-session. Rend le viewer, interroge la couche "Zonage municipal"
  //     in-page, dépose. Terminal si dépôt ; sinon on retombe sur l'ArcGIS si présent.
  if (platforms.includes("goazimut")) {
    const viewer = gonetViewerUrl(lead.goazimut);
    dbg(`gonet viewer=${viewer ?? "n/a"}`);
    if (viewer) {
      const g = await processGonetZonage(slug, muni, viewer, browser, s3, args, base);
      if (g.deposited || g.status === "deposited") return g;
      if (!platforms.includes("arcgis")) return g; // gonet-only → classement gonet terminal
      base.detail = g.detail; // garde la note gonet si l'ArcGIS échoue aussi
    } else if (!platforms.includes("arcgis")) {
      return { ...base, status: "no-zonage-layer", detail: "goazimut détecté mais aucun municode GOnet capté" };
    }
  }

  // 3) Resolve ArcGIS leads → candidate zonage layers.
  const orgs = new Set<string>(lead.arcgisOrgs);
  const services = new Set<string>(lead.arcgisServices);
  for (const itemId of lead.arcgisItems) {
    const layers = await resolveItemLayers(null, itemId);
    for (const l of layers) if (/FeatureServer|MapServer/i.test(l.url)) services.add(l.url.replace(/\/\d+$/, ""));
  }
  // Harvest org ids from every resolved service URL (a webmap reveals its org).
  for (const svc of services) { ORG_RE.lastIndex = 0; const m = ORG_RE.exec(svc); if (m) orgs.add(m[1]!); }
  // Org catalog enumeration: the zonage service may exist in the org but NOT be
  // wired into the "cartographie interactive" webmap. This is the NEW signal
  // obscura adds over the static AGOL keyword/domain detector.
  for (const org of orgs) for (const l of await orgZonageServices(org)) services.add(l.url);
  dbg(`services=${services.size} orgs=${[...orgs].join(",")}`);

  if (services.size === 0) {
    if (platforms.includes("arcgis")) return { ...base, status: "matrice-only", detail: `arcgis détecté mais aucun FeatureServer zonage (items=${lead.arcgisItems.size} orgs=${[...orgs].join(",")})` };
    if (!platforms.includes("none")) return { ...base, status: "platform-not-arcgis", detail: `plateforme(s)=${platforms.join(",")} — extraction non-arcgis non implémentée` };
    return { ...base, status: "no-viewer", detail: `aucun lead backend (pages: ${pagesVisited.length})` };
  }

  // 4) Probe each service for a real zonage layer; validate + deposit.
  const dep = await depositFromServices(slug, muni, services, s3, args, base);
  if (dep) return dep;
  if (platforms.includes("arcgis")) return { ...base, status: "no-zonage-layer", detail: `services arcgis trouvés (${services.size}) mais aucune couche zonage valide` };
  return { ...base, status: "no-zonage-layer", detail: "aucune couche zonage exploitable" };
}

/**
 * Probe a set of ArcGIS service URLs for a real zonage layer for `slug`, then
 * validate (zone_code non-null ≥50%, spatial gate, aggregate→muni filter) and
 * deposit. Returns a terminal SlugResult on success/explicit rejection, or null
 * if no service yielded a usable zonage layer (caller decides the fall-through).
 */
async function depositFromServices(
  slug: string, muni: MuniEntry | undefined, services: Iterable<string>,
  s3: S3Client | null, args: Args, base: SlugResult,
): Promise<SlugResult | null> {
  for (const svc of services) {
    const probe = await probeServiceForZonage(svc);
    if (!probe) continue;

    // Build where-clause. Aggregate detection is projection-independent: a layer
    // is an AGGREGATE iff its muni field carries ≥2 distinct canonical slugs.
    // (The extent reprojection can't be trusted — MRC layers are often in a QC
    // projection extentCenterWgs84 can't convert.)
    let where = "1=1";
    let isAggregate = false;
    if (probe.muniField && muni) {
      const sample = await fetchJson<{ features?: Array<{ attributes: Record<string, unknown> }> }>(`${probe.layerUrl}/query?where=1%3D1&outFields=${encodeURIComponent(probe.muniField)}&returnDistinctValues=true&resultRecordCount=600&f=json`);
      const distinct = new Map<string, string>(); // canonicalSlug → raw value
      for (const ft of sample?.features ?? []) {
        const v = ft.attributes?.[probe.muniField];
        if (v == null || String(v).trim() === "") continue;
        distinct.set(toSlug(stripAdminPrefix(String(v))), String(v));
      }
      if (distinct.size >= 2) {
        isAggregate = true;
        const matched = distinct.get(slug);
        if (!matched) continue; // muni not present in this MRC layer → skip
        where = `${probe.muniField}='${matched.replace(/'/g, "''")}'`;
      } else if (distinct.size === 1 && !distinct.has(slug)) {
        continue; // mono-muni layer for a DIFFERENT muni → skip
      }
    }

    const outFields = probe.muniField ? `${probe.zoneField},${probe.muniField}` : probe.zoneField;
    const raw = await fetchFeatures(probe.layerUrl, outFields, where);
    if (raw.length === 0) continue;
    const norm = normalize(raw, probe.zoneField, probe.layerUrl);

    // Spatial gate on the RETURNED WGS84 features (outSR=4326) — projection-free
    // anti-faux-positif: the features' bbox centre must sit near the registry
    // centroid. Catches a wrong muni-name match or a non-QC layer.
    let distanceKm: number | undefined;
    if (muni) {
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity, n = 0;
      for (const f of norm) for (const [x, y] of positionsOf(f.geometry?.coordinates)) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; n++;
      }
      if (n > 0) {
        distanceKm = haversineKm(muni.lat, muni.lon, (miny + maxy) / 2, (minx + maxx) / 2);
        if (distanceKm > Math.max(args.spatialKm, 35)) { base.detail = `spatial KO: features à ${distanceKm.toFixed(0)}km du centroïde`; continue; }
      }
    }

    const nonNull = norm.filter((f) => f.properties.zone_code !== null).length;
    if (nonNull / norm.length < 0.5) { base.detail = `couche ${probe.layerUrl}: zone_code null>50% — rejet`; continue; }

    base.zonageLayerUrl = probe.layerUrl;
    base.zoneCodeField = probe.zoneField;
    base.featureCount = norm.length;
    if (distanceKm !== undefined) base.distanceKm = distanceKm;

    if (args.deposit && s3) {
      const key = `${S3_PREFIX}qc-zonage-${slug}.geojson`;
      const fc: GeoFC = { type: "FeatureCollection", features: norm };
      await putBytes(s3, key, JSON.stringify(fc), "application/geo+json");
      return { ...base, deposited: true, status: "deposited", detail: `${norm.length} zones (${nonNull} avec zone_code) via ${probe.layerUrl}${isAggregate ? " [MRC filtré]" : ""}` };
    }
    return { ...base, status: "deposited", deposited: false, detail: `PROBE OK (non déposé): ${norm.length} zones via ${probe.layerUrl}` };
  }
  return null;
}

/**
 * Org-seeded mode (the SCALABLE path): given a known ArcGIS hosted-org id or an
 * explicit service URL, deposit the per-muni zonage for `slug` WITHOUT crawling
 * the municipal site. Discover-once-deposit-many: one MRC org covers N munis.
 */
async function processCityFromSeed(
  slug: string, muni: MuniEntry | undefined, seedServices: string[], seedOrgs: string[],
  s3: S3Client | null, args: Args,
): Promise<SlugResult> {
  const base: SlugResult = { slug, site: websiteForSlug(slug) ?? null, platforms: ["arcgis"], viewerUrls: [], deposited: false, status: "no-zonage-layer", detail: "" };
  const services = new Set<string>(seedServices);
  for (const org of seedOrgs) for (const l of await orgZonageServices(org)) services.add(l.url);
  if (services.size === 0) return { ...base, status: "no-zonage-layer", detail: "seed sans service zonage" };
  const dep = await depositFromServices(slug, muni, services, s3, args, base);
  if (dep) return dep;
  return { ...base, status: "no-zonage-layer", detail: `seed: aucune couche zonage valide pour ${slug}` };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.slugs.length === 0 && args.gonetSeeds.length === 0) { console.error("usage: --slugs a,b,c [--deposit] [--max-carto N] [--nav-ms MS]  |  --gonet slug=municode,..."); process.exit(2); }

  const chrome = resolveChrome();
  if (!chrome) { console.error("[obscura] AUCUN binaire Chromium — abandon"); process.exit(1); }
  console.error(`[obscura] chromium=${chrome} slugs=${args.slugs.length} gonetSeeds=${args.gonetSeeds.length} deposit=${args.deposit}`);

  const munis = JSON.parse(readFileSync(MUNIS_PATH, "utf8")) as MuniEntry[];
  const bySlug = new Map(munis.map((m) => [m.slug, m]));
  const s3 = args.deposit ? s3Client() : null;
  const seeded = args.services.length > 0 || args.orgs.length > 0;

  const results: SlugResult[] = [];
  // GoNet-seeded mode: needs Chromium (the GOnet6 zonage MapServer is reachable
  // only via the viewer's in-session proxy) but skips the municipal-site crawl.
  if (args.gonetSeeds.length > 0) {
    console.error(`[obscura] GONET-SEEDED mode pairs=${args.gonetSeeds.map((s) => `${s.slug}=${s.code}`).join(",")}`);
    const browser = await Browser.launch(chrome);
    try {
      for (let i = 0; i < args.gonetSeeds.length; i++) {
        const { slug, code } = args.gonetSeeds[i]!;
        const viewer = `https://www.goazimut.com/GOnet6/?m=${code}&pl=1`;
        const seedBase: SlugResult = { slug, site: websiteForSlug(slug) ?? null, platforms: ["goazimut"], viewerUrls: [viewer], deposited: false, status: "no-zonage-layer", detail: "" };
        let r: SlugResult;
        try { r = await processGonetZonage(slug, bySlug.get(slug), viewer, browser, s3, args, seedBase); }
        catch (e) { r = { ...seedBase, status: "error", detail: e instanceof Error ? e.message : String(e) }; }
        results.push(r);
        console.error(`[${i + 1}/${args.gonetSeeds.length}] ${r.status.padEnd(18)} ${slug} (m=${code}) :: ${r.detail}`);
      }
    } finally {
      browser.close();
    }
  } else if (seeded) {
    console.error(`[obscura] SEEDED mode services=[${args.services.join(",")}] orgs=[${args.orgs.join(",")}]`);
    for (let i = 0; i < args.slugs.length; i++) {
      const slug = args.slugs[i]!;
      let r: SlugResult;
      try { r = await processCityFromSeed(slug, bySlug.get(slug), args.services, args.orgs, s3, args); }
      catch (e) { r = { slug, site: websiteForSlug(slug) ?? null, platforms: ["arcgis"], viewerUrls: [], deposited: false, status: "error", detail: e instanceof Error ? e.message : String(e) }; }
      results.push(r);
      console.error(`[${i + 1}/${args.slugs.length}] ${r.status.padEnd(18)} ${slug} :: ${r.detail}`);
    }
  } else {
    const browser = await Browser.launch(chrome);
    try {
      for (let i = 0; i < args.slugs.length; i++) {
        const slug = args.slugs[i]!;
        let r: SlugResult;
        try { r = await processCity(slug, bySlug.get(slug), browser, s3, args); }
        catch (e) { r = { slug, site: websiteForSlug(slug) ?? null, platforms: [], viewerUrls: [], deposited: false, status: "error", detail: e instanceof Error ? e.message : String(e) }; }
        results.push(r);
        console.error(`[${i + 1}/${args.slugs.length}] ${r.status.padEnd(18)} ${slug} :: platforms=[${r.platforms.join(",")}] ${r.detail}`);
      }
    } finally {
      browser.close();
    }
  }

  const byStatus: Record<string, number> = {};
  for (const r of results) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const deposited = results.filter((r) => r.deposited).map((r) => r.slug);

  const report = { generatedAt: new Date().toISOString(), deposit: args.deposit, byStatus, deposited, results };
  const out = args.outFile ?? resolve(HERE, "../../work/delegation-mass/zones-obscura-report.json");
  writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  console.error(`\n=== STATUS ${JSON.stringify(byStatus)}`);
  console.error(`déposés=${deposited.length} [${deposited.join(",")}]`);
  console.error(`rapport → ${out}`);
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
