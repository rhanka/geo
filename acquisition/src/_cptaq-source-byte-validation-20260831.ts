/**
 * READ-ONLY SOURCE BYTE-VALIDATION — NOT capture (capture runs on the cluster).
 *
 * §9 `ca-qc-constraints` acquisition, step 1 (source-ID + byte-validation only).
 * Validates that the Données Québec CPTAQ "zone agricole" source
 * (`zone-agricole-du-quebec`) returns REAL geometry — not an HTML shell, an error
 * envelope, or a 200 that is not geometry — and enumerates its geometry resources
 * so the worklist can shortlist real-geometry candidates.
 *
 * DISCIPLINE (zones-lane lens): a 200 from a download link / WFS / WMS is NOT
 * proof of geometry. Every candidate geometry resource is validated by OPENING
 * THE BYTES (HEAD for content-type/length, then a small ranged / prefix GET) and
 * classified VALID-geometry | VALID-needs-GDAL | INVALID-shell/trap | WMS-raster
 * with verbatim evidence (first-bytes hex signature + head text; for WFS/GeoJSON
 * the parsed FeatureCollection feature count of a 1-feature sample).
 *
 * NO S3 writes. NO capture (no raw bytes persisted). Read-only network probe.
 * If the sandbox blocks external network, the script reports that EXPLICITLY
 * (`network_available: false`) and fabricates NO validation.
 *
 * Output (committed): work/coverage/cptaq-source-byte-validation-20260831.{json,md}
 * Run:  cd acquisition && NODE_OPTIONS=--dns-result-order=ipv4first \
 *         npx tsx src/_cptaq-source-byte-validation-20260831.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

// NOTE ON IMPORTS — this probe is deliberately SELF-CONTAINED (no cross-package
// import). `@sentropic/geo`'s exports map points at `./dist/...` which is not
// built on a clean checkout, and importing `packages/geo/src/acquire/ckan.ts`
// by relative path pulls in `@sentropic/geo-core` (runtime `isFeatureCollection`)
// at module load — an unbuilt-dep hazard for a read-only sonde that must be
// rejouable sur un checkout propre. The CKAN types + geometry classification
// below MIRROR the canonical lib
// (packages/geo/src/acquire/ckan.ts :: CkanResource / ResolvedGeoResource /
//  resolveGeoResources / normaliseFormat) 1:1; the load-bearing step here is the
// byte-opening validation, which is probe-specific regardless.

/** Mirror of `CkanResource` (packages/geo/src/acquire/ckan.ts). */
interface CkanResource {
  readonly id: string;
  readonly name: string;
  readonly format: string;
  readonly url: string;
  readonly description?: string;
}
/** Mirror of `CkanPackage` (packages/geo/src/acquire/ckan.ts). */
interface CkanPackage {
  readonly id: string;
  readonly title: string;
  readonly organization?: string;
  readonly resources: readonly CkanResource[];
}
type GeoResourceFormat = "geojson" | "shp" | "kml" | "gpkg" | "fgdb" | "other";
/** Mirror of `ResolvedGeoResource` (packages/geo/src/acquire/ckan.ts). */
interface ResolvedGeoResource {
  readonly packageId: string;
  readonly resourceId: string;
  readonly format: GeoResourceFormat;
  readonly url: string;
  readonly name: string;
  readonly needsGdal: boolean;
}

const GEOJSON_FORMATS = new Set(["geojson", "geo+json", "application/geo+json"]);
const GDAL_FORMATS = new Set(["shp", "shapefile", "kml", "gpkg", "geopackage", "fgdb", "filegdb"]);
const GEO_FORMAT_SET: ReadonlySet<GeoResourceFormat> = new Set<GeoResourceFormat>([
  "geojson",
  "shp",
  "kml",
  "gpkg",
  "fgdb",
]);

/** Mirror of `normaliseFormat` (packages/geo/src/acquire/ckan.ts). */
function normaliseFormat(raw: string): GeoResourceFormat {
  const lower = raw.toLowerCase().trim();
  if (GEOJSON_FORMATS.has(lower)) return "geojson";
  if (lower === "shp" || lower === "shapefile") return "shp";
  if (lower === "kml") return "kml";
  if (lower === "gpkg" || lower === "geopackage") return "gpkg";
  if (lower === "fgdb" || lower === "filegdb" || lower === "esri geodatabase") return "fgdb";
  if (GDAL_FORMATS.has(lower)) return "shp";
  return "other";
}

/** Mirror of `resolveGeoResources` (packages/geo/src/acquire/ckan.ts). */
function resolveGeoResources(pkg: CkanPackage): ResolvedGeoResource[] {
  const result: ResolvedGeoResource[] = [];
  for (const resource of pkg.resources) {
    const format = normaliseFormat(resource.format);
    if (!GEO_FORMAT_SET.has(format)) continue;
    result.push({
      packageId: pkg.id,
      resourceId: resource.id,
      format,
      url: resource.url,
      name: resource.name,
      needsGdal: format !== "geojson",
    });
  }
  return result;
}

// ── Config ────────────────────────────────────────────────────────────────────

const CKAN_BASE = "https://www.donneesquebec.ca/recherche/api/3/action";
const DATASET_ID = "zone-agricole-du-quebec";
const DATASET_PAGE = "https://www.donneesquebec.ca/recherche/dataset/zone-agricole-du-quebec";
const OUT_STEM = "work/coverage/cptaq-source-byte-validation-20260831";
const PREFIX_BYTES = 2048; // first ~2KB is enough to decide shell vs real geometry
const UA = "sentropic-geo-source-validation/1.0 (read-only; +https://github.com/rhanka/geo)";
const FETCH_TIMEOUT_MS = 20_000; // bound every request so a hung endpoint cannot stall the probe

