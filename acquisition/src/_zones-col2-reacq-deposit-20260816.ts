/**
 * _zones-col2-reacq-deposit-20260816.ts — DÉPÔT v2 (RE-ACQUISITION col-2) des zones
 * NATIVES de beaupre + mille-isles depuis leurs FeatureServer AGOL, sur les DEUX layouts
 * (flat + nested), avec backup _replaced/ et re-stamp documented dans la même passe.
 *
 * Triage source : work/coverage/zones-col2-source-triage-20260816.json (commit 2c741540).
 *   - beaupre     : AGOL services6.arcgis.com/osUKB2jztkflrQhx Zonage/FeatureServer/17,
 *                   champ code-zone `ZONE_` (string), 78 features (1 ZONE_ vide → zone_code
 *                   = "UNKNOWN", JAMAIS N-A), SR native MTM7 (wkt présent) → f=geojson&outSR=4326
 *                   reprojette côté serveur. DÉFAUT : geo-api sert le NESTED, qui est une couche
 *                   MRC-affectation MAL-DÉPOSÉE (20 polys, zone_code=null). La ré-acquisition
 *                   ÉCRASE ce nested par le vrai zonage. Ce nested porte 49 clés de la MAUVAISE
 *                   couche (Affectatio/Vocation/PU_poly/OBJECTID…) sans recouvrement de codes →
 *                   pas de carry → assertNoServedPropertyKeysLost bloquerait un overwrite direct.
 *                   Ces clés N'appartiennent PAS au zonage ; on BACKUP le nested complet sous
 *                   _replaced/ (audit), on le SUPPRIME, on dépose le vrai zonage sur le FLAT
 *                   (chemin depositCapturedZones), puis on (re)crée le nested = contenu final du
 *                   flat via putServedZoneGeojson (création fraîche, gate key-loss inapplicable).
 *   - mille-isles : AGOL services9.arcgis.com/iZcAwIV2GibwcZLe Zonage/FeatureServer/0,
 *                   champ `zone` (string), filtre co_mun=76030 (co_mun=Integer → sans quotes),
 *                   66 features (== servi), SR native 3857. DÉFAUT : géométrie servie décalée
 *                   ~1705 m (erreur de reproject 3857→4326 à la désagrégation d'origine). FIX =
 *                   re-capture outSR=4326 (reproject serveur correct). Les DEUX layouts portent
 *                   des codes qui recouvrent la source → carry OK → depositCapturedZones gère
 *                   nativement flat+nested. On NE DÉCALE JAMAIS la géométrie servie (fabrication).
 *
 * COVERAGE-GATE OVERRIDE (beaupre) : le garde anti-perte « ≥1 zone-code vide → SKIP » de la
 * recette AGOL est LEVÉ par décision du conducteur (le servi est FAUX/non-couvrant ; le
 * remplacer EST la correction). Le feature ZONE_ vide → zone_code="UNKNOWN". G1-G6 : tout code
 * droppé → UNKNOWN, jamais N-A. Géométrie octet-exacte (sha256 CAS). Isolation par-muni.
 *
 * `--dry-run` (défaut) : résout + G2 byte-exact + grain + count + overlap SANS déposer.
 * `--commit`           : dépose réellement (2 layouts, backup, re-stamp, readback).
 * `--only <slug>`      : restreint à un muni.
 * `--out f.json`       : écrit le record machine.
 *
 * USAGE :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_zones-col2-reacq-deposit-20260816.ts [--commit] [--only <slug>] \
 *     --out work/coverage/zones-col2-reacq-deposit-record-20260816.json
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CaptureRunHeaderSchema,
  captureRunKeys,
  parseManifestJsonl,
  redactUrlForManifest,
  type CaptureManifestLine,
} from "../../packages/qc-sources/src/capture/index.js";
import { copyObject, deleteObject, exists, getBytes, listObjectEntries, s3Client } from "./lib/s3.js";
import { captureReceiptFromManifest } from "./lib/zone-provenance-quality.js";
import { verifyRawCapturePayload } from "./lib/zone-provenance-raw-capture.js";
import { proofFromCaptureEntry, putServedZoneGeojson, type GeometryGrain, type ServedZoneGeoJson } from "./lib/zonage-proof.js";
import { depositCapturedZones } from "./zones-obscura-run.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const LANE = "zones";
const S3_PREFIX = "normalized/ca-qc-zonage/";
const UEV_MARKER_FIELDS = ["ID_UEV", "MATRICULE8", "CODE_UTILI"] as const;
const ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const RUN_STAMP = "20260816T120000Z";
const GRAIN: GeometryGrain = "zone-polygon";
const DEFAULT_WORKLIST = "work/coverage/zones-col2-reacq-capture-worklist-20260816.json";

interface MuniCfg {
  slug: string;
  url: string;
  codeField: string;
  nestedIsMisdeposit: boolean;
  nestedMisdepositReason: string;
}
// Champ code-zone AUTORITAIRE par muni (triage 2c741540) ; jamais résolu par recouvrement.
const CODE_FIELD_BY_SLUG: Record<string, string> = { beaupre: "ZONE_", "mille-isles": "zone" };
// Le nested de beaupre est une couche MRC-affectation mal-déposée (à écraser) ; celui de
// mille-isles est le vrai zonage (juste décalé) → remplacement in-place standard.
const NESTED_MISDEPOSIT: Record<string, string | null> = {
  beaupre: "nested = couche MRC-affectation (20 polys, zone_code=null, 49 clés wrong-layer) sans recouvrement de codes → backup _replaced/ + suppression + (re)création depuis le flat",
  "mille-isles": null,
};

function requireS3(): void {
  const opts = process.env["NODE_OPTIONS"] ?? "";
  if (!opts.split(/\s+/).includes("--dns-result-order=ipv4first")) throw new Error("S3 refusé: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  if (process.env["AWS_MAX_ATTEMPTS"] !== "10") throw new Error("S3 refusé: préfixer AWS_MAX_ATTEMPTS=10");
}
function arg(name: string): string | undefined { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; }
function has(name: string): boolean { return process.argv.includes(`--${name}`); }
function canon(value: unknown): string { return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function shaBare(s: string | null | undefined): string | null { return typeof s === "string" ? s.replace(/^sha256:/, "") : null; }
function sha256Hex(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
function backupStamp(): string { return new Date().toISOString().replace(/[:.]/g, "").slice(0, 15) + "Z"; }

// Comptage LIVE : conserve LE MÊME filtre `where` que l'URL geojson capturée.
function countUrlFor(geojsonUrl: string): string {
  const [prefix, qs] = geojsonUrl.split("/query?");
  const where = new URLSearchParams(qs ?? "").get("where") ?? "1=1";
  return new URL(`${prefix}/query?where=${encodeURIComponent(where)}&returnCountOnly=true&f=json`).toString();
}

function loadWorklistCfgs(worklistPath: string): MuniCfg[] {
  const raw = JSON.parse(readFileSync(resolve(ROOT, worklistPath), "utf8")) as Array<{ slug: string; source: string; urls: string[] }>;
  return raw.map((t) => ({
    slug: t.slug,
    url: t.urls[0]!,
    codeField: CODE_FIELD_BY_SLUG[t.slug] ?? "",
    nestedIsMisdeposit: NESTED_MISDEPOSIT[t.slug] != null,
    nestedMisdepositReason: NESTED_MISDEPOSIT[t.slug] ?? "",
  }));
}

interface Feat { geometry?: { coordinates?: unknown } | null; properties?: Record<string, unknown> | null }

/** Normalise au schéma de serving. Une valeur code-zone VIDE → "UNKNOWN" (jamais N-A,
 *  jamais null) : la géométrie est réelle, seul le code est inconnu (anti-perte, non
 *  invention). Diffère du `normalize` partagé (qui pose null) par ce seul mapping. */
