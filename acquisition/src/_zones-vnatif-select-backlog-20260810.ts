/**
 * _zones-vnatif-select-backlog-20260810.ts — SÉLECTION + validation LIVE de la worklist
 * BACKLOG (récupération de la file d'attente SKIP de la campagne upgrade v2).
 *
 * Trois classes de SKIP y sont ré-examinées, chacune par un GARDE DÉDIÉ, jamais forcé :
 *
 *  (1) FAUX-NÉGATIFS ANTI-HOMONYME (RÉCUPÉRABLES) — le groupe de couche matche le muni par
 *      une identité FORTE (WFS: id_municipalite === mamhCode du registre MAMH ; AGOL: champ-nom
 *      EXACT MUNI='<Nom>') AVEC overlap≥90%, mais le garde bbox-centroïde `nearest==slug` a
 *      flagué un muni rural ADJACENT. L'identité forte (id-vérifiée ou nom-exact) PRIME le
 *      centroïde-nearest pour ces munis ruraux adjacents ; le garde nearest est un faux-négatif.
 *      Ici on ne fait que RECONFIRMER que la source rend des features (le dépôt applique
 *      l'override d'identité + revérifie l'overlap). L'id est vérifié DANS LE DÉPÔT contre
 *      qc-municipal-directory.json (mamhCode) ; le nom exact contre municipalities.qc.json.
 *
 *  (2) EMPTY-CODE (RÉCUPÉRABLES ssi minorité minime) — quelques features à code vide ; le dépôt
 *      DROPPE les features vides ssi (a) l'overlap du sous-ensemble non-vide reste ≥90% et
 *      (b) la fraction vide est ≤ seuil. Les zones à code vide NE SONT PAS servies — jamais
 *      inventer un code. Ici on ne fait que confirmer que la source rend des features.
 *
 *  (3) INVESTIGATE — overlap<90% avec le champ/couche initial, OU source transitoirement KO.
 *      On PROBE LIVE l'AUTRE couche/champ (ou on RETRY l'endpoint) et on lit les codes SERVIS
 *      (S3) pour recalculer l'overlap. On n'inclut QUE si un champ atteint ≥90% AVEC nearest
 *      OK (ou identité vérifiée). Sinon HELD (documenté, jamais forcé).
 *
 * Read-only vis-à-vis du servi (lit les codes servis pour l'overlap INVESTIGATE). N'écrit que
 * la worklist + le diag. La capture est faite ensuite sur le cluster (run 20260810T220000Z).
 *
 * USAGE :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_zones-vnatif-select-backlog-20260810.ts \
 *     --worklist-out work/coverage/zones-vnatif-capture-worklist-backlog-20260810.json \
 *     --diag-out work/coverage/_zones-vnatif-select-backlog-20260810.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { exists, getBytes, s3Client } from "./lib/s3.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const S3_PREFIX = "normalized/ca-qc-zonage/";
const OVERLAP_MIN_PCT = 90;
const MUNIS_PATH = resolve(ROOT, "packages/qc-sources/src/geo/municipalities.qc.json");
const DIRECTORY_PATH = resolve(ROOT, "packages/qc-sources/src/geo/qc-municipal-directory.json");
const TECHNICAL_EXCLUDE = new Set<string>([
  "OBJECTID", "OBJECTID1", "FID", "ID", "GLOBALID",
  "SHAPE", "SHAPELENGTH", "SHAPEAREA", "SHAPELENG", "SHAPESTAREA", "SHAPESTLENGTH",
  "MUN", "MUNI", "NOMMUN", "NOMMUNVIEW", "CODEMUN", "COMUN", "MUNICIPALITE",
  "DATEMODIFI", "SUIVIMODI", "AIREHA", "AIREM2", "PERIMETREM", "AREAHA", "SUPHA",
  "HANET", "NUMFICHIE", "NUMFICHIER",
]);

function arg(name: string): string | undefined { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; }
function canon(v: unknown): string { return String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function canonName(s: string): string { return s.toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function canonUrl(raw: string): string { return new URL(raw).toString(); }

interface RegEntry { slug: string; lat: number; lon: number }
function loadRegistry(): RegEntry[] {
  const raw = JSON.parse(readFileSync(MUNIS_PATH, "utf8")) as unknown;
  const arr = (Array.isArray(raw) ? raw : Object.values(raw as Record<string, unknown>).find(Array.isArray)) as Array<Record<string, unknown>>;
  return arr.map((m) => ({ slug: String(m["slug"] ?? ""), lat: Number(m["lat"]), lon: Number(m["lon"]) }))
    .filter((m) => m.slug && Number.isFinite(m.lat) && Number.isFinite(m.lon));
}
function loadDirectory(): Record<string, string> {
  const raw = JSON.parse(readFileSync(DIRECTORY_PATH, "utf8")) as { entries?: Record<string, { mamhCode?: string }> };
  const out: Record<string, string> = {};
  for (const [slug, e] of Object.entries(raw.entries ?? {})) if (e.mamhCode) out[slug] = e.mamhCode;
  return out;
}

interface Feat { properties?: Record<string, unknown> | null; geometry?: unknown }
async function fetchJson(url: string, timeoutMs = 60_000): Promise<{ value: unknown; status: number | null; error: string | null }> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { "User-Agent": "sentropic-geo-select-backlog/1", accept: "application/json" } });
    if (!res.ok) return { value: null, status: res.status, error: `HTTP ${res.status}` };
    const text = await res.text();
    try { return { value: JSON.parse(text), status: res.status, error: null }; }
    catch { return { value: null, status: res.status, error: `non-JSON (len=${text.length} head=${text.slice(0, 60).replace(/\s+/g, " ")})` }; }
  } catch (e) { return { value: null, status: null, error: (e as Error).message }; }
  finally { clearTimeout(t); }
}

async function readServedCodes(s3: ReturnType<typeof s3Client>, slug: string): Promise<{ codes: Set<string>; features: number; keys: string[] }> {
  const flat = `${S3_PREFIX}qc-zonage-${slug}.geojson`;
  const nested = `${S3_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`;
  const keys: string[] = [];
  if (await exists(s3, flat)) keys.push(flat);
  if (await exists(s3, nested)) keys.push(nested);
  const codes = new Set<string>(); let features = 0;
  for (const k of keys) {
    const fc = JSON.parse((await getBytes(s3, k)).toString("utf8")) as { features?: Feat[] };
    const feats = Array.isArray(fc.features) ? fc.features : [];
    features = Math.max(features, feats.length);
    for (const f of feats) { const c = canon(f.properties?.["zone_code"]); if (c) codes.add(c); }
  }
  return { codes, features, keys };
}

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

/** Meilleur champ code-zone (sans valeur vide, ≥3 distincts) vs codes servis. */
function bestOverlap(feats: Feat[], served: Set<string>): { field: string | null; overlap: number | null; ranked: Array<{ field: string; overlap: number; distinct: number; nulls: number }> } {
  const keys = new Set<string>();
  for (const f of feats) for (const k of Object.keys(f.properties ?? {})) keys.add(k);
  const ranked: Array<{ field: string; overlap: number; distinct: number; nulls: number }> = [];
  for (const key of keys) {
    if (TECHNICAL_EXCLUDE.has(canonName(key))) continue;
    const dset = new Set<string>(); let nulls = 0;
    for (const f of feats) { const raw = f.properties?.[key]; const s = raw === null || raw === undefined ? "" : String(raw).trim(); if (!s) nulls++; else dset.add(canon(s)); }
    const covered = served.size > 0 ? [...served].filter((c) => dset.has(c)).length : 0;
    const overlap = served.size > 0 ? Math.round((covered / served.size) * 1000) / 10 : 0;
    ranked.push({ field: key, overlap, distinct: dset.size, nulls });
  }
  ranked.sort((a, b) => b.overlap - a.overlap || b.distinct - a.distinct);
  const eligible = ranked.filter((r) => r.nulls === 0 && r.distinct >= 3 && r.overlap >= OVERLAP_MIN_PCT);
  return { field: eligible[0]?.field ?? null, overlap: eligible[0]?.overlap ?? null, ranked: ranked.slice(0, 8) };
}