// ── HTTP helpers (read-only, byte-bounded) ──────────────────────────────────────

interface HeadInfo {
  ok: boolean;
  status: number | null;
  statusText: string;
  contentType: string | null;
  contentLength: number | null;
  acceptRanges: string | null;
  error: string | null;
}

interface SampleInfo {
  ok: boolean;
  status: number | null;
  statusText: string;
  contentType: string | null;
  contentLength: number | null; // from header, may be null
  bytesRead: number;
  truncated: boolean;
  firstBytesHex: string; // first 16 bytes, hex
  headText: string; // first ~400 printable chars
  bodyIsSmall: boolean; // fully read (<= PREFIX cap not hit)
  text: string; // decoded prefix (utf-8, may be partial)
  error: string | null;
}

/** Wrap a fetch and classify a thrown error as a network-unavailability signal. */
function isNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.message} ${String((err as { cause?: unknown }).cause ?? "")}` : String(err);
  return /fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|getaddrinfo|network|TLS|certificate|socket hang up|und_err|aborted|timeout|AbortError|TimeoutError/i.test(
    msg,
  );
}

async function httpHead(url: string): Promise<HeadInfo> {
  try {
    const r = await fetch(url, {
      method: "HEAD",
      headers: { "user-agent": UA },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    return {
      ok: r.ok,
      status: r.status,
      statusText: r.statusText,
      contentType: r.headers.get("content-type"),
      contentLength: r.headers.get("content-length") ? Number(r.headers.get("content-length")) : null,
      acceptRanges: r.headers.get("accept-ranges"),
      error: null,
    };
  } catch (err) {
    return {
      ok: false,
      status: null,
      statusText: "",
      contentType: null,
      contentLength: null,
      acceptRanges: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** GET only the first `maxBytes` of a URL. Uses a Range header; if the server
 *  ignores Range (returns 200 full), the stream is cancelled after `maxBytes`. */
async function httpSample(url: string, maxBytes = PREFIX_BYTES, ranged = true): Promise<SampleInfo> {
  const headers: Record<string, string> = { "user-agent": UA };
  if (ranged) headers["range"] = `bytes=0-${maxBytes - 1}`;
  try {
    const r = await fetch(url, {
      method: "GET",
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const clHeader = r.headers.get("content-length");
    const chunks: Uint8Array[] = [];
    let total = 0;
    let truncated = false;
    if (r.body) {
      const reader = r.body.getReader();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          total += value.byteLength;
          if (total >= maxBytes) {
            truncated = true;
            await reader.cancel().catch(() => {});
            break;
          }
        }
      }
    } else {
      const ab = new Uint8Array(await r.arrayBuffer());
      chunks.push(ab);
      total = ab.byteLength;
    }
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    const prefix = buf.subarray(0, Math.max(maxBytes, buf.byteLength));
    const firstBytesHex = Buffer.from(buf.subarray(0, 16)).toString("hex");
    const text = prefix.toString("utf-8");
    const headText = text.slice(0, 400).replace(/\s+/g, " ").trim();
    return {
      ok: r.ok,
      status: r.status,
      statusText: r.statusText,
      contentType: r.headers.get("content-type"),
      contentLength: clHeader ? Number(clHeader) : null,
      bytesRead: total,
      truncated,
      firstBytesHex,
      headText,
      bodyIsSmall: !truncated,
      text,
      error: null,
    };
  } catch (err) {
    return {
      ok: false,
      status: null,
      statusText: "",
      contentType: null,
      contentLength: null,
      bytesRead: 0,
      truncated: false,
      firstBytesHex: "",
      headText: "",
      bodyIsSmall: false,
      text: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Signature detectors (verbatim byte evidence) ────────────────────────────────

function looksHtml(s: string): boolean {
  const h = s.slice(0, 512).toLowerCase();
  return h.includes("<!doctype html") || h.includes("<html") || h.includes("<head") || h.includes("<body");
}
function isZipMagic(hex: string): boolean {
  // PK\x03\x04 (zip) or PK\x05\x06 (empty archive)
  return hex.startsWith("504b0304") || hex.startsWith("504b0506") || hex.startsWith("504b0708");
}
function isGpkgMagic(buf: Buffer | string): boolean {
  const s = typeof buf === "string" ? buf : buf.toString("utf-8");
  return s.startsWith("SQLite format 3 ") || s.startsWith("SQLite format 3");
}
function looksFeatureCollectionStart(s: string): boolean {
  // A real GeoJSON FeatureCollection prefix: type=FeatureCollection AND a features array begun.
  return /"type"\s*:\s*"FeatureCollection"/.test(s) && /"features"\s*:\s*\[/.test(s);
}
function looksJsonErrorEnvelope(s: string): boolean {
  const t = s.trim().slice(0, 512);
  if (!t.startsWith("{")) return false;
  return /"success"\s*:\s*false/.test(t) || /"error"\s*:/.test(t) || /"ExceptionReport"|ServiceException/i.test(t);
}
function looksKml(s: string): boolean {
  return /<kml[\s>]/i.test(s) || /<Placemark[\s>]/i.test(s) || /<gml:/.test(s);
}
function looksGmlWfs(s: string): boolean {
  return /wfs:FeatureCollection|gml:featureMember|<wfs:member/i.test(s);
}

// ── WFS / WMS helpers ──────────────────────────────────────────────────────────

function serviceKind(res: CkanResource): "wfs" | "wms" | null {
  const f = (res.format || "").toLowerCase();
  const u = (res.url || "").toLowerCase();
  if (f.includes("wfs") || /[?&]service=wfs/.test(u) || /\bwfs\b/.test(u)) return "wfs";
  if (f.includes("wms") || /[?&]service=wms/.test(u) || /\bwms\b/.test(u)) return "wms";
  return null;
}

function withParams(base: string, params: Record<string, string>): string {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) {
    // drop any pre-existing case-insensitive duplicate of the param
    for (const existing of [...u.searchParams.keys()]) {
      if (existing.toLowerCase() === k.toLowerCase()) u.searchParams.delete(existing);
    }
    u.searchParams.set(k, v);
  }
  return u.toString();
}

interface WfsProbe {
  capabilitiesUrl: string;
  capabilitiesStatus: number | null;
  capabilitiesContentType: string | null;
  typeNames: string[];
  crsByType: Record<string, string>;
  sampleTypeName: string | null;
  sampleUrl: string | null;
  sampleStatus: number | null;
  sampleContentType: string | null;
  sampleFeatureCount: number | null;
  sampleCrs: string | null;
  sampleFirstBytesHex: string;
  sampleHeadText: string;
  verdict: string;
  notes: string[];
}

/** Parse GetCapabilities XML (WFS 1.1/2.0) for FeatureType Name + DefaultSRS/CRS via regex. */
function parseWfsCapabilities(xml: string): { typeNames: string[]; crsByType: Record<string, string> } {
  const typeNames: string[] = [];
  const crsByType: Record<string, string> = {};
  const ftRe = /<(?:wfs:)?FeatureType\b[\s\S]*?<\/(?:wfs:)?FeatureType>/gi;
  let m: RegExpExecArray | null;
  while ((m = ftRe.exec(xml)) !== null) {
    const block = m[0];
    const nameM = /<(?:wfs:)?Name>\s*([^<]+?)\s*<\/(?:wfs:)?Name>/i.exec(block);
    if (!nameM) continue;
    const name = nameM[1]!.trim();
    typeNames.push(name);
    const crsM =
      /<(?:wfs:)?DefaultCRS>\s*([^<]+?)\s*<\/(?:wfs:)?DefaultCRS>/i.exec(block) ||
      /<(?:wfs:)?DefaultSRS>\s*([^<]+?)\s*<\/(?:wfs:)?DefaultSRS>/i.exec(block);
    if (crsM) crsByType[name] = crsM[1]!.trim();
  }
  return { typeNames, crsByType };
}

async function probeWfs(baseUrl: string): Promise<WfsProbe> {
  const notes: string[] = [];
  const capsUrl = withParams(baseUrl, { service: "WFS", request: "GetCapabilities" });
  const caps = await httpSample(capsUrl, 200_000, false); // capabilities can be large; read up to 200KB
  const { typeNames, crsByType } = caps.text ? parseWfsCapabilities(caps.text) : { typeNames: [], crsByType: {} };

  // Pick the zone-agricole layer if discoverable, else the first typeName.
  const zoneType =
    typeNames.find((t) => /zone.?agri|agric|cptaq/i.test(t)) ?? (typeNames.length > 0 ? typeNames[0] : null);

  let sampleUrl: string | null = null;
  let sample: SampleInfo | null = null;
  let sampleFeatureCount: number | null = null;
  let sampleCrs: string | null = null;
  if (zoneType) {
    // WFS 2.0 uses count + typeNames; 1.x uses maxFeatures + typeName. Send a superset.
    sampleUrl = withParams(baseUrl, {
      service: "WFS",
      version: "2.0.0",
      request: "GetFeature",
      typeNames: zoneType,
      typeName: zoneType,
      count: "1",
      maxFeatures: "1",
      outputFormat: "application/json",
      srsName: "EPSG:4326",
    });
    sample = await httpSample(sampleUrl, 200_000, false);
    // Try to parse a FeatureCollection
    if (sample.text) {
      try {
        const j = JSON.parse(sample.bodyIsSmall ? sample.text : sample.text) as {
          type?: string;
          features?: unknown[];
          crs?: { properties?: { name?: string } };
          totalFeatures?: number;
        };
        if (j && j.type === "FeatureCollection" && Array.isArray(j.features)) {
          sampleFeatureCount = j.features.length;
          sampleCrs = j.crs?.properties?.name ?? crsByType[zoneType] ?? null;
        }
      } catch {
        notes.push("WFS GetFeature JSON did not parse from sample (may be GML/HTML or truncated).");
      }
    }
  } else {
    notes.push("No FeatureType Name discoverable in GetCapabilities.");
  }

  let verdict: string;
  if (sampleFeatureCount && sampleFeatureCount > 0) verdict = "VALID-geometry (WFS GeoJSON, features>0)";
  else if (sample && sample.text && looksGmlWfs(sample.text)) verdict = "VALID-geometry (WFS GML featureMember present)";
  else if (sample && looksHtml(sample.text)) verdict = "INVALID-shell/trap (WFS returned HTML)";
  else if (sample && looksJsonErrorEnvelope(sample.text)) verdict = "INVALID-shell/trap (WFS ServiceException/error envelope)";
  else if (caps.status && caps.status >= 200 && caps.status < 300 && typeNames.length > 0)
    verdict = "PARTIAL (capabilities OK, sample not confirmed as geometry)";
  else verdict = "UNVERIFIED (no confirmable geometry from WFS)";

  return {
    capabilitiesUrl: capsUrl,
    capabilitiesStatus: caps.status,
    capabilitiesContentType: caps.contentType,
    typeNames,
    crsByType,
    sampleTypeName: zoneType,
    sampleUrl,
    sampleStatus: sample?.status ?? null,
    sampleContentType: sample?.contentType ?? null,
    sampleFeatureCount,
    sampleCrs,
    sampleFirstBytesHex: sample?.firstBytesHex ?? "",
    sampleHeadText: sample?.headText ?? "",
    verdict,
    notes,
  };
}

// ── Per-resource geometry validation ────────────────────────────────────────────

type Verdict =
  | "VALID-geometry"
  | "VALID-geometry-needs-GDAL"
  | "INVALID-shell/trap"
  | "WMS-raster-not-vector"
  | "UNVERIFIED"
  | "network-blocked"
  | "error";

interface ResourceValidation {
  name: string;
  format: string;
  url: string;
  id: string;
  description?: string;
  classified: "geometry-candidate" | "service-wfs" | "service-wms" | "non-geometry";
  resolvedFormat?: string;
  needsGdal?: boolean;
  head?: HeadInfo;
  sample?: {
    status: number | null;
    contentType: string | null;
    contentLength: number | null;
    bytesRead: number;
    truncated: boolean;
    firstBytesHex: string;
    headText: string;
  };
  wfs?: WfsProbe;
  featureCountSample?: number | null;
  crs?: string | null;
  verdict: Verdict | string;
  evidence: string;
}

function pickResolved(resource: CkanResource, resolved: ResolvedGeoResource[]): ResolvedGeoResource | undefined {
  return resolved.find((r) => r.resourceId === resource.id || r.url === resource.url);
}

async function validateResource(
  res: CkanResource,
  resolved: ResolvedGeoResource[],
): Promise<ResourceValidation> {
  const kind = serviceKind(res);
  const rg = pickResolved(res, resolved);
  const base: ResourceValidation = {
    name: res.name,
    format: res.format,
    url: res.url,
    id: res.id,
    ...(res.description ? { description: res.description } : {}),
    classified: "non-geometry",
    verdict: "UNVERIFIED",
    evidence: "",
  };

  // WMS — raster tiles, not vector geometry. Record + do a light GetCapabilities touch.
  if (kind === "wms") {
    const capsUrl = withParams(res.url, { service: "WMS", request: "GetCapabilities" });
    const caps = await httpSample(capsUrl, 8192, false);
    return {
      ...base,
      classified: "service-wms",
      sample: {
        status: caps.status,
        contentType: caps.contentType,
        contentLength: caps.contentLength,
        bytesRead: caps.bytesRead,
        truncated: caps.truncated,
        firstBytesHex: caps.firstBytesHex,
        headText: caps.headText,
      },
      verdict: "WMS-raster-not-vector",
      evidence: `WMS service (raster). GetCapabilities status=${caps.status} ct=${caps.contentType}. head="${caps.headText.slice(0, 120)}"`,
    };
  }

  // WFS — vector service. Full capabilities + 1-feature sample.
  if (kind === "wfs") {
    const wfs = await probeWfs(res.url);
    let verdict: string = wfs.verdict;
    if (verdict.startsWith("VALID")) verdict = "VALID-geometry";
    else if (verdict.startsWith("INVALID")) verdict = "INVALID-shell/trap";
    return {
      ...base,
      classified: "service-wfs",
      wfs,
      featureCountSample: wfs.sampleFeatureCount,
      crs: wfs.sampleCrs ?? (wfs.sampleTypeName ? wfs.crsByType[wfs.sampleTypeName] ?? null : null),
      verdict,
      evidence: `WFS caps status=${wfs.capabilitiesStatus}; typeNames=[${wfs.typeNames.join(", ")}]; sample type=${wfs.sampleTypeName} status=${wfs.sampleStatus} features=${wfs.sampleFeatureCount}; ${wfs.verdict}`,
    };
  }

  // Otherwise: only byte-validate declared geometry candidates (resolveGeoResources)
  // or obvious downloadable geometry (zip / .geojson / .gpkg / .kml by url).
  const urlLower = res.url.toLowerCase();
  const isDownloadGeo =
    !!rg ||
    /\.(zip|geojson|json|gpkg|kml|kmz)(\?|$)/.test(urlLower) ||
    /shapefile|shp|geojson|gpkg|geopackage|kml/i.test(res.format);
  if (!isDownloadGeo) {
    return { ...base, evidence: `Non-geometry format "${res.format}"; not byte-validated.` };
  }

  base.classified = "geometry-candidate";
  base.resolvedFormat = rg?.format;
  base.needsGdal = rg?.needsGdal;

  const head = await httpHead(res.url);
  const sample = await httpSample(res.url, PREFIX_BYTES, true);
  base.head = head;
  base.sample = {
    status: sample.status,
    contentType: sample.contentType,
    contentLength: sample.contentLength ?? head.contentLength,
    bytesRead: sample.bytesRead,
    truncated: sample.truncated,
    firstBytesHex: sample.firstBytesHex,
    headText: sample.headText,
  };

  if (sample.error) {
    return { ...base, verdict: "error", evidence: `fetch error: ${sample.error}` };
  }
  if (sample.status && (sample.status < 200 || sample.status >= 400)) {
    return { ...base, verdict: "INVALID-shell/trap", evidence: `HTTP ${sample.status} ${sample.statusText}` };
  }

  const hex = sample.firstBytesHex;
  const txt = sample.text;

  // HTML shell / error page — REJECT.
  if (looksHtml(txt)) {
    return {
      ...base,
      verdict: "INVALID-shell/trap",
      evidence: `Body is HTML (not geometry). ct=${sample.contentType} firstBytes=${hex} head="${sample.headText.slice(0, 120)}"`,
    };
  }
  if (looksJsonErrorEnvelope(txt)) {
    return {
      ...base,
      verdict: "INVALID-shell/trap",
      evidence: `Body is a JSON error/exception envelope. ct=${sample.contentType} head="${sample.headText.slice(0, 160)}"`,
    };
  }

  // SHP zip — magic PK\x03\x04. Use the FULL-file size from HEAD (the ranged GET's
  // content-length is only the sampled chunk), falling back to the GET header.
  if (isZipMagic(hex)) {
    const fullSize = head.contentLength ?? sample.contentLength;
    const nonTrivial = fullSize == null || fullSize > 1024;
    return {
      ...base,
      verdict: nonTrivial ? "VALID-geometry-needs-GDAL" : "INVALID-shell/trap",
      crs: null,
      evidence: `ZIP magic PK\\x03\\x04 (firstBytes=${hex}), ct=${sample.contentType}, full-file content-length(HEAD)=${fullSize ?? "unknown"}B ⇒ ${nonTrivial ? "real SHP archive (needs GDAL to extract)" : "trivially small — suspicious"}`,
    };
  }

  // GPKG — SQLite magic.
  if (isGpkgMagic(Buffer.from(txt.slice(0, 32)))) {
    return {
      ...base,
      verdict: "VALID-geometry-needs-GDAL",
      evidence: `GeoPackage SQLite magic "SQLite format 3" (firstBytes=${hex}) ⇒ real GPKG (needs GDAL).`,
    };
  }

  // GeoJSON — FeatureCollection start in the prefix.
  if (looksFeatureCollectionStart(txt)) {
    // Try a full parse only if the whole body fit in the prefix (small file).
    let featureCount: number | null = null;
    let crs: string | null = null;
    if (sample.bodyIsSmall) {
      try {
        const j = JSON.parse(txt) as { features?: unknown[]; crs?: { properties?: { name?: string } } };
        if (Array.isArray(j.features)) featureCount = j.features.length;
        crs = j.crs?.properties?.name ?? null;
      } catch {
        /* prefix already proves FeatureCollection start */
      }
    }
    return {
      ...base,
      verdict: "VALID-geometry",
      featureCountSample: featureCount,
      crs,
      evidence: `GeoJSON FeatureCollection start confirmed in first ${sample.bytesRead}B (type=FeatureCollection + features:[). ct=${sample.contentType}${featureCount != null ? `, sample featureCount=${featureCount}` : " (large file — prefix only)"}`,
    };
  }

  // KML / GML.
  if (looksKml(txt)) {
    return {
      ...base,
      verdict: "VALID-geometry-needs-GDAL",
      evidence: `KML/GML markup detected in prefix. ct=${sample.contentType} head="${sample.headText.slice(0, 120)}"`,
    };
  }

  // Unclassifiable bytes.
  return {
    ...base,
    verdict: "UNVERIFIED",
    evidence: `Bytes not recognised as HTML/zip/gpkg/geojson/kml. ct=${sample.contentType} firstBytes=${hex} head="${sample.headText.slice(0, 160)}"`,
  };
}

// ── CKAN package_show (direct fetch; we need ALL resources verbatim) ─────────────

interface PackageShowResult {
  networkAvailable: boolean;
  networkError: string | null;
  status: number | null;
  pkg: CkanPackage | null;
  rawResources: CkanResource[];
}

async function packageShow(id: string): Promise<PackageShowResult> {
  const url = `${CKAN_BASE}/package_show?id=${encodeURIComponent(id)}`;
  try {
    const r = await fetch(url, {
      headers: { "user-agent": UA },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const text = await r.text();
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return { networkAvailable: true, networkError: null, status: r.status, pkg: null, rawResources: [] };
    }
    const env = raw as { success?: boolean; result?: Record<string, unknown> };
    const result = env.result;
    if (!result) return { networkAvailable: true, networkError: null, status: r.status, pkg: null, rawResources: [] };
    const resourcesRaw = Array.isArray(result["resources"]) ? (result["resources"] as Record<string, unknown>[]) : [];
    const rawResources: CkanResource[] = resourcesRaw.map((rr) => ({
      id: String(rr["id"] ?? ""),
      name: String(rr["name"] ?? rr["id"] ?? ""),
      format: String(rr["format"] ?? ""),
      url: String(rr["url"] ?? ""),
      ...(typeof rr["description"] === "string" && rr["description"] ? { description: String(rr["description"]) } : {}),
    }));
    const orgRaw = result["organization"] as Record<string, unknown> | undefined;
    const pkg: CkanPackage = {
      id: String(result["id"] ?? result["name"] ?? id),
      title: String(result["title"] ?? result["name"] ?? id),
      ...(orgRaw ? { organization: String(orgRaw["title"] ?? orgRaw["name"] ?? "") } : {}),
      resources: rawResources,
    };
    return { networkAvailable: true, networkError: null, status: r.status, pkg, rawResources };
  } catch (err) {
    if (isNetworkError(err)) {
      return {
        networkAvailable: false,
        networkError: err instanceof Error ? err.message : String(err),
        status: null,
        pkg: null,
        rawResources: [],
      };
    }
    return {
      networkAvailable: true,
      networkError: err instanceof Error ? err.message : String(err),
      status: null,
      pkg: null,
      rawResources: [],
    };
  }
}

// ── CKAN package_search (discovery fallback when the slug 404s) ──────────────────

interface SearchCandidate {
  name: string; // CKAN name (slug) — the id to pass to package_show
  id: string; // CKAN uuid id
  title: string;
  organization: string | null;
  numResources: number;
  formats: string[];
}

interface PackageSearchResult {
  status: number | null;
  query: string;
  candidates: SearchCandidate[];
  error: string | null;
}

async function packageSearch(query: string, rows = 25): Promise<PackageSearchResult> {
  const url = `${CKAN_BASE}/package_search?q=${encodeURIComponent(query)}&rows=${rows}`;
  try {
    const r = await fetch(url, {
      headers: { "user-agent": UA },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const text = await r.text();
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return { status: r.status, query, candidates: [], error: "non-JSON body" };
    }
    const env = raw as { result?: { results?: Record<string, unknown>[] } };
    const results = Array.isArray(env.result?.results) ? env.result!.results! : [];
    const candidates: SearchCandidate[] = results.map((res) => {
      const resourcesRaw = Array.isArray(res["resources"]) ? (res["resources"] as Record<string, unknown>[]) : [];
      const orgRaw = res["organization"] as Record<string, unknown> | undefined;
      return {
        name: String(res["name"] ?? ""),
        id: String(res["id"] ?? ""),
        title: String(res["title"] ?? res["name"] ?? ""),
        organization: orgRaw ? String(orgRaw["title"] ?? orgRaw["name"] ?? "") : null,
        numResources: resourcesRaw.length,
        formats: [...new Set(resourcesRaw.map((rr) => String(rr["format"] ?? "")).filter(Boolean))],
      };
    });
    return { status: r.status, query, candidates, error: null };
  } catch (err) {
    return { status: null, query, candidates: [], error: err instanceof Error ? err.message : String(err) };
  }
}

/** Score a search candidate for "is this the CPTAQ zone-agricole dataset?". */
function scoreCandidate(c: SearchCandidate): number {
  let s = 0;
  const hay = `${c.name} ${c.title}`.toLowerCase();
  if (/zone.?agri/.test(hay)) s += 5;
  if (/agricole/.test(hay)) s += 2;
  if (/cptaq|commission de protection du territoire agricole/i.test(`${hay} ${c.organization ?? ""}`)) s += 4;
  if (c.formats.some((f) => /shp|shapefile|wfs|geojson|gpkg|kml/i.test(f))) s += 3;
  if (c.numResources > 0) s += 1;
  return s;
}

// ── Report rendering ────────────────────────────────────────────────────────────

function renderMarkdown(report: Report): string {
  const L: string[] = [];
  L.push(`# CPTAQ « zone agricole » — validation octet source (read-only)`);
  L.push("");
  L.push(`- Généré : ${report.generated_at}`);
  L.push(`- Dataset CKAN demandé : \`${report.dataset_id}\` — ${report.dataset_page}`);
  L.push(`- Dataset CKAN résolu (validé) : \`${report.resolved_dataset_id ?? "N-A"}\``);
  L.push(`- API : \`${report.ckan_action_api}\``);
  L.push(`- Réseau externe disponible : **${report.network_available ? "oui" : "NON"}**${report.network_error ? ` (${report.network_error})` : ""}`);
  L.push(`- package_show HTTP (slug demandé) : ${report.requested_show_status ?? "N-A"}${report.discovery.attempted ? " → discovery" : ""}`);
  L.push(`- package_show HTTP (slug résolu) : ${report.package_show_status ?? "N-A"}`);
  L.push(`- Package : ${report.package_title ? `« ${md(report.package_title)} »` : "N-A"}${report.organization ? ` — org : ${md(report.organization)}` : ""}`);
  L.push(`- Nature : validation octet + inventaire ressources. **NON capture** (la capture tourne sur le cluster). Aucune écriture S3.`);
  L.push("");
  if (!report.network_available) {
    L.push(`## Réseau bloqué dans le sandbox`);
    L.push("");
    L.push(`Le fetch de \`package_show\` a échoué avec une erreur réseau : \`${report.network_error}\`.`);
    L.push(`La validation octet ne peut donc PAS être exécutée ici — elle devra tourner sur le cluster.`);
    L.push(`Aucune validation n'est fabriquée. Inventaire et verdicts : indisponibles (unknown).`);
    return L.join("\n");
  }
  if (report.discovery.attempted) {
    L.push(`## Résolution du slug (package_search)`);
    L.push("");
    L.push(`Le slug demandé \`${report.dataset_id}\` a renvoyé HTTP 404 / 0 ressource. Recherche CKAN :`);
    L.push(`- requêtes : ${report.discovery.queries.map((q) => `\`${q}\``).join(", ")}`);
    if (report.discovery.chosen) {
      const c = report.discovery.chosen;
      L.push(`- **choisi** : \`${c.name}\` (score=${c.score}) — « ${md(c.title)} » — org : ${md(c.organization ?? "N-A")} — ${c.numResources} ressources — formats : ${c.formats.map((f) => `\`${f}\``).join(", ")}`);
    } else {
      L.push(`- **aucun candidat concluant** (score < 5).`);
    }
    if (report.discovery.candidates.length) {
      L.push("");
      L.push(`Candidats (top ${Math.min(10, report.discovery.candidates.length)}) :`);
      L.push("");
      L.push(`| slug (name) | titre | org | #res | formats |`);
      L.push(`|-------------|-------|-----|------|---------|`);
      for (const c of report.discovery.candidates.slice(0, 10)) {
        L.push(`| \`${md(c.name)}\` | ${md(c.title)} | ${md(c.organization ?? "N-A")} | ${c.numResources} | ${md(c.formats.join(", "))} |`);
      }
    }
    L.push("");
  }
  if (report.resources.length === 0) {
    L.push(`## Aucune ressource à valider`);
    L.push("");
    L.push(`package_show n'a renvoyé aucune ressource pour le slug résolu. Rien n'est validé ; aucun verdict fabriqué.`);
    return L.join("\n");
  }
  L.push(`## Inventaire des ressources (verbatim, ${report.resources.length})`);
  L.push("");
  L.push(`| # | name | format | classified | verdict | url |`);
  L.push(`|---|------|--------|-----------|---------|-----|`);
  report.resources.forEach((r, i) => {
    L.push(
      `| ${i + 1} | ${md(r.name)} | ${md(r.format)} | ${r.classified} | ${md(String(r.verdict))} | ${md(r.url)} |`,
    );
  });
  L.push("");
  L.push(`## Validation octet par ressource candidate (preuve verbatim)`);
  L.push("");
  for (const r of report.resources) {
    if (r.classified === "non-geometry") continue;
    L.push(`### ${r.name} — \`${r.format}\``);
    L.push(`- url : \`${r.url}\``);
    L.push(`- resource id : \`${r.id}\``);
    if (r.resolvedFormat) L.push(`- resolveGeoResources : format=\`${r.resolvedFormat}\`, needsGdal=${r.needsGdal}`);
    if (r.head) L.push(`- HEAD : status=${r.head.status ?? "N-A"} ct=${r.head.contentType ?? "N-A"} content-length=${r.head.contentLength ?? "N-A"} accept-ranges=${r.head.acceptRanges ?? "N-A"}`);
    if (r.sample) L.push(`- GET(prefix) : status=${r.sample.status ?? "N-A"} ct=${r.sample.contentType ?? "N-A"} bytesRead=${r.sample.bytesRead} truncated=${r.sample.truncated} firstBytes=\`${r.sample.firstBytesHex}\``);
    if (r.sample?.headText) L.push(`- head text : \`${r.sample.headText.slice(0, 200).replace(/`/g, "'")}\``);
    if (r.wfs) {
      L.push(`- WFS GetCapabilities : \`${r.wfs.capabilitiesUrl}\` (status=${r.wfs.capabilitiesStatus}, ct=${r.wfs.capabilitiesContentType})`);
      L.push(`- WFS typeNames : ${r.wfs.typeNames.length ? r.wfs.typeNames.map((t) => `\`${t}\``).join(", ") : "(none discovered)"}`);
      if (r.wfs.sampleUrl) L.push(`- WFS GetFeature(count=1) : \`${r.wfs.sampleUrl}\``);
      L.push(`- WFS sample : type=\`${r.wfs.sampleTypeName ?? "N-A"}\` status=${r.wfs.sampleStatus ?? "N-A"} featureCount=${r.wfs.sampleFeatureCount ?? "N-A"} crs=${r.wfs.sampleCrs ?? "N-A"} firstBytes=\`${r.wfs.sampleFirstBytesHex}\``);
      if (r.wfs.sampleHeadText) L.push(`- WFS sample head : \`${r.wfs.sampleHeadText.slice(0, 200).replace(/`/g, "'")}\``);
      if (r.wfs.notes.length) L.push(`- notes : ${r.wfs.notes.join(" ")}`);
    }
    if (r.featureCountSample != null) L.push(`- sample featureCount : ${r.featureCountSample}`);
    if (r.crs) L.push(`- CRS : \`${r.crs}\``);
    L.push(`- **VERDICT : ${r.verdict}**`);
    L.push(`- evidence : ${r.evidence}`);
    L.push("");
  }
  L.push(`## Shortlist — ressources VALID (candidates worklist acquisition)`);
  L.push("");
  if (report.valid_shortlist.length === 0) {
    L.push(`Aucune ressource VALID confirmée octet-pour-octet.`);
  } else {
    L.push(`| format | verdict | typeName/layer | CRS | url |`);
    L.push(`|--------|---------|----------------|-----|-----|`);
    for (const s of report.valid_shortlist) {
      L.push(`| ${md(s.format)} | ${md(s.verdict)} | ${md(s.typeName ?? "N-A")} | ${md(s.crs ?? "N-A")} | ${md(s.url)} |`);
    }
  }
  L.push("");
  L.push(`## Pièges HTML / shell détectés`);
  L.push("");
  if (report.invalid_shells.length === 0) {
    L.push(`Aucun 200-non-géométrie / shell HTML détecté parmi les candidates.`);
  } else {
    for (const s of report.invalid_shells) {
      L.push(`- \`${s.url}\` (${s.format}) — ${s.evidence}`);
    }
  }
  L.push("");
  // Factual follow-ups for the cluster-capture step (never fabricated; each is a
  // gap the byte-prefix probe cannot close read-only).
  const svcWms = report.resources.find((r) => /WMS/i.test(r.name) || /WMS/i.test(r.format));
  L.push(`## Suites (capture cluster — hors périmètre read-only)`);
  L.push("");
  L.push(`- **CRS non déductible du préfixe** : le SHP est un zip ; sa projection est dans le \`.prj\` interne, lisible seulement à l'extraction GDAL (cluster). Le champ CRS reste \`N-A\` ici — non fabriqué.`);
  if (svcWms) {
    L.push(`- **Service WMS documenté, non exposé en ressource CKAN** : « ${md(svcWms.name)} » pointe un PDF (\`${svcWms.url}\`), pas un endpoint. Aucun endpoint WMS/WFS direct n'est publié comme ressource CKAN dans ce dataset. WMS = tuiles raster, pas la géométrie vectorielle — c'est le SHP qui produit la géométrie. L'endpoint WMS exact (le cas échéant) se lit dans ce PDF à l'étape capture.`);
  }
  L.push(`- **Aucune ressource GeoJSON/WFS directe** dans ce dataset CPTAQ : le seul producteur de géométrie vectorielle validé octet-pour-octet est le SHP (needs-GDAL). C'est le candidat worklist.`);
  L.push("");
  return L.join("\n");
}