function normalizeWithUnknown(features: Feat[], zoneField: string, serviceUrl: string): Feat[] {
  return features.map((f) => {
    const raw = f.properties?.[zoneField];
    const s = raw === null || raw === undefined ? "" : String(raw).trim();
    const zone = s === "" ? "UNKNOWN" : s;
    return { type: "Feature", geometry: f.geometry, properties: { zone_code: zone, kind: null, affectation: null, num_zone: null, source: serviceUrl, confidence: "obscura-zone-vector" } } as Feat;
  });
}

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
function resolveCodeFieldName(feats: Feat[], want: string): string | null {
  const keys = new Set<string>();
  for (const f of feats) for (const k of Object.keys(f.properties ?? {})) keys.add(k);
  if (keys.has(want)) return want;
  return [...keys].find((k) => k.toUpperCase() === want.toUpperCase()) ?? null;
}

// ── Registre municipal (anti-homonyme + base offset) ───────────────────────────
const MUNIS_PATH = resolve(ROOT, "packages/qc-sources/src/geo/municipalities.qc.json");
interface MuniEntry { slug: string; lat: number; lon: number }
function loadRegistry(): MuniEntry[] {
  const raw = JSON.parse(readFileSync(MUNIS_PATH, "utf8")) as unknown;
  const arr = (Array.isArray(raw) ? raw : Object.values(raw as Record<string, unknown>).find(Array.isArray)) as Array<Record<string, unknown>>;
  return arr.map((m) => ({ slug: String(m["slug"] ?? ""), lat: Number(m["lat"] ?? m["latitude"]), lon: Number(m["lon"] ?? m["lng"] ?? m["longitude"]) }))
    .filter((m) => m.slug && Number.isFinite(m.lat) && Number.isFinite(m.lon));
}
function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000, dLat = ((lat2 - lat1) * Math.PI) / 180, dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function* positions(coords: unknown): Generator<[number, number]> {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === "number" && typeof coords[1] === "number") { yield [coords[0], coords[1]]; return; }
  for (const c of coords) yield* positions(c);
}
function bboxCentroid(feats: Feat[]): { cx: number | null; cy: number | null; bbox: number[] | null } {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const f of feats) for (const [x, y] of positions((f.geometry as { coordinates?: unknown } | null)?.coordinates)) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
  }
  if (![minx, miny, maxx, maxy].every(Number.isFinite)) return { cx: null, cy: null, bbox: null };
  return { cx: (minx + maxx) / 2, cy: (miny + maxy) / 2, bbox: [minx, miny, maxx, maxy] };
}
function nearestMuni(feats: Feat[], registry: MuniEntry[]): { slug: string | null; km: number | null } {
  const { cx, cy } = bboxCentroid(feats);
  if (cx === null || cy === null) return { slug: null, km: null };
  let best: { slug: string; km: number } | null = null;
  for (const m of registry) { const km = haversineM(m.lat, m.lon, cy, cx) / 1000; if (best === null || km < best.km) best = { slug: m.slug, km }; }
  return { slug: best?.slug ?? null, km: best ? Math.round(best.km * 100) / 100 : null };
}