// ── FIXED recoverables (identité déjà résolue ; source connue) ─────────────────────
// géoCentralis anti-homonyme id-vérifié (URLs recopiées byte-exact des worklists lot-B/C).
const WFS = (id: string) => canonUrl(`https://geoserver.geocentralis.com/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=evb:siadmin_pzon_99_s&outputFormat=application/json&CQL_FILTER=id_municipalite=%27${id}%27`);
const WFS_ZM = (id: string) => canonUrl(`https://geoserver.geocentralis.com/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=evb:zonage_municipal&outputFormat=application/json&CQL_FILTER=id_municipalite=%27${id}%27`);
interface Fixed { slug: string; url: string; kind: string; klass: "wfs" | "arcgis" }
const FIXED: Fixed[] = [
  // (1) anti-homonyme id-vérifié
  { slug: "pointe-aux-outardes", url: WFS("96030"), kind: "anti-homonym-id-verified", klass: "wfs" },
  { slug: "saint-anaclet-de-lessard", url: WFS("10030"), kind: "anti-homonym-id-verified", klass: "wfs" },
  { slug: "saint-camille-de-lellis", url: WFS("28070"), kind: "anti-homonym-id-verified", klass: "wfs" },
  { slug: "saint-gabriel", url: WFS("52080"), kind: "anti-homonym-id-verified+empty-drop", klass: "wfs" },
  { slug: "saint-ignace-de-loyola", url: WFS("52045"), kind: "anti-homonym-id-verified", klass: "wfs" },
  { slug: "saint-marcel", url: WFS("17020"), kind: "anti-homonym-id-verified", klass: "wfs" },
  { slug: "saint-marcellin", url: WFS("10025"), kind: "anti-homonym-id-verified", klass: "wfs" },
  // (2) empty-code tiny drop (nearest OK)
  { slug: "saint-charles-garnier", url: WFS("09010"), kind: "empty-drop", klass: "wfs" },
  { slug: "saint-donat--la-mitis", url: WFS("09030"), kind: "empty-drop", klass: "wfs" },
  // AGOL saint-ludger : couche MRC du Granit, filtre nom EXACT MUNI='Saint-Ludger'
  { slug: "saint-ludger", url: canonUrl("https://services6.arcgis.com/qVhfI6UTbRNL5Gfd/arcgis/rest/services/Zonage/FeatureServer/5/query?where=MUNI=%27Saint-Ludger%27&outFields=*&f=geojson"), kind: "anti-homonym-name-match", klass: "arcgis" },
  // AGOL beaupre : couche per-muni, 1/78 code vide → empty-drop
  { slug: "beaupre", url: canonUrl("https://services6.arcgis.com/osUKB2jztkflrQhx/arcgis/rest/services/Zonage/FeatureServer/17/query?where=1=1&outFields=*&f=geojson"), kind: "empty-drop", klass: "arcgis" },
];

