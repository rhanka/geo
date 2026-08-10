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
import {
  capturedFetch,
  capturedText,
  type CaptureFetchLike,
  type CaptureHttpResponse,
  type CaptureManifestLine,
  type CaptureRequestInit,
  type CaptureRun,
} from "../../packages/qc-sources/src/capture/index.js";
import { CAPTURE_USER_AGENT, openCaptureRun } from "./lib/capture-s3.js";
import { copyObject, exists, getBytes, s3Client } from "./lib/s3.js";
import { reapplyServedZonageEnrichment } from "./lib/reapply-zonage-enrichment.js";
import {
  attachGeometryProof,
  carryForwardServedZoneProperties,
  GEOMETRY_GRAIN_FIELD,
  type GeometryGrain,
  type GeometrySourceProof,
  proofFromCaptureEntry,
  putServedZoneAdditive,
  putServedZoneGeojson,
} from "./lib/zonage-proof.js";
import { websiteForSlug } from "../../packages/geo-sources-americas/ca-qc/municipalities/municipal-directory.js";
// Réutilise le validateur de codes-zone value-based (agnostique du NOM de champ)
// déjà éprouvé côté WFS : signature code (CODE_PATTERN_RE), ratio non-null, rejet
// séquentiel/OBJECTID/champ technique. Sert de GATE quand un --zone-field explicite
// bypasse l'auto-picker (l'opérateur choisit le champ ; les VALEURS sont validées).
import { zoneCodeStats, type ZoneCodeStats } from "./zones-wfs-run.js";

// ── Constantes ────────────────────────────────────────────────────────────────
const HERE = dirname(fileURLToPath(import.meta.url));
const MUNIS_PATH = resolve(HERE, "../../packages/qc-sources/src/geo/municipalities.qc.json");
const COVERAGE_MATRIX_PATH = resolve(HERE, "../../work/coverage/coverage-matrix.json");
// Répertoire MAMH: slug → mamhCode (code géographique officiel). Crosswalk
// AUTORITATIF pour les agrégats discriminés par un code muni numérique
// (ex. Zonage_MRC_Témiscouata_vue.CODE_MUN). Jamais deviné : source MAMH.
const MUNI_DIRECTORY_PATH = resolve(HERE, "../../packages/qc-sources/src/geo/qc-municipal-directory.json");
const S3_PREFIX = "normalized/ca-qc-zonage/";
const REAL_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const HTTP_UA = CAPTURE_USER_AGENT;
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
// Decision (user): when a zonage layer carries BOTH a usage-label field
// (e.g. `Zonage` = "Habitation") AND a real zone-identifier field
// (`code`/`no_zone`/`num_zone`/…), prefer the code field. These are the
// code-like names checked first by pickGonetZoneField, ahead of the broader set.
const ZONE_CODE_FIELD_CODELIKE = [
  /^zone_?code$/i, /^num_?zone$/i, /^no_?zone$/i, /^code_?zone$/i,
  /^codezonage$/i, /^no_zonage$/i, /^zone_?id$/i, /^code$/i, /^zonagemunicipalid$/i,
];
const ZONAGE_TITLE_PATTERNS = [/\bzonage\b/i, /\bzoning\b/i, /\bzones?\b/i, /grille.*zone/i, /regl.*zone/i];
const AFFECTATION_TITLE_PATTERNS = [/\baffectation\b/i, /milieu.*humide/i, /\bpiia\b/i, /inondab/i, /patrimo/i, /contrainte/i];

// Certaines munis QC codent leurs zones en NUMÉRIQUE pur (ex. "512","402" ; le
// 1er chiffre = classe d'usage). Le gate value-based (`codeLikeRatio`/`pureIntRatio`)
// les prend à tort pour un champ décoy/cadastre et les rejette. Discriminant sûr =
// autorité du NOM DE CHAMP (identifiant de zone) + TITRE de couche « zonage » +
// cardinalité bornée (un cadastre/rôle porte des MILLIERS de lots distincts). Sous
// ces trois gardes, les valeurs numériques SONT du zonage → bypass des deux gates
// de forme uniquement (les gardes bbox/attribution/contamination restent actives).
export const NUMERIC_ZONAGE_MAX_DISTINCT = 500;
export function isNumericZonageBypass(zoneField: string, layerTitle: string, distinct: number): boolean {
  const field = (zoneField ?? "").trim();
  const title = (layerTitle ?? "").trim();
  const fieldIsZoneId = ZONE_CODE_FIELD_CODELIKE.some((re) => re.test(field));
  const titleIsZonage = ZONAGE_TITLE_PATTERNS.some((re) => re.test(title));
  const titleIsAffectation = AFFECTATION_TITLE_PATTERNS.some((re) => re.test(title));
  return fieldIsZoneId && titleIsZonage && !titleIsAffectation
    && distinct >= 3 && distinct <= NUMERIC_ZONAGE_MAX_DISTINCT;
}

// Attributs municipalité dans les couches MRC agrégées.
const MUNI_ATTR_CANDIDATES = [
  "mun_nom", "MuniTopo", "municipalite", "Municipalite", "MUNICIPALITE", "NOM_MUN",
  "nom_mun", "NOMMUN", "Municipali", "MUNICIPALI", "muni_nom", "nom_muni", "NomMuni",
  "MUNICIPALITY", "municipality", "VILLE", "Ville", "nom_ville", "MUS_NM_MUN",
];

// Crosswalk MAMH chargé une fois (single-process) : code géographique → slug, +
// l'ensemble des slugs canoniques du registre. Peuplé par loadMuniCrosswalk()
// avant tout traitement. Sert la résolution du discriminant muni des agrégats.
let MUNI_CODE_TO_SLUG = new Map<string, string>();
let MUNI_SLUG_SET = new Set<string>();

// ── Types ─────────────────────────────────────────────────────────────────────
interface MuniEntry { slug: string; name: string; mrc: string | null; lat: number; lon: number }
interface GeoFeature { type: "Feature"; geometry: { type: string; coordinates: unknown } | null; properties: Record<string, unknown> }
interface GeoFC { type: "FeatureCollection"; features: GeoFeature[]; exceededTransferLimit?: boolean }

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
  servedBefore?: ServedAudit[];
  servedAfter?: ServedAudit[];
  deposited: boolean;
  status: "deposited" | "no-zonage-layer" | "matrice-only" | "no-viewer" | "spatial-fail" | "platform-not-arcgis" | "no-site" | "error";
  detail: string;
  captureReport?: GonetCaptureReport;
}

interface ServedAudit {
  key: string;
  features: number;
  propertyKeys: string[];
  populatedProperties: number;
  zoneSourceUrls: string[];
  zoneSourceLevels: string[];
}

interface CapturedFeatures {
  features: GeoFeature[];
  entry: CaptureManifestLine;
  paginated: boolean;
}

interface GonetCaptureReport {
  slug: string;
  source_url_reelle: string | null;
  retrieved_at: string | null;
  sha256_octets: string | null;
  n_features: number;
  codes_distinct: number;
  lettered_pct: number;
  integer_pure_pct: number;
  bbox_diag_km: number | null;
  nearest_registre_muni: string | null;
  nearest_km: number | null;
  verdict: string;
}

/** A deposited v2 source must be a manifest entry, never a reconstructed body. */
export function proofFromGonetCapture(entry: CaptureManifestLine) {
  return proofFromCaptureEntry(entry, { type: "geonet", method: "natif", reliability: "directe" });
}

let CAPTURE: CaptureRun | null = null;

// ── Args ──────────────────────────────────────────────────────────────────────
interface GonetSeed { slug: string; code: string }
interface Args { slugs: string[]; deposit: boolean; maxCarto: number; navMs: number; spatialKm: number; services: string[]; orgs: string[]; gonetSeeds: GonetSeed[]; gonetMrcs: string[]; zoneField?: string; muniField?: string; outFile?: string }
function parseArgs(argv: string[]): Args {
  const get = (k: string): string | undefined => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const has = (k: string) => argv.includes(`--${k}`);
  const csv = (k: string): string[] => (get(k) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const zoneField = get("zone-field")?.trim();
  const muniField = get("muni-field")?.trim();
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
    // Field-picker overrides (--service mode): quand fournis, bypassent l'auto
    // field-picker qui se trompe sur les agrégats MRC portant un champ décoy
    // (affectation TYPE_ZONE, préfixe catégorie ZONE_). L'opérateur nomme le champ
    // code-zone RÉEL (ex. ZONE=C-1, Sect=R-20) et le discriminant muni (CODE_MUN
    // code MAMH, MUN nom). Les VALEURS restent validées (anti-invention).
    ...(zoneField ? { zoneField } : {}),
    ...(muniField ? { muniField } : {}),
    // GoNet-seeded mode (discover-once-deposit-many): skip the site crawl and go
    // straight to the GOnet6 viewer for a known municode. Format: slug=municode.
    gonetSeeds: csv("gonet").map((pair) => { const [slug, code] = pair.split("="); return { slug: (slug ?? "").trim(), code: (code ?? "").trim() }; }).filter((s) => s.slug && /^\d{4,5}$/.test(s.code)),
    // GoNet MRC mode: derive slug=municode seeds from the committed MAMH directory
    // and the read-only coverage matrix. Only zones!=done slugs are targeted.
    gonetMrcs: csv("gonet-mrc"),
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

interface FeatureBbox {
  minx: number;
  miny: number;
  maxx: number;
  maxy: number;
}

function featureBbox(features: GeoFeature[]): FeatureBbox | null {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const feature of features) {
    for (const [x, y] of positionsOf(feature.geometry?.coordinates)) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
    }
  }
  if (![minx, miny, maxx, maxy].every(Number.isFinite)) return null;
  return { minx, miny, maxx, maxy };
}

