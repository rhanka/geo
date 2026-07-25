import { createHash } from "node:crypto";

/**
 * Read-only source fencing and content-manifest primitives for Saint-Amable's
 * official ArcGIS zone -> PDF grid source.
 *
 * This module deliberately has no filesystem, S3, Track or publication
 * dependency. Its only effectful seam is an injected WHATWG `fetch`, and every
 * request made through that seam is an explicit GET with manual redirect
 * validation.
 */

export class ArcgisZonePdfStageError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: string,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
    cause?: unknown,
  ) {
    super(`${code}: ${message}`, cause === undefined ? undefined : { cause });
    this.name = "ArcgisZonePdfStageError";
    this.code = code;
    this.details = details;
  }
}

function fail(
  code: string,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): never {
  throw new ArcgisZonePdfStageError(code, message, details);
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("INVALID_ARCGIS_RESPONSE", `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function nonBlankString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail("INVALID_ARCGIS_RESPONSE", `${label} must be a non-blank string`, { value });
  }
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail("INVALID_ARCGIS_RESPONSE", `${label} must be a non-negative safe integer`, { value });
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = nonNegativeInteger(value, label);
  if (parsed === 0) fail("INVALID_ARCGIS_RESPONSE", `${label} must be positive`, { value });
  return parsed;
}

/** Narrow normalization only: typography/case/spacing, never semantic rewrites. */
export function canonicalZoneCode(raw: string): string {
  const canonical = raw
    .normalize("NFKC")
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .trim()
    .toUpperCase()
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, "");
  if (!/^[A-Z][A-Z0-9]*-\d+$/.test(canonical)) {
    fail("INVALID_ZONE_CODE", "zone code is outside the frozen prefix-number grammar", {
      raw,
      canonical,
    });
  }
  return canonical;
}

export interface ValidatedSourceRecord {
  oid: number;
  rawCode: string;
  code: string;
  pdfUrl: string;
  itemId: string;
  hyperlink: string;
  group: string;
  groupCode: string;
}

export interface ValidateSourceRecordOptions {
  expectedCount: number;
  pdfHosts: readonly string[];
  sourceGroupExceptions?: readonly SourceGroupException[];
}

export interface SourceGroupException {
  oid: number;
  code: string;
  groupCode: string;
}

export function assertAllowedHttpsUrl(rawUrl: string, allowedHosts: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return fail("INVALID_URL", "URL cannot be parsed", { url: rawUrl });
  }
  if (url.protocol !== "https:") {
    fail("URL_HTTPS_REQUIRED", "only HTTPS source URLs are allowed", { url: rawUrl });
  }
  if (url.port !== "") {
    fail("URL_PORT_NOT_ALLOWED", "source URLs must use the default HTTPS port", {
      url: rawUrl,
      port: url.port,
    });
  }
  const allowed = new Set(allowedHosts.map((host) => host.toLowerCase()));
  if (!allowed.has(url.hostname.toLowerCase())) {
    fail("URL_HOST_NOT_ALLOWED", "URL host is outside the exact allowlist", {
      url: rawUrl,
      host: url.hostname,
      allowedHosts: [...allowed],
    });
  }
  if (url.username !== "" || url.password !== "") {
    fail("URL_CREDENTIALS_FORBIDDEN", "source URLs must not contain credentials", { url: rawUrl });
  }
  return url;
}

export interface PinnedArcgisPdfRedirectOptions {
  redirectHost: string;
  itemDataPathPrefix: string;
  expectedItemId: string;
  expectedCode: string;
}

/** Validate ArcGIS' signed itemdata redirect without trusting its transient query. */
export function assertPinnedArcgisPdfRedirect(
  rawUrl: string,
  options: PinnedArcgisPdfRedirectOptions,
): URL {
  const url = assertAllowedHttpsUrl(rawUrl, [options.redirectHost]);
  const prefix = options.itemDataPathPrefix.replace(/\/$/, "");
  if (!prefix.startsWith("/itemdata/") || prefix.includes("..")) {
    fail("INVALID_CONFIGURATION", "ArcGIS itemdata path prefix is invalid", {
      itemDataPathPrefix: options.itemDataPathPrefix,
    });
  }
  const expectedPath = `${prefix}/${options.expectedItemId}/${options.expectedCode}.pdf`;
  if (url.pathname !== expectedPath || url.hash !== "") {
    fail("PDF_REDIRECT_TARGET_MISMATCH", "ArcGIS PDF redirect target is outside the pinned path", {
      expectedHost: options.redirectHost,
      expectedPath,
      actualHost: url.hostname,
      actualPath: url.pathname,
      hasFragment: url.hash !== "",
    });
  }
  return url;
}

function itemIdFromPdfUrl(rawUrl: string, pdfHosts: readonly string[]): string {
  const url = assertAllowedHttpsUrl(rawUrl, pdfHosts);
  if (url.search !== "" || url.hash !== "") {
    fail("INVALID_PDF_URL", "ArcGIS item data URL must not carry query or fragment data", {
      url: rawUrl,
    });
  }
  const match = url.pathname.match(
    /^\/sharing\/rest\/content\/items\/([a-f0-9]{32})\/data\/?$/i,
  );
  if (!match) {
    fail("INVALID_PDF_URL", "PDF URL is not an ArcGIS item data endpoint", { url: rawUrl });
  }
  return match[1]!.toLowerCase();
}

function hyperlinkHref(html: string): string {
  const match = html.match(/\bhref\s*=\s*(["'])([^"']+)\1/i);
  if (!match) fail("INVALID_HYPERLINK", "hyperlien does not contain a quoted href", { html });
  return match[2]!;
}

export function validateSourceRecords(
  rawRecords: readonly Record<string, unknown>[],
  options: ValidateSourceRecordOptions,
): ValidatedSourceRecord[] {
  if (!Number.isSafeInteger(options.expectedCount) || options.expectedCount < 1) {
    fail("INVALID_CONFIGURATION", "expectedCount must be a positive safe integer");
  }
  if (rawRecords.length !== options.expectedCount) {
    fail("SOURCE_COUNT_MISMATCH", "source record count does not match the fenced count", {
      expected: options.expectedCount,
      actual: rawRecords.length,
    });
  }

  const oidSeen = new Set<number>();
  const codeSeen = new Map<string, string>();
  const pdfSeen = new Map<string, string>();
  const itemSeen = new Map<string, string>();
  const validated: ValidatedSourceRecord[] = [];
  const sourceGroupExceptions = new Map<number, SourceGroupException>();
  for (const exception of options.sourceGroupExceptions ?? []) {
    const oid = positiveInteger(exception.oid, "source group exception OID");
    if (
      exception.code !== canonicalZoneCode(exception.code) ||
      !/^[A-Z][A-Z0-9]*$/.test(exception.groupCode)
    ) {
      fail("INVALID_CONFIGURATION", "source group exception is not canonical", { exception });
    }
    if (sourceGroupExceptions.has(oid)) {
      fail("INVALID_CONFIGURATION", "duplicate source group exception OID", { oid });
    }
    sourceGroupExceptions.set(oid, exception);
  }
  const observedSourceGroupExceptions = new Set<number>();

  for (const raw of rawRecords) {
    const oid = positiveInteger(raw.id, "feature id/OID");
    if (oidSeen.has(oid)) fail("DUPLICATE_OID", "duplicate source OID", { oid });
    oidSeen.add(oid);

    const rawCode = nonBlankString(raw.zones, `zones for OID ${oid}`);
    const code = canonicalZoneCode(rawCode);
    const priorRawCode = codeSeen.get(code);
    if (priorRawCode !== undefined) {
      if (priorRawCode !== rawCode) {
        fail("CANONICAL_CODE_COLLISION", "distinct raw zone codes canonicalize to one code", {
          code,
          firstRawCode: priorRawCode,
          secondRawCode: rawCode,
        });
      }
      fail("DUPLICATE_CODE", "duplicate canonical zone code", { code });
    }
    codeSeen.set(code, rawCode);

    const pdfUrl = nonBlankString(raw.pdf, `pdf for OID ${oid}`);
    const itemId = itemIdFromPdfUrl(pdfUrl, options.pdfHosts);
    const priorPdfCode = pdfSeen.get(pdfUrl);
    if (priorPdfCode !== undefined) {
      fail("DUPLICATE_PDF", "one PDF URL is assigned to multiple zones", {
        pdfUrl,
        firstCode: priorPdfCode,
        secondCode: code,
      });
    }
    pdfSeen.set(pdfUrl, code);
    const priorItemCode = itemSeen.get(itemId);
    if (priorItemCode !== undefined) {
      fail("DUPLICATE_ITEM_ID", "one ArcGIS item is assigned to multiple zones", {
        itemId,
        firstCode: priorItemCode,
        secondCode: code,
      });
    }
    itemSeen.set(itemId, code);

    const hyperlink = nonBlankString(raw.hyperlien, `hyperlien for OID ${oid}`);
    const href = hyperlinkHref(hyperlink);
    assertAllowedHttpsUrl(href, options.pdfHosts);
    if (href !== pdfUrl) {
      fail("PDF_HYPERLINK_MISMATCH", "hyperlien href does not exactly corroborate pdf", {
        code,
        pdfUrl,
        href,
      });
    }

    const group = nonBlankString(raw.groupe, `groupe for OID ${oid}`);
    const separator = group.indexOf("|");
    if (separator < 1) fail("INVALID_GROUP", "groupe must contain a code and label separated by |", { code, group });
    const groupCode = group.slice(0, separator).trim().toUpperCase().replace(/\s+/g, "");
    const zonePrefix = code.slice(0, code.indexOf("-"));
    if (groupCode !== zonePrefix) {
      const exception = sourceGroupExceptions.get(oid);
      if (
        exception === undefined ||
        exception.code !== code ||
        exception.groupCode !== groupCode
      ) {
        fail("GROUP_CODE_MISMATCH", "groupe code contradicts the canonical zone prefix", {
          oid,
          code,
          group,
          groupCode,
          zonePrefix,
        });
      }
      observedSourceGroupExceptions.add(oid);
    }

    validated.push({ oid, rawCode, code, pdfUrl, itemId, hyperlink, group, groupCode });
  }

  if (observedSourceGroupExceptions.size !== sourceGroupExceptions.size) {
    fail("SOURCE_GROUP_EXCEPTION_NOT_OBSERVED", "a frozen source group exception is no longer exact", {
      configured: [...sourceGroupExceptions.values()],
      observedOids: [...observedSourceGroupExceptions],
    });
  }

  return validated.sort((left, right) => left.oid - right.oid);
}

export interface SourceEditingFence {
  lastEditDate: number;
  schemaLastEditDate: number;
  dataLastEditDate: number;
}

export interface SourceFence {
  serviceItemId: string;
  serviceModified: number;
  layerUrl: string;
  objectIdField: string;
  editing: SourceEditingFence;
  count: number;
  objectIds: number[];
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalJsonValue(child)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalJsonValue(value));
}

export function assertStableSourceFence(t0: SourceFence, t1: SourceFence): void {
  if (canonicalJson(t0) !== canonicalJson(t1)) {
    fail("SOURCE_FENCE_MOVED", "FeatureService fence changed between T0 and T1", { t0, t1 });
  }
}

export function chunkSortedObjectIds(objectIds: readonly number[], chunkSize: number): number[][] {
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1) {
    fail("INVALID_CONFIGURATION", "OID chunk size must be a positive safe integer", { chunkSize });
  }
  const sorted = objectIds.map((oid) => positiveInteger(oid, "OID")).sort((a, b) => a - b);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index] === sorted[index - 1]) {
      fail("DUPLICATE_OID", "duplicate OID in source fence", { oid: sorted[index] });
    }
  }
  const chunks: number[][] = [];
  for (let index = 0; index < sorted.length; index += chunkSize) {
    chunks.push(sorted.slice(index, index + chunkSize));
  }
  return chunks;
}

export interface AllowedFetchResult {
  response: Response;
  finalUrl: string;
  redirectChain: string[];
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export async function fetchFollowingAllowedRedirects(
  fetchImpl: typeof fetch,
  rawUrl: string,
  allowedHosts: readonly string[],
  options: {
    maxRedirects?: number;
    accept?: string;
    redirectHosts?: readonly string[];
    onRedirect?: (target: URL, redirectIndex: number) => void;
  } = {},
): Promise<AllowedFetchResult> {
  const maxRedirects = options.maxRedirects ?? 5;
  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 10) {
    fail("INVALID_CONFIGURATION", "maxRedirects must be between 0 and 10", { maxRedirects });
  }
  let currentUrl = assertAllowedHttpsUrl(rawUrl, allowedHosts).toString();
  const redirectChain: string[] = [];

  for (let redirectCount = 0; ; redirectCount += 1) {
    const response = await fetchImpl(currentUrl, {
      method: "GET",
      redirect: "manual",
      headers: {
        accept: options.accept ?? "*/*",
        "user-agent": "geo-saint-amable-zonepdf-stage/1.0",
      },
    });
    if (!REDIRECT_STATUSES.has(response.status)) {
      return { response, finalUrl: currentUrl, redirectChain };
    }
    if (redirectCount >= maxRedirects) {
      fail("TOO_MANY_REDIRECTS", "redirect limit exceeded", { rawUrl, redirectChain });
    }
    const location = response.headers.get("location");
    if (!location) fail("REDIRECT_LOCATION_MISSING", "redirect response has no Location header", { currentUrl });
    const nextUrl = new URL(location, currentUrl).toString();
    const target = assertAllowedHttpsUrl(nextUrl, options.redirectHosts ?? allowedHosts);
    options.onRedirect?.(target, redirectCount);
    redirectChain.push(nextUrl);
    currentUrl = nextUrl;
  }
}

export interface ArcgisItemMetadata {
  id: string;
  owner: string;
  title: string;
  type: string;
  access: string;
  created: number;
  modified: number;
  size: number;
}

export interface ValidateItemMetadataOptions {
  expectedItemId: string;
  expectedCode: string;
  expectedOwner: string;
  maxBytes: number;
}

export function validateArcgisItemMetadata(
  rawValue: unknown,
  options: ValidateItemMetadataOptions,
): ArcgisItemMetadata {
  const raw = objectValue(rawValue, "ArcGIS item metadata");
  const item: ArcgisItemMetadata = {
    id: nonBlankString(raw.id, "item id").toLowerCase(),
    owner: nonBlankString(raw.owner, "item owner"),
    title: nonBlankString(raw.title, "item title"),
    type: nonBlankString(raw.type, "item type"),
    access: nonBlankString(raw.access, "item access"),
    created: nonNegativeInteger(raw.created, "item created"),
    modified: nonNegativeInteger(raw.modified, "item modified"),
    size: positiveInteger(raw.size, "item size"),
  };
  if (item.id !== options.expectedItemId.toLowerCase()) {
    fail("ITEM_ID_MISMATCH", "ArcGIS metadata id differs from the source URL item id", {
      expected: options.expectedItemId,
      actual: item.id,
    });
  }
  if (item.owner !== options.expectedOwner) {
    fail("ITEM_OWNER_MISMATCH", "ArcGIS item owner is not the pinned source owner", {
      expected: options.expectedOwner,
      actual: item.owner,
      itemId: item.id,
    });
  }
  let titleCode: string | null = null;
  try {
    titleCode = canonicalZoneCode(item.title);
  } catch (error) {
    if (!(error instanceof ArcgisZonePdfStageError)) throw error;
  }
  if (titleCode !== options.expectedCode) {
    fail("ITEM_TITLE_MISMATCH", "ArcGIS item title does not identify the expected zone", {
      expected: options.expectedCode,
      actual: item.title,
      itemId: item.id,
    });
  }
  if (item.type !== "PDF") {
    fail("ITEM_TYPE_MISMATCH", "ArcGIS item is not a PDF", { itemId: item.id, actual: item.type });
  }
  if (item.access !== "public") {
    fail("ITEM_ACCESS_MISMATCH", "ArcGIS item is not public", { itemId: item.id, actual: item.access });
  }
  if (item.created > item.modified) {
    fail("ITEM_TIMESTAMP_INVALID", "ArcGIS item modified precedes created", { item });
  }
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 || item.size > options.maxBytes) {
    fail("ITEM_SIZE_OUT_OF_RANGE", "ArcGIS item size exceeds the configured bound", {
      itemId: item.id,
      size: item.size,
      maxBytes: options.maxBytes,
    });
  }
  return item;
}

export function assertStableItemMetadata(t0: ArcgisItemMetadata, t1: ArcgisItemMetadata): void {
  if (canonicalJson(t0) !== canonicalJson(t1)) {
    fail("ITEM_METADATA_MOVED", "ArcGIS item metadata changed across the PDF download", {
      itemId: t0.id,
      t0,
      t1,
    });
  }
}

export interface PdfIntegrityOptions {
  expectedBytes: number;
  contentLength: string | null;
  contentType: string | null;
  minBytes: number;
  maxBytes: number;
}

export interface PdfIntegrity {
  byteLength: number;
  pageCount: number;
  /** Raw `/Type /Page` object occurrences; exceeds pageCount when a revision is superseded. */
  pageObjectCount: number;
  sha256: string;
}

/**
 * A PDF's page count is the page tree root's `/Count`, not the number of `/Type /Page`
 * occurrences: an incremental update appends the new revision and keeps the superseded
 * page object, so a legitimate one-page grid can carry several. Fixtures with no page
 * tree fall back to the object count. Divergent page trees fail closed rather than guess.
 */
export function readPdfPageCount(text: string): { pageCount: number; pageObjectCount: number } {
  const pageObjectCount = text.match(/\/Type\s*\/Page\b/g)?.length ?? 0;
  const treeCounts: number[] = [];
  // Scan object bodies so a /Count never binds across an object boundary.
  for (const object of text.matchAll(/\d+\s+\d+\s+obj\b([\s\S]*?)endobj/g)) {
    const body = object[1] ?? "";
    if (!/\/Type\s*\/Pages\b/.test(body)) continue;
    const count = /\/Count\s+(\d+)/.exec(body);
    if (count) treeCounts.push(Number(count[1]));
  }
  if (treeCounts.length === 0) return { pageCount: pageObjectCount, pageObjectCount };
  const distinct = [...new Set(treeCounts)];
  if (distinct.length > 1) {
    fail("PDF_PAGE_TREE_AMBIGUOUS", "PDF declares divergent page tree counts", {
      treeCounts,
      pageObjectCount,
    });
  }
  return { pageCount: distinct[0]!, pageObjectCount };
}

export function validatePdfBytes(bytes: Uint8Array, options: PdfIntegrityOptions): PdfIntegrity {
  const body = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (body.length < options.minBytes || body.length > options.maxBytes) {
    fail("PDF_SIZE_OUT_OF_RANGE", "downloaded PDF size is outside configured bounds", {
      byteLength: body.length,
      minBytes: options.minBytes,
      maxBytes: options.maxBytes,
    });
  }
  if (body.length !== options.expectedBytes) {
    fail("PDF_ITEM_SIZE_MISMATCH", "downloaded bytes differ from the fenced item size", {
      expected: options.expectedBytes,
      actual: body.length,
    });
  }
  if (options.contentLength !== null) {
    if (!/^\d+$/.test(options.contentLength) || Number(options.contentLength) !== body.length) {
      fail("PDF_CONTENT_LENGTH_MISMATCH", "Content-Length differs from downloaded bytes", {
        contentLength: options.contentLength,
        byteLength: body.length,
      });
    }
  }
  const mediaType = options.contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (mediaType !== "application/pdf") {
    fail("PDF_CONTENT_TYPE_MISMATCH", "download response is not application/pdf", {
      contentType: options.contentType,
    });
  }
  if (body.subarray(0, 5).toString("ascii") !== "%PDF-") {
    fail("PDF_MAGIC_MISMATCH", "downloaded bytes do not start with PDF magic");
  }
  const trailerWindow = body.subarray(Math.max(0, body.length - 2048)).toString("latin1");
  if (!/%%EOF\s*$/.test(trailerWindow)) {
    fail("PDF_TRAILER_MISSING", "PDF has no terminal %%EOF marker");
  }
  const text = body.toString("latin1");
  const { pageCount, pageObjectCount } = readPdfPageCount(text);
  if (pageCount !== 1) {
    fail("PDF_PAGE_COUNT_MISMATCH", "official zone grid must contain exactly one page", {
      pageCount,
      pageObjectCount,
    });
  }
  return {
    byteLength: body.length,
    pageCount,
    pageObjectCount,
    sha256: createHash("sha256").update(body).digest("hex"),
  };
}

/** Read a response through a hard cap, with a Content-Length preflight when available. */
export async function readResponseBytesBounded(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    fail("INVALID_CONFIGURATION", "response byte cap must be a positive safe integer", {
      maxBytes,
    });
  }
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength) || !Number.isSafeInteger(Number(contentLength))) {
      fail("PDF_CONTENT_LENGTH_MISMATCH", "Content-Length is not a safe non-negative integer", {
        contentLength,
      });
    }
    if (Number(contentLength) > maxBytes) {
      try {
        await response.body?.cancel("declared PDF response exceeded byte cap");
      } catch {
        // Cancellation is connection hygiene only; preserve the domain failure below.
      }
      fail("PDF_RESPONSE_SIZE_LIMIT", "declared PDF response exceeds the in-memory byte cap", {
        contentLength,
        maxBytes,
      });
    }
  }

  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    for (;;) {
      const read = await reader.read();
      if (read.done) break;
      if (read.value === undefined) continue;
      byteLength += read.value.byteLength;
      if (byteLength > maxBytes) {
        try {
          await reader.cancel("PDF response exceeded byte cap");
        } catch {
          // Cancellation is best effort; never mask the bounded-read failure.
        }
        fail("PDF_RESPONSE_SIZE_LIMIT", "streamed PDF response exceeds the in-memory byte cap", {
          byteLength,
          maxBytes,
        });
      }
      chunks.push(read.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export interface PdfEvidence extends PdfIntegrity {
  finalUrl: string;
  redirectChain: string[];
  contentType: string;
  contentLength: number;
}

export interface ZonePdfManifestEntryInput {
  source: ValidatedSourceRecord;
  itemT0: ArcgisItemMetadata;
  itemT1: ArcgisItemMetadata;
  pdf: PdfEvidence;
}

export interface ZonePdfManifestRecord extends ValidatedSourceRecord {
  itemT0: ArcgisItemMetadata;
  itemT1: ArcgisItemMetadata;
  pdf: PdfEvidence;
}

export interface ZonePdfContentManifest {
  schemaVersion: 1;
  sourceT0: SourceFence;
  sourceT1: SourceFence;
  records: ZonePdfManifestRecord[];
  manifestSha256: string;
}

function stableManifestUrl(rawUrl: string, label: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return fail("INVALID_URL", `${label} cannot be parsed`, { url: rawUrl });
  }
  url.search = "";
  url.hash = "";
  return url.toString();
}

function stablePdfEvidence(pdf: PdfEvidence): PdfEvidence {
  return {
    ...pdf,
    finalUrl: stableManifestUrl(pdf.finalUrl, "PDF final URL"),
    redirectChain: pdf.redirectChain.map((url, index) =>
      stableManifestUrl(url, `PDF redirect URL ${index + 1}`),
    ),
  };
}

export function buildZonePdfContentManifest(
  sourceT0: SourceFence,
  sourceT1: SourceFence,
  entries: readonly ZonePdfManifestEntryInput[],
): ZonePdfContentManifest {
  assertStableSourceFence(sourceT0, sourceT1);
  if (entries.length !== sourceT0.count) {
    fail("MANIFEST_COUNT_MISMATCH", "manifest entry count differs from source fence", {
      expected: sourceT0.count,
      actual: entries.length,
    });
  }
  const sortedEntries = [...entries].sort((left, right) => left.source.oid - right.source.oid);
  const expectedOids = [...sourceT0.objectIds].sort((a, b) => a - b);
  const actualOids = sortedEntries.map((entry) => entry.source.oid);
  if (canonicalJson(expectedOids) !== canonicalJson(actualOids)) {
    fail("MANIFEST_OID_SET_MISMATCH", "manifest OID set differs from source fence", {
      expectedOids,
      actualOids,
    });
  }
  const records = sortedEntries.map((entry) => {
    assertStableItemMetadata(entry.itemT0, entry.itemT1);
    if (entry.itemT0.id !== entry.source.itemId) {
      fail("ITEM_ID_MISMATCH", "manifest item metadata differs from source item", {
        code: entry.source.code,
        sourceItemId: entry.source.itemId,
        metadataItemId: entry.itemT0.id,
      });
    }
    if (entry.pdf.byteLength !== entry.itemT0.size || entry.pdf.pageCount !== 1) {
      fail("PDF_EVIDENCE_MISMATCH", "PDF evidence contradicts fenced item metadata", {
        code: entry.source.code,
        itemSize: entry.itemT0.size,
        pdf: entry.pdf,
      });
    }
    if (!/^[a-f0-9]{64}$/.test(entry.pdf.sha256)) {
      fail("PDF_SHA256_INVALID", "PDF evidence has an invalid SHA-256", {
        code: entry.source.code,
        sha256: entry.pdf.sha256,
      });
    }
    return {
      ...entry.source,
      itemT0: entry.itemT0,
      itemT1: entry.itemT1,
      pdf: stablePdfEvidence(entry.pdf),
    };
  });
  const payload = { schemaVersion: 1 as const, sourceT0, sourceT1, records };
  return {
    ...payload,
    manifestSha256: createHash("sha256").update(canonicalJson(payload)).digest("hex"),
  };
}

export interface ArcgisZonePdfSourceConfig {
  layerUrl: string;
  portalUrl: string;
  serviceItemId: string;
  expectedCount: number;
  expectedItemOwner: string;
  sourceHosts: readonly string[];
  portalHosts: readonly string[];
  pdfHosts: readonly string[];
  pdfRedirectHost: string;
  pdfItemDataPathPrefix: string;
  sourceGroupExceptions: readonly SourceGroupException[];
  oidChunkSize: number;
  minPdfBytes: number;
  maxPdfBytes: number;
}

export const SAINT_AMABLE_ZONEPDF_SOURCE: ArcgisZonePdfSourceConfig = {
  layerUrl:
    "https://services3.arcgis.com/D6yGeV5bY0BWDvJi/arcgis/rest/services/Plan_de_zonage_WFL1/FeatureServer/0",
  portalUrl: "https://mrcdemdy.maps.arcgis.com",
  serviceItemId: "8d02d8f25e9648de9972663e930d3b11",
  expectedCount: 109,
  expectedItemOwner: "melement",
  sourceHosts: ["services3.arcgis.com"],
  portalHosts: ["mrcdemdy.maps.arcgis.com"],
  pdfHosts: ["mrcdemdy.maps.arcgis.com"],
  pdfRedirectHost: "www.arcgis.com",
  pdfItemDataPathPrefix: "/itemdata/92d347a7683b26a11dab76ccf9a5cac2",
  sourceGroupExceptions: [{ oid: 71, code: "A4-106", groupCode: "A3" }],
  oidChunkSize: 50,
  minPdfBytes: 1_024,
  maxPdfBytes: 20 * 1024 * 1024,
};

function urlWithParams(base: string, params: Readonly<Record<string, string>>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

async function fetchJson(
  fetchImpl: typeof fetch,
  url: string,
  allowedHosts: readonly string[],
): Promise<Record<string, unknown>> {
  const result = await fetchFollowingAllowedRedirects(fetchImpl, url, allowedHosts, {
    accept: "application/json",
  });
  if (!result.response.ok) {
    fail("HTTP_STATUS_ERROR", "ArcGIS JSON request failed", {
      url,
      status: result.response.status,
    });
  }
  const json = objectValue(await result.response.json(), "ArcGIS JSON response");
  if (json.error !== undefined && json.error !== null) {
    fail("ARCGIS_ERROR", "ArcGIS returned an error object", { url, error: json.error });
  }
  return json;
}

function itemMetadataUrl(config: ArcgisZonePdfSourceConfig, itemId: string): string {
  return urlWithParams(`${config.portalUrl}/sharing/rest/content/items/${itemId}`, { f: "json" });
}

export async function readSourceFence(
  fetchImpl: typeof fetch,
  config: ArcgisZonePdfSourceConfig = SAINT_AMABLE_ZONEPDF_SOURCE,
): Promise<SourceFence> {
  assertAllowedHttpsUrl(config.layerUrl, config.sourceHosts);
  assertAllowedHttpsUrl(config.portalUrl, config.portalHosts);
  const queryUrl = `${config.layerUrl.replace(/\/$/, "")}/query`;
  const [serviceItem, layer, countResponse, idsResponse] = await Promise.all([
    fetchJson(fetchImpl, itemMetadataUrl(config, config.serviceItemId), config.portalHosts),
    fetchJson(fetchImpl, urlWithParams(config.layerUrl, { f: "json" }), config.sourceHosts),
    fetchJson(
      fetchImpl,
      urlWithParams(queryUrl, { where: "1=1", returnCountOnly: "true", f: "json" }),
      config.sourceHosts,
    ),
    fetchJson(
      fetchImpl,
      urlWithParams(queryUrl, { where: "1=1", returnIdsOnly: "true", f: "json" }),
      config.sourceHosts,
    ),
  ]);
  const serviceItemId = nonBlankString(serviceItem.id, "FeatureService item id").toLowerCase();
  if (serviceItemId !== config.serviceItemId.toLowerCase()) {
    fail("SERVICE_ITEM_ID_MISMATCH", "FeatureService item metadata id moved", {
      expected: config.serviceItemId,
      actual: serviceItemId,
    });
  }
  const layerServiceItemId = nonBlankString(layer.serviceItemId, "layer serviceItemId").toLowerCase();
  if (layerServiceItemId !== serviceItemId) {
    fail("SERVICE_ITEM_ID_MISMATCH", "layer and portal item identities differ", {
      layerServiceItemId,
      serviceItemId,
    });
  }
  const editingRaw = objectValue(layer.editingInfo, "layer editingInfo");
  const objectIdField = nonBlankString(
    layer.objectIdField ?? idsResponse.objectIdFieldName,
    "objectIdField",
  );
  if (objectIdField !== "id") {
    fail("OBJECT_ID_FIELD_MISMATCH", "Saint-Amable layer OID field is no longer id", {
      objectIdField,
    });
  }
  const count = nonNegativeInteger(countResponse.count, "FeatureService count");
  if (!Array.isArray(idsResponse.objectIds)) {
    fail("INVALID_ARCGIS_RESPONSE", "returnIdsOnly response has no objectIds array");
  }
  const chunks = chunkSortedObjectIds(idsResponse.objectIds as number[], Math.max(1, config.oidChunkSize));
  const objectIds = chunks.flat();
  if (count !== objectIds.length || count !== config.expectedCount) {
    fail("SOURCE_COUNT_MISMATCH", "count, OID set and configured count do not agree", {
      count,
      oidCount: objectIds.length,
      expectedCount: config.expectedCount,
    });
  }
  return {
    serviceItemId,
    serviceModified: nonNegativeInteger(serviceItem.modified, "FeatureService item modified"),
    layerUrl: config.layerUrl,
    objectIdField,
    editing: {
      lastEditDate: nonNegativeInteger(editingRaw.lastEditDate, "editingInfo.lastEditDate"),
      schemaLastEditDate: nonNegativeInteger(
        editingRaw.schemaLastEditDate,
        "editingInfo.schemaLastEditDate",
      ),
      dataLastEditDate: nonNegativeInteger(
        editingRaw.dataLastEditDate,
        "editingInfo.dataLastEditDate",
      ),
    },
    count,
    objectIds,
  };
}

export async function querySourceRecordsByOidChunks(
  fetchImpl: typeof fetch,
  fence: SourceFence,
  config: ArcgisZonePdfSourceConfig = SAINT_AMABLE_ZONEPDF_SOURCE,
): Promise<ValidatedSourceRecord[]> {
  const queryUrl = `${config.layerUrl.replace(/\/$/, "")}/query`;
  const rawRecords: Record<string, unknown>[] = [];
  for (const objectIds of chunkSortedObjectIds(fence.objectIds, config.oidChunkSize)) {
    const response = await fetchJson(
      fetchImpl,
      urlWithParams(queryUrl, {
        objectIds: objectIds.join(","),
        outFields: "id,zones,pdf,hyperlien,groupe",
        returnGeometry: "false",
        orderByFields: "id ASC",
        f: "json",
      }),
      config.sourceHosts,
    );
    if (!Array.isArray(response.features)) {
      fail("INVALID_ARCGIS_RESPONSE", "feature query response has no features array");
    }
    if (response.exceededTransferLimit === true) {
      fail("SOURCE_QUERY_TRUNCATED", "OID chunk response exceeded the transfer limit", {
        objectIds,
      });
    }
    for (const feature of response.features) {
      const featureObject = objectValue(feature, "feature");
      rawRecords.push(objectValue(featureObject.attributes, "feature attributes"));
    }
  }
  const records = validateSourceRecords(rawRecords, {
    expectedCount: fence.count,
    pdfHosts: config.pdfHosts,
    sourceGroupExceptions: config.sourceGroupExceptions,
  });
  const expectedOids = [...fence.objectIds].sort((a, b) => a - b);
  if (canonicalJson(records.map((record) => record.oid)) !== canonicalJson(expectedOids)) {
    fail("SOURCE_QUERY_OID_SET_MISMATCH", "feature chunks do not reproduce the fenced OID set", {
      expectedOids,
      actualOids: records.map((record) => record.oid),
    });
  }
  return records;
}

async function readValidatedItemMetadata(
  fetchImpl: typeof fetch,
  source: ValidatedSourceRecord,
  config: ArcgisZonePdfSourceConfig,
): Promise<ArcgisItemMetadata> {
  const raw = await fetchJson(fetchImpl, itemMetadataUrl(config, source.itemId), config.portalHosts);
  return validateArcgisItemMetadata(raw, {
    expectedItemId: source.itemId,
    expectedCode: source.code,
    expectedOwner: config.expectedItemOwner,
    maxBytes: config.maxPdfBytes,
  });
}

export async function fetchPinnedArcgisPdfDownload(
  fetchImpl: typeof fetch,
  source: Pick<ValidatedSourceRecord, "pdfUrl" | "itemId" | "code">,
  config: Pick<
    ArcgisZonePdfSourceConfig,
    "pdfHosts" | "pdfRedirectHost" | "pdfItemDataPathPrefix"
  >,
): Promise<AllowedFetchResult> {
  const download = await fetchFollowingAllowedRedirects(
    fetchImpl,
    source.pdfUrl,
    config.pdfHosts,
    {
      accept: "application/pdf",
      redirectHosts: [config.pdfRedirectHost],
      onRedirect: (target, redirectIndex) => {
        if (redirectIndex !== 0) {
          fail("PDF_REDIRECT_CHAIN_MISMATCH", "ArcGIS PDF download has more than one redirect", {
            code: source.code,
            redirectIndex,
          });
        }
        assertPinnedArcgisPdfRedirect(target.toString(), {
          redirectHost: config.pdfRedirectHost,
          itemDataPathPrefix: config.pdfItemDataPathPrefix,
          expectedItemId: source.itemId,
          expectedCode: source.code,
        });
      },
    },
  );
  if (download.redirectChain.length !== 1) {
    fail("PDF_REDIRECT_CHAIN_MISMATCH", "ArcGIS PDF download must use its single pinned redirect", {
      code: source.code,
      redirectCount: download.redirectChain.length,
    });
  }
  return download;
}

function rethrowWithSourceContext(error: unknown, source: ValidatedSourceRecord): never {
  if (!(error instanceof ArcgisZonePdfStageError)) throw error;
  const prefix = `${error.code}: `;
  const originalMessage = error.message.startsWith(prefix)
    ? error.message.slice(prefix.length)
    : error.message;
  throw new ArcgisZonePdfStageError(
    error.code,
    `zone ${source.code} PDF collection failed: ${originalMessage}`,
    {
      ...error.details,
      oid: source.oid,
      zoneCode: source.code,
      itemId: source.itemId,
    },
    error,
  );
}

async function collectZonePdfManifestEntry(
  fetchImpl: typeof fetch,
  source: ValidatedSourceRecord,
  config: ArcgisZonePdfSourceConfig,
): Promise<ZonePdfManifestEntryInput> {
  try {
    const itemT0 = await readValidatedItemMetadata(fetchImpl, source, config);
    const download = await fetchPinnedArcgisPdfDownload(fetchImpl, source, config);
    if (!download.response.ok) {
      fail("HTTP_STATUS_ERROR", "ArcGIS PDF download failed", {
        code: source.code,
        status: download.response.status,
      });
    }
    const body = await readResponseBytesBounded(
      download.response,
      Math.min(itemT0.size, config.maxPdfBytes),
    );
    const integrity = validatePdfBytes(body, {
      expectedBytes: itemT0.size,
      contentLength: download.response.headers.get("content-length"),
      contentType: download.response.headers.get("content-type"),
      minBytes: config.minPdfBytes,
      maxBytes: config.maxPdfBytes,
    });
    const itemT1 = await readValidatedItemMetadata(fetchImpl, source, config);
    assertStableItemMetadata(itemT0, itemT1);
    return {
      source,
      itemT0,
      itemT1,
      pdf: {
        ...integrity,
        finalUrl: download.finalUrl,
        redirectChain: download.redirectChain,
        contentType: download.response.headers.get("content-type")!,
        contentLength: body.length,
      },
    };
  } catch (error) {
    return rethrowWithSourceContext(error, source);
  }
}

/**
 * Collect the complete in-memory content manifest. The caller decides whether
 * and where to persist it in a later lot; this function has no write path.
 */
export async function collectZonePdfContentManifest(
  fetchImpl: typeof fetch,
  config: ArcgisZonePdfSourceConfig = SAINT_AMABLE_ZONEPDF_SOURCE,
): Promise<ZonePdfContentManifest> {
  const sourceT0 = await readSourceFence(fetchImpl, config);
  const sources = await querySourceRecordsByOidChunks(fetchImpl, sourceT0, config);
  const entries: ZonePdfManifestEntryInput[] = [];

  // Deliberately sequential in lot 1. Bounded parallelism and retries belong to
  // the local staging runner lot, and must not weaken this source-fence kernel.
  for (const source of sources) {
    entries.push(await collectZonePdfManifestEntry(fetchImpl, source, config));
  }

  const sourceT1 = await readSourceFence(fetchImpl, config);
  return buildZonePdfContentManifest(sourceT0, sourceT1, entries);
}