// ── Capture line resolution ──────────────────────────────────────────────────────
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
  const candidates = new Set<string>([url, redactUrlForManifest(url).url]);
  try { candidates.add(new URL(url).toString()); } catch { /* ignore */ }
  for (const r of runs) {
    if (!r.ok) continue;
    const direct = r.lines.filter((l) => candidates.has(l.url));
    const matches = direct.length > 0 ? direct : r.lines.filter((l) => l.final_url !== null && candidates.has(l.final_url));
    if (matches.length === 1) return { run_id: r.run_id, line: matches[0]! };
    if (matches.length > 1) throw new Error(`run ${r.run_id}: ${matches.length} lignes matchent ${url}`);
  }
  return null;
}

// ── Source count (LIVE) ────────────────────────────────────────────────────────
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
function keyFor(slug: string): { flat: string; nested: string } {
  return { flat: `${S3_PREFIX}qc-zonage-${slug}.geojson`, nested: `${S3_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson` };
}
interface ServedState { keys: string[]; layout: string; features: number; codes: Set<string>; levels: string[]; urls: (string | null)[]; hasRealV2ProofBlock: boolean; hasCollectionV2: boolean; nestedCentroid: { cx: number | null; cy: number | null } }
async function readServed(s3: ReturnType<typeof s3Client>, slug: string): Promise<ServedState> {
  const { flat, nested } = keyFor(slug);
  const keys: string[] = [];
  if (await exists(s3, flat)) keys.push(flat);
  if (await exists(s3, nested)) keys.push(nested);
  const codes = new Set<string>(); const levels = new Set<string>(); const urls = new Set<string | null>();
  let features = 0, hasRealV2ProofBlock = false, hasCollectionV2 = false;
  let nestedCentroid: { cx: number | null; cy: number | null } = { cx: null, cy: null };
  for (const k of keys) {
    const fc = JSON.parse((await getBytes(s3, k)).toString("utf8")) as { proof?: { schema_version?: unknown }; features?: Feat[] };
    if (fc.proof?.schema_version === "2.0") hasCollectionV2 = true;
    const feats = Array.isArray(fc.features) ? fc.features : [];
    features = Math.max(features, feats.length);
    if (k === nested) { const c = bboxCentroid(feats); nestedCentroid = { cx: c.cx, cy: c.cy }; }
    for (const f of feats) {
      const p = f.properties ?? {};
      const c = canon(p["zone_code"]); if (c) codes.add(c);
      levels.add(typeof p["zone_source_level"] === "string" ? p["zone_source_level"] : "(none)");
      urls.add(typeof p["zone_source_url"] === "string" ? p["zone_source_url"] : null);
      if (featureHasRealV2Proof(f)) hasRealV2ProofBlock = true;
    }
  }
  const layout = keys.length === 2 ? "both" : keys.includes(flat) ? "flat" : keys.includes(nested) ? "nested" : "none";
  return { keys, layout, features, codes, levels: [...levels].sort(), urls: [...urls], hasRealV2ProofBlock, hasCollectionV2, nestedCentroid };
}
function proofShas(fc: unknown): Set<string> {
  const out = new Set<string>();
  const rec = fc as { proof?: { geometry_source?: { sha256?: string } }; features?: Array<{ properties?: { proof?: { geometry_source?: { sha256?: string } } } | null }> };
  const cs = shaBare(rec.proof?.geometry_source?.sha256); if (cs) out.add(cs);
  for (const f of rec.features ?? []) { const s = shaBare(f.properties?.proof?.geometry_source?.sha256); if (s) out.add(s); }
  return out;
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
    slug: cfg.slug, run_stamp: RUN_STAMP, source_url: url, count_url: countUrlFor(url),
    code_field: cfg.codeField, expected_geometry_grain: GRAIN,
    nested_is_misdeposit: cfg.nestedIsMisdeposit, nested_misdeposit_reason: cfg.nestedMisdepositReason || null,
    deposit_mode: "RE-ACQUISITION v2 (servi UNPROUVÉ ; 2 layouts ; empty→UNKNOWN ; overlap RAPPORTÉ non opposé)",
  };
  try {
    if (!cfg.codeField) { entry.statut = "SKIP"; entry.raison = `champ code-zone inconnu pour ${cfg.slug}`; return entry; }
    const found = findLine(runs, url);
    if (!found) { entry.statut = "SKIP"; entry.raison = "capture introuvable (aucune ligne url|final_url dans les shards du run-stamp)"; return entry; }
    const { run_id, line } = found;
    entry.capture_run_id = run_id; entry.http_status = line.http_status; entry.sha256 = line.sha256; entry.retrieved_at = line.retrieved_at; entry.storage_key = line.storage_key;
    if (line.redacted || line.http_status === null || line.http_status < 200 || line.http_status >= 300 || line.storage_key === null || line.sha256 === null) {
      entry.statut = "SKIP"; entry.raison = `capture non déposable: status=${String(line.http_status)} sha=${String(line.sha256)}`; return entry;
    }
    // G2 byte-exact (rehash CAS == manifeste == clé CAS + verifyRawCapturePayload)
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
    if (gj && typeof gj === "object" && "error" in gj && gj.error) { entry.statut = "SKIP"; entry.raison = `capture = objet d'erreur ArcGIS (${JSON.stringify(gj.error).slice(0, 120)})`; entry.arcgis_error = gj.error; return entry; }
    const feats = Array.isArray(gj.features) ? gj.features : [];
    const isFC = gj.type === "FeatureCollection";
    const exceeded = gj.exceededTransferLimit === true;
    entry.is_featurecollection = isFC; entry.feature_count = feats.length; entry.exceeded_transfer_limit = exceeded;
    const geomTypes = new Set<string>();
    for (const f of feats) { const gt = (f.geometry as { type?: string } | null)?.type; if (typeof gt === "string") geomTypes.add(gt); }
    entry.geometry_types = [...geomTypes].sort();
    const allPolygonal = geomTypes.size > 0 && [...geomTypes].every((x) => /Polygon/i.test(x));
    entry.all_polygonal = allPolygonal;
    const near = nearestMuni(feats, registry);
    entry.nearest_registre_muni = near.slug; entry.registry_attribution_km = near.km;
    const nearestOk = near.slug === cfg.slug; entry.nearest_matches_slug = nearestOk;
    const cap = bboxCentroid(feats); entry.capture_bbox = cap.bbox; entry.capture_centroid = cap.cx === null ? null : [cap.cx, cap.cy];
    // grain (marqueur UEV → evaluation-unit ; sinon zone-polygon)
    const propKeys = new Set<string>();
    for (const f of feats) for (const k of Object.keys(f.properties ?? {})) propKeys.add(k);
    const upper = new Map([...propKeys].map((k) => [k.toUpperCase(), k]));
    const uevPresent = UEV_MARKER_FIELDS.filter((m) => upper.has(m)).map((m) => upper.get(m)!);
    const grain: GeometryGrain = uevPresent.length > 0 ? "evaluation-unit" : "zone-polygon";
    entry.uev_fields_present = uevPresent; entry.geometry_grain_classified = grain;
    const grainOk = grain === GRAIN; entry.grain_matches_expected = grainOk;
    // Champ code-zone AUTORITAIRE + valeurs brutes ; vide → UNKNOWN (jamais N-A)
    const codeField = resolveCodeFieldName(feats, cfg.codeField);
    entry.code_field_resolved = codeField;
    const capCodes = new Set<string>(); let emptyCode = 0; const sample: Record<string, unknown>[] = [];
    if (codeField) {
      for (const f of feats) {
        const raw = f.properties?.[codeField];
        const s = raw === null || raw === undefined ? "" : String(raw).trim();
        if (!s) emptyCode++; else capCodes.add(canon(s));
        if (sample.length < 8) sample.push({ code_field_value: raw, zone_code: s || "UNKNOWN" });
      }
    }
    entry.zone_code_empty_count = emptyCode; entry.empty_mapped_to = "UNKNOWN";
    entry.capture_distinct_codes = capCodes.size + (emptyCode > 0 ? 1 : 0); entry.sample_codes = sample;
    // Served before
    const served = await readServed(s3, cfg.slug);
    entry.served_keys = served.keys; entry.served_layout = served.layout; entry.served_features = served.features;
    entry.served_distinct_codes = served.codes.size; entry.served_levels = served.levels; entry.served_source_urls = served.urls;
    entry.served_has_real_v2_proof_block = served.hasRealV2ProofBlock; entry.served_has_collection_v2 = served.hasCollectionV2;
    entry.served_nested_centroid = served.nestedCentroid.cx === null ? null : [served.nestedCentroid.cx, served.nestedCentroid.cy];
    // overlap servi → capture (RAPPORTÉ, non opposé : cible UNPROUVÉE = ré-acquisition)
    const uncovered = codeField ? [...served.codes].filter((c) => !capCodes.has(c) && c !== "UNKNOWN").sort() : [...served.codes].sort();
    const covered = served.codes.size - uncovered.length;
    entry.served_codes_covered = covered; entry.served_codes_uncovered = uncovered.length; entry.uncovered_codes = uncovered;
    entry.overlap_ratio_pct = served.codes.size > 0 ? Math.round((covered / served.codes.size) * 1000) / 10 : null;
    // mille-isles : décalage entre l'ancien nested (offset) et la nouvelle capture (reproject correct)
    if (served.nestedCentroid.cx !== null && cap.cx !== null) {
      const shiftM = Math.round(haversineM(served.nestedCentroid.cy!, served.nestedCentroid.cx, cap.cy!, cap.cx));
      entry.old_nested_vs_new_capture_centroid_shift_m = shiftM;
    }
    // Anti-troncature ArcGIS : count LIVE (MÊME where) == features ET !exceededTransferLimit
    const live = await liveCount(url);
    entry.live_count = live.count; entry.live_count_error = live.error;
    const countComplete = !exceeded && live.count !== null && feats.length === live.count;
    entry.count_complete = countComplete;
    entry.count_complete_basis = `!exceededTransferLimit(${!exceeded}) && live count(${String(live.count)}) == features(${feats.length})`;

    // ── Gardes (le garde "empty→SKIP" est LEVÉ par override conducteur ; empty→UNKNOWN) ──
    const guards: string[] = [];
    if (served.keys.length === 0) guards.push("aucun servi (rien à ré-acquérir)");
    if (!isFC || feats.length === 0) guards.push("capture vide/non-FC");
    if (!allPolygonal) guards.push("géométrie non 100% polygonale");
    if (!nearestOk) guards.push(`anti-homonyme: nearest=${String(near.slug)} != ${cfg.slug}`);
    if (!grainOk) guards.push(`grain classifié ${grain} != attendu ${GRAIN}`);
    if (!codeField) guards.push(`champ code-zone ${cfg.codeField} absent des features`);
    if (!countComplete) guards.push(`G2 fetch partiel/tronqué: ${String(entry.count_complete_basis)}`);
    if (served.hasRealV2ProofBlock || served.hasCollectionV2) guards.push(`servi porte DÉJÀ une preuve v2 (collection=${served.hasCollectionV2}, feature_block=${served.hasRealV2ProofBlock}) → NE PAS écraser sans preuve d'absence`);
    entry.guard_blocks = guards;

    if (guards.length > 0) { entry.statut = "SKIP"; entry.raison = guards.join(" ; "); return entry; }
    if (!commit) {
      entry.statut = "DRY-RUN-OK";
      entry.raison = `gardes OK — prêt au dépôt v2 (champ=${codeField}, ${capCodes.size} codes + ${emptyCode > 0 ? "1 UNKNOWN" : "0 UNKNOWN"}, overlap servi ${String(entry.overlap_ratio_pct)}%, grain=${grain}, nested_misdeposit=${cfg.nestedIsMisdeposit}) (relancer avec --commit)`;
      return entry;
    }

    // ── Dépôt ──
    const norm = normalizeWithUnknown(feats, codeField!, url);
    const proof = proofFromCaptureEntry(line, { type: "agol", method: "natif", reliability: "directe" });
    const { flat, nested } = keyFor(cfg.slug);
    const manualBackups: string[] = [];

    if (cfg.nestedIsMisdeposit && (await exists(s3, nested))) {
      // Le nested est une couche wrong-layer : BACKUP complet (_replaced/) + SUPPRESSION,
      // pour que depositCapturedZones ne dépose que le flat (pas de gate key-loss sur des
      // clés qui n'appartiennent pas au zonage), puis on (re)crée le nested = flat final.
      const nb = `${S3_PREFIX}_replaced/qc-zonage-${cfg.slug}__nested-misdeposit.${backupStamp()}.geojson`;
      await copyObject(s3, nested, nb);
      manualBackups.push(nb);
      await deleteObject(s3, nested);
      process.stderr.write(`[reacq] ${cfg.slug}: nested wrong-layer BACKUP -> s3://${nb} puis SUPPRIMÉ (recréé depuis le flat après dépôt)\n`);
    }

    const res = await depositCapturedZones(s3, cfg.slug, norm as never[], proof, { geometryGrain: GRAIN });
    entry.deposited = true;
    entry.dropped_divergence = res.droppedDivergence;
    const droppedCodes = res.droppedDivergence.map((d) => d.code).sort();
    entry.dropped_codes = droppedCodes; entry.dropped_count = droppedCodes.length;

    if (cfg.nestedIsMisdeposit) {
      // (Re)crée le nested = contenu FINAL du flat (vrai zonage v2 documented + grain),
      // via le chemin sanctionné putServedZoneGeojson (création fraîche : gate key-loss NA).
      const flatFc = JSON.parse((await getBytes(s3, flat)).toString("utf8")) as ServedZoneGeoJson;
      await putServedZoneGeojson(s3, nested, flatFc);
      process.stderr.write(`[reacq] ${cfg.slug}: nested (re)créé depuis le flat -> ${nested}\n`);
    }
    entry.replaced_backups = [...res.replacedBackups, ...manualBackups];

    // ── Readback (les DEUX layouts) ──
    const capDigest = geometryDigest(feats);
    const readbacks: Record<string, unknown>[] = [];
    let allOk = true;
    for (const key of [flat, nested]) {
      if (!(await exists(s3, key))) { allOk = false; readbacks.push({ key, present: false }); continue; }
      const fc = JSON.parse((await getBytes(s3, key)).toString("utf8")) as { features?: Feat[]; proof?: { geometry_source?: { url?: string; retrieved_at?: string; sha256?: string } } };
      const sfeats = Array.isArray(fc.features) ? fc.features : [];
      const levels = new Set<string>(); const urls = new Set<string | null>(); const grains = new Set<unknown>();
      let hasZoneCode = true; const codes = new Set<string>();
      for (const f of sfeats) {
        const p = f.properties ?? {};
        levels.add(typeof p["zone_source_level"] === "string" ? (p["zone_source_level"] as string) : "(none)");
        urls.add(typeof p["zone_source_url"] === "string" ? (p["zone_source_url"] as string) : null);
        grains.add(p["geometry_grain"]);
        const zc = p["zone_code"];
        if (!(typeof zc === "string" && zc)) hasZoneCode = false; else codes.add(zc);
      }
      const cen = bboxCentroid(sfeats);
      const rb = {
        key, present: true, served_features: sfeats.length,
        feature_count_matches_capture: sfeats.length === feats.length,
        geometry_digest_byte_exact: geometryDigest(sfeats) === capDigest,
        zone_code_present_all: hasZoneCode, distinct_zone_codes: codes.size,
        proof_url: fc.proof?.geometry_source?.url ?? null,
        proof_url_matches: fc.proof?.geometry_source?.url === proof.url,
        proof_sha256: fc.proof?.geometry_source?.sha256 ?? null,
        proof_sha256_first12: shaBare(fc.proof?.geometry_source?.sha256)?.slice(0, 12) ?? null,
        proof_sha_matches_capture: shaBare(fc.proof?.geometry_source?.sha256) === shaBare(line.sha256),
        proof_retrieved_at: fc.proof?.geometry_source?.retrieved_at ?? null,
        carries_capture_sha256: [...proofShas(fc)].includes(shaBare(line.sha256)!),
        zone_source_levels: [...levels].sort(),
        level_documented: levels.size === 1 && levels.has("documented"),
        url_all_proof: [...urls].every((u) => u === proof.url),
        geometry_grain: [...grains], grain_uniform_expected: grains.size === 1 && grains.has(GRAIN),
        centroid: cen.cx === null ? null : [cen.cx, cen.cy],
      };
      readbacks.push(rb);
      const ok = rb.feature_count_matches_capture && rb.geometry_digest_byte_exact && rb.zone_code_present_all && rb.proof_url_matches
        && rb.proof_sha_matches_capture && !!rb.proof_retrieved_at && rb.carries_capture_sha256
        && rb.level_documented && rb.url_all_proof && rb.grain_uniform_expected;
      if (!ok) allOk = false;
    }
    const bothLayouts = (await exists(s3, flat)) && (await exists(s3, nested));
    entry.both_layouts_present = bothLayouts;
    const replacedListed = (await listObjectEntries(s3, `${S3_PREFIX}_replaced/qc-zonage-${cfg.slug}__`)).map((e) => e.key);
    entry.replaced_backups_listed = replacedListed; entry.readback = readbacks;
    entry.readback_ok = allOk && bothLayouts && replacedListed.length > 0;
    entry.v2_proof_sha256_first12 = shaBare(line.sha256)?.slice(0, 12) ?? null;
    entry.statut = entry.readback_ok ? "DEPOSITED" : "DEPOSITED_READBACK_FAIL";
    entry.raison = entry.readback_ok
      ? `RE-ACQUISITION v2 byte-exact (agol/natif/directe) ; zone_code=${codeField} brut, empty→UNKNOWN(${emptyCode}) ; grain=${grain} ; 2 layouts ; overlap servi ${String(entry.overlap_ratio_pct)}% ; ${droppedCodes.length} code servi-seulement→UNKNOWN ; backup _replaced/ présent`
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
    contract: "zones-col2-reacq-deposit-record/v1",
    date: "2026-08-16",
    spec: "SPEC_ZONE_DEPOSIT_REPLACE_POLICY.md + SPEC_ZONE_GEOMETRY_GRAIN.md + SPEC_CAPTURE_ON_CLUSTER.md ; réplique la recette dépôt vnatif agglo-longueuil 0dcb13a0 / agol 5cc7e680 (variante RE-ACQUISITION col-2 : 2 layouts, empty→UNKNOWN override, fix nested-affectation-misdeposit beaupre / reproject 3857→4326 mille-isles)",
    decision: "RE-ACQUISITION v2 beaupre (Zonage/FeatureServer/17, ZONE_) + mille-isles (Zonage/FeatureServer/0, zone, co_mun=76030) depuis leurs FeatureServer AGOL, f=geojson outSR=4326, grain zone-polygon, preuve agol/natif/directe, dépôt sur les 2 layouts + backup _replaced/ + re-stamp documented",
    triage: "work/coverage/zones-col2-source-triage-20260816.json (2c741540)",
    coverage_gate_override: "beaupre: garde AGOL «≥1 zone-code vide → SKIP» LEVÉ par décision conducteur (le servi nested est FAUX/non-couvrant ; le remplacer EST la correction). 1 ZONE_ vide → zone_code=UNKNOWN (jamais N-A).",
    mode: commit ? "commit" : "dry-run",
    run_stamp: RUN_STAMP,
    worklist: worklistPath,
    proof_intended: { type: "agol", method: "natif", reliability: "directe", schema_version: "2.0" },
    gate: "depositCapturedZones identity gate PROVENANCE-AWARE + coverage-count gate + geometry_grain + anti-troncature ArcGIS (returnCountOnly[MÊME where]==features & !exceededTransferLimit) + anti-homonyme nearest==slug ; overlap RAPPORTÉ non opposé (cible UNPROUVÉE)",
    summary: { total: cities.length, deposited, skipped: cities.filter((c) => String(c.statut).startsWith("SKIP")).length, other: cities.filter((c) => c.statut !== "DEPOSITED" && !String(c.statut).startsWith("SKIP")).length },
    cities,
  };
  if (out) { writeFileSync(resolve(ROOT, out), `${JSON.stringify(record, null, 1)}\n`, "utf8"); process.stderr.write(`RECORD → ${out}\n`); }
  else process.stdout.write(`${JSON.stringify(record, null, 1)}\n`);
}

main().catch((e) => { process.stderr.write(`${(e as Error).stack ?? String(e)}\n`); process.exit(1); });
