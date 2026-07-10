/**
 * zone-grille-coherence-gate.ts -- read-only immo gate for served zoning vs
 * deposited norms grids.
 *
 * Decision rule: use strict exact canonical overlap only:
 *   |canon(codes_zone) intersection canon(codes_grille)| / |canon(codes_zone)|
 *
 * The numeric bridge is reported as a diagnostic only. It is deliberately not
 * used to decide real_zoning because it can hide a by-law vintage mismatch.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { S3Client } from "@aws-sdk/client-s3";

import { FOCUS_30_SLUGS } from "./focus30-status.js";
import { getBytes, s3Client } from "./lib/s3.js";
import { readParquetRowsFromBuffer } from "./lib/parquet-read.js";
import {
  canonZone,
  normsKey,
  overlapWithNumericBridge,
  resolveGridKey,
  sigZoneCodesFromGeojson,
} from "./lib/zonage-norms.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const MATRIX = join(ROOT, "work", "coverage", "coverage-matrix.json");
export const DEFAULT_REPORT = join(ROOT, "work", "coverage", "zone-grille-coherence.json");
const DEFAULT_THRESHOLD = 0.5;
const OLD_ZONING_RE = /ancien|former|abrog/i;
const AFFECTATION_MAX_CODES = 12;
const AFFECTATION_MIN_FRAC = 0.5;

export type CoherenceFlag =
  | "ok"
  | "millesime-mismatch"
  | "ancien-zonage"
  | "affectation"
  | "grille-absente"
  | "zonage-absent";

export interface Provenance {
  source_url: string | null;
  owner: string | null;
  layer: string | null;
  title: string | null;
}

export interface CoherenceAnalysis {
  flags: CoherenceFlag[];
  primary_flag: CoherenceFlag;
  real_zoning: boolean;
  codes_zone: string[];
  codes_grille: string[];
  communs: string[];
  recouvrement: number;
  recouvrement_strict: number;
  communs_bridged: string[];
  recouvrement_bridged: number;
  numeric_bridged: number;
  bridges: Array<{ grille: string; zone: string; number: string }>;
  affectation_reasons: string[];
  ancien_zonage: boolean;
}

export interface CoherenceRow extends CoherenceAnalysis, Provenance {
  slug: string;
  zone_key: string | null;
  grille_key: string | null;
  zone_features: number;
  threshold: number;
}

export interface GateReport {
  generated_at: string;
  threshold: number;
  decision_overlap: "strict-exact";
  bridge_overlap: "diagnostic-only";
  slugs: string[];
  summary: {
    total: number;
    ok: number;
    incoherentes: number;
    ancien_zonage: number;
    millesime_mismatch: number;
    affectation: number;
    grille_absente: number;
    zonage_absent: number;
  };
  rows: Record<string, CoherenceRow>;
}

interface Matrix {
  cities: Record<string, Record<string, { status?: string }>>;
}

interface ZoneRead {
  key: string | null;
  codes: Set<string>;
  provenance: Provenance;
  propertyKeys: Set<string>;
  featureCount: number;
}

interface GridRead {
  key: string | null;
  codes: Set<string>;
}

function arg(argv: string[], key: string): string | undefined {
  const i = argv.indexOf("--" + key);
  return i >= 0 ? argv[i + 1] : undefined;
}

function uniqueList(values: Iterable<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const v = raw.trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function canonicalSet(values: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const raw of values) {
    const v = canonZone(raw);
    if (v) out.add(v);
  }
  return out;
}

function round6(value: number): number {
  return Math.round(value * 1000000) / 1000000;
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function emptyProvenance(): Provenance {
  return { source_url: null, owner: null, layer: null, title: null };
}

function mergeProvenance(a: Provenance, b: Provenance): Provenance {
  return {
    source_url: a.source_url ?? b.source_url,
    owner: a.owner ?? b.owner,
    layer: a.layer ?? b.layer,
    title: a.title ?? b.title,
  };
}

function stringValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function collectProvenanceField(out: Provenance, key: string, value: unknown, allowGenericTitle: boolean): void {
  const v = stringValue(value);
  if (!v) return;
  const k = normalizedKey(key);
  if (
    !out.source_url &&
    (k === "source_url" ||
      k === "sourceurl" ||
      k === "source" ||
      k === "url" ||
      k === "layer_url" ||
      k === "layerurl" ||
      k === "zonagelayerurl" ||
      k === "zonage_layer_url" ||
      k === "arcgis_layer_url")
  ) {
    out.source_url = v;
  }
  if (!out.owner && (k === "owner" || k === "source_owner" || k === "sourceowner")) out.owner = v;
  if (
    !out.layer &&
    (k === "layer" ||
      k === "source_layer" ||
      k === "sourcelayer" ||
      k === "layer_name" ||
      k === "layername" ||
      k === "type_name" ||
      k === "typename")
  ) {
    out.layer = v;
  }
  if (
    !out.title &&
    (k === "title" ||
      k === "source_title" ||
      k === "sourcetitle" ||
      k === "layer_title" ||
      k === "layertitle" ||
      k === "service_title" ||
      k === "servicetitle" ||
      (allowGenericTitle && k === "name"))
  ) {
    out.title = v;
  }
}

function collectProvenanceFromUnknown(value: unknown, out: Provenance, depth: number, allowGenericTitle: boolean): void {
  if (depth > 5 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 25)) collectProvenanceFromUnknown(item, out, depth + 1, allowGenericTitle);
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    collectProvenanceField(out, key, nested, allowGenericTitle);
    if (nested && typeof nested === "object") collectProvenanceFromUnknown(nested, out, depth + 1, allowGenericTitle);
  }
}

function geojsonSidecarKeys(slug: string, zoneKey: string): string[] {
  const keys = [
    zoneKey.replace(/\.geojson$/u, ".stats.json"),
    "normalized/ca-qc-zonage/qc-zonage-" + slug + ".stats.json",
    "normalized/ca-qc-zonage/qc-zonage-" + slug + "/qc-zonage-" + slug + ".stats.json",
    "normalized/ca-qc-zonage/qc-zonage-" + slug + "/manifest.json",
  ];
  return uniqueList(keys);
}

async function getOrNull(s3: S3Client, key: string): Promise<Buffer | null> {
  try {
    return await getBytes(s3, key);
  } catch (e) {
    const err = e as { name?: string; Code?: string; code?: string; $metadata?: { httpStatusCode?: number } };
    const status = err.$metadata?.httpStatusCode;
    if (status === 404 || err.name === "NoSuchKey" || err.name === "NotFound" || err.Code === "NoSuchKey") {
      return null;
    }
    throw e;
  }
}

async function readSidecarProvenance(s3: S3Client, slug: string, zoneKey: string): Promise<Provenance> {
  let out = emptyProvenance();
  for (const key of geojsonSidecarKeys(slug, zoneKey)) {
    const buf = await getOrNull(s3, key);
    if (!buf) continue;
    try {
      const parsed = JSON.parse(buf.toString("utf8")) as unknown;
      const p = emptyProvenance();
      collectProvenanceFromUnknown(parsed, p, 0, true);
      out = mergeProvenance(out, p);
    } catch {
      continue;
    }
  }
  return out;
}

async function readZone(s3: S3Client, slug: string): Promise<ZoneRead> {
  const key = await resolveGridKey(s3, slug);
  if (!key) {
    return {
      key: null,
      codes: new Set<string>(),
      provenance: emptyProvenance(),
      propertyKeys: new Set<string>(),
      featureCount: 0,
    };
  }

  const body = (await getBytes(s3, key)).toString("utf8");
  const codes = sigZoneCodesFromGeojson(body);
  const propertyKeys = new Set<string>();
  let provenance = emptyProvenance();
  let featureCount = 0;

  try {
    const parsed = JSON.parse(body) as {
      metadata?: unknown;
      properties?: unknown;
      features?: Array<{ properties?: Record<string, unknown> | null }>;
    };
    const top = emptyProvenance();
    collectProvenanceFromUnknown(parsed.metadata, top, 0, true);
    collectProvenanceFromUnknown(parsed.properties, top, 0, true);
    collectProvenanceFromUnknown(parsed, top, 0, false);
    provenance = mergeProvenance(provenance, top);
    featureCount = parsed.features?.length ?? 0;
    for (const feature of parsed.features ?? []) {
      const props = feature.properties ?? {};
      for (const k of Object.keys(props)) propertyKeys.add(k);
      const p = emptyProvenance();
      collectProvenanceFromUnknown(props, p, 0, false);
      provenance = mergeProvenance(provenance, p);
    }
  } catch {
    featureCount = 0;
  }

  const sidecar = await readSidecarProvenance(s3, slug, key);
  provenance = mergeProvenance(provenance, sidecar);
  return { key, codes, provenance, propertyKeys, featureCount };
}

async function readGrid(s3: S3Client, slug: string): Promise<GridRead> {
  const key = normsKey(slug);
  const buf = await getOrNull(s3, key);
  if (!buf) return { key: null, codes: new Set<string>() };
  const rows = await readParquetRowsFromBuffer(buf, ["zone_code"]);
  const codes = new Set<string>();
  for (const row of rows) {
    const code = row["zone_code"];
    if (code !== null && code !== undefined && String(code).trim()) codes.add(canonZone(String(code)));
  }
  return { key, codes };
}

function oldZoning(provenance: Provenance): boolean {
  const hay = [provenance.source_url, provenance.owner, provenance.layer, provenance.title]
    .filter((v): v is string => !!v)
    .join(" ");
  return OLD_ZONING_RE.test(hay);
}

function fraction(count: number, total: number): number {
  return total > 0 ? count / total : 0;
}

function affectationReasons(zoneCodes: Set<string>, propertyKeys: Set<string>): string[] {
  const reasons: string[] = [];
  for (const k of propertyKeys) {
    if (/^(CODE_AFFEC|NOM_AFFECT)$/iu.test(k)) {
      reasons.push("field:" + k);
    }
  }
  const values = [...zoneCodes];
  const total = values.length;
  const alphaOnly = values.filter((c) => !/\d/u.test(c)).length;
  const coPrefix = values.filter((c) => /^CO(?:-|$)/u.test(c)).length;
  if (
    total > 0 &&
    total <= AFFECTATION_MAX_CODES &&
    (fraction(alphaOnly, total) >= AFFECTATION_MIN_FRAC || fraction(coPrefix, total) >= AFFECTATION_MIN_FRAC)
  ) {
    reasons.push("codes:co-or-alpha-majority");
  }
  return reasons;
}

function primaryFlag(flags: CoherenceFlag[]): CoherenceFlag {
  for (const f of ["zonage-absent", "grille-absente", "ancien-zonage", "affectation", "millesime-mismatch"] as const) {
    if (flags.includes(f)) return f;
  }
  return "ok";
}

export function analyzeZoneGridCoherence(input: {
  zoneCodes: Iterable<string>;
  gridCodes: Iterable<string>;
  provenance?: Partial<Provenance>;
  propertyKeys?: Iterable<string>;
  threshold?: number;
}): CoherenceAnalysis {
  const threshold = input.threshold ?? DEFAULT_THRESHOLD;
  const zone = canonicalSet(input.zoneCodes);
  const grid = canonicalSet(input.gridCodes);
  const exactCommon = new Set<string>();
  for (const c of zone) if (grid.has(c)) exactCommon.add(c);

  const bridge = overlapWithNumericBridge(grid, zone);
  const bridgedZoneCodes = new Set<string>(exactCommon);
  for (const b of bridge.bridges) bridgedZoneCodes.add(b.sig);

  const provenance: Provenance = {
    source_url: input.provenance?.source_url ?? null,
    owner: input.provenance?.owner ?? null,
    layer: input.provenance?.layer ?? null,
    title: input.provenance?.title ?? null,
  };
  const propKeys = new Set(input.propertyKeys ?? []);
  const ancien = oldZoning(provenance);
  const affectReasons = affectationReasons(zone, propKeys);

  const strictRecouvrement = zone.size ? exactCommon.size / zone.size : 0;
  const bridgedRecouvrement = zone.size ? bridgedZoneCodes.size / zone.size : 0;
  const flags: CoherenceFlag[] = [];
  if (zone.size === 0) flags.push("zonage-absent");
  if (grid.size === 0) flags.push("grille-absente");
  if (zone.size > 0 && grid.size > 0) {
    if (ancien) flags.push("ancien-zonage");
    if (affectReasons.length > 0) flags.push("affectation");
    if (strictRecouvrement < threshold) flags.push("millesime-mismatch");
  }
  if (flags.length === 0) flags.push("ok");

  const primary = primaryFlag(flags);
  return {
    flags,
    primary_flag: primary,
    real_zoning: primary === "ok",
    codes_zone: sorted(zone),
    codes_grille: sorted(grid),
    communs: sorted(exactCommon),
    recouvrement: round6(strictRecouvrement),
    recouvrement_strict: round6(strictRecouvrement),
    communs_bridged: sorted(bridgedZoneCodes),
    recouvrement_bridged: round6(bridgedRecouvrement),
    numeric_bridged: bridge.numericBridged,
    bridges: bridge.bridges.map((b) => ({ grille: b.extracted, zone: b.sig, number: b.number })),
    affectation_reasons: affectReasons,
    ancien_zonage: ancien,
  };
}

async function analyzeSlug(s3: S3Client, slug: string, threshold: number): Promise<CoherenceRow> {
  const [zone, grid] = await Promise.all([readZone(s3, slug), readGrid(s3, slug)]);
  const analysis = analyzeZoneGridCoherence({
    zoneCodes: zone.codes,
    gridCodes: grid.codes,
    provenance: zone.provenance,
    propertyKeys: zone.propertyKeys,
    threshold,
  });
  return {
    slug,
    zone_key: zone.key,
    grille_key: grid.key,
    zone_features: zone.featureCount,
    threshold,
    source_url: zone.provenance.source_url,
    owner: zone.provenance.owner,
    layer: zone.provenance.layer,
    title: zone.provenance.title,
    ...analysis,
  };
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      out[i] = await fn(items[i] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

function zonesDoneFromMatrix(): string[] {
  if (!existsSync(MATRIX)) throw new Error("coverage matrix missing: " + MATRIX);
  const matrix = JSON.parse(readFileSync(MATRIX, "utf8")) as Matrix;
  return Object.keys(matrix.cities)
    .filter((slug) => matrix.cities[slug]?.["zones"]?.status === "done")
    .sort((a, b) => a.localeCompare(b));
}

export function slugsFromArgs(argv: string[]): string[] {
  const requested = arg(argv, "slugs") ?? arg(argv, "slug");
  if (requested) return uniqueList(requested.split(","));
  if (argv.includes("--all")) return zonesDoneFromMatrix();
  return [...FOCUS_30_SLUGS];
}

export function buildGateReport(rows: CoherenceRow[], threshold: number): GateReport {
  const bySlug = Object.fromEntries(rows.map((row) => [row.slug, row]));
  const has = (flag: CoherenceFlag): number => rows.filter((r) => r.flags.includes(flag)).length;
  return {
    generated_at: new Date().toISOString(),
    threshold,
    decision_overlap: "strict-exact",
    bridge_overlap: "diagnostic-only",
    slugs: rows.map((r) => r.slug),
    summary: {
      total: rows.length,
      ok: has("ok"),
      incoherentes: rows.filter((r) => !r.real_zoning).length,
      ancien_zonage: has("ancien-zonage"),
      millesime_mismatch: has("millesime-mismatch"),
      affectation: has("affectation"),
      grille_absente: has("grille-absente"),
      zonage_absent: has("zonage-absent"),
    },
    rows: bySlug,
  };
}

export async function evaluateCoherenceSlugs(slugs: string[], threshold = DEFAULT_THRESHOLD): Promise<CoherenceRow[]> {
  const s3 = s3Client();
  const rows = await pool(uniqueList(slugs), 6, (slug) => analyzeSlug(s3, slug, threshold));
  return rows.sort((a, b) => a.slug.localeCompare(b.slug));
}

export function writeGateReport(report: GateReport, path = DEFAULT_REPORT): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2) + "\n", "utf8");
}

function pct(value: number): string {
  return (value * 100).toFixed(2) + "%";
}

export function printGateReport(report: GateReport): void {
  const rows = Object.values(report.rows).sort((a, b) => a.slug.localeCompare(b.slug));
  const incoherent = rows.filter((r) => !r.real_zoning && !r.flags.includes("zonage-absent") && !r.flags.includes("grille-absente"));
  const ancien = rows.filter((r) => r.flags.includes("ancien-zonage"));

  console.log("SERVIES MAIS INCOHÉRENTES");
  if (incoherent.length === 0) console.log("(aucune)");
  for (const row of incoherent) {
    console.log(
      "- " +
        row.slug +
        " strict=" +
        pct(row.recouvrement_strict) +
        " bridged=" +
        pct(row.recouvrement_bridged) +
        " flags=" +
        row.flags.join(","),
    );
  }

  console.log("SERVIES AVEC ANCIEN_ZONAGE");
  if (ancien.length === 0) console.log("(aucune)");
  for (const row of ancien) {
    const provenance = [row.source_url, row.owner, row.layer, row.title].filter((v): v is string => !!v).join(" | ");
    console.log("- " + row.slug + " strict=" + pct(row.recouvrement_strict) + " provenance=" + provenance);
  }
}

export async function runGateFromArgs(argv: string[]): Promise<GateReport> {
  const threshold = Number(arg(argv, "threshold") ?? String(DEFAULT_THRESHOLD));
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error("--threshold must be a number between 0 and 1");
  }
  const outPath = arg(argv, "out") ?? DEFAULT_REPORT;
  const slugs = slugsFromArgs(argv);
  const rows = await evaluateCoherenceSlugs(slugs, threshold);
  const report = buildGateReport(rows, threshold);
  writeGateReport(report, outPath);
  printGateReport(report);
  console.log("ECRIT " + outPath + " slugs=" + rows.length);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runGateFromArgs(process.argv.slice(2)).catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
