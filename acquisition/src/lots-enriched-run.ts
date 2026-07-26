/**
 * lots-enriched-run.ts -- per-municipality ENRICHED LOTS GeoJSON product.
 *
 * Pure attribute JOIN (no spatial compute): reads the clipped cadastre GeoJSON
 * (geometry + lot_id) and left-joins, by `lot_id`, the already-computed
 * per-lot columns from two parquet products:
 *   - normalized/qc-lot-zonage/<slug>.parquet  (zone_code, dominant_fraction,
 *     multi_zone, zone_codes, assignment_method, norms=JSON)
 *   - normalized/qc-lot-tod/<slug>.parquet     (in_tod, tod_id, tod_nom, …)
 * and emits ONE served-ready FeatureCollection per municipality:
 *   normalized/qc-lots/qc-lots-<slug>.geojson  (OGC collection id qc-lots-<slug>).
 *
 * The output is STRICTLY ADDITIVE over the cadastre: every original lot property
 * (NO_LOT, noLot, geoId=feature_id, name, code…) is preserved so immo's existing
 * lot identity keys keep working; zonage + norms + TOD are merged on top. The
 * flat immo alias `code_zone` is set alongside `zone_code` (same real value).
 *
 * The lot→zone fold also publishes an explicit quality contract:
 *   - zone_assignment_status: area-majority | centroid-fallback | multi-zone |
 *     unassigned. It describes the deterministic assignment method, not a claim
 *     that a historic assignment remains current after a later zone replacement.
 *   - dominant_fraction / multi_zone / assignment_method remain available for
 *     expert consumers. A separate lot-zone consistency audit compares a served
 *     qc-lots snapshot to the latest served qc-zonage snapshot.
 *
 * Three additive per-lot fields for immo (on top of zonage/norms/TOD):
 *   - surface_m2  : real polygon area, reprojected to a local metric CRS
 *                   (MTM/UTM via computeLotAttrs). Rounded to 0.01 m².
 *   - adresse     : civic address from the MAMH rôle foncier (RL0101), joined by
 *                   lot number (cadastre NO_LOT, spaces stripped, == rôle
 *                   RL0103Ax). The muni's rôle code_geo is resolved by NAME then
 *                   VALIDATED by lot-number overlap (guards homonym collisions,
 *                   e.g. the two "Saint-Lambert"); a candidate that doesn't
 *                   overlap the cadastre is rejected → adresse null (never wrong).
 *   - code_postal : RTA/FSA (3 premiers caractères du code postal, ex. "J4P"),
 *                   par géocodage inverse du centroïde du lot dans les polygones
 *                   RTA du Recensement 2021 (StatCan, stagés en S3 par
 *                   fsa-boundaries-prep.ts). Le rôle ne porte PAS le CP de
 *                   l'immeuble ; le CP complet (6 car.) est propriété de Postes
 *                   Canada, sans source ouverte bulk — la RTA est le plafond
 *                   ouvert honnête. `code_postal_precision`="fsa3" quand résolu,
 *                   null sinon (jamais fabriqué). Voir stats.code_postal.
 * The rôle XML is fetched per muni; `--no-role` skips it (surface still computed).
 *
 * Anti-invention: only real joined values are written. A lot absent from a
 * product, or whose product value is null, yields `null` (never a guess). When
 * a muni has no qc-lot-tod parquet at all, `in_tod` is `null` (unknown), not
 * `false`. surface_m2 is measured from the real geometry; adresse is verbatim
 * from the rôle (only casing of the street name + the RL0101Ex generic code are
 * normalized, with unknown codes preserved raw).
 *
 * SINGLE process by design (province cadastres are large — parallelism OOMs).
 * Output is streamed feature-by-feature to a temp file to bound peak memory.
 *
 * Pilot:
 *   tsx src/lots-enriched-run.ts --slugs saint-lambert,cowansville
 * Whole served set (every muni that already has a qc-lots output):
 *   tsx src/lots-enriched-run.ts --served
 * Whole province (single process, sharding optional):
 *   tsx src/lots-enriched-run.ts --all
 * Verify existing deposits:
 *   tsx src/lots-enriched-run.ts --slugs delson --verify-only
 *
 * Fast/materialization mode:
 *   --no-role --no-fsa keeps adresse/code_postal null and avoids the expensive
 *   remote rôle XML/FSA polygon joins. This is useful for qc-lots backfill where
 *   the anti-invention contract is more important than waiting for optional joins.
 *   --preserve-existing-optional-attrs retains those independently sourced
 *   fields verbatim from the prior served product while only zonage/norms are
 *   re-materialized.
 */
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { S3Client } from "@aws-sdk/client-s3";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import type { Feature, FeatureCollection, Geometry } from "geojson";

import { readParquetRowsFromBuffer } from "./lib/parquet-read.js";
import { norm as normCadastreSlug, ALIAS_SLUG_TO_CODE } from "./cadastre-clip-sda.js";
import { computeLotAttrs } from "./lot-attrs-geom.js";
import { fetchIndex, parseRole, type RoleAttrs } from "./role-foncier.js";
import { FSA_KEY, loadFsaIndex, lookupFsa, type FsaIndex } from "./lib/fsa-geocode.js";
import { BUCKET, exists, getBytes, getGeoJsonFeatureCollection, getJson, listSlugs, putBytes, s3Client } from "./lib/s3.js";
import {
  AddressRegressionGuardError,
  guardedQcLotsUpload,
  readExistingStatsOrNull,
} from "./lib/address-regression-guard.js";

