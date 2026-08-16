/**
 * lot-zone-consistency-audit.ts — détecte les lots MAL ASSIGNÉS à une zone.
 *
 * Bug de consistance distinct de la surfragmentation (zone-contiguity-audit.ts) :
 * un lot de `qc-lots-<slug>` porte un `code_zone` (issu de registry/index-immo,
 * jointure amont no_lot→code_zone) qui NE CORRESPOND PAS au polygone `qc-zonage`
 * dans lequel le lot se trouve réellement. Constaté sur saint-stanislas : lot
 * 5 124 461 étiqueté AD-10 alors que sa géométrie est hors du polygone AD-10 servi.
 * Cause typique : la jointure lot→zone a été calculée contre une géométrie de zone
 * DIFFÉRENTE (millésime/contour antérieur) de celle servie aujourd'hui — p.ex. après
 * une rectification de `qc-zonage` sans re-fold des lots.
 *
 * MÉTHODE (déterministe, S3 réel, ZÉRO LLM, ZÉRO invention) :
 *   - charge les polygones de zone `qc-zonage-<slug>` : code_zone → [polygones].
 *   - charge les lots `qc-lots-<slug>` : no_lot, code_zone assigné, géométrie.
 *   - pour chaque lot : centroïde (shoelace) → test point-in-polygon (avec trous)
 *     contre le polygone du code_zone ASSIGNÉ.
 *       · dans le polygone assigné               → OK
 *       · hors, mais dans un AUTRE code servi     → MISASSIGNED (assigné=X, réel=Y)
 *       · hors de TOUTE zone servie               → OUTSIDE-ALL
 *       · lot sans code_zone                      → UNASSIGNED (ignoré du taux)
 *   - le centroïde est un proxy premier-ordre (un lot fin/long à cheval peut mentir) ;
 *     on rapporte donc des CANDIDATS, à confirmer, pas des verdicts (comme dispersed).
 *
 * SORTIE : work/coverage/lot-zone-consistency.json — par ville : taux de mismatch +
 * exemples (no_lot assigné→réel). Le rattachement WP8 = re-fold des lots contre la
 * géométrie servie (déterministe) là où le mismatch est structurel.
 *
 * Usage :
 *   npx tsx acquisition/src/lot-zone-consistency-audit.ts --slugs saint-stanislas-de-kostka --verbose
 *   npx tsx acquisition/src/lot-zone-consistency-audit.ts --all
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { exists, getBytes, parseFeatureCollectionBuffer, s3Client } from "./lib/s3.js";
import type { S3Client } from "@aws-sdk/client-s3";
import { pointToPolygonsBoundaryMeters } from "./lib/point-polygon-distance.js";
import { GEOMETRY_GRAIN_FIELD, type GeometryGrain } from "./lib/zonage-proof.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const REPORT = join(ROOT, "work", "coverage", "lot-zone-consistency.json");
const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";
const LOTS_PREFIX = "normalized/qc-lots/";

type Ring = number[][];
type Poly = Ring[]; // [outer, ...holes]

interface Feature {
  properties?: Record<string, unknown>;
  geometry?: { type?: string; coordinates?: unknown } | null;
}

/** Un anneau valide = ≥3 points [x,y] numériques. */
function isRing(r: unknown): r is Ring {
  return Array.isArray(r) && r.length >= 3 &&
    r.every((p) => Array.isArray(p) && p.length >= 2 && typeof p[0] === "number" && typeof p[1] === "number");
}

/** (Multi)Polygon → liste de polygones [outer, ...holes], anneaux malformés ignorés. */
function polygonsOf(geom: Feature["geometry"]): Poly[] {
  if (!geom || !Array.isArray(geom.coordinates)) return [];
  const out: Poly[] = [];
  if (geom.type === "Polygon") {
    const rings = (geom.coordinates as unknown[]).filter(isRing) as Ring[];
    if (rings.length) out.push(rings);
  } else if (geom.type === "MultiPolygon") {
    for (const poly of geom.coordinates as unknown[]) {
      if (!Array.isArray(poly)) continue;
      const rings = poly.filter(isRing) as Ring[];
      if (rings.length) out.push(rings);
    }
  }
  return out;
}

/** Aire signée (shoelace) d'un anneau. */
function signedArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[(i + 1) % n]!;
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Centroïde shoelace d'un anneau (robuste aux formes fines, contrairement à la moyenne). */
function ringCentroid(ring: Ring): [number, number] {
  let cx = 0, cy = 0, a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[(i + 1) % n]!;
    const cross = x1 * y2 - x2 * y1;
    a += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-12) {
    // dégénéré : moyenne simple
    let sx = 0, sy = 0;
    for (const [x, y] of ring) { sx += x; sy += y; }
    return [sx / ring.length, sy / ring.length];
  }
  return [cx / (6 * a), cy / (6 * a)];
}

/** Centroïde d'une géométrie de lot = centroïde de son plus GRAND anneau extérieur. */
function lotCentroid(geom: Feature["geometry"]): [number, number] | null {
  const polys = polygonsOf(geom);
  if (!polys.length) return null;
  let best: Ring | null = null, bestA = -1;
  for (const p of polys) {
    const outer = p[0]!;
    const area = Math.abs(signedArea(outer));
    if (area > bestA) { bestA = area; best = outer; }
  }
  return best ? ringCentroid(best) : null;
}

