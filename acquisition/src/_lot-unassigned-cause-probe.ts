/**
 * _lot-unassigned-cause-probe.ts — sonde lecture seule de la cause spatiale
 * des lots sans `code_zone`.
 *
 * Le diagnostic est volontairement distinct d'un re-fold : il relit les lots
 * et le zonage effectivement servis, sans ecriture S3, puis partitionne les
 * lots non assignes selon le centroide shoelace employe par
 * lot-zone-consistency-audit.ts.
 *
 * Usage:
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *     npx tsx src/_lot-unassigned-cause-probe.ts --slugs chertsey --max-seconds 120
 *
 * La sortie par defaut est aussi le checkpoint : relancer exactement la meme
 * commande reprend au prochain lot non traite. `lots_traites` et
 * `unassigned_total` decrivent toujours ce qui a effectivement ete examine;
 * un resultat `partial` ne pretend jamais couvrir toute la ville.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { S3Client } from "@aws-sdk/client-s3";
import { getGeoJsonFeatureCollection, objectHead, s3Client } from "./lib/s3.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LOTS_PREFIX = "normalized/qc-lots/";
const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";
const CONTRACT = "lot-unassigned-cause-probe/2";
const CHECKPOINT_EVERY_LOTS = 500;
const DEFAULT_EXAMPLES = 6;

type Ring = number[][];
type Poly = Ring[];
type Bucket = "unassigned_inside_served" | "unassigned_outside_all" | "unassigned_no_geometry";
type Status = "complete" | "partial" | "unknown";
type ServedLayout = "nested" | "flat";

const BUCKETS: readonly Bucket[] = [
  "unassigned_inside_served",
  "unassigned_outside_all",
  "unassigned_no_geometry",
] as const;

interface Feature {
  properties?: Record<string, unknown> | null;
  geometry?: { type?: string; coordinates?: unknown } | null;
}

interface ZonePolygon {
  code_zone: string;
  poly: Poly;
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
}

interface ZoneIndex {
  cell_size: number;
  cells: Map<string, ZonePolygon[]>;
  global: ZonePolygon[];
}

interface Example {
  no_lot: string;
  /** All codes containing the centroid; no winner is fabricated on overlaps. */
  served_code_zones?: string[];
}

interface CityResult {
  slug: string;
  status: Status;
  lots_total: number | null;
  lots_traites: number;
  next_lot_index: number;
  unassigned_total: number;
  inside_served: number;
  outside_all: number;
  no_geometry: number;
  /** Parmi les lots sans code_zone effectivement traites, jamais extrapolee. */
  pct_foldable_sur_traites: number | null;
  examples: Record<Bucket, Example[]>;
  lots_key: string | null;
  zonage_key: string | null;
  /**
   * Layout effectivement lu : geo-api privilegie le nested quand les deux
   * existent. Le conserver rend la sonde comparable a la matrice P2.
   */
  served_layout_used?: { lots: ServedLayout | null; zonage: ServedLayout | null };
  note?: string;
}

interface Report {
  contract: typeof CONTRACT;
  as_of: string;
  args: { slugs: string[]; max_seconds: number; examples_per_bucket: number };
  cities: CityResult[];
}

interface Args {
  slugs: string[];
  maxSeconds: number;
  examples: number;
  output: string;
  shortMarkdown: boolean;
}

/** Un anneau valide = >=3 points [x,y] numeriques. Copie de l'audit existant. */
function isRing(value: unknown): value is Ring {
  return Array.isArray(value) && value.length >= 3 && value.every((point) =>
    Array.isArray(point) && point.length >= 2 && typeof point[0] === "number" && typeof point[1] === "number",
  );
}

/** (Multi)Polygon -> polygones [exterieur, ...trous]. Copie de l'audit existant. */
function polygonsOf(geometry: Feature["geometry"]): Poly[] {
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];
  const polygons: Poly[] = [];
  if (geometry.type === "Polygon") {
    const rings = (geometry.coordinates as unknown[]).filter(isRing) as Ring[];
    if (rings.length) polygons.push(rings);
  } else if (geometry.type === "MultiPolygon") {
    for (const value of geometry.coordinates as unknown[]) {
      if (!Array.isArray(value)) continue;
      const rings = value.filter(isRing) as Ring[];
      if (rings.length) polygons.push(rings);
    }
  }
  return polygons;
}