const CAD_PREFIX = "normalized/qc-cadastre-lots/";
const ZONAGE_PREFIX = "normalized/qc-lot-zonage/";
const TOD_PREFIX = "normalized/qc-lot-tod/";
const OUT_PREFIX = "normalized/qc-lots/";
const SDA_BOUNDARIES_KEY = "normalized/qc-admin-boundaries/qc-municipalites.geojson";

const CADASTRE_SLUG_ALIASES: Record<string, string[]> = {
  "l-epiphanie": ["lepiphanie"],
  "l-assomption": ["lassomption"],
  "l-ange-gardien": ["lange-gardien--la-cote-de-beaupre"],
  "sainte-christine-d-auvergne": ["sainte-christine-dauvergne"],
};

/** Millésime du rôle foncier MAMH utilisé pour la jointure adresse. */
const ROLE_MILLESIME = 2026;
const ROLE_XML_URL = (code: string, m: number) =>
  `https://donneesouvertes.affmunqc.net/role/RL${code}_${m}.xml`;
/** Source du code postal : géocodage inverse RTA/FSA (StatCan 2021), pas le rôle. */
const CODE_POSTAL_SOURCE = "statcan-fsa-2021 (RTA/FSA 3 car., geocodage inverse centroide)";

/** Default per-muni wall-clock budget (skip a muni if it would exceed it). */
const DEFAULT_TIME_BOX_SEC = 1800;
/** Skip a cadastre larger than this (single-process OOM guard); override with --max-mb. */
const DEFAULT_MAX_MB = 1200;

type GeoFeature = Feature<Geometry, Record<string, unknown> | null>;
type GeoFc = FeatureCollection<Geometry, Record<string, unknown> | null>;

interface Args {
  slugs: string[];
  all: boolean;
  /** Enrich every muni that already has a served qc-lots output. */
  served: boolean;
  noUpload: boolean;
  verifyOnly: boolean;
  timeBoxSec: number;
  maxMb: number;
  shard: { index: number; total: number } | null;
  /** Skip the rôle-foncier address join (surface_m2 still computed). */
  noRole: boolean;
  /** Skip the RTA/FSA reverse-geocode join (code_postal stays null). */
  noFsa: boolean;
  /** Keep already-served adresse/RTA fields during a fast zonage-only rewrite. */
  preserveExistingOptionalAttrs: boolean;
}

interface EnrichStats {
  slug: string;
  input_keys: { cadastre: string; zonage: string | null; tod: string | null };
  output_key: string;
  num_lots: number;
  num_joined_zonage: number;
  num_with_zone_code: number;
  num_with_norms: number;
  pct_with_zone_code: number;
  pct_with_norms: number;
  zonage_join_rate: number;
  tod_present: boolean;
  num_joined_tod: number;
  num_in_tod: number;
  /** Surface (aire polygone reprojetée, m²) — nouveau champ additif. */
  num_with_surface: number;
  pct_with_surface: number;
  /** Code postal partiel (RTA/FSA) par géocodage inverse du centroïde. */
  code_postal: {
    source: string;
    precision: "fsa3";
    fsa_index_loaded: boolean;
    num_with_code_postal: number;
    pct_with_code_postal: number;
    note: string;
  };
  /** Adresse civique (jointure rôle-foncier MAMH par n° de lot) + note CP. */
  role: {
    code_geo: string | null;
    lots_matched: number;
    num_with_adresse: number;
    pct_with_adresse: number;
    code_postal_source: string;
    note: string | null;
  } | null;
  property_keys: string[];
  warnings: string[];
  examples: Array<Record<string, unknown>>;
  verified_deposit?: { exists: boolean; bytes: number };
}

function parseArgs(argv: string[]): Args {
  const slugs: string[] = [];
  let all = false;
  let served = false;
  let noUpload = false;
  let verifyOnly = false;
  let timeBoxSec = DEFAULT_TIME_BOX_SEC;
  let maxMb = DEFAULT_MAX_MB;
  let shard: { index: number; total: number } | null = null;
  let noRole = false;
  let noFsa = false;
  let preserveExistingOptionalAttrs = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--all") all = true;
    else if (arg === "--served") served = true;
    else if (arg === "--slug") slugs.push(...String(argv[++i] ?? "").split(",").filter(Boolean));
    else if (arg === "--slugs") slugs.push(...String(argv[++i] ?? "").split(",").filter(Boolean));
    else if (arg === "--no-upload") noUpload = true;
    else if (arg === "--no-role") noRole = true;
    else if (arg === "--no-fsa") noFsa = true;
    else if (arg === "--preserve-existing-optional-attrs") preserveExistingOptionalAttrs = true;
    else if (arg === "--verify-only") verifyOnly = true;
    else if (arg === "--time-box") timeBoxSec = Math.max(1, parseInt(String(argv[++i] ?? ""), 10) || DEFAULT_TIME_BOX_SEC);
    else if (arg === "--max-mb") maxMb = Math.max(1, parseInt(String(argv[++i] ?? ""), 10) || DEFAULT_MAX_MB);
    else if (arg === "--shard") {
      const spec = String(argv[++i] ?? "");
      const [idx, total] = spec.split("/").map((v) => parseInt(v, 10));
      if (!Number.isInteger(idx) || !Number.isInteger(total) || total <= 0 || idx < 0 || idx >= total) {
        throw new Error(`--shard expects i/n with 0<=i<n, got "${spec}"`);
      }
      shard = { index: idx, total };
    } else throw new Error(`unknown argument: ${arg}`);
  }

  const uniqueSlugs = [...new Set(slugs)];
  if (uniqueSlugs.length === 0 && !all && !served) {
    throw new Error("pass --all, --served, --slug <slug>, or --slugs <a,b>");
  }
  return {
    slugs: uniqueSlugs, all, served, noUpload, verifyOnly, timeBoxSec, maxMb, shard,
    noRole, noFsa, preserveExistingOptionalAttrs,
  };
}

