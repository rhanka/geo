/**
 * Primitives partagées de découverte/vérification ArcGIS zonage QC.
 * Utilisées par harvest.mjs (voie AGOL) et harvest-mamh.mjs (voie annuaire MAMH).
 *
 * Politesse (ADR-0007) : timeout 8 s, UA "sentropic-geo/0.1", pas de retry sur
 * 403/404, délai inter-requête, pas de git commit.
 */

import { writeFile, readFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export const UA = "sentropic-geo/0.1";
export const TIMEOUT_MS = 8_000;
export const POLITE_DELAY_MS = 250;

export const SHARED_OUT =
  "/home/antoinefa/src/_acquisition-shared/qc-arcgis-zonage-endpoints.json";
export const REGISTRY_OUT =
  "/home/antoinefa/src/geo/packages/geo-sources-americas/src/ca-qc-zonage-arcgis/registry.generated.json";

export const QC_STRICT = { minLon: -79.8, minLat: 44.9, maxLon: -57.0, maxLat: 62.6 };

/** Polygone-frontière simplifié du Québec — sépare QC de NB/ON (cf. harvest.mjs). */
export const QC_POLYGON = [
  [-79.8, 44.9], [-74.7, 45.0], [-74.4, 45.0], [-71.5, 45.0], [-69.9, 47.4],
  [-68.4, 47.9], [-66.9, 48.0], [-66.4, 48.0], [-66.0, 48.05], [-65.9, 48.4],
  [-64.0, 48.5], [-63.5, 48.9], [-64.0, 49.3], [-66.0, 50.0], [-60.0, 51.5],
  [-57.0, 51.5], [-57.0, 62.6], [-79.8, 62.6], [-79.8, 44.9],
];

/**
 * Denylist de municipalités/serveurs hors-QC dont la géométrie chevauche le
 * Québec sur la frontière fluviale (St-Laurent / Outaouais), où aucun polygone
 * grossier ne sépare proprement QC de l'Ontario. Identifiées par owner/host.
 * (Ex. Cornwall ON, Ottawa ON.)
 */
export const NON_QC_OWNER_DENYLIST = [
  /cornwall/i, /ottawa/i, /utoronto.*toronto/i, /cityof(?!.*qc)/i,
];
export const NON_QC_HOST_DENYLIST = [/ottawa\.ca/i, /cornwall\.ca/i];

/** True si l'endpoint provient d'un serveur/owner hors-QC connu. */
export function isDenylistedNonQc({ owner = "", title = "", serviceUrl = "" }) {
  const ownerHay = `${owner} ${title}`;
  if (NON_QC_HOST_DENYLIST.some((re) => re.test(serviceUrl))) return true;
  // owner denylist : seulement les villes ON limitrophes explicites
  if (/cornwall|ottawa/i.test(ownerHay)) return true;
  return false;
}

export const ZONAGE_NAME_OK =
  /zonag|zoning|urbanis|affectation|zone[_\s]?municip|plan[_\s]?urban/i;
export const ZONAGE_NAME_EXCLUDE =
  /sismiqu|seismic|inondation|flood|agricole_provincial|risque|hazard|aleas?|climat|neige|snow|electoral|scolaire/i;

export const ZONE_FIELD_PATTERNS = [
  /^zonage$/i, /^no_?zone$/i, /^zone_?$/i, /^code_?zone$/i, /^zone_?code$/i,
  /^num_?zone$/i, /^id_?zone$/i, /^zone_?id$/i, /zonage/i, /^zone/i, /zone$/i,
];

// ── Réseau poli ───────────────────────────────────────────────────────────────

let lastFetchAt = 0;
export async function politeFetchJson(url) {
  const wait = POLITE_DELAY_MS - (Date.now() - lastFetchAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    lastFetchAt = Date.now();
    if (!res.ok) return { ok: false, status: res.status, data: null };
    const text = await res.text();
    try {
      return { ok: true, status: res.status, data: JSON.parse(text) };
    } catch {
      return { ok: false, status: res.status, data: null };
    }
  } catch (err) {
    return { ok: false, status: 0, data: null, err: String(err?.name ?? err) };
  } finally {
    clearTimeout(timer);
  }
}

// ── Géo QC ────────────────────────────────────────────────────────────────────

export function pointInPolygon(lon, lat, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function lonLatInQc(lon, lat) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
  if (
    lon < QC_STRICT.minLon || lon > QC_STRICT.maxLon ||
    lat < QC_STRICT.minLat || lat > QC_STRICT.maxLat
  ) return false;
  return pointInPolygon(lon, lat, QC_POLYGON);
}

export function featurePointWgs84(feature) {
  const g = feature?.geometry;
  if (!g || typeof g !== "object") return null;
  if (Array.isArray(g.rings) && g.rings[0]?.[0]) {
    const [lon, lat] = g.rings[0][0];
    return [Number(lon), Number(lat)];
  }
  if (Number.isFinite(g.x) && Number.isFinite(g.y)) return [Number(g.x), Number(g.y)];
  return null;
}

export function detectZoneField(fields) {
  const names = (fields ?? [])
    .map((f) => (f && typeof f === "object" ? String(f.name ?? "") : ""))
    .filter(Boolean);
  for (const pat of ZONE_FIELD_PATTERNS) {
    const hit = names.find((n) => pat.test(n));
    if (hit) return hit;
  }
  return null;
}

// ── Vérification live d'un service (URL …/FeatureServer ou …/MapServer) ───────

/**
 * Vérifie live un service ArcGIS. Retourne {serviceUrl(/N), zoneCodeField, …}
 * si une couche polygonale QC avec champ zone est trouvée, sinon null.
 */
export async function verifyService(serviceUrl, hint = {}) {
  // Exiger HTTPS (endpoints non chiffrés écartés ; écarte aussi des serveurs
  // hors-QC connus servant en http, ex. maps.ottawa.ca / Ontario).
  if (!/^https:\/\//i.test(serviceUrl)) return null;
  // Denylist hors-QC (frontière fluviale ON où le polygone ne sépare pas).
  if (isDenylistedNonQc({ ...hint, serviceUrl })) return null;
  const svc = await politeFetchJson(`${serviceUrl}?f=json`);
  if (!svc.ok || !svc.data || svc.data.error) return null;

  let layers = [];
  if (Array.isArray(svc.data.layers) && svc.data.layers.length > 0) {
    layers = svc.data.layers
      .filter((l) => l && typeof l === "object")
      .map((l) => ({ id: Number(l.id ?? 0), name: String(l.name ?? "") }));
  } else if (typeof svc.data.geometryType === "string") {
    layers = [{ id: 0, name: String(svc.data.name ?? "") }];
  } else {
    return null;
  }

  layers.sort((a, b) => {
    const za = ZONAGE_NAME_OK.test(a.name) ? 0 : 1;
    const zb = ZONAGE_NAME_OK.test(b.name) ? 0 : 1;
    return za - zb;
  });

  for (const layer of layers) {
    const layerUrl = `${serviceUrl}/${layer.id}`;
    const lm = await politeFetchJson(`${layerUrl}?f=json`);
    if (!lm.ok || !lm.data || lm.data.error) continue;

    const geomType = String(lm.data.geometryType ?? "");
    if (!/Polygon/i.test(geomType)) continue;

    const zoneField = detectZoneField(lm.data.fields);
    if (!zoneField) continue;

    const q =
      `${layerUrl}/query?where=1%3D1&outFields=${encodeURIComponent(zoneField)}` +
      `&resultRecordCount=1&returnGeometry=true&outSR=4326&f=json`;
    const qr = await politeFetchJson(q);
    if (!qr.ok || !qr.data || qr.data.error) continue;
    if (!Array.isArray(qr.data.features) || qr.data.features.length === 0) continue;

    const pt = featurePointWgs84(qr.data.features[0]);
    if (!pt || !lonLatInQc(pt[0], pt[1])) continue;

    return {
      serviceUrl: layerUrl,
      zoneCodeField: zoneField,
      title: hint.title ?? "",
      owner: hint.owner ?? "",
      layerName: layer.name,
      geometryType: geomType,
      sampleLonLat: pt,
    };
  }
  return null;
}

// ── Persistance (flux pour A3) ────────────────────────────────────────────────

export async function readJsonArray(path) {
  try {
    const raw = await readFile(path, "utf8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** Fusionne `verified` avec l'existant (par serviceUrl) et ré-écrit les 2 sorties. */
export async function writeSharedRegistry(verified) {
  const existing = await readJsonArray(SHARED_OUT);
  const byUrl = new Map();
  for (const e of existing) if (e && e.serviceUrl) byUrl.set(e.serviceUrl, e);
  for (const v of verified) byUrl.set(v.serviceUrl, v);
  const merged = [...byUrl.values()].sort((a, b) =>
    String(a.citySlug).localeCompare(String(b.citySlug)),
  );
  await mkdir(dirname(SHARED_OUT), { recursive: true });
  await writeFile(SHARED_OUT, JSON.stringify(merged, null, 2) + "\n", "utf8");
  await mkdir(dirname(REGISTRY_OUT), { recursive: true });
  await writeFile(REGISTRY_OUT, JSON.stringify(merged, null, 2) + "\n", "utf8");
  return merged.length;
}

// ── Probe d'un catalogue ArcGIS REST (voie MAMH) ──────────────────────────────

export const ARCGIS_SERVER_SUFFIXES = [
  "/arcgis/rest/services",
  "/server/rest/services",
  "/gis/rest/services",
];

/** Sonde un catalogue ArcGIS REST → liste {name,type} ou null. */
export async function probeCatalog(catalogUrl) {
  const { ok, data } = await politeFetchJson(`${catalogUrl}?f=json`);
  if (!ok || !data) return null;
  const out = [];
  // services racine
  if (Array.isArray(data.services)) {
    for (const s of data.services) {
      if (s && typeof s === "object") {
        out.push({ name: String(s.name ?? ""), type: String(s.type ?? "") });
      }
    }
  }
  // dossiers (folders) — on renvoie aussi pour exploration superficielle (1 niveau)
  const folders = Array.isArray(data.folders) ? data.folders.map(String) : [];
  if (out.length === 0 && folders.length === 0) return null;
  return { services: out, folders, base: catalogUrl };
}
