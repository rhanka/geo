#!/usr/bin/env node
/**
 * Harvester — découverte À L'ÉCHELLE des endpoints ArcGIS REST de zonage
 * municipal du Québec, chacun VÉRIFIÉ live.
 *
 * Voie scalable (la plus rentable) : l'API de recherche ArcGIS Online (AGOL)
 *   https://www.arcgis.com/sharing/rest/search
 * On pagine plusieurs requêtes (zonage, zoning, urbanisme, affectation) filtrées
 * par bounding-box du Québec, on déduplique par URL de service, puis pour CHAQUE
 * candidat on VÉRIFIE live :
 *   - le service répond en ?f=json (métadonnées),
 *   - au moins une couche a geometryType = esriGeometryPolygon,
 *   - un champ "code de zone" plausible est présent (détecté par patterns),
 *   - l'extent de la couche tombe DANS le Québec (filtre anti-faux-positif :
 *     le bbox AGOL déborde sur le Nouveau-Brunswick / l'Ontario),
 *   - une query 1 feature renvoie HTTP 200 sans auth.
 *
 * On n'enregistre QUE les endpoints live-vérifiés (verifiedAt ISO).
 *
 * Politesse (ADR-0007) : timeout 8 s, UA "sentropic-geo/0.1", pas de retry sur
 * 403/404, pas de scan agressif (délai inter-requête), pas de git commit.
 *
 * Idempotence / flux : à chaque LOT de N endpoints vérifiés, on ré-écrit
 *   /home/antoinefa/src/_acquisition-shared/qc-arcgis-zonage-endpoints.json
 * (l'agent A3 le relit en flux). On fusionne avec l'existant par serviceUrl.
 *
 * Usage :
 *   node scripts/ca-qc-zonage-arcgis/harvest.mjs [--max-pages N] [--max-verify N]
 */

