/**
 * zones-sigale-run.ts — récupère le ZONAGE municipal RÉGLEMENTAIRE des munis
 * servies par le portail SIGALE (Groupe Altus, `sigale.ca`), sans PDF ni crawl.
 *
 * DÉCOUVERTE (réseau du viewer, capturée via Playwright sur `sigale.ca/?mrc=330`) :
 * SIGALE n'est PAS un backend propriétaire opaque. Le viewer ASP.NET
 * (`sigale.ca/Main.aspx`) charge ses couches via un simple PROXY CORS
 * `sigale.ca/proxy/ProxyArcGIS.ashx?<url>` qui relaie un **ArcGIS MapServer PUBLIC
 * standard** hébergé chez Altus :
 *
 *   https://gis.altusquebec.com/arcgis/rest/services/MRC<mrc>/<codeMun>_Publique/MapServer
 *
 * où `<codeMun>` est le code géographique MAMH de la muni (ex. Saint-Apollinaire
 * = 33090, MRC Lotbinière = MRC330). Le MapServer est joignable EN DIRECT côté
 * serveur (pas de CORS, pas d'auth) — le proxy ne sert qu'à contourner CORS dans
 * le navigateur. On interroge donc l'API REST ArcGIS directement.
 *
 * Chaque service `<codeMun>_Publique` est DÉJÀ filtré à sa muni. La couche de
 * zonage réglementaire est le Feature Layer polygone nommé **"Zonage municipal"**
 * (id 16 dans le gabarit MRC330), champ code-zone RÉEL **`Zonage`** (ex. "37A",
 * "146C", "182R" — format QC chiffre-d'abord + classe d'usage). À NE PAS confondre
 * avec : "Grandes affectations" (SAD, id 50), "Zone verte" (id 14, CPTAQ),
 * `cl_zonage`/`Dominante` (libellé de classe, PAS un code). Discriminant muni :
 * `code_mun` (code MAMH) / `nom_mun` (domaine à valeurs codées des 18 munis).
 *
 * ANTI-INVENTION STRICTE (identique à obscura/opendata) : le champ `Zonage` est
 * validé VALEUR-PAR-VALEUR via `validateExplicitZoneField` (≥3 codes distincts,
 * ≥50% non-null, ≥50% à signature code-zone, ≤24 char, ni affectation ni id
 * séquentiel). Une couche qui ne servirait que de l'affectation / du numérique-nu
 * / du séquentiel est REJETÉE — aucun dépôt, aucun code reconstruit. Gate spatial
 * (centre bbox WGS84 ≈ centroïde registre). Aucun slug hors-registre.
 *
 * NE met PAS à jour la matrice (S3 = vérité ; `coverage-reconcile.ts` réconcilie).
 * Écrit un rapport JSON. Process unique, HTTP pur (pas de Chromium).
 *
 * USAGE :
 *   # les 18 munis de la MRC Lotbinière (défaut si --slugs absent) :
 *   npx tsx src/zones-sigale-run.ts --mrc 330 --deposit
 *   # un sous-ensemble :
 *   npx tsx src/zones-sigale-run.ts --slugs saint-apollinaire,saint-agapit --deposit
 *   # probe/classement seul (aucun dépôt) :
 *   npx tsx src/zones-sigale-run.ts --no-deposit
 *   options : --mrc <n> (déf 330) --zone-field <F> (déf auto→Zonage)
 *             --spatial-km <n> (déf 25) --out <file>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { S3Client } from "@aws-sdk/client-s3";
import { s3Client, putBytes, exists, copyObject, deleteObject } from "./lib/s3.js";
// Anti-invention value-based (agnostique du NOM de champ) — le MÊME gate que le
// dépôt obscura --service et opendata : rejette affectation/numérique-nu/séquentiel.
import { validateExplicitZoneField } from "./zones-obscura-run.js";
// Helpers géo partagés (WGS84).
import { positionsOf, haversineKm } from "./zones-wfs-run.js";

// ── Constantes ────────────────────────────────────────────────────────────────
const HERE = dirname(fileURLToPath(import.meta.url));
const MUNIS_PATH = resolve(HERE, "../../packages/qc-sources/src/geo/municipalities.qc.json");
const MUNI_DIRECTORY_PATH = resolve(HERE, "../../packages/qc-sources/src/geo/qc-municipal-directory.json");
const S3_PREFIX = "normalized/ca-qc-zonage/";
const ALTUS_BASE = "https://gis.altusquebec.com/arcgis/rest/services";
const HTTP_UA = "sentropic-geo/0.1";
const HTTP_TIMEOUT_MS = 25_000;
const MAX_FEATURES = 20_000;

// MRC ArcGIS folder → nom MRC du registre (pour dériver le lot de munis par défaut).
// N'ajouter une MRC ici qu'après avoir CONSTATÉ son gabarit SIGALE. Les folders
// ci-dessous ont été DÉCOUVERTS par énumération du répertoire REST public Altus
// (`gis.altusquebec.com/arcgis/rest/services` → dossiers `MRC<nnn>` → services
// `<codeMAMH>_Publique/MapServer`). Chaque nom correspond VERBATIM au champ `mrc`
// du registre focus (`municipalities.qc.json`) — la dérivation filtre par ce nom.
const MRC_DEFAULT_NAME: Record<string, string> = {
  "330": "Lotbinière",
  "030": "La Côte-de-Gaspé",
  "050": "Bonaventure",
  "060": "Avignon",
  "200": "L'Île-d'Orléans",
  "220": "La Jacques-Cartier",
  "380": "Bécancour",
  "410": "Le Haut-Saint-François",
  "980": "Le Golfe-du-Saint-Laurent",
};

// Couche de zonage réglementaire : nom "Zonage municipal". On EXCLUT explicitement
// les couches d'affectation / contrainte / zone agricole qui ne portent PAS le
// code-zone réglementaire (double garde-fou en amont du gate valeur).
const ZONAGE_LAYER_INCLUDE_RE = /zonage/i;
const ZONAGE_LAYER_EXCLUDE_RE = /affectat|grande|\bverte?\b|inonda|humide|urbanis|destructur|conservation|contrainte|patrimo|bo[iî]s/i;
// Champs à ne JAMAIS prendre comme code-zone (libellé de classe / métadonnée).
const ZONE_FIELD_EXCLUDE_RE = /affectat|^cl_|classe|dominante|^secteur$|^description$|reglement|règlement|adopte|adopté|certificat|^note|created|edited|vigueur|shape|objectid|superfic|^area$|code_?mun|nom_?mun|mamh/i;
// Signature d'un vrai nom de champ code-zone (préférence ; les VALEURS font foi).
const ZONE_FIELD_PREFER_RE = /^zonage$|^zone_?code$|^zone$|^num_?zone$|^no_?zone$|^code_?zone$|^codezonage$|^no_?zonage$|^zonage_?id$/i;
const MUNI_CODE_FIELD_RE = /^code_?mun$/i;

// ── Types ─────────────────────────────────────────────────────────────────────
interface MuniEntry { slug: string; name: string; mrc: string | null; lat: number; lon: number }
interface GeoFeature { type: "Feature"; geometry: { type: string; coordinates: unknown } | null; properties: Record<string, unknown> }
interface GeoFC { type: "FeatureCollection"; features: GeoFeature[] }
interface FieldInfo { name: string; type: string }
interface ArcLayer { id: number; name: string; type?: string; geometryType?: string }

interface SlugResult {
  slug: string;
  mamhCode: string | null;
  serviceUrl: string | null;
  zonageLayerUrl?: string;
  zoneField?: string;
  muniField?: string | null;
  featureCount?: number;
  distinctCodes?: number;
  distanceKm?: number;
  wasServed?: boolean;      // un dépôt zonage existait-il déjà (overlap/Δ)
  deposited: boolean;
  status:
    | "deposited"
    | "no-service"
    | "no-code"
    | "no-zonage-layer"
    | "zone-invalid"
    | "spatial-fail"
    | "error";
  detail: string;
}

// ── Args ──────────────────────────────────────────────────────────────────────
interface Args { slugs: string[]; mrc: string; deposit: boolean; zoneField?: string; spatialKm: number; outFile?: string }
function parseArgs(argv: string[]): Args {
  const get = (k: string): string | undefined => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const has = (k: string): boolean => argv.includes(`--${k}`);
  const csv = (k: string): string[] => (get(k) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const zoneField = get("zone-field")?.trim();
  return {
    slugs: csv("slugs"),
    mrc: (get("mrc") ?? "330").trim(),
    deposit: has("deposit") && !has("no-deposit"),
    spatialKm: Number(get("spatial-km") ?? 25),
    ...(zoneField ? { zoneField } : {}),
    ...(get("out") ? { outFile: get("out")!.trim() } : {}),
  };
}

// ── HTTP ──────────────────────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
async function fetchJson<T = unknown>(url: string, timeoutMs = HTTP_TIMEOUT_MS): Promise<T | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": HTTP_UA, accept: "application/json" } });
    if (!r.ok) return null;
    return JSON.parse(await r.text()) as T;
  } catch { return null; } finally { clearTimeout(t); }
}

async function loadAvailableSigaleCodes(mrc: string): Promise<Set<string>> {
  const folder = await fetchJson<{ services?: Array<{ name?: string; type?: string }> }>(`${ALTUS_BASE}/MRC${mrc}?f=json`);
  const codes = new Set<string>();
  for (const svc of folder?.services ?? []) {
    if (!svc.name || !/MapServer/i.test(svc.type ?? "")) continue;
    const match = svc.name.match(new RegExp(`^MRC${mrc}/(\\d{5})_Publique$`, "i"));
    if (match?.[1]) codes.add(match[1]);
  }
  return codes;
}

// ── Crosswalk slug → code MAMH (répertoire committé, jamais deviné) ───────────
function loadMamhCodes(): Map<string, string> {
  const out = new Map<string, string>();
  const dir = JSON.parse(readFileSync(MUNI_DIRECTORY_PATH, "utf8")) as { entries?: Record<string, { slug?: string; mamhCode?: string }> };
  for (const e of Object.values(dir.entries ?? {})) {
    if (e.slug && e.mamhCode) out.set(e.slug, String(e.mamhCode).trim());
  }
  return out;
}

// ── Résolution de la couche zonage + champs ──────────────────────────────────
function resolveFieldName(fields: FieldInfo[], want: string): string | null {
  const exact = fields.find((f) => f.name === want);
  if (exact) return exact.name;
  const ci = fields.find((f) => f.name.toLowerCase() === want.toLowerCase());
  return ci?.name ?? null;
}

/** Feature Layer polygone "Zonage municipal" (hors affectation/zone verte/…). */
function findZonageLayer(layers: ArcLayer[]): ArcLayer | null {
  for (const l of layers) {
    if (l.type && !/Feature Layer/i.test(l.type)) continue;
    if (l.geometryType && !/Polygon/i.test(l.geometryType)) continue;
    if (!ZONAGE_LAYER_INCLUDE_RE.test(l.name)) continue;
    if (ZONAGE_LAYER_EXCLUDE_RE.test(l.name)) continue;
    return l;
  }
  return null;
}

