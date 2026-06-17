/**
 * A3 runner — acquire QC municipal zonage from verified ArcGIS REST endpoints
 * (paginated crawl) and write normalized WGS84 collections to a Store (S3).
 *
 * WHY a runner (not `geo fetch`): the CLI's `acquire()` only issues a *single*
 * `where=1=1` ArcGIS query (no pagination). Layers above `maxRecordCount` would
 * silently truncate. `crawlArcgisLayer` paginates to completion. This runner
 * wires that crawler to the same normalize + Store-write path the CLI uses, so
 * the emitted collections are byte-shape-identical to the CKAN ones and served
 * unchanged by the StoreProvider / OGC API.
 *
 * Endpoints are the radar-immobilier verified registry (3 cities, 2026-06-14):
 * Longueuil, Shawinigan, Sherbrooke — all FeatureServer/0, esriGeometryPolygon,
 * cc-by (municipal open data). Inputs are listed inline here (anti-invention:
 * only live-verified URLs), but the runner also ingests any NEW verified
 * endpoints A2 writes to the shared endpoints file.
 */

import { readFile } from "node:fs/promises";

import {
  WGS84,
  attributionLine,
  resolveManifestLicense,
  type AdminFeatureCollection,
  type CollectionMeta,
  type NormalizeContext,
  type NormalizedDataset,
  type SourceManifest,
} from "@sentropic/geo-core";
import {
  crawlArcgisLayer,
  geojsonPassthrough,
  sha256Hex,
  writeNormalizedToStore,
} from "@sentropic/geo/acquire";
import { createStore } from "@sentropic/geo/storage";

interface ArcgisZonageInput {
  /** OGC collection id / dataset id — must be unique across served collections. */
  readonly datasetId: string;
  /** Source manifest id (provenance). */
  readonly sourceId: string;
  /** Human title. */
  readonly title: string;
  /** Attribution provider name (the "© <provider>" subject). */
  readonly provider: string;
  /** FeatureServer/MapServer base URL (no trailing /N). */
  readonly serviceUrl: string;
  /** Layer index. */
  readonly layer: number;
}

/**
 * Verified seed endpoints (radar-immobilier ARCGIS_SERVICE_REGISTRY, 2026-06-14).
 * Distinct datasetIds (`-arcgis` suffix) so they never collide with the CKAN
 * zonage collections of the same cities.
 */
const SEED_INPUTS: readonly ArcgisZonageInput[] = [
  {
    datasetId: "qc-zonage-longueuil-arcgis",
    sourceId: "ca-qc/zonage-longueuil-arcgis",
    title: "Zonage — Longueuil (ArcGIS REST, crawl WGS84)",
    provider: "Ville de Longueuil",
    serviceUrl:
      "https://services2.arcgis.com/h4XWvDXfYYyD6jNu/arcgis/rest/services/DO_Zonage/FeatureServer",
    layer: 0,
  },
  {
    datasetId: "qc-zonage-shawinigan-arcgis",
    sourceId: "ca-qc/zonage-shawinigan-arcgis",
    title: "Zonage — Shawinigan (ArcGIS REST, crawl WGS84)",
    provider: "Ville de Shawinigan",
    serviceUrl:
      "https://cartes.shawinigan.ca/server/rest/services/Zonage_municipal/FeatureServer",
    layer: 0,
  },
  {
    datasetId: "qc-zonage-sherbrooke-arcgis",
    sourceId: "ca-qc/zonage-sherbrooke-arcgis",
    title: "Zonage — Sherbrooke (ArcGIS REST, crawl WGS84)",
    provider: "Ville de Sherbrooke",
    serviceUrl:
      "https://services3.arcgis.com/qsNXG7LzoUbR4c1C/arcgis/rest/services/Zonage/FeatureServer",
    layer: 0,
  },
];

/**
 * Map an A2 endpoints-file entry to an {@link ArcgisZonageInput}. A2 writes
 * `qc-arcgis-zonage-endpoints.json` as an array of objects; we accept the
 * radar registry shape (`citySlug`, `serviceUrl`) and ignore entries missing a
 * usable URL. `serviceUrl` may be a layer URL (`.../FeatureServer/0`) — split
 * the trailing `/N` into base + layer.
 */
function fromA2Entry(entry: Record<string, unknown>): ArcgisZonageInput | null {
  const citySlug = typeof entry["citySlug"] === "string" ? entry["citySlug"] : undefined;
  const rawUrl = typeof entry["serviceUrl"] === "string" ? entry["serviceUrl"] : undefined;
  if (!citySlug || !rawUrl) return null;
  const m = rawUrl.match(/^(.*\/(?:FeatureServer|MapServer))\/(\d+)\/?$/i);
  const serviceUrl = m ? m[1]! : rawUrl.replace(/\/$/, "");
  const layer = m ? Number(m[2]) : 0;
  const provider =
    typeof entry["provider"] === "string"
      ? (entry["provider"] as string)
      : `Ville de ${citySlug.charAt(0).toUpperCase()}${citySlug.slice(1)}`;
  return {
    datasetId: `qc-zonage-${citySlug}-arcgis`,
    sourceId: `ca-qc/zonage-${citySlug}-arcgis`,
    title: `Zonage — ${citySlug} (ArcGIS REST, crawl WGS84)`,
    provider,
    serviceUrl,
    layer,
  };
}

