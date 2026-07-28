/**
 * Read-only audit for the six density-residue collections carried by the
 * 2026-07-28 closure pass.  It reads the same S3 layouts used by geo-api and
 * never writes a served object, a parquet registry, or a capture.
 */
import { pathToFileURL } from "node:url";

import { extractNativeDocumentText } from "./lib/density-document-review.js";
import { readParquetRowsFromBuffer } from "./lib/parquet-read.js";
import { exists, getBytes, getGeoJsonFeatureCollection, s3Client } from "./lib/s3.js";
import { normsKey } from "./lib/zonage-norms.js";

const SLUGS = [
  "ham-sud",
  "lislet",
  "notre-dame-du-rosaire",
  "saint-amable",
  "saint-paul-de-montminy",
  "saint-robert-bellarmin",
] as const;

const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";
const SAINT_ROBERT_CAPTURE_KEY =
  "raw/normes-density-wayback-document/cas/6bf4bb872325b8d8c2414a7234c78e3032ff3af28ebcedf2593ff7f663299a38.pdf";

type Feature = { properties?: Record<string, unknown> | null };

function requireS3RunEnvironment(): void {
  if (!(process.env["NODE_OPTIONS"] ?? "").split(/\s+/).includes("--dns-result-order=ipv4first")) {
    throw new Error("run S3 refusé: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  }
  if (process.env["AWS_MAX_ATTEMPTS"] !== "10") {
    throw new Error("run S3 refusé: préfixer AWS_MAX_ATTEMPTS=10");
  }
}

function servedCandidates(slug: string): string[] {
  return [
    `${ZONAGE_PREFIX}qc-zonage-${slug}.geojson`,
    `${ZONAGE_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`,
  ];
}

function nonEmptyStrings(values: unknown[]): string[] {
  return values.filter((value): value is string => typeof value === "string" && value.trim() !== "");
}

async function auditSlug(s3: ReturnType<typeof s3Client>, slug: string): Promise<Record<string, unknown>> {
  const servedKey = (await Promise.all(servedCandidates(slug).map(async (key) => ({ key, present: await exists(s3, key) }))))
    .find((candidate) => candidate.present)?.key;
  if (servedKey === undefined) {
    return { slug, served_key: null, served_polygons: 0, error: "no-served-object" };
  }

  const collection = await getGeoJsonFeatureCollection<Feature>(s3, servedKey);
  const normsObjectKey = normsKey(slug);
  if (!(await exists(s3, normsObjectKey))) {
    return {
      slug,
      served_key: servedKey,
      served_polygons: collection.features.length,
      served_density_polygons: 0,
      norms_key: normsObjectKey,
      norms_present: false,
      error: "no-norms-object",
    };
  }
  const rows = await readParquetRowsFromBuffer(await getBytes(s3, normsObjectKey));
  const servedDensity = collection.features.filter((feature) => {
    const value = feature.properties?.["densite_value"];
    return typeof value === "number" && Number.isFinite(value);
  });
  const normativeDensity = rows.filter((row) => {
    const value = row["densite_value"];
    return typeof value === "number" && Number.isFinite(value);
  });
  const servedZoneCodes = nonEmptyStrings(collection.features.map((feature) => feature.properties?.["zone_code"]));
  const normativeZoneCodes = nonEmptyStrings(rows.map((row) => row["zone_code"]));

  return {
    slug,
    served_key: servedKey,
    served_polygons: collection.features.length,
    served_density_polygons: servedDensity.length,
    served_density_legal_dates: nonEmptyStrings(servedDensity.map((feature) => feature.properties?.["densite_legal_date"])),
    served_density_sources: nonEmptyStrings(servedDensity.map((feature) => feature.properties?.["densite_source_url"])),
    norms_key: normsObjectKey,
    norms_present: true,
    norms_rows: rows.length,
    norms_density_rows: normativeDensity.length,
    norms_density_legal_dates: nonEmptyStrings(normativeDensity.map((row) => row["densite_legal_date"])),
    norms_density_sources: nonEmptyStrings(normativeDensity.map((row) => row["densite_source_url"])),
    served_zone_codes: [...new Set(servedZoneCodes)].sort(),
    norms_zone_codes: [...new Set(normativeZoneCodes)].sort(),
  };
}

async function auditSaintRobertCapture(s3: ReturnType<typeof s3Client>): Promise<Record<string, unknown>> {
  if (!(await exists(s3, SAINT_ROBERT_CAPTURE_KEY))) {
    return { key: SAINT_ROBERT_CAPTURE_KEY, present: false };
  }
  const bytes = await getBytes(s3, SAINT_ROBERT_CAPTURE_KEY);
  const native = extractNativeDocumentText(bytes);
  const text = native.text ?? "";
  const compact = text.replace(/\s+/g, " ").trim();
  const signals = [
    "MUNICIPALITÉ DE SAINT-ROBERT BELLARMIN",
    "RÈGLEMENT N° 2009-08",
    "Adoption du règlement : 8 septembre 2009",
    "ENTRÉE EN VIGUEUR : 11 novembre 2009",
    "nombre de logements (max)",
  ];
  return {
    key: SAINT_ROBERT_CAPTURE_KEY,
    present: true,
    native_text: native.text !== null,
    blocker: native.blocker,
    bytes: bytes.length,
    signals_found: signals.filter((signal) => compact.includes(signal)),
    density_synonym_excerpts: [...compact.matchAll(/.{0,80}(?:nombre|logement|densit|occupation).{0,160}/gi)]
      .slice(0, 20)
      .map((match) => match[0]),
    excerpt: compact.match(/(?:Adoption du règlement|ENTRÉE EN VIGUEUR|nombre de logements \(max\))[^.]{0,180}/gi) ?? [],
  };
}

async function main(): Promise<void> {
  requireS3RunEnvironment();
  const s3 = s3Client();
  const collections: Record<string, unknown>[] = [];
  for (const slug of SLUGS) collections.push(await auditSlug(s3, slug));
  const report = {
    contract: "density-residue-six-audit/v1",
    scope: [...SLUGS],
    read_only: true,
    collections,
    saint_robert_capture: await auditSaintRobertCapture(s3),
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