/** Champ code-zone : override explicite, sinon nom préféré, sinon 1er string non-exclu. */
function pickZoneField(fields: FieldInfo[], override?: string): string | null {
  if (override) return resolveFieldName(fields, override);
  const strings = fields.filter((f) => /string/i.test(f.type) && !ZONE_FIELD_EXCLUDE_RE.test(f.name));
  for (const f of strings) if (ZONE_FIELD_PREFER_RE.test(f.name)) return f.name;
  return strings[0]?.name ?? null;
}

function pickMuniCodeField(fields: FieldInfo[]): string | null {
  return fields.find((f) => MUNI_CODE_FIELD_RE.test(f.name) && /string/i.test(f.type))?.name ?? null;
}

// ── Téléchargement paginé (GeoJSON WGS84) ────────────────────────────────────
async function fetchFeatures(layerUrl: string, outFields: string, where: string, batch: number): Promise<GeoFeature[]> {
  const features: GeoFeature[] = [];
  let offset = 0;
  const size = Math.max(1, Math.min(batch, 2000));
  while (features.length < MAX_FEATURES) {
    const url = `${layerUrl}/query?where=${encodeURIComponent(where)}&outFields=${encodeURIComponent(outFields)}` +
      `&outSR=4326&geometryPrecision=6&resultOffset=${offset}&resultRecordCount=${size}&f=geojson`;
    const data = await fetchJson<GeoFC>(url, HTTP_TIMEOUT_MS);
    if (!data || !Array.isArray(data.features) || data.features.length === 0) break;
    features.push(...data.features);
    offset += data.features.length;
    if (data.features.length < size) break;
    await sleep(120);
  }
  return features;
}