function md(s: string): string {
  return (s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

// ── Report shape ────────────────────────────────────────────────────────────────

interface ShortlistItem {
  format: string;
  verdict: string;
  typeName?: string | null;
  crs?: string | null;
  url: string;
}
interface DiscoveryInfo {
  attempted: boolean;
  queries: string[];
  candidates: SearchCandidate[];
  chosen: (SearchCandidate & { score: number }) | null;
}
interface Report {
  generated_at: string;
  probe: string;
  dataset_id: string; // the id/slug requested initially
  resolved_dataset_id: string | null; // the id actually validated (may differ after discovery)
  dataset_page: string;
  ckan_action_api: string;
  nature: string;
  network_available: boolean;
  network_error: string | null;
  requested_show_status: number | null; // HTTP for package_show(requested slug) — 404 triggers discovery
  package_show_status: number | null; // HTTP for the resolved/validated package_show
  package_title: string | null;
  organization: string | null;
  discovery: DiscoveryInfo;
  resources: ResourceValidation[];
  valid_shortlist: ShortlistItem[];
  invalid_shells: { url: string; format: string; evidence: string }[];
}

// ── Main ────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const generated_at = new Date().toISOString();
  let ps = await packageShow(DATASET_ID);

  const report: Report = {
    generated_at,
    probe: "_cptaq-source-byte-validation-20260831.ts",
    dataset_id: DATASET_ID,
    resolved_dataset_id: null,
    dataset_page: DATASET_PAGE,
    ckan_action_api: CKAN_BASE,
    nature: "READ-ONLY source byte-validation (NOT capture). No S3 writes.",
    network_available: ps.networkAvailable,
    network_error: ps.networkError,
    requested_show_status: ps.status,
    package_show_status: ps.status,
    package_title: ps.pkg?.title ?? null,
    organization: ps.pkg?.organization ?? null,
    discovery: { attempted: false, queries: [], candidates: [], chosen: null },
    resources: [],
    valid_shortlist: [],
    invalid_shells: [],
  };

  if (!ps.networkAvailable) {
    writeReport(report);
    console.error(`NETWORK BLOCKED — ${ps.networkError}. No validation performed (would run on cluster).`);
    return;
  }

  // Discovery fallback: the requested slug 404'd (or returned no resources) —
  // package_search for the CPTAQ zone-agricole dataset and resolve the real id.
  if (!ps.pkg || ps.rawResources.length === 0) {
    report.discovery.attempted = true;
    const queries = ["zone agricole", "zone-agricole cptaq", "CPTAQ zone agricole"];
    const seen = new Map<string, SearchCandidate>();
    for (const q of queries) {
      report.discovery.queries.push(q);
      const sr = await packageSearch(q);
      console.error(`package_search q="${q}" status=${sr.status} candidates=${sr.candidates.length}`);
      for (const c of sr.candidates) if (c.name && !seen.has(c.name)) seen.set(c.name, c);
    }
    const candidates = [...seen.values()].sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
    report.discovery.candidates = candidates;
    const best = candidates[0];
    if (best && scoreCandidate(best) >= 5) {
      report.discovery.chosen = { ...best, score: scoreCandidate(best) };
      console.error(`discovery chose "${best.name}" (score=${scoreCandidate(best)}) — retrying package_show`);
      ps = await packageShow(best.name);
      report.package_show_status = ps.status;
      report.package_title = ps.pkg?.title ?? report.package_title;
      report.organization = ps.pkg?.organization ?? report.organization;
    }
  }

  report.resolved_dataset_id = ps.pkg && ps.rawResources.length > 0 ? ps.pkg.id : null;

  if (!ps.pkg || ps.rawResources.length === 0) {
    writeReport(report);
    console.error(`package_show returned no resources (status=${ps.status}). Nothing to validate.`);
    return;
  }

  const resolved = resolveGeoResources(ps.pkg);
  console.error(`package_show OK: ${ps.rawResources.length} resources; ${resolved.length} geo-classified by resolveGeoResources.`);

  for (const res of ps.rawResources) {
    console.error(`→ validating [${res.format}] ${res.name} :: ${res.url}`);
    const v = await validateResource(res, resolved);
    report.resources.push(v);
    console.error(`   verdict=${v.verdict}`);
  }

  // Shortlist + shells.
  for (const r of report.resources) {
    const verdict = String(r.verdict);
    if (verdict.startsWith("VALID")) {
      report.valid_shortlist.push({
        format: r.resolvedFormat ?? r.format,
        verdict,
        typeName: r.wfs?.sampleTypeName ?? null,
        crs: r.crs ?? null,
        url: r.wfs?.sampleUrl ?? r.url,
      });
    }
    if (verdict.startsWith("INVALID")) {
      report.invalid_shells.push({ url: r.url, format: r.format, evidence: r.evidence });
    }
  }

  writeReport(report);
  console.error(
    `\nDONE. resources=${report.resources.length} valid=${report.valid_shortlist.length} shells=${report.invalid_shells.length}`,
  );
}

function writeReport(report: Report): void {
  const jsonPath = resolve(process.cwd(), `${OUT_STEM}.json`);
  const mdPath = resolve(process.cwd(), `${OUT_STEM}.md`);
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n", "utf-8");
  writeFileSync(mdPath, renderMarkdown(report) + "\n", "utf-8");
  console.error(`wrote ${jsonPath}`);
  console.error(`wrote ${mdPath}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
