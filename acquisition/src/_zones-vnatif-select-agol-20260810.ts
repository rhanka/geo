/**
 * _zones-vnatif-select-agol-20260810.ts — SÉLECTION + validation LIVE de la worklist
 * AGOL (ArcGIS Online hosted FeatureServers, host services\d*\.arcgis.com ; + items
 * portal www.arcgis.com résolus en une étape).
 *
 * Plateforme HÉTÉROGÈNE : chaque org expose ses couches. Deux topologies coexistent :
 *   (A) COUCHE PER-MUNI (un seul slug y pointe, aucun champ muni multi-valué) → capture
 *       `<layer>/query?where=1=1&outFields=*&f=geojson` (recette altus).
 *   (B) COUCHE MRC PARTAGÉE (plusieurs munis, OU un champ /mun|nom/i multi-valué) → il
 *       FAUT filtrer par muni : `<layer>/query?where=<F>=<v>&outFields=*&f=geojson`
 *       (recette victoriaville). Le champ-filtre F et la valeur v sont RÉSOLUS sans
 *       invention : match de NOM (registre) quand F est un champ-nom string ; sinon
 *       (champ-code entier, ex CODE_MUN/co_mun) résolution par (a) anti-homonyme
 *       nearest(grp)==slug via lat/lon du registre ET (b) recouvrement ≥90% des codes
 *       DÉJÀ SERVIS par le meilleur champ code-zone du groupe. La vérité-terrain servie
 *       + la géométrie choisissent la partition ; jamais deviné.
 *
 * Le champ code-zone lui-même n'est PAS figé ici — il varie par org (ZONE_, ZONE, Sect,
 * NUM_ZONE, NO_ZONE…). La sélection confirme seulement qu'un champ code-zone plausible
 * atteint ≥90% d'overlap ; le DÉPÔT le RÉSOUT à nouveau par recouvrement (anti-invention).
 *
 * Items portal www.arcgis.com : résolus via sharing/rest/content/items/<id>?f=json → .url ;
 * un Web Map dont les couches opérationnelles n'exposent qu'une featureCollection embarquée
 * (pas d'URL FeatureServer re-téléchargeable) est NON résolvable → SKIP (raison enregistrée).
 *
 * L'URL de la worklist est CANONICALISÉE via new URL().toString() (= forme inscrite au
 * manifeste par redactUrlForManifest), donc findLine(line.url===url) du dépôt est
 * byte-exact par construction.
 *
 * USAGE :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_zones-vnatif-select-agol-20260810.ts \
 *     --worklist-out work/coverage/zones-vnatif-capture-worklist-agol-20260810.json \
 *     --diag-out work/coverage/_zones-vnatif-select-agol-20260810.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { exists, getBytes, s3Client } from "./lib/s3.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SCOPING = "work/coverage/zones-v2-upgrade-scoping-20260810.json";
const S3_PREFIX = "normalized/ca-qc-zonage/";
const HOST_RE = /^services\d*\.arcgis\.com$/;
const OVERLAP_MIN_PCT = 90;
const NEAREST_MAX_KM = 25; // marge généreuse : un centroïde muni-filtré doit tomber sur LE bon muni
const ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const MUNIS_PATH = resolve(ROOT, "packages/qc-sources/src/geo/municipalities.qc.json");
// Champs jamais éligibles comme code-zone (géométrie / id / audit / muni-partition / aires).
const TECHNICAL_EXCLUDE = new Set<string>([
  "OBJECTID", "OBJECTID1", "FID", "ID", "GLOBALID",
  "SHAPE", "SHAPELENGTH", "SHAPEAREA", "SHAPELENG", "SHAPESTAREA", "SHAPESTLENGTH",
  "MUN", "MUNI", "NOMMUN", "NOMMUNVIEW", "CODEMUN", "COMUN", "MUNICIPALITE",
  "DATEMODIFI", "SUIVIMODI", "AIREHA", "AIREM2", "PERIMETREM", "AREAHA", "SUPHA",
  "HANET", "NUMFICHIE", "NUMFICHIER",
]);
// Champs candidats à la PARTITION par muni (couches MRC partagées).
const MUNI_FIELD_RE = /mun|nom/i;

function arg(name: string): string | undefined { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; }
function canon(v: unknown): string { return String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function canonName(s: string): string { return s.toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function normName(s: string): string { return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
function canonUrl(raw: string): string { return new URL(raw).toString(); }
function isCodeLike(v: unknown): boolean {
  const s = String(v ?? "").trim();
  return s.length > 0 && s.length <= 24 && /[A-Za-z0-9]/.test(s) && /^[A-Za-z0-9][A-Za-z0-9 ./-]*$/.test(s);
}

interface Scoped { slug: string; level: string; url_host: string; endpoint_class: string; zone_source_url: string }
function loadScoping(): Scoped[] {
  const raw = JSON.parse(readFileSync(resolve(ROOT, SCOPING), "utf8")) as { upgradable_list?: Scoped[] };
  return Array.isArray(raw.upgradable_list) ? raw.upgradable_list : [];
}
interface RegEntry { slug: string; name: string; lat: number; lon: number }
function loadRegistry(): RegEntry[] {
  const raw = JSON.parse(readFileSync(MUNIS_PATH, "utf8")) as unknown;
  const arr = (Array.isArray(raw) ? raw : Object.values(raw as Record<string, unknown>).find(Array.isArray)) as Array<Record<string, unknown>>;
  return arr.map((m) => ({ slug: String(m["slug"] ?? ""), name: String(m["name"] ?? ""), lat: Number(m["lat"]), lon: Number(m["lon"]) }))
    .filter((m) => m.slug && Number.isFinite(m.lat) && Number.isFinite(m.lon));
}

async function fetchJson(url: string, timeoutMs = 60_000): Promise<{ value: unknown; status: number | null; error: string | null }> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { "User-Agent": "sentropic-geo-select-agol/1", accept: "application/json" } });
    if (!res.ok) return { value: null, status: res.status, error: `HTTP ${res.status}` };
    const text = await res.text();
    try { return { value: JSON.parse(text), status: res.status, error: null }; }
    catch { return { value: null, status: res.status, error: `non-JSON (len=${text.length} head=${text.slice(0, 60).replace(/\s+/g, " ")})` }; }
  } catch (e) { return { value: null, status: null, error: (e as Error).message }; }
  finally { clearTimeout(t); }
}

interface Feat { properties?: Record<string, unknown> | null; geometry?: unknown }
function featureHasRealV2Proof(f: Feat): boolean {
  const p = (f.properties ?? {}) as { proof?: { geometry_source?: { sha256?: unknown; retrieved_at?: unknown } } | null };
  const gs = p.proof?.geometry_source;
  if (!gs) return false;
  const shaOk = typeof gs.sha256 === "string" && /^sha256:[a-f0-9]{64}$/.test(gs.sha256);
  const retrievedOk = typeof gs.retrieved_at === "string" && ISO_TS_RE.test(gs.retrieved_at) && !Number.isNaN(Date.parse(gs.retrieved_at));
  return shaOk && retrievedOk;
}
async function readServed(s3: ReturnType<typeof s3Client>, slug: string): Promise<{ keys: string[]; features: number; codes: Set<string>; hasV2: boolean }> {
  const flat = `${S3_PREFIX}qc-zonage-${slug}.geojson`;
  const nested = `${S3_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`;
  const keys: string[] = [];
  if (await exists(s3, flat)) keys.push(flat);
  if (await exists(s3, nested)) keys.push(nested);
  const codes = new Set<string>(); let features = 0; let hasV2 = false;
  for (const k of keys) {
    const fc = JSON.parse((await getBytes(s3, k)).toString("utf8")) as { proof?: { schema_version?: unknown }; features?: Feat[] };
    if (fc.proof?.schema_version === "2.0") hasV2 = true;
    const feats = Array.isArray(fc.features) ? fc.features : [];
    features = Math.max(features, feats.length);
    for (const f of feats) { const c = canon(f.properties?.["zone_code"]); if (c) codes.add(c); if (featureHasRealV2Proof(f)) hasV2 = true; }
  }
  return { keys, features, codes, hasV2 };
}

// ── géométrie : nearest muni par centroïde de bbox ──────────────────────────────
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371, dLat = ((lat2 - lat1) * Math.PI) / 180, dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function* positions(coords: unknown): Generator<[number, number]> {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === "number" && typeof coords[1] === "number") { yield [coords[0], coords[1]]; return; }
  for (const c of coords) yield* positions(c);
}
function nearestMuni(feats: Feat[], registry: RegEntry[]): { slug: string | null; km: number | null } {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const f of feats) for (const [x, y] of positions((f.geometry as { coordinates?: unknown } | null)?.coordinates)) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
  }
  if (![minx, miny, maxx, maxy].every(Number.isFinite)) return { slug: null, km: null };
  const clat = (miny + maxy) / 2, clon = (minx + maxx) / 2;
  let best: { slug: string; km: number } | null = null;
  for (const m of registry) { const km = haversineKm(m.lat, m.lon, clat, clon); if (best === null || km < best.km) best = { slug: m.slug, km }; }
  return { slug: best?.slug ?? null, km: best ? Math.round(best.km * 100) / 100 : null };
}

// ── meilleur champ code-zone d'un ensemble de features vs codes servis ──────────
function bestOverlap(feats: Feat[], servedCodes: Set<string>): { field: string | null; overlap: number | null } {
  const keys = new Set<string>();
  for (const f of feats) for (const k of Object.keys(f.properties ?? {})) keys.add(k);
  let best: { field: string; overlap: number } | null = null;
  for (const key of keys) {
    if (TECHNICAL_EXCLUDE.has(canonName(key))) continue;
    const dset = new Set<string>(); let nullCount = 0;
    for (const f of feats) { const raw = f.properties?.[key]; const s = raw === null || raw === undefined ? "" : String(raw).trim(); if (!s) nullCount++; else dset.add(canon(s)); }
    if (nullCount > 0 || dset.size < 3) continue;
    const covered = servedCodes.size > 0 ? [...servedCodes].filter((c) => dset.has(c)).length : 0;
    const overlap = servedCodes.size > 0 ? Math.round((covered / servedCodes.size) * 1000) / 10 : 0;
    if (best === null || overlap > best.overlap) best = { field: key, overlap };
  }
  return { field: best?.field ?? null, overlap: best?.overlap ?? null };
}

interface PortalResolution { serverUrl: string | null; reason: string | null; detail: Record<string, unknown> }
async function resolvePortalItem(rawUrl: string): Promise<PortalResolution> {
  const u = new URL(rawUrl);
  const id = u.searchParams.get("id");
  const frag = decodeURIComponent(u.hash.replace(/^#/, ""));
  const detail: Record<string, unknown> = { portal_item_id: id, layer_hint: frag || null };
  if (!id) return { serverUrl: null, reason: "aucun id dans l'URL portal", detail };
  const item = (await fetchJson(`https://www.arcgis.com/sharing/rest/content/items/${id}?f=json`)).value as
    | { type?: string; url?: string; title?: string } | null;
  detail.item_type = item?.type ?? null; detail.item_title = item?.title ?? null; detail.item_url = item?.url ?? null;
  if (item?.type === "Feature Service" && typeof item.url === "string") return { serverUrl: item.url, reason: null, detail };
  if (item?.type === "Web Map") {
    const data = (await fetchJson(`https://www.arcgis.com/sharing/rest/content/items/${id}/data?f=json`)).value as
      | { operationalLayers?: Array<{ title?: string; url?: string; itemId?: string; featureCollection?: unknown }> } | null;
    const ops = (data?.operationalLayers ?? []).map((l) => ({ title: l.title ?? null, url: l.url ?? null, itemId: l.itemId ?? null, embedded: l.featureCollection != null }));
    detail.webmap_layers = ops;
    const match = ops.find((l) => (l.title ?? "").toUpperCase() === frag.toUpperCase()) ?? ops[0];
    if (match?.url) return { serverUrl: match.url, reason: null, detail };
    if (match?.itemId) {
      const sub = (await fetchJson(`https://www.arcgis.com/sharing/rest/content/items/${match.itemId}?f=json`)).value as { type?: string; url?: string } | null;
      detail.sublayer_item_type = sub?.type ?? null;
      if (typeof sub?.url === "string") return { serverUrl: sub.url, reason: null, detail };
      return { serverUrl: null, reason: `Web Map → couche "${String(match.title)}" pointe un item ${String(sub?.type)} sans url FeatureServer`, detail };
    }
    return { serverUrl: null, reason: `Web Map → couche "${String(match?.title)}" est une featureCollection embarquée (aucune URL FeatureServer re-téléchargeable)`, detail };
  }
  return { serverUrl: null, reason: `item portal type=${String(item?.type)} sans url FeatureServer résolvable`, detail };
}

interface LayerData { url: string; meta: { geomType: string | null; maxRecord: number | null }; feats: Feat[]; count: number | null }
async function loadLayer(serverUrl: string): Promise<{ layer: LayerData | null; error: string | null }> {
  const base = serverUrl.replace(/\/+$/, "");
  const meta = (await fetchJson(`${base}?f=json`)).value as { geometryType?: unknown; maxRecordCount?: unknown } | null;
  const geomType = typeof meta?.geometryType === "string" ? meta.geometryType : null;
  const maxRecord = typeof meta?.maxRecordCount === "number" ? meta.maxRecordCount : null;
  const cntRes = (await fetchJson(`${base}/query?where=1%3D1&returnCountOnly=true&f=json`)).value as { count?: unknown } | null;
  const count = typeof cntRes?.count === "number" ? cntRes.count : null;
  if (count === null) return { layer: null, error: "count where=1=1 KO (couche non interrogeable)" };
  if (maxRecord !== null && count > maxRecord) return { layer: null, error: `count(${count}) > maxRecordCount(${maxRecord}) — fetch complet tronquerait la partition` };
  const gj = (await fetchJson(`${base}/query?where=1%3D1&outFields=*&f=geojson`)).value as { type?: unknown; features?: Feat[] } | null;
  const feats = Array.isArray(gj?.features) ? gj!.features! : [];
  if (gj?.type !== "FeatureCollection" || feats.length === 0) return { layer: null, error: `f=geojson non honoré / vide (type=${String(gj?.type)})` };
  if (feats.length !== count) return { layer: null, error: `where=1=1 renvoie ${feats.length} != count ${count} (troncature)` };
  return { layer: { url: base, meta: { geomType, maxRecord }, feats, count }, error: null };
}

function whereEq(field: string, value: unknown): string {
  return typeof value === "number" ? `${field}=${value}` : `${field}='${String(value)}'`;
}

async function main(): Promise<void> {
  const worklistOut = arg("worklist-out");
  const diagOut = arg("diag-out");
  const scoping = loadScoping().filter((s) => HOST_RE.test(s.url_host) || s.url_host === "www.arcgis.com");
  const registry = loadRegistry();
  const regBySlug = new Map(registry.map((r) => [r.slug, r]));
  const s3 = s3Client();
  process.stderr.write(`[select-agol] ${scoping.length} candidats AGOL\n`);

  // 1. résoudre chaque slug → serverUrl (portal d'abord), grouper par couche.
  const slugServer = new Map<string, { server: string | null; portal?: Record<string, unknown>; portalReason?: string | null }>();
  const layerToSlugs = new Map<string, string[]>();
  for (const c of scoping) {
    if (c.url_host === "www.arcgis.com") {
      const r = await resolvePortalItem(c.zone_source_url);
      slugServer.set(c.slug, { server: r.serverUrl, portal: r.detail, portalReason: r.reason });
      if (r.serverUrl) { const k = r.serverUrl.replace(/\/+$/, ""); const a = layerToSlugs.get(k) ?? []; a.push(c.slug); layerToSlugs.set(k, a); }
    } else {
      const k = c.zone_source_url.replace(/\/+$/, "");
      slugServer.set(c.slug, { server: k });
      const a = layerToSlugs.get(k) ?? []; a.push(c.slug); layerToSlugs.set(k, a);
    }
  }

  // 2. charger chaque couche distincte une fois.
  const layerCache = new Map<string, { layer: LayerData | null; error: string | null }>();
  for (const layerUrl of layerToSlugs.keys()) {
    const loaded = await loadLayer(layerUrl);
    layerCache.set(layerUrl, loaded);
    process.stderr.write(`[select-agol] LAYER ${layerUrl.split("/services/")[1] ?? layerUrl} → ${loaded.layer ? `${loaded.layer.count} feats, geom=${loaded.layer.meta.geomType}` : `OUT (${loaded.error})`}\n`);
  }

  const diag: Record<string, unknown>[] = [];
  const worklist: Array<{ slug: string; source: string; urls: string[] }> = [];
  for (const c of scoping) {
    const d: Record<string, unknown> = { slug: c.slug, level: c.level, url_host: c.url_host, scoping_url: c.zone_source_url };
    const reg = regBySlug.get(c.slug);
    const ss = slugServer.get(c.slug)!;
    d.server_url = ss.server;
    if (ss.portal) d.portal = ss.portal;
    // portal non résolu
    if (c.url_host === "www.arcgis.com" && !ss.server) { d.included = false; d.reason = `portal non résolvable: ${String(ss.portalReason)}`; diag.push(d); process.stderr.write(`[select-agol] ${c.slug} → OUT (${String(d.reason)})\n`); continue; }
    if (!reg) { d.included = false; d.reason = "slug absent du registre"; diag.push(d); continue; }

    // servi
    const served = await readServed(s3, c.slug);
    d.served_keys = served.keys; d.served_features = served.features; d.served_distinct_codes = served.codes.size; d.served_has_v2 = served.hasV2;
    if (served.keys.length === 0) { d.included = false; d.reason = "aucun servi (rien à upgrader)"; diag.push(d); process.stderr.write(`[select-agol] ${c.slug} → OUT (aucun servi)\n`); continue; }
    if (served.hasV2) { d.included = false; d.reason = "servi porte DÉJÀ une preuve v2 → hors périmètre"; diag.push(d); process.stderr.write(`[select-agol] ${c.slug} → OUT (déjà v2)\n`); continue; }

    const loaded = layerCache.get(ss.server!)!;
    if (!loaded.layer) { d.included = false; d.reason = `couche indisponible: ${String(loaded.error)}`; diag.push(d); process.stderr.write(`[select-agol] ${c.slug} → OUT (${String(d.reason)})\n`); continue; }
    const layer = loaded.layer;
    d.layer_count = layer.count; d.geometry_type = layer.meta.geomType; d.max_record = layer.meta.maxRecord;
    if (!layer.meta.geomType || !/Polygon/i.test(layer.meta.geomType)) { d.included = false; d.reason = `couche non-polygonale (${String(layer.meta.geomType)})`; diag.push(d); process.stderr.write(`[select-agol] ${c.slug} → OUT (non-polygon)\n`); continue; }

    // champs muni-partition (multi-valués)
    const allKeys = new Set<string>();
    for (const f of layer.feats) for (const k of Object.keys(f.properties ?? {})) allKeys.add(k);
    const muniFields: Array<{ field: string; distinct: Set<string> }> = [];
    for (const key of allKeys) {
      if (!MUNI_FIELD_RE.test(key)) continue;
      const dv = new Set<string>();
      for (const f of layer.feats) { const raw = f.properties?.[key]; if (raw !== null && raw !== undefined && String(raw).trim()) dv.add(String(raw)); }
      if (dv.size > 1) muniFields.push({ field: key, distinct: dv });
    }
    const isShared = (layerToSlugs.get(ss.server!)!.length > 1) || muniFields.length > 0;
    d.is_shared_layer = isShared; d.muni_partition_fields = muniFields.map((m) => ({ field: m.field, distinct: m.distinct.size }));

    let filterWhere: string; let resolvedField: string | null = null; let resolvedValue: unknown = null; let grp: Feat[];
    if (!isShared) {
      // (A) couche per-muni : where=1=1
      filterWhere = "1=1"; grp = layer.feats;
    } else {
      // (B) couche partagée : résoudre F=v par nom, sinon nearest+overlap
      let chosen: { field: string; value: unknown; grp: Feat[]; overlap: number; nearestKm: number } | null = null;
      // grouper par chaque champ muni-candidat et évaluer chaque valeur
      for (const mf of muniFields) {
        // regrouper features par valeur de mf
        const groups = new Map<string, Feat[]>();
        for (const f of layer.feats) { const raw = f.properties?.[mf.field]; if (raw === null || raw === undefined || !String(raw).trim()) continue; const key = String(raw); const arr = groups.get(key) ?? []; arr.push(f); groups.set(key, arr); }
        // candidat par NOM (préférence déterministe)
        const nameHit = [...groups.keys()].find((v) => normName(v) === normName(reg.name));
        const orderedValues = nameHit ? [nameHit, ...[...groups.keys()].filter((v) => v !== nameHit)] : [...groups.keys()];
        for (const v of orderedValues) {
          const g = groups.get(v)!;
          const near = nearestMuni(g, registry);
          if (near.slug !== c.slug || (near.km !== null && near.km > NEAREST_MAX_KM)) continue;
          const ov = bestOverlap(g, served.codes);
          if (ov.overlap === null || ov.overlap < OVERLAP_MIN_PCT) continue;
          // valeur typée : garder number si le champ est numérique
          const sample = g[0]?.properties?.[mf.field];
          const typedValue: unknown = typeof sample === "number" ? Number(v) : v;
          if (chosen === null || ov.overlap > chosen.overlap) chosen = { field: mf.field, value: typedValue, grp: g, overlap: ov.overlap, nearestKm: near.km ?? -1 };
          if (nameHit && v === nameHit) break; // nom-match validé → priorité
        }
        if (chosen) break;
      }
      if (!chosen) { d.included = false; d.reason = `couche partagée : aucune partition muni (F=v) ne satisfait nearest==${c.slug} & overlap≥${OVERLAP_MIN_PCT}% (champs testés: ${muniFields.map((m) => `${m.field}[${m.distinct.size}]`).join(", ") || "aucun"})`; diag.push(d); process.stderr.write(`[select-agol] ${c.slug} → OUT (partition non résolue)\n`); continue; }
      filterWhere = whereEq(chosen.field, chosen.value); resolvedField = chosen.field; resolvedValue = chosen.value; grp = chosen.grp;
      d.partition_field = resolvedField; d.partition_value = resolvedValue; d.partition_group_features = grp.length; d.partition_overlap_pct = chosen.overlap; d.partition_nearest_km = chosen.nearestKm;
    }

    // validation LIVE du filtre exact (encodage) : count == group ET geojson honoré ET nearest/overlap
    const base = layer.url;
    const geojsonUrl = canonUrl(`${base}/query?where=${filterWhere}&outFields=*&f=geojson`);
    const countUrl = canonUrl(`${base}/query?where=${filterWhere}&returnCountOnly=true&f=json`);
    d.geojson_url = geojsonUrl; d.count_url = countUrl; d.filter_where = filterWhere;
    const liveCnt = (await fetchJson(countUrl)).value as { count?: unknown } | null;
    const liveCount = typeof liveCnt?.count === "number" ? liveCnt.count : null;
    d.live_count = liveCount;
    if (liveCount === null || liveCount <= 0) { d.included = false; d.reason = `filtre live count KO/0 (${String(liveCount)})`; diag.push(d); process.stderr.write(`[select-agol] ${c.slug} → OUT (live count 0)\n`); continue; }
    if (isShared && liveCount !== grp.length) { d.included = false; d.reason = `filtre live count ${liveCount} != group ${grp.length} (encodage/partition instable)`; diag.push(d); process.stderr.write(`[select-agol] ${c.slug} → OUT (count mismatch)\n`); continue; }
    if (layer.meta.maxRecord !== null && liveCount > layer.meta.maxRecord) { d.included = false; d.reason = `live count(${liveCount}) > maxRecordCount(${layer.meta.maxRecord}) → tronquerait`; diag.push(d); process.stderr.write(`[select-agol] ${c.slug} → OUT (>maxRec)\n`); continue; }
    // sample geojson honoré + overlap/nearest final
    const sample = (await fetchJson(geojsonUrl)).value as { type?: unknown; features?: Feat[] } | null;
    const sfeats = Array.isArray(sample?.features) ? sample!.features! : [];
    if (sample?.type !== "FeatureCollection" || sfeats.length === 0) { d.included = false; d.reason = `f=geojson non honoré sur le filtre (type=${String(sample?.type)})`; diag.push(d); process.stderr.write(`[select-agol] ${c.slug} → OUT (geojson KO)\n`); continue; }
    const near = nearestMuni(sfeats, registry); d.nearest_registre_muni = near.slug; d.nearest_km = near.km;
    if (near.slug !== c.slug) { d.included = false; d.reason = `anti-homonyme: nearest=${String(near.slug)} != ${c.slug} (km=${String(near.km)})`; diag.push(d); process.stderr.write(`[select-agol] ${c.slug} → OUT (homonyme)\n`); continue; }
    const ov = bestOverlap(sfeats, served.codes); d.best_code_field = ov.field; d.best_overlap_pct = ov.overlap;
    if (ov.overlap === null || ov.overlap < OVERLAP_MIN_PCT) { d.included = false; d.reason = `meilleur champ code-zone overlap ${String(ov.overlap)}% < ${OVERLAP_MIN_PCT}% (champ=${String(ov.field)})`; diag.push(d); process.stderr.write(`[select-agol] ${c.slug} → OUT (overlap ${String(ov.overlap)}%)\n`); continue; }

    d.included = true;
    worklist.push({ slug: c.slug, source: "zones-vnatif", urls: [geojsonUrl] });
    process.stderr.write(`[select-agol] ${c.slug} → IN (where=${filterWhere}, count=${liveCount}, code=${String(ov.field)} overlap=${String(ov.overlap)}%, near=${String(near.km)}km)\n`);
    diag.push(d);
  }

  process.stderr.write(`[select-agol] worklist = ${worklist.length}/${scoping.length}\n`);
  if (worklistOut) { writeFileSync(resolve(ROOT, worklistOut), `${JSON.stringify(worklist, null, 2)}\n`, "utf8"); process.stderr.write(`WORKLIST → ${worklistOut}\n`); }
  const record = { contract: "zones-vnatif-select-agol/v1", date: "2026-08-10", host_re: HOST_RE.source, platform: "agol-hosted-featureserver (per-muni where=1=1 OU MRC-partagée filtrée F=v)", proof_intended: { type: "agol", method: "natif", reliability: "directe" }, candidates_total: scoping.length, selected: worklist.length, diag };
  if (diagOut) { writeFileSync(resolve(ROOT, diagOut), `${JSON.stringify(record, null, 1)}\n`, "utf8"); process.stderr.write(`DIAG → ${diagOut}\n`); }
  else process.stdout.write(`${JSON.stringify(record, null, 1)}\n`);
}

main().catch((e) => { process.stderr.write(`${(e as Error).stack ?? String(e)}\n`); process.exit(1); });