/** Ray-casting : point strictement dans un anneau. */
function inRing(pt: [number, number], ring: Ring): boolean {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const intersect = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Point dans un polygone = dans l'extérieur ET dans aucun trou. */
function inPolygon(pt: [number, number], poly: Poly): boolean {
  if (!inRing(pt, poly[0]!)) return false;
  for (let h = 1; h < poly.length; h++) if (inRing(pt, poly[h]!)) return false;
  return true;
}

function inCode(pt: [number, number], polys: Poly[] | undefined): boolean {
  if (!polys) return false;
  return polys.some((p) => inPolygon(pt, p));
}

function assignedCode(props: Record<string, unknown> | undefined): string | null {
  for (const k of ["code_zone", "zone_code", "ZONE", "zone"]) {
    const v = props?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/**
 * Index code_zone → polygones servis, IDENTIQUE à l'index interne d'`auditCity`
 * (mêmes clés via `assignedCode`, même `polygonsOf`). Construit UNE fois par ville.
 * Partagé avec le re-fold lot→zone (pass centroïde-hors-zone → UNKNOWN-recalage) :
 * réutiliser cet index garantit que le prédicat `outside_all` appliqué au dépôt est
 * exactement celui que l'audit-after recalcule sur le produit servi.
 */
export type ZonePolyIndex = Map<string, Poly[]>;

export function buildServedZoneIndex(
  zones: ReadonlyArray<{ properties?: Record<string, unknown> | null; geometry?: Feature["geometry"] }>,
): ZonePolyIndex {
  const index: ZonePolyIndex = new Map();
  for (const z of zones) {
    const code = assignedCode(z.properties ?? undefined);
    if (!code) continue;
    const polys = polygonsOf(z.geometry ?? null);
    if (!polys.length) continue;
    const arr = index.get(code) ?? [];
    arr.push(...polys);
    index.set(code, arr);
  }
  return index;
}

/**
 * Prédicat `outside_all` PARTAGÉ : vrai ssi le centroïde (shoelace du plus grand
 * anneau extérieur) du lot n'est contenu dans AUCUNE zone servie. C'est EXACTEMENT
 * le test qu'`auditCity` applique pour classer `outside_all` — le code assigné
 * d'abord (chemin rapide identique à l'audit), sinon TOUTE zone servie. Le re-fold
 * s'en sert pour nullifier `zone_code` (UNKNOWN-recalage) de sorte que l'audit-after
 * reflète UNKNOWN, jamais outside_all-assigné.
 *
 * Anti-invention : un lot sans centroïde exploitable renvoie `false` — on ne
 * FABRIQUE pas un « hors-zone » ; ce lot garde le sort que le join lui donne.
 */
export function lotCentroidOutsideAllServedZones(
  lotGeometry: Feature["geometry"],
  zoneIndex: ZonePolyIndex,
  assignedZoneCode: string | null,
): boolean {
  const c = lotCentroid(lotGeometry);
  if (!c) return false;
  if (assignedZoneCode !== null && inCode(c, zoneIndex.get(assignedZoneCode))) return false;
  for (const polys of zoneIndex.values()) if (inCode(c, polys)) return false;
  return true;
}

/**
 * SPEC_COL2_COHERENCE_AUDIT (ratifié, geo-jointures owner du dossier+spec ; geo-cond
 * → owner du chiffre) — bandes de cohérence lot↔zone par DISTANCE métrique du
 * centroïde du lot à sa zone ASSIGNÉE (indépendante ; on NE ré-assigne PAS).
 *
 *   d ≤ 10 m (COHERENCE_TOLERANCE_M)  → cohérent (absorbe le bruit CRS/bord/aire-majorité)
 *   d > 10 m                          → MISMATCH (numérateur col-2)
 *   d > 50 m (HARD_RESIDUE_M)         → résidu dur — SOUS-ENSEMBLE du mismatch,
 *                                       TOUJOURS affiché à côté (breakout), JAMAIS soustrait
 *
 * Q1 (jointures tranche) : le résidu >50 m COMPTE dans `mismatch` — l'EXCLURE le
 * masquerait (des erreurs dures paraîtraient cohérentes) = gaming. Il est reporté
 * EN PLUS comme `residue_hard`, jamais À LA PLACE.
 *   ⚠ Divergence de formulation signalée à geo-cond (qui présente le chiffre à
 *   l'owner) : geo-cond a écrit « résidu EXCLU du % » ; jointures, owner de la spec,
 *   tranche « INCLUS + breakout ». Les deux invoquent le même invariant anti-gaming
 *   « le chiffre ne peut jamais masquer le résidu » ; la lecture d'inclusion est la
 *   seule qui empêche réellement le masquage. Implémenté = jointures.
 *
 * Q2 (jointures) : sur grain servi `evaluation-unit` (UEV), un lot hors de TOUTE
 * zone (`outside_all`) → UNKNOWN : cohérence indéterminable (lot hors trame UEV),
 * exclu du numérateur ET du dénominateur — ni mismatch ni N-A. Grain absent ⇒
 * défaut `zone-polygon` (conservateur, anti-invention : jamais d'UNKNOWN fabriqué ;
 * `outside_all` reste alors un vrai mismatch).
 */
export const COHERENCE_TOLERANCE_M = 10;
export const HARD_RESIDUE_M = 50;

export type Col2Band = "coherent" | "mismatch" | "unknown_eval_unit";

export function classifyCol2(params: {
  insideAssigned: boolean;
  distanceToAssignedM: number; // mètres ; 0 si insideAssigned
  outsideAllServedZones: boolean;
  evaluationUnitGrain: boolean;
}): { band: Col2Band; residueHard: boolean } {
  const { insideAssigned, distanceToAssignedM, outsideAllServedZones, evaluationUnitGrain } = params;
  if (insideAssigned) return { band: "coherent", residueHard: false };
  // Grain UEV + hors de TOUTE zone : cohérence indéterminable → UNKNOWN (prioritaire
  // sur la tolérance : un lot hors trame UEV n'est pas « proche de sa zone », il est
  // hors grille — on ne fabrique pas de cohérence).
  if (outsideAllServedZones && evaluationUnitGrain) return { band: "unknown_eval_unit", residueHard: false };
  if (distanceToAssignedM <= COHERENCE_TOLERANCE_M) return { band: "coherent", residueHard: false };
  return { band: "mismatch", residueHard: distanceToAssignedM > HARD_RESIDUE_M };
}

/** Médiane (interpolée paire) d'une liste — null si vide. Diagnostic « distance des ratés ». */
function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const m = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return Math.round(m * 100) / 100;
}

/** Grain servi de la ville = grain des features zonage (uniforme par collection). */
function detectServedGrain(
  zones: ReadonlyArray<{ properties?: Record<string, unknown> | null }>,
): GeometryGrain | "absent" | "mixed" {
  const seen = new Set<string>();
  for (const z of zones) {
    const g = z.properties?.[GEOMETRY_GRAIN_FIELD];
    if (typeof g === "string" && g.trim()) seen.add(g.trim());
  }
  if (seen.size === 0) return "absent";
  if (seen.size === 1) return [...seen][0] as GeometryGrain;
  return "mixed";
}

interface Col2Example {
  no_lot: string;
  assigned: string;
  distance_m: number;
  band: "mismatch" | "residue_hard";
  actual: string[];
}

interface CityReport {
  slug: string;
  grain: GeometryGrain | "absent" | "mixed"; // grain servi détecté (geometry_grain)
  lots: number;
  assigned: number; // lot avec code_zone ET centroïde exploitable
  unassigned: number; // sans code / géométrie inexploitable — EXCLU
  unknown_eval_unit: number; // outside_all sur grain evaluation-unit — EXCLU du num ET dénom
  denom: number; // assigned - unknown_eval_unit
  coherent: number; // d ≤ 10 m
  mismatch: number; // d > 10 m (INCLUT residue_hard)
  residue_hard: number; // d > 50 m (SOUS-ENSEMBLE de mismatch, breakout)
  outside_all: number; // diagnostic géométrie-suspecte : lots EN MISMATCH hors de TOUTE zone servie (⊆ mismatch)
  mismatch_pct: number; // mismatch / denom  (résidu INCLUS — SPEC §4 anti-gaming)
  residue_hard_pct: number; // residue_hard / denom (breakout, toujours affiché)
  off_median_m: number | null; // médiane distance des lots NON strictement contenus (diagnostic)
  examples: Col2Example[];
  note?: string;
}

interface ScaleCityReport {
  slug: string;
  grain: GeometryGrain | "absent" | "mixed";
  lots: number;
  assigned: number;
  unassigned: number;
  unknown_eval_unit: number;
  denom: number;
  coherent: number;
  mismatch: number;
  residue_hard: number;
  outside_all: number;
  mismatch_pct: number | null;
  residue_hard_pct: number | null;
  off_median_m: number | null;
  status: "measured" | "inconclusive_zero_denom" | "not_measured";
  examples: Col2Example[];
}

interface ScaleReport {
  generatedAt: string;
  asOfS3Listing: string;
  method: Record<string, unknown>;
  universe: {
    portfolio_universe: number;
    zonage_served_slugs: number;
    lots_served_slugs: number;
    auditable_both_served: number;
    zonage_without_lots: number;
    zonage_without_lots_slugs: string[];
    lots_without_zonage: number;
    lots_without_zonage_slugs: string[];
    portfolio_without_zonage_or_lots: number;
  };
  coverage: {
    attempted: number;
    measured: number;
    conclusive: number;
    inconclusive_zero_assigned: number;
    not_measured: number;
    still_pending: number;
    pending_slugs: string[];
  };
  totals: {
    lots: number;
    assigned: number;
    unassigned: number;
    unknown_eval_unit: number;
    denom: number;
    coherent: number;
    mismatch: number;
    residue_hard: number;
    outside_all: number;
    weighted_mismatch_pct: number | null;
    weighted_residue_hard_pct: number | null;
    median_city_mismatch_pct: number | null;
    p90_city_mismatch_pct: number | null;
  };
  kpi_threshold_5pct: {
    rule: string;
    complete_under_5pct: number;
    incomplete_at_or_over_5pct: number;
    cities_with_hard_residue: number;
    inconclusive_zero_denom: number;
    not_measured: number;
    coverage_min_for_kpi: number;
    coverage_reached: number;
  };
  distribution: Array<{ band: string; cities: number; lots_assigned: number }>;
  top20_worst_pct: Array<ScaleRankRow>;
  top20_worst_pct_min200assigned: Array<ScaleRankRow>;
  top20_worst_volume: Array<Omit<ScaleRankRow, "examples">>;
  top20_worst_residue_hard: Array<Omit<ScaleRankRow, "examples">>;
  inconclusive_zero_denom_slugs: Array<{ slug: string; lots: number; unassigned: number; unknown_eval_unit: number }>;
  degenerate_small_denominator: Array<{ slug: string; mismatch_pct: number; denom: number; lots: number; unassigned: number }>;
  not_measured: Array<{ slug: string; error: string }>;
  cities: ScaleCityReport[];
}

interface ScaleRankRow {
  slug: string;
  grain: GeometryGrain | "absent" | "mixed";
  mismatch_pct: number;
  residue_hard_pct: number;
  denom: number;
  assigned: number;
  mismatch: number;
  residue_hard: number;
  outside_all: number;
  unknown_eval_unit: number;
  unassigned: number;
  lots: number;
  off_median_m: number | null;
  examples: Col2Example[];
}

async function loadFC(s3: S3Client, keys: string[]): Promise<Feature[] | null> {
  for (const k of keys) {
    if (!(await exists(s3, k))) continue;
    // Ne pas matérialiser le GeoJSON entier en string : Laval dépasse la limite
    // V8. Le parseur commun ne décode qu'une Feature à la fois.
    return parseFeatureCollectionBuffer<Feature>(await getBytes(s3, k), k).features;
  }
  return null;
}

async function auditCity(s3: S3Client, slug: string, exampleLimit: number): Promise<CityReport> {
  const base: CityReport = {
    slug, grain: "absent", lots: 0, assigned: 0, unassigned: 0, unknown_eval_unit: 0,
    denom: 0, coherent: 0, mismatch: 0, residue_hard: 0, outside_all: 0,
    mismatch_pct: 0, residue_hard_pct: 0, off_median_m: null, examples: [],
  };
  const [zones, lots] = await Promise.all([
    loadFC(s3, [
      `${ZONAGE_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`,
      `${ZONAGE_PREFIX}qc-zonage-${slug}.geojson`,
    ]),
    loadFC(s3, [
      `${LOTS_PREFIX}qc-lots-${slug}/qc-lots-${slug}.geojson`,
      `${LOTS_PREFIX}qc-lots-${slug}.geojson`,
    ]),
  ]);
  if (!zones) { base.note = "qc-zonage non servi"; return base; }
  if (!lots) { base.note = "qc-lots non servi"; return base; }

  const detected = detectServedGrain(zones);
  base.grain = detected;
  // Q2 : evaluation-unit → outside_all=UNKNOWN. Défaut conservateur pour absent/mixed
  // (jamais d'UNKNOWN fabriqué) : seul un grain UEV pur active la règle.
  const evaluationUnitGrain = detected === "evaluation-unit";

  const zoneIndex = new Map<string, Poly[]>();
  for (const z of zones) {
    const code = assignedCode(z.properties);
    if (!code) continue;
    const polys = polygonsOf(z.geometry);
    if (!polys.length) continue;
    const arr = zoneIndex.get(code) ?? [];
    arr.push(...polys);
    zoneIndex.set(code, arr);
  }

  const noLotOf = (p?: Record<string, unknown>): string => {
    for (const k of ["no_lot", "NO_LOT", "lot", "numero_lot"]) {
      const v = p?.[k];
      if (v !== null && v !== undefined && String(v).trim()) return String(v).trim();
    }
    return "?";
  };

  const offDistances: number[] = []; // distances des lots NON strictement contenus
  for (const lot of lots) {
    base.lots++;
    const code = assignedCode(lot.properties);
    if (!code) { base.unassigned++; continue; }
    const c = lotCentroid(lot.geometry);
    if (!c) { base.unassigned++; continue; }
    base.assigned++;
    const assignedPolys = zoneIndex.get(code);
    const insideAssigned = inCode(c, assignedPolys);
    let distance = 0;
    let outsideAll = false;
    const actual: string[] = [];
    if (!insideAssigned) {
      // distance métrique (ENU local) au bord de la zone ASSIGNÉE — jamais de ré-assignation
      distance = assignedPolys ? pointToPolygonsBoundaryMeters(c, assignedPolys) : Infinity;
      offDistances.push(Number.isFinite(distance) ? distance : HARD_RESIDUE_M + 1);
      // codes réels contenant le centroïde (diagnostic + outside_all)
      for (const [zc, polys] of zoneIndex) if (zc !== code && inCode(c, polys)) actual.push(zc);
      outsideAll = actual.length === 0;
    }
    const { band, residueHard } = classifyCol2({
      insideAssigned,
      distanceToAssignedM: distance,
      outsideAllServedZones: outsideAll,
      evaluationUnitGrain,
    });
    if (band === "coherent") { base.coherent++; continue; }
    if (band === "unknown_eval_unit") { base.unknown_eval_unit++; continue; }
    base.mismatch++;
    if (residueHard) base.residue_hard++;
    // `outside_all` = signal géométrie-suspecte : lot EN MISMATCH dont le centroïde
    // est hors de TOUTE zone servie (⊆ mismatch → ratio de la garde toujours ≤ 1).
    if (outsideAll) base.outside_all++;
    if (base.examples.length < exampleLimit) {
      base.examples.push({
        no_lot: noLotOf(lot.properties),
        assigned: code,
        distance_m: Number.isFinite(distance) ? Math.round(distance * 10) / 10 : -1,
        band: residueHard ? "residue_hard" : "mismatch",
        actual: actual.slice(0, 3),
      });
    }
  }
  base.denom = base.assigned - base.unknown_eval_unit;
  base.mismatch_pct = base.denom ? Math.round((base.mismatch / base.denom) * 10000) / 100 : 0;
  base.residue_hard_pct = base.denom ? Math.round((base.residue_hard / base.denom) * 10000) / 100 : 0;
  base.off_median_m = median(offDistances);
  return base;
}

function arg(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function servedLotSlugs(s3: S3Client): Promise<string[]> {
  const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
  const { BUCKET } = await import("./lib/s3.js");
  const have = new Set<string>();
  let token: string | undefined;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: LOTS_PREFIX, ContinuationToken: token, MaxKeys: 1000 }));
    for (const o of r.Contents ?? []) {
      const m = (o.Key ?? "").match(/qc-lots\/qc-lots-([^/]+)\.geojson$/) ?? (o.Key ?? "").match(/qc-lots\/qc-lots-([^/]+)\/qc-lots-/);
      if (m) have.add(m[1]!);
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return [...have].sort();
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function percentileNearestRank(values: readonly number[], percentile: number): number | null {
  if (!values.length) return null;
  const index = Math.ceil(values.length * percentile) - 1;
  return values[Math.max(0, Math.min(values.length - 1, index))] ?? null;
}

function scaleMethod(): Record<string, unknown> {
  return {
    spec: "SPEC_COL2_COHERENCE_AUDIT (ratifié ; owner dossier+spec = geo-jointures ; owner chiffre = geo-cond)",
    tool: "acquisition/src/lot-zone-consistency-audit.ts (auditCity, banding distance)",
    runner: "une municipalité à la fois, checkpoint JSON atomique après chaque ville (reprise idempotente)",
    metric: "distance MÈTRES du centroïde (shoelace du plus grand anneau du lot) au BORD de sa zone ASSIGNÉE — ENU local EPSG:4326→mètres (cos(lat)) ; on NE ré-assigne PAS (assignation aire-majorité servie inchangée) ; layout servi nested avant flat",
    bands: {
      coherent: `d ≤ ${COHERENCE_TOLERANCE_M} m (inclut strictement-contenu ; absorbe bruit CRS/bord/aire-majorité)`,
      mismatch: `d > ${COHERENCE_TOLERANCE_M} m — numérateur col-2`,
      residue_hard: `d > ${HARD_RESIDUE_M} m — SOUS-ENSEMBLE de mismatch, breakout TOUJOURS affiché, jamais soustrait (SPEC §4 anti-gaming)`,
      unknown_eval_unit: "grain servi evaluation-unit + outside_all → cohérence indéterminable — EXCLU du num ET dénom",
      unassigned: "lot sans code_zone (ou géométrie inexploitable) — EXCLU du dénominateur",
    },
    denominator: "mismatch_pct = mismatch / (assigned − unknown_eval_unit) ; residue_hard reporté EN PLUS",
    grain: "geometry_grain servi (zone-polygon | evaluation-unit | dissolved-zone) ; absent/mixed ⇒ défaut zone-polygon (jamais d'UNKNOWN fabriqué)",
    limits: [
      "le centroïde est un proxy premier ordre : un lot fin/long à cheval peut être compté à tort (candidats, pas verdicts)",
      "une ville dont denom=0 (tout unassigned/unknown_eval_unit) n'a PAS de mismatch calculable (classée 'non concluante', pas 0 %)",
      "aucune écriture S3, aucun dépôt : mesure en lecture seule de l'univers SERVI",
    ],
    io: "LECTURE SEULE (S3 GET/LIST). Aucun PUT, aucun fold, aucune donnée servie modifiée.",
  };
}

function scaleCity(city: CityReport): ScaleCityReport {
  const status = city.denom === 0 ? "inconclusive_zero_denom" : "measured";
  return {
    slug: city.slug,
    grain: city.grain,
    lots: city.lots,
    assigned: city.assigned,
    unassigned: city.unassigned,
    unknown_eval_unit: city.unknown_eval_unit,
    denom: city.denom,
    coherent: city.coherent,
    mismatch: city.mismatch,
    residue_hard: city.residue_hard,
    outside_all: city.outside_all,
    mismatch_pct: status === "measured" ? city.mismatch_pct : null,
    residue_hard_pct: status === "measured" ? city.residue_hard_pct : null,
    off_median_m: city.off_median_m,
    status,
    examples: city.examples,
  };
}

function notMeasuredCity(slug: string): ScaleCityReport {
  return {
    slug, grain: "absent", lots: 0, assigned: 0, unassigned: 0, unknown_eval_unit: 0,
    denom: 0, coherent: 0, mismatch: 0, residue_hard: 0, outside_all: 0,
    mismatch_pct: null, residue_hard_pct: null, off_median_m: null, status: "not_measured", examples: [],
  };
}

function compareCities(left: ScaleCityReport, right: ScaleCityReport): number {
  if (left.mismatch_pct === null && right.mismatch_pct === null) return left.slug.localeCompare(right.slug);
  if (left.mismatch_pct === null) return 1;
  if (right.mismatch_pct === null) return -1;
  return right.mismatch_pct - left.mismatch_pct || left.slug.localeCompare(right.slug);
}

function rankRow(city: ScaleCityReport): ScaleRankRow {
  if (city.mismatch_pct === null || city.residue_hard_pct === null) throw new Error(`${city.slug}: mismatch_pct absent du classement`);
  return {
    slug: city.slug,
    grain: city.grain,
    mismatch_pct: city.mismatch_pct,
    residue_hard_pct: city.residue_hard_pct,
    denom: city.denom,
    assigned: city.assigned,
    mismatch: city.mismatch,
    residue_hard: city.residue_hard,
    outside_all: city.outside_all,
    unknown_eval_unit: city.unknown_eval_unit,
    unassigned: city.unassigned,
    lots: city.lots,
    off_median_m: city.off_median_m,
    examples: city.examples,
  };
}

function worstPct(city: ScaleCityReport): ScaleRankRow {
  return rankRow(city);
}

function worstVolume(city: ScaleCityReport): Omit<ScaleRankRow, "examples"> {
  const { examples: _examples, ...rest } = rankRow(city);
  return rest;
}

function distribution(conclusive: readonly ScaleCityReport[]): ScaleReport["distribution"] {
  const bands: ScaleReport["distribution"] = [
    { band: "0 % (parfait)", cities: 0, lots_assigned: 0 },
    { band: "] 0 – 1 %]", cities: 0, lots_assigned: 0 },
    { band: "] 1 – 2 %]", cities: 0, lots_assigned: 0 },
    { band: "] 2 – 5 %[", cities: 0, lots_assigned: 0 },
    { band: "[5 – 10 %[", cities: 0, lots_assigned: 0 },
    { band: "[10 – 25 %[", cities: 0, lots_assigned: 0 },
    { band: "[25 – 50 %[", cities: 0, lots_assigned: 0 },
    { band: "[50 – 100 %]", cities: 0, lots_assigned: 0 },
  ];
  for (const city of conclusive) {
    const pct = city.mismatch_pct;
    if (pct === null) continue;
    const index = pct === 0 ? 0 : pct <= 1 ? 1 : pct <= 2 ? 2 : pct < 5 ? 3 : pct < 10 ? 4 : pct < 25 ? 5 : pct < 50 ? 6 : 7;
    const band = bands[index]!;
    band.cities++;
    band.lots_assigned += city.denom;
  }
  return bands;
}

function buildScaleReport(
  generatedAt: string,
  asOfS3Listing: string,
  universe: ScaleReport["universe"],
  auditable: readonly string[],
  cities: ReadonlyMap<string, ScaleCityReport>,
  errors: ReadonlyMap<string, string>,
): ScaleReport {
  const rows = [...cities.values()].sort(compareCities);
  const pending = auditable.filter((slug) => !cities.has(slug));
  const measured = rows.filter((city) => city.status !== "not_measured");
  const conclusive = rows.filter((city) => city.status === "measured");
  const inconclusive = rows.filter((city) => city.status === "inconclusive_zero_denom");
  const notMeasured = rows.filter((city) => city.status === "not_measured");
  const totals = measured.reduce((acc, city) => ({
    lots: acc.lots + city.lots,
    assigned: acc.assigned + city.assigned,
    unassigned: acc.unassigned + city.unassigned,
    unknown_eval_unit: acc.unknown_eval_unit + city.unknown_eval_unit,
    denom: acc.denom + city.denom,
    coherent: acc.coherent + city.coherent,
    mismatch: acc.mismatch + city.mismatch,
    residue_hard: acc.residue_hard + city.residue_hard,
    outside_all: acc.outside_all + city.outside_all,
  }), { lots: 0, assigned: 0, unassigned: 0, unknown_eval_unit: 0, denom: 0, coherent: 0, mismatch: 0, residue_hard: 0, outside_all: 0 });
  const pctValues = conclusive.map((city) => city.mismatch_pct!).sort((left, right) => left - right);
  const ranked = [...conclusive].sort(compareCities);
  const complete = conclusive.filter((city) => city.mismatch_pct! < 5);
  const incomplete = conclusive.filter((city) => city.mismatch_pct! >= 5);
  const withHardResidue = conclusive.filter((city) => city.residue_hard > 0);
  const listedErrors = notMeasured.map((city) => ({ slug: city.slug, error: errors.get(city.slug) ?? "erreur non documentée" })).sort((left, right) => left.slug.localeCompare(right.slug));
  return {
    generatedAt,
    asOfS3Listing,
    method: scaleMethod(),
    universe,
    coverage: {
      attempted: auditable.length,
      measured: measured.length,
      conclusive: conclusive.length,
      inconclusive_zero_assigned: inconclusive.length,
      not_measured: notMeasured.length,
      still_pending: pending.length,
      pending_slugs: pending,
    },
    totals: {
      ...totals,
      weighted_mismatch_pct: totals.denom ? rounded((totals.mismatch / totals.denom) * 100) : null,
      weighted_residue_hard_pct: totals.denom ? rounded((totals.residue_hard / totals.denom) * 100) : null,
      median_city_mismatch_pct: percentileNearestRank(pctValues, 0.5),
      p90_city_mismatch_pct: percentileNearestRank(pctValues, 0.9),
    },
    kpi_threshold_5pct: {
      rule: "ville complete ssi mismatch_pct < 5 % (mismatch = d>10m, résidu INCLUS) ; residue_hard reporté séparément (SPEC §4)",
      complete_under_5pct: complete.length,
      incomplete_at_or_over_5pct: incomplete.length,
      cities_with_hard_residue: withHardResidue.length,
      inconclusive_zero_denom: inconclusive.length,
      not_measured: notMeasured.length,
      coverage_min_for_kpi: 553,
      coverage_reached: measured.length,
    },
    distribution: distribution(conclusive),
    top20_worst_pct: ranked.slice(0, 20).map(worstPct),
    top20_worst_pct_min200assigned: ranked.filter((city) => city.denom >= 200).slice(0, 20).map(worstPct),
    top20_worst_volume: [...conclusive]
      .sort((left, right) => right.mismatch - left.mismatch || left.slug.localeCompare(right.slug))
      .slice(0, 20)
      .map(worstVolume),
    top20_worst_residue_hard: [...conclusive]
      .sort((left, right) => right.residue_hard - left.residue_hard || left.slug.localeCompare(right.slug))
      .slice(0, 20)
      .map(worstVolume),
    inconclusive_zero_denom_slugs: inconclusive.map((city) => ({ slug: city.slug, lots: city.lots, unassigned: city.unassigned, unknown_eval_unit: city.unknown_eval_unit })),
    degenerate_small_denominator: conclusive.filter((city) => city.denom < 200 && city.mismatch_pct! >= 5)
      .map((city) => ({ slug: city.slug, mismatch_pct: city.mismatch_pct!, denom: city.denom, lots: city.lots, unassigned: city.unassigned })),
    not_measured: listedErrors,
    cities: rows,
  };
}

function writeAtomic(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp.${process.pid}`;
  writeFileSync(temporary, contents, "utf8");
  renameSync(temporary, path);
}

async function listServedProductSlugs(s3: S3Client, prefix: string, product: string): Promise<string[]> {
  const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
  const { BUCKET } = await import("./lib/s3.js");
  const slugs = new Set<string>();
  let token: string | undefined;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 }));
    for (const object of page.Contents ?? []) {
      const key = object.Key;
      if (!key?.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const flat = rest.match(new RegExp(`^${product}-([^/]+)\\.geojson$`));
      const nested = rest.match(new RegExp(`^${product}-([^/]+)/${product}-([^/]+)\\.geojson$`));
      if (flat) slugs.add(flat[1]!);
      else if (nested && nested[1] === nested[2]) slugs.add(nested[1]!);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return [...slugs].sort();
}

function portfolioSlugs(): string[] {
  const path = join(ROOT, "packages", "qc-sources", "src", "geo", "municipalities.qc.json");
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${path}: registre municipal invalide`);
  const slugs = parsed.map((row) => typeof row === "object" && row !== null && typeof (row as { slug?: unknown }).slug === "string"
    ? (row as { slug: string }).slug
    : null);
  if (slugs.some((slug) => !slug) || new Set(slugs).size !== 1106) throw new Error(`${path}: attendu 1106 slugs municipaux uniques`);
  return slugs as string[];
}

function loadScaleResume(path: string): ScaleReport | null {
  if (!existsSync(path)) return null;
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!parsed || typeof parsed !== "object") throw new Error(`checkpoint scale invalide: ${path}`);
  const report = parsed as Partial<ScaleReport>;
  if (!report.universe || !report.coverage || !Array.isArray(report.cities) || !Array.isArray(report.coverage.pending_slugs)) {
    throw new Error(`checkpoint scale incompatible: ${path}`);
  }
  return report as ScaleReport;
}

