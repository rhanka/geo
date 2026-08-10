/**
 * _zones-vnatif-probe-agol-20260810.ts — SONDE DE DIAGNOSTIC (read-only) des couches
 * AGOL (services*.arcgis.com hosted FeatureServers + www.arcgis.com portal items) du
 * scoping v2-upgrade. NE DÉPOSE RIEN. Sert UNIQUEMENT à comprendre la structure LIVE
 * (per-muni vs couche MRC partagée, champ code-zone, champ muni-filtre) AVANT de
 * construire la worklist de capture.
 *
 * Pour chaque host services\d*\.arcgis\.com OU www.arcgis.com du scoping :
 *   - résout les portal items www.arcgis.com (sharing/rest/content/items/<id>?f=json → .url) ;
 *   - regroupe par identité de couche (URL canonique) ;
 *   - marque une couche PARTAGÉE quand >1 slug du scoping y pointe ;
 *   - fetch meta ?f=json (geometryType, maxRecordCount, name, fields[name,type]) ;
 *   - fetch un petit échantillon geojson (resultRecordCount=8) → clés de propriété ;
 *   - compte where=1=1 (numberMatched) ;
 *   - pour les couches partagées, énumère les valeurs distinctes des champs
 *     muni-candidats (nom/code) pour préparer la résolution du filtre par muni ;
 *   - lit les codes DÉJÀ SERVIS (S3) de chaque slug pour l'overlap au dépôt.
 *
 * USAGE :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_zones-vnatif-probe-agol-20260810.ts \
 *     --out work/coverage/_zones-vnatif-probe-agol-20260810.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { exists, getBytes, s3Client } from "./lib/s3.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SCOPING = "work/coverage/zones-v2-upgrade-scoping-20260810.json";
const S3_PREFIX = "normalized/ca-qc-zonage/";
const HOST_RE = /^services\d*\.arcgis\.com$/;

function arg(name: string): string | undefined { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; }
function canon(v: unknown): string { return String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }

interface Scoped { slug: string; level: string; url_host: string; endpoint_class: string; zone_source_url: string }
function loadScoping(): Scoped[] {
  const raw = JSON.parse(readFileSync(resolve(ROOT, SCOPING), "utf8")) as { upgradable_list?: Scoped[] };
  return Array.isArray(raw.upgradable_list) ? raw.upgradable_list : [];
}

async function fetchJson(url: string, timeoutMs = 45_000): Promise<{ value: unknown; status: number | null; error: string | null }> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { "User-Agent": "sentropic-geo-probe-agol/1", accept: "application/json" } });
    if (!res.ok) return { value: null, status: res.status, error: `HTTP ${res.status}` };
    const text = await res.text();
    try { return { value: JSON.parse(text), status: res.status, error: null }; }
    catch { return { value: null, status: res.status, error: `non-JSON (len=${text.length} head=${text.slice(0, 80).replace(/\s+/g, " ")})` }; }
  } catch (e) { return { value: null, status: null, error: (e as Error).message }; }
  finally { clearTimeout(t); }
}

interface Feat { properties?: Record<string, unknown> | null; geometry?: unknown }
async function readServedCodes(s3: ReturnType<typeof s3Client>, slug: string): Promise<{ keys: string[]; features: number; codes: string[]; hasV2: boolean }> {
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
    for (const f of feats) { const c = canon(f.properties?.["zone_code"]); if (c) codes.add(c); }
  }
  return { keys, features, codes: [...codes].sort(), hasV2 };
}

/** Résout un item portal www.arcgis.com → { serverUrl, itemType, layerHint }. */
async function resolvePortalItem(rawUrl: string): Promise<Record<string, unknown>> {
  const u = new URL(rawUrl);
  const id = u.searchParams.get("id");
  const frag = decodeURIComponent(u.hash.replace(/^#/, ""));
  const out: Record<string, unknown> = { portal_item_id: id, layer_hint: frag || null };
  if (!id) { out.resolve_error = "aucun id dans l'URL portal"; return out; }
  const item = (await fetchJson(`https://www.arcgis.com/sharing/rest/content/items/${id}?f=json`)).value as
    | { type?: string; url?: string; title?: string; typeKeywords?: string[] } | null;
  out.item_type = item?.type ?? null; out.item_title = item?.title ?? null; out.item_url = item?.url ?? null;
  out.item_type_keywords = item?.typeKeywords ?? null;
  // Si Web Map, lister les couches opérationnelles AVEC leur url/itemId réels.
  if (item?.type === "Web Map") {
    const data = (await fetchJson(`https://www.arcgis.com/sharing/rest/content/items/${id}/data?f=json`)).value as
      | { operationalLayers?: Array<{ title?: string; url?: string; itemId?: string; layerType?: string; featureCollection?: unknown }> } | null;
    const opLayers = (data?.operationalLayers ?? []).map((l) => ({ title: l.title, url: l.url ?? null, itemId: l.itemId ?? null, layerType: l.layerType, hasEmbeddedFC: l.featureCollection != null }));
    out.webmap_layers = opLayers;
    // Tentative de résolution du sous-layer nommé par le fragment (ex #ZONAGE) → url directe.
    const match = opLayers.find((l) => (l.title ?? "").toUpperCase() === frag.toUpperCase()) ?? opLayers[0];
    if (match?.url) out.resolved_sublayer_url = match.url;
    else if (match?.itemId) {
      const sub = (await fetchJson(`https://www.arcgis.com/sharing/rest/content/items/${match.itemId}?f=json`)).value as { type?: string; url?: string } | null;
      out.resolved_sublayer_item_type = sub?.type ?? null;
      if (sub?.url) out.resolved_sublayer_url = sub.url;
    }
  }
  return out;
}

async function probeLayer(serverUrl: string): Promise<Record<string, unknown>> {
  const base = serverUrl.replace(/\/+$/, "");
  const out: Record<string, unknown> = { base_layer_url: base };
  const meta = (await fetchJson(`${base}?f=json`)).value as
    | { geometryType?: unknown; maxRecordCount?: unknown; name?: unknown; type?: unknown; fields?: Array<{ name?: unknown; type?: unknown }>; layers?: Array<{ id?: unknown; name?: unknown; geometryType?: unknown }> } | null;
  out.meta_type = typeof meta?.type === "string" ? meta.type : null;
  out.layer_name = typeof meta?.name === "string" ? meta.name : null;
  out.geometry_type = typeof meta?.geometryType === "string" ? meta.geometryType : null;
  out.max_record_count = typeof meta?.maxRecordCount === "number" ? meta.maxRecordCount : null;
  out.fields = Array.isArray(meta?.fields) ? meta!.fields.map((f) => ({ name: String(f.name ?? ""), type: String(f.type ?? "") })) : null;
  // Si l'URL pointe un FeatureServer racine (a des `layers`), lister.
  if (Array.isArray(meta?.layers)) out.server_layers = meta.layers.map((l) => ({ id: l.id, name: l.name, geometryType: l.geometryType }));
  // count
  const cnt = (await fetchJson(`${base}/query?where=1%3D1&returnCountOnly=true&f=json`)).value as { count?: unknown } | null;
  out.count_where_1_1 = typeof cnt?.count === "number" ? cnt.count : null;
  // sample geojson
  const sample = (await fetchJson(`${base}/query?where=1%3D1&outFields=*&resultRecordCount=8&f=geojson`)).value as
    | { type?: unknown; features?: Feat[]; exceededTransferLimit?: unknown } | null;
  const feats = Array.isArray(sample?.features) ? sample!.features! : [];
  out.sample_is_fc = sample?.type === "FeatureCollection";
  out.sample_features = feats.length;
  const keys = new Set<string>();
  for (const f of feats) for (const k of Object.keys(f.properties ?? {})) keys.add(k);
  out.property_keys = [...keys].sort();
  out.sample_props = feats.slice(0, 3).map((f) => f.properties ?? {});
  // Valeurs distinctes des champs muni-partitionneurs (/mun|nom/i) pour les couches partagées.
  const fieldsMeta = Array.isArray(meta?.fields) ? meta!.fields : [];
  const muniFields = fieldsMeta.map((f) => String(f.name ?? "")).filter((n) => /mun|nom/i.test(n));
  const distinctByField: Record<string, unknown[]> = {};
  for (const mf of muniFields) {
    const dv = (await fetchJson(`${base}/query?where=1%3D1&outFields=${encodeURIComponent(mf)}&returnDistinctValues=true&returnGeometry=false&f=json`)).value as
      | { features?: Array<{ attributes?: Record<string, unknown> }> } | null;
    distinctByField[mf] = (dv?.features ?? []).map((f) => f.attributes?.[mf]).slice(0, 30);
  }
  out.muni_field_distinct = distinctByField;
  return out;
}

async function main(): Promise<void> {
  const out = arg("out");
  const scoping = loadScoping().filter((s) => HOST_RE.test(s.url_host) || s.url_host === "www.arcgis.com");
  const s3 = s3Client();
  process.stderr.write(`[probe-agol] ${scoping.length} candidats AGOL\n`);

  // Résoudre chaque slug → serverUrl (portal items d'abord).
  const perSlug: Record<string, unknown>[] = [];
  const layerToSlugs = new Map<string, string[]>();
  for (const c of scoping) {
    const rec: Record<string, unknown> = { slug: c.slug, level: c.level, url_host: c.url_host, scoping_url: c.zone_source_url };
    let serverUrl: string | null = null;
    if (c.url_host === "www.arcgis.com") {
      const r = await resolvePortalItem(c.zone_source_url);
      rec.portal = r;
      serverUrl = typeof r.item_url === "string" ? r.item_url : null;
    } else {
      serverUrl = c.zone_source_url;
    }
    rec.server_url = serverUrl;
    if (serverUrl) {
      const key = serverUrl.replace(/\/+$/, "");
      const arr = layerToSlugs.get(key) ?? []; arr.push(c.slug); layerToSlugs.set(key, arr);
    }
    const served = await readServedCodes(s3, c.slug);
    rec.served_keys = served.keys; rec.served_features = served.features; rec.served_distinct_codes = served.codes.length;
    rec.served_codes = served.codes; rec.served_has_v2 = served.hasV2;
    perSlug.push(rec);
    process.stderr.write(`[probe-agol] ${c.slug}: server=${String(serverUrl)} served_codes=${served.codes.length} v2=${served.hasV2}\n`);
  }

  // Probe chaque couche distincte.
  const layers: Record<string, unknown>[] = [];
  for (const [layerUrl, slugs] of layerToSlugs) {
    const p = await probeLayer(layerUrl);
    p.slugs = slugs; p.shared = slugs.length > 1;
    layers.push(p);
    process.stderr.write(`[probe-agol] LAYER ${layerUrl} slugs=${slugs.length} count=${String(p.count_where_1_1)} geom=${String(p.geometry_type)} keys=${(p.property_keys as string[] | undefined)?.length}\n`);
  }

  const record = { contract: "zones-vnatif-probe-agol/v1", date: "2026-08-10", host_re: HOST_RE.source, candidates: scoping.length, distinct_layers: layers.length, per_slug: perSlug, layers };
  if (out) { writeFileSync(resolve(ROOT, out), `${JSON.stringify(record, null, 1)}\n`, "utf8"); process.stderr.write(`PROBE → ${out}\n`); }
  else process.stdout.write(`${JSON.stringify(record, null, 1)}\n`);
}

main().catch((e) => { process.stderr.write(`${(e as Error).stack ?? String(e)}\n`); process.exit(1); });