/** Aire signee shoelace, comme lot-zone-consistency-audit.ts. */
function signedArea(ring: Ring): number {
  let area = 0;
  for (let index = 0; index < ring.length; index++) {
    const [x1, y1] = ring[index]!;
    const [x2, y2] = ring[(index + 1) % ring.length]!;
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

function ringCentroid(ring: Ring): [number, number] {
  let cx = 0;
  let cy = 0;
  let area = 0;
  for (let index = 0; index < ring.length; index++) {
    const [x1, y1] = ring[index]!;
    const [x2, y2] = ring[(index + 1) % ring.length]!;
    const cross = x1 * y2 - x2 * y1;
    area += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-12) {
    let sx = 0;
    let sy = 0;
    for (const [x, y] of ring) { sx += x; sy += y; }
    return [sx / ring.length, sy / ring.length];
  }
  return [cx / (6 * area), cy / (6 * area)];
}

/** Centroide du plus grand anneau exterieur, meme regle que l'audit. */
function lotCentroid(geometry: Feature["geometry"]): [number, number] | null {
  const polygons = polygonsOf(geometry);
  let best: Ring | null = null;
  let bestArea = -1;
  for (const polygon of polygons) {
    const outer = polygon[0]!;
    const area = Math.abs(signedArea(outer));
    if (area > bestArea) { best = outer; bestArea = area; }
  }
  return best ? ringCentroid(best) : null;
}

/** Ray-casting strict et trous, copies de lot-zone-consistency-audit.ts. */
function inRing(point: [number, number], ring: Ring): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const intersects = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function inPolygon(point: [number, number], polygon: Poly): boolean {
  if (!inRing(point, polygon[0]!)) return false;
  for (let index = 1; index < polygon.length; index++) if (inRing(point, polygon[index]!)) return false;
  return true;
}

function nonBlankString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function codeZoneOf(properties: Record<string, unknown> | null | undefined): string | null {
  for (const key of ["code_zone", "zone_code", "ZONE", "zone"]) {
    const code = nonBlankString(properties?.[key]);
    if (code) return code;
  }
  return null;
}

function noLotOf(properties: Record<string, unknown> | null | undefined): string {
  for (const key of ["no_lot", "NO_LOT", "lot", "numero_lot"]) {
    const value = properties?.[key];
    if (value !== null && value !== undefined && String(value).trim()) return String(value).trim();
  }
  return "unknown";
}

function bboxOf(polygon: Poly): Omit<ZonePolygon, "code_zone" | "poly"> {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of polygon) for (const [x, y] of ring) {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return { min_x: minX, min_y: minY, max_x: maxX, max_y: maxY };
}

/**
 * All served polygons are considered. The bbox is only an exact negative
 * prefilter; it never turns an exterior point into an interior one.
 */
function cellKey(x: number, y: number): string {
  return `${x}:${y}`;
}

/**
 * Index uniforme exact : chaque polygone est placé dans toutes les cellules
 * touchées par sa bbox. Une cellule n'écarte donc jamais un polygone qui peut
 * contenir le point; elle évite seulement les tests PIP impossibles.
 */
function zoneIndexOf(zones: readonly ZonePolygon[]): ZoneIndex {
  const minX = Math.min(...zones.map((zone) => zone.min_x));
  const minY = Math.min(...zones.map((zone) => zone.min_y));
  const maxX = Math.max(...zones.map((zone) => zone.max_x));
  const maxY = Math.max(...zones.map((zone) => zone.max_y));
  const span = Math.max(maxX - minX, maxY - minY);
  const cellSize = Math.max(0.002, Math.min(0.05, span / 32));
  const cells = new Map<string, ZonePolygon[]>();
  const global: ZonePolygon[] = [];
  for (const zone of zones) {
    const fromX = Math.floor(zone.min_x / cellSize);
    const toX = Math.floor(zone.max_x / cellSize);
    const fromY = Math.floor(zone.min_y / cellSize);
    const toY = Math.floor(zone.max_y / cellSize);
    if ((toX - fromX + 1) * (toY - fromY + 1) > 64) {
      global.push(zone);
      continue;
    }
    for (let x = fromX; x <= toX; x++) for (let y = fromY; y <= toY; y++) {
      const key = cellKey(x, y);
      const bucket = cells.get(key) ?? [];
      bucket.push(zone);
      cells.set(key, bucket);
    }
  }
  return { cell_size: cellSize, cells, global };
}

function servedCodesAt(point: [number, number], index: ZoneIndex): string[] {
  const codes = new Set<string>();
  const x = Math.floor(point[0] / index.cell_size);
  const y = Math.floor(point[1] / index.cell_size);
  const candidates = index.cells.get(cellKey(x, y)) ?? [];
  for (const zone of candidates) {
    if (point[0] < zone.min_x || point[0] > zone.max_x || point[1] < zone.min_y || point[1] > zone.max_y) continue;
    if (inPolygon(point, zone.poly)) codes.add(zone.code_zone);
  }
  for (const zone of index.global) {
    if (point[0] < zone.min_x || point[0] > zone.max_x || point[1] < zone.min_y || point[1] > zone.max_y) continue;
    if (inPolygon(point, zone.poly)) codes.add(zone.code_zone);
  }
  return [...codes].sort((left, right) => left.localeCompare(right));
}

function emptyExamples(): Record<Bucket, Example[]> {
  return {
    unassigned_inside_served: [],
    unassigned_outside_all: [],
    unassigned_no_geometry: [],
  };
}

function emptyCity(
  slug: string,
  lots: ServedKey | null,
  zonage: ServedKey | null,
): CityResult {
  return {
    slug, status: "partial", lots_total: null, lots_traites: 0, next_lot_index: 0,
    unassigned_total: 0, inside_served: 0, outside_all: 0, no_geometry: 0,
    pct_foldable_sur_traites: null, examples: emptyExamples(),
    lots_key: lots?.key ?? null, zonage_key: zonage?.key ?? null,
    served_layout_used: { lots: lots?.layout ?? null, zonage: zonage?.layout ?? null },
  };
}

function updatePct(city: CityResult): void {
  city.pct_foldable_sur_traites = city.unassigned_total
    ? Math.round((city.inside_served / city.unassigned_total) * 10000) / 100
    : null;
}

function classify(city: CityResult, feature: Feature, zones: ZoneIndex, exampleLimit: number): void {
  city.unassigned_total++;
  const centroid = lotCentroid(feature.geometry);
  if (!centroid) {
    city.no_geometry++;
    if (city.examples.unassigned_no_geometry.length < exampleLimit) {
      city.examples.unassigned_no_geometry.push({ no_lot: noLotOf(feature.properties) });
    }
    return;
  }
  const codes = servedCodesAt(centroid, zones);
  if (codes.length) {
    city.inside_served++;
    if (city.examples.unassigned_inside_served.length < exampleLimit) {
      city.examples.unassigned_inside_served.push({ no_lot: noLotOf(feature.properties), served_code_zones: codes });
    }
    return;
  }
  city.outside_all++;
  if (city.examples.unassigned_outside_all.length < exampleLimit) {
    city.examples.unassigned_outside_all.push({ no_lot: noLotOf(feature.properties) });
  }
}

function parseArgs(argv: readonly string[]): Args {
  let slugs: string[] = [];
  let maxSeconds: number | null = null;
  let examples = DEFAULT_EXAMPLES;
  let output: string | null = null;
  let scaleReport: string | null = null;
  let shortMarkdown = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--slugs") slugs = String(argv[++index] ?? "").split(",").map((slug) => slug.trim()).filter(Boolean);
    else if (arg === "--scale-report") scaleReport = String(argv[++index] ?? "");
    else if (arg === "--max-seconds") maxSeconds = Number(argv[++index]);
    else if (arg === "--examples") examples = Number(argv[++index]);
    else if (arg === "--out") output = String(argv[++index] ?? "");
    else if (arg === "--short-markdown") shortMarkdown = true;
    else throw new Error(`argument inconnu: ${arg}`);
  }
  if (scaleReport) {
    if (slugs.length) throw new Error("--slugs et --scale-report sont exclusifs");
    const path = resolve(ROOT, scaleReport);
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object") throw new Error(`${path}: rapport scale invalide`);
    const report = parsed as { coverage?: { still_pending?: unknown }; cities?: unknown };
    if (report.coverage?.still_pending !== 0 || !Array.isArray(report.cities)) {
      throw new Error(`${path}: le rapport scale doit être FULL (still_pending=0)`);
    }
    slugs = report.cities.map((city) => typeof city === "object" && city !== null && typeof (city as { slug?: unknown }).slug === "string"
      ? (city as { slug: string }).slug
      : null).filter((slug): slug is string => slug !== null);
    if (!slugs.length || new Set(slugs).size !== slugs.length) throw new Error(`${path}: villes scale invalides ou dupliquées`);
  }
  if (!slugs.length) throw new Error("--slugs a,b,c est requis");
  if (!Number.isFinite(maxSeconds) || maxSeconds === null || maxSeconds <= 0) throw new Error("--max-seconds N positif est requis");
  if (!Number.isInteger(examples) || examples < 0) throw new Error("--examples doit etre un entier >= 0");
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return {
    slugs: [...new Set(slugs)], maxSeconds, examples,
    output: resolve(ROOT, output || `work/coverage/lot-unassigned-cause-${date}.json`),
    shortMarkdown,
  };
}

function markdownPath(jsonPath: string): string {
  return jsonPath.endsWith(".json") ? `${jsonPath.slice(0, -".json".length)}.md` : `${jsonPath}.md`;
}

function writeAtomic(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp.${process.pid}`;
  writeFileSync(temporary, contents, "utf8");
  renameSync(temporary, path);
}

function priority167Slugs(): Set<string> {
  const path = resolve(ROOT, "packages/qc-sources/src/geo/municipalities.qc.json");
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${path}: registre municipal invalide`);
  const slugs = parsed.flatMap((city) => typeof city === "object" && city !== null
    && typeof (city as { slug?: unknown }).slug === "string"
    && typeof (city as { priorityRank?: unknown }).priorityRank === "number"
    && (city as { priorityRank: number }).priorityRank <= 167
    ? [(city as { slug: string }).slug]
    : []);
  if (slugs.length !== 167 || new Set(slugs).size !== 167) throw new Error(`${path}: priorité 167 invalide`);
  return new Set(slugs);
}