function outKey(slug: string): string {
  return `${OUT_PREFIX}qc-lots-${slug}.geojson`;
}

function statsKey(slug: string): string {
  return `${OUT_PREFIX}qc-lots-${slug}.stats.json`;
}

function nestedOutKey(slug: string): string {
  return `${OUT_PREFIX}qc-lots-${slug}/qc-lots-${slug}.geojson`;
}

function nestedStatsKey(slug: string): string {
  return `${OUT_PREFIX}qc-lots-${slug}/qc-lots-${slug}.stats.json`;
}

/** Same lot-id extraction priority as lot-zone-join / tod-ingest, so the join
 *  key matches the value the parquet products stored. */
function lotIdOf(feature: GeoFeature, index: number): string {
  const props = feature.properties ?? {};
  for (const key of ["lot_id", "LOT_ID", "NO_LOT", "no_lot", "noLot", "geoId", "id"]) {
    const value = props[key];
    if (value !== null && value !== undefined && String(value).trim()) return String(value);
  }
  return String(index);
}

interface PreservedOptionalAttrs {
  adresse: string | null;
  code_postal: string | null;
  code_postal_precision: string | null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Fast zonage materialization must not erase values whose sources are unrelated
 * to the zonage parquet.  We reuse only prior SERVED values, with the layout
 * preference of geo-api (nested first), never synthesize a value locally.
 */
async function loadPreservedOptionalAttrs(s3: S3Client, slug: string): Promise<Map<string, PreservedOptionalAttrs>> {
  const keys = [
    `${OUT_PREFIX}qc-lots-${slug}/qc-lots-${slug}.geojson`,
    outKey(slug),
  ];
  for (const key of keys) {
    if (!(await exists(s3, key))) continue;
    const fc = await getGeoJsonFeatureCollection<GeoFeature>(s3, key) as GeoFc;
    const out = new Map<string, PreservedOptionalAttrs>();
    let index = -1;
    for (const feature of fc.features ?? []) {
      index += 1;
      const props = feature.properties ?? {};
      out.set(lotIdOf(feature, index), {
        adresse: stringOrNull(props["adresse"]),
        code_postal: stringOrNull(props["code_postal"]),
        code_postal_precision: stringOrNull(props["code_postal_precision"]),
      });
    }
    return out;
  }
  throw new Error(`${slug}: qc-lots servi absent; impossible de préserver les attributs optionnels`);
}

async function resolveCadastreKey(s3: S3Client, slug: string): Promise<string> {
  const candidates = [slug, ...(CADASTRE_SLUG_ALIASES[slug] ?? [])];
  for (const candidate of candidates) {
    const key = `${CAD_PREFIX}${candidate}.geojson`;
    if (await exists(s3, key)) return key;
  }
  const key = `${CAD_PREFIX}${slug}.geojson`;
  const slugs = await listSlugs(s3, CAD_PREFIX, ".geojson", true);
  const normalizedTargets = new Set(candidates.map((candidate) => normCadastreSlug(candidate)));
  const normalizedMatches = slugs.filter((c) => normalizedTargets.has(normCadastreSlug(c)));
  if (normalizedMatches.length === 1) return `${CAD_PREFIX}${normalizedMatches[0]}.geojson`;
  const containsMatches = slugs.filter((c) =>
    [...normalizedTargets].some((target) => normCadastreSlug(c).includes(target)),
  );
  if (containsMatches.length === 1) return `${CAD_PREFIX}${containsMatches[0]}.geojson`;
  const ambiguousCandidates = containsMatches.length > 0 ? containsMatches : normalizedMatches;
  throw new Error(
    `cadastre not found for ${slug}: ${key}` +
      (ambiguousCandidates.length > 0 ? `; ambiguous candidates: ${ambiguousCandidates.slice(0, 12).join(", ")}` : ""),
  );
}

/** HEAD to learn the cadastre object size without downloading it. */
async function objectSizeBytes(s3: S3Client, key: string): Promise<number> {
  const r = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
  return typeof r.ContentLength === "number" ? r.ContentLength : 0;
}

interface ZonageRow {
  zone_code: string | null;
  dominant_fraction: number | null;
  multi_zone: boolean | null;
  zone_codes: string[] | null;
  assignment_method: string | null;
  zone_assignment_status: string | null;
  norms: Record<string, unknown> | null;
}

async function loadZonage(s3: S3Client, key: string | null): Promise<Map<string, ZonageRow>> {
  const map = new Map<string, ZonageRow>();
  if (!key) return map;
  const rows = await readParquetRowsFromBuffer(await getBytes(s3, key));
  for (const row of rows) {
    const lotId = row["lot_id"];
    if (lotId === null || lotId === undefined || !String(lotId).trim()) continue;
    let norms: Record<string, unknown> | null = null;
    const rawNorms = row["norms"];
    if (typeof rawNorms === "string" && rawNorms.trim()) {
      try {
        norms = JSON.parse(rawNorms) as Record<string, unknown>;
      } catch {
        norms = null;
      }
    }
    map.set(String(lotId), {
      zone_code: strOrNull(row["zone_code"]),
      dominant_fraction: numOrNull(row["dominant_fraction"]),
      multi_zone: typeof row["multi_zone"] === "boolean" ? (row["multi_zone"] as boolean) : null,
      zone_codes: Array.isArray(row["zone_codes"]) ? (row["zone_codes"] as unknown[]).map((v) => String(v)) : null,
      assignment_method: strOrNull(row["assignment_method"]),
      zone_assignment_status: strOrNull(row["zone_assignment_status"]),
      norms,
    });
  }
  return map;
}

interface TodRow {
  in_tod: boolean | null;
  tod_id: string | null;
  tod_nom: string | null;
  tod_statut: string | null;
  tod_ligne: string | null;
  tod_type: string | null;
  tod_seuil_pmad: number | null;
}

async function loadTod(s3: S3Client, key: string | null): Promise<Map<string, TodRow> | null> {
  if (!key) return null;
  const rows = await readParquetRowsFromBuffer(await getBytes(s3, key));
  const map = new Map<string, TodRow>();
  for (const row of rows) {
    const lotId = row["lot_id"];
    if (lotId === null || lotId === undefined || !String(lotId).trim()) continue;
    map.set(String(lotId), {
      in_tod: typeof row["in_tod"] === "boolean" ? (row["in_tod"] as boolean) : null,
      tod_id: strOrNull(row["tod_id"]),
      tod_nom: strOrNull(row["tod_nom"]),
      tod_statut: strOrNull(row["tod_statut"]),
      tod_ligne: strOrNull(row["tod_ligne"]),
      tod_type: strOrNull(row["tod_type"]),
      tod_seuil_pmad: numOrNull(row["tod_seuil_pmad"]),
    });
  }
  return map;
}

function strOrNull(v: unknown): string | null {
  return v === null || v === undefined || !String(v).trim() ? null : String(v);
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// ── rôle-foncier address join ───────────────────────────────────────────────
// The cadastre ↔ rôle key is the renewed lot number: cadastre NO_LOT (thousands
// separators stripped) == rôle RL0103Ax. We resolve a muni's rôle code_geo from
// its name (rôle index ∪ SDA boundaries), but a name can collide (e.g. two
// "Saint-Lambert"), so we VALIDATE each candidate by lot-number overlap with the
// cadastre and keep the best — empirical, anti-invention (a wrong muni scores ~0).

/** Cadastral lot number of a feature, spaces stripped (rôle join key). */
function noLotKeyOf(feature: GeoFeature): string | null {
  const p = feature.properties ?? {};
  for (const key of ["NO_LOT", "noLot", "no_lot", "NOLOT", "lot_id", "LOT_ID"]) {
    const v = p[key];
    if (v !== null && v !== undefined && String(v).trim()) return String(v).replace(/ /g, "");
  }
  return null;
}

interface RoleContext {
  /** norm(municipality name) -> set of candidate code_geo. */
  byName: Map<string, Set<string>>;
  /** code_geo -> parsed rôle (matricule/lot -> attrs), or null if 404/unavailable. */
  cache: Map<string, Map<string, RoleAttrs> | null>;
  millesime: number;
}

function addName(map: Map<string, Set<string>>, name: string, code: string): void {
  const n = normCadastreSlug(name);
  const c = String(code).trim();
  if (!n || !c) return;
  let set = map.get(n);
  if (!set) map.set(n, (set = new Set()));
  set.add(c);
}

/** Build the name->code_geo index once (rôle MAMH index ∪ SDA boundaries). */
async function buildRoleContext(s3: S3Client, millesime: number): Promise<RoleContext> {
  const byName = new Map<string, Set<string>>();
  try {
    const idx = await fetchIndex(millesime);
    for (const e of Object.values(idx)) if (e.nom && e.code_geo) addName(byName, e.nom, e.code_geo);
  } catch (e) {
    console.log(`WARN rôle index fetch failed (${e instanceof Error ? e.message : String(e)})`);
  }
  try {
    const g = (await getJson(s3, SDA_BOUNDARIES_KEY)) as {
      features?: Array<{ properties?: Record<string, unknown> | null }>;
    };
    for (const f of g.features ?? []) {
      const p = f.properties ?? {};
      const code = String(p["MUS_CO_GEO"] ?? p["code"] ?? "").trim();
      const nm = String(p["MUS_NM_MUN"] ?? p["name"] ?? "");
      if (code && nm) addName(byName, nm, code);
    }
  } catch (e) {
    console.log(`WARN SDA boundaries load failed (${e instanceof Error ? e.message : String(e)})`);
  }
  return { byName, cache: new Map(), millesime };
}

/** Candidate code_geos for a cadastre slug (exact norm + progressive --mrc strip + alias). */
function gatherCandidateCodes(ctx: RoleContext, slug: string): string[] {
  const out = new Set<string>();
  const add = (key: string): void => {
    const set = ctx.byName.get(normCadastreSlug(key));
    if (set) for (const c of set) out.add(c);
  };
  const aliased = ALIAS_SLUG_TO_CODE[normCadastreSlug(slug)];
  if (aliased) out.add(aliased);
  add(slug);
  // `norm` drops apostrophes without a separator ("L'Assomption" -> "lassomption")
  // while the cadastre slug keeps a dash ("l-assomption"), so the two never meet.
  // The alias table already carries that spelling; a candidate it yields still has
  // to clear the lot-overlap bar below, so a wrong one yields null, never a guess.
  for (const alias of CADASTRE_SLUG_ALIASES[slug] ?? []) add(alias);
  const segs = slug.split(/-{2,}/); // "saint-lambert--abitibi-ouest" -> base
  for (let i = segs.length; i > 0; i--) add(segs.slice(0, i).join("-"));
  return [...out];
}

async function fetchRoleXml(code: string, millesime: number): Promise<Buffer | null> {
  const res = await fetch(ROLE_XML_URL(code, millesime));
  if (res.status === 403 || res.status === 404) return null;
  if (!res.ok) throw new Error(`rôle HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function getRoleMap(ctx: RoleContext, code: string): Promise<Map<string, RoleAttrs> | null> {
  if (ctx.cache.has(code)) return ctx.cache.get(code)!;
  let parsed: Map<string, RoleAttrs> | null = null;
  try {
    const xml = await fetchRoleXml(code, ctx.millesime);
    if (xml) {
      const lookup = parseRole(xml);
      parsed = new Map(Object.entries(lookup));
    }
  } catch (e) {
    console.log(`WARN rôle fetch/parse code=${code} (${e instanceof Error ? e.message : String(e)})`);
    parsed = null;
  }
  ctx.cache.set(code, parsed);
  return parsed;
}

interface RoleResolution {
  codeGeo: string;
  lotsMatched: number;
  roleMap: Map<string, RoleAttrs>;
}

/** Resolve the rôle for a muni by picking the candidate code_geo whose lot
 *  numbers best overlap the cadastre. Returns null if no candidate clears the bar. */
async function resolveRoleForSlug(
  ctx: RoleContext,
  slug: string,
  cadastreNoLots: Set<string>,
): Promise<{ resolution: RoleResolution | null; note: string | null }> {
  const candidates = gatherCandidateCodes(ctx, slug);
  if (candidates.length === 0) return { resolution: null, note: "no code_geo candidate for slug" };
  // Enough overlap to trust the match (guards name collisions & wrong munis).
  const minMatch = Math.max(30, Math.floor(0.03 * cadastreNoLots.size));
  let best: RoleResolution | null = null;
  for (const code of candidates.slice(0, 6)) {
    const roleMap = await getRoleMap(ctx, code);
    if (!roleMap) continue;
    let matched = 0;
    for (const key of roleMap.keys()) if (cadastreNoLots.has(key)) matched++;
    if (!best || matched > best.lotsMatched) best = { codeGeo: code, lotsMatched: matched, roleMap };
  }
  if (!best) return { resolution: null, note: `no rôle available (candidates: ${candidates.join(",")})` };
  if (best.lotsMatched < minMatch) {
    return {
      resolution: null,
      note: `rôle overlap too low (best code=${best.codeGeo} matched=${best.lotsMatched} < ${minMatch})`,
    };
  }
  return { resolution: best, note: null };
}

/** Merge cadastre props + zonage + norms + TOD into one flat property bag.
 *  Strictly additive; real values only (null when absent). */
function enrichProperties(
  base: Record<string, unknown> | null,
  lotId: string,
  zonage: ZonageRow | undefined,
  tod: Map<string, TodRow> | null,
): Record<string, unknown> {
  const props: Record<string, unknown> = { ...(base ?? {}) };
  props["lot_id"] = lotId;

  // ── zonage + flattened norms ──────────────────────────────────────────────
  if (zonage) {
    props["zone_code"] = zonage.zone_code;
    props["code_zone"] = zonage.zone_code; // immo contract alias (same real value)
    props["dominant_fraction"] = zonage.dominant_fraction;
    props["multi_zone"] = zonage.multi_zone;
    props["zone_codes"] = zonage.zone_codes;
    props["assignment_method"] = zonage.assignment_method;
    // Explicit stable contract for non-specialist API consumers. Older parquet
    // deposits have no field: null remains an honest "not materialized" rather
    // than reconstructing a potentially wrong status here.
    props["zone_assignment_status"] = zonage.zone_assignment_status;
    if (zonage.norms) {
      for (const [k, v] of Object.entries(zonage.norms)) {
        if (k === "zone_code") continue; // authoritative one already set above
        props[k] = v ?? null;
      }
    }
  } else {
    props["zone_code"] = null;
    props["code_zone"] = null;
    props["dominant_fraction"] = null;
    props["multi_zone"] = null;
    props["assignment_method"] = null;
    props["zone_assignment_status"] = null;
  }

  // ── TOD ───────────────────────────────────────────────────────────────────
  if (tod) {
    const t = tod.get(lotId);
    props["in_tod"] = t ? t.in_tod : null; // lot absent from a present product = unknown
    props["tod_id"] = t && t.in_tod ? t.tod_id : null;
    props["tod_nom"] = t && t.in_tod ? t.tod_nom : null;
    props["tod_statut"] = t && t.in_tod ? t.tod_statut : null;
    props["tod_ligne"] = t && t.in_tod ? t.tod_ligne : null;
    props["tod_type"] = t && t.in_tod ? t.tod_type : null;
    props["tod_seuil_pmad"] = t && t.in_tod ? t.tod_seuil_pmad : null;
  } else {
    props["in_tod"] = null; // muni has no TOD product at all
  }
  return props;
}

async function runCity(
  s3: S3Client,
  slug: string,
  args: Args,
  roleCtx: RoleContext | null,
  fsaIndex: FsaIndex | null,
): Promise<EnrichStats> {
  const cadastreKey = await resolveCadastreKey(s3, slug);
  const sizeBytes = await objectSizeBytes(s3, cadastreKey);
  const sizeMb = sizeBytes / 1e6;
  if (sizeMb > args.maxMb) {
    throw new Error(`cadastre ${sizeMb.toFixed(0)}MB > --max-mb ${args.maxMb} (single-process OOM guard)`);
  }

  const zonageKey = (await exists(s3, `${ZONAGE_PREFIX}${slug}.parquet`)) ? `${ZONAGE_PREFIX}${slug}.parquet` : null;
  const todKey = (await exists(s3, `${TOD_PREFIX}${slug}.parquet`)) ? `${TOD_PREFIX}${slug}.parquet` : null;

  const [zonage, tod] = await Promise.all([loadZonage(s3, zonageKey), loadTod(s3, todKey)]);
  const cadastre = (await getGeoJsonFeatureCollection<GeoFeature>(s3, cadastreKey)) as GeoFc;
  const features = cadastre.features ?? [];
  const preservedOptionalAttrs = args.preserveExistingOptionalAttrs
    ? await loadPreservedOptionalAttrs(s3, slug)
    : null;

  // ── rôle-foncier address resolution (collision-safe by lot overlap) ─────────
  let roleResolution: RoleResolution | null = null;
  let roleNote: string | null = null;
  if (roleCtx) {
    const cadastreNoLots = new Set<string>();
    for (const f of features) {
      if (!f || !f.geometry) continue;
      const k = noLotKeyOf(f);
      if (k) cadastreNoLots.add(k);
    }
    const r = await resolveRoleForSlug(roleCtx, slug, cadastreNoLots);
    roleResolution = r.resolution;
    roleNote = r.note;
  } else {
    roleNote = "rôle join disabled (--no-role)";
  }

  // Stream the FeatureCollection to a temp file, one feature at a time.
  const dir = await mkdtemp(join(tmpdir(), `qc-lots-${slug}-`));
  const path = join(dir, "out.geojson");
  const stream = createWriteStream(path, { encoding: "utf8" });
  const write = (chunk: string): Promise<void> =>
    new Promise((resolve, reject) => {
      stream.write(chunk, (err) => (err ? reject(err) : resolve()));
    });

  let numLots = 0;
  let numJoinedZonage = 0;
  let numWithZoneCode = 0;
  let numWithNorms = 0;
  let numJoinedTod = 0;
  let numInTod = 0;
  let numWithSurface = 0;
  let numWithAdresse = 0;
  let numWithCodePostal = 0;
  const propertyKeys = new Set<string>();
  const examples: Array<Record<string, unknown>> = [];

  try {
    await write('{"type":"FeatureCollection","features":[');
    let first = true;
    let index = -1;
    for (const feature of features) {
      index += 1;
      if (!feature || !feature.geometry) continue;
      const lotId = lotIdOf(feature, index);
      const zRow = zonage.get(lotId);
      const props = enrichProperties(feature.properties ?? null, lotId, zRow, tod);

      // ── new additive fields ──────────────────────────────────────────────
      // surface_m2 + centroïde (une seule passe géométrique par lot).
      const attrs = computeLotAttrs(feature);
      const surface = attrs.superficie_m2;
      props["surface_m2"] = surface;
      const preserved = preservedOptionalAttrs?.get(lotId);
      // adresse: rôle-foncier join by lot number (spaces stripped).
      const noLotKey = noLotKeyOf(feature);
      const roleRow = roleResolution && noLotKey ? roleResolution.roleMap.get(noLotKey) : undefined;
      props["adresse"] = preserved ? preserved.adresse : roleRow?.adresse ?? null;
      // code_postal: RTA/FSA (3 car.) par géocodage inverse du centroïde du lot.
      const codePostal =
        preserved
          ? preserved.code_postal
          : fsaIndex && attrs.centroid_lon !== null && attrs.centroid_lat !== null
          ? lookupFsa(fsaIndex, attrs.centroid_lon, attrs.centroid_lat)
          : null;
      props["code_postal"] = codePostal;
      props["code_postal_precision"] = preserved
        ? preserved.code_postal_precision
        : codePostal ? "fsa3" : null;

      numLots += 1;
      if (zRow) numJoinedZonage += 1;
      if (props["zone_code"] !== null && props["zone_code"] !== undefined) numWithZoneCode += 1;
      if (zRow?.norms) numWithNorms += 1;
      if (tod && tod.has(lotId)) numJoinedTod += 1;
      if (props["in_tod"] === true) numInTod += 1;
      if (surface !== null) numWithSurface += 1;
      if (props["adresse"] !== null) numWithAdresse += 1;
      if (codePostal !== null) numWithCodePostal += 1;
      for (const k of Object.keys(props)) propertyKeys.add(k);

      if (examples.length < 3 && props["zone_code"] !== null && zRow?.norms) {
        examples.push(exampleOf(props));
      }

      const out = { type: "Feature", geometry: feature.geometry, properties: props };
      await write((first ? "" : ",") + JSON.stringify(out));
      first = false;
    }
    await write("]}");
    await new Promise<void>((resolve, reject) => stream.end((err?: Error | null) => (err ? reject(err) : resolve())));

    const warnings: string[] = [];
    if (preservedOptionalAttrs) {
      warnings.push("adresse/code_postal preserved verbatim from prior served qc-lots during zonage-only materialization");
    }
    const zonageJoinRate = numLots ? round2((100 * numJoinedZonage) / numLots) : 0;
    const pctWithZoneCode = numLots ? round2((100 * numWithZoneCode) / numLots) : 0;
    const pctWithNorms = numLots ? round2((100 * numWithNorms) / numLots) : 0;
    const pctWithSurface = numLots ? round2((100 * numWithSurface) / numLots) : 0;
    const pctWithAdresse = numLots ? round2((100 * numWithAdresse) / numLots) : 0;
    const pctWithCodePostal = numLots ? round2((100 * numWithCodePostal) / numLots) : 0;
    if (zonageKey && zonageJoinRate < 90) warnings.push(`zonage join rate ${zonageJoinRate}% < 90% (lot_id mismatch?)`);
    if (!zonageKey) warnings.push(`no zonage parquet — zone_code/norms all null`);
    if (pctWithSurface < 95) warnings.push(`surface_m2 present ${pctWithSurface}% < 95% (non-polygonal geoms?)`);
    if (roleCtx && !roleResolution) warnings.push(`adresse: ${roleNote ?? "no rôle match"} — adresse all null`);
    else if (roleResolution && pctWithAdresse < 50) {
      warnings.push(`adresse present ${pctWithAdresse}% < 50% (code=${roleResolution.codeGeo})`);
    }
    if (args.noFsa) warnings.push(`code_postal: disabled (--no-fsa) — code_postal all null`);
    else if (!fsaIndex) warnings.push(`code_postal: no FSA index (${FSA_KEY} missing?) — code_postal all null`);
    else if (pctWithCodePostal < 90) warnings.push(`code_postal (RTA) present ${pctWithCodePostal}% < 90%`);

    const codePostalStats: EnrichStats["code_postal"] = {
      source: CODE_POSTAL_SOURCE,
      precision: "fsa3",
      fsa_index_loaded: fsaIndex !== null,
      num_with_code_postal: numWithCodePostal,
      pct_with_code_postal: pctWithCodePostal,
      note:
        "RTA/FSA = 3 premiers caractères du code postal (ex. J4P) ; le CP complet (6 car.) " +
        "est propriétaire (Postes Canada), sans source ouverte bulk. null si hors RTA.",
    };

    const role: EnrichStats["role"] = {
      code_geo: roleResolution?.codeGeo ?? null,
      lots_matched: roleResolution?.lotsMatched ?? 0,
      num_with_adresse: numWithAdresse,
      pct_with_adresse: pctWithAdresse,
      code_postal_source: CODE_POSTAL_SOURCE,
      note: roleNote,
    };

    const stats: EnrichStats = {
      slug,
      input_keys: { cadastre: cadastreKey, zonage: zonageKey, tod: todKey },
      output_key: outKey(slug),
      num_lots: numLots,
      num_joined_zonage: numJoinedZonage,
      num_with_zone_code: numWithZoneCode,
      num_with_norms: numWithNorms,
      pct_with_zone_code: pctWithZoneCode,
      pct_with_norms: pctWithNorms,
      zonage_join_rate: zonageJoinRate,
      tod_present: tod !== null,
      num_joined_tod: numJoinedTod,
      num_in_tod: numInTod,
      num_with_surface: numWithSurface,
      pct_with_surface: pctWithSurface,
      code_postal: codePostalStats,
      role,
      property_keys: [...propertyKeys].sort(),
      warnings,
      examples,
    };

    if (!args.noUpload) {
      const body = await readFile(path);
      const statsBody = Buffer.from(JSON.stringify(stats, null, 2), "utf8");
      // A fast materialization must refresh the layout geo-api actually serves,
      // but it must not create a new nested layout where none existed.
      const mirrorNested = args.preserveExistingOptionalAttrs && await exists(s3, nestedOutKey(slug));
      await guardedQcLotsUpload({
        slug,
        candidateAddressCount: numWithAdresse,
        readExistingStats: async () =>
          readExistingStatsOrNull(() => getJson(s3, statsKey(slug))),
        uploadGeoJson: async () =>
          putBytes(s3, outKey(slug), body, "application/geo+json"),
        uploadStats: async () =>
          putBytes(
            s3,
            statsKey(slug),
            statsBody,
            "application/json",
          ),
      });
      if (mirrorNested) {
        await putBytes(s3, nestedOutKey(slug), body, "application/geo+json");
        await putBytes(s3, nestedStatsKey(slug), statsBody, "application/json");
      }
      const dep = await verifyDeposit(s3, slug);
      stats.verified_deposit = dep;
    } else {
      const st = await stat(path);
      stats.verified_deposit = { exists: true, bytes: st.size };
    }
    return stats;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function exampleOf(props: Record<string, unknown>): Record<string, unknown> {
  const pick = (k: string): unknown => (props[k] === undefined ? null : props[k]);
  return {
    lot_id: pick("lot_id"),
    geoId: pick("geoId"),
    zone_code: pick("zone_code"),
    dominant_fraction: pick("dominant_fraction"),
    multi_zone: pick("multi_zone"),
    assignment_method: pick("assignment_method"),
    zone_assignment_status: pick("zone_assignment_status"),
    surface_m2: pick("surface_m2"),
    adresse: pick("adresse"),
    code_postal: pick("code_postal"),
    code_postal_precision: pick("code_postal_precision"),
    hauteur_max_value: pick("hauteur_max_value"),
    densite_value: pick("densite_value"),
    marge_avant_min_value: pick("marge_avant_min_value"),
    in_tod: pick("in_tod"),
    tod_nom: pick("tod_nom"),
  };
}

async function verifyDeposit(s3: S3Client, slug: string): Promise<EnrichStats["verified_deposit"]> {
  const key = outKey(slug);
  if (!(await exists(s3, key))) return { exists: false, bytes: 0 };
  const bytes = await objectSizeBytes(s3, key);
  return { exists: true, bytes };
}

async function verifyOnly(s3: S3Client, slug: string): Promise<EnrichStats> {
  const sKey = statsKey(slug);
  if (!(await exists(s3, sKey))) throw new Error(`stats not found: ${sKey}`);
  const stats = JSON.parse((await getBytes(s3, sKey)).toString("utf8")) as EnrichStats;
  stats.verified_deposit = await verifyDeposit(s3, slug);
  return stats;
}

function printSummary(stats: EnrichStats): void {
  const v = stats.verified_deposit;
  console.log(
    [
      `OK ${stats.slug}`,
      `lots=${stats.num_lots}`,
      `zone_code=${stats.pct_with_zone_code}%`,
      `norms=${stats.pct_with_norms}%`,
      `surface=${stats.pct_with_surface}%`,
      `code_postal=${stats.code_postal ? `${stats.code_postal.pct_with_code_postal}%(RTA)` : "n/a"}`,
      `adresse=${stats.role ? `${stats.role.pct_with_adresse}%(code=${stats.role.code_geo ?? "-"})` : "n/a"}`,
      `tod=${stats.tod_present ? `${stats.num_in_tod}/${stats.num_lots}` : "n/a"}`,
      v ? `deposit=${v.exists ? "Y" : "N"} bytes=${v.bytes}` : "",
    ]
      .filter(Boolean)
      .join(" "),
  );
  if (stats.warnings.length > 0) console.log(`WARN ${stats.slug} ${stats.warnings.join("; ")}`);
  for (const ex of stats.examples) {
    console.log(`EXAMPLE ${stats.slug} ${JSON.stringify(ex)}`);
  }
}

async function enumerateCadastreSlugs(s3: S3Client): Promise<string[]> {
  return (await listSlugs(s3, CAD_PREFIX, ".geojson", true)).sort();
}

/** Slugs that already have a served qc-lots output (the set immo consumes). */
async function enumerateServedSlugs(s3: S3Client): Promise<string[]> {
  return (await listSlugs(s3, OUT_PREFIX, ".geojson", true))
    .filter((s) => s.startsWith("qc-lots-"))
    .map((s) => s.replace(/^qc-lots-/, ""))
    .sort();
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const s3 = s3Client();
  const allSlugs = args.all
    ? await enumerateCadastreSlugs(s3)
    : args.served
      ? await enumerateServedSlugs(s3)
      : args.slugs;
  const slugs = args.shard ? allSlugs.filter((_, i) => i % args.shard!.total === args.shard!.index) : allSlugs;
  if (args.all || args.served) {
    console.log(
      `${args.served ? "SERVED" : "ALL"} slugs: ${allSlugs.length}` +
        (args.shard ? ` | shard ${args.shard.index}/${args.shard.total} -> ${slugs.length}` : ""),
    );
  }

  // Build the rôle name->code_geo index ONCE (skipped for verify-only/--no-role).
  let roleCtx: RoleContext | null = null;
  if (!args.verifyOnly && !args.noRole) {
    roleCtx = await buildRoleContext(s3, ROLE_MILLESIME);
    const names = roleCtx.byName.size;
    console.log(`rôle index: ${names} municipality names -> code_geo (millésime ${ROLE_MILLESIME})`);
  }

  // Charge l'index RTA/FSA ONCE (géocodage inverse code_postal). Absent -> null.
  let fsaIndex: FsaIndex | null = null;
  if (!args.verifyOnly && !args.noFsa) {
    try {
      fsaIndex = await loadFsaIndex(s3);
      console.log(`FSA index: ${fsaIndex.count} RTA (code_postal fsa3) from ${FSA_KEY}`);
    } catch (e) {
      console.log(
        `WARN FSA index load failed (${e instanceof Error ? e.message : String(e)}) — ` +
          `code_postal restera null (lancer fsa-boundaries-prep.ts d'abord)`,
      );
    }
  } else if (!args.verifyOnly) {
    console.log("FSA index: skipped (--no-fsa); code_postal restera null");
  }

  const started = Date.now();
  const summaries: EnrichStats[] = [];
  const skipped: Array<{ slug: string; reason: string }> = [];
  for (const slug of slugs) {
    const elapsedSec = (Date.now() - started) / 1000;
    if (!args.verifyOnly && elapsedSec > args.timeBoxSec) {
      skipped.push({ slug, reason: `time-box ${args.timeBoxSec}s exceeded (elapsed ${elapsedSec.toFixed(0)}s)` });
      console.log(`SKIP ${slug} time-box exceeded`);
      continue;
    }
    try {
      const stats = args.verifyOnly ? await verifyOnly(s3, slug) : await runCity(s3, slug, args, roleCtx, fsaIndex);
      summaries.push(stats);
      printSummary(stats);
    } catch (error) {
      if (error instanceof AddressRegressionGuardError) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      skipped.push({ slug, reason });
      console.log(`SKIP ${slug} ${reason}`);
    }
  }
  const failed = summaries.filter((s) => !s.verified_deposit?.exists);
  console.log(`DONE ok=${summaries.length} skipped=${skipped.length} failed_deposit=${failed.length}`);
  if (!args.all && !args.served && failed.length > 0) {
    throw new Error(`deposit verification failed for ${failed.map((s) => s.slug).join(", ")}`);
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
