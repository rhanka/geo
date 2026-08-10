/**
 * _zones-vnatif-deposit-saint-hyacinthe-20260810.ts — DÉPÔT v2 candidate→documented de
 * SAINT-HYACINTHE (grain zone-polygon) depuis SA PROPRE couche-source d'identité :
 * arcgis.st-hyacinthe.ca … ISOGEO_SigimProd_Features/FeatureServer/13 (dbo.V_ZON_ZONAGE_S),
 * la MÊME couche que le servi (zone_source_url du servi), désormais CAPTURÉE et VÉRIFIÉE.
 *
 * CONTEXTE (cf work/coverage/zones-identity-analysis-saint-hyacinthe-20260810.{json,md} 2cfa317d).
 * Le servi actuel est `level=candidate` avec une URL FeatureServer/13 DÉCLARATIVE (non-null)
 * mais SANS preuve v2 (featureHasV2Proof=0/1091, artifact_uri self-référentiel). C'est le
 * chemin de réconciliation EXPLICITEMENT recommandé par l'analyse : capturer CETTE couche et
 * upgrader la MÊME identité candidate→documented SANS dropper de codes.
 *
 * IDENTITÉ DE COUCHE (G6 satisfait, NON mauvaise-couche) : même service/couche/nom
 * (dbo.V_ZON_ZONAGE_S), count 1091==1091==1091 (capture==servi==source LIVE), et overlap
 * NUM_ZONE = 100% (1087/1087) → définitivement la même couche.
 *
 * DÉRIVATION zone_code (ANTI-INVENTION, évidence 99.9%) : le servi keye `zone_code` =
 * `NUM_ZONE + "-" + <classe usage-dominant>` (ex. "4052-C"). La classe = composant de tête
 * de GROUPE_USAGE_DOM avant le premier "-". La source a depuis RAFFINÉ GROUPE_USAGE_DOM en
 * "classe-NN" (ex. "C-03") et expose la grille canonique "4052-C-03" (GRILLE_URL/ETIQUETTE).
 * On REPRODUIT fidèlement le code servi (classe de tête) — overlap 99.9% (1088/1089) MESURÉ,
 * pas supposé — ce qui préserve l'enrichissement servi (reglement/usage_dominant, appariés
 * par code) et upgrade la provenance sans re-keyer la collection. Le raffinement "-03"
 * disponible en source est DOCUMENTÉ pour un éventuel recalage archi (hors de ce dépôt : le
 * re-keyage vers "4052-C-03" droppe ~tous les codes et vide l'enrichissement — bloqué à juste
 * titre par le gate anti-appauvrissement de putServedZoneGeojson).
 *
 * GARDES (avant tout dépôt) :
 *   G2  capture natif/directe, sha256 byte-exact (re-hash CAS == manifeste == clé CAS +
 *       verifyRawCapturePayload), count == énumération source LIVE ET exceededTransferLimit !== true.
 *   grain classification par NATURE : PAS de marqueur UEV ⇒ zone-polygon (attendu). Sinon SKIP.
 *   anti-homonyme : nearest_registre_muni === slug.
 *   UPGRADE : le servi ne doit PAS porter déjà une vraie preuve v2 (candidate déclaratif).
 *   overlap ≥ 90% (le juge d'identité reste NUM_ZONE 100% + nom + count==source ; l'overlap
 *       code faible serait un signal G6, ICI 99.9% donc conforme).
 *   divergence documentée : les codes servi-seulement (attendu 1, uncovered) → gate les
 *       marque UNKNOWN (recalage-flagged, JAMAIS N-A) + backup _replaced/.
 *   G5  servi après = octets EXACTS de la capture (geometry digest byte-exact),
 *       level→documented, url=proof.url, geometry_grain=zone-polygon ; backup _replaced/.
 *
 * `--dry-run` (défaut) : resolve + G2 + grain + dérivation + overlap + dropped SANS déposer.
 * `--commit`           : dépose réellement (lecture+écriture S3).
 * `--out f.json`       : écrit le record.
 *
 * USAGE :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_zones-vnatif-deposit-saint-hyacinthe-20260810.ts \
 *     [--commit] --out work/coverage/zones-vnatif-deposit-record-saint-hyacinthe-20260810.json
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

// Champ synthétique portant la dérivation faithful du zone_code servi (jamais servi tel quel :
// normalize ne conserve que zone_code + props génériques ; ce champ ne sert qu'à CALCULER zone_code).
const DERIVED_FIELD = "_zone_code_shy_derived";
const NUM_FIELD = "NUM_ZONE";
const GROUPE_FIELD = "GROUPE_USAGE_DOM";
const GRILLE_FIELD = "GRILLE_URL";
const ETIQ_FIELD = "ETIQUETTE";

const SLUG = "saint-hyacinthe";
const RUN_STAMP = "20260810T130000Z";
const URL_CAP =
  "https://arcgis.st-hyacinthe.ca/server/rest/services/ISOGEO_SigimProd_Features/FeatureServer/13/query?where=1%3D1&outFields=*&f=geojson";
const GRAIN: GeometryGrain = "zone-polygon";
// Codes servi-seulement attendus (dérivation classe-de-tête) — ASSERTÉ (surprise → à revoir).
const EXPECTED_DROPPED = ["3083X"]; // canon de "3083-X" (source: GROUPE 3083 = "H-16" ⇒ classe "H")
const OVERLAP_MIN_PCT = 90;

function requireS3(): void {
  const opts = process.env["NODE_OPTIONS"] ?? "";
  if (!opts.split(/\s+/).includes("--dns-result-order=ipv4first")) {
    throw new Error("S3 refusé: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  }
  if (process.env["AWS_MAX_ATTEMPTS"] !== "10") throw new Error("S3 refusé: préfixer AWS_MAX_ATTEMPTS=10");
}
function arg(name: string): string | undefined { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; }
function has(name: string): boolean { return process.argv.includes(`--${name}`); }

function canon(value: unknown): string { return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function shaBare(s: string | null | undefined): string | null { return typeof s === "string" ? s.replace(/^sha256:/, "") : null; }
function sha256Hex(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }

interface Feat { geometry?: unknown; properties?: Record<string, unknown> | null }
function geometryDigest(features: Feat[]): string {
  const h = createHash("sha256");
  for (const f of features) h.update(JSON.stringify(f.geometry ?? null));
  return `sha256:${h.digest("hex")}`;
}

/** Classe usage-dominant = composant de tête de GROUPE_USAGE_DOM avant le premier "-".
 *  "C-03" ⇒ "C" ; "C" ⇒ "C". C'est un composant RÉEL du champ source, pas une invention. */