function summaryRows(report: Report, scope: ReadonlySet<string>): { requested: number; complete: number; unassigned: number; inside: number; outside: number; noGeometry: number } {
  const requested = report.args.slugs.filter((slug) => scope.has(slug)).length;
  const complete = report.cities.filter((city) => city.status === "complete" && scope.has(city.slug));
  return {
    requested,
    complete: complete.length,
    unassigned: complete.reduce((total, city) => total + city.unassigned_total, 0),
    inside: complete.reduce((total, city) => total + city.inside_served, 0),
    outside: complete.reduce((total, city) => total + city.outside_all, 0),
    noGeometry: complete.reduce((total, city) => total + city.no_geometry, 0),
  };
}

function renderShortMarkdown(report: Report): string {
  const province = summaryRows(report, new Set(report.args.slugs));
  const priority167 = summaryRows(report, priority167Slugs());
  return [
    "# Annexe — preuve N-A des coverage gaps lot↔zone",
    "",
    "Lecture S3 seule. Un lot sans `code_zone` est **coverage-gap prouvé** seulement si son centroïde shoelace est hors de toute zone servie; `inside_served` reste une jointure à traiter et `no_geometry` n'est jamais crédité.",
    "",
    "| Ensemble | Villes complètes / demandées | Lots sans code examinés | Coverage-gap prouvé (hors zones) | Dans zone servie | Sans géométrie |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    `| Province auditable | ${province.complete} / ${province.requested} | ${province.unassigned} | ${province.outside} | ${province.inside} | ${province.noGeometry} |`,
    `| Priorité ≤ 167 (registre committé) | ${priority167.complete} / ${priority167.requested} | ${priority167.unassigned} | ${priority167.outside} | ${priority167.inside} | ${priority167.noGeometry} |`,
    "",
    "Les comptes ne couvrent que les villes terminées; aucune extrapolation aux villes partielles ou inconnues.",
    "",
  ].join("\n");
}