function noVectorCaptureReport(slug: string, entry?: CaptureManifestLine, verdict = "NO_VECTOR"): GonetCaptureReport {
  return {
    slug,
    source_url_reelle: entry?.url ?? null,
    retrieved_at: entry?.retrieved_at ?? null,
    sha256_octets: entry?.sha256?.replace(/^sha256:/, "") ?? null,
    n_features: 0,
    codes_distinct: 0,
    lettered_pct: 0,
    integer_pure_pct: 100,
    bbox_diag_km: null,
    nearest_registre_muni: null,
    nearest_km: null,
    verdict,
  };
}

function captureVerdictCounts(reports: GonetCaptureReport[]): Record<string, number> {
  const counts: Record<string, number> = { PASS_CAPTURE: 0, PASS_CAPTURE_NUMERIC: 0, REJECT: 0, NO_VECTOR: 0 };
  for (const report of reports) {
    if (report.verdict === "PASS_CAPTURE") counts.PASS_CAPTURE++;
    else if (report.verdict === "PASS_CAPTURE_NUMERIC") counts.PASS_CAPTURE_NUMERIC++;
    else if (report.verdict === "NO_VECTOR") counts.NO_VECTOR++;
    else if (report.verdict.startsWith("REJECT_")) counts.REJECT++;
  }
  return counts;
}

function captureReportMarkdown(reports: GonetCaptureReport[], runId: string): string {
  const counts = captureVerdictCounts(reports);
  const rows = reports.map((r) =>
    `| ${r.slug} | ${r.verdict} | ${r.n_features} | ${r.codes_distinct} | ${r.lettered_pct.toFixed(1)}% | ${r.integer_pure_pct.toFixed(1)}% | ${r.bbox_diag_km === null ? "—" : r.bbox_diag_km.toFixed(2)} | ${r.nearest_registre_muni ?? "—"} | ${r.nearest_km === null ? "—" : r.nearest_km.toFixed(2)} |`,
  );
  return [
    "# Capture GOnet — rapport de gate",
    "",
    `Run capture : \`${runId}\``,
    "",
    `Verdicts : PASS_CAPTURE=${counts.PASS_CAPTURE}, REJECT=${counts.REJECT}, NO_VECTOR=${counts.NO_VECTOR}`,
    "",
    "| slug | verdict | features | codes | lettrés | entiers purs | diagonale km | muni registre la plus proche | distance km |",
    "|---|---|---:|---:|---:|---:|---:|---|---:|",
    ...rows,
    "",
  ].join("\n");
}

function buildGonetCaptureReport(
  slug: string,
  target: MuniEntry | undefined,
  registry: MuniEntry[],
  entry: CaptureManifestLine,
  features: GeoFeature[],
  paginated: boolean,
  zoneField: string,
  layerTitle: string,
): GonetCaptureReport {
  const stats = zoneCodeStats(features as never, zoneField);
  const numericZonage = isNumericZonageBypass(zoneField, layerTitle, stats.distinct);
  const bbox = featureBbox(features);
  const center = bbox === null ? null : { lat: (bbox.miny + bbox.maxy) / 2, lon: (bbox.minx + bbox.maxx) / 2 };
  let nearest: { slug: string; km: number } | null = null;
  if (center !== null) {
    for (const muni of registry) {
      const km = haversineKm(muni.lat, muni.lon, center.lat, center.lon);
      if (nearest === null || km < nearest.km) nearest = { slug: muni.slug, km };
    }
  }

  let verdict = numericZonage ? "PASS_CAPTURE_NUMERIC" : "PASS_CAPTURE";
  if (paginated) verdict = "REJECT_PAGINATED_RESPONSE";
  else if (stats.distinct < 3) verdict = "REJECT_CODES_DISTINCT_LT3";
  else if (!numericZonage && stats.codeLikeRatio < 0.5) verdict = "REJECT_LETTERED_LT50_PCT";
  else if (!numericZonage && stats.pureIntRatio > 0.8) verdict = "REJECT_INTEGER_PURE_GT80_PCT";
  else if (stats.maxLen > 24) verdict = "REJECT_MAXLEN_GT24";
  else if (bbox === null) verdict = "REJECT_NO_GEOMETRY";
  else if (haversineKm(bbox.miny, bbox.minx, bbox.maxy, bbox.maxx) > 35) verdict = "REJECT_BBOX_DIAG_GT35KM";
  else if (nearest === null) verdict = "REJECT_NO_REGISTRE_NEAREST";
  else if (target !== undefined && nearest.slug !== target.slug) verdict = "REJECT_MUNI_CONTAMINATION";
  else if (nearest !== null && nearest.km > 8) verdict = "REJECT_NEAREST_GT8KM";

  return {
    slug,
    source_url_reelle: entry.url,
    retrieved_at: entry.retrieved_at,
    sha256_octets: entry.sha256?.replace(/^sha256:/, "") ?? null,
    n_features: features.length,
    codes_distinct: stats.distinct,
    lettered_pct: stats.codeLikeRatio * 100,
    integer_pure_pct: stats.pureIntRatio * 100,
    bbox_diag_km: bbox === null ? null : haversineKm(bbox.miny, bbox.minx, bbox.maxy, bbox.maxx),
    nearest_registre_muni: nearest?.slug ?? null,
    nearest_km: nearest?.km ?? null,
    verdict,
  };
}

async function capturedArcgisJson<T = unknown>(
  url: string,
  slugs: string[] = [],
  timeoutMs = HTTP_TIMEOUT_MS,
): Promise<{ value: T; entry: CaptureManifestLine } | null> {
  if (!CAPTURE) throw new Error("zones-obscura fetchJson called without an open capture run");
  try {
    const captured = await capturedFetch(url, {
      headers: { "user-agent": HTTP_UA, accept: "application/json" },
    }, {
      run: CAPTURE,
      lane: "zones",
      source: "zones-obscura-arcgis",
      slugs,
      timeoutMs,
    });
    if (!captured.ok) return null;
    return { value: JSON.parse(capturedText(captured)) as T, entry: captured.line };
  } catch { return null; }
}

