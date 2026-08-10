/**
 * _zones-vnatif-deposit-replace-20260810.ts — DÉPÔT v2 par REMPLACEMENT de 5 servis
 * NON-PROUVÉS (`zone_source_url=null`) par leur capture vecteur natif vérifiée-complète,
 * à travers l'identity gate PROVENANCE-AWARE de `depositCapturedZones`.
 *
 * SPEC: SPEC_ZONE_DEPOSIT_REPLACE_POLICY.md (SHA 64f82eae). Un servi non-prouvé ne
 * bloque pas une capture v2 vérifiée-complète ; le remplacement est HONNÊTE (G1–G6) :
 *   G1  chaque code servi-seulement (uncovered) est porté par une feature url=null
 *       (sinon le gate provenance-aware BLOQUE — vérifié côté lib).
 *   G2  capture natif/directe, sha256 byte-exact (re-hash CAS == manifeste == clé CAS
 *       + verifyRawCapturePayload), count == énumération autoritaire de la source
 *       (returnCountOnly LIVE) ET exceededTransferLimit !== true. Un fetch partiel
 *       (count < source | exceededTransferLimit) ne qualifie PAS → SKIP.
 *   grain classification par NATURE de la couche source : marqueur UEV
 *       (ID_UEV/MATRICULE8/CODE_UTILI) ⇒ evaluation-unit ; sinon zone-polygon.
 *   G3  perte documentée : liste exacte des codes droppés (code + level antérieur +
 *       url=null + raison) + backup octet-pour-octet sous `_replaced/` (lib).
 *   G4  codes droppés = UNKNOWN (recalage-flagged), JAMAIS N-A.
 *   G5  servi après = octets EXACTS de la capture (geometry digest byte-exact),
 *       level→documented, url=proof.url ; aucun code legacy réinjecté.
 *   G6  overlap rapporté ; un outlier large est flaggé (possible mauvaise couche).
 *
 * `--dry-run` (défaut) : resolve + G2 + grain + overlap SANS déposer.
 * `--commit`           : dépose réellement (lecture+écriture S3).
 * `--slugs a,b`        : restreint la passe.
 * `--out f.json`       : écrit le record.
 *
 * USAGE :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_zones-vnatif-deposit-replace-20260810.ts \
 *     [--commit] [--slugs a,b] --out work/coverage/zones-vnatif-deposit-record-replace-20260810.json
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
import { proofFromCaptureEntry } from "./lib/zonage-proof.js";
import { type GeometryGrain } from "./lib/zonage-proof.js";
import { depositCapturedZones, normalize } from "./zones-obscura-run.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const LANE = "zones";
const S3_PREFIX = "normalized/ca-qc-zonage/";
const UEV_MARKER_FIELDS = ["ID_UEV", "MATRICULE8", "CODE_UTILI"] as const;

function requireS3(): void {
  const opts = process.env["NODE_OPTIONS"] ?? "";
  if (!opts.split(/\s+/).includes("--dns-result-order=ipv4first")) {
    throw new Error("S3 refusé: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  }
  if (process.env["AWS_MAX_ATTEMPTS"] !== "10") throw new Error("S3 refusé: préfixer AWS_MAX_ATTEMPTS=10");
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
}
function has(name: string): boolean { return process.argv.includes(`--${name}`); }

interface Target {
  slug: string;
  runStamp: string;
  zoneField: string;
  url: string;
  grain: GeometryGrain;
  /** Codes servi-seulement attendus (records lot2/lot3) — ASSERTÉS si présents. */
  expectedDropped?: string[];
}

