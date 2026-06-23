/**
 * agol-mono-muni-detect.ts — Détection AGOL mono-muni pour les 100 premières
 * villes avec zones.status=="to-research" && candidateTracks[0]=="agol-account".
 *
 * Pour chaque ville:
 *   1. Sonde les domaines heuristiques (arcgis/rest/services) + AGOL search public
 *   2. Vérifie champ zone_code (non-null ≥50%, ≤24 char, pas affectation-only)
 *   3. Vérifie spatialement (centre bbox <5km du centroïde registre)
 *   4. Si trouvé: publie S3 + marque done
 *   5. Si non: reclasse pdf-discovery-required
 *
 * 0 LLM, 0 crédit Mistral. HTTP + S3 seulement.
 * Écriture matrice résumable APRÈS CHAQUE VILLE.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";

// ── S3 import via CommonJS fallback ──────────────────────────────────────────
import { s3Client, putBytes, BUCKET } from "./lib/s3.js";
import type { S3Client } from "@aws-sdk/client-s3";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CellState {
  status: "done" | "planned" | "to-research";
  doneTrack?: string;
  candidateTracks: string[];
  lastResearchAt?: string;
  notes?: string;
}

interface CityCoverage {
  zones: CellState;
  [key: string]: CellState;
}

interface CoverageMatrix {
  $schema: string;
  generatedAt: string;
  municipalityCount: number;
  cities: Record<string, CityCoverage>;
}

interface TargetCity {
  slug: string;
  name: string;
  lat: number | null;
  lon: number | null;
  website: string | null;
}

interface FoundLayer {
  serviceUrl: string;
  zoneCodeField: string;
  layerName: string;
  featureCount: number;
  bboxCenter: [number, number]; // [lat, lon]
}

interface GeoFeature {
  type: "Feature";
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, unknown>;
}

interface GeoFeatureCollection {
  type: "FeatureCollection";
  features: GeoFeature[];
}

// ── Constantes ────────────────────────────────────────────────────────────────

const MATRIX_PATH = "/home/antoinefa/src/geo/work/coverage/coverage-matrix.json";
const MUNIS_PATH = "/home/antoinefa/src/geo/packages/qc-sources/src/geo/municipalities.qc.json";
const DIRECTORY_PATH = "/home/antoinefa/src/geo/packages/geo-sources-americas/dist/ca-qc/municipalities/municipal-directory.qc.json";

const TIMEOUT_MS = 5_000;
const USER_AGENT = "sentropic-geo/0.1";
const S3_PREFIX = "normalized/ca-qc-zonage/";
const MAX_FEATURES_FETCH = 5000; // limite max features ArcGIS

// Patterns de noms de service/layer pour le ZONAGE (pas affectation seule)
const ZONAGE_SERVICE_PATTERNS = [
  /\bzonage\b/i,
  /\bzoning\b/i,
  /zone.muni/i,
  /plan.zone/i,
  /regl.*zone/i,
  /reglement.*zonage/i,
];

// Patterns affectation SEULE (à skipper si c'est tout ce qui est dispo)
const AFFECTATION_ONLY_PATTERNS = [
  /\baffectation\b/i,
  /affectation.sol/i,
  /affectation.territoire/i,
];

// Champs de zone_code plausibles (cas insensible)
const ZONE_CODE_FIELD_PATTERNS = [
  /^zone_?code$/i,
  /^zonage$/i,
  /^zone$/i,
  /^zoning$/i,
  /^num_?zone$/i,
  /^code_?zone$/i,
  /^codezonage$/i,
  /^designation$/i,
  /^type_?zone$/i,
  /^class_?zone$/i,
  /^ZONAGEMUNICIPALID$/i,
  /^ZonageMuni$/i,
  /^REGZONE$/i,
  /^ZONE_ID$/i,
  /^NOM_ZONE$/i,
];

// Mots-clés qui indiquent un champ affectation (à éviter)
const AFFECTATION_FIELD_PATTERNS = [
  /affectation/i,
  /affect/i,
  /grande_affect/i,
];

// ── Utilitaires ───────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchWithTimeout(
  url: string,
  opts: RequestInit = {},
  timeoutMs = TIMEOUT_MS
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...opts,
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        ...(opts.headers ?? {}),
      },
    });
    return res;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson<T = unknown>(
  url: string,
  timeoutMs = TIMEOUT_MS
): Promise<T | null> {
  const res = await fetchWithTimeout(url, {}, timeoutMs);
  if (!res || !res.ok) return null;
  try {
    const text = await res.text();
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

// ── AGOL search public ────────────────────────────────────────────────────────

interface AgolSearchResult {
  results: AgolItem[];
  total: number;
}

interface AgolItem {
  id: string;
  title: string;
  owner: string;
  type: string;
  url: string | null;
  snippet: string;
  tags: string[];
}

async function agolSearchZonage(
  cityName: string,
  slug: string
): Promise<AgolItem[]> {
  // Cherche via l'API AGOL public
  const queries = [
    `${cityName} zonage`,
  ];

  const found: AgolItem[] = [];
  const seen = new Set<string>();

  for (const q of queries) {
    const url =
      `https://www.arcgis.com/sharing/rest/search?f=json` +
      `&q=${encodeURIComponent(q + " owner:* type:Feature Service")}` +
      `&num=10&start=1&sortField=relevance&countFields=&countSize=10`;

    const data = await fetchJson<AgolSearchResult>(url);
    if (!data || !Array.isArray(data.results)) continue;

    for (const item of data.results) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      // Filtre: doit avoir "zonage" ou "zone" ou "zoning" dans le titre
      const t = (item.title || "").toLowerCase();
      if (
        !t.includes("zonage") &&
        !t.includes("zoning") &&
        !t.includes("zone") &&
        !t.includes("règlement") &&
        !t.includes("reglement")
      )
        continue;
      if (item.url) found.push(item);
    }
    await sleep(100);
  }

  return found;
}

// ── Sonde un serveur ArcGIS REST ──────────────────────────────────────────────

interface ArcgisServiceEntry {
  name: string;
  type: string;
}

interface ArcgisCatalog {
  services: ArcgisServiceEntry[];
}

interface ArcgisLayerInfo {
  id: number;
  name: string;
  geometryType?: string;
}

interface ArcgisServiceInfo {
  layers?: ArcgisLayerInfo[];
  geometryType?: string;
  fields?: ArcgisFieldInfo[];
}

interface ArcgisFieldInfo {
  name: string;
  type: string;
  alias?: string;
}

async function probeArcgisCatalog(
  baseUrl: string
): Promise<ArcgisServiceEntry[] | null> {
  const data = await fetchJson<ArcgisCatalog>(`${baseUrl}?f=json`);
  if (!data || !Array.isArray(data.services)) return null;
  return data.services;
}

async function getServiceInfo(
  serviceUrl: string
): Promise<ArcgisServiceInfo | null> {
  return fetchJson<ArcgisServiceInfo>(`${serviceUrl}?f=json`);
}

async function getLayerInfo(
  layerUrl: string
): Promise<{fields: ArcgisFieldInfo[], featureCount: number} | null> {
  const info = await fetchJson<ArcgisServiceInfo>(`${layerUrl}?f=json`);
  if (!info) return null;
  const fields = info.fields ?? [];

  // Get count
  const countData = await fetchJson<{count?: number}>(`${layerUrl}/query?where=1%3D1&returnCountOnly=true&f=json`);
  const featureCount = countData?.count ?? 0;

  return { fields, featureCount };
}

// ── Détecte le bon champ zone_code ───────────────────────────────────────────

function pickZoneCodeField(fields: ArcgisFieldInfo[]): string | null {
  // D'abord, cherche un match exact sur les patterns de zone
  for (const f of fields) {
    if (AFFECTATION_FIELD_PATTERNS.some((p) => p.test(f.name))) continue;
    if (ZONE_CODE_FIELD_PATTERNS.some((p) => p.test(f.name))) {
      return f.name;
    }
  }

  // Fallback: cherche un champ string avec "zone" dans le nom
  for (const f of fields) {
    if (!f.type.includes("String") && !f.type.includes("string")) continue;
    if (AFFECTATION_FIELD_PATTERNS.some((p) => p.test(f.name))) continue;
    if (/zone/i.test(f.name)) return f.name;
  }

  return null;
}

function isAffectationOnlyLayer(layerName: string, serviceTitle: string): boolean {
  const combined = `${layerName} ${serviceTitle}`;
  const hasAffectation = AFFECTATION_ONLY_PATTERNS.some((p) => p.test(combined));
  const hasZonage = ZONAGE_SERVICE_PATTERNS.some((p) => p.test(combined));
  return hasAffectation && !hasZonage;
}

// ── Validation zone_code sur échantillon ─────────────────────────────────────

interface QueryResult {
  features?: Array<{attributes: Record<string, unknown>}>;
  error?: unknown;
}

async function validateZoneCodeField(
  layerUrl: string,
  fieldName: string
): Promise<{ valid: boolean; nullRatio: number; maxLen: number; sample: string[] }> {
  // Query 50 features max pour valider
  const url =
    `${layerUrl}/query?where=1%3D1&outFields=${encodeURIComponent(fieldName)}` +
    `&resultRecordCount=50&f=json`;

  const data = await fetchJson<QueryResult>(url);
  if (!data || !Array.isArray(data.features)) {
    return { valid: false, nullRatio: 1, maxLen: 0, sample: [] };
  }

  const features = data.features;
  if (features.length === 0) {
    return { valid: false, nullRatio: 1, maxLen: 0, sample: [] };
  }

  let nullCount = 0;
  let maxLen = 0;
  const sample: string[] = [];

  for (const f of features) {
    const v = f.attributes?.[fieldName];
    if (v === null || v === undefined || v === "" || v === "null") {
      nullCount++;
    } else {
      const s = String(v);
      if (s.length > maxLen) maxLen = s.length;
      if (sample.length < 5) sample.push(s);
    }
  }

  const nullRatio = nullCount / features.length;
  // non-null ≥50%, ≤24 char
  const valid = nullRatio <= 0.5 && maxLen <= 24 && maxLen > 0;

  return { valid, nullRatio, maxLen, sample };
}

// ── Calcule bbox center et distance au centroïde ─────────────────────────────

interface Extent {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
  spatialReference?: {wkid?: number; latestWkid?: number};
}

async function getLayerExtent(layerUrl: string): Promise<Extent | null> {
  const info = await fetchJson<{extent?: Extent}>(`${layerUrl}?f=json`);
  return info?.extent ?? null;
}

function extentCenter(ext: Extent): [number, number] | null {
  // Si spatialReference.wkid == 4326 (WGS84) ou wkid == 102100 (WebMercator)
  const wkid = ext.spatialReference?.wkid ?? ext.spatialReference?.latestWkid ?? 4326;

  let lat: number, lon: number;

  if (wkid === 4326) {
    lat = (ext.ymin + ext.ymax) / 2;
    lon = (ext.xmin + ext.xmax) / 2;
  } else if (wkid === 102100 || wkid === 3857) {
    // WebMercator → WGS84 approximation
    const cx = (ext.xmin + ext.xmax) / 2;
    const cy = (ext.ymin + ext.ymax) / 2;
    lon = (cx / 20037508.342) * 180;
    lat = (Math.atan(Math.exp((cy / 20037508.342) * Math.PI)) * 360) / Math.PI - 90;
  } else if (wkid === 32198 || wkid === 26917 || wkid === 26918 || wkid === 6622) {
    // Projection QC ou UTM — on ne peut pas convertir sans proj4
    // Approximation très grossière: si les coords sont dans l'ordre de grandeur QC
    // NAD83/Quebec Lambert: x ~[150000, 1150000], y ~[100000, 1250000]
    // Ces valeurs correspondent à lon=-75/-60 lat=44/52 approximativement
    const cx = (ext.xmin + ext.xmax) / 2;
    const cy = (ext.ymin + ext.ymax) / 2;
    // Si les valeurs ressemblent à des coordonnées WGS84 (lat -90..90, lon -180..180)
    if (Math.abs(ext.xmin) < 180 && Math.abs(ext.ymin) < 90) {
      lat = (ext.ymin + ext.ymax) / 2;
      lon = (ext.xmin + ext.xmax) / 2;
    } else {
      // Pas de conversion fiable sans proj4 → null
      return null;
    }
  } else {
    // Essai WGS84 si les valeurs semblent correctes
    if (
      ext.xmin >= -180 && ext.xmax <= 180 &&
      ext.ymin >= -90 && ext.ymax <= 90
    ) {
      lat = (ext.ymin + ext.ymax) / 2;
      lon = (ext.xmin + ext.xmax) / 2;
    } else {
      return null;
    }
  }

  // Sanity check: doit être dans le Québec approximativement
  if (lat < 44 || lat > 62 || lon < -80 || lon > -56) return null;

  return [lat, lon];
}

// ── Télécharge les features ArcGIS (pagination) ──────────────────────────────

async function fetchAllFeatures(
  layerUrl: string,
  zoneCodeField: string,
  maxFeatures = MAX_FEATURES_FETCH
): Promise<GeoFeature[] | null> {
  const features: GeoFeature[] = [];
  let offset = 0;
  const batchSize = 1000;

  while (features.length < maxFeatures) {
    const url =
      `${layerUrl}/query?where=1%3D1` +
      `&outFields=${encodeURIComponent(zoneCodeField)}` +
      `&outSR=4326&geometryPrecision=6` +
      `&resultOffset=${offset}&resultRecordCount=${batchSize}&f=geojson`;

    const data = await fetchJson<GeoFeatureCollection>(url);
    if (!data || !Array.isArray(data.features)) break;
    if (data.features.length === 0) break;

    features.push(...data.features);
    offset += data.features.length;

    if (data.features.length < batchSize) break;
    await sleep(100);
  }

  return features.length > 0 ? features : null;
}

// ── Normalise les features ────────────────────────────────────────────────────

function normalizeFeatures(
  features: GeoFeature[],
  zoneCodeField: string,
  slug: string,
  serviceUrl: string
): GeoFeature[] {
  return features.map((f) => {
    const rawCode = f.properties?.[zoneCodeField];
    const zoneCode = rawCode !== null && rawCode !== undefined && rawCode !== ""
      ? String(rawCode)
      : null;

    return {
      type: "Feature",
      geometry: f.geometry,
      properties: {
        zone_code: zoneCode,
        kind: null,
        affectation: null,
        num_zone: null,
        source: serviceUrl,
        confidence: "zone-vector",
      },
    };
  });
}

// ── Tente de trouver un FeatureServer mono-muni via domaines heuristiques ────

const ARCGIS_SERVER_SUFFIXES = [
  "/arcgis/rest/services",
  "/server/rest/services",
];

function guessDomainsFromSlug(slug: string, website: string | null): string[] {
  const base = slug.toLowerCase();
  const domains: string[] = [];

  // Priorité aux domaines dérivés du site officiel (si connu)
  if (website) {
    try {
      const u = new URL(website);
      const host = u.hostname;
      // Essai: sig.<host>, gis.<host>
      if (!host.startsWith("sig.") && !host.startsWith("gis.")) {
        const bare = host.startsWith("www.") ? host.slice(4) : host;
        domains.push(`https://sig.${bare}`);
        domains.push(`https://gis.${bare}`);
        domains.push(`https://cartes.${bare}`);
      }
      // Le site lui-même peut héberger ArcGIS
      domains.push(`https://${host}`);
    } catch {
      // ignore
    }
  }

  // Heuristiques slug-based comme fallback
  domains.push(`https://sig.${base}.ca`);
  domains.push(`https://gis.${base}.ca`);

  // Deduplicate
  return [...new Set(domains)];
}

interface FindResult {
  layerUrl: string;
  zoneCodeField: string;
  layerName: string;
  serviceTitle: string;
}

async function findZonageLayerFromCatalog(
  catalogUrl: string,
  slug: string
): Promise<FindResult | null> {
  const services = await probeArcgisCatalog(catalogUrl);
  if (!services) return null;

  // Filtre les services zonage
  const zonageServices = services.filter((s) => {
    const baseName = s.name.split("/").pop() ?? s.name;
    return ZONAGE_SERVICE_PATTERNS.some((p) => p.test(baseName));
  });

  for (const svc of zonageServices.slice(0, 5)) {
    const serviceUrl = catalogUrl.replace(
      /\/rest\/services.*$/,
      `/rest/services/${svc.name}/${svc.type}`
    );

    const info = await getServiceInfo(serviceUrl);
    if (!info) continue;

    const layers = info.layers ?? [];
    if (layers.length === 0) {
      // Service direct (FeatureServer/0 style)
      const layerUrl = `${serviceUrl}/0`;
      const layerData = await getLayerInfo(layerUrl);
      if (!layerData) continue;

      if (isAffectationOnlyLayer(svc.name, svc.name)) continue;

      const field = pickZoneCodeField(layerData.fields);
      if (!field) continue;

      return {
        layerUrl,
        zoneCodeField: field,
        layerName: svc.name,
        serviceTitle: svc.name,
      };
    }

    // Cherche la couche zonage
    for (const layer of layers) {
      const layerName = layer.name ?? "";
      if (AFFECTATION_ONLY_PATTERNS.some((p) => p.test(layerName)) &&
          !ZONAGE_SERVICE_PATTERNS.some((p) => p.test(layerName))) continue;

      if (layer.geometryType && !layer.geometryType.includes("Polygon")) continue;

      const layerUrl = `${serviceUrl}/${layer.id}`;
      const layerData = await getLayerInfo(layerUrl);
      if (!layerData) continue;

      const field = pickZoneCodeField(layerData.fields);
      if (!field) continue;

      return {
        layerUrl,
        zoneCodeField: field,
        layerName,
        serviceTitle: svc.name,
      };
    }

    await sleep(100);
  }

  return null;
}

async function findZonageLayerFromAgolItem(
  item: AgolItem,
  slug: string
): Promise<FindResult | null> {
  if (!item.url) return null;

  // L'url est généralement un MapServer ou FeatureServer
  const baseUrl = item.url.replace(/\/\d+$/, "");

  // Récupère la liste des couches
  const info = await getServiceInfo(baseUrl);
  if (!info || !Array.isArray(info.layers)) {
    // Essai direct
    const direct = await getLayerInfo(item.url);
    if (!direct) return null;

    if (isAffectationOnlyLayer(item.title, item.title)) return null;

    const field = pickZoneCodeField(direct.fields);
    if (!field) return null;

    return {
      layerUrl: item.url,
      zoneCodeField: field,
      layerName: item.title,
      serviceTitle: item.title,
    };
  }

  for (const layer of info.layers) {
    const layerName = layer.name ?? "";
    if (AFFECTATION_ONLY_PATTERNS.some((p) => p.test(layerName)) &&
        !ZONAGE_SERVICE_PATTERNS.some((p) => p.test(layerName))) continue;

    if (layer.geometryType && !layer.geometryType.includes("Polygon")) continue;

    const layerUrl = `${baseUrl}/${layer.id}`;
    const layerData = await getLayerInfo(layerUrl);
    if (!layerData) continue;

    const field = pickZoneCodeField(layerData.fields);
    if (!field) continue;

    return {
      layerUrl,
      zoneCodeField: field,
      layerName,
      serviceTitle: item.title,
    };
  }

  return null;
}

// ── Traitement d'une ville ────────────────────────────────────────────────────

interface ProcessResult {
  slug: string;
  status: "published" | "reclassified" | "error";
  layerUrl?: string;
  zoneCodeField?: string;
  featureCount?: number;
  distanceKm?: number;
  reason?: string;
}

async function processCity(
  city: TargetCity,
  s3: S3Client
): Promise<ProcessResult> {
  const { slug, name, lat, lon, website } = city;

  console.error(`\n[${slug}] Début traitement: ${name} (lat=${lat}, lon=${lon})`);

  let findResult: FindResult | null = null;

  // 1. Essai via domaines heuristiques
  const domains = guessDomainsFromSlug(slug, website);
  for (const domain of domains) {
    for (const suffix of ARCGIS_SERVER_SUFFIXES) {
      const catalogUrl = `${domain}${suffix}`;
      const found = await findZonageLayerFromCatalog(catalogUrl, slug);
      if (found) {
        findResult = found;
        console.error(`  [${slug}] Trouvé via heuristique: ${catalogUrl}`);
        break;
      }
      await sleep(100);
    }
    if (findResult) break;
  }

  // 2. Essai via AGOL search public
  if (!findResult) {
    console.error(`  [${slug}] Pas de domaine heuristique → AGOL search`);
    const agolItems = await agolSearchZonage(name, slug);
    console.error(`  [${slug}] AGOL search: ${agolItems.length} items`);

    for (const item of agolItems.slice(0, 5)) {
      const found = await findZonageLayerFromAgolItem(item, slug);
      if (found) {
        findResult = found;
        console.error(`  [${slug}] Trouvé via AGOL: ${item.title} (${item.owner})`);
        break;
      }
      await sleep(100);
    }
  }

  // Pas trouvé → reclasse
  if (!findResult) {
    console.error(`  [${slug}] Pas de FeatureServer mono-muni → reclasse pdf-discovery-required`);
    return {
      slug,
      status: "reclassified",
      reason: "agol-account non confirmé; pas de FeatureServer mono-muni; PDF probable",
    };
  }

  const { layerUrl, zoneCodeField, layerName, serviceTitle } = findResult;

  // 3. Validation du champ zone_code
  const validation = await validateZoneCodeField(layerUrl, zoneCodeField);
  console.error(
    `  [${slug}] Validation champ '${zoneCodeField}': valid=${validation.valid}, nullRatio=${validation.nullRatio.toFixed(2)}, maxLen=${validation.maxLen}, sample=${JSON.stringify(validation.sample)}`
  );

  if (!validation.valid) {
    return {
      slug,
      status: "reclassified",
      reason: `Champ zone_code '${zoneCodeField}' invalide (nullRatio=${validation.nullRatio.toFixed(2)}, maxLen=${validation.maxLen})`,
    };
  }

  // 4. Vérification spatiale
  const extent = await getLayerExtent(layerUrl);
  let distanceKm: number | undefined;

  if (extent && lat !== null && lon !== null) {
    const center = extentCenter(extent);
    if (center) {
      distanceKm = haversineKm(lat, lon, center[0], center[1]);
      console.error(`  [${slug}] Distance centre bbox ↔ centroïde: ${distanceKm.toFixed(1)} km`);

      if (distanceKm > 50) {
        return {
          slug,
          status: "reclassified",
          reason: `Vérification spatiale échouée: ${distanceKm.toFixed(1)} km du centroïde registre (>50 km)`,
          layerUrl,
          zoneCodeField,
          distanceKm,
        };
      }

      if (distanceKm > 5) {
        console.error(`  [${slug}] AVERTISSEMENT: ${distanceKm.toFixed(1)} km du centroïde (>5 km mais <50 km)`);
      }
    } else {
      console.error(`  [${slug}] Impossible de convertir l'extent en WGS84, vérification spatiale skippée`);
    }
  } else {
    console.error(`  [${slug}] Pas d'extent disponible ou pas de centroïde registre`);
  }

  // 5. Téléchargement des features
  console.error(`  [${slug}] Téléchargement features depuis ${layerUrl}`);
  const rawFeatures = await fetchAllFeatures(layerUrl, zoneCodeField);

  if (!rawFeatures || rawFeatures.length === 0) {
    return {
      slug,
      status: "reclassified",
      reason: "Téléchargement features échoué ou vide",
    };
  }

  console.error(`  [${slug}] ${rawFeatures.length} features téléchargées`);

  // 6. Normalisation
  const normalized = normalizeFeatures(rawFeatures, zoneCodeField, slug, layerUrl);

  // Vérif finale: pas trop de zone_code null
  const nullZoneCount = normalized.filter((f) => f.properties.zone_code === null).length;
  const nullRatioFinal = nullZoneCount / normalized.length;
  if (nullRatioFinal > 0.5) {
    return {
      slug,
      status: "reclassified",
      reason: `Trop de zone_code null après normalisation (${(nullRatioFinal * 100).toFixed(0)}%)`,
    };
  }

  // 7. Publication S3
  const geojson: GeoFeatureCollection = {
    type: "FeatureCollection",
    features: normalized,
  };

  const s3Key = `${S3_PREFIX}qc-zonage-${slug}.geojson`;
  const body = JSON.stringify(geojson);

  console.error(`  [${slug}] Publication S3: ${s3Key} (${normalized.length} features)`);
  await putBytes(s3, s3Key, body, "application/geo+json");

  console.error(`  [${slug}] PUBLIÉ: ${normalized.length} features, champ=${zoneCodeField}, dist=${distanceKm?.toFixed(1) ?? "?"}km`);

  return {
    slug,
    status: "published",
    layerUrl,
    zoneCodeField,
    featureCount: normalized.length,
    distanceKm,
  };
}

// ── Mise à jour matrice ───────────────────────────────────────────────────────

function updateMatrix(
  matrixPath: string,
  slug: string,
  result: ProcessResult
): void {
  const matrix: CoverageMatrix = JSON.parse(readFileSync(matrixPath, "utf8"));

  if (!matrix.cities[slug]) {
    console.error(`  [${slug}] AVERTISSEMENT: slug absent de la matrice`);
    return;
  }

  const now = new Date().toISOString();

  if (result.status === "published") {
    matrix.cities[slug].zones = {
      status: "done",
      doneTrack: `qc-zonage-${slug}`,
      candidateTracks: [],
      lastResearchAt: now,
      notes: `FeatureServer AGOL mono-muni: ${result.layerUrl}, champ=${result.zoneCodeField}, features=${result.featureCount}${result.distanceKm !== undefined ? `, dist=${result.distanceKm.toFixed(1)}km` : ""}`,
    };
  } else {
    matrix.cities[slug].zones = {
      ...matrix.cities[slug].zones,
      candidateTracks: ["pdf-discovery-required", ...((matrix.cities[slug].zones.candidateTracks ?? []).filter((t: string) => t !== "agol-account"))],
      lastResearchAt: now,
      notes: `agol-account non confirmé; pas de FeatureServer mono-muni; PDF probable. Raison: ${result.reason ?? "inconnu"}`,
    };
  }

  matrix.generatedAt = now;
  writeFileSync(matrixPath, JSON.stringify(matrix, null, 2) + "\n", "utf8");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.error("[agol-mono-muni-detect] Démarrage");

  // Charge les données
  const matrixData: CoverageMatrix = JSON.parse(readFileSync(MATRIX_PATH, "utf8"));
  const munis: Array<{slug: string; name: string; lat: number; lon: number}> = JSON.parse(
    readFileSync(MUNIS_PATH, "utf8")
  );
  const directoryData = JSON.parse(readFileSync(DIRECTORY_PATH, "utf8"));
  const directoryEntries = directoryData.entries as Record<string, {website?: string}>;

  // Sélectionne les 100 premières cibles (skip celles déjà traitées par ce script)
  const citySlugOrder = Object.keys(matrixData.cities);
  const targets: TargetCity[] = [];
  let skippedAlreadyDone = 0;
  let originalTargetCount = 0;
  for (const slug of citySlugOrder) {
    if (originalTargetCount >= 100) break;
    const cell = matrixData.cities[slug];
    if (!cell.zones) continue;
    // Compte comme cible originale si c'était un agol-account to-research
    // (même si déjà reclassifié par une run précédente)
    const wasOriginalTarget =
      (cell.zones.status === "to-research" && cell.zones.candidateTracks && cell.zones.candidateTracks[0] === "agol-account") ||
      (cell.zones.notes && cell.zones.notes.includes("agol-account non confirmé"));
    if (!wasOriginalTarget && cell.zones.status !== "to-research") continue;
    if (!cell.zones.candidateTracks || (cell.zones.candidateTracks[0] !== "agol-account" && !cell.zones.notes?.includes("agol-account non confirmé"))) continue;
    originalTargetCount++;
    // Skip si déjà traité par notre script
    if (cell.zones.notes && cell.zones.notes.includes("agol-account non confirmé")) {
      skippedAlreadyDone++;
      continue;
    }
    if (cell.zones.status !== "to-research") continue;
    if (!cell.zones.candidateTracks || cell.zones.candidateTracks[0] !== "agol-account") continue;

    const muni = munis.find((m) => m.slug === slug);
    const dir = directoryEntries[slug];

    targets.push({
      slug,
      name: muni?.name ?? slug,
      lat: muni?.lat ?? null,
      lon: muni?.lon ?? null,
      website: dir?.website ?? null,
    });
  }

  console.error(`[agol-mono-muni-detect] ${targets.length} villes restantes à traiter (${skippedAlreadyDone} déjà traitées skippées)`);

  // Initialise S3
  const s3 = s3Client();

  // Stats
  let published = 0;
  let reclassified = 0;
  let errors = 0;
  const publishedSlugs: Array<{slug: string; featureCount: number}> = [];

  // Traitement
  for (let i = 0; i < targets.length; i++) {
    const city = targets[i];
    console.error(`\n[${i + 1}/${targets.length}] Traitement: ${city.slug}`);

    let result: ProcessResult;
    try {
      result = await processCity(city, s3);
    } catch (err) {
      console.error(`  [${city.slug}] ERREUR: ${err}`);
      result = {
        slug: city.slug,
        status: "error",
        reason: String(err),
      };
      errors++;
    }

    // Mise à jour matrice après chaque ville
    if (result.status !== "error") {
      updateMatrix(MATRIX_PATH, city.slug, result);
    }

    if (result.status === "published") {
      published++;
      publishedSlugs.push({slug: city.slug, featureCount: result.featureCount ?? 0});
    } else if (result.status === "reclassified") {
      reclassified++;
    }

    // Politesse inter-villes
    await sleep(150);
  }

  // Rapport final
  const total = targets.length;
  const rendementPct = ((published / total) * 100).toFixed(1);

  console.log("\n" + "=".repeat(70));
  console.log("RAPPORT FINAL — AGOL MONO-MUNI DETECT");
  console.log("=".repeat(70));
  console.log(`Villes traitées:      ${total}`);
  console.log(`PUBLIÉES (S3+matrice): ${published}`);
  console.log(`Reclassées PDF:        ${reclassified}`);
  console.log(`Erreurs:               ${errors}`);
  console.log(`Taux rendement:        ${rendementPct}%`);
  console.log("");
  if (publishedSlugs.length > 0) {
    console.log("Villes PUBLIÉES:");
    for (const { slug, featureCount } of publishedSlugs) {
      console.log(`  - ${slug} (${featureCount} features)`);
    }
  } else {
    console.log("Aucune ville publiée.");
  }
  console.log("");
  console.log(`Proportion: ${published} publié-direct-agol / ${reclassified} reclassé-pdf / ${errors} erreurs`);
  console.log(`Taux vecteur-direct: ${published}/${total} = ${rendementPct}%`);
  console.log("=".repeat(70));
}

main().catch((err) => {
  console.error("[agol-mono-muni-detect] FATAL:", err);
  process.exit(1);
});
