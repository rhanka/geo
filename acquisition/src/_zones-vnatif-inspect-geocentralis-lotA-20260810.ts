/**
 * _zones-vnatif-inspect-geocentralis-lotA-20260810.ts — SONDE DIAGNOSTIC (lecture seule).
 *
 * LOT-A du batch géoCentralis WFS (candidate/legacy-traceable → documented v2), suite du
 * pilote 3-munis (05de001a/cd363a04). Sélectionne les ~40 PREMIERS munis géoCentralis de
 * `work/coverage/zones-v2-upgrade-scoping-20260810.json` (host geoserver.geocentralis.com),
 * EXCLUS les 3 déjà déposés (adstock, baie-comeau, beauceville).
 *
 * Pour chaque muni : parse la couche + id_municipalite depuis zone_source_url (fragment
 * déclaratif OU query), lit le SERVI (S3, lecture seule), et fetch la couche WFS LIVE
 * (GetFeature complet, GetFeature outputFormat json). Deux couches partagées :
 *   - evb:zonage_municipal   → code = no_zonage_municipal
 *   - evb:siadmin_pzon_99_s  → code = etiquette_1
 * CQL_FILTER=id_municipalite=<id>. QUOTAGE (zéros de tête) : on TESTE une liste ordonnée de
 * candidats (règle par couche + alternative) et on retient le PREMIER qui satisfait
 * numberMatched>0 ET nearest==slug ET overlap≥90% ET polygonal ET aucun UEV ET servi non-prouvé.
 *
 * ÉMET la worklist de capture (clés EXACTES {slug, source:"zones-vnatif", urls:[wfs-url]}) —
 * SEULS les munis dont un candidat gagne y entrent. Écrit aussi un record diagnostic complet.
 *
 * N'ÉCRIT RIEN sur S3. Ne capture RIEN (fetch LIVE d'analyse, pas un dépôt).
 *
 * USAGE :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_zones-vnatif-inspect-geocentralis-lotA-20260810.ts \
 *     --out work/coverage/_zones-vnatif-inspect-geocentralis-lotA-20260810.json \
 *     --worklist work/coverage/zones-vnatif-capture-worklist-geocentralis-lotA-20260810.json \
 *     [--limit 40]
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
const SCOPING = "work/coverage/zones-v2-upgrade-scoping-20260810.json";
const ALREADY_DEPOSITED = new Set(["adstock", "baie-comeau", "beauceville"]);
const OVERLAP_MIN_PCT = 90;
const CODE_FIELD_BY_LAYER: Record<string, string> = {
  "evb:zonage_municipal": "no_zonage_municipal",
  "evb:siadmin_pzon_99_s": "etiquette_1",
};

function requireS3(): void {
  const opts = process.env["NODE_OPTIONS"] ?? "";
  if (!opts.split(/\s+/).includes("--dns-result-order=ipv4first")) throw new Error("lecture S3 refusée: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  if (process.env["AWS_MAX_ATTEMPTS"] !== "10") throw new Error("lecture S3 refusée: préfixer AWS_MAX_ATTEMPTS=10");
}
function arg(name: string): string | undefined { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; }
function canon(value: unknown): string { return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }

interface Feat { geometry?: { type?: string; coordinates?: unknown } | null; properties?: Record<string, unknown> | null }

// ── Sélection du lot depuis le scoping (déterministe, ordre de la liste) ────────
interface MuniCfg { slug: string; layer: string; id: string; codeField: string; level: string; served_url: string }
function parseLayerId(u: string): { layer: string | null; id: string | null } {
  let m = /#(evb:[a-z0-9_]+)\[id_municipalite=([0-9]+)\]/i.exec(u);
  if (m) return { layer: m[1]!, id: m[2]! };
  const ml = /typeNames=(evb:[a-z0-9_]+)/i.exec(u);
  const mi = /id_municipalite=(?:')?([0-9]+)(?:')?/i.exec(u);
  if (ml && mi) return { layer: ml[1]!, id: mi[1]! };
  return { layer: null, id: null };
}
function selectLot(limit: number): MuniCfg[] {
  const raw = JSON.parse(readFileSync(resolve(ROOT, SCOPING), "utf8")) as { upgradable_list: Array<Record<string, unknown>> };
  const out: MuniCfg[] = [];
  for (const e of raw.upgradable_list) {
    if (out.length >= limit) break;
    if (e["url_host"] !== "geoserver.geocentralis.com") continue;
    const slug = String(e["slug"] ?? "");
    if (!slug || ALREADY_DEPOSITED.has(slug)) continue;
    const { layer, id } = parseLayerId(String(e["zone_source_url"] ?? ""));
    if (!layer || !id) continue;
    const codeField = CODE_FIELD_BY_LAYER[layer];
    if (!codeField) continue;
    out.push({ slug, layer, id, codeField, level: String(e["level"] ?? ""), served_url: String(e["zone_source_url"] ?? "") });
  }
  return out;
}

/** Candidats d'URL ordonnés par couche + quotage (zéros de tête). Canonicalisés via new URL(). */
function candidateUrls(cfg: MuniCfg): string[] {
  const base = (cql: string): string =>
    new URL(`${HOST}?service=WFS&version=2.0.0&request=GetFeature&typeNames=${cfg.layer}&outputFormat=application/json&CQL_FILTER=id_municipalite=${cql}`).toString();
  const quoted = base(`'${cfg.id}'`);
  const unquoted = base(cfg.id);
  // zonage_municipal: champ numérique → non-quoté d'abord. siadmin_pzon_99_s: chaîne → quoté d'abord.
  const ordered = cfg.layer === "evb:siadmin_pzon_99_s" ? [quoted, unquoted] : [unquoted, quoted];
  return [...new Set(ordered)];
}