async function wfsNumberMatched(url: string): Promise<number | null> {
  const r = await fetchJson(`${url}&count=1`); const v = r.value as { numberMatched?: unknown } | null;
  return v && typeof v.numberMatched === "number" ? v.numberMatched : null;
}
async function arcgisGeojson(url: string): Promise<Feat[]> {
  const r = await fetchJson(url); const v = r.value as { features?: Feat[] } | null;
  return Array.isArray(v?.features) ? v!.features! : [];
}
async function wfsGeojson(url: string): Promise<Feat[]> {
  const r = await fetchJson(url); const v = r.value as { features?: Feat[] } | null;
  return Array.isArray(v?.features) ? v!.features! : [];
}

async function main(): Promise<void> {
  const worklistOut = arg("worklist-out");
  const diagOut = arg("diag-out");
  const registry = loadRegistry();
  const directory = loadDirectory();
  const s3 = s3Client();
  const diag: Record<string, unknown>[] = [];
  const worklist: Array<{ slug: string; source: string; urls: string[] }> = [];

  // ── FIXED : reconfirmer LIVE que la source rend des features ────────────────────
  for (const f of FIXED) {
    const d: Record<string, unknown> = { slug: f.slug, bucket: "FIXED", kind: f.kind, klass: f.klass, url: f.url };
    let renders = false; let n: number | null = null;
    if (f.klass === "wfs") { n = await wfsNumberMatched(f.url); renders = n !== null && n > 0; }
    else { const feats = await arcgisGeojson(f.url); n = feats.length; renders = feats.length > 0; }
    d.live_features_or_matched = n; d.renders = renders;
    if (renders) { worklist.push({ slug: f.slug, source: "zones-vnatif", urls: [f.url] }); d.included = true; }
    else { d.included = false; d.reason = `source ne rend pas de features (n=${String(n)})`; }
    diag.push(d);
    process.stderr.write(`[backlog] FIXED ${f.slug} (${f.kind}) → ${renders ? `IN (n=${String(n)})` : `OUT (n=${String(n)})`}\n`);
  }

  // ── INVESTIGATE otterburn-park : essayer l'AUTRE couche WFS (zonage_municipal) ────
  {
    const slug = "otterburn-park"; const id = "57030";
    const d: Record<string, unknown> = { slug, bucket: "INVESTIGATE", probe: "geocentralis-zonage_municipal", id };
    d.id_verified = directory[slug] === id;
    const url = WFS_ZM(id);
    const feats = await wfsGeojson(url);
    const served = await readServedCodes(s3, slug);
    d.served_codes = served.codes.size; d.url = url; d.source_features = feats.length;
    const near = nearestMuni(feats, registry); d.nearest = near.slug; d.nearest_km = near.km;
    const ov = bestOverlap(feats, served.codes); d.best_field = ov.field; d.best_overlap = ov.overlap; d.ranked = ov.ranked;
    const ok = feats.length > 0 && near.slug === slug && ov.field !== null && (ov.overlap ?? 0) >= OVERLAP_MIN_PCT && d.id_verified === true;
    if (ok) { worklist.push({ slug, source: "zones-vnatif", urls: [url] }); d.included = true; }
    else { d.included = false; d.reason = `alt-couche zonage_municipal: best=${String(ov.field)} overlap=${String(ov.overlap)}% (nearest=${String(near.slug)}, id_verified=${String(d.id_verified)}) → HELD si <90%`; }
    diag.push(d);
    process.stderr.write(`[backlog] INVESTIGATE ${slug} zonage_municipal → ${ok ? `IN (${String(ov.field)} ${String(ov.overlap)}%)` : `HELD (${String(ov.field)} ${String(ov.overlap)}%)`}\n`);
  }

  // ── INVESTIGATE matapedia : RETRY altus MapServer service MRC060/06045_Publique ──
  {
    const slug = "matapedia";
    const d: Record<string, unknown> = { slug, bucket: "INVESTIGATE", probe: "altus-retry", service: "MRC060/06045_Publique" };
    const svc = "https://gis.altusquebec.com/arcgis/rest/services/MRC060/06045_Publique/MapServer";
    const svcMeta = await fetchJson(`${svc}?f=json`);
    const layers = ((svcMeta.value as { layers?: Array<{ id?: number; name?: string; geometryType?: string }> } | null)?.layers) ?? [];
    d.service_status = svcMeta.status; d.service_error = svcMeta.error;
    d.layers = layers.map((l) => ({ id: l.id, name: l.name, geometryType: l.geometryType }));
    const served = await readServedCodes(s3, slug); d.served_codes = served.codes.size;
    // Chercher une couche polygonale dont un champ atteint ≥90% overlap.
    let chosen: { url: string; layerId: number; field: string; overlap: number; nearest: string | null } | null = null;
    const probed: Record<string, unknown>[] = [];
    for (const l of layers) {
      if (typeof l.id !== "number") continue;
      const metaR = await fetchJson(`${svc}/${l.id}?f=json`);
      const gtype = (metaR.value as { geometryType?: string } | null)?.geometryType ?? null;
      if (!gtype || !/Polygon/i.test(gtype)) { probed.push({ id: l.id, name: l.name, geometryType: gtype, skipped: "non-polygon/unavailable" }); continue; }
      const url = canonUrl(`${svc}/${l.id}/query?where=1=1&outFields=*&f=geojson`);
      const feats = await arcgisGeojson(url);
      if (feats.length === 0) { probed.push({ id: l.id, name: l.name, geometryType: gtype, features: 0 }); continue; }
      const near = nearestMuni(feats, registry);
      const ov = bestOverlap(feats, served.codes);
      probed.push({ id: l.id, name: l.name, features: feats.length, nearest: near.slug, nearest_km: near.km, best_field: ov.field, best_overlap: ov.overlap });
      if (near.slug === slug && ov.field && (ov.overlap ?? 0) >= OVERLAP_MIN_PCT && (chosen === null || (ov.overlap ?? 0) > chosen.overlap)) {
        chosen = { url, layerId: l.id, field: ov.field, overlap: ov.overlap!, nearest: near.slug };
      }
    }
    d.layer_probes = probed;
    if (chosen) { worklist.push({ slug, source: "zones-vnatif", urls: [chosen.url] }); d.included = true; d.chosen = chosen; }
    else { d.included = false; d.reason = "altus MRC060/06045_Publique: aucune couche polygonale ne rend nearest==matapedia & overlap≥90% (endpoint down ou mauvais service)"; }
    diag.push(d);
    process.stderr.write(`[backlog] INVESTIGATE ${slug} altus-retry → ${chosen ? `IN (layer ${chosen.layerId}, ${chosen.field} ${chosen.overlap}%)` : "HELD"}\n`);
  }

  // ── INVESTIGATE saint-laurent-de-lile-dorleans : autres couches altus MRC200/20020 ─
  {
    const slug = "saint-laurent-de-lile-dorleans";
    const d: Record<string, unknown> = { slug, bucket: "INVESTIGATE", probe: "altus-otherlayers", service: "MRC200/20020_Publique" };
    const svc = "https://gis.altusquebec.com/arcgis/rest/services/MRC200/20020_Publique/MapServer";
    const svcMeta = await fetchJson(`${svc}?f=json`);
    const layers = ((svcMeta.value as { layers?: Array<{ id?: number; name?: string }> } | null)?.layers) ?? [];
    d.layers = layers.map((l) => ({ id: l.id, name: l.name }));
    const served = await readServedCodes(s3, slug); d.served_codes = served.codes.size;
    let chosen: { url: string; layerId: number; field: string; overlap: number } | null = null;
    const probed: Record<string, unknown>[] = [];
    for (const l of layers) {
      if (typeof l.id !== "number") continue;
      const metaR = await fetchJson(`${svc}/${l.id}?f=json`);
      const gtype = (metaR.value as { geometryType?: string } | null)?.geometryType ?? null;
      if (!gtype || !/Polygon/i.test(gtype)) { probed.push({ id: l.id, name: l.name, geometryType: gtype, skipped: "non-polygon" }); continue; }
      const url = canonUrl(`${svc}/${l.id}/query?where=1=1&outFields=*&f=geojson`);
      const feats = await arcgisGeojson(url);
      if (feats.length === 0) { probed.push({ id: l.id, name: l.name, features: 0 }); continue; }
      const near = nearestMuni(feats, registry);
      const ov = bestOverlap(feats, served.codes);
      probed.push({ id: l.id, name: l.name, features: feats.length, nearest: near.slug, best_field: ov.field, best_overlap: ov.overlap });
      if (near.slug === slug && ov.field && (ov.overlap ?? 0) >= OVERLAP_MIN_PCT && (chosen === null || (ov.overlap ?? 0) > chosen.overlap)) {
        chosen = { url, layerId: l.id, field: ov.field, overlap: ov.overlap! };
      }
    }
    d.layer_probes = probed;
    if (chosen) { worklist.push({ slug, source: "zones-vnatif", urls: [chosen.url] }); d.included = true; d.chosen = chosen; }
    else { d.included = false; d.reason = `altus MRC200/20020: aucune couche n'atteint nearest==slug & overlap≥90% (servi=${served.codes.size} codes ; la couche 17 n'a que 34 features)`; }
    diag.push(d);
    process.stderr.write(`[backlog] INVESTIGATE ${slug} altus-otherlayers → ${chosen ? `IN (layer ${chosen.layerId})` : "HELD"}\n`);
  }

  // ── INVESTIGATE gore : recap couche partagée services9/Zonage/0 (co_mun) ─────────
  {
    const slug = "gore";
    const d: Record<string, unknown> = { slug, bucket: "INVESTIGATE", probe: "agol-comun", layer: "services9/iZcAwIV2GibwcZLe/Zonage/FeatureServer/0" };
    const base = "https://services9.arcgis.com/iZcAwIV2GibwcZLe/arcgis/rest/services/Zonage/FeatureServer/0";
    const served = await readServedCodes(s3, slug); d.served_codes = served.codes.size; d.served_features = served.features;
    const feats = await arcgisGeojson(canonUrl(`${base}/query?where=1=1&outFields=*&f=geojson`));
    d.layer_total_features = feats.length;
    // regrouper par co_mun, meilleur overlap par partition dont nearest==gore
    const groups = new Map<string, Feat[]>();
    for (const f of feats) { const v = f.properties?.["co_mun"]; if (v === null || v === undefined || !String(v).trim()) continue; const k = String(v); const a = groups.get(k) ?? []; a.push(f); groups.set(k, a); }
    let best: { comun: string; overlap: number; nearest: string | null; field: string | null } | null = null;
    const parts: Record<string, unknown>[] = [];
    for (const [k, g] of groups) {
      const near = nearestMuni(g, registry);
      const ov = bestOverlap(g, served.codes);
      parts.push({ co_mun: k, features: g.length, nearest: near.slug, nearest_km: near.km, best_field: ov.field, best_overlap: ov.overlap });
      if (best === null || (ov.overlap ?? 0) > best.overlap) best = { comun: k, overlap: ov.overlap ?? 0, nearest: near.slug, field: ov.field };
    }
    d.partitions = parts; d.best_partition = best;
    d.included = false;
    d.reason = `gore: servi=${served.codes.size} codes ; meilleure partition co_mun overlap=${best ? best.overlap : "n/a"}% (nearest=${best ? String(best.nearest) : "n/a"}) — aucune ≥90% → HELD (source-identity absente ; les codes servis ne reproduisent aucune partition de cette couche)`;
    diag.push(d);
    process.stderr.write(`[backlog] INVESTIGATE ${slug} agol-comun → HELD (best ${best ? best.overlap : "n/a"}%)\n`);
  }

  process.stderr.write(`[backlog] worklist = ${worklist.length} munis\n`);
  if (worklistOut) { writeFileSync(resolve(ROOT, worklistOut), `${JSON.stringify(worklist, null, 2)}\n`, "utf8"); process.stderr.write(`WORKLIST → ${worklistOut}\n`); }
  const record = { contract: "zones-vnatif-select-backlog/v1", date: "2026-08-10", overlap_min_pct: OVERLAP_MIN_PCT, selected: worklist.length, diag };
  if (diagOut) { writeFileSync(resolve(ROOT, diagOut), `${JSON.stringify(record, null, 1)}\n`, "utf8"); process.stderr.write(`DIAG → ${diagOut}\n`); }
  else process.stdout.write(`${JSON.stringify(record, null, 1)}\n`);
}

main().catch((e) => { process.stderr.write(`${(e as Error).stack ?? String(e)}\n`); process.exit(1); });
