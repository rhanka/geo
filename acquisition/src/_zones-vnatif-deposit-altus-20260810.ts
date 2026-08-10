/**
 * _zones-vnatif-deposit-altus-20260810.ts — DÉPÔT v2 candidate/legacy-traceable
 * → documented du batch ALTUS (ArcGIS MapServer `gis.altusquebec.com` qui HONORE
 * f=geojson), grain zone-polygon, type de preuve = arcgis / natif / directe.
 *
 * Réplique EXACTE de la recette de dépôt géoCentralis lot-D (commit f6f44d95) —
 * G2 byte-exact, grain, anti-homonyme, gate PROVENANCE-AWARE, level→documented,
 * url=proof.url, backup _replaced/, dropped→UNKNOWN (jamais N-A), readback G5.
 * SEULES DIFFÉRENCES avec géoCentralis :
 *   (1) SOURCE = ArcGIS MapServer `<layer>/query?where=1=1&outFields=*&f=geojson`
 *       (au lieu du WFS géoCentralis). Preuve type=arcgis (au lieu de wfs).
 *   (2) ANTI-TRONCATURE ArcGIS : le payload geojson ne porte PAS numberMatched/
 *       numberReturned ; on oppose donc `exceededTransferLimit !== true` (capturé)
 *       ET une requête de comptage LIVE `<layer>/query?where=1=1&returnCountOnly=true
 *       &f=json` → { count } == features (numberReturned==numberMatched).
 *   (3) CHAMP CODE-ZONE non uniforme sur altus → RÉSOLU par muni, jamais deviné :
 *       parmi les champs non-techniques, on retient celui qui, sans valeur vide,
 *       ≥3 codes distincts, REPRODUIT ≥90% des codes DÉJÀ SERVIS (legacy). Le
 *       recouvrement avec la vérité-terrain servie EST le discriminateur (Zone
 *       "A-123" / Usage "15-RE" / Zonage "43-I" selon la couche). zone_code =
 *       valeur BRUTE de ce champ (aucune dérivation synthétique).
 *
 * `--dry-run` (défaut) : resolve + G2 + grain + résolution-champ + overlap SANS déposer.
 * `--commit`           : dépose réellement.
 * `--only <slug>`      : restreint à un muni.
 * `--worklist f.json`  : worklist source (défaut altus).
 * `--out f.json`       : écrit le record.
 *
 * USAGE :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_zones-vnatif-deposit-altus-20260810.ts \
 *     [--commit] [--only <slug>] --out work/coverage/zones-vnatif-deposit-record-altus-20260810.json
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CaptureRunHeaderSchema,
  captureRunKeys,
  parseManifestJsonl,
  type CaptureManifestLine,
} from "../../packages/qc-sources/src/capture/index.js";
import { exists, getBytes, listObjectEntries, s3Client } from "./lib/s3.js";
import { captureReceiptFromManifest } from "./lib/zone-provenance-quality.js";
import { verifyRawCapturePayload } from "./lib/zone-provenance-raw-capture.js";
import { proofFromCaptureEntry, type GeometryGrain } from "./lib/zonage-proof.js";
import { depositCapturedZones, normalize } from "./zones-obscura-run.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const LANE = "zones";
const S3_PREFIX = "normalized/ca-qc-zonage/";
const UEV_MARKER_FIELDS = ["ID_UEV", "MATRICULE8", "CODE_UTILI"] as const;
const ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const RUN_STAMP = "20260810T190000Z";
const OVERLAP_MIN_PCT = 90;
const DEFAULT_WORKLIST = "work/coverage/zones-vnatif-capture-worklist-altus-20260810.json";
// Champs jamais éligibles comme code-zone (géométrie / id / audit / admin-muni).
const TECHNICAL_EXCLUDE = new Set<string>([
  "OBJECTID", "OBJECTID_1", "ID", "SHAPE", "SHAPE_LENGTH", "SHAPE_AREA", "SHAPE_LENG",
  "CREATED_USER", "CREATED_DATE", "LAST_EDITED_USER", "LAST_EDITED_DATE", "NUM_FICHIER",
  "NO_CERTIFICAT", "NO_ILOT", "CODE_MUN", "NOM_MUN", "MUN", "NUMERO_REGLEMENT", "ADOPTE", "EN_VIGUEUR",
]);
// Noms canoniques de champ code-zone connus (départage un recouvrement ÉGAL uniquement).
const KNOWN_CODE_NAMES = new Set<string>(["ZONE", "ZONAGE", "NUMZONE", "NOZONE"]);

interface MuniCfg { slug: string; url: string }

function requireS3(): void {
  const opts = process.env["NODE_OPTIONS"] ?? "";
  if (!opts.split(/\s+/).includes("--dns-result-order=ipv4first")) throw new Error("S3 refusé: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  if (process.env["AWS_MAX_ATTEMPTS"] !== "10") throw new Error("S3 refusé: préfixer AWS_MAX_ATTEMPTS=10");
}
function arg(name: string): string | undefined { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; }
function has(name: string): boolean { return process.argv.includes(`--${name}`); }
function canon(value: unknown): string { return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function canonName(s: string): string { return s.toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function shaBare(s: string | null | undefined): string | null { return typeof s === "string" ? s.replace(/^sha256:/, "") : null; }
function sha256Hex(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
function countUrlFor(geojsonUrl: string): string {
  const base = geojsonUrl.split("/query?")[0]!;
  return new URL(`${base}/query?where=1=1&returnCountOnly=true&f=json`).toString();
}

function loadWorklistCfgs(worklistPath: string): MuniCfg[] {
  const raw = JSON.parse(readFileSync(resolve(ROOT, worklistPath), "utf8")) as Array<{ slug: string; source: string; urls: string[] }>;
  return raw.map((t) => ({ slug: t.slug, url: t.urls[0]! }));
}

interface Feat { geometry?: unknown; properties?: Record<string, unknown> | null }
function geometryDigest(features: Feat[]): string {
  const h = createHash("sha256");
  for (const f of features) h.update(JSON.stringify(f.geometry ?? null));
  return `sha256:${h.digest("hex")}`;
}
function featureHasRealV2Proof(f: Feat): boolean {
  const p = (f.properties ?? {}) as { proof?: { geometry_source?: { sha256?: unknown; retrieved_at?: unknown } } | null };
  const gs = p.proof?.geometry_source;
  if (!gs) return false;
  const shaOk = typeof gs.sha256 === "string" && /^sha256:[a-f0-9]{64}$/.test(gs.sha256);
  const retrievedOk = typeof gs.retrieved_at === "string" && ISO_TS_RE.test(gs.retrieved_at) && !Number.isNaN(Date.parse(gs.retrieved_at));
  return shaOk && retrievedOk;
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

// ── Capture line resolution ─────────────────────────────────────────────────────
function runIdsFromKeys(keys: string[]): string[] {
  const ids = new Set<string>();
  for (const k of keys) { const m = /^capture\/_runs\/(.+?)\/manifest\.jsonl$/.exec(k); if (m) ids.add(m[1]!); }
  return [...ids].sort();
}
interface RunData { run_id: string; ok: boolean; lines: CaptureManifestLine[] }
async function loadRuns(s3: ReturnType<typeof s3Client>, stamp: string): Promise<RunData[]> {
  const prefix = `capture/_runs/${LANE}-${stamp}-`;
  const keys = (await listObjectEntries(s3, prefix)).map((e) => e.key);
  const runs: RunData[] = [];
  for (const runId of runIdsFromKeys(keys)) {
    const rk = captureRunKeys(runId);
    try {
      const header = CaptureRunHeaderSchema.parse(JSON.parse((await getBytes(s3, rk.header)).toString("utf8")));
      const ok = header.run_id === runId && header.finished_at !== null && header.exit_code === 0;
      const lines = parseManifestJsonl((await getBytes(s3, rk.manifest)).toString("utf8"));
      runs.push({ run_id: runId, ok, lines });
    } catch { runs.push({ run_id: runId, ok: false, lines: [] }); }
  }
  return runs;
}
function findLine(runs: RunData[], url: string): { run_id: string; line: CaptureManifestLine } | null {
  for (const r of runs) {
    if (!r.ok) continue;
    const direct = r.lines.filter((l) => l.url === url);
    const matches = direct.length > 0 ? direct : r.lines.filter((l) => l.final_url === url);
    if (matches.length === 1) return { run_id: r.run_id, line: matches[0]! };
    if (matches.length > 1) throw new Error(`run ${r.run_id}: ${matches.length} lignes matchent ${url}`);
  }
  return null;
}

// ── Source count (LIVE) — ArcGIS returnCountOnly → { count } ─────────────────────
async function fetchJson(url: string, timeoutMs = 40_000): Promise<unknown> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { "User-Agent": "sentropic-geo-count-probe/1", accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}
async function liveCount(url: string): Promise<{ count: number | null; error: string | null }> {
  try {
    const gj = await fetchJson(countUrlFor(url)) as { count?: unknown; error?: unknown };
    if (gj && typeof gj === "object" && "error" in gj && gj.error) return { count: null, error: `arcgis error: ${JSON.stringify(gj.error).slice(0, 120)}` };
    return { count: typeof gj.count === "number" ? gj.count : null, error: null };
  } catch (e) { return { count: null, error: (e as Error).message }; }
}

// ── Served (before) ──────────────────────────────────────────────────────────────
interface ServedState { keys: string[]; layout: string; features: number; codes: Set<string>; levels: string[]; urls: (string | null)[]; hasRealV2ProofBlock: boolean; hasCollectionV2: boolean }
function keyFor(slug: string): { flat: string; nested: string } {
  return { flat: `${S3_PREFIX}qc-zonage-${slug}.geojson`, nested: `${S3_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson` };
}
async function readServed(s3: ReturnType<typeof s3Client>, slug: string): Promise<ServedState> {
  const { flat, nested } = keyFor(slug);
  const keys: string[] = [];
  if (await exists(s3, flat)) keys.push(flat);
  if (await exists(s3, nested)) keys.push(nested);
  const codes = new Set<string>(); const levels = new Set<string>(); const urls = new Set<string | null>();
  let features = 0, hasRealV2ProofBlock = false, hasCollectionV2 = false;
  for (const k of keys) {
    const fc = JSON.parse((await getBytes(s3, k)).toString("utf8")) as { proof?: { schema_version?: unknown }; features?: Feat[] };
    if (fc.proof?.schema_version === "2.0") hasCollectionV2 = true;
    const feats = Array.isArray(fc.features) ? fc.features : [];
    features = Math.max(features, feats.length);
    for (const f of feats) {
      const p = f.properties ?? {};
      const c = canon(p["zone_code"]); if (c) codes.add(c);
      levels.add(typeof p["zone_source_level"] === "string" ? p["zone_source_level"] : "(none)");
      urls.add(typeof p["zone_source_url"] === "string" ? p["zone_source_url"] : null);
      if (featureHasRealV2Proof(f)) hasRealV2ProofBlock = true;
    }
  }
  const layout = keys.length === 2 ? "both" : keys.includes(flat) ? "flat" : keys.includes(nested) ? "nested" : "none";
  return { keys, layout, features, codes, levels: [...levels].sort(), urls: [...urls], hasRealV2ProofBlock, hasCollectionV2 };
}
function proofShas(fc: unknown): Set<string> {
  const out = new Set<string>();
  const rec = fc as { proof?: { geometry_source?: { sha256?: string } }; features?: Array<{ properties?: { proof?: { geometry_source?: { sha256?: string } } } | null }> };
  const cs = shaBare(rec.proof?.geometry_source?.sha256); if (cs) out.add(cs);
  for (const f of rec.features ?? []) { const s = shaBare(f.properties?.proof?.geometry_source?.sha256); if (s) out.add(s); }
  return out;
}

// ── Résolution du champ code-zone par recouvrement avec le servi ────────────────
interface FieldStat { field: string; distinct: number; null_count: number; overlap_pct: number | null }
function resolveCodeField(feats: Feat[], servedCodes: Set<string>): { chosen: string | null; stats: FieldStat[] } {
  const keys = new Set<string>();
  for (const f of feats) for (const k of Object.keys(f.properties ?? {})) keys.add(k);
  const stats: FieldStat[] = [];
  for (const key of keys) {
    if (TECHNICAL_EXCLUDE.has(canonName(key))) continue;
    const distinct = new Set<string>(); let nullCount = 0;
    for (const f of feats) {
      const raw = f.properties?.[key];
      const s = raw === null || raw === undefined ? "" : String(raw).trim();
      if (!s) nullCount++; else distinct.add(canon(s));
    }
    const covered = servedCodes.size > 0 ? [...servedCodes].filter((c) => distinct.has(c)).length : 0;
    const overlap = servedCodes.size > 0 ? Math.round((covered / servedCodes.size) * 1000) / 10 : null;
    stats.push({ field: key, distinct: distinct.size, null_count: nullCount, overlap_pct: overlap });
  }
  const eligible = stats.filter((s) => s.null_count === 0 && s.distinct >= 3 && s.overlap_pct !== null && s.overlap_pct >= OVERLAP_MIN_PCT);
  eligible.sort((a, b) =>
    (b.overlap_pct! - a.overlap_pct!) ||
    (Number(KNOWN_CODE_NAMES.has(canonName(b.field))) - Number(KNOWN_CODE_NAMES.has(canonName(a.field)))) ||
    (b.distinct - a.distinct) ||
    a.field.localeCompare(b.field),
  );
  stats.sort((a, b) => (b.overlap_pct ?? -1) - (a.overlap_pct ?? -1) || b.distinct - a.distinct);
  return { chosen: eligible[0]?.field ?? null, stats: stats.slice(0, 12) };
}

async function processMuni(
  s3: ReturnType<typeof s3Client>,
  runs: RunData[],
  registry: MuniEntry[],
  cfg: MuniCfg,
  commit: boolean,
): Promise<Record<string, unknown>> {
  const url = cfg.url;
  const entry: Record<string, unknown> = {
    slug: cfg.slug, run_stamp: RUN_STAMP, source_url: url, count_url: countUrlFor(url), zone_code_source: "champ résolu par recouvrement ≥90% avec le servi (valeur brute)",
  };
  try {
    const found = findLine(runs, url);
    if (!found) { entry.statut = "SKIP"; entry.raison = "capture introuvable (aucune ligne url|final_url dans les shards du run-stamp)"; return entry; }
    const { run_id, line } = found;
    entry.capture_run_id = run_id; entry.http_status = line.http_status; entry.sha256 = line.sha256; entry.retrieved_at = line.retrieved_at; entry.storage_key = line.storage_key;
    if (line.redacted || line.http_status === null || line.http_status < 200 || line.http_status >= 300 || line.storage_key === null || line.sha256 === null) {
      entry.statut = "SKIP"; entry.raison = `capture non déposable: status=${String(line.http_status)} sha=${String(line.sha256)}`; return entry;
    }
    // G2 byte-exact
    const bytes = await getBytes(s3, line.storage_key);
    const rehashOk = `sha256:${sha256Hex(bytes)}` === line.sha256;
    const casInName = /\/cas\/([a-f0-9]{64})\./.exec(line.storage_key)?.[1] ?? null;
    const casKeyOk = casInName !== null && `sha256:${casInName}` === line.sha256;
    entry.rehash_ok = rehashOk; entry.cas_key_matches = casKeyOk;
    const receipt = captureReceiptFromManifest(line, captureRunKeys(run_id).manifest, 0);
    let rawVerified = false, rawReason: string | null = "reçu invalide";
    if (receipt) {
      const sidecar = JSON.parse((await getBytes(s3, `${line.storage_key}.meta.json`)).toString("utf8")) as unknown;
      const v = verifyRawCapturePayload(receipt, bytes, sidecar); rawVerified = v.verified; rawReason = v.reason;
    }
    entry.raw_capture_verified = rawVerified; entry.raw_capture_reason = rawReason;
    if (!rehashOk || !casKeyOk || !rawVerified) {
      entry.statut = "SKIP"; entry.raison = `byte-exact NON prouvé (rehash=${rehashOk} casKey=${casKeyOk} raw=${rawVerified}:${rawReason})`; return entry;
    }
    // Parse ArcGIS geojson
    const gj = JSON.parse(bytes.toString("utf8")) as { type?: string; features?: Feat[]; exceededTransferLimit?: unknown; error?: unknown };
    const feats = Array.isArray(gj.features) ? gj.features : [];
    const isFC = gj.type === "FeatureCollection";
    const exceeded = gj.exceededTransferLimit === true;
    entry.is_featurecollection = isFC; entry.feature_count = feats.length; entry.exceeded_transfer_limit = exceeded;
    if (gj && typeof gj === "object" && "error" in gj && gj.error) { entry.statut = "SKIP"; entry.raison = `capture = objet d'erreur ArcGIS (${JSON.stringify(gj.error).slice(0, 120)})`; entry.arcgis_error = gj.error; return entry; }
    const geomTypes = new Set<string>();
    for (const f of feats) { const gt = (f.geometry as { type?: string } | null)?.type; if (typeof gt === "string") geomTypes.add(gt); }
    entry.geometry_types = [...geomTypes].sort();
    const allPolygonal = geomTypes.size > 0 && [...geomTypes].every((x) => /Polygon/i.test(x));
    entry.all_polygonal = allPolygonal;
    const near = nearestMuni(feats, registry);
    entry.nearest_registre_muni = near.slug; entry.registry_attribution_km = near.km;
    const nearestOk = near.slug === cfg.slug; entry.nearest_matches_slug = nearestOk;
    // grain
    const propKeys = new Set<string>();
    for (const f of feats) for (const k of Object.keys(f.properties ?? {})) propKeys.add(k);
    const upper = new Map([...propKeys].map((k) => [k.toUpperCase(), k]));
    const uevPresent = UEV_MARKER_FIELDS.filter((m) => upper.has(m)).map((m) => upper.get(m)!);
    const grain: GeometryGrain = uevPresent.length > 0 ? "evaluation-unit" : "zone-polygon";
    entry.uev_fields_present = uevPresent; entry.geometry_grain_classified = grain;
    // Served before
    const served = await readServed(s3, cfg.slug);
    entry.served_keys = served.keys; entry.served_layout = served.layout; entry.served_features = served.features;
    entry.served_distinct_codes = served.codes.size; entry.served_levels = served.levels; entry.served_source_urls = served.urls;
    entry.served_has_real_v2_proof_block = served.hasRealV2ProofBlock; entry.served_has_collection_v2 = served.hasCollectionV2;
    // Résolution du champ code-zone par recouvrement ≥90% avec le servi
    const { chosen, stats } = resolveCodeField(feats, served.codes);
    entry.field_candidates = stats; entry.code_field_chosen = chosen;
    // zone_code (valeur brute du champ résolu)
    const capCodes = new Set<string>(); let nullCode = 0; const sample: Record<string, unknown>[] = [];
    if (chosen) {
      for (const f of feats) {
        const raw = f.properties?.[chosen];
        const s = raw === null || raw === undefined ? "" : String(raw).trim();
        if (!s) nullCode++; else capCodes.add(canon(s));
        if (sample.length < 8) sample.push({ code_field_value: raw, zone_code: s || null });
      }
    }
    entry.zone_code_null_count = nullCode; entry.capture_distinct_codes = capCodes.size; entry.sample_codes = sample;
    // overlap servi → capture (via le champ choisi)
    const uncovered = chosen ? [...served.codes].filter((c) => !capCodes.has(c)).sort() : [...served.codes].sort();
    const covered = served.codes.size - uncovered.length;
    entry.served_codes_covered = covered; entry.served_codes_uncovered = uncovered.length; entry.uncovered_codes = uncovered;
    const overlap = served.codes.size > 0 ? Math.round((covered / served.codes.size) * 1000) / 10 : null;
    entry.overlap_ratio_pct = overlap;
    // Anti-troncature ArcGIS : count LIVE == features ET !exceededTransferLimit
    const live = await liveCount(url);
    entry.live_count = live.count; entry.live_count_error = live.error;
    const countComplete = !exceeded && live.count !== null && feats.length === live.count;
    entry.count_complete = countComplete;
    entry.count_complete_basis = `!exceededTransferLimit(${!exceeded}) && live count(${String(live.count)}) == features(${feats.length})`;

    // ── Gardes ──
    const guards: string[] = [];
    if (served.keys.length === 0) guards.push("aucun servi (rien à upgrader)");
    if (!isFC || feats.length === 0) guards.push("capture vide/non-FC");
    if (!allPolygonal) guards.push("géométrie non 100% polygonale");
    if (!nearestOk) guards.push(`anti-homonyme: nearest=${String(near.slug)} != ${cfg.slug}`);
    if (!chosen) guards.push(`aucun champ code-zone ne reproduit ≥${OVERLAP_MIN_PCT}% des codes servis sans valeur vide (candidats=${stats.map((s) => `${s.field}:ov=${String(s.overlap_pct)}%,d=${s.distinct},null=${s.null_count}`).join(" | ")}) → ambigu, SKIP`);
    if (chosen && nullCode > 0) guards.push(`${nullCode} feature(s) sans zone_code (champ ${chosen} vide) — anti-invention`);
    if (!countComplete) guards.push(`G2 fetch partiel/tronqué: ${String(entry.count_complete_basis)}`);
    if (served.hasRealV2ProofBlock || served.hasCollectionV2) guards.push(`servi porte DÉJÀ une preuve v2 (collection=${served.hasCollectionV2}, feature_block=${served.hasRealV2ProofBlock}) → hors périmètre upgrade`);
    if (chosen && overlap !== null && overlap < OVERLAP_MIN_PCT) guards.push(`source-identity overlap ${overlap}% < ${OVERLAP_MIN_PCT}% → SKIP (HOLD, mauvaise-couche/ambigu)`);
    entry.guard_blocks = guards;

    if (guards.length > 0) { entry.statut = "SKIP"; entry.raison = guards.join(" ; "); return entry; }
    if (!commit) {
      entry.statut = "DRY-RUN-OK";
      entry.raison = `toutes gardes OK — prêt au dépôt candidate→documented (champ=${chosen}, overlap ${String(overlap)}%, ${uncovered.length} code(s) servi-seulement→UNKNOWN, grain=${grain}) (relancer avec --commit)`;
      return entry;
    }
    // ── Dépôt ──
    const norm = normalize(feats as never[], chosen!, url, "obscura-zone-vector");
    const proof = proofFromCaptureEntry(line, { type: "arcgis", method: "natif", reliability: "directe" });
    const res = await depositCapturedZones(s3, cfg.slug, norm, proof, { geometryGrain: grain });
    entry.deposited = true; entry.replaced_backups = res.replacedBackups;
    entry.dropped_divergence = res.droppedDivergence;
    const droppedCodes = res.droppedDivergence.map((d) => d.code).sort();
    entry.dropped_codes = droppedCodes; entry.dropped_count = droppedCodes.length;

    // Readback
    const capDigest = geometryDigest(feats);
    const { flat, nested } = keyFor(cfg.slug);
    const readbacks: Record<string, unknown>[] = [];
    let allOk = true;
    for (const key of [flat, nested]) {
      if (!(await exists(s3, key))) continue;
      const fc = JSON.parse((await getBytes(s3, key)).toString("utf8")) as { features?: Feat[]; proof?: { geometry_source?: { url?: string; retrieved_at?: string; sha256?: string } } };
      const sfeats = Array.isArray(fc.features) ? fc.features : [];
      const levels = new Set<string>(); const urls = new Set<string | null>(); const grains = new Set<unknown>();
      let hasZoneCode = true;
      for (const f of sfeats) {
        const p = f.properties ?? {};
        levels.add(typeof p["zone_source_level"] === "string" ? (p["zone_source_level"] as string) : "(none)");
        urls.add(typeof p["zone_source_url"] === "string" ? (p["zone_source_url"] as string) : null);
        grains.add(p["geometry_grain"]);
        if (!(typeof p["zone_code"] === "string" && p["zone_code"])) hasZoneCode = false;
      }
      const rb = {
        key, served_features: sfeats.length,
        feature_count_matches_capture: sfeats.length === feats.length,
        geometry_digest_byte_exact: geometryDigest(sfeats) === capDigest,
        zone_code_present_all: hasZoneCode,
        proof_url: fc.proof?.geometry_source?.url ?? null,
        proof_url_matches: fc.proof?.geometry_source?.url === proof.url,
        proof_sha256: fc.proof?.geometry_source?.sha256 ?? null,
        proof_sha_matches_capture: shaBare(fc.proof?.geometry_source?.sha256) === shaBare(line.sha256),
        proof_retrieved_at: fc.proof?.geometry_source?.retrieved_at ?? null,
        carries_capture_sha256: [...proofShas(fc)].includes(shaBare(line.sha256)!),
        zone_source_levels: [...levels].sort(),
        zone_source_urls: [...urls],
        level_documented: levels.size === 1 && levels.has("documented"),
        url_all_proof: [...urls].every((u) => u === proof.url),
        geometry_grain: [...grains],
        grain_uniform_expected: grains.size === 1 && grains.has(grain),
      };
      readbacks.push(rb);
      const ok = rb.feature_count_matches_capture && rb.geometry_digest_byte_exact && rb.zone_code_present_all && rb.proof_url_matches
        && rb.proof_sha_matches_capture && !!rb.proof_retrieved_at && rb.carries_capture_sha256
        && rb.level_documented && rb.url_all_proof && rb.grain_uniform_expected;
      if (!ok) allOk = false;
    }
    const replacedListed = (await listObjectEntries(s3, `${S3_PREFIX}_replaced/qc-zonage-${cfg.slug}__`)).map((e) => e.key);
    entry.replaced_backups_listed = replacedListed; entry.readback = readbacks;
    entry.readback_ok = allOk && replacedListed.length > 0;
    entry.statut = entry.readback_ok ? "DEPOSITED" : "DEPOSITED_READBACK_FAIL";
    entry.raison = entry.readback_ok
      ? `upgrade legacy-traceable→documented v2 byte-exact ; zone_code = ${chosen} brut (overlap ${String(overlap)}%) ; grain=${grain} ; ${droppedCodes.length} code(s) droppé(s)→UNKNOWN ; backup _replaced/ présent`
      : "DÉPÔT effectué mais readback inattendu — VÉRIFIER";
    return entry;
  } catch (e) {
    entry.statut = "ERROR"; entry.raison = (e as Error).message; entry.stack = (e as Error).stack;
    return entry;
  }
}

async function main(): Promise<void> {
  requireS3();
  const commit = has("commit");
  const only = arg("only");
  const out = arg("out");
  const worklistPath = arg("worklist") ?? DEFAULT_WORKLIST;
  const registry = loadRegistry();
  const s3 = s3Client();
  const runs = await loadRuns(s3, RUN_STAMP);
  const allCfgs = loadWorklistCfgs(worklistPath);
  const cfgs = only ? allCfgs.filter((m) => m.slug === only) : allCfgs;
  const cities: Record<string, unknown>[] = [];
  for (const cfg of cfgs) {
    const entry = await processMuni(s3, runs, registry, cfg, commit);
    process.stderr.write(`[${commit ? "commit" : "dry-run"}] ${cfg.slug}: ${String(entry.statut)} — ${String(entry.raison ?? "")}\n`);
    cities.push(entry);
  }
  const deposited = cities.filter((c) => c.statut === "DEPOSITED").length;
  const record = {
    contract: "zones-vnatif-deposit-record-altus/v1",
    date: "2026-08-10",
    spec: "SPEC_ZONE_DEPOSIT_REPLACE_POLICY.md + SPEC_ZONE_GEOMETRY_GRAIN.md + SPEC_ACQUISITION_METHODES_PAR_SOURCE.md §12 ; réplique dépôt géoCentralis lot-D f6f44d95",
    decision: "CLEAN-UPGRADE batch altus (legacy-traceable/candidate→documented v2), source ArcGIS MapServer f=geojson, champ code-zone résolu par recouvrement ≥90% avec le servi, zone_code brut",
    mode: commit ? "commit" : "dry-run",
    run_stamp: RUN_STAMP,
    worklist: worklistPath,
    proof_intended: { type: "arcgis", method: "natif", reliability: "directe", schema_version: "2.0" },
    gate: "depositCapturedZones identity gate PROVENANCE-AWARE (discriminateur = preuve v2 par-feature) + geometry_grain + anti-troncature ArcGIS (returnCountOnly==features & !exceededTransferLimit)",
    summary: { total: cities.length, deposited, skipped: cities.filter((c) => String(c.statut).startsWith("SKIP")).length, other: cities.filter((c) => c.statut !== "DEPOSITED" && !String(c.statut).startsWith("SKIP")).length },
    cities,
  };
  if (out) { writeFileSync(resolve(ROOT, out), `${JSON.stringify(record, null, 1)}\n`, "utf8"); process.stderr.write(`RECORD → ${out}\n`); }
  else process.stdout.write(`${JSON.stringify(record, null, 1)}\n`);
}

main().catch((e) => { process.stderr.write(`${(e as Error).stack ?? String(e)}\n`); process.exit(1); });