async function fetchJson<T = unknown>(url: string, timeoutMs = HTTP_TIMEOUT_MS): Promise<T | null> {
  return (await capturedArcgisJson<T>(url, [], timeoutMs))?.value ?? null;
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
    // Port 0 → chromium picks a free ephemeral port (the real one is written to
    // <profile>/DevToolsActivePort). Avoids cross-process collisions when several
    // sweep lanes spawn chromium in parallel (random fixed ports collided → rc=1).
    const profile = mkdtempSync(join(tmpdir(), "zones-obscura-"));
    // Optional egress proxy (e.g. Tor SOCKS) so the browser's public IP is not the
    // datacenter pod IP — goazimut/reCAPTCHA blocks datacenter ranges. Set
    // CHROME_PROXY=socks5://127.0.0.1:9050 in the pod after starting tor.
    const proxy = process.env.CHROME_PROXY;
    const chromeArgs = [
      "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
      "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions",
      `--remote-debugging-port=0`, `--user-data-dir=${profile}`,
      ...(proxy ? [`--proxy-server=${proxy}`, "--proxy-bypass-list=127.0.0.1,localhost"] : []),
      "about:blank",
    ];
    const proc = spawn(chrome, chromeArgs, { stdio: ["ignore", "ignore", "ignore"] });
    const b = new Browser(proc, profile, 0);
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

  /**
   * Adapt the browser's authenticated GoNet session to the capture chokepoint.
   * The response body crosses CDP as base64, so the Uint8Array handed to
   * `capturedFetch` is exactly the body read by `Response.arrayBuffer()` — never
   * a JSON re-serialization of parsed features.
   */
  sessionFetch(sid: string): CaptureFetchLike {
    return async (url: string, init?: CaptureRequestInit): Promise<CaptureHttpResponse> => {
      if (init?.body instanceof Uint8Array) {
        throw new Error("GoNet session fetch does not support binary request bodies");
      }
      const headers = Object.fromEntries(
        Object.entries(init?.headers ?? {}).filter(([name]) => name.toLowerCase() !== "user-agent"),
      );
      const request = {
        url,
        method: init?.method ?? "GET",
        headers,
        ...(typeof init?.body === "string" ? { body: init.body } : {}),
      };
      const expr = `(async()=>{
        const toBase64=(bytes)=>{let out="";for(let i=0;i<bytes.length;i+=32768){out+=String.fromCharCode(...bytes.subarray(i,i+32768));}return btoa(out);};
        try {
          const req=${JSON.stringify(request)};
          const r=await fetch(req.url,{method:req.method,headers:req.headers,body:req.body,redirect:"manual",credentials:"include"});
          const headers={};r.headers.forEach((value,key)=>{headers[key]=value;});
          const body=toBase64(new Uint8Array(await r.arrayBuffer()));
          return JSON.stringify({status:r.status,url:r.url,headers,body});
        } catch (e) { return JSON.stringify({error:String((e&&e.message)||e)}); }
      })()`;
      const text = await this.evalAsync(sid, expr);
      if (!text) throw new Error("GoNet session fetch did not return a response");
      let payload: { status?: unknown; url?: unknown; headers?: unknown; body?: unknown; error?: unknown };
      try { payload = JSON.parse(text) as typeof payload; }
      catch { throw new Error("GoNet session fetch returned invalid CDP JSON"); }
      if (payload.error) throw new Error(`GoNet session fetch: ${String(payload.error)}`);
      if (typeof payload.status !== "number" || typeof payload.body !== "string") {
        throw new Error("GoNet session fetch returned an incomplete response");
      }
      const values = new Map<string, string>();
      if (payload.headers && typeof payload.headers === "object") {
        for (const [name, value] of Object.entries(payload.headers as Record<string, unknown>)) {
          if (typeof value === "string") values.set(name.toLowerCase(), value);
        }
      }
      const bytes = new Uint8Array(Buffer.from(payload.body, "base64"));
      return {
        status: payload.status,
        ok: payload.status >= 200 && payload.status < 300,
        ...(typeof payload.url === "string" ? { url: payload.url } : {}),
        headers: { get: (name: string): string | null => values.get(name.toLowerCase()) ?? null },
        arrayBuffer: async (): Promise<ArrayBuffer> => {
          const copy = new Uint8Array(bytes.byteLength);
          copy.set(bytes);
          return copy.buffer;
        },
      };
    };
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

// ── Overrides de champs (--zone-field / --muni-field, mode --service) ─────────
/** Normalise un code muni brut (trim + retire un suffixe décimal ArcGIS). */
export function normMuniCode(v: unknown): string {
  return String(v).trim().replace(/\.0+$/, "");
}
/** Un discriminant muni "code" est purement numérique (ex CODE_MUN=13005). */
export function isNumericMuniValue(raw: string): boolean {
  return /^\d+(\.0+)?$/.test(raw.trim());
}
/**
 * Résout une valeur brute de discriminant muni en slug canonique, en réutilisant
 * la logique de disaggregate-zonage.ts :
 *   - NUMÉRIQUE → crosswalk MAMH (codeToSlug) ; jamais deviné, null si absent.
 *   - NOM → slug du NOM COMPLET s'il existe au registre (distingue "Canton de X"
 *     de "Ville de X", qui s'effondreraient tous deux en "x" après strip-préfixe),
 *     sinon slug du nom sans préfixe administratif seulement s'il existe au
 *     registre; sans match registre, null.
 */
export function resolveMuniValueToSlug(
  raw: string, codeToSlug: Map<string, string>, slugSet: Set<string>,
): string | null {
  const t = raw.trim();
  if (t === "") return null;
  if (isNumericMuniValue(t)) return codeToSlug.get(normMuniCode(t)) ?? null;
  const full = toSlug(t);
  if (slugSet.has(full)) return full;
  const stripped = toSlug(stripAdminPrefix(t));
  return slugSet.has(stripped) ? stripped : null;
}
/**
 * Variante cible-aware pour les agrégats où le backend sert seulement le nom
 * municipal court, alors que le registre local désambiguïse le slug par MRC
 * (`saint-sebastien--le-granit`, etc.). Le fallback ne s'applique que si la
 * valeur brute égale le nom officiel de la cible après normalisation; le gate
 * spatial valide ensuite que les features retournées sont bien sur la cible.
 */
export function resolveMuniValueToTargetSlug(
  raw: string, target: MuniEntry | undefined, codeToSlug: Map<string, string>, slugSet: Set<string>,
): string | null {
  const resolved = resolveMuniValueToSlug(raw, codeToSlug, slugSet);
  if (resolved) return resolved;
  if (!target) return null;
  const rawName = toSlug(stripAdminPrefix(raw));
  const targetName = toSlug(stripAdminPrefix(target.name));
  return rawName && rawName === targetName ? target.slug : null;
}
/**
 * Clause WHERE ArcGIS pour un discriminant muni. Un code numérique se compare
 * NON-QUOTÉ sur un champ numérique (ex. CODE_MUN entier de Témis), mais un champ
 * de type STRING portant ce même code numérique (ex. Antoine-Labelle `code`='79088',
 * esriFieldTypeString) EXIGE des quotes — sinon ArcGIS renvoie HTTP 400 et 0 feature.
 * `fieldIsString` (issu du type esri du champ) force donc le quotage même pour un
 * code numérique. Un nom est toujours quoté.
 */
export function muniWhereClause(field: string, rawValue: string, fieldIsString = false): string {
  const numeric = isNumericMuniValue(rawValue);
  if (numeric && !fieldIsString) return `${field}=${normMuniCode(rawValue)}`;
  const v = numeric ? normMuniCode(rawValue) : rawValue;
  return `${field}='${v.replace(/'/g, "''")}'`;
}
/**
 * GATE anti-invention pour un --zone-field EXPLICITE (bypass de l'auto-picker).
 * Value-based (agnostique du NOM du champ, puisque l'opérateur l'a choisi) : le
 * champ ne doit pas être technique (OBJECTID/shape/matricule/code_mun…), les
 * VALEURS doivent être de vrais codes-zone — ≥50% non-null, ≥3 codes distincts,
 * ≥50% à signature code (lettre(s)+chiffre, ex C-1/R-20/EAA-3), ≤24 char, et PAS
 * une suite d'entiers séquentiels. Rejette ainsi une affectation (TYPE_ZONE,
 * "Habitation"), un préfixe catégorie nu (ZONE_ = R/C/I/P), ou un id technique.
 */
export function validateExplicitZoneField(
  features: Array<{ properties: Record<string, unknown> }>, field: string,
): { ok: boolean; reason: string; stats: ZoneCodeStats } {
  const stats = zoneCodeStats(features as never, field);
  if (stats.total === 0) return { ok: false, reason: "0 feature", stats };
  if (stats.fieldExcluded) return { ok: false, reason: `champ zone interdit (technique): ${field}`, stats };
  if (stats.nonNull / stats.total < 0.5) return { ok: false, reason: `zone_code null >50% (${stats.nonNull}/${stats.total})`, stats };
  if (stats.distinct < 3) return { ok: false, reason: `<3 codes distincts (${stats.distinct})`, stats };
  if (stats.codeLikeRatio < 0.5) return { ok: false, reason: `<50% codes lettrés+numérotés — affectation/décoy suspecté (codeLike=${(stats.codeLikeRatio * 100).toFixed(0)}%, sample=${JSON.stringify(stats.sample.slice(0, 5))})`, stats };
  if (stats.maxLen > 24) return { ok: false, reason: `code trop long (maxLen=${stats.maxLen})`, stats };
  if (stats.sequentialIdLike) return { ok: false, reason: "valeurs entières séquentielles (id technique probable)", stats };
  return { ok: true, reason: "ok", stats };
}

interface LayerProbe { layerUrl: string; zoneField: string; muniField: string | null; muniFieldType: string | null; geometryType: string; extent: ExtentInfo | null; count: number }
interface ExtentInfo { xmin: number; ymin: number; xmax: number; ymax: number; wkid: number }

/** Match a field name on a layer (exact first, then case-insensitive). null if absent. */
function resolveFieldName(fields: FieldInfo[], want: string): string | null {
  const exact = fields.find((f) => f.name === want);
  if (exact) return exact.name;
  const ci = fields.find((f) => f.name.toLowerCase() === want.toLowerCase());
  return ci?.name ?? null;
}

/** Resolve a service URL into its candidate zonage sub-layer (polygon + zone field). */
async function probeServiceForZonage(serviceUrl: string, override?: { zoneField?: string; muniField?: string }): Promise<LayerProbe | null> {
  const base = serviceUrl.replace(/\/\d+$/, "");
  const directLayer = /\/\d+$/.test(serviceUrl) ? serviceUrl : null;
  const layerUrls: string[] = [];
  const addLayerUrl = (url: string): void => { if (!layerUrls.includes(url)) layerUrls.push(url); };
  if (directLayer) layerUrls.push(directLayer);
  else {
    const info = await fetchJson<{ layers?: GoNetLayer[] }>(`${base}?f=json`);
    const layers = info?.layers ?? [];
    if (layers.length === 0) addLayerUrl(`${base}/0`);
    else {
      // Public GoNet MapServers can expose "Zonage municipal" as a GROUP layer
      // with polygon children named generically. Reuse the GoNet selector so
      // --service can bypass the viewer/proxy when the direct endpoint is live.
      for (const l of gonetZonageCandidates(layers).slice(0, 12)) addLayerUrl(`${base}/${l.id}`);
      // Prefer a layer whose name screams zonage; else any polygon layer.
      const ranked = [...layers].sort((a, b) => Number(ZONAGE_TITLE_PATTERNS.some((p) => p.test(b.name))) - Number(ZONAGE_TITLE_PATTERNS.some((p) => p.test(a.name))));
      for (const l of ranked.slice(0, 6)) {
        if (AFFECTATION_TITLE_PATTERNS.some((p) => p.test(l.name)) && !ZONAGE_TITLE_PATTERNS.some((p) => p.test(l.name))) continue;
        if (l.geometryType && !/Polygon/i.test(l.geometryType)) continue;
        addLayerUrl(`${base}/${l.id}`);
      }
    }
  }
  for (const layerUrl of layerUrls) {
    const li = await fetchJson<{ fields?: FieldInfo[]; geometryType?: string; extent?: { xmin: number; ymin: number; xmax: number; ymax: number; spatialReference?: { wkid?: number; latestWkid?: number } } }>(`${layerUrl}?f=json`);
    if (!li || !li.fields) continue;
    if (li.geometryType && !/Polygon/i.test(li.geometryType)) continue;
    // Zone field: explicit override (must exist on this layer, else skip it) OR
    // auto-picker. The override bypasses the auto-picker that mis-selects a decoy
    // (affectation TYPE_ZONE / category prefix ZONE_) on aggregate MRC layers.
    const zoneField = override?.zoneField ? resolveFieldName(li.fields, override.zoneField) : pickZoneField(li.fields);
    if (!zoneField) continue;
    // Muni discriminant: explicit override OR auto-picker (null if absent).
    const muniField = override?.muniField ? resolveFieldName(li.fields, override.muniField) : pickMuniField(li.fields);
    const muniFieldType = muniField ? (li.fields.find((f) => f.name === muniField)?.type ?? null) : null;
    const cnt = await fetchJson<{ count?: number }>(`${layerUrl}/query?where=1%3D1&returnCountOnly=true&f=json`);
    const ext = li.extent;
    const extent: ExtentInfo | null = ext ? { xmin: ext.xmin, ymin: ext.ymin, xmax: ext.xmax, ymax: ext.ymax, wkid: ext.spatialReference?.latestWkid ?? ext.spatialReference?.wkid ?? 4326 } : null;
    return { layerUrl, zoneField, muniField, muniFieldType, geometryType: li.geometryType ?? "", extent, count: cnt?.count ?? 0 };
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
async function fetchFeatures(
  layerUrl: string,
  outFields: string,
  where: string,
  expectedCount: number,
  slug: string,
): Promise<CapturedFeatures | null> {
  const url = `${layerUrl}/query?where=${encodeURIComponent(where)}&outFields=${encodeURIComponent(outFields)}` +
    `&outSR=4326&geometryPrecision=6&resultRecordCount=${MAX_FEATURES}&f=geojson`;
  const captured = await capturedArcgisJson<GeoFC>(url, [slug], 20_000);
  if (!captured || !Array.isArray(captured.value.features)) return null;
  return {
    features: captured.value.features,
    entry: captured.entry,
    paginated: captured.value.exceededTransferLimit === true || captured.value.features.length !== expectedCount,
  };
}

export function normalize(features: GeoFeature[], zoneField: string, serviceUrl: string, confidence = "obscura-zone-vector"): GeoFeature[] {
  return features.map((f) => {
    const raw = f.properties?.[zoneField];
    const zone = raw !== null && raw !== undefined && String(raw).trim() !== "" ? String(raw).trim() : null;
    return { type: "Feature", geometry: f.geometry, properties: { zone_code: zone, kind: null, affectation: null, num_zone: null, source: serviceUrl, confidence } };
  });
}

function canonicalZoneCode(value: unknown): string {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** ISO-8601 timestamp shape (frère de `zonage-proof.ts`) — pour valider `retrieved_at`. */
const ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Un feature servi est V2-PROUVÉ ssi il porte un vrai bloc de preuve géométrique
 * PAR-FEATURE : `proof.geometry_source` avec un `sha256:<64hex>` bien formé ET un
 * `retrieved_at` ISO (SPEC_ZONE_DEPOSIT_REPLACE_POLICY.md, SHA 65d4c637). C'est le
 * discriminateur ROBUSTE du gate d'identité : une `zone_source_url` http(s) réelle est
 * NÉCESSAIRE mais NON SUFFISANTE — un `candidate` à URL *déclarative* sans capture ne
 * porte AUCUN bloc de preuve, donc N'EST PAS prouvé. Seul un vrai dépôt v2
 * (`attachGeometryProof`, zonage-proof.ts) estampille ce bloc ; `zone_source_level`
 * ("documented"/"historical-verified") ne le corrobore qu'accessoirement — la preuve
 * elle-même reste le juge. Tester le bloc plutôt que l'URL ne peut rendre QUE PLUS de
 * codes non-prouvés (jamais moins), donc strictement plus sûr.
 */
function featureHasV2Proof(feature: GeoFeature): boolean {
  const proof = feature.properties?.["proof"] as
    | { geometry_source?: { sha256?: unknown; retrieved_at?: unknown } }
    | null
    | undefined;
  const gs = proof?.geometry_source;
  if (!gs) return false;
  const shaOk = typeof gs.sha256 === "string" && /^sha256:[a-f0-9]{64}$/.test(gs.sha256);
  const retrievedOk = typeof gs.retrieved_at === "string" && ISO_TS_RE.test(gs.retrieved_at) && !Number.isNaN(Date.parse(gs.retrieved_at));
  return shaOk && retrievedOk;
}

function auditServed(key: string, features: GeoFeature[]): ServedAudit {
  const propertyKeys = new Set<string>();
  const zoneSourceUrls = new Set<string>();
  const zoneSourceLevels = new Set<string>();
  // Count populated logical-zone properties, not raw polygon parts: a multipolygon
  // split cannot fake enrichment growth or hide a loss.
  const byZone = new Map<string, Record<string, unknown>>();
  for (const feature of features) {
    const props = feature.properties ?? {};
    for (const property of Object.keys(props)) propertyKeys.add(property);
    if (typeof props["zone_source_url"] === "string") zoneSourceUrls.add(props["zone_source_url"]);
    if (typeof props["zone_source_level"] === "string") zoneSourceLevels.add(props["zone_source_level"]);
    const zone = canonicalZoneCode(props["zone_code"]);
    if (zone) byZone.set(zone, { ...(byZone.get(zone) ?? {}), ...props });
  }
  let populatedProperties = 0;
  for (const props of byZone.values()) {
    for (const [keyName, value] of Object.entries(props)) {
      if (keyName !== "proof" && value !== null && value !== undefined && value !== "") populatedProperties++;
    }
  }
  return {
    key,
    features: features.length,
    propertyKeys: [...propertyKeys].sort(),
    populatedProperties,
    zoneSourceUrls: [...zoneSourceUrls].sort(),
    zoneSourceLevels: [...zoneSourceLevels].sort(),
  };
}

async function readServedAudit(s3: S3Client, key: string): Promise<{ audit: ServedAudit; features: GeoFeature[] } | null> {
  if (!(await exists(s3, key))) return null;
  const fc = JSON.parse((await getBytes(s3, key)).toString("utf8")) as { features?: GeoFeature[] };
  if (!Array.isArray(fc.features)) throw new Error(`served zone object ${key} is not a FeatureCollection`);
  return { audit: auditServed(key, fc.features), features: fc.features };
}

function auditLine(label: "AVANT" | "APRÈS", audit: ServedAudit): void {
  console.error(
    `[obscura] ${label} ${audit.key}: features=${audit.features} propriétés=${audit.populatedProperties}` +
    ` keys=[${audit.propertyKeys.join(",")}] provenance_urls=[${audit.zoneSourceUrls.join(",") || "null"}]` +
    ` provenance_levels=[${audit.zoneSourceLevels.join(",") || "null"}]`,
  );
}

class PropertyRegressionError extends Error {
  constructor(message: string) { super(message); this.name = "PropertyRegressionError"; }
}

/**
 * One served-only zone code dropped by a PROVENANCE-AWARE replacement: it was carried
 * by a served feature with `zone_source_url === null` (never proven in v2) and is absent
 * from the verified-complete v2 capture. Per SPEC_ZONE_DEPOSIT_REPLACE_POLICY.md §3 (G3/G4)
 * this is a DOCUMENTED DIVERGENCE — status UNKNOWN (recalage-flagged), never N-A: a
 * replacement does not attest abolition. The prior served geometry is backed up
 * byte-for-byte under `_replaced/` in the same pass.
 */
export interface DroppedServedCode {
  code: string;
  prior_levels: string[];
  zone_source_url: null;
  status: "UNKNOWN";
  reason: string;
}

/**
 * Safe geometry replacement shared by the ArcGIS and GoNet paths in this runner.
 * It refuses an identity mismatch, keeps served properties by canonical zone code,
 * replays the committed folds, then records a before/after served audit.  The v2
 * proof is already bound to one captured response when this function is called.
 */
export async function depositCapturedZones(
  s3: S3Client,
  slug: string,
  norm: GeoFeature[],
  proof: GeometrySourceProof,
  opts: { geometryGrain?: GeometryGrain } = {},
): Promise<{ servedBefore: ServedAudit[]; servedAfter: ServedAudit[]; droppedDivergence: DroppedServedCode[]; replacedBackups: string[] }> {
  const flatKey = `${S3_PREFIX}qc-zonage-${slug}.geojson`;
  const nestedKey = `${S3_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`;
  const present = (await Promise.all([readServedAudit(s3, flatKey), readServedAudit(s3, nestedKey)])).filter(
    (value): value is { audit: ServedAudit; features: GeoFeature[] } => value !== null,
  );
  const servedBefore = present.map((value) => value.audit);
  for (const audit of servedBefore) auditLine("AVANT", audit);

  const servedCodes = new Set(present.flatMap(({ features }) => features.map((f) => canonicalZoneCode(f.properties?.["zone_code"])).filter(Boolean)));
  const incomingCodes = new Set(norm.map((f) => canonicalZoneCode(f.properties?.["zone_code"])).filter(Boolean));
  const uncovered = [...servedCodes].filter((code) => !incomingCodes.has(code));

  // PROVENANCE-AWARE identity gate (SPEC_ZONE_DEPOSIT_REPLACE_POLICY.md §2-3, SHA 65d4c637).
  // Per served-only code, the discriminator is whether the code is genuinely V2-PROVEN:
  // at least one of its served features carries a per-feature `proof.geometry_source`
  // block (real sha256 + retrieved_at — see featureHasV2Proof). A real http(s)
  // `zone_source_url` is NECESSARY but NOT SUFFICIENT: a `candidate` with a *declarative*
  // URL and no capture carries NO proof block, so it is NOT proven — it does not block a
  // verified-complete v2 capture and passes as a DOCUMENTED DIVERGENCE (recorded here,
  // backed up byte-for-byte under _replaced/ below). A served code that IS v2-proven still
  // blocks: the strict superset holds for it — a proven code may not be silently dropped
  // (its removal needs a reproducible per-code absence proof). Testing the proof block
  // rather than the URL can only make MORE codes unproven, never fewer — strictly SAFER.
  const provenanceByCode = new Map<string, { levels: Set<string>; hasV2Proof: boolean }>();
  for (const { features } of present) {
    for (const f of features) {
      const code = canonicalZoneCode(f.properties?.["zone_code"]);
      if (!code) continue;
      const entry = provenanceByCode.get(code) ?? { levels: new Set<string>(), hasV2Proof: false };
      const level = f.properties?.["zone_source_level"];
      if (typeof level === "string") entry.levels.add(level);
      if (featureHasV2Proof(f)) entry.hasV2Proof = true;
      provenanceByCode.set(code, entry);
    }
  }
  const isProven = (code: string): boolean => provenanceByCode.get(code)?.hasV2Proof === true;
  const uncoveredProven = uncovered.filter(isProven).sort();
  if (uncoveredProven.length > 0) {
    throw new Error(
      `identity gate (provenance-aware): ${uncoveredProven.length} code(s) servi(s) PROUVÉ(s) (preuve v2 par feature: proof.geometry_source sha256+retrieved_at) absent(s) de la couche amont (${uncoveredProven.join(",")}); un code prouvé ne se droppe pas sans preuve d'absence reproductible; aucun dépôt`,
    );
  }
  const droppedDivergence: DroppedServedCode[] = uncovered
    .filter((code) => !isProven(code))
    .sort()
    .map((code) => ({
      code,
      prior_levels: [...(provenanceByCode.get(code)?.levels ?? [])].sort(),
      zone_source_url: null,
      status: "UNKNOWN",
      reason: "présent dans un servi NON-PROUVÉ (zone_source_url=null), absent d'une capture v2 vérifiée-complète (count==source); divergence documentée + backup _replaced/; recalage-flagged; NON N-A (le remplacement n'atteste pas l'abolition)",
    }));

  const maxServedFeatures = Math.max(0, ...present.map(({ features }) => features.length));
  if (norm.length < maxServedFeatures) {
    throw new Error(`coverage gate: ${norm.length} features amont < ${maxServedFeatures} features servies; aucun dépôt`);
  }

  const targets = present.length > 0
    ? present.map(({ audit, features }) => ({ key: audit.key, current: features }))
    : [{ key: flatKey, current: [] as GeoFeature[] }];
  const stamp = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15) + "Z";
  const replacedBackups: string[] = [];
  for (const { key, current } of targets) {
    if (current.length > 0) {
      const backup = `${S3_PREFIX}_replaced/qc-zonage-${slug}__${key === flatKey ? "flat" : "nested"}.${stamp}.geojson`;
      await copyObject(s3, key, backup);
      replacedBackups.push(backup);
      console.error(`[obscura] BACKUP ${key} -> s3://${backup}`);
    }
    const features = norm.map((feature) => ({ ...feature, properties: { ...(feature.properties ?? {}) } }));
    const carried = carryForwardServedZoneProperties(features, current, canonicalZoneCode);
    const fc = attachGeometryProof({ type: "FeatureCollection" as const, features }, proof);
    console.error(`[obscura] PROPRIÉTÉS reportées ${key}: zones appariées=${carried.matched}/${features.length} non-appariées=${carried.unmatched}`);
    await putServedZoneGeojson(s3, key, fc);
  }

  // A geometry replacement resets enrichment values. Re-run the committed folds
  // in the same pass, then stamp the exact live v2 source last. `geometry_grain`
  // (source-layer nature: zone-polygon | evaluation-unit) is stamped in the SAME
  // additive pass when the caller supplies it — additive-only, geometry byte-exact.
  const grain = opts.geometryGrain;
  const stampAllowed = grain
    ? ["zone_source_url", "zone_source_level", GEOMETRY_GRAIN_FIELD]
    : ["zone_source_url", "zone_source_level"];
  await reapplyServedZonageEnrichment(slug);
  for (const { key } of targets) {
    const fc = JSON.parse((await getBytes(s3, key)).toString("utf8")) as { type: "FeatureCollection"; features: GeoFeature[] };
    for (const feature of fc.features) {
      feature.properties = {
        ...(feature.properties ?? {}),
        zone_source_url: proof.url,
        zone_source_level: "documented",
        ...(grain ? { [GEOMETRY_GRAIN_FIELD]: grain } : {}),
      };
    }
    await putServedZoneAdditive(s3, key, fc, { allowedProps: stampAllowed });
  }

  const servedAfter = (await Promise.all(targets.map(({ key }) => readServedAudit(s3, key)))).map((value) => {
    if (value === null) throw new Error(`readback missing after served deposit: ${slug}`);
    return value.audit;
  });
  for (const after of servedAfter) {
    auditLine("APRÈS", after);
    const before = servedBefore.find((entry) => entry.key === after.key);
    if (before && after.populatedProperties < before.populatedProperties) {
      throw new PropertyRegressionError(
        `property regression on ${after.key}: ${before.populatedProperties} -> ${after.populatedProperties}; stop before another city`,
      );
    }
  }
  return { servedBefore, servedAfter, droppedDivergence, replacedBackups };
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
interface GoNetLayer { id: number; name: string; geometryType?: string; type?: string; parentLayerId?: number; subLayerIds?: number[] | null }

const GONET_PROXY_DEFAULT = "https://www.goazimut.com/container/resource-proxy/proxy.jsp?";
// "Zonage municipal" — pas "Zone verte/inondable/agricole" (zonage agricole CPTAQ),
// pas "Affectation" (grande affectation du SAD), pas labels/annotations.
const GONET_ZONAGE_NAME_RE = /zonage/i;
const GONET_ZONAGE_EXCLUDE_RE = /\b(?:verte?|inondab\w*|agricole|affectat\w*|humide|glissement|emb[âa]cle|conservation|protection|patrimo\w*|hydro\w*|érosion|erosion)\b/i;

function stripGonetPrefix(name: string): string {
  return name.replace(/^(?:GROUP|NLIST|LABEL|HIDDEN|SIG)-\s*/i, "").trim();
}
function gonetNameIsZonage(name: string): boolean {
  const clean = stripGonetPrefix(name);
  return GONET_ZONAGE_NAME_RE.test(clean) && !GONET_ZONAGE_EXCLUDE_RE.test(clean);
}
function isGonetZonageLayer(l: GoNetLayer): boolean {
  if (!/Polygon/i.test(l.geometryType ?? "")) return false;
  if (/^(?:LABEL|HIDDEN)-/i.test(l.name)) return false; // annotations / helpers
  return gonetNameIsZonage(l.name);
}
/**
 * Candidate zonage polygon layers. Two shapes occur in GOnet6:
 *  (a) a flat polygon layer whose own name matches "zonage" (the 3 pilot villes);
 *  (b) a "Zonage municipal" GROUP layer (no geometry) whose polygon CHILDREN
 *      hold the data under generic names (ex. "Limite de zone et étiquette",
 *      "Dominance (trame)"). The data layer carries the zone_code field; the
 *      field-pick + zone_code-non-null≥50% + spatial gate downstream reject the
 *      wrong child (anti-invention preserved — selection never invents codes).
 */
function gonetZonageCandidates(layers: GoNetLayer[]): GoNetLayer[] {
  const byId = new Map<number, GoNetLayer>();
  for (const l of layers) byId.set(l.id, l);
  const out: GoNetLayer[] = [];
  for (const l of layers) {
    if (!/Polygon/i.test(l.geometryType ?? "")) continue;
    if (/^(?:LABEL|HIDDEN)-/i.test(l.name)) continue;
    if (gonetNameIsZonage(l.name)) { out.push(l); continue; } // (a) direct
    const pid = l.parentLayerId; // (b) child of a "Zonage municipal" group
    if (pid !== undefined && pid >= 0) {
      const parent = byId.get(pid);
      if (parent && gonetNameIsZonage(parent.name) && !GONET_ZONAGE_EXCLUDE_RE.test(stripGonetPrefix(l.name))) out.push(l);
    }
  }
  return out;
}

/** Pick the zone_code field of a (confirmed) GoNet zonage layer. */
function pickGonetZoneField(fields: FieldInfo[]): string | null {
  const usable = fields.filter((f) =>
    /string/i.test(f.type) &&
    !AFFECTATION_FIELD_PATTERNS.some((p) => p.test(f.name)) &&
    !/^shape|shape_|^objectid|^producteur$|^matricule$|^nommuni$|^nom_?mrc$/i.test(f.name));
  for (const f of usable) if (ZONE_CODE_FIELD_CODELIKE.some((p) => p.test(f.name))) return f.name; // prefer a code field over a usage label
  for (const f of usable) if (ZONE_CODE_FIELD_PATTERNS.some((p) => p.test(f.name))) return f.name; // zonage/no_zone/…
  // `Numéro_de_Zonage` (GOnet6 layer #144) : "Zonage" ne CONTIENT pas la sous-chaîne
  // "zone" (z-o-n-a-g-e), donc /zone/i échouait et le picker retombait sur le premier
  // champ usable (souvent vide, ex. `Numéro_de_réglement`) → faux "null>50%". On
  // reconnaît explicitement "zonage" en sous-chaîne (le VRAI champ code-zone GOnet).
  for (const f of usable) if (/^code(_?zone)?$/i.test(f.name) || /zonage|zone/i.test(f.name)) return f.name; // ex. `Code`, `Numéro_de_Zonage`
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
/** Every authenticated GoNet request still crosses the shared capture chokepoint. */
async function capturedGonetJson<T>(
  browser: Browser,
  sid: string,
  url: string,
  run: CaptureRun,
  slug: string,
): Promise<{ value: T; entry: CaptureManifestLine } | null> {
  const captured = await capturedFetch(url, {
    headers: { accept: "application/json,application/geo+json" },
  }, {
    run,
    lane: "zones",
    source: "zones-gonet",
    slugs: [slug],
    fetchImpl: browser.sessionFetch(sid),
    timeoutMs: 35_000,
  });
  if (!captured.ok) return null;
  try {
    return { value: JSON.parse(capturedText(captured)) as T, entry: captured.line };
  } catch {
    return null;
  }
}

/**
 * A v2 proof has one real response URL and one body hash.  Combining several
 * ArcGIS pages produces no such source response, so pagination is a hard reject.
 */
async function gonetFetchUnpaginated(
  browser: Browser,
  sid: string,
  proxy: string,
  mapBase: string,
  id: number,
  zoneField: string,
  expectedCount: number,
  run: CaptureRun,
  slug: string,
): Promise<CapturedFeatures | null> {
  const url = `${proxy}${mapBase}/${id}/query?where=1%3D1&outFields=${encodeURIComponent(zoneField)}` +
    `&returnGeometry=true&outSR=4326&returnZ=false&returnM=false&geometryPrecision=6&resultRecordCount=${MAX_FEATURES}&f=geojson`;
  const captured = await capturedGonetJson<GeoFC>(browser, sid, url, run, slug);
  if (!captured || !Array.isArray(captured.value.features)) return null;
  return {
    features: captured.value.features,
    entry: captured.entry,
    paginated: captured.value.exceededTransferLimit === true || captured.value.features.length !== expectedCount,
  };
}

/**
 * Extract + validate + deposit the GoNet "Zonage municipal" layer for `slug`.
 * Returns a terminal SlugResult (deposited / no-zonage-layer / spatial-fail).
 */
async function processGonetZonage(
  slug: string, muni: MuniEntry | undefined, viewerUrl: string,
  browser: Browser, run: CaptureRun, s3: S3Client | null, args: Args, base: SlugResult,
  registry: MuniEntry[],
): Promise<SlugResult> {
  // The GOnet6 viewer is a heavy JS map: the in-session MapServer proxy request
  // (the only signal that the muni IS on goazimut) is not fired until the map
  // finishes booting — empirically ~40s, well past the 12s default nav window.
  // Floor the session render at 40s so a too-short --nav-ms cannot turn a real
  // goazimut muni into a false "aucune requête proxy" (session/recaptcha?) miss.
  const session = await browser.openSession(viewerUrl, Math.max(args.navMs, 40_000) + 8_000);
  try {
    const mapBase = gonetMapServerBase(session.requests);
    if (!mapBase) return { ...base, status: "no-zonage-layer", captureReport: noVectorCaptureReport(slug), detail: `gonet: aucune requête proxy MapServer captée (session/recaptcha?) @${viewerUrl}` };
    const proxy = gonetProxyBase(session.requests);

    const info = await capturedGonetJson<{ layers?: GoNetLayer[] }>(browser, session.sid, `${proxy}${mapBase}/?f=json`, run, slug);
    const layers = info?.value.layers ?? [];
    if (layers.length === 0) return { ...base, status: "no-zonage-layer", captureReport: noVectorCaptureReport(slug), detail: `gonet: MapServer sans couches lisibles (${mapBase})` };
    if (process.env["GONET_DUMP_LAYERS"]) {
      console.error(`[gonet-dump ${slug}] ${layers.length} couches @ ${mapBase}`);
      for (const l of layers) console.error(`    #${l.id}\tp=${l.parentLayerId ?? "-"}\t${l.type ?? "?"}\t${l.geometryType ?? "?"}\t${l.name}`);
    }
    const candidates = gonetZonageCandidates(layers);
    if (candidates.length === 0) return { ...base, status: "no-zonage-layer", captureReport: noVectorCaptureReport(slug), detail: `gonet MapServer (${layers.length} couches) sans couche 'Zonage municipal'` };

    // Among zonage-named polygon layers, keep the one with a usable zone field AND
    // the most features (scale variants are duplicated; one may be empty).
    let best: { id: number; name: string; zoneField: string; oidField: string; count: number } | null = null;
    for (const c of candidates.slice(0, 12)) {
      const li = await capturedGonetJson<{ fields?: FieldInfo[] }>(browser, session.sid, `${proxy}${mapBase}/${c.id}?f=json`, run, slug);
      const fields = li?.value.fields ?? [];
      const zoneField = pickGonetZoneField(fields);
      if (!zoneField) continue;
      const oidField = fields.find((f) => /OID/i.test(f.type))?.name ?? "OBJECTID";
      const cnt = await capturedGonetJson<{ count?: number }>(browser, session.sid, `${proxy}${mapBase}/${c.id}/query?where=1%3D1&returnCountOnly=true&f=json`, run, slug);
      const count = cnt?.value.count ?? 0;
      if (count <= 0) continue;
      if (!best || count > best.count) best = { id: c.id, name: stripGonetPrefix(c.name), zoneField, oidField, count };
    }
    if (!best) return { ...base, status: "no-zonage-layer", captureReport: noVectorCaptureReport(slug), detail: `gonet: couche(s) zonage sans champ zone_code exploitable` };

    const layerUrl = `${mapBase}/${best.id}`;
    const received = await gonetFetchUnpaginated(browser, session.sid, proxy, mapBase, best.id, best.zoneField, best.count, run, slug);
    if (!received) return { ...base, status: "no-zonage-layer", captureReport: noVectorCaptureReport(slug), detail: `gonet: couche ${best.name} (${best.count} attendues) téléchargée sans GeoJSON exploitable` };
    if (received.features.length === 0) return { ...base, status: "no-zonage-layer", captureReport: noVectorCaptureReport(slug, received.entry), detail: `gonet: couche ${best.name} (${best.count} attendues) téléchargée vide` };
    const captureReport = buildGonetCaptureReport(slug, muni, registry, received.entry, received.features, received.paginated, best.zoneField, best.name);
    base.captureReport = captureReport;
    if (received.paginated) {
      return { ...base, status: "no-zonage-layer", detail: `gonet: réponse PAGINÉE/refusée (${received.features.length}/${best.count} features; preuve v2 à URL unique impossible)` };
    }
    const raw = received.features;
    const norm = normalize(raw, best.zoneField, layerUrl, "obscura-gonet-vector");

    // Anti-invention (mission gate) : le champ zone auto-pické GOnet doit porter de
    // VRAIS codes — ≥3 distincts, ≥50% code-like (incl. QC chiffre-d'abord "25-H"),
    // non-null ≥50%, ni affectation ni id séquentiel. Rejette un label mal-pické
    // (ex. `Affectations`="PU-H") ou un champ technique. Value-based, comme --service.
    const verdict = validateExplicitZoneField(raw, best.zoneField);
    if (!verdict.ok) return { ...base, status: "no-zonage-layer", detail: `gonet couche ${best.name} champ '${best.zoneField}': ${verdict.reason} — rejet anti-invention` };

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
      const deposited = await depositCapturedZones(s3, slug, norm, proofFromGonetCapture(received.entry));
      return { ...base, ...deposited, deposited: true, status: "deposited", detail: `${norm.length} zones (${nonNull} avec zone_code, champ ${best.zoneField}) via GoNet ${layerUrl}` };
    }
    return { ...base, status: "deposited", deposited: false, detail: `PROBE OK (non déposé): ${norm.length} zones (champ ${best.zoneField}) via GoNet ${layerUrl}` };
  } finally {
    await browser.closeSession(session.targetId);
  }
}

// ── Traitement d'une ville ────────────────────────────────────────────────────
async function processCity(slug: string, muni: MuniEntry | undefined, browser: Browser, s3: S3Client | null, args: Args, registry: MuniEntry[]): Promise<SlugResult> {
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
      const g = await processGonetZonage(slug, muni, viewer, browser, CAPTURE!, s3, args, base, registry);
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
    const probe = await probeServiceForZonage(svc, { ...(args.zoneField ? { zoneField: args.zoneField } : {}), ...(args.muniField ? { muniField: args.muniField } : {}) });
    if (!probe) continue;

    // Build where-clause. Aggregate detection is projection-independent: a layer
    // is an AGGREGATE iff its muni field carries ≥2 distinct canonical slugs.
    // (The extent reprojection can't be trusted — MRC layers are often in a QC
    // projection extentCenterWgs84 can't convert.)
    let where = "1=1";
    let isAggregate = false;
    if (probe.muniField && muni) {
      // returnGeometry=false + orderByFields force un DISTINCT global (GROUP BY) :
      // sans eux, le serveur calcule le distinct sur un SCAN limité à maxRecordCount
      // et OMET les munis dont les features arrivent tard dans la table (ex. Témis
      // CODE_MUN 13100 → 13 distinct au lieu de 19, saint-athanase perdu).
      const sample = await fetchJson<{ features?: Array<{ attributes: Record<string, unknown> }> }>(`${probe.layerUrl}/query?where=1%3D1&outFields=${encodeURIComponent(probe.muniField)}&returnDistinctValues=true&returnGeometry=false&orderByFields=${encodeURIComponent(probe.muniField)}&resultRecordCount=2000&f=json`);
      const distinct = new Map<string, string>(); // canonicalSlug → raw value
      for (const ft of sample?.features ?? []) {
        const v = ft.attributes?.[probe.muniField];
        if (v == null || String(v).trim() === "") continue;
        // Override → registry-aware resolver (numeric MAMH code OR name, keeps
        // "Canton de X" ≠ "Ville de X"). Auto → historic strip-prefix (unchanged).
        const canon = args.muniField
          ? resolveMuniValueToTargetSlug(String(v), muni, MUNI_CODE_TO_SLUG, MUNI_SLUG_SET)
          : toSlug(stripAdminPrefix(String(v)));
        if (canon) distinct.set(canon, String(v));
      }
      if (process.env["OBSCURA_DEBUG"]) console.error(`   · ${slug} muniField=${probe.muniField} distinct=${distinct.size} has(${slug})=${distinct.has(slug)} keys=${[...distinct.keys()].slice(0, 30).join(",")}`);
      if (distinct.size >= 2) {
        isAggregate = true;
        const matched = distinct.get(slug);
        if (!matched) continue; // muni not present in this MRC layer → skip
        where = muniWhereClause(probe.muniField, matched, /string/i.test(probe.muniFieldType ?? ""));
      } else if (distinct.size === 1 && !distinct.has(slug)) {
        continue; // mono-muni layer for a DIFFERENT muni → skip
      }
    }

    const outFields = probe.muniField ? `${probe.zoneField},${probe.muniField}` : probe.zoneField;
    const targetCount = await capturedArcgisJson<{ count?: number }>(
      `${probe.layerUrl}/query?where=${encodeURIComponent(where)}&returnCountOnly=true&f=json`,
      [slug],
    );
    const expectedCount = targetCount?.value.count ?? 0;
    if (expectedCount <= 0) continue;
    const received = await fetchFeatures(probe.layerUrl, outFields, where, expectedCount, slug);
    if (!received || received.features.length === 0) continue;
    if (received.paginated) {
      base.detail = `réponse PAGINÉE/refusée ${probe.layerUrl} (${received.features.length}/${expectedCount} features; preuve v2 à URL unique impossible)`;
      continue;
    }
    const raw = received.features;
    // Anti-invention: validate the VALUES are real zone codes, even when the field
    // was auto-picked. This rejects affectation labels, letter-only categories,
    // numeric-only zone ids, and technical/sequential ids before any deposit.
    const verdict = validateExplicitZoneField(raw, probe.zoneField);
    if (!verdict.ok) { base.detail = `couche ${probe.layerUrl} champ '${probe.zoneField}': ${verdict.reason} — rejet anti-invention`; continue; }
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
      const deposited = await depositCapturedZones(
        s3,
        slug,
        norm,
        proofFromCaptureEntry(received.entry, { type: "arcgis", method: "natif", reliability: "directe" }),
      );
      return { ...base, ...deposited, deposited: true, status: "deposited", detail: `${norm.length} zones (${nonNull} avec zone_code, champ ${probe.zoneField}) via ${probe.layerUrl}${isAggregate ? " [MRC filtré]" : ""}` };
    }
    return { ...base, status: "deposited", deposited: false, detail: `PROBE OK (non déposé): ${norm.length} zones (champ ${probe.zoneField}) via ${probe.layerUrl}` };
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

// ── Chargement du crosswalk MAMH (code → slug) + registre de slugs ────────────
/**
 * Peuple MUNI_CODE_TO_SLUG (mamhCode → slug canonique, source = répertoire MAMH
 * du repo, jamais deviné) et MUNI_SLUG_SET (tous les slugs du registre). Ne retient
 * que les codes dont le slug existe au registre (lat/lon dispo pour le gate spatial).
 */
function loadMuniCrosswalk(munis: MuniEntry[]): void {
  const slugSet = new Set<string>();
  for (const m of munis) if (m.slug) slugSet.add(m.slug);
  const codeToSlug = new Map<string, string>();
  try {
    const dir = JSON.parse(readFileSync(MUNI_DIRECTORY_PATH, "utf8")) as { entries?: Record<string, { slug?: string; mamhCode?: string }> };
    for (const e of Object.values(dir.entries ?? {})) {
      const slug = e.slug ? toSlug(e.slug) : null;
      if (e.mamhCode && slug && slugSet.has(slug)) codeToSlug.set(String(e.mamhCode).trim(), slug);
    }
  } catch (err) {
    console.error(`[obscura] AVERTISSEMENT: répertoire MAMH illisible (${(err as Error).message}) — crosswalk code→slug désactivé`);
  }
  MUNI_SLUG_SET = slugSet;
  MUNI_CODE_TO_SLUG = codeToSlug;
  console.error(`[obscura] crosswalk MAMH: ${codeToSlug.size} codes → slug | registre: ${slugSet.size} slugs`);
}

function gonetSeedsFromMrcs(munis: MuniEntry[], mrcs: string[]): GonetSeed[] {
  if (mrcs.length === 0) return [];
  const wanted = new Set(mrcs.map((m) => m.trim()).filter(Boolean));
  const matrix = JSON.parse(readFileSync(COVERAGE_MATRIX_PATH, "utf8")) as {
    cities?: Record<string, Record<string, { status?: string }>>;
  };
  const codeBySlug = new Map([...MUNI_CODE_TO_SLUG.entries()].map(([code, slug]) => [slug, code]));
  const seeds: GonetSeed[] = [];
  for (const muni of munis) {
    if (!muni.mrc || !wanted.has(muni.mrc)) continue;
    const zonesStatus = matrix.cities?.[muni.slug]?.["zones"]?.status ?? "";
    if (zonesStatus === "done") continue;
    const code = codeBySlug.get(muni.slug);
    if (code && /^\d{4,5}$/.test(code)) seeds.push({ slug: muni.slug, code });
  }
  return seeds;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const munis = JSON.parse(readFileSync(MUNIS_PATH, "utf8")) as MuniEntry[];
  const bySlug = new Map(munis.map((m) => [m.slug, m]));
  loadMuniCrosswalk(munis);
  const mrcSeeds = gonetSeedsFromMrcs(munis, args.gonetMrcs);
  args.gonetSeeds.push(...mrcSeeds.filter((seed) => !args.gonetSeeds.some((s) => s.slug === seed.slug)));
  if (args.slugs.length === 0 && args.gonetSeeds.length === 0) { console.error("usage: --slugs a,b,c [--deposit] [--max-carto N] [--nav-ms MS] [--service URL --zone-field F --muni-field F]  |  --gonet slug=municode,... | --gonet-mrc \"MRC name\""); process.exit(2); }
  const captureS3 = s3Client();
  const s3 = args.deposit ? captureS3 : null;
  const seeded = args.services.length > 0 || args.orgs.length > 0;

  // Chromium n'est requis que pour le crawl de site / GoNet. Le mode --service/--org
  // (org-seeded, HTTP pur) et le mode --gonet ont des besoins distincts ; on ne
  // réclame un binaire Chromium que si un crawl/headless est réellement nécessaire.
  const needsChrome = args.gonetSeeds.length > 0 || !seeded;
  const chrome = needsChrome ? resolveChrome() : null;
  if (needsChrome && !chrome) { console.error("[obscura] AUCUN binaire Chromium — abandon"); process.exit(1); }
  const captureRun = openCaptureRun({
    lane: "zones",
    s3: captureS3,
    userAgent: needsChrome ? REAL_UA : HTTP_UA,
    viaObscura: needsChrome,
    // A SOCKS endpoint proves a browser proxy, not its implementation.  A Tor
    // operator can state `GEO_CAPTURE_EGRESS=tor:zones` explicitly.
    egress: process.env["GEO_CAPTURE_EGRESS"] ?? (process.env["CHROME_PROXY"] ? "proxy:chrome" : "direct"),
  });
  CAPTURE = captureRun;
  let captureExit = 1;
  try {
  console.error(`[obscura] chromium=${chrome ?? "n/a (mode --service HTTP)"} slugs=${args.slugs.length} gonetSeeds=${args.gonetSeeds.length} gonetMrcs=${args.gonetMrcs.length} deposit=${args.deposit} zoneField=${args.zoneField ?? "auto"} muniField=${args.muniField ?? "auto"}`);
  console.error(`[obscura] capture run=${captureRun.runId} manifest=s3://${captureRun.keys.manifest}`);

  const results: SlugResult[] = [];
  // GoNet-seeded mode: needs Chromium (the GOnet6 zonage MapServer is reachable
  // only via the viewer's in-session proxy) but skips the municipal-site crawl.
  if (args.gonetSeeds.length > 0) {
    console.error(`[obscura] GONET-SEEDED mode pairs=${args.gonetSeeds.map((s) => `${s.slug}=${s.code}`).join(",")}`);
    const browser = await Browser.launch(chrome!); // needsChrome garanti non-null ici
    try {
      for (let i = 0; i < args.gonetSeeds.length; i++) {
        const { slug, code } = args.gonetSeeds[i]!;
        const viewer = `https://www.goazimut.com/GOnet6/?m=${code}&pl=1`;
        const seedBase: SlugResult = { slug, site: websiteForSlug(slug) ?? null, platforms: ["goazimut"], viewerUrls: [viewer], deposited: false, status: "no-zonage-layer", detail: "" };
        let r: SlugResult;
        try { r = await processGonetZonage(slug, bySlug.get(slug), viewer, browser, CAPTURE!, s3, args, seedBase, munis); }
        catch (e) {
          if (e instanceof PropertyRegressionError) throw e;
          r = { ...seedBase, status: "error", captureReport: noVectorCaptureReport(slug, undefined, "REJECT_RUN_ERROR"), detail: e instanceof Error ? e.message : String(e) };
        }
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
      catch (e) {
        if (e instanceof PropertyRegressionError) throw e;
        r = { slug, site: websiteForSlug(slug) ?? null, platforms: ["arcgis"], viewerUrls: [], deposited: false, status: "error", detail: e instanceof Error ? e.message : String(e) };
      }
      results.push(r);
      console.error(`[${i + 1}/${args.slugs.length}] ${r.status.padEnd(18)} ${slug} :: ${r.detail}`);
    }
  } else {
    const browser = await Browser.launch(chrome!); // needsChrome garanti non-null ici
    try {
      for (let i = 0; i < args.slugs.length; i++) {
        const slug = args.slugs[i]!;
        let r: SlugResult;
        try { r = await processCity(slug, bySlug.get(slug), browser, s3, args, munis); }
        catch (e) {
          if (e instanceof PropertyRegressionError) throw e;
          r = { slug, site: websiteForSlug(slug) ?? null, platforms: [], viewerUrls: [], deposited: false, status: "error", detail: e instanceof Error ? e.message : String(e) };
        }
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
  const captureReports = results.map((r) => r.captureReport).filter((r): r is GonetCaptureReport => r !== undefined);

  const report = {
    contract: "zones-gonet-capture-report/v1",
    generatedAt: new Date().toISOString(),
    capture_run_id: captureRun.runId,
    deposit: args.deposit,
    verdict_counts: captureVerdictCounts(captureReports),
    capture_report: captureReports,
    byStatus,
    deposited,
    results,
  };
  // --out est résolu contre la RACINE du dépôt (pas le CWD) : un run lancé depuis
  // acquisition/ écrivait sinon dans acquisition/work/... inexistant → ENOENT, perte
  // du rapport malgré une capture S3 réussie. resolve ignore la base si --out est absolu.
  const out = args.outFile ? resolve(HERE, "../..", args.outFile) : resolve(HERE, "../../work/delegation-mass/zones-obscura-report.json");
  writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  if (captureReports.length > 0) writeFileSync(out.replace(/\.json$/i, ".md"), captureReportMarkdown(captureReports, captureRun.runId));
  console.error(`\n=== STATUS ${JSON.stringify(byStatus)}`);
  console.error(`déposés=${deposited.length} [${deposited.join(",")}]`);
  console.error(`rapport → ${out}`);
  captureExit = 0;
  } finally {
    CAPTURE = null;
    try { await captureRun.finish(captureExit); }
    catch (e) { console.error(`[obscura] WARN clôture capture: ${e instanceof Error ? e.message : String(e)}`); }
  }
}

// Run only as CLI entrypoint (keeps pure helpers importable for tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((e: unknown) => { console.error(e); process.exit(1); });
}
