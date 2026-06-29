/**
 * zones-wfs-run.ts — récupère les ZONES municipales depuis un GeoServer OGC WFS
 * (famille "Geocentralis" et tout autre GeoServer servant une couche zonage
 * agrégée multi-muni filtrable par un code municipalité).
 *
 * POURQUOI (nouvelle famille, hors-Mistral, hors-Chromium) :
 *   Le crawler `zones-obscura-run.ts` ne suit que les liens same-host et n'extrait
 *   que ArcGIS (FeatureServer) + GoNet (proxy MapServer). Or une part des villes
 *   `zones=to-research` est servie par un portail vendeur GeoServer dont le
 *   zonage est exposé en **WFS standard** (`evb:zonage_municipal`), une couche
 *   AGRÉGÉE multi-muni avec un champ `no_zonage_municipal` (= zone_code RÉEL) et
 *   un champ filtre `id_municipalite` (= code géographique MAMH 5 chiffres).
 *   Découvert sur `geoserver.geocentralis.com` (lead baie-trinite) : 68 munis,
 *   dont 67 dans le résidu to-research. Pur HTTP, pas de session/recaptcha.
 *
 * STRATÉGIE (discover-once-deposit-many, miroir du mode org-seeded ArcGIS) :
 *   On reçoit des paires `slug=codeMAMH`. Pour chaque muni : WFS GetFeature filtré
 *   `cql_filter=id_municipalite='<code>'`, sortie GeoJSON WGS84, pagination
 *   startIndex/count. On normalise `zone_code = no_zonage_municipal`, on passe le
 *   GATE SPATIAL (bbox des features ≤ --spatial-km du centroïde registre) et
 *   l'ANTI-INVENTION (zone_code non-null ≥50%), puis on dépose
 *   `normalized/ca-qc-zonage/qc-zonage-<slug>.geojson`.
 *
 * ANTI-INVENTION : seul un zone_code RÉEL servi par le WFS est déposé. Le gate
 * spatial rejette une paire slug↔code erronée (features hors-muni) sans dépôt.
 * Ne met PAS à jour la matrice (S3 = vérité, coverage-reconcile réconcilie).
 *
 * USAGE :
 *   npx tsx src/zones-wfs-run.ts --pairs amqui=07047,montmagny=18050 --no-deposit
 *   npx tsx src/zones-wfs-run.ts --pairs-file pairs.txt --deposit --conc 6
 *   options : --wfs-base <url> --wfs-layer <typeName> --zone-field <f>
 *             --muni-field <f> --spatial-km <n> (déf 25) --out <file>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { S3Client } from "@aws-sdk/client-s3";
import { s3Client, putBytes } from "./lib/s3.js";

// ── Constantes ────────────────────────────────────────────────────────────────
const HERE = dirname(fileURLToPath(import.meta.url));
const MUNIS_PATH = resolve(HERE, "../../packages/qc-sources/src/geo/municipalities.qc.json");
const S3_PREFIX = "normalized/ca-qc-zonage/";
const HTTP_UA = "sentropic-geo/0.1";
const HTTP_TIMEOUT_MS = 30_000;
const MAX_FEATURES = 20_000;
const PAGE = 1000;

// Geocentralis GeoServer (famille par défaut). Surchargeable en CLI.
const DEFAULT_WFS_BASE = "https://geoserver.geocentralis.com/geoserver/ows";
const DEFAULT_WFS_LAYER = "evb:zonage_municipal";
const DEFAULT_ZONE_FIELD = "no_zonage_municipal";
const DEFAULT_MUNI_FIELD = "id_municipalite";

// ── Types ─────────────────────────────────────────────────────────────────────
export interface MuniEntry { slug: string; name: string; mrc: string | null; lat: number; lon: number }
export interface GeoFeature { type: "Feature"; geometry: { type: string; coordinates: unknown } | null; properties: Record<string, unknown> }
interface GeoFC { type: "FeatureCollection"; features?: GeoFeature[]; numberMatched?: number; numberReturned?: number }

export interface WfsConfig { base: string; layer: string; zoneField: string; muniField: string }
export interface Pair { slug: string; code: string }

export interface WfsResult {
  slug: string; code: string;
  layerUrl?: string;
  featureCount?: number;
  nonNullZoneCode?: number;
  distanceKm?: number;
  deposited: boolean;
  status: "deposited" | "no-features" | "zone-null" | "spatial-fail" | "error";
  detail: string;
}

// ── Utilitaires géo (alignés sur zones-obscura-run.ts) ────────────────────────
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

/** Recursively yield every [lon,lat] position of a GeoJSON coordinate tree. */
export function* positionsOf(coords: unknown): Generator<[number, number]> {
  if (!Array.isArray(coords)) return;
  if (coords.length >= 2 && typeof coords[0] === "number" && typeof coords[1] === "number") {
    yield [coords[0] as number, coords[1] as number];
    return;
  }
  for (const c of coords) yield* positionsOf(c);
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371, dLat = ((lat2 - lat1) * Math.PI) / 180, dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Parse `slug=code,slug2=code2` (code = MAMH géo, 4-5 chiffres, conservé tel quel). */
export function parsePairs(csv: string): Pair[] {
  return csv.split(",").map((p) => p.trim()).filter(Boolean).map((p) => {
    const [slug, code] = p.split("=");
    return { slug: (slug ?? "").trim(), code: (code ?? "").trim() };
  }).filter((p) => p.slug && /^\d{4,5}$/.test(p.code));
}

/** Build a WFS 2.0 GetFeature URL (GeoJSON, WGS84) filtered to one muni, paged. */
export function buildGetFeatureUrl(cfg: WfsConfig, code: string, startIndex: number, count: number): string {
  const params = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: cfg.layer,
    outputFormat: "application/json",
    srsName: "EPSG:4326",
    count: String(count),
    startIndex: String(startIndex),
    cql_filter: `${cfg.muniField}='${code.replace(/'/g, "''")}'`,
  });
  return `${cfg.base}?${params.toString()}`;
}

