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

interface CityReport {
  slug: string;
  lots: number;
  assigned: number;
  matched: number;
  misassigned: number;
  outside_all: number;
  unassigned: number;
  mismatch_pct: number; // (misassigned+outside_all)/assigned
  examples: Array<{ no_lot: string; assigned: string; actual: string[] }>;
  note?: string;
}

interface ScaleCityReport {
  slug: string;
  lots: number;
  assigned: number;
  matched: number;
  misassigned: number;
  outside_all: number;
  unassigned: number;
  mismatch_pct: number | null;
  status: "measured" | "inconclusive_zero_assigned" | "not_measured";
  examples: Array<{ no_lot: string; assigned: string; actual: string[] }>;
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
    matched: number;
    misassigned: number;
    outside_all: number;
    unassigned: number;
    weighted_mismatch_pct: number | null;
    median_city_mismatch_pct: number | null;
    p90_city_mismatch_pct: number | null;
  };
  kpi_threshold_5pct: {
    rule: string;
    complete_under_5pct: number;
    incomplete_at_or_over_5pct: number;
    inconclusive_zero_assigned: number;
    not_measured: number;
    coverage_min_for_kpi: number;
    coverage_reached: number;
  };
  distribution: Array<{ band: string; cities: number; lots_assigned: number }>;
  top20_worst_pct: Array<{ slug: string; mismatch_pct: number; assigned: number; misassigned: number; outside_all: number; unassigned: number; lots: number; examples: ScaleCityReport["examples"] }>;
  top20_worst_pct_min200assigned: Array<{ slug: string; mismatch_pct: number; assigned: number; misassigned: number; outside_all: number; unassigned: number; lots: number; examples: ScaleCityReport["examples"] }>;
  top20_worst_volume: Array<{ slug: string; mismatch_pct: number; assigned: number; misassigned: number; outside_all: number; unassigned: number; lots: number }>;
  inconclusive_zero_assigned_slugs: Array<{ slug: string; lots: number; unassigned: number }>;
  degenerate_small_denominator: Array<{ slug: string; mismatch_pct: number; assigned: number; lots: number; unassigned: number }>;
  not_measured: Array<{ slug: string; error: string }>;
  cities: ScaleCityReport[];
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
    slug, lots: 0, assigned: 0, matched: 0, misassigned: 0, outside_all: 0,
    unassigned: 0, mismatch_pct: 0, examples: [],
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

  for (const lot of lots) {
    base.lots++;
    const code = assignedCode(lot.properties);
    if (!code) { base.unassigned++; continue; }
    base.assigned++;
    const c = lotCentroid(lot.geometry);
    if (!c) { base.unassigned++; base.assigned--; continue; }
    if (inCode(c, zoneIndex.get(code))) { base.matched++; continue; }
    // hors du code assigné → cherche le(s) code(s) réel(s)
    const actual: string[] = [];
    for (const [zc, polys] of zoneIndex) if (zc !== code && inCode(c, polys)) actual.push(zc);
    if (actual.length) {
      base.misassigned++;
      if (base.examples.length < exampleLimit) base.examples.push({ no_lot: noLotOf(lot.properties), assigned: code, actual: actual.slice(0, 3) });
    } else {
      base.outside_all++;
      if (base.examples.length < exampleLimit) base.examples.push({ no_lot: noLotOf(lot.properties), assigned: code, actual: [] });
    }
  }
  base.mismatch_pct = base.assigned ? Math.round(((base.misassigned + base.outside_all) / base.assigned) * 10000) / 100 : 0;
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
    tool: "acquisition/src/lot-zone-consistency-audit.ts (auditCity, réutilisé tel quel)",
    runner: "une municipalité à la fois, checkpoint JSON atomique après chaque ville (reprise idempotente)",
    test: "centroïde shoelace du plus grand anneau du lot -> point-in-polygon (avec trous) contre les polygones du code_zone ASSIGNÉ; layout servi nested avant flat",
    classes: {
      matched: "centroïde dans un polygone du code assigné",
      misassigned: "centroïde hors du code assigné mais DANS un autre code servi",
      outside_all: "centroïde hors de TOUTE zone servie",
      unassigned: "lot sans code_zone (ou géométrie inexploitable) — EXCLU du dénominateur",
    },
    denominator: "mismatch_pct = (misassigned + outside_all) / assigned",
    limits: [
      "le centroïde est un proxy premier ordre : un lot fin/long à cheval sur deux zones peut être compté à tort (candidats, pas verdicts)",
      "une ville dont TOUS les lots sont unassigned a assigned=0 : le mismatch n'est PAS calculable (classée 'non concluante', pas 0 %)",
      "aucune écriture S3, aucun dépôt : mesure en lecture seule de l'univers SERVI",
    ],
    io: "LECTURE SEULE (S3 GET/LIST). Aucun PUT, aucun fold, aucune donnée servie modifiée.",
  };
}

function scaleCity(city: CityReport): ScaleCityReport {
  const status = city.assigned === 0 ? "inconclusive_zero_assigned" : "measured";
  return {
    slug: city.slug,
    lots: city.lots,
    assigned: city.assigned,
    matched: city.matched,
    misassigned: city.misassigned,
    outside_all: city.outside_all,
    unassigned: city.unassigned,
    mismatch_pct: status === "measured" ? city.mismatch_pct : null,
    status,
    examples: city.examples,
  };
}