async function scaleMain(argv: readonly string[]): Promise<void> {
  const maxSeconds = Number(arg(argv, "max-seconds"));
  if (!Number.isFinite(maxSeconds) || maxSeconds <= 0) throw new Error("--scale exige --max-seconds N positif");
  const output = resolve(ROOT, arg(argv, "out") ?? `work/coverage/lot-zone-consistency-scale-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}.json`);
  const resumed = loadScaleResume(output);
  const cities = new Map<string, ScaleCityReport>();
  const errors = new Map<string, string>();
  let universe: ScaleReport["universe"];
  let auditable: string[];
  let asOfS3Listing: string;
  if (resumed) {
    universe = resumed.universe;
    asOfS3Listing = resumed.asOfS3Listing;
    for (const city of resumed.cities) cities.set(city.slug, city);
    for (const error of resumed.not_measured) errors.set(error.slug, error.error);
    auditable = [...new Set([...resumed.cities.map((city) => city.slug), ...resumed.coverage.pending_slugs])].sort();
    if (auditable.length !== universe.auditable_both_served) throw new Error("checkpoint scale: partition auditable incohérente");
  } else {
    const s3 = s3Client();
    const portfolio = new Set(portfolioSlugs());
    const zonage = (await listServedProductSlugs(s3, ZONAGE_PREFIX, "qc-zonage")).filter((slug) => portfolio.has(slug));
    const lots = (await listServedProductSlugs(s3, LOTS_PREFIX, "qc-lots")).filter((slug) => portfolio.has(slug));
    const zonageSet = new Set(zonage);
    const lotsSet = new Set(lots);
    auditable = zonage.filter((slug) => lotsSet.has(slug));
    const zonageWithoutLots = zonage.filter((slug) => !lotsSet.has(slug));
    const lotsWithoutZonage = lots.filter((slug) => !zonageSet.has(slug));
    universe = {
      portfolio_universe: portfolio.size,
      zonage_served_slugs: zonage.length,
      lots_served_slugs: lots.length,
      auditable_both_served: auditable.length,
      zonage_without_lots: zonageWithoutLots.length,
      zonage_without_lots_slugs: zonageWithoutLots,
      lots_without_zonage: lotsWithoutZonage.length,
      lots_without_zonage_slugs: lotsWithoutZonage,
      portfolio_without_zonage_or_lots: [...portfolio].filter((slug) => !zonageSet.has(slug) && !lotsSet.has(slug)).length,
    };
    asOfS3Listing = new Date().toISOString();
  }
  const persist = (): void => {
    const report = buildScaleReport(new Date().toISOString(), asOfS3Listing, universe, auditable, cities, errors);
    writeAtomic(output, `${JSON.stringify(report, null, 2)}\n`);
  };
  persist();
  const deadline = Date.now() + maxSeconds * 1000;
  const s3 = s3Client();
  for (const slug of auditable) {
    if (cities.get(slug)?.status !== "not_measured" && cities.has(slug)) continue;
    if (Date.now() >= deadline) break;
    try {
      cities.set(slug, scaleCity(await auditCity(s3, slug, 8)));
      errors.delete(slug);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      cities.set(slug, notMeasuredCity(slug));
      errors.set(slug, message);
    }
    persist();
  }
  const report = buildScaleReport(new Date().toISOString(), asOfS3Listing, universe, auditable, cities, errors);
  console.log(`lot-zone-consistency scale: measured=${report.coverage.measured}/${report.coverage.attempted} pending=${report.coverage.still_pending} -> ${output}`);
}