/** Normalise au schéma de serving (zone_code = valeur RÉELLE du champ choisi). */
function normalize(features: GeoFeature[], zoneField: string, source: string): GeoFeature[] {
  return features.map((f) => {
    const raw = f.properties?.[zoneField];
    const zone = raw !== null && raw !== undefined && String(raw).trim() !== "" ? String(raw).trim() : null;
    return { type: "Feature" as const, geometry: f.geometry, properties: { zone_code: zone, kind: null, affectation: null, num_zone: null, source, confidence: "sigale-zone-vector" } };
  });
}

function bboxCenter(features: GeoFeature[]): { lat: number; lon: number; n: number } {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity, n = 0;
  for (const f of features) for (const [x, y] of positionsOf(f.geometry?.coordinates)) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; n++;
  }
  return { lat: (miny + maxy) / 2, lon: (minx + maxx) / 2, n };
}

// ── Traitement d'une muni ─────────────────────────────────────────────────────
async function processMuni(
  slug: string, muni: MuniEntry | undefined, mamhCode: string | null, mrc: string,
  s3: S3Client | null, args: Args,
): Promise<SlugResult> {
  const base: SlugResult = { slug, mamhCode, serviceUrl: null, deposited: false, status: "no-code", detail: "" };
  if (!mamhCode) return { ...base, status: "no-code", detail: "aucun code MAMH au répertoire pour ce slug" };

  const serviceUrl = `${ALTUS_BASE}/MRC${mrc}/${mamhCode}_Publique/MapServer`;
  base.serviceUrl = serviceUrl;

  const svc = await fetchJson<{ layers?: ArcLayer[] }>(`${serviceUrl}?f=json`);
  if (!svc || !Array.isArray(svc.layers)) return { ...base, status: "no-service", detail: `service SIGALE introuvable (${serviceUrl})` };

  const layer = findZonageLayer(svc.layers);
  if (!layer) return { ...base, status: "no-zonage-layer", detail: `service OK mais aucune couche 'Zonage municipal' (${svc.layers.length} couches)` };
  const layerUrl = `${serviceUrl}/${layer.id}`;

  const li = await fetchJson<{ fields?: FieldInfo[]; maxRecordCount?: number; geometryType?: string }>(`${layerUrl}?f=json`);
  const fields = li?.fields ?? [];
  if (fields.length === 0) return { ...base, status: "no-zonage-layer", detail: `couche '${layer.name}' (#${layer.id}) sans champs lisibles` };
  if (li?.geometryType && !/Polygon/i.test(li.geometryType)) return { ...base, status: "no-zonage-layer", detail: `couche '${layer.name}' non-polygonale (${li.geometryType})` };

  const zoneField = pickZoneField(fields, args.zoneField);
  if (!zoneField) return { ...base, status: "no-zonage-layer", detail: `couche '${layer.name}' sans champ code-zone exploitable (champs: ${fields.map((f) => f.name).join(",")})` };
  const muniField = pickMuniCodeField(fields);
  base.zonageLayerUrl = layerUrl;
  base.zoneField = zoneField;
  base.muniField = muniField;

  // WHERE : filtre défensif par code_mun (sans effet si le service est déjà mono-muni,
  // protège si un service portait toute la MRC). Fallback 1=1 si le champ n'existe
  // pas / n'est pas peuplé de notre code.
  let where = "1=1";
  if (muniField) {
    const filt = `${muniField}='${mamhCode.replace(/'/g, "''")}'`;
    const cnt = await fetchJson<{ count?: number }>(`${layerUrl}/query?where=${encodeURIComponent(filt)}&returnCountOnly=true&f=json`);
    if ((cnt?.count ?? 0) > 0) where = filt;
  }

  const outFields = muniField ? `${zoneField},${muniField}` : zoneField;
  const raw = await fetchFeatures(layerUrl, outFields, where, li?.maxRecordCount ?? 1000);
  if (raw.length === 0) return { ...base, status: "no-zonage-layer", detail: `couche '${layer.name}' téléchargée vide (where=${where})` };

  // Anti-invention (valeur-par-valeur) : REJET si le champ ne porte pas de vrais codes.
  const verdict = validateExplicitZoneField(raw as never, zoneField);
  const st = verdict.stats;
  if (!verdict.ok) {
    return { ...base, status: "zone-invalid", featureCount: raw.length, detail: `champ '${zoneField}': ${verdict.reason} — REJET anti-invention (sample=${JSON.stringify(st.sample.slice(0, 6))})` };
  }

  const norm = normalize(raw, zoneField, layerUrl);
  const distinctCodes = new Set<string>();
  for (const f of norm) { const c = f.properties.zone_code; if (typeof c === "string") distinctCodes.add(c); }
  base.featureCount = norm.length;
  base.distinctCodes = distinctCodes.size;

  // Gate spatial (projection-free ; features déjà en WGS84).
  if (muni) {
    const c = bboxCenter(norm);
    if (c.n > 0) {
      const distanceKm = haversineKm(muni.lat, muni.lon, c.lat, c.lon);
      base.distanceKm = distanceKm;
      if (distanceKm > Math.max(args.spatialKm, 35)) {
        return { ...base, status: "spatial-fail", detail: `spatial KO: features à ${distanceKm.toFixed(0)}km du centroïde (${layerUrl})` };
      }
    }
  }

  const nonNull = norm.filter((f) => f.properties.zone_code !== null).length;
  if (nonNull / norm.length < 0.5) return { ...base, status: "zone-invalid", detail: `couche '${layer.name}': zone_code null>50% — REJET` };

  // Un dépôt zonage existait-il déjà ? (overlap/Δ, sans toucher la matrice)
  const flatKey = `${S3_PREFIX}qc-zonage-${slug}.geojson`;
  const subKey = `${S3_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`;
  if (s3) base.wasServed = (await exists(s3, flatKey)) || (await exists(s3, subKey));

  const detail = `${norm.length} zones (${nonNull} avec zone_code, ${distinctCodes.size} distincts, champ '${zoneField}', codeLike=${(st.codeLikeRatio * 100).toFixed(0)}%) via ${layerUrl}`;
  if (args.deposit && s3) {
    // Dépôt PLAT (layout préféré par resolveGridKey/resolveZonesKey). On sauvegarde
    // puis SUPPRIME une éventuelle variante sous-dossier pour éviter le double-service.
    const ts = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15) + "Z";
    if (await exists(s3, subKey)) {
      const backup = `${S3_PREFIX}_replaced/qc-zonage-${slug}__subdir.${ts}.geojson`;
      await copyObject(s3, subKey, backup);
      await deleteObject(s3, subKey);
      console.error(`[sigale] ${slug}: ancienne variante sous-dossier sauvegardée → s3://${backup} + SUPPRIMÉE`);
    }
    const fc: GeoFC = { type: "FeatureCollection", features: norm };
    await putBytes(s3, flatKey, JSON.stringify(fc), "application/geo+json");
    return { ...base, deposited: true, status: "deposited", detail: `${base.wasServed ? "[REMPLACE] " : "[NOUVEAU] "}${detail}` };
  }
  return { ...base, status: "deposited", deposited: false, detail: `PROBE OK (non déposé): ${detail}` };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const munis = JSON.parse(readFileSync(MUNIS_PATH, "utf8")) as MuniEntry[];
  const bySlug = new Map(munis.map((m) => [m.slug, m]));
  const mamhBySlug = loadMamhCodes();
  const slugByMamh = new Map([...mamhBySlug.entries()].map(([slug, code]) => [code, slug]));

  // Lot de munis : --slugs explicite, sinon les services `<code>_Publique`
  // réellement publiés par le dossier MRC###. Pour les MRC historiques déjà
  // nommées, on garde le registre comme fallback si le catalogue est indisponible.
  let slugs = args.slugs;
  if (slugs.length === 0) {
    const availableCodes = await loadAvailableSigaleCodes(args.mrc);
    const catalogSlugs = [...availableCodes].map((code) => slugByMamh.get(code)).filter((s): s is string => !!s).sort();
    const mrcName = MRC_DEFAULT_NAME[args.mrc];
    if (mrcName) {
      const registrySlugs = munis.filter((m) => m.mrc === mrcName).map((m) => m.slug);
      slugs = availableCodes.size > 0 ? registrySlugs.filter((slug) => availableCodes.has(mamhBySlug.get(slug) ?? "")) : registrySlugs;
    } else if (catalogSlugs.length > 0) {
      slugs = catalogSlugs;
    } else {
      console.error(`[sigale] MRC ${args.mrc} sans lot par défaut ni services <code>_Publique — préciser --slugs`);
      process.exit(2);
    }
  }
  const s3 = s3Client(); // requis même en probe (check wasServed / dépôt éventuel)
  console.error(`[sigale] MRC=${args.mrc} munis=${slugs.length} deposit=${args.deposit} zoneField=${args.zoneField ?? "auto→Zonage"}`);

  const results: SlugResult[] = [];
  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i]!;
    let r: SlugResult;
    try { r = await processMuni(slug, bySlug.get(slug), mamhBySlug.get(slug) ?? null, args.mrc, s3, args); }
    catch (e) { r = { slug, mamhCode: mamhBySlug.get(slug) ?? null, serviceUrl: null, deposited: false, status: "error", detail: e instanceof Error ? e.message : String(e) }; }
    results.push(r);
    console.error(`[${i + 1}/${slugs.length}] ${r.status.padEnd(16)} ${slug} :: ${r.detail}`);
  }

  const byStatus: Record<string, number> = {};
  for (const r of results) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const deposited = results.filter((r) => r.deposited).map((r) => r.slug);
  const report = { generatedAt: new Date().toISOString(), mrc: args.mrc, deposit: args.deposit, byStatus, deposited, results };
  const out = args.outFile ?? resolve(HERE, "../../work/delegation-mass/zones-sigale-report.json");
  writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  console.error(`\n=== STATUS ${JSON.stringify(byStatus)}`);
  console.error(`déposés=${deposited.length} [${deposited.join(",")}]`);
  console.error(`rapport → ${out}`);
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
