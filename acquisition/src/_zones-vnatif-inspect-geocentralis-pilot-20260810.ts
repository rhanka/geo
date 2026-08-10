/**
 * _zones-vnatif-inspect-geocentralis-pilot-20260810.ts — SONDE DIAGNOSTIC (lecture seule).
 *
 * Prépare le pilote géoCentralis WFS (candidate/legacy-traceable → documented v2) sur les
 * DEUX couches partagées de geoserver.geocentralis.com/geoserver/ows :
 *   - evb:zonage_municipal   (code de zone = no_zonage_municipal, ex. "M2.3-1")
 *   - evb:siadmin_pzon_99_s  (code de zone = etiquette_1,          ex. "281 R")
 * filtrées par CQL_FILTER=id_municipalite=<id>.
 *
 * Pour chaque muni candidate : lit le SERVI (S3, lecture seule), fetch la couche WFS LIVE
 * (GetFeature complet pour ce muni), et calcule l'IDENTITÉ DE SOURCE : le zone_code servi
 * doit se reproduire depuis le champ-code de la couche WFS à HAUT overlap. Vérifie aussi
 * la NON-preuve v2 du servi (upgrade légitime), le grain (aucun marqueur UEV ⇒ zone-polygon),
 * la complétude WFS (numberReturned==numberMatched==features), et l'anti-homonyme.
 *
 * N'ÉCRIT RIEN. Ne capture RIEN (fetch LIVE d'analyse, pas un dépôt).
 *
 * USAGE :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_zones-vnatif-inspect-geocentralis-pilot-20260810.ts \
 *     [--out work/coverage/_zones-vnatif-inspect-geocentralis-pilot-20260810.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { exists, getBytes, s3Client } from "./lib/s3.js";
import { featureHasV2Proof } from "./lib/zonage-proof.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const S3_PREFIX = "normalized/ca-qc-zonage/";
const UEV_MARKER_FIELDS = ["ID_UEV", "MATRICULE8", "CODE_UTILI"] as const;
const HOST = "https://geoserver.geocentralis.com/geoserver/ows";

interface MuniCfg { slug: string; layer: string; id: string; codeField: string }
const MUNIS: MuniCfg[] = [
  { slug: "adstock", layer: "evb:zonage_municipal", id: "31056", codeField: "no_zonage_municipal" },
  { slug: "baie-comeau", layer: "evb:siadmin_pzon_99_s", id: "96020", codeField: "etiquette_1" },
  { slug: "beauceville", layer: "evb:zonage_municipal", id: "27028", codeField: "no_zonage_municipal" },
  { slug: "danville", layer: "evb:zonage_municipal", id: "40047", codeField: "no_zonage_municipal" },
];

function wfsUrl(cfg: MuniCfg): string {
  return `${HOST}?service=WFS&version=2.0.0&request=GetFeature&typeNames=${cfg.layer}&outputFormat=application/json&CQL_FILTER=id_municipalite=${cfg.id}`;
}

function requireS3(): void {
  const opts = process.env["NODE_OPTIONS"] ?? "";
  if (!opts.split(/\s+/).includes("--dns-result-order=ipv4first")) throw new Error("lecture S3 refusée: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  if (process.env["AWS_MAX_ATTEMPTS"] !== "10") throw new Error("lecture S3 refusée: préfixer AWS_MAX_ATTEMPTS=10");
}
function arg(name: string): string | undefined { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; }
function canon(value: unknown): string { return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }

interface Feat { geometry?: { type?: string; coordinates?: unknown } | null; properties?: Record<string, unknown> | null }

async function fetchJson(url: string, timeoutMs = 40_000): Promise<unknown> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { "User-Agent": "sentropic-geo-count-probe/1" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

const MUNIS_PATH = resolve(ROOT, "packages/qc-sources/src/geo/municipalities.qc.json");
interface MuniEntry { slug: string; lat: number; lon: number }
function loadRegistry(): MuniEntry[] {
  const raw = JSON.parse(readFileSync(MUNIS_PATH, "utf8")) as unknown;
  const arr = (Array.isArray(raw) ? raw : Object.values(raw as Record<string, unknown>).find(Array.isArray)) as Array<Record<string, unknown>>;
  return arr.map((m) => ({ slug: String(m["slug"] ?? ""), lat: Number(m["lat"] ?? m["latitude"]), lon: Number(m["lon"] ?? m["lng"] ?? m["longitude"]) }))
    .filter((m) => m.slug && Number.isFinite(m.lat) && Number.isFinite(m.lon));
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
function nearestMuni(feats: Feat[], registry: MuniEntry[]): { slug: string | null; km: number | null } {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const f of feats) for (const [x, y] of positions(f.geometry?.coordinates)) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
  }
  if (![minx, miny, maxx, maxy].every(Number.isFinite)) return { slug: null, km: null };
  const clat = (miny + maxy) / 2, clon = (minx + maxx) / 2;
  let best: { slug: string; km: number } | null = null;
  for (const m of registry) { const km = haversineKm(m.lat, m.lon, clat, clon); if (best === null || km < best.km) best = { slug: m.slug, km }; }
  return { slug: best?.slug ?? null, km: best ? Math.round(best.km * 100) / 100 : null };
}
function overlap(a: Set<string>, b: Set<string>): { inter: number; a_only: number; a_into_b_pct: number } {
  let inter = 0; for (const x of a) if (b.has(x)) inter++;
  return { inter, a_only: a.size - inter, a_into_b_pct: a.size ? Math.round((inter / a.size) * 1000) / 10 : 0 };
}

async function readServed(s3: ReturnType<typeof s3Client>, slug: string): Promise<Record<string, unknown>> {
  const flat = `${S3_PREFIX}qc-zonage-${slug}.geojson`;
  const nested = `${S3_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`;
  const keys: string[] = [];
  if (await exists(s3, flat)) keys.push(flat);
  if (await exists(s3, nested)) keys.push(nested);
  const codesCanon = new Set<string>(); const rawSample: string[] = [];
  const levels = new Set<string>(); const urls = new Set<string | null>(); const propKeys = new Set<string>();
  let features = 0; let hasV2 = false; let hasCollectionV2 = false;
  for (const k of keys) {
    const fc = JSON.parse((await getBytes(s3, k)).toString("utf8")) as { proof?: { schema_version?: unknown }; features?: Feat[] };
    if (fc.proof?.schema_version === "2.0") hasCollectionV2 = true;
    const feats = Array.isArray(fc.features) ? fc.features : [];
    features = Math.max(features, feats.length);
    for (const f of feats) {
      const p = f.properties ?? {};
      for (const kk of Object.keys(p)) propKeys.add(kk);
      const zc = p["zone_code"]; const c = canon(zc); if (c) { codesCanon.add(c); if (rawSample.length < 20) rawSample.push(String(zc)); }
      levels.add(typeof p["zone_source_level"] === "string" ? p["zone_source_level"] : "(none)");
      urls.add(typeof p["zone_source_url"] === "string" ? p["zone_source_url"] : null);
      if (featureHasV2Proof(f)) hasV2 = true;
    }
  }
  return {
    served_keys: keys, served_layout: keys.length === 2 ? "both" : keys[0]?.includes("/qc-zonage-" + slug + "/") ? "nested" : keys.length ? "flat" : "none",
    served_features: features, served_distinct_codes: codesCanon.size, served_sample_codes: rawSample,
    served_levels: [...levels].sort(), served_source_urls: [...urls], served_property_keys: [...propKeys].sort(),
    served_has_feature_v2_proof: hasV2, served_has_collection_v2: hasCollectionV2,
    _codesCanon: [...codesCanon],
  };
}

async function main(): Promise<void> {
  requireS3();
  const s3 = s3Client();
  const registry = loadRegistry();
  const results: Record<string, unknown>[] = [];
  for (const cfg of MUNIS) {
    const url = wfsUrl(cfg);
    const r: Record<string, unknown> = { slug: cfg.slug, layer: cfg.layer, id_municipalite: cfg.id, code_field: cfg.codeField, wfs_url: url };
    try {
      const served = await readServed(s3, cfg.slug);
      const servedCanon = new Set(served["_codesCanon"] as string[]);
      delete served["_codesCanon"];
      Object.assign(r, served);

      const gj = await fetchJson(url) as { type?: string; features?: Feat[]; numberMatched?: unknown; numberReturned?: unknown; totalFeatures?: unknown };
      const feats = Array.isArray(gj.features) ? gj.features : [];
      r.wfs_is_featurecollection = gj.type === "FeatureCollection";
      r.wfs_feature_count = feats.length;
      r.wfs_number_matched = typeof gj.numberMatched === "number" ? gj.numberMatched : gj.numberMatched;
      r.wfs_number_returned = typeof gj.numberReturned === "number" ? gj.numberReturned : gj.numberReturned;
      r.wfs_total_features = gj.totalFeatures ?? null;
      const geomTypes = new Set<string>();
      for (const f of feats) { const gt = f.geometry?.type; if (typeof gt === "string") geomTypes.add(gt); }
      r.wfs_geometry_types = [...geomTypes].sort();
      r.wfs_all_polygonal = geomTypes.size > 0 && [...geomTypes].every((x) => /Polygon/i.test(x));
      // grain
      const allKeys = new Set<string>();
      for (const f of feats) for (const k of Object.keys(f.properties ?? {})) allKeys.add(k);
      r.wfs_property_keys = [...allKeys].sort();
      const upper = new Map([...allKeys].map((k) => [k.toUpperCase(), k]));
      const uev = UEV_MARKER_FIELDS.filter((m) => upper.has(m)).map((m) => upper.get(m)!);
      r.wfs_uev_fields_present = uev;
      r.wfs_grain_classified = uev.length > 0 ? "evaluation-unit" : "zone-polygon";
      // code field distinct + overlap
      const capCanon = new Set<string>(); const capRaw: string[] = []; let nullCode = 0;
      for (const f of feats) {
        const v = f.properties?.[cfg.codeField];
        const s = v === null || v === undefined ? "" : String(v).trim();
        if (!s) { nullCode++; continue; }
        capCanon.add(canon(s)); if (capRaw.length < 20) capRaw.push(s);
      }
      r.wfs_code_null_count = nullCode;
      r.wfs_distinct_codes = capCanon.size;
      r.wfs_sample_codes = capRaw;
      const uncovered = [...servedCanon].filter((c) => !capCanon.has(c)).sort();
      r.overlap_served_into_wfs = overlap(servedCanon, capCanon);
      r.served_codes_uncovered_by_wfs = uncovered;
      r.overlap_pct = servedCanon.size ? Math.round(((servedCanon.size - uncovered.length) / servedCanon.size) * 1000) / 10 : null;
      // completeness (WFS)
      const nm = r.wfs_number_matched as number | undefined; const nr = r.wfs_number_returned as number | undefined;
      r.wfs_complete = typeof nm === "number" && typeof nr === "number" && nr === nm && feats.length === nm;
      r.wfs_count_matches_served = feats.length === (served["served_features"] as number);
      // nearest
      r.nearest = nearestMuni(feats, registry);
      // pilot verdict hint
      const unproven = !(served["served_has_feature_v2_proof"] as boolean) && !(served["served_has_collection_v2"] as boolean);
      r.served_unproven = unproven;
      r.pilot_ready = unproven && r.wfs_all_polygonal === true && (uev.length === 0) && r.wfs_complete === true
        && (r.overlap_pct as number) >= 90 && (r.nearest as { slug: string | null }).slug === cfg.slug && nullCode === 0;
    } catch (e) {
      r.error = (e as Error).message;
    }
    results.push(r);
    process.stderr.write(`[probe] ${cfg.slug} (${cfg.layer}): served=${String(r.served_features)} wfs=${String(r.wfs_feature_count)} overlap=${String(r.overlap_pct)}% unproven=${String(r.served_unproven)} complete=${String(r.wfs_complete)} nearest=${String((r.nearest as {slug?:string} | undefined)?.slug)} pilot_ready=${String(r.pilot_ready)}\n`);
  }
  const record = { contract: "zones-vnatif-inspect-geocentralis-pilot/diagnostic", date: "2026-08-10", host: HOST, munis: results };
  const out = arg("out");
  if (out) { writeFileSync(resolve(ROOT, out), `${JSON.stringify(record, null, 1)}\n`, "utf8"); process.stderr.write(`RECORD → ${out}\n`); }
  else process.stdout.write(`${JSON.stringify(record, null, 1)}\n`);
}

main().catch((e) => { process.stderr.write(`${(e as Error).stack ?? String(e)}\n`); process.exit(1); });