async function loadA2Inputs(path: string): Promise<ArcgisZonageInput[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return []; // A2 not written yet — fine.
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as Record<string, unknown>)?.["endpoints"])
      ? ((parsed as Record<string, unknown>)["endpoints"] as unknown[])
      : [];
  const out: ArcgisZonageInput[] = [];
  for (const e of list) {
    if (typeof e === "object" && e !== null) {
      const mapped = fromA2Entry(e as Record<string, unknown>);
      if (mapped) out.push(mapped);
    }
  }
  return out;
}

/** Build a minimal SourceManifest so the shared normalize/license helpers apply. */
function syntheticManifest(input: ArcgisZonageInput): SourceManifest {
  return {
    id: input.sourceId,
    title: input.title,
    description: `Acquis via crawlArcgisLayer depuis ${input.serviceUrl}/${input.layer}.`,
    kind: "administrative",
    jurisdiction: { country: "CA", subdivision: "CA-QC" },
    provider: { name: input.provider, url: input.serviceUrl },
    license: "cc-by-4.0",
    datasets: [
      {
        id: input.datasetId,
        title: input.title,
        format: "arcgis-rest",
        url: input.serviceUrl,
        crs: "EPSG:4326",
      },
    ],
  };
}

/** Crawl one endpoint, normalize, wrap meta, return a NormalizedDataset. */
async function acquireOne(
  input: ArcgisZonageInput,
): Promise<NormalizedDataset<AdminFeatureCollection>> {
  const manifest = syntheticManifest(input);
  const dataset = manifest.datasets[0]!;
  const { collection: raw } = await crawlArcgisLayer(input.serviceUrl, input.layer, {
    strategy: "offset",
  });
  const ctx: NormalizeContext = { manifest, dataset };
  const collection = geojsonPassthrough(raw, ctx) as AdminFeatureCollection;
  const license = resolveManifestLicense(manifest);
  const meta: CollectionMeta = {
    sourceId: manifest.id,
    datasetId: dataset.id,
    title: dataset.title,
    license,
    attribution: attributionLine(manifest.provider.name, license),
    crs: WGS84,
    fetchedAt: new Date().toISOString(),
    count: collection.features.length,
    checksum: { algo: "sha256", value: sha256Hex(JSON.stringify(collection)) },
  };
  return { meta, collection };
}

async function main(): Promise<void> {
  const out = process.argv[2] ?? "s3://sentropic-geo/normalized/ca-qc-zonage";
  const a2Path =
    process.argv[3] ??
    "/home/antoinefa/src/_acquisition-shared/qc-arcgis-zonage-endpoints.json";

  const a2 = await loadA2Inputs(a2Path);
  // De-dup by datasetId: seed first, then any A2 entry not already covered.
  const byId = new Map<string, ArcgisZonageInput>();
  for (const i of SEED_INPUTS) byId.set(i.datasetId, i);
  for (const i of a2) if (!byId.has(i.datasetId)) byId.set(i.datasetId, i);
  const inputs = [...byId.values()];

  const store = createStore(out);
  // s3://bucket/prefix → createStore roots at bucket; prefix becomes the key
  // prefix the StoreProvider lists under. Pass prefix to writeNormalizedToStore.
  const prefix = out.startsWith("s3://")
    ? out.replace(/^s3:\/\/[^/]+\/?/, "").replace(/\/$/, "")
    : undefined;

  console.log(`A3 ArcGIS runner → ${out} (${inputs.length} endpoint(s))`);
  const results: { city: string; count: number; ok: boolean; err?: string }[] = [];
  for (const input of inputs) {
    try {
      const normalized = await acquireOne(input);
      const keys = await writeNormalizedToStore(normalized, store);
      console.log(
        `  ${input.datasetId} — ${normalized.meta.count} features [${normalized.meta.license.id}]\n` +
          `    attribution: ${normalized.meta.attribution}\n` +
          `    ${keys.geojsonKey}`,
      );
      results.push({ city: input.datasetId, count: normalized.meta.count, ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ${input.datasetId} — FAILED: ${msg}`);
      results.push({ city: input.datasetId, count: 0, ok: false, err: msg });
    }
    // Politeness between distinct hosts.
    await new Promise((r) => setTimeout(r, 1500));
  }
  const okCount = results.filter((r) => r.ok).length;
  const total = results.filter((r) => r.ok).reduce((s, r) => s + r.count, 0);
  console.log(`A3 ArcGIS runner done: ${okCount}/${results.length} ok, ${total} features.`);
  if (okCount === 0) process.exitCode = 1;
}

void main();