/** Normalize WFS features to the serving schema (zone_code = real attribute). */
export function normalizeWfsFeatures(features: GeoFeature[], zoneField: string, source: string): GeoFeature[] {
  return features.map((f) => {
    const raw = f.properties?.[zoneField];
    const zone = raw !== null && raw !== undefined && String(raw).trim() !== "" ? String(raw).trim() : null;
    return {
      type: "Feature",
      geometry: f.geometry,
      properties: { zone_code: zone, kind: null, affectation: null, num_zone: null, source, confidence: "obscura-wfs-geoserver" },
    };
  });
}

/** Bbox centre of a normalized feature set (projection-free; WGS84 in). */
export function featuresBboxCenter(features: GeoFeature[]): { lat: number; lon: number; n: number } {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity, n = 0;
  for (const f of features) for (const [x, y] of positionsOf(f.geometry?.coordinates)) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; n++;
  }
  return { lat: (miny + maxy) / 2, lon: (minx + maxx) / 2, n };
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

/** Page through every feature of one muni via WFS startIndex/count. */
async function fetchMuniFeatures(cfg: WfsConfig, code: string): Promise<GeoFeature[]> {
  const features: GeoFeature[] = [];
  let startIndex = 0;
  while (features.length < MAX_FEATURES) {
    const url = buildGetFeatureUrl(cfg, code, startIndex, PAGE);
    const fc = await fetchJson<GeoFC>(url);
    if (!fc || !Array.isArray(fc.features) || fc.features.length === 0) break;
    features.push(...fc.features);
    if (fc.features.length < PAGE) break;
    startIndex += fc.features.length;
    await sleep(120);
  }
  return features;
}