import { writeFile, readFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

// ── Constantes ────────────────────────────────────────────────────────────────

const UA = "sentropic-geo/0.1";
const TIMEOUT_MS = 8_000;
const POLITE_DELAY_MS = 250; // délai inter-requête réseau
const AGOL_SEARCH = "https://www.arcgis.com/sharing/rest/search";

const SHARED_OUT =
  "/home/antoinefa/src/_acquisition-shared/qc-arcgis-zonage-endpoints.json";
const REGISTRY_OUT =
  "/home/antoinefa/src/geo/packages/geo-sources-americas/src/ca-qc-zonage-arcgis/registry.generated.json";

/** Bounding-box approximative du Québec (lon/lat WGS84). Déborde un peu sur
 *  NB/ON — on resserre ensuite par vérification d'extent + heuristique QC. */
const QC_BBOX = "-79.8,44.9,-57.0,62.6";

/** Extent strict du Québec — pré-filtre rectangulaire grossier (rapide). */
const QC_STRICT = { minLon: -79.8, minLat: 44.9, maxLon: -57.0, maxLat: 62.6 };

/**
 * Polygone-frontière simplifié du Québec (lon,lat WGS84). Grossier mais conçu
 * pour SÉPARER le Québec du Nouveau-Brunswick et de l'Ontario : un bbox seul
 * échoue car QC et NB s'imbriquent (frontière le long du bassin versant).
 * Validé : exclut Miramichi/Moncton/Edmundston (NB), inclut Gaspé/Percé (QC).
 * Le test final reste géométrique et live (point réel d'un polygone échantillon).
 */
const QC_POLYGON = [
  [-79.8, 44.9], [-74.7, 45.0], [-74.4, 45.0], [-71.5, 45.0], [-69.9, 47.4],
  [-68.4, 47.9], [-66.9, 48.0], [-66.4, 48.0], [-66.0, 48.05], [-65.9, 48.4],
  [-64.0, 48.5], [-63.5, 48.9], [-64.0, 49.3], [-66.0, 50.0], [-60.0, 51.5],
  [-57.0, 51.5], [-57.0, 62.6], [-79.8, 62.6], [-79.8, 44.9],
];

/** Point-in-polygon (ray casting). */
function pointInPolygon(lon, lat, poly) {
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

/** Requêtes AGOL (mot-clé) — couvre FR + EN. */
const QUERIES = ["zonage", "urbanisme", "affectation", "zoning"];

/** Types AGOL exploitables (ont une URL de service REST). */
const USABLE_TYPES = new Set(["Feature Service", "Map Service"]);

/** Patterns de nom de service indiquant du zonage (vs sismique/agricole/etc.). */
const ZONAGE_NAME_OK = /zonag|zoning|urbanis|affectation|zone[_\s]?municip|plan[_\s]?urban/i;

/** Patterns de nom de service À EXCLURE (zonage non municipal). */
const ZONAGE_NAME_EXCLUDE =
  /sismiqu|seismic|inondation|flood|agricole_provincial|risque|hazard|aleas?|climat|neige|snow|electoral|scolaire/i;

/** Patterns de champ "code de zone" (ordre = priorité). */
const ZONE_FIELD_PATTERNS = [
  /^zonage$/i,
  /^no_?zone$/i,
  /^zone_?$/i,
  /^code_?zone$/i,
  /^zone_?code$/i,
  /^num_?zone$/i,
  /^id_?zone$/i,
  /^zone_?id$/i,
  /zonage/i,
  /^zone/i,
  /zone$/i,
];

// ── Réseau (poli) ─────────────────────────────────────────────────────────────

let lastFetchAt = 0;
async function politeFetchJson(url) {
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
    // pas de retry sur 403/404 (non-scrapable)
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

// ── Étape 1 : recherche AGOL paginée → candidats ──────────────────────────────

/** Pagine une requête AGOL dans le bbox QC. Retourne les items bruts. */
async function searchAgol(query, maxPages) {
  const items = [];
  let start = 1;
  for (let page = 0; page < maxPages; page++) {
    const url =
      `${AGOL_SEARCH}?q=${encodeURIComponent(query)}` +
      `&bbox=${encodeURIComponent(QC_BBOX)}` +
      `&f=json&num=100&start=${start}`;
    const { ok, data } = await politeFetchJson(url);
    if (!ok || !data || !Array.isArray(data.results)) break;
    for (const r of data.results) items.push(r);
    const next = Number(data.nextStart);
    if (!Number.isFinite(next) || next < 0) break;
    start = next;
    if (data.results.length === 0) break;
  }
  return items;
}

/** extent AGOL : [[minLon,minLat],[maxLon,maxLat]] — centre dans QC strict ? */
function agolExtentInQc(extent) {
  if (!Array.isArray(extent) || extent.length !== 2) return false;
  const [a, b] = extent;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  const cLon = (Number(a[0]) + Number(b[0])) / 2;
  const cLat = (Number(a[1]) + Number(b[1])) / 2;
  return (
    cLon >= QC_STRICT.minLon &&
    cLon <= QC_STRICT.maxLon &&
    cLat >= QC_STRICT.minLat &&
    cLat <= QC_STRICT.maxLat
  );
}

/** Convertit un item AGOL en candidat exploitable, ou null. */
function toCandidate(item) {
  const url = typeof item.url === "string" ? item.url.replace(/\/+$/, "") : "";
  if (!url) return null;
  if (!/^https:\/\//i.test(url)) return null; // exiger HTTPS (écarte ex. http Ottawa/ON)
  if (!USABLE_TYPES.has(item.type)) return null;
  if (!/\/(Feature|Map)Server$/i.test(url)) return null;
  const title = String(item.title ?? "");
  const svcName = url.split("/").slice(-2)[0] ?? "";
  const hay = `${title} ${svcName}`;
  if (!ZONAGE_NAME_OK.test(hay)) return null;
  if (ZONAGE_NAME_EXCLUDE.test(hay)) return null;
  // denylist hors-QC (villes ON limitrophes sur la frontière fluviale)
  const ownerHost = `${String(item.owner ?? "")} ${title} ${url}`;
  if (/cornwall|ottawa/i.test(ownerHost)) return null;
  // filtre QC strict sur l'extent AGOL (anti NB/ON)
  if (!agolExtentInQc(item.extent)) return null;
  return {
    serviceUrl: url,
    title,
    owner: String(item.owner ?? ""),
    agolId: String(item.id ?? ""),
  };
}

// ── Étape 2 : vérification live d'un service ──────────────────────────────────

/** Détecte un champ "code de zone" dans la liste de champs d'une couche. */
function detectZoneField(fields) {
  const names = (fields ?? [])
    .map((f) => (f && typeof f === "object" ? String(f.name ?? "") : ""))
    .filter(Boolean);
  for (const pat of ZONE_FIELD_PATTERNS) {
    const hit = names.find((n) => pat.test(n));
    if (hit) return hit;
  }
  return null;
}

/** Une longitude/latitude WGS84 tombe-t-elle dans le Québec ? (bbox + polygone) */
function lonLatInQc(lon, lat) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
  if (
    lon < QC_STRICT.minLon || lon > QC_STRICT.maxLon ||
    lat < QC_STRICT.minLat || lat > QC_STRICT.maxLat
  ) {
    return false;
  }
  return pointInPolygon(lon, lat, QC_POLYGON);
}

/** Extrait un point [lon,lat] représentatif d'une feature ArcGIS (geom WGS84). */
function featurePointWgs84(feature) {
  const g = feature?.geometry;
  if (!g || typeof g !== "object") return null;
  // polygon → premier ring, premier sommet
  if (Array.isArray(g.rings) && g.rings[0]?.[0]) {
    const [lon, lat] = g.rings[0][0];
    return [Number(lon), Number(lat)];
  }
  if (Number.isFinite(g.x) && Number.isFinite(g.y)) return [Number(g.x), Number(g.y)];
  return null;
}

/**
 * Vérifie live un service candidat. Retourne un endpoint vérifié {serviceUrl,
 * zoneCodeField, ...} ou null. serviceUrl pointe vers la COUCHE (…/N).
 */
async function verifyService(cand) {
  // 1) métadonnées du service → liste des couches
  const svc = await politeFetchJson(`${cand.serviceUrl}?f=json`);
  if (!svc.ok || !svc.data) return null;
  if (svc.data.error) return null; // ex. token required

  let layerIds = [];
  if (Array.isArray(svc.data.layers) && svc.data.layers.length > 0) {
    layerIds = svc.data.layers
      .filter((l) => l && typeof l === "object")
      .map((l) => ({ id: Number(l.id ?? 0), name: String(l.name ?? "") }));
  } else if (typeof svc.data.geometryType === "string") {
    // déjà une couche directe
    layerIds = [{ id: 0, name: String(svc.data.name ?? "") }];
  } else {
    return null;
  }

  // Priorise les couches dont le nom évoque le zonage.
  layerIds.sort((a, b) => {
    const za = ZONAGE_NAME_OK.test(a.name) ? 0 : 1;
    const zb = ZONAGE_NAME_OK.test(b.name) ? 0 : 1;
    return za - zb;
  });

  for (const layer of layerIds) {
    const layerUrl = `${cand.serviceUrl}/${layer.id}`;
    const lm = await politeFetchJson(`${layerUrl}?f=json`);
    if (!lm.ok || !lm.data || lm.data.error) continue;

    const geomType = String(lm.data.geometryType ?? "");
    if (!/Polygon/i.test(geomType)) continue;

    const zoneField = detectZoneField(lm.data.fields);
    if (!zoneField) continue; // pas de champ code de zone → on rejette

    // 2) query 1 feature AVEC géométrie reprojetée en WGS84 (outSR=4326)
    //    → HTTP 200, JSON valide, ET la géométrie tombe DANS le Québec.
    //    C'est le vrai discriminant QC (anti NB/ON), géométrique et live.
    const q =
      `${layerUrl}/query?where=1%3D1&outFields=${encodeURIComponent(zoneField)}` +
      `&resultRecordCount=1&returnGeometry=true&outSR=4326&f=json`;
    const qr = await politeFetchJson(q);
    if (!qr.ok || !qr.data || qr.data.error) continue;
    if (!Array.isArray(qr.data.features) || qr.data.features.length === 0) continue;

    const pt = featurePointWgs84(qr.data.features[0]);
    if (!pt || !lonLatInQc(pt[0], pt[1])) continue; // hors Québec → rejet

    return {
      serviceUrl: layerUrl,
      zoneCodeField: zoneField,
      title: cand.title,
      owner: cand.owner,
      layerName: layer.name,
      geometryType: geomType,
      sampleLonLat: pt,
    };
  }
  return null;
}

// ── slug de ville (best-effort, à partir du titre/owner) ──────────────────────

const QC_CITY_HINTS = [
  "longueuil", "gatineau", "saguenay", "levis", "lévis", "trois-rivieres",
  "trois-rivières", "sherbrooke", "quebec", "québec", "repentigny", "rimouski",
  "rouyn-noranda", "shawinigan", "laval", "montreal", "montréal", "terrebonne",
  "blainville", "mirabel", "drummondville", "saint-jean", "saint-jérôme",
  "saint-jerome", "granby", "beloeil", "victoriaville", "salaberry",
  "chateauguay", "châteauguay", "mascouche", "boucherville", "brossard",
  "dollard", "vaudreuil", "magog", "sept-iles", "sept-îles", "alma", "joliette",
  "varennes", "candiac", "chambly", "sorel", "thetford", "matane", "amos",
  "val-d-or", "val-dor", "baie-comeau", "rivière-du-loup", "riviere-du-loup",
];

function slugify(s) {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function guessCitySlug(ep) {
  const hay = `${ep.title} ${ep.owner} ${ep.serviceUrl}`.toLowerCase();
  for (const c of QC_CITY_HINTS) {
    if (hay.includes(c)) return slugify(c);
  }
  // owner type "VilleXxx" / "Ville_Xxx"
  const m = ep.owner.match(/ville[_\s-]?([a-zà-ÿ-]+)/i);
  if (m && m[1]) return slugify(m[1]);
  // fallback : slug de l'owner
  return slugify(ep.owner || ep.title || "inconnu");
}

// ── Persistance (flux pour A3) ────────────────────────────────────────────────

async function readJsonArray(path) {
  try {
    const raw = await readFile(path, "utf8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function writeSharedRegistry(verified) {
  // fusion par serviceUrl avec l'existant (idempotence)
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

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const maxPages = Number(
    (args.find((a) => a.startsWith("--max-pages=")) ?? "").split("=")[1] ?? 6,
  );
  const maxVerify = Number(
    (args.find((a) => a.startsWith("--max-verify=")) ?? "").split("=")[1] ?? 1000,
  );

  console.error(`[harvest] AGOL search (bbox QC) — queries: ${QUERIES.join(", ")}`);
  const rawItems = [];
  for (const q of QUERIES) {
    const items = await searchAgol(q, maxPages);
    console.error(`[harvest]   q="${q}" → ${items.length} items`);
    rawItems.push(...items);
  }

  // dédup candidats par serviceUrl
  const candByUrl = new Map();
  let usable = 0;
  for (const it of rawItems) {
    const c = toCandidate(it);
    if (!c) continue;
    usable++;
    if (!candByUrl.has(c.serviceUrl)) candByUrl.set(c.serviceUrl, c);
  }
  const candidates = [...candByUrl.values()];
  console.error(
    `[harvest] candidats QC zonage (post-filtre) : ${candidates.length} uniques (${usable} bruts)`,
  );

  const verifiedByUrl = new Map();
  let done = 0;
  const flushEvery = 10;

  for (const cand of candidates) {
    if (done >= maxVerify) break;
    done++;
    let res = null;
    try {
      res = await verifyService(cand);
    } catch (e) {
      res = null;
    }
    if (res) {
      const citySlug = guessCitySlug(res);
      const ep = {
        citySlug,
        serviceUrl: res.serviceUrl,
        zoneCodeField: res.zoneCodeField,
        verifiedAt: new Date().toISOString(),
        source: "agol-search",
        meta: {
          title: res.title,
          owner: res.owner,
          layerName: res.layerName,
          geometryType: res.geometryType,
        },
      };
      verifiedByUrl.set(ep.serviceUrl, ep);
      console.error(
        `[harvest]   ✓ ${citySlug} — ${res.serviceUrl} (champ: ${res.zoneCodeField})`,
      );
      if (verifiedByUrl.size % flushEvery === 0) {
        const total = await writeSharedRegistry([...verifiedByUrl.values()]);
        console.error(`[harvest]   …flush : ${total} endpoints au total dans le registre partagé`);
      }
    }
    if (done % 25 === 0) {
      console.error(`[harvest] progress: ${done}/${candidates.length} vérifiés, ${verifiedByUrl.size} OK`);
    }
  }

  const total = await writeSharedRegistry([...verifiedByUrl.values()]);
  console.error(
    `\n[harvest] TERMINÉ — ${verifiedByUrl.size} endpoints vérifiés ce lot ; ` +
      `${total} au total dans ${SHARED_OUT}`,
  );

  // résumé machine-readable sur stdout
  console.log(
    JSON.stringify({
      candidates: candidates.length,
      verifiedThisRun: verifiedByUrl.size,
      totalInRegistry: total,
      sharedOut: SHARED_OUT,
      registryOut: REGISTRY_OUT,
    }),
  );
}

main().catch((e) => {
  console.error("[harvest] FATAL", e);
  process.exit(1);
});
