/**
 * Read-only audit of the density already served on the B' absent universe.
 *
 * This is deliberately a fact dump. It does not decide before/after and it
 * never writes a served object. The resulting report is the input to the
 * closed, human-reviewed classification of the missing side.
 *
 * Usage (repo root):
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *     npx tsx acquisition/src/_effet-densifiant-bprime-density-audit.ts \
 *     --diagnose /tmp/geo-effet-densifiant-bprime-s3-20260728.json \
 *     --out /tmp/geo-effet-densifiant-bprime-density-audit-20260728.json
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { exists, getGeoJsonFeatureCollection, s3Client } from "./lib/s3.js";

const PREFIX = "normalized/ca-qc-zonage/";
const NORMS_PREFIX = "normalized/qc-zonage-norms/";

interface DiagnosisRow {
  slug: string;
  key: string | null;
  state: string;
  primary_cause: string | null;
  features: number;
}

interface Diagnosis {
  rows?: DiagnosisRow[];
}

type Scalar = string | number | boolean | null;
type Properties = Record<string, unknown>;

interface Feature {
  properties?: Properties;
}

interface DensitySignature {
  value: Scalar;
  unit: Scalar;
  raw: Scalar;
  source_url: Scalar;
  source_sha256: Scalar;
  source_storage_key: Scalar;
  methode: Scalar;
  snapshot: Scalar;
  legal_date: Scalar;
  legal_date_evidence: Scalar;
  proof: Scalar;
  page_source: Scalar;
  feature_count: number;
  zone_codes: string[];
}

interface CurrentReglementSignature {
  numero: Scalar;
  millesime: Scalar;
  url: Scalar;
  feature_count: number;
}

interface NormSourceSignature {
  source_url: Scalar;
  snapshot: Scalar;
  methode: Scalar;
  reglement: Scalar;
  reglement_numero: Scalar;
  reglement_millesime: Scalar;
  reglement_url: Scalar;
  feature_count: number;
}

interface AuditRow {
  slug: string;
  key: string;
  polygons_served: number;
  density_polygons: number;
  density_polygons_with_legal_date: number;
  density_polygons_without_legal_date: number;
  density_source_urls: string[];
  project_markers: string[];
  density_signatures: DensitySignature[];
  current_reglement_signatures: CurrentReglementSignature[];
  norms_key: string | null;
  norms_polygons: number;
  norms_density_polygons: number;
  norms_density_signatures: DensitySignature[];
  norms_source_signatures: NormSourceSignature[];
}

interface AuditCheckpoint {
  contract?: string;
  target_count?: number;
  completed_count?: number;
  rows?: AuditRow[];
}

function arg(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index < 0 ? undefined : argv[index + 1];
}

function scalar(value: unknown): Scalar {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return value === undefined ? null : JSON.stringify(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function densityKey(properties: Properties): string {
  return JSON.stringify([
    properties["densite_value"] ?? null,
    properties["densite_unit"] ?? null,
    properties["densite_raw"] ?? null,
    properties["densite_source_url"] ?? null,
    properties["densite_source_sha256"] ?? null,
    properties["densite_source_storage_key"] ?? null,
    properties["densite_methode"] ?? null,
    properties["densite_snapshot"] ?? null,
    properties["densite_legal_date"] ?? null,
    properties["densite_legal_date_evidence"] ?? null,
    properties["densite_proof"] ?? null,
    properties["densite_page_source"] ?? null,
  ]);
}

function currentReglementKey(properties: Properties): string {
  return JSON.stringify([
    properties["reglement_numero"] ?? null,
    properties["reglement_millesime"] ?? null,
    properties["reglement_url"] ?? null,
  ]);
}

function selectedKeys(slug: string): string[] {
  return [
    `${PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`,
    `${PREFIX}qc-zonage-${slug}.geojson`,
  ];
}

function normsKey(slug: string): string {
  return `${NORMS_PREFIX}qc-zonage-norms-${slug}.geojson`;
}

async function selectKey(slug: string): Promise<string> {
  const s3 = s3Client();
  for (const key of selectedKeys(slug)) {
    if (await exists(s3, key)) return key;
  }
  throw new Error(`${slug}: served collection absent from both layouts`);
}

function audit(slug: string, key: string, features: readonly Feature[]): AuditRow {
  const density = new Map<string, DensitySignature>();
  const current = new Map<string, CurrentReglementSignature>();
  const sourceUrls = new Set<string>();
  const projectMarkers = new Set<string>();
  let densityPolygons = 0;
  let dated = 0;
  let undated = 0;

  for (const feature of features) {
    const properties = feature.properties ?? {};
    const value = properties["densite_value"];
    const hasDensity = typeof value === "number" && Number.isFinite(value);
    if (hasDensity) {
      densityPolygons++;
      const legalDate = properties["densite_legal_date"];
      if (nonEmptyString(legalDate)) dated++;
      else undated++;
      const sourceUrl = properties["densite_source_url"];
      if (nonEmptyString(sourceUrl)) sourceUrls.add(sourceUrl);
      for (const candidate of [
        properties["densite_raw"],
        properties["densite_proof"],
        properties["densite_legal_date_evidence"],
        sourceUrl,
      ]) {
        if (nonEmptyString(candidate) && /projet de règlement|projet de reglement/i.test(candidate)) {
          projectMarkers.add(candidate);
        }
      }
      const keyForDensity = densityKey(properties);
      const previous = density.get(keyForDensity);
      const zone = nonEmptyString(properties["zone_code"]) ? properties["zone_code"] : null;
      if (previous) {
        previous.feature_count++;
        if (zone && !previous.zone_codes.includes(zone)) previous.zone_codes.push(zone);
      } else {
        density.set(keyForDensity, {
          value: scalar(value),
          unit: scalar(properties["densite_unit"]),
          raw: scalar(properties["densite_raw"]),
          source_url: scalar(sourceUrl),
          source_sha256: scalar(properties["densite_source_sha256"]),
          source_storage_key: scalar(properties["densite_source_storage_key"]),
          methode: scalar(properties["densite_methode"]),
          snapshot: scalar(properties["densite_snapshot"]),
          legal_date: scalar(legalDate),
          legal_date_evidence: scalar(properties["densite_legal_date_evidence"]),
          proof: scalar(properties["densite_proof"]),
          page_source: scalar(properties["densite_page_source"]),
          feature_count: 1,
          zone_codes: zone ? [zone] : [],
        });
      }
    }

    const currentKey = currentReglementKey(properties);
    const previousCurrent = current.get(currentKey);
    if (previousCurrent) {
      previousCurrent.feature_count++;
    } else {
      current.set(currentKey, {
        numero: scalar(properties["reglement_numero"]),
        millesime: scalar(properties["reglement_millesime"]),
        url: scalar(properties["reglement_url"]),
        feature_count: 1,
      });
    }
  }

  return {
    slug,
    key,
    polygons_served: features.length,
    density_polygons: densityPolygons,
    density_polygons_with_legal_date: dated,
    density_polygons_without_legal_date: undated,
    density_source_urls: [...sourceUrls].sort(),
    project_markers: [...projectMarkers].sort(),
    density_signatures: [...density.values()].map((entry) => ({ ...entry, zone_codes: [...entry.zone_codes].sort() })),
    current_reglement_signatures: [...current.values()],
    norms_key: null,
    norms_polygons: 0,
    norms_density_polygons: 0,
    norms_density_signatures: [],
    norms_source_signatures: [],
  };
}

function auditNorms(features: readonly Feature[]): Pick<AuditRow, "norms_polygons" | "norms_density_polygons" | "norms_density_signatures" | "norms_source_signatures"> {
  const density = new Map<string, DensitySignature>();
  const sources = new Map<string, NormSourceSignature>();
  let densityPolygons = 0;
  for (const feature of features) {
    const properties = feature.properties ?? {};
    const value = properties["densite_value"];
    if (typeof value === "number" && Number.isFinite(value)) {
      densityPolygons++;
      const key = densityKey(properties);
      const zone = nonEmptyString(properties["zone_code"]) ? properties["zone_code"] : null;
      const previous = density.get(key);
      if (previous) {
        previous.feature_count++;
        if (zone && !previous.zone_codes.includes(zone)) previous.zone_codes.push(zone);
      } else {
        density.set(key, {
          value: scalar(value),
          unit: scalar(properties["densite_unit"]),
          raw: scalar(properties["densite_raw"]),
          source_url: scalar(properties["densite_source_url"]),
          source_sha256: scalar(properties["densite_source_sha256"]),
          source_storage_key: scalar(properties["densite_source_storage_key"]),
          methode: scalar(properties["densite_methode"]),
          snapshot: scalar(properties["densite_snapshot"]),
          legal_date: scalar(properties["densite_legal_date"]),
          legal_date_evidence: scalar(properties["densite_legal_date_evidence"]),
          proof: scalar(properties["densite_proof"]),
          page_source: scalar(properties["densite_page_source"]),
          feature_count: 1,
          zone_codes: zone ? [zone] : [],
        });
      }
    }
    const sourceKey = JSON.stringify([
      properties["_source_url"] ?? null,
      properties["_snapshot"] ?? null,
      properties["_methode"] ?? null,
      properties["_reglement"] ?? null,
      properties["reglement_numero"] ?? null,
      properties["reglement_millesime"] ?? null,
      properties["reglement_url"] ?? null,
    ]);
    const previousSource = sources.get(sourceKey);
    if (previousSource) {
      previousSource.feature_count++;
    } else {
      sources.set(sourceKey, {
        source_url: scalar(properties["_source_url"]),
        snapshot: scalar(properties["_snapshot"]),
        methode: scalar(properties["_methode"]),
        reglement: scalar(properties["_reglement"]),
        reglement_numero: scalar(properties["reglement_numero"]),
        reglement_millesime: scalar(properties["reglement_millesime"]),
        reglement_url: scalar(properties["reglement_url"]),
        feature_count: 1,
      });
    }
  }
  return {
    norms_polygons: features.length,
    norms_density_polygons: densityPolygons,
    norms_density_signatures: [...density.values()].map((entry) => ({ ...entry, zone_codes: [...entry.zone_codes].sort() })),
    norms_source_signatures: [...sources.values()],
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const diagnosePath = arg(argv, "--diagnose");
  const out = arg(argv, "--out");
  if (!diagnosePath || !out) throw new Error("required: --diagnose <json> --out <json>");
  if (!existsSync(diagnosePath)) throw new Error(`diagnostic absent: ${diagnosePath}`);
  const diagnosis = JSON.parse(readFileSync(diagnosePath, "utf8")) as Diagnosis;
  const targets = (diagnosis.rows ?? []).filter(
    (row) => row.key !== null && row.state === "absent" && row.primary_cause === "norms_present_one_density",
  );
  const previous = existsSync(out)
    ? (JSON.parse(readFileSync(out, "utf8")) as AuditCheckpoint).rows ?? []
    : [];
  const bySlug = new Map(previous.map((row) => [row.slug, row]));
  const pending = targets.filter((row) => !bySlug.has(row.slug));
  const maxRaw = arg(argv, "--max");
  const max = maxRaw === undefined ? pending.length : Number(maxRaw);
  if (!Number.isInteger(max) || max < 1) throw new Error(`invalid --max: ${maxRaw}`);
  const batch = pending.slice(0, max);
  for (const [index, row] of batch.entries()) {
    const key = await selectKey(row.slug);
    const s3 = s3Client();
    const collection = await getGeoJsonFeatureCollection<Feature>(s3, key);
    const result = audit(row.slug, key, collection.features);
    const servedNormsKey = normsKey(row.slug);
    if (await exists(s3, servedNormsKey)) {
      const norms = await getGeoJsonFeatureCollection<Feature>(s3, servedNormsKey);
      Object.assign(result, { norms_key: servedNormsKey, ...auditNorms(norms.features) });
    }
    bySlug.set(row.slug, result);
    const rows = [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
    writeFileSync(out, `${JSON.stringify({
      contract: "effet-densifiant-bprime-density-audit/v1",
      target_count: targets.length,
      completed_count: rows.length,
      rows,
    }, null, 2)}\n`);
    console.error(`[4a-bprime-density-audit] ${index + 1}/${targets.length} ${row.slug}`);
  }
  const rows = [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
  writeFileSync(out, `${JSON.stringify({
    contract: "effet-densifiant-bprime-density-audit/v1",
    target_count: targets.length,
    completed_count: rows.length,
    rows,
  }, null, 2)}\n`);
  console.log(JSON.stringify({ out, target_count: targets.length, completed_count: rows.length, read_this_batch: batch.length }));
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