// ── Traitement d'une muni ───────────────────────────────────────────────────
export async function processWfsMuni(
  pair: Pair, muni: MuniEntry | undefined, cfg: WfsConfig,
  s3: S3Client | null, deposit: boolean, spatialKm: number,
): Promise<WfsResult> {
  const { slug, code } = pair;
  const base: WfsResult = { slug, code, deposited: false, status: "no-features", detail: "" };
  const layerUrl = `${cfg.base}#${cfg.layer}[${cfg.muniField}=${code}]`;

  const raw = await fetchMuniFeatures(cfg, code);
  if (raw.length === 0) return { ...base, status: "no-features", detail: `WFS: 0 feature pour ${cfg.muniField}=${code}` };
  const norm = normalizeWfsFeatures(raw, cfg.zoneField, layerUrl);

  // Anti-invention : zone_code réel non-null ≥50%.
  const nonNull = norm.filter((f) => f.properties.zone_code !== null).length;
  if (nonNull / norm.length < 0.5) {
    return { ...base, featureCount: norm.length, nonNullZoneCode: nonNull, status: "zone-null", detail: `zone_code null >50% (${nonNull}/${norm.length}) — rejet` };
  }

  // Gate spatial : centre bbox des features ≤ spatialKm du centroïde registre.
  let distanceKm: number | undefined;
  if (muni) {
    const c = featuresBboxCenter(norm);
    if (c.n > 0) {
      distanceKm = haversineKm(muni.lat, muni.lon, c.lat, c.lon);
      if (distanceKm > Math.max(spatialKm, 35)) {
        return { ...base, featureCount: norm.length, nonNullZoneCode: nonNull, distanceKm, status: "spatial-fail", detail: `spatial KO: features à ${distanceKm.toFixed(0)}km du centroïde` };
      }
    }
  }

  const result: WfsResult = { ...base, layerUrl, featureCount: norm.length, nonNullZoneCode: nonNull, ...(distanceKm !== undefined ? { distanceKm } : {}) };
  if (deposit && s3) {
    const key = `${S3_PREFIX}qc-zonage-${slug}.geojson`;
    const fc: GeoFC = { type: "FeatureCollection", features: norm };
    await putBytes(s3, key, JSON.stringify(fc), "application/geo+json");
    return { ...result, deposited: true, status: "deposited", detail: `${norm.length} zones (${nonNull} avec zone_code, champ ${cfg.zoneField}) via WFS` };
  }
  return { ...result, status: "deposited", deposited: false, detail: `PROBE OK (non déposé): ${norm.length} zones (${nonNull} avec zone_code) via WFS` };
}

// ── Pool de concurrence ───────────────────────────────────────────────────────
async function pool<T, R>(items: T[], conc: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  async function worker(): Promise<void> { while (idx < items.length) { const i = idx++; out[i] = await fn(items[i]!, i); } }
  await Promise.all(Array.from({ length: Math.min(conc, items.length) }, worker));
  return out;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const get = (k: string): string | undefined => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const has = (k: string) => argv.includes(`--${k}`);

  let pairsStr = get("pairs") ?? "";
  const pairsFile = get("pairs-file");
  if (pairsFile) pairsStr = readFileSync(pairsFile, "utf8").replace(/\s+/g, ",");
  const pairs = parsePairs(pairsStr);
  if (pairs.length === 0) { console.error("usage: --pairs slug=code,... | --pairs-file f [--deposit] [--conc N] [--spatial-km N]"); process.exit(2); }

  const cfg: WfsConfig = {
    base: get("wfs-base") ?? DEFAULT_WFS_BASE,
    layer: get("wfs-layer") ?? DEFAULT_WFS_LAYER,
    zoneField: get("zone-field") ?? DEFAULT_ZONE_FIELD,
    muniField: get("muni-field") ?? DEFAULT_MUNI_FIELD,
  };
  const deposit = has("deposit") && !has("no-deposit");
  const spatialKm = Number(get("spatial-km") ?? 25);
  const conc = Number(get("conc") ?? 6);

  const munis = JSON.parse(readFileSync(MUNIS_PATH, "utf8")) as MuniEntry[];
  const bySlug = new Map(munis.map((m) => [m.slug, m]));
  const s3 = deposit ? s3Client() : null;

  console.error(`[wfs] base=${cfg.base} layer=${cfg.layer} pairs=${pairs.length} deposit=${deposit} conc=${conc}`);
  let done = 0;
  const results = await pool(pairs, conc, async (pair) => {
    let r: WfsResult;
    try { r = await processWfsMuni(pair, bySlug.get(pair.slug), cfg, s3, deposit, spatialKm); }
    catch (e) { r = { slug: pair.slug, code: pair.code, deposited: false, status: "error", detail: e instanceof Error ? e.message : String(e) }; }
    done++;
    console.error(`[${done}/${pairs.length}] ${r.status.padEnd(12)} ${pair.slug} (m=${pair.code}) :: ${r.detail}`);
    return r;
  });

  const byStatus: Record<string, number> = {};
  for (const r of results) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const deposited = results.filter((r) => r.deposited).map((r) => r.slug);
  const report = { generatedAt: new Date().toISOString(), deposit, cfg, byStatus, deposited, results };
  const out = get("out") ?? resolve(HERE, "../../work/delegation-mass/zones-wfs-report.json");
  writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  console.error(`\n=== STATUS ${JSON.stringify(byStatus)}`);
  console.error(`déposés=${deposited.length} [${deposited.join(",")}]`);
  console.error(`rapport → ${out}`);
}

// Run only as CLI entrypoint (keeps pure helpers importable for tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((e: unknown) => { console.error(e); process.exit(1); });
}