// saint-lin-laurentides EN PREMIER (archi vérifie sa forme de divergence).
const TARGETS: Target[] = [
  {
    slug: "saint-lin-laurentides", runStamp: "20260810T121500Z", zoneField: "CodeZone",
    url: "https://services8.arcgis.com/PF86XLgxesdAEe8M/arcgis/rest/services/Zonage/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    grain: "zone-polygon", expectedDropped: ["C4", "H148", "H149", "H150", "H210", "P13"],
  },
  {
    slug: "saint-hippolyte", runStamp: "20260810T121500Z", zoneField: "REGLEMENT_",
    url: "https://arcgis.lbpevaluateurs.ca/arcgis/rest/services/75045_PUBLIC/MapServer/142/query?where=1%3D1&outFields=*&f=geojson",
    grain: "zone-polygon", expectedDropped: ["REC612"],
  },
  {
    slug: "saint-colomban", runStamp: "20260810T110000Z", zoneField: "COMBINE",
    url: "https://arcgis.lbpevaluateurs.ca/arcgis/rest/services/75005_PUBLIC/MapServer/140/query?where=1%3D1&outFields=*&f=geojson",
    grain: "zone-polygon", expectedDropped: ["C176", "C177", "C3093", "H1161", "P170", "P175"],
  },
  {
    slug: "sainte-sophie", runStamp: "20260810T110000Z", zoneField: "Numero",
    url: "https://arcgis.lbpevaluateurs.ca/arcgis/rest/services/75028_PUBLIC/MapServer/140/query?where=1%3D1&outFields=*&f=geojson",
    grain: "zone-polygon", expectedDropped: ["V80", "V804", "V805"],
  },
  {
    slug: "hampstead", runStamp: "20260810T124000Z", zoneField: "Zone",
    url: "https://services1.arcgis.com/IP2j0oTRjMlb9KsM/arcgis/rest/services/Zonage_Hampstead_S/FeatureServer/61/query?where=1%3D1&outFields=*&f=geojson",
    grain: "evaluation-unit",
  },
];

