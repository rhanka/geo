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
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { exists, getBytes, s3Client } from "./lib/s3.js";
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

async function loadFC(s3: S3Client, keys: string[]): Promise<Feature[] | null> {
  for (const k of keys) {
    if (!(await exists(s3, k))) continue;
    const fc = JSON.parse((await getBytes(s3, k)).toString("utf8"));
    return (fc.features ?? []) as Feature[];
  }
  return null;
}

async function auditCity(s3: S3Client, slug: string, exampleLimit: number): Promise<CityReport> {
  const base: CityReport = {
    slug, lots: 0, assigned: 0, matched: 0, misassigned: 0, outside_all: 0,
    unassigned: 0, mismatch_pct: 0, examples: [],
  };
  const zones = await loadFC(s3, [
    `${ZONAGE_PREFIX}qc-zonage-${slug}.geojson`,
    `${ZONAGE_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`,
  ]);
  const lots = await loadFC(s3, [
    `${LOTS_PREFIX}qc-lots-${slug}.geojson`,
    `${LOTS_PREFIX}qc-lots-${slug}/qc-lots-${slug}.geojson`,
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

async function main(argv: readonly string[]): Promise<void> {
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