async function main(argv: readonly string[]): Promise<void> {
  if (argv.includes("--scale")) {
    await scaleMain(argv);
    return;
  }
  const verbose = argv.includes("--verbose");
  const exampleLimit = Number(arg(argv, "examples") ?? "8");
  const only = arg(argv, "slugs")?.split(",").map((s) => s.trim()).filter(Boolean);
  const s3 = s3Client();
  const slugs = only && only.length ? only : await servedLotSlugs(s3);

  const reports: CityReport[] = [];
  let flagged = 0, clean = 0, missing = 0;
  for (const slug of slugs) {
    let r: CityReport;
    try {
      r = await auditCity(s3, slug, exampleLimit);
    } catch (e) {
      reports.push({ slug, grain: "absent", lots: 0, assigned: 0, unassigned: 0, unknown_eval_unit: 0, denom: 0, coherent: 0, mismatch: 0, residue_hard: 0, outside_all: 0, mismatch_pct: 0, residue_hard_pct: 0, off_median_m: null, examples: [], note: `err: ${e instanceof Error ? e.message : String(e)}` });
      continue;
    }
    reports.push(r);
    if (r.note) missing++;
    else if (r.mismatch > 0) { flagged++; if (verbose) console.log(`FLAG ${slug} mismatch=${r.mismatch_pct}% (mismatch=${r.mismatch} résidu>50m=${r.residue_hard}/${r.denom}, grain=${r.grain}, médiane-ratés=${r.off_median_m}m) ex: ${r.examples.slice(0, 3).map((e) => `${e.no_lot}:${e.assigned}@${e.distance_m}m→${e.actual.join("|") || "∅"}`).join(", ")}`); }
    else clean++;
  }
  reports.sort((a, b) => b.mismatch_pct - a.mismatch_pct || a.slug.localeCompare(b.slug));
  const out = { generatedAt: "AUDIT", universe: slugs.length, flagged, clean, missing, cities: reports };
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`lot-zone-consistency: universe=${slugs.length} flagged=${flagged} clean=${clean} missing=${missing} -> ${REPORT}`);
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
}

export { auditCity, type CityReport };