function canon(value: unknown): string {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
function shaBare(s: string | null | undefined): string | null {
  return typeof s === "string" ? s.replace(/^sha256:/, "") : null;
}
function sha256Hex(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }

interface Feat { geometry?: unknown; properties?: Record<string, unknown> | null }
/** Digest SHA-256 des géométries dans l'ordre — preuve indépendante du byte-exact. */
function geometryDigest(features: Feat[]): string {
  const h = createHash("sha256");
  for (const f of features) h.update(JSON.stringify(f.geometry ?? null));
  return `sha256:${h.digest("hex")}`;
}

// ── Registre municipal (anti-homonyme : nearest === slug) ──────────────────────
const MUNIS_PATH = resolve(ROOT, "packages/qc-sources/src/geo/municipalities.qc.json");
interface MuniEntry { slug: string; lat: number; lon: number }
function loadRegistry(): MuniEntry[] {
  const raw = JSON.parse(readFileSync(MUNIS_PATH, "utf8")) as unknown;
  const arr = (Array.isArray(raw) ? raw : Object.values(raw as Record<string, unknown>).find(Array.isArray)) as Array<Record<string, unknown>>;
  return arr.map((m) => ({
    slug: String(m["slug"] ?? ""),
    lat: Number(m["lat"] ?? m["latitude"]),
    lon: Number(m["lon"] ?? m["lng"] ?? m["longitude"]),
  })).filter((m) => m.slug && Number.isFinite(m.lat) && Number.isFinite(m.lon));
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

// ── Localisation de la ligne de capture (tous shards d'un run-stamp) ───────────
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

// ── Énumération autoritaire de la source (G2) — requête metadata LIVE ──────────
async function fetchJson(url: string, timeoutMs = 20_000): Promise<unknown> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { "User-Agent": "sentropic-geo-count-probe/1" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}
function layerBase(url: string): string { return url.replace(/\/query\?.*$/i, ""); }
function layerIdFromUrl(url: string): string | null { return /\/(\d+)\/query\?/i.exec(url)?.[1] ?? null; }

interface SourceEnum { source_count: number | null; layer_name: string | null; count_query: string; error: string | null }
async function sourceEnumeration(url: string): Promise<SourceEnum> {
  const base = layerBase(url);
  const countQuery = `${base}/query?where=1%3D1&returnCountOnly=true&f=json`;
  const out: SourceEnum = { source_count: null, layer_name: null, count_query: countQuery, error: null };
  try {
    const info = await fetchJson(`${base}?f=json`) as { name?: unknown };
    if (typeof info.name === "string") out.layer_name = info.name;
  } catch (e) { out.error = `layer-info: ${(e as Error).message}`; }
  try {
    const cnt = await fetchJson(countQuery) as { count?: unknown };
    if (typeof cnt.count === "number") out.source_count = cnt.count;
    else out.error = [out.error, "count: pas de champ count"].filter(Boolean).join("; ");
  } catch (e) { out.error = [out.error, `count: ${(e as Error).message}`].filter(Boolean).join("; "); }
  return out;
}

// ── Servi actuel (avant) ──────────────────────────────────────────────────────
interface ServedState { keys: string[]; layout: "flat" | "nested" | "both" | "none"; features: number; codes: Set<string>; levels: string[]; urls: (string | null)[]; hasV2Proof: boolean }
function keyFor(slug: string): { flat: string; nested: string } {
  return { flat: `${S3_PREFIX}qc-zonage-${slug}.geojson`, nested: `${S3_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson` };
}
async function readServed(s3: ReturnType<typeof s3Client>, slug: string): Promise<ServedState> {
  const { flat, nested } = keyFor(slug);
  const keys: string[] = [];
  if (await exists(s3, flat)) keys.push(flat);
  if (await exists(s3, nested)) keys.push(nested);
  const codes = new Set<string>();
  const levels = new Set<string>();
  const urls = new Set<string | null>();
  let features = 0;
  let hasV2Proof = false;
  for (const k of keys) {
    const fc = JSON.parse((await getBytes(s3, k)).toString("utf8")) as { proof?: { schema_version?: unknown }; features?: Array<{ properties?: Record<string, unknown> | null }> };
    if (fc.proof?.schema_version === "2.0") hasV2Proof = true;
    const feats = Array.isArray(fc.features) ? fc.features : [];
    features = Math.max(features, feats.length);
    for (const f of feats) {
      const p = f.properties ?? {};
      const c = canon(p["zone_code"]); if (c) codes.add(c);
      levels.add(typeof p["zone_source_level"] === "string" ? p["zone_source_level"] : "(none)");
      urls.add(typeof p["zone_source_url"] === "string" ? p["zone_source_url"] : null);
      const fp = (p as { proof?: { schema_version?: unknown } })["proof"];
      if (fp?.schema_version === "2.0") hasV2Proof = true;
    }
  }
  const layout: ServedState["layout"] = keys.length === 2 ? "both" : keys.includes(flat) ? "flat" : keys.includes(nested) ? "nested" : "none";
  return { keys, layout, features, codes, levels: [...levels].sort(), urls: [...urls], hasV2Proof };
}

// ── Readback indépendant (après dépôt) ────────────────────────────────────────
function proofShas(fc: unknown): Set<string> {
  const out = new Set<string>();
  const rec = fc as { proof?: { geometry_source?: { sha256?: string } }; features?: Array<{ properties?: { proof?: { geometry_source?: { sha256?: string } } } | null }> };
  const cs = shaBare(rec.proof?.geometry_source?.sha256); if (cs) out.add(cs);
  for (const f of rec.features ?? []) { const s = shaBare(f.properties?.proof?.geometry_source?.sha256); if (s) out.add(s); }
  return out;
}

async function main(): Promise<void> {
  requireS3();
  const commit = has("commit");
  const out = arg("out");
  const wantSlugs = arg("slugs") ? new Set(arg("slugs")!.split(",").map((s) => s.trim()).filter(Boolean)) : null;
  const targets = TARGETS.filter((t) => !wantSlugs || wantSlugs.has(t.slug));
  const registry = loadRegistry();
  const s3 = s3Client();

  // Charge les runs une fois par stamp.
  const stampRuns = new Map<string, RunData[]>();
  for (const stamp of new Set(targets.map((t) => t.runStamp))) stampRuns.set(stamp, await loadRuns(s3, stamp));

  const cities: Record<string, unknown>[] = [];
  for (const t of targets) {
    const entry: Record<string, unknown> = { slug: t.slug, run_stamp: t.runStamp, source_url: t.url, zone_field: t.zoneField, layer_id: layerIdFromUrl(t.url), expected_geometry_grain: t.grain };
    try {
      const runs = stampRuns.get(t.runStamp) ?? [];
      const found = findLine(runs, t.url);
      if (!found) { entry.statut = "SKIP"; entry.raison = "capture introuvable (aucune ligne url|final_url dans les shards du run-stamp)"; cities.push(entry); continue; }
      const { run_id, line } = found;
      entry.capture_run_id = run_id;
      entry.http_status = line.http_status;
      entry.sha256 = line.sha256;
      entry.retrieved_at = line.retrieved_at;
      if (line.redacted || line.http_status === null || line.http_status < 200 || line.http_status >= 300 || line.storage_key === null || line.sha256 === null) {
        entry.statut = "SKIP"; entry.raison = `capture non déposable: status=${String(line.http_status)} sha=${String(line.sha256)}`; cities.push(entry); continue;
      }
      // G2 — byte-exact : re-hash CAS == sha manifeste == clé CAS + verifyRawCapturePayload.
      const bytes = await getBytes(s3, line.storage_key);
      const rehash = `sha256:${sha256Hex(bytes)}`;
      const casInName = /\/cas\/([a-f0-9]{64})\./.exec(line.storage_key)?.[1] ?? null;
      const rehashOk = rehash === line.sha256;
      const casKeyOk = casInName !== null && `sha256:${casInName}` === line.sha256;
      entry.rehash_ok = rehashOk; entry.cas_key_matches = casKeyOk;
      const receipt = captureReceiptFromManifest(line, captureRunKeys(run_id).manifest, 0);
      let rawVerified = false, rawReason: string | null = "reçu invalide";
      if (receipt) {
        const sidecar = JSON.parse((await getBytes(s3, `${line.storage_key}.meta.json`)).toString("utf8")) as unknown;
        const v = verifyRawCapturePayload(receipt, bytes, sidecar);
        rawVerified = v.verified; rawReason = v.reason;
      }
      entry.raw_capture_verified = rawVerified; entry.raw_capture_reason = rawReason;
      if (!rehashOk || !casKeyOk || !rawVerified) {
        entry.statut = "SKIP"; entry.raison = `byte-exact NON prouvé (rehash=${rehashOk} casKey=${casKeyOk} raw=${rawVerified}:${rawReason})`; cities.push(entry); continue;
      }
      // Parse geojson.
      const gj = JSON.parse(bytes.toString("utf8")) as { type?: string; features?: Feat[]; exceededTransferLimit?: boolean };
      const feats = Array.isArray(gj.features) ? gj.features : [];
      const isFC = gj.type === "FeatureCollection";
      const exceeded = gj.exceededTransferLimit === true;
      entry.is_featurecollection = isFC;
      entry.feature_count = feats.length;
      entry.exceeded_transfer_limit = exceeded;
      const geomTypes = new Set<string>();
      for (const f of feats) { const gt = (f.geometry as { type?: string } | null)?.type; if (typeof gt === "string") geomTypes.add(gt); }
      entry.geometry_types = [...geomTypes].sort();
      const allPolygonal = geomTypes.size > 0 && [...geomTypes].every((x) => /Polygon/i.test(x));
      entry.all_polygonal = allPolygonal;
      const near = nearestMuni(feats, registry);
      entry.nearest_registre_muni = near.slug; entry.registry_attribution_km = near.km;
      const nearestOk = near.slug === t.slug;
      entry.nearest_matches_slug = nearestOk;
      // grain : classification par NATURE (marqueur UEV).
      const propKeys = new Set<string>();
      for (const f of feats) for (const k of Object.keys(f.properties ?? {})) propKeys.add(k);
      const upper = new Map([...propKeys].map((k) => [k.toUpperCase(), k]));
      const uevPresent = UEV_MARKER_FIELDS.filter((m) => upper.has(m)).map((m) => upper.get(m)!);
      const classified: GeometryGrain = uevPresent.length > 0 ? "evaluation-unit" : "zone-polygon";
      entry.uev_fields_present = uevPresent;
      entry.geometry_grain_classified = classified;
      const grainOk = classified === t.grain;
      entry.grain_matches_expected = grainOk;
      // capture codes.
      const capCodes = new Set<string>();
      for (const f of feats) { const c = canon(f.properties?.[t.zoneField]); if (c) capCodes.add(c); }
      entry.capture_distinct_codes = capCodes.size;
      // G2 — énumération source (LIVE).
      const src = await sourceEnumeration(t.url);
      entry.source_count = src.source_count;
      entry.source_layer_name = src.layer_name;
      entry.count_query = src.count_query;
      entry.source_enum_error = src.error;
      const countComplete = src.source_count === null ? !exceeded : (feats.length === src.source_count && !exceeded);
      entry.count_complete = countComplete;
      entry.count_complete_basis = src.source_count === null
        ? `source_count indisponible (${src.error}) → complétude par exceededTransferLimit=${exceeded}`
        : `feature_count(${feats.length}) == source_count(${src.source_count}) && exceededTransferLimit=${exceeded}`;
      // Servi avant.
      const served = await readServed(s3, t.slug);
      entry.served_keys = served.keys;
      entry.served_layout = served.layout;
      entry.served_features = served.features;
      entry.served_distinct_codes = served.codes.size;
      entry.served_levels = served.levels;
      entry.served_source_urls = served.urls;
      entry.served_has_v2_proof = served.hasV2Proof;
      const servedAllNull = served.urls.every((u) => u === null);
      entry.served_all_url_null = servedAllNull;
      const uncovered = [...served.codes].filter((c) => !capCodes.has(c)).sort();
      const covered = served.codes.size - uncovered.length;
      entry.served_codes_covered = covered;
      entry.served_codes_uncovered = uncovered.length;
      entry.uncovered_codes = uncovered;
      const overlap = served.codes.size > 0 ? Math.round((covered / served.codes.size) * 1000) / 10 : null;
      entry.overlap_ratio_pct = overlap;

      // ── Verdicts de garde (avant tout dépôt) ──
      const guards: string[] = [];
      if (served.keys.length === 0) guards.push("aucun servi (rien à remplacer)");
      if (!isFC || feats.length === 0) guards.push("capture vide/non-FC");
      if (!allPolygonal) guards.push("géométrie non 100% polygonale");
      if (!nearestOk) guards.push(`anti-homonyme: nearest=${String(near.slug)} != ${t.slug}`);
      if (!grainOk) guards.push(`grain classifié ${classified} != attendu ${t.grain}`);
      if (!countComplete) guards.push(`G2 fetch partiel: ${String(entry.count_complete_basis)}`);
      if (!servedAllNull) {
        // La politique ratifiée (SPEC §2/§6) ne couvre QUE le servi url=null. Un servi
        // à zone_source_url NON-null tombe sous §4 (superset strict maintenu). Cas
        // anormal observé (hampstead) : url non-null MAIS aucune preuve v2 (proof=null),
        // level=candidate — url déclarative sans capture, non anticipé par le spec §1.
        guards.push(
          `servi zone_source_url NON-null (v2_proof=${served.hasV2Proof}) → hors politique remplacement url=null (SPEC §2/§6); ${served.codes.size - covered === 0 ? "0 code droppé (aucune régression), mais " : ""}état à arbitrer par archi avant tout dépôt`,
        );
      }
      // G6 : outlier overlap large (possible mauvaise couche). Les cas connus sont
      // ≥95%. On flagge (revue) tout overlap < 90% ; le juge final reste l'identité
      // de couche (nearest + nom + count==source), pas un seuil inventé.
      const overlapOutlier = overlap !== null && overlap < 90;
      entry.g6_overlap_outlier = overlapOutlier;
      if (overlapOutlier) guards.push(`G6 overlap ${overlap}% < 90% (outlier — possible mauvaise couche, revue avant dépôt)`);
      entry.guard_blocks = guards;

      if (guards.length > 0) {
        entry.statut = "SKIP";
        entry.raison = guards.join(" ; ");
        cities.push(entry);
        continue;
      }

      if (!commit) {
        entry.statut = "DRY-RUN-OK";
        entry.raison = "toutes gardes OK — prêt au dépôt (relancer avec --commit)";
        cities.push(entry);
        continue;
      }

      // ── Dépôt réel via le gate PROVENANCE-AWARE + geometry_grain ──
      const norm = normalize(feats as never[], t.zoneField, t.url, "obscura-gonet-vector");
      const proof = proofFromCaptureEntry(line, { type: "arcgis", method: "natif", reliability: "directe" });
      const res = await depositCapturedZones(s3, t.slug, norm, proof, { geometryGrain: t.grain });
      entry.deposited = true;
      entry.replaced_backups = res.replacedBackups;
      // G3/G4 — divergence documentée (codes droppés = UNKNOWN, jamais N-A).
      entry.dropped_divergence = res.droppedDivergence;
      const droppedCodes = res.droppedDivergence.map((d) => d.code).sort();
      entry.dropped_codes = droppedCodes;
      if (t.expectedDropped) {
        const exp = t.expectedDropped.map(canon).sort();
        entry.expected_dropped_codes = exp;
        entry.dropped_matches_record = JSON.stringify(droppedCodes) === JSON.stringify(exp);
      }

      // ── Readback indépendant (G5) ──
      const capDigest = geometryDigest(feats);
      const { flat, nested } = keyFor(t.slug);
      const readbacks: Record<string, unknown>[] = [];
      let allOk = true;
      for (const key of [flat, nested]) {
        if (!(await exists(s3, key))) continue;
        const fc = JSON.parse((await getBytes(s3, key)).toString("utf8")) as { features?: Feat[]; proof?: { geometry_source?: { url?: string; retrieved_at?: string; sha256?: string } } };
        const sfeats = Array.isArray(fc.features) ? fc.features : [];
        const levels = new Set<string>(); const urls = new Set<string | null>(); const grains = new Set<unknown>();
        for (const f of sfeats) {
          const p = f.properties ?? {};
          levels.add(typeof p["zone_source_level"] === "string" ? (p["zone_source_level"] as string) : "(none)");
          urls.add(typeof p["zone_source_url"] === "string" ? (p["zone_source_url"] as string) : null);
          grains.add(p["geometry_grain"]);
        }
        const servedDigest = geometryDigest(sfeats);
        const carriesSha = [...proofShas(fc)].includes(shaBare(line.sha256)!);
        const rb = {
          key,
          served_features: sfeats.length,
          feature_count_matches_capture: sfeats.length === feats.length,
          geometry_digest_byte_exact: servedDigest === capDigest,
          proof_url: fc.proof?.geometry_source?.url ?? null,
          proof_url_matches: fc.proof?.geometry_source?.url === proof.url,
          proof_sha256: fc.proof?.geometry_source?.sha256 ?? null,
          proof_sha_matches_capture: shaBare(fc.proof?.geometry_source?.sha256) === shaBare(line.sha256),
          proof_retrieved_at: fc.proof?.geometry_source?.retrieved_at ?? null,
          carries_capture_sha256: carriesSha,
          zone_source_levels: [...levels].sort(),
          zone_source_urls: [...urls],
          level_documented: levels.size === 1 && levels.has("documented"),
          url_all_proof: [...urls].every((u) => u === proof.url),
          geometry_grain: [...grains],
          grain_uniform_expected: grains.size === 1 && grains.has(t.grain),
        };
        readbacks.push(rb);
        const ok = rb.feature_count_matches_capture && rb.geometry_digest_byte_exact && rb.proof_url_matches
          && rb.proof_sha_matches_capture && !!rb.proof_retrieved_at && rb.carries_capture_sha256
          && rb.level_documented && rb.url_all_proof && rb.grain_uniform_expected;
        if (!ok) allOk = false;
      }
      // Backup _replaced/ présent ?
      const replacedListed = (await listObjectEntries(s3, `${S3_PREFIX}_replaced/qc-zonage-${t.slug}__`)).map((e) => e.key);
      entry.replaced_backups_listed = replacedListed;
      entry.readback = readbacks;
      entry.readback_ok = allOk && replacedListed.length > 0;
      entry.statut = entry.readback_ok ? "DEPOSITED" : "DEPOSITED_READBACK_FAIL";
      entry.raison = entry.readback_ok
        ? "remplacé v2 byte-exact ; provenance documented/url=proof.url ; grain estampillé ; backup _replaced/ présent"
        : "DÉPÔT effectué mais readback incomplet — VÉRIFIER";
      cities.push(entry);
    } catch (e) {
      entry.statut = "ERROR"; entry.raison = (e as Error).message; entry.stack = (e as Error).stack;
      cities.push(entry);
      process.stderr.write(`  ERR ${t.slug}: ${(e as Error).message}\n`);
    }
    const c = cities[cities.length - 1]!;
    process.stderr.write(`[${commit ? "commit" : "dry-run"}] ${t.slug}: ${String(c.statut)} — ${String(c.raison ?? "")}\n`);
  }

  const record = {
    contract: "zones-vnatif-deposit-record-replace/v1",
    date: "2026-08-10",
    spec: "SPEC_ZONE_DEPOSIT_REPLACE_POLICY.md@64f82eae",
    mode: commit ? "commit" : "dry-run",
    gate: "depositCapturedZones identity gate PROVENANCE-AWARE (bloque uniquement si ≥1 code servi-seulement PROUVÉ zone_source_url live)",
    proof_intended: { type: "arcgis", method: "natif", reliability: "directe", schema_version: "2.0" },
    total: cities.length,
    deposited: cities.filter((c) => c.statut === "DEPOSITED").length,
    skipped: cities.filter((c) => String(c.statut).startsWith("SKIP")).length,
    cities,
  };
  if (out) { writeFileSync(resolve(ROOT, out), `${JSON.stringify(record, null, 1)}\n`, "utf8"); process.stderr.write(`RECORD → ${out}\n`); }
  else process.stdout.write(`${JSON.stringify(record, null, 1)}\n`);
}

main().catch((e) => { process.stderr.write(`${(e as Error).stack ?? String(e)}\n`); process.exit(1); });
