/** Deterministic selection of legacy zoning proof URLs for cluster recapture. */
import type { CaptureWorklistTarget } from "../../../packages/qc-sources/src/capture/index.js";
import { classifyCapturedOctets, type CaptureOctetClassification } from "./capture-octets-classification.js";

export interface ProofUrlCase {
  envelope_public_urls: Array<{ url: string }>;
}

export interface ProofUrlAuditRow {
  slug: string;
  s3_cases: ProofUrlCase[];
  query_cases?: Array<{ url: string }>;
}

function isSimpleHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname.length > 0 && parsed.search.length === 0 && parsed.hash.length === 0;
  } catch {
    return false;
  }
}

function isArcgisQueryUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.search.length > 0 && /arcgis/i.test(`${parsed.hostname}${parsed.pathname}`);
  } catch {
    return false;
  }
}

type ArcgisFormat = "geojson" | "json";

export interface ArcgisGeometryQueryAttempt extends CaptureOctetClassification {
  url: string;
  http_status: number | null;
  content_type: string | null;
  transport_error: string | null;
}

export interface ArcgisGeometryQueryProbe {
  endpoint: string;
  selected_url: string | null;
  selected_format: ArcgisFormat | null;
  attempts: ArcgisGeometryQueryAttempt[];
}

export interface ArcgisFetchResponse {
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type ArcgisFetch = (url: string) => Promise<ArcgisFetchResponse>;

/** Retourne la couche ArcGIS elle-même, sans query/fragment, ou `null`. */
function arcgisLayerEndpoint(value: string): string | null {
  try {
    const parsed = new URL(value);
    if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.search || parsed.hash) return null;
    const path = parsed.pathname.replace(/\/+$/, "");
    if (!/\/(?:FeatureServer|MapServer)\/\d+$/i.test(path)) return null;
    parsed.pathname = path;
    return parsed.toString();
  } catch {
    return null;
  }
}

/** Retrouve la couche depuis une URL de query produite par cette worklist. */
function arcgisLayerEndpointFromCaptureUrl(value: string): string | null {
  const direct = arcgisLayerEndpoint(value);
  if (direct !== null) return direct;
  try {
    const parsed = new URL(value);
    if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || !/\/query\/?$/i.test(parsed.pathname)) return null;
    parsed.pathname = parsed.pathname.replace(/\/query\/?$/i, "");
    parsed.search = "";
    parsed.hash = "";
    return arcgisLayerEndpoint(parsed.toString());
  } catch {
    return null;
  }
}

/**
 * La page `FeatureServer/<n>` / `MapServer/<n>` décrit la couche; elle ne
 * contient pas les features. Cette URL est donc celle à remettre au runner de
 * capture, jamais la description elle-même.
 */
export function arcgisGeometryQueryUrl(endpoint: string, format: ArcgisFormat = "geojson"): string | null {
  const layer = arcgisLayerEndpoint(endpoint);
  if (layer === null) return null;
  const parsed = new URL(layer);
  parsed.pathname = `${parsed.pathname}/query`;
  parsed.search = `?where=1%3D1&outFields=*&f=${format}`;
  return parsed.toString();
}

function transportFailure(url: string, error: unknown): ArcgisGeometryQueryAttempt {
  return {
    url,
    http_status: null,
    content_type: null,
    classification: "AUTRE",
    detail: "transport-error",
    coordinate_features: null,
    transport_error: error instanceof Error ? error.message : String(error),
  };
}

async function requestArcgisGeometry(url: string, fetchImpl: ArcgisFetch): Promise<ArcgisGeometryQueryAttempt> {
  try {
    const response = await fetchImpl(url);
    const contentType = response.headers.get("content-type");
    const classification = classifyCapturedOctets(Buffer.from(await response.arrayBuffer()), contentType);
    return { url, http_status: response.status, content_type: contentType, transport_error: null, ...classification };
  } catch (error) {
    return transportFailure(url, error);
  }
}

/**
 * Sonde une seule fois chaque format. Une erreur de transport est journalisée
 * comme telle et ne relance pas l'endpoint; une réponse non géométrique au
 * format GeoJSON déclenche l'unique repli ArcGIS JSON demandé.
 */