function notMeasuredCity(slug: string): ScaleCityReport {
  return {
    slug, lots: 0, assigned: 0, matched: 0, misassigned: 0, outside_all: 0,
    unassigned: 0, mismatch_pct: null, status: "not_measured", examples: [],
  };
}

function compareCities(left: ScaleCityReport, right: ScaleCityReport): number {
  if (left.mismatch_pct === null && right.mismatch_pct === null) return left.slug.localeCompare(right.slug);
  if (left.mismatch_pct === null) return 1;
  if (right.mismatch_pct === null) return -1;
  return right.mismatch_pct - left.mismatch_pct || left.slug.localeCompare(right.slug);
}

function worstPct(city: ScaleCityReport): ScaleReport["top20_worst_pct"][number] {
  if (city.mismatch_pct === null) throw new Error(`${city.slug}: mismatch_pct absent du classement`);
  return {
    slug: city.slug,
    mismatch_pct: city.mismatch_pct,
    assigned: city.assigned,
    misassigned: city.misassigned,
    outside_all: city.outside_all,
    unassigned: city.unassigned,
    lots: city.lots,
    examples: city.examples,
  };
}

function worstVolume(city: ScaleCityReport): ScaleReport["top20_worst_volume"][number] {
  if (city.mismatch_pct === null) throw new Error(`${city.slug}: mismatch_pct absent du classement`);
  return {
    slug: city.slug,
    mismatch_pct: city.mismatch_pct,
    assigned: city.assigned,
    misassigned: city.misassigned,
    outside_all: city.outside_all,
    unassigned: city.unassigned,
    lots: city.lots,
  };
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
    band.lots_assigned += city.assigned;
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
  const inconclusive = rows.filter((city) => city.status === "inconclusive_zero_assigned");
  const notMeasured = rows.filter((city) => city.status === "not_measured");
  const totals = measured.reduce((acc, city) => ({
    lots: acc.lots + city.lots,
    assigned: acc.assigned + city.assigned,
    matched: acc.matched + city.matched,
    misassigned: acc.misassigned + city.misassigned,
    outside_all: acc.outside_all + city.outside_all,
    unassigned: acc.unassigned + city.unassigned,
  }), { lots: 0, assigned: 0, matched: 0, misassigned: 0, outside_all: 0, unassigned: 0 });
  const pctValues = conclusive.map((city) => city.mismatch_pct!).sort((left, right) => left - right);
  const ranked = [...conclusive].sort(compareCities);
  const complete = conclusive.filter((city) => city.mismatch_pct! < 5);
  const incomplete = conclusive.filter((city) => city.mismatch_pct! >= 5);
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
      weighted_mismatch_pct: totals.assigned ? rounded(((totals.misassigned + totals.outside_all) / totals.assigned) * 100) : null,
      median_city_mismatch_pct: percentileNearestRank(pctValues, 0.5),
      p90_city_mismatch_pct: percentileNearestRank(pctValues, 0.9),
    },
    kpi_threshold_5pct: {
      rule: "ville complete ssi mismatch_pct < 5 % (SPEC_PORTFOLIO_REPORT.md)",
      complete_under_5pct: complete.length,
      incomplete_at_or_over_5pct: incomplete.length,
      inconclusive_zero_assigned: inconclusive.length,
      not_measured: notMeasured.length,
      coverage_min_for_kpi: 553,
      coverage_reached: measured.length,
    },
    distribution: distribution(conclusive),
    top20_worst_pct: ranked.slice(0, 20).map(worstPct),
    top20_worst_pct_min200assigned: ranked.filter((city) => city.assigned >= 200).slice(0, 20).map(worstPct),
    top20_worst_volume: [...conclusive]
      .sort((left, right) => (right.misassigned + right.outside_all) - (left.misassigned + left.outside_all) || left.slug.localeCompare(right.slug))
      .slice(0, 20)
      .map(worstVolume),
    inconclusive_zero_assigned_slugs: inconclusive.map((city) => ({ slug: city.slug, lots: city.lots, unassigned: city.unassigned })),
    degenerate_small_denominator: conclusive.filter((city) => city.assigned < 200 && city.mismatch_pct! >= 5)
      .map((city) => ({ slug: city.slug, mismatch_pct: city.mismatch_pct!, assigned: city.assigned, lots: city.lots, unassigned: city.unassigned })),
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
      reports.push({ slug, lots: 0, assigned: 0, matched: 0, misassigned: 0, outside_all: 0, unassigned: 0, mismatch_pct: 0, examples: [], note: `err: ${e instanceof Error ? e.message : String(e)}` });
      continue;
    }
    reports.push(r);
    if (r.note) missing++;
    else if (r.misassigned + r.outside_all > 0) { flagged++; if (verbose) console.log(`FLAG ${slug} mismatch=${r.mismatch_pct}% (misassigned=${r.misassigned} outside=${r.outside_all}/${r.assigned}) ex: ${r.examples.slice(0, 3).map((e) => `${e.no_lot}:${e.assigned}→${e.actual.join("|") || "∅"}`).join(", ")}`); }
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
// Helpers exposés pour la sonde de quantification A/B (col-2 centroïde vs
// aire-majorité) — même méthode EXACTE que le KPI, zéro divergence.
export { loadFC, polygonsOf, lotCentroid, inCode, assignedCode, type Poly, type Feature };