function renderMarkdown(report: Report, shortMarkdown: boolean): string {
  if (shortMarkdown) return renderShortMarkdown(report);
  const lines = [
    "# Sonde cause des lots sans code_zone",
    "",
    "Lecture S3 seule; classification par centroide shoelace et point-in-polygon du zonage effectivement servi (nested avant flat, layout conserve par ville).",
    "",
    "| Slug | Layout lots / zonage | Etat | Lots traites / total | Sans code | Dans zone servie | Hors toutes zones | Sans geometrie | % foldable |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const city of report.cities) {
    const layout = city.served_layout_used
      ? `${city.served_layout_used.lots ?? "unknown"} / ${city.served_layout_used.zonage ?? "unknown"}`
      : "unknown";
    lines.push(`| ${city.slug} | ${layout} | ${city.status} | ${city.lots_traites} / ${city.lots_total ?? "unknown"} | ${city.unassigned_total} | ${city.inside_served} | ${city.outside_all} | ${city.no_geometry} | ${city.pct_foldable_sur_traites === null ? "unknown" : `${city.pct_foldable_sur_traites}%`} |`);
    if (city.note) lines.push("", `- ${city.slug}: ${city.note}`);
  }
  return `${lines.join("\n")}\n`;
}

function writeReport(output: string, report: Report, shortMarkdown: boolean): void {
  writeAtomic(output, `${JSON.stringify(report, null, 2)}\n`);
  writeAtomic(markdownPath(output), renderMarkdown(report, shortMarkdown));
}

