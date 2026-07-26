/**
 * Read-only audit for a suspected qc-zonage re-acquisition enrichment loss.
 *
 * Compares the actual property-key contract of selected served collections with
 * a known non-reacquired reference, always preferring the sub-directory layout
 * because that is what geo-api serves when both layouts coexist. `--api` adds a
 * product readback; an API outage is reported per city and never mistaken for a
 * successful verification.
 *
 * Usage:
 *   npx tsx acquisition/src/reacquisition-enrichment-audit.ts \
 *     --reference sutton --slugs saint-frederic,saint-gervais
 *   npx tsx acquisition/src/reacquisition-enrichment-audit.ts \
 *     --reference sutton --slugs saint-frederic,saint-gervais --api
 */
import { pathToFileURL } from "node:url";

import type { S3Client } from "@aws-sdk/client-s3";
import {
  capturedFetch,
  capturedText,
  NODE_FETCH_DEFAULT_MAX_REDIRECTS,
  type CaptureRun,
} from "../../packages/qc-sources/src/capture/index.js";

import { exists, getBytes, s3Client } from "./lib/s3.js";
import { openCaptureRun } from "./lib/capture-s3.js";

const PREFIX = "normalized/ca-qc-zonage/";
const API = process.env["GEO_API"] ?? "https://api.geo.sent-tech.ca";

const BUSINESS_FIELDS = [
  "reglement_numero", "reglement_millesime", "reglement_page_source", "reglement_url",
  "hauteur_min_value", "hauteur_min_unit", "hauteur_max_value", "hauteur_max_unit",
  "densite_value", "densite_unit",
  "marge_avant_min_value", "marge_avant_min_unit", "marge_laterale_min_value", "marge_laterale_min_unit",
  "marge_arriere_min_value", "marge_arriere_min_unit", "facade_min_value", "facade_min_unit",
  "superficie_min_value", "superficie_min_unit",
  "usage_dominant", "usage_dominant_source",
  "densite_avant", "densite_avant_millesime", "densite_avant_reglement",
  "densite_apres", "densite_apres_millesime", "densite_apres_reglement",
  "effet_densifiant", "effet_densifiant_delta",
] as const;

type Props = Record<string, unknown>;
interface Feature { properties?: Props | null }
interface Snapshot {
  slug: string;
  key: string | null;
  features: number;
  propertyKeys: string[];
  businessPresent: string[];
  businessNonNull: Record<string, number>;
  api: { status: "not-requested" | "ok" | "error"; propertyKeys: string[]; error: string | null };
}

function arg(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function keys(slug: string): { flat: string; nested: string } {
  const flat = `${PREFIX}qc-zonage-${slug}.geojson`;
  return { flat, nested: `${PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson` };
}

function propertySummary(features: Feature[]): Pick<Snapshot, "propertyKeys" | "businessPresent" | "businessNonNull"> {
  const propertyKeys = new Set<string>();
  const businessNonNull: Record<string, number> = Object.fromEntries(BUSINESS_FIELDS.map((field) => [field, 0]));
  for (const feature of features) {
    const props = feature.properties ?? {};
    for (const key of Object.keys(props)) propertyKeys.add(key);
    for (const field of BUSINESS_FIELDS) {
      const value = props[field];
      if (value !== null && value !== undefined && value !== "") businessNonNull[field]++;
    }
  }
  const sorted = [...propertyKeys].sort();
  return {
    propertyKeys: sorted,
    businessPresent: BUSINESS_FIELDS.filter((field) => propertyKeys.has(field)),
    businessNonNull,
  };
}

async function apiReadback(slug: string, enabled: boolean, run: CaptureRun | null): Promise<Snapshot["api"]> {
  if (!enabled) return { status: "not-requested", propertyKeys: [], error: null };
  if (run === null) return { status: "error", propertyKeys: [], error: "Capture run missing for API readback" };
  try {
    // Capture cette lecture OGC pour prouver précisément un décalage cache/API (réponse horodatée + hashée).
    const response = await capturedFetch(`${API}/collections/qc-zonage-${slug}/items?limit=1`, {
      signal: AbortSignal.timeout(30_000),
    }, {
      run,
      lane: "zones",
      source: "geo-api-readback",
      slugs: [slug],
      timeoutMs: 30_000,
      maxRedirects: NODE_FETCH_DEFAULT_MAX_REDIRECTS,
    });
    if (!response.ok || response.bytes === null) {
      if (response.response !== null) return { status: "error", propertyKeys: [], error: `HTTP ${response.response.status}` };
      return { status: "error", propertyKeys: [], error: response.line.error ?? "request failed" };
    }
    const body = JSON.parse(capturedText(response)) as { features?: Feature[] };
    const props = body.features?.[0]?.properties ?? {};
    return { status: "ok", propertyKeys: Object.keys(props).sort(), error: null };
  } catch (error) {
    return { status: "error", propertyKeys: [], error: error instanceof Error ? error.message : String(error) };
  }
}

async function snapshot(s3: S3Client, slug: string, api: boolean, run: CaptureRun | null): Promise<Snapshot> {
  const candidate = keys(slug);
  // API resolution order: nested (if present), otherwise flat.
  const key = await exists(s3, candidate.nested)
    ? candidate.nested
    : await exists(s3, candidate.flat)
      ? candidate.flat
      : null;
  if (!key) {
    return {
      slug, key: null, features: 0, propertyKeys: [], businessPresent: [],
      businessNonNull: Object.fromEntries(BUSINESS_FIELDS.map((field) => [field, 0])),
      api: await apiReadback(slug, api, run),
    };
  }
  const collection = JSON.parse((await getBytes(s3, key)).toString("utf8")) as { features?: Feature[] };
  const features = collection.features ?? [];
  return { slug, key, features: features.length, ...propertySummary(features), api: await apiReadback(slug, api, run) };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const referenceSlug = arg(argv, "--reference");
  const slugs = (arg(argv, "--slugs") ?? "").split(",").map((slug) => slug.trim()).filter(Boolean);
  const api = argv.includes("--api");
  if (!referenceSlug || slugs.length === 0) throw new Error("usage: --reference <non-reacquired-slug> --slugs <a,b> [--api]");

  const s3 = s3Client();
  const run = api ? openCaptureRun({ lane: "zones" }) : null;
  const reference = await snapshot(s3, referenceSlug, api, run);
  if (!reference.key) throw new Error(`reference ${referenceSlug} has no served S3 collection`);
  const rows: Array<Snapshot & { missingComparedWithReference: string[]; missingBusinessComparedWithReference: string[]; apiMissingComparedWithS3: string[] }> = [];
  for (const slug of slugs) {
    const row = await snapshot(s3, slug, api, run);
    rows.push({
      ...row,
      missingComparedWithReference: reference.propertyKeys.filter((key) => !row.propertyKeys.includes(key)),
      missingBusinessComparedWithReference: reference.businessPresent.filter((key) => !row.businessPresent.includes(key)),
      apiMissingComparedWithS3: row.api.status === "ok" ? row.propertyKeys.filter((key) => !row.api.propertyKeys.includes(key)) : [],
    });
  }
  console.log(JSON.stringify({ reference, rows }, null, 2));
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main().catch((error: unknown) => { console.error(error instanceof Error ? error.stack : String(error)); process.exit(1); });