export async function probeArcgisGeometryQuery(
  endpoint: string,
  fetchImpl: ArcgisFetch = (url) => fetch(url),
): Promise<ArcgisGeometryQueryProbe> {
  const geojsonUrl = arcgisGeometryQueryUrl(endpoint, "geojson");
  if (geojsonUrl === null) throw new Error(`not an ArcGIS FeatureServer/<n> or MapServer/<n> endpoint: ${endpoint}`);
  const geojson = await requestArcgisGeometry(geojsonUrl, fetchImpl);
  if (geojson.classification === "GEOMETRIE") {
    return { endpoint, selected_url: geojsonUrl, selected_format: "geojson", attempts: [geojson] };
  }
  // Un échec de transport n'est pas un refus documenté du format et il ne faut
  // pas le déguiser en second essai de collecte.
  if (geojson.transport_error !== null) {
    return { endpoint, selected_url: null, selected_format: null, attempts: [geojson] };
  }
  const jsonUrl = arcgisGeometryQueryUrl(endpoint, "json")!;
  const json = await requestArcgisGeometry(jsonUrl, fetchImpl);
  return json.classification === "GEOMETRIE"
    ? { endpoint, selected_url: jsonUrl, selected_format: "json", attempts: [geojson, json] }
    : { endpoint, selected_url: null, selected_format: null, attempts: [geojson, json] };
}

export interface ResolvedProofUrlRecaptureWorklist {
  worklist: CaptureWorklistTarget[];
  probes: ArcgisGeometryQueryProbe[];
}

/**
 * Remplace les query ArcGIS candidates par le seul format qui a effectivement
 * renvoyé des features avec coordonnées. Une couche qui refuse les deux
 * formats est retirée de la worklist et conservée dans `probes`, jamais
 * relancée en boucle ni remplacée par sa page HTML de description.
 */
export async function resolveArcgisProofUrlRecaptureWorklist(
  targets: readonly CaptureWorklistTarget[],
  probe: (endpoint: string) => Promise<ArcgisGeometryQueryProbe> = probeArcgisGeometryQuery,
): Promise<ResolvedProofUrlRecaptureWorklist> {
  const probes: ArcgisGeometryQueryProbe[] = [];
  const worklist: CaptureWorklistTarget[] = [];
  for (const target of targets) {
    const urls: string[] = [];
    for (const url of target.urls) {
      const endpoint = arcgisLayerEndpointFromCaptureUrl(url);
      if (endpoint === null) {
        urls.push(url);
        continue;
      }
      const outcome = await probe(endpoint);
      probes.push(outcome);
      if (outcome.selected_url !== null) urls.push(outcome.selected_url);
    }
    const uniqueUrls = [...new Set(urls)].sort();
    if (uniqueUrls.length > 0) worklist.push({ ...target, urls: uniqueUrls });
  }
  return { worklist, probes };
}

/**
 * Selects only v1/S3-proof collections whose served envelope still exposes a
 * public, replayable HTTPS origin. ArcGIS layer description URLs are replaced
 * mechanically by their geometry query; the entrypoint then probes its two
 * supported representations before it materialises the immutable worklist.
 */
export function selectProofUrlRecaptureWorklist(
  rows: readonly ProofUrlAuditRow[],
  excludedSlugs: ReadonlySet<string>,
  offset: number,
  limit: number,
): CaptureWorklistTarget[] {
  if (!Number.isInteger(offset) || offset < 0) throw new Error("offset must be a non-negative integer");
  if (!Number.isInteger(limit) || limit < 1) throw new Error("limit must be a positive integer");

  const candidates = rows
    .filter((row) => row.s3_cases.length > 0)
    .filter((row) => !excludedSlugs.has(row.slug))
    .filter((row) => !(row.query_cases ?? []).some((entry) => isArcgisQueryUrl(entry.url)))
    .map((row) => ({
      slug: row.slug,
      urls: [...new Set(row.s3_cases.flatMap((item) => item.envelope_public_urls.map((entry) => entry.url)))]
        .filter(isSimpleHttpsUrl)
        .map((url) => arcgisGeometryQueryUrl(url) ?? url)
        .sort(),
    }))
    .filter((row) => row.urls.length > 0)
    .sort((left, right) => left.slug.localeCompare(right.slug));

  return candidates.slice(offset, offset + limit).map((row) => ({
    slug: row.slug,
    // This is an attestation capture of a v1 proof URL, not a claim that every
    // source shares one vendor protocol.  The generic source remains an honest
    // CAS namespace until the later proof-restamping pass classifies it.
    source: "zones-v1-proof-url",
    urls: row.urls,
  }));
}