function usageClass(groupe: unknown): string {
  const s = String(groupe ?? "").trim();
  if (!s) return "";
  const head = s.split("-")[0] ?? "";
  return head.trim();
}
/** zone_code faithful = NUM_ZONE + "-" + classe (reproduit le servi, évidence 99.9%). */
function deriveZoneCode(props: Record<string, unknown> | null | undefined): string | null {
  const num = String(props?.[NUM_FIELD] ?? "").trim();
  if (!num) return null;
  const cls = usageClass(props?.[GROUPE_FIELD]);
  return cls ? `${num}-${cls}` : num;
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

// ── Source enumeration (LIVE) ────────────────────────────────────────────────────
async function fetchJson(url: string, timeoutMs = 25_000): Promise<unknown> {
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
  try { const info = await fetchJson(`${base}?f=json`) as { name?: unknown }; if (typeof info.name === "string") out.layer_name = info.name; }
  catch (e) { out.error = `layer-info: ${(e as Error).message}`; }
  try { const cnt = await fetchJson(countQuery) as { count?: unknown }; if (typeof cnt.count === "number") out.source_count = cnt.count; else out.error = [out.error, "count: pas de champ count"].filter(Boolean).join("; "); }
  catch (e) { out.error = [out.error, `count: ${(e as Error).message}`].filter(Boolean).join("; "); }
  return out;
}

// ── Served (before) ──────────────────────────────────────────────────────────────
interface ServedState { keys: string[]; layout: string; features: number; codes: Set<string>; levels: string[]; urls: (string | null)[]; hasCollectionV2: boolean; hasRealV2ProofBlock: boolean }
function keyFor(slug: string): { flat: string; nested: string } {
  return { flat: `${S3_PREFIX}qc-zonage-${slug}.geojson`, nested: `${S3_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson` };
}
async function readServed(s3: ReturnType<typeof s3Client>, slug: string): Promise<ServedState> {
  const { flat, nested } = keyFor(slug);
  const keys: string[] = [];
  if (await exists(s3, flat)) keys.push(flat);
  if (await exists(s3, nested)) keys.push(nested);
  const codes = new Set<string>(); const levels = new Set<string>(); const urls = new Set<string | null>();
  let features = 0, hasCollectionV2 = false, hasRealV2ProofBlock = false;
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
  return { keys, layout, features, codes, levels: [...levels].sort(), urls: [...urls], hasCollectionV2, hasRealV2ProofBlock };
}

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
  const registry = loadRegistry();
  const s3 = s3Client();

  const entry: Record<string, unknown> = {
    slug: SLUG, run_stamp: RUN_STAMP, source_url: URL_CAP, layer_id: layerIdFromUrl(URL_CAP), expected_geometry_grain: GRAIN,
    zone_code_derivation: `NUM_ZONE + "-" + head(GROUPE_USAGE_DOM before first "-")`,
  };
  try {
    const runs = await loadRuns(s3, RUN_STAMP);
    const found = findLine(runs, URL_CAP);
    if (!found) { entry.statut = "SKIP"; entry.raison = "capture introuvable (aucune ligne url|final_url dans les shards du run-stamp)"; }
    else {
      const { run_id, line } = found;
      entry.capture_run_id = run_id; entry.http_status = line.http_status; entry.sha256 = line.sha256; entry.retrieved_at = line.retrieved_at; entry.storage_key = line.storage_key;
      if (line.redacted || line.http_status === null || line.http_status < 200 || line.http_status >= 300 || line.storage_key === null || line.sha256 === null) {
        entry.statut = "SKIP"; entry.raison = `capture non déposable: status=${String(line.http_status)} sha=${String(line.sha256)}`;
      } else {
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
          entry.statut = "SKIP"; entry.raison = `byte-exact NON prouvé (rehash=${rehashOk} casKey=${casKeyOk} raw=${rawVerified}:${rawReason})`;
        } else {
          const gj = JSON.parse(bytes.toString("utf8")) as { type?: string; features?: Feat[]; exceededTransferLimit?: boolean };
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
          const nearestOk = near.slug === SLUG; entry.nearest_matches_slug = nearestOk;
          // grain
          const propKeys = new Set<string>();
          for (const f of feats) for (const k of Object.keys(f.properties ?? {})) propKeys.add(k);
          const upper = new Map([...propKeys].map((k) => [k.toUpperCase(), k]));
          const uevPresent = UEV_MARKER_FIELDS.filter((m) => upper.has(m)).map((m) => upper.get(m)!);
          const classified: GeometryGrain = uevPresent.length > 0 ? "evaluation-unit" : "zone-polygon";
          entry.uev_fields_present = uevPresent; entry.geometry_grain_classified = classified;
          const grainOk = classified === GRAIN; entry.grain_matches_expected = grainOk;
          // Dériver zone_code faithful sur chaque feature (champ synthétique) — géométrie intacte.
          let derivedNull = 0;
          const capCodes = new Set<string>();
          const capNums = new Set<string>();
          const sampleDeriv: Record<string, unknown>[] = [];
          for (const f of feats) {
            const p = (f.properties ?? {}) as Record<string, unknown>;
            const zc = deriveZoneCode(p);
            if (zc === null) derivedNull++;
            (f.properties as Record<string, unknown>) = { ...p, [DERIVED_FIELD]: zc };
            if (zc) capCodes.add(canon(zc));
            const num = String(p[NUM_FIELD] ?? "").trim(); if (num) capNums.add(canon(num));
            if (sampleDeriv.length < 10) sampleDeriv.push({ num, groupe: p[GROUPE_FIELD], grille: p[GRILLE_FIELD], etiquette: p[ETIQ_FIELD], derived_zone_code: zc });
          }
          entry.derived_null_count = derivedNull;
          entry.capture_distinct_derived_codes = capCodes.size;
          entry.capture_distinct_num_zone = capNums.size;
          entry.sample_derivations = sampleDeriv;
          // Source enumeration (LIVE)
          const src = await sourceEnumeration(URL_CAP);
          entry.source_count = src.source_count; entry.source_layer_name = src.layer_name; entry.count_query = src.count_query; entry.source_enum_error = src.error;
          const countComplete = src.source_count === null ? !exceeded : (feats.length === src.source_count && !exceeded);
          entry.count_complete = countComplete;
          entry.count_complete_basis = src.source_count === null
            ? `source_count indisponible (${src.error}) → complétude par exceededTransferLimit=${exceeded}`
            : `feature_count(${feats.length}) == source_count(${src.source_count}) && exceededTransferLimit=${exceeded}`;
          // Served before
          const served = await readServed(s3, SLUG);
          entry.served_keys = served.keys; entry.served_layout = served.layout; entry.served_features = served.features;
          entry.served_distinct_codes = served.codes.size; entry.served_levels = served.levels; entry.served_source_urls = served.urls;
          entry.served_has_collection_v2 = served.hasCollectionV2; entry.served_has_real_v2_proof_block = served.hasRealV2ProofBlock;
          const servedAllNull = served.urls.every((u) => u === null); entry.served_all_url_null = servedAllNull;
          const servedCandidateDeclarative = !served.hasRealV2ProofBlock && !served.hasCollectionV2 && !servedAllNull;
          entry.served_candidate_declarative = servedCandidateDeclarative;
          // NUM_ZONE overlap (layer identity)
          const servedNums = new Set<string>();
          // recompute served numeric prefixes from served codes (canon "4052C" → "4052")
          for (const c of served.codes) { const m = /^(\d+)/.exec(c); if (m) servedNums.add(m[1]!); }
          let numInter = 0; for (const n of servedNums) if (capNums.has(n)) numInter++;
          entry.num_zone_overlap = { served_nums: servedNums.size, capture_nums: capNums.size, intersection: numInter, served_into_capture_pct: servedNums.size ? Math.round((numInter / servedNums.size) * 1000) / 10 : null };
          // code overlap on derived
          const uncovered = [...served.codes].filter((c) => !capCodes.has(c)).sort();
          const covered = served.codes.size - uncovered.length;
          entry.served_codes_covered = covered; entry.served_codes_uncovered = uncovered.length; entry.uncovered_codes = uncovered;
          const overlap = served.codes.size > 0 ? Math.round((covered / served.codes.size) * 1000) / 10 : null;
          entry.overlap_ratio_pct = overlap;

          // ── Gardes ──
          const guards: string[] = [];
          if (served.keys.length === 0) guards.push("aucun servi (rien à upgrader)");
          if (!isFC || feats.length === 0) guards.push("capture vide/non-FC");
          if (!allPolygonal) guards.push("géométrie non 100% polygonale");
          if (!nearestOk) guards.push(`anti-homonyme: nearest=${String(near.slug)} != ${SLUG}`);
          if (!grainOk) guards.push(`grain classifié ${classified} != attendu ${GRAIN}`);
          if (!countComplete) guards.push(`G2 fetch partiel: ${String(entry.count_complete_basis)}`);
          if (derivedNull > 0) guards.push(`${derivedNull} feature(s) sans zone_code dérivable (NUM_ZONE absent) — anti-invention`);
          if (served.hasRealV2ProofBlock || served.hasCollectionV2) guards.push(`servi porte DÉJÀ une preuve v2 (collection=${served.hasCollectionV2}, feature_block=${served.hasRealV2ProofBlock}) → remplacement-avec-perte, hors périmètre upgrade`);
          if (overlap !== null && overlap < OVERLAP_MIN_PCT) guards.push(`G6 overlap ${overlap}% < ${OVERLAP_MIN_PCT}% (identité couche = NUM_ZONE ${String((entry.num_zone_overlap as {served_into_capture_pct?: number}).served_into_capture_pct)}%, mais divergence code anormale — revue)`);
          // Divergence attendue (assert)
          const uncoveredCanon = uncovered.slice().sort();
          const expected = EXPECTED_DROPPED.slice().sort();
          const droppedMatchesExpected = JSON.stringify(uncoveredCanon) === JSON.stringify(expected);
          entry.expected_dropped = expected; entry.dropped_matches_expected = droppedMatchesExpected;
          if (!droppedMatchesExpected) guards.push(`codes servi-seulement (${uncoveredCanon.join(",") || "aucun"}) != attendu (${expected.join(",")}) — surprise, revue avant dépôt`);
          entry.guard_blocks = guards;

          if (guards.length > 0) { entry.statut = "SKIP"; entry.raison = guards.join(" ; "); }
          else if (!commit) { entry.statut = "DRY-RUN-OK"; entry.raison = "toutes gardes OK — prêt au dépôt candidate→documented (1 code droppé documenté→UNKNOWN) (relancer avec --commit)"; }
          else {
            const norm = normalize(feats as never[], DERIVED_FIELD, URL_CAP, "obscura-arcgis-vector");
            const proof = proofFromCaptureEntry(line, { type: "arcgis", method: "natif", reliability: "directe" });
            const res = await depositCapturedZones(s3, SLUG, norm, proof, { geometryGrain: GRAIN });
            entry.deposited = true; entry.replaced_backups = res.replacedBackups; entry.dropped_divergence = res.droppedDivergence;
            const droppedCodes = res.droppedDivergence.map((d) => d.code).sort();
            entry.dropped_codes = droppedCodes; entry.dropped_count = droppedCodes.length;
            entry.dropped_matches_expected_after_deposit = JSON.stringify(droppedCodes) === JSON.stringify(expected);

            // Readback
            const capDigest = geometryDigest(feats);
            const { flat, nested } = keyFor(SLUG);
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
                grain_uniform_expected: grains.size === 1 && grains.has(GRAIN),
              };
              readbacks.push(rb);
              const ok = rb.feature_count_matches_capture && rb.geometry_digest_byte_exact && rb.zone_code_present_all && rb.proof_url_matches
                && rb.proof_sha_matches_capture && !!rb.proof_retrieved_at && rb.carries_capture_sha256
                && rb.level_documented && rb.url_all_proof && rb.grain_uniform_expected;
              if (!ok) allOk = false;
            }
            const replacedListed = (await listObjectEntries(s3, `${S3_PREFIX}_replaced/qc-zonage-${SLUG}__`)).map((e) => e.key);
            entry.replaced_backups_listed = replacedListed; entry.readback = readbacks;
            entry.readback_ok = allOk && replacedListed.length > 0 && entry.dropped_matches_expected_after_deposit === true;
            entry.statut = entry.readback_ok ? "DEPOSITED" : "DEPOSITED_READBACK_FAIL";
            entry.raison = entry.readback_ok
              ? "upgrade candidate→documented v2 byte-exact ; zone_code faithful (NUM_ZONE-classe) ; grain=zone-polygon ; 1 code droppé documenté→UNKNOWN ; backup _replaced/ présent"
              : "DÉPÔT effectué mais readback/dropped inattendu — VÉRIFIER";
          }
        }
      }
    }
  } catch (e) {
    entry.statut = "ERROR"; entry.raison = (e as Error).message; entry.stack = (e as Error).stack;
    process.stderr.write(`  ERR ${SLUG}: ${(e as Error).message}\n`);
  }
  process.stderr.write(`[${commit ? "commit" : "dry-run"}] ${SLUG}: ${String(entry.statut)} — ${String(entry.raison ?? "")}\n`);

  const record = {
    contract: "zones-vnatif-deposit-record-saint-hyacinthe/v1",
    date: "2026-08-10",
    spec: "SPEC_ZONE_DEPOSIT_REPLACE_POLICY.md@64f82eae/65d4c637 + SPEC_ZONE_GEOMETRY_GRAIN.md@7c7f6731",
    decision: "CLEAN-UPGRADE (candidate→documented, même couche-identité ISOGEO/13, zone_code servi reproduit 99.9%)",
    mode: commit ? "commit" : "dry-run",
    gate: "depositCapturedZones identity gate PROVENANCE-AWARE (discriminateur = preuve v2 par-feature) + geometry_grain",
    proof_intended: { type: "arcgis", method: "natif", reliability: "directe", schema_version: "2.0" },
    taxonomy_refinement_note_for_archi: "La source expose désormais GROUPE_USAGE_DOM='classe-NN' (ex 'C-03') et la grille canonique 'NUM-classe-NN' (GRILLE_URL/ETIQUETTE, ex '4052-C-03'). Ce dépôt REPRODUIT le code servi 'NUM-classe' (ex '4052-C', overlap 99.9%) pour un upgrade 0-perte préservant l'enrichissement. Adopter le code raffiné 'NUM-classe-NN' serait un EVOLUTION-REPLACE re-keyant ~toute la collection (0% overlap sur le code entier) et vidant l'enrichissement (bloqué par le gate anti-appauvrissement) — à traiter comme un RECALAGE séparé si archi le décide.",
    city: entry,
  };
  if (out) { writeFileSync(resolve(ROOT, out), `${JSON.stringify(record, null, 1)}\n`, "utf8"); process.stderr.write(`RECORD → ${out}\n`); }
  else process.stdout.write(`${JSON.stringify(record, null, 1)}\n`);
}

main().catch((e) => { process.stderr.write(`${(e as Error).stack ?? String(e)}\n`); process.exit(1); });