function loadResume(output: string, args: Args): Map<string, CityResult> {
  if (!existsSync(output)) return new Map();
  const prior = JSON.parse(readFileSync(output, "utf8")) as Partial<Report>;
  if (prior.contract !== CONTRACT || !prior.args || !Array.isArray(prior.cities)) {
    throw new Error(`checkpoint incompatible: ${output}`);
  }
  if (prior.args.examples_per_bucket !== args.examples) throw new Error("checkpoint: --examples different");
  const expected = args.slugs.join(",");
  if (prior.args.slugs.join(",") !== expected) throw new Error("checkpoint: --slugs different ou dans un autre ordre");
  return new Map(prior.cities.map((city) => [city.slug, city]));
}

interface ServedKey { key: string; layout: ServedLayout }

async function firstServedKey(s3: S3Client, prefix: string, collection: string): Promise<ServedKey | null> {
  // Ordre geo-api: le sous-dossier servi l'emporte sur son ombre plate.
  const keys: readonly ServedKey[] = [
    { key: `${prefix}${collection}/${collection}.geojson`, layout: "nested" },
    { key: `${prefix}${collection}.geojson`, layout: "flat" },
  ];
  for (const candidate of keys) if ((await objectHead(s3, candidate.key)).exists) return candidate;
  return null;
}

