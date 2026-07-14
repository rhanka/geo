/**
 * Census the enrichment fields served on qc-zonage polygon collections.
 *
 * The census universe is the coverage-matrix zones-done set.  S3 is the only
 * source of field coverage: a missing collection is retained as an unserved
 * row so the cache and its track denominators remain honest.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { S3Client } from "@aws-sdk/client-s3";

import { MATRIX_PATH, loadMatrix } from "./coverage-matrix.js";
import { exists, getGeoJsonFeatureCollection, s3Client } from "./lib/s3.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
export const ZONAGE_ENRICHMENT_CACHE = join(ROOT, "work", "coverage", "zonage-enrichment.json");
const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";

export type EffetDensifiantCoverage = "real" | "scaffold" | "absent";

export interface ZonageEnrichmentMuniRow {
  readonly slug: string;
  readonly served: boolean;
  readonly reglement: boolean;
  readonly usage_dominant: boolean;
  readonly effet_densifiant: EffetDensifiantCoverage;
}

export interface ZonageEnrichmentFieldAgg {
  readonly key: "reglement" | "usage_dominant" | "effet_densifiant";
  readonly done: number;
  readonly total: number;
  readonly pct: number;
}

export interface ZonageEnrichmentSummary {
  readonly generatedAt: string;
  readonly zonesDoneUniverse: number;
  readonly servedMunis: number;
  readonly perMuni: readonly ZonageEnrichmentMuniRow[];
  readonly fields: readonly ZonageEnrichmentFieldAgg[];
}

interface FeatureLike {
  readonly properties?: Record<string, unknown> | null;
}

interface FeatureCoverage {
  readonly reglement: boolean;
  readonly usage_dominant: boolean;
  readonly effet_densifiant: EffetDensifiantCoverage;
}

export function zonageKeys(slug: string): readonly string[] {
  return [
    `${ZONAGE_PREFIX}qc-zonage-${slug}.geojson`,
    `${ZONAGE_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`,
  ];
}

async function readServedCollection(
  s3: S3Client,
  slug: string,
): Promise<FeatureLike[] | null> {
  for (const key of zonageKeys(slug)) {
    if (!(await exists(s3, key))) continue;
    const collection = await getGeoJsonFeatureCollection<FeatureLike>(s3, key);
    return collection.features;
  }
  return null;
}

function isNonEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  return typeof value === "string" ? value.trim().length > 0 : true;
}

function coverageOf(features: readonly FeatureLike[]): FeatureCoverage {
  let reglement = false;
  let usageDominant = false;
  let effectKey = false;
  let realEffect = false;
  let allEffectValuesInconnu = true;

  for (const feature of features) {
    const properties = feature.properties;
    if (!properties) {
      allEffectValuesInconnu = false;
      continue;
    }
    if (isNonEmpty(properties["reglement_numero"])) reglement = true;
    if (Object.prototype.hasOwnProperty.call(properties, "usage_dominant")) usageDominant = true;

    if (Object.prototype.hasOwnProperty.call(properties, "effet_densifiant")) {
      effectKey = true;
      const value = properties["effet_densifiant"];
      if (value === "densifie" || value === "reduit" || value === "stable") realEffect = true;
      if (value !== "inconnu") allEffectValuesInconnu = false;
    } else {
      allEffectValuesInconnu = false;
    }
  }

  const effetDensifiant: EffetDensifiantCoverage = realEffect
    ? "real"
    : effectKey && allEffectValuesInconnu
      ? "scaffold"
      : effectKey
        ? "scaffold"
        : "absent";

  return {
    reglement,
    usage_dominant: usageDominant,
    effet_densifiant: effetDensifiant,
  };
}

function pct(done: number, total: number): number {
  return total > 0 ? Math.round((10000 * done) / total) / 100 : 0;
}

function aggregate(
  rows: readonly ZonageEnrichmentMuniRow[],
  total: number,
): ZonageEnrichmentFieldAgg[] {
  const reglementDone = rows.filter((row) => row.reglement).length;
  const usageDominantDone = rows.filter((row) => row.usage_dominant).length;
  const effetDensifiantDone = rows.filter((row) => row.effet_densifiant === "real").length;
  return [
    {
      key: "reglement",
      done: reglementDone,
      total,
      pct: pct(reglementDone, total),
    },
    {
      key: "usage_dominant",
      done: usageDominantDone,
      total,
      pct: pct(usageDominantDone, total),
    },
    {
      key: "effet_densifiant",
      done: effetDensifiantDone,
      total,
      pct: pct(effetDensifiantDone, total),
    },
  ];
}

async function pool<T, R>(items: readonly T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      out[index] = await fn(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

export async function censusZonageEnrichment(opts: {
  readonly s3?: S3Client;
  readonly matrixPath?: string;
  readonly concurrency?: number;
} = {}): Promise<ZonageEnrichmentSummary> {
  const matrix = loadMatrix(opts.matrixPath ?? MATRIX_PATH);
  if (!matrix) throw new Error(`coverage matrix introuvable: ${opts.matrixPath ?? MATRIX_PATH}`);

  const universe = Object.keys(matrix.cities)
    .filter((slug) => matrix.cities[slug]?.zones?.status === "done")
    .sort();
  const s3 = opts.s3 ?? s3Client();
  const concurrency = Math.max(1, opts.concurrency ?? 12);
  const measurements = await pool(universe, concurrency, async (slug) => {
    const features = await readServedCollection(s3, slug);
    return {
      slug,
      served: features !== null,
      coverage: features === null
        ? { reglement: false, usage_dominant: false, effet_densifiant: "absent" as const }
        : coverageOf(features),
    };
  });

  const rows: ZonageEnrichmentMuniRow[] = measurements.map(({ slug, served, coverage }) => ({
    slug,
    served,
    ...coverage,
  }));
  const servedMunis = rows.filter((row) => row.served).length;
  return {
    generatedAt: new Date().toISOString(),
    zonesDoneUniverse: universe.length,
    servedMunis,
    perMuni: rows,
    fields: aggregate(rows, universe.length),
  };
}

function arg(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const brief = argv.includes("--brief");
  const concurrency = Number(arg(argv, "--concurrency") ?? "12");
  const summary = await censusZonageEnrichment({ concurrency });

  if (!brief) {
    mkdirSync(dirname(ZONAGE_ENRICHMENT_CACHE), { recursive: true });
    writeFileSync(ZONAGE_ENRICHMENT_CACHE, JSON.stringify(summary, null, 2) + "\n", "utf8");
    console.error(`[zonage-enrichment] cache → ${ZONAGE_ENRICHMENT_CACHE}`);
  }
  console.log(
    `zonage-enrichment: universe=${summary.zonesDoneUniverse} served=${summary.servedMunis}`,
  );
  for (const field of summary.fields) {
    console.log(`${field.key}: ${field.done}/${field.total} done (${field.pct}%)`);
  }
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exit(1);
  });
}