async function fetchJson(url: string, timeoutMs = 45_000): Promise<unknown> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { "User-Agent": "sentropic-geo-count-probe/1" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

// ── Registre municipal (anti-homonyme) ─────────────────────────────────────────
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

async function readServed(s3: ReturnType<typeof s3Client>, slug: string): Promise<{
  keys: string[]; layout: string; features: number; distinctCodes: number; sampleCodes: string[];
  levels: string[]; urls: (string | null)[]; hasV2: boolean; hasCollectionV2: boolean; codesCanon: string[];
}> {
  const flat = `${S3_PREFIX}qc-zonage-${slug}.geojson`;
  const nested = `${S3_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`;
  const keys: string[] = [];
  if (await exists(s3, flat)) keys.push(flat);
  if (await exists(s3, nested)) keys.push(nested);
  const codesCanon = new Set<string>(); const rawSample: string[] = [];
  const levels = new Set<string>(); const urls = new Set<string | null>();
  let features = 0; let hasV2 = false; let hasCollectionV2 = false;
  for (const k of keys) {
    const fc = JSON.parse((await getBytes(s3, k)).toString("utf8")) as { proof?: { schema_version?: unknown }; features?: Feat[] };
    if (fc.proof?.schema_version === "2.0") hasCollectionV2 = true;
    const feats = Array.isArray(fc.features) ? fc.features : [];
    features = Math.max(features, feats.length);
    for (const f of feats) {
      const p = f.properties ?? {};
      const zc = p["zone_code"]; const c = canon(zc); if (c) { codesCanon.add(c); if (rawSample.length < 20) rawSample.push(String(zc)); }
      levels.add(typeof p["zone_source_level"] === "string" ? p["zone_source_level"] : "(none)");
      urls.add(typeof p["zone_source_url"] === "string" ? p["zone_source_url"] : null);
      if (featureHasV2Proof(f)) hasV2 = true;
    }
  }
  return {
    keys, layout: keys.length === 2 ? "both" : keys.includes(flat) ? "flat" : keys.includes(nested) ? "nested" : "none",
    features, distinctCodes: codesCanon.size, sampleCodes: rawSample, levels: [...levels].sort(), urls: [...urls],
    hasV2, hasCollectionV2, codesCanon: [...codesCanon],
  };
}

interface Attempt { url: string; number_matched: number | null; number_returned: number | null; features: number; complete: boolean; all_polygonal: boolean; uev: string[]; null_code: number; distinct_codes: number; overlap_pct: number | null; nearest: string | null; nearest_km: number | null; error: string | null; win: boolean }

async function evaluateCandidate(url: string, cfg: MuniCfg, servedCanon: Set<string>, registry: MuniEntry[]): Promise<Attempt> {
  const a: Attempt = { url, number_matched: null, number_returned: null, features: 0, complete: false, all_polygonal: false, uev: [], null_code: 0, distinct_codes: 0, overlap_pct: null, nearest: null, nearest_km: null, error: null, win: false };
  try {
    const gj = await fetchJson(url) as { type?: string; features?: Feat[]; numberMatched?: unknown; numberReturned?: unknown };
    const feats = Array.isArray(gj.features) ? gj.features : [];
    a.number_matched = typeof gj.numberMatched === "number" ? gj.numberMatched : null;
    a.number_returned = typeof gj.numberReturned === "number" ? gj.numberReturned : null;
    a.features = feats.length;
    a.complete = a.number_matched !== null && a.number_returned !== null && a.number_returned === a.number_matched && feats.length === a.number_matched;
    const geomTypes = new Set<string>();
    for (const f of feats) { const gt = f.geometry?.type; if (typeof gt === "string") geomTypes.add(gt); }
    a.all_polygonal = geomTypes.size > 0 && [...geomTypes].every((x) => /Polygon/i.test(x));
    const allKeys = new Set<string>();
    for (const f of feats) for (const k of Object.keys(f.properties ?? {})) allKeys.add(k);
    const upper = new Map([...allKeys].map((k) => [k.toUpperCase(), k]));
    a.uev = UEV_MARKER_FIELDS.filter((m) => upper.has(m)).map((m) => upper.get(m)!);
    const capCanon = new Set<string>();
    for (const f of feats) { const v = f.properties?.[cfg.codeField]; const s = v === null || v === undefined ? "" : String(v).trim(); if (!s) a.null_code++; else capCanon.add(canon(s)); }
    a.distinct_codes = capCanon.size;
    const uncovered = [...servedCanon].filter((c) => !capCanon.has(c));
    a.overlap_pct = servedCanon.size ? Math.round(((servedCanon.size - uncovered.length) / servedCanon.size) * 1000) / 10 : null;
    const near = nearestMuni(feats, registry);
    a.nearest = near.slug; a.nearest_km = near.km;
    a.win = feats.length > 0 && a.complete && a.all_polygonal && a.uev.length === 0 && a.null_code === 0
      && a.nearest === cfg.slug && a.overlap_pct !== null && a.overlap_pct >= OVERLAP_MIN_PCT;
  } catch (e) { a.error = (e as Error).message; }
  return a;
}

async function main(): Promise<void> {
  requireS3();
  const s3 = s3Client();
  const registry = loadRegistry();
  const limit = Number(arg("limit") ?? 40);
  const lot = selectLot(limit);
  const results: Record<string, unknown>[] = [];
  const worklist: { slug: string; source: "zones-vnatif"; urls: string[] }[] = [];
  for (const cfg of lot) {
    const r: Record<string, unknown> = { slug: cfg.slug, layer: cfg.layer, id_municipalite: cfg.id, code_field: cfg.codeField, level: cfg.level, served_source_url: cfg.served_url };
    try {
      const served = await readServed(s3, cfg.slug);
      const servedCanon = new Set(served.codesCanon);
      r.served_keys = served.keys; r.served_layout = served.layout; r.served_features = served.features;
      r.served_distinct_codes = served.distinctCodes; r.served_sample_codes = served.sampleCodes;
      r.served_levels = served.levels; r.served_source_urls = served.urls;
      r.served_has_feature_v2_proof = served.hasV2; r.served_has_collection_v2 = served.hasCollectionV2;
      const unproven = !served.hasV2 && !served.hasCollectionV2;
      r.served_unproven = unproven;

      const attempts: Attempt[] = [];
      let winner: Attempt | null = null;
      for (const url of candidateUrls(cfg)) {
        const a = await evaluateCandidate(url, cfg, servedCanon, registry);
        attempts.push(a);
        if (a.win && unproven) { winner = a; break; }
      }
      r.attempts = attempts;
      r.winning_url = winner?.url ?? null;
      r.pilot_ready = winner !== null && unproven;
      if (winner) {
        r.wfs_number_matched = winner.number_matched; r.wfs_number_returned = winner.number_returned;
        r.wfs_features = winner.features; r.overlap_pct = winner.overlap_pct; r.nearest = winner.nearest; r.nearest_km = winner.nearest_km;
        worklist.push({ slug: cfg.slug, source: "zones-vnatif", urls: [winner.url] });
      } else {
        // raison la plus proche
        const best = attempts.find((a) => a.number_matched && a.number_matched > 0) ?? attempts[0];
        r.hold_reason = !unproven ? "servi porte déjà une preuve v2 (hors périmètre upgrade)"
          : best ? `aucun candidat gagnant: nm=${String(best.number_matched)} complete=${best.complete} poly=${best.all_polygonal} uev=${best.uev.length} nullcode=${best.null_code} nearest=${String(best.nearest)} overlap=${String(best.overlap_pct)}% err=${String(best.error)}`
          : "aucun candidat évalué";
      }
    } catch (e) {
      r.error = (e as Error).message;
    }
    results.push(r);
    process.stderr.write(`[probe] ${cfg.slug} (${cfg.layer} id=${cfg.id}): served=${String(r.served_features)} unproven=${String(r.served_unproven)} winner=${String(r.winning_url ? "yes" : "NO")} overlap=${String(r.overlap_pct)}% nm=${String(r.wfs_number_matched)} nearest=${String(r.nearest)}\n`);
  }

  const record = {
    contract: "zones-vnatif-inspect-geocentralis-lotA/diagnostic",
    date: "2026-08-10", host: HOST, lot_size: lot.length,
    selected: lot.map((c) => ({ slug: c.slug, layer: c.layer, id: c.id })),
    worklist_size: worklist.length,
    munis: results,
  };
  const out = arg("out");
  if (out) { writeFileSync(resolve(ROOT, out), `${JSON.stringify(record, null, 1)}\n`, "utf8"); process.stderr.write(`RECORD → ${out}\n`); }
  const wlPath = arg("worklist");
  if (wlPath) { writeFileSync(resolve(ROOT, wlPath), `${JSON.stringify(worklist, null, 2)}\n`, "utf8"); process.stderr.write(`WORKLIST (${worklist.length}) → ${wlPath}\n`); }
  if (!out && !wlPath) process.stdout.write(`${JSON.stringify(record, null, 1)}\n`);
}

main().catch((e) => { process.stderr.write(`${(e as Error).stack ?? String(e)}\n`); process.exit(1); });