async function measureCity(
  s3: S3Client,
  slug: string,
  resumed: CityResult | undefined,
  args: Args,
  deadline: number,
  persist: (city: CityResult) => void,
): Promise<CityResult> {
  const [lots, zonage] = await Promise.all([
    firstServedKey(s3, LOTS_PREFIX, `qc-lots-${slug}`),
    firstServedKey(s3, ZONAGE_PREFIX, `qc-zonage-${slug}`),
  ]);
  if (!lots || !zonage) {
    const city = emptyCity(slug, lots, zonage);
    city.status = "unknown";
    city.note = !lots ? "qc-lots non servi" : "qc-zonage non servi";
    persist(city);
    return city;
  }
  if (resumed && (resumed.lots_key !== lots.key || resumed.zonage_key !== zonage.key)) {
    throw new Error(`${slug}: checkpoint ne correspond plus aux cles servies`);
  }
  if (resumed) resumed.served_layout_used = { lots: lots.layout, zonage: zonage.layout };
  if (resumed?.status === "complete") return resumed;
  const [lotsFc, zonesFc] = await Promise.all([
    getGeoJsonFeatureCollection<Feature>(s3, lots.key),
    getGeoJsonFeatureCollection<Feature>(s3, zonage.key),
  ]);
  const zones: ZonePolygon[] = [];
  for (const zone of zonesFc.features) {
    const code = codeZoneOf(zone.properties);
    if (!code) continue;
    for (const polygon of polygonsOf(zone.geometry)) zones.push({ code_zone: code, poly: polygon, ...bboxOf(polygon) });
  }
  if (!zones.length) {
    const city = emptyCity(slug, lots, zonage);
    city.lots_total = lotsFc.features.length;
    city.status = "unknown";
    city.note = "qc-zonage servi sans polygone a code_zone exploitable";
    persist(city);
    return city;
  }
  const zoneIndex = zoneIndexOf(zones);
  const city = resumed ? structuredClone(resumed) : emptyCity(slug, lots, zonage);
  city.lots_total = lotsFc.features.length;
  const start = city.next_lot_index;
  if (start < 0 || start > lotsFc.features.length || city.lots_traites !== start) throw new Error(`${slug}: checkpoint de lot invalide`);
  for (let index = start; index < lotsFc.features.length; index++) {
    const lot = lotsFc.features[index]!;
    if (!codeZoneOf(lot.properties)) classify(city, lot, zoneIndex, args.examples);
    city.lots_traites = index + 1;
    city.next_lot_index = index + 1;
    if (city.lots_traites % CHECKPOINT_EVERY_LOTS === 0) {
      updatePct(city);
      persist(city);
      if (Date.now() >= deadline) {
        city.status = "partial";
        persist(city);
        return city;
      }
    }
  }
  city.status = "complete";
  updatePct(city);
  persist(city);
  return city;
}

async function main(argv: readonly string[]): Promise<void> {
  const args = parseArgs(argv);
  const resumed = loadResume(args.output, args);
  const cities = new Map<string, CityResult>();
  for (const slug of args.slugs) {
    const previous = resumed.get(slug);
    if (previous) cities.set(slug, previous);
  }
  const report = (): Report => ({
    contract: CONTRACT,
    as_of: args.output.match(/(\d{8})\.json$/)?.[1] ?? "unknown",
    args: { slugs: args.slugs, max_seconds: args.maxSeconds, examples_per_bucket: args.examples },
    cities: args.slugs.map((slug) => cities.get(slug)).filter((city): city is CityResult => !!city),
  });
  const persist = (city: CityResult): void => { cities.set(city.slug, city); writeReport(args.output, report(), args.shortMarkdown); };
  const deadline = Date.now() + args.maxSeconds * 1000;
  const s3 = s3Client();
  for (const slug of args.slugs) {
    if (Date.now() >= deadline) break;
    const previous = resumed.get(slug);
    if (previous?.status === "unknown") continue;
    const city = await measureCity(s3, slug, previous, args, deadline, persist);
    cities.set(slug, city);
    if (city.status === "partial") break;
  }
  writeReport(args.output, report(), args.shortMarkdown);
  for (const city of report().cities) {
    console.log(`${city.slug} ${city.status} lots=${city.lots_traites}/${city.lots_total ?? "unknown"} unassigned=${city.unassigned_total} inside=${city.inside_served} outside=${city.outside_all} no_geometry=${city.no_geometry}`);
  }
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exit(1);
  });
}
