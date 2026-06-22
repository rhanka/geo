import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * RECUEIL substrate — the persisted record of one raw document collected from
 * a source (SPEC_PLAN_SCRAPING §3.2). It is the metadata row that accompanies
 * the raw payload stored in object storage. Provenance is end-to-end and the
 * record is idempotent by `sha256`: two collections of byte-identical content
 * produce the same `id` and the same `storageKey`.
 *
 * This is distinct from the in-flight `RawDocument` in `SourceAdapter.ts`
 * (which still carries the `body` bytes while being fetched). Here the bytes
 * already live in S3 under `storageKey`; EXPLOITATION re-reads by `storageKey`
 * and NEVER re-fetches the network.
 */

/** Provenance carried by every raw document (SPEC_PLAN_SCRAPING §3.2). */
export const RawDocumentRecordProvenanceSchema = z.object({
  /** CIBLAGE plan that scheduled this collection, when one exists. */
  ciblagePlanId: z.string().min(1).optional(),
  /** Adapter version string (`SourceAdapter.version`). */
  version: z.string().min(1),
  /** Honest user-agent used for the fetch (rules/MASTER.md Scraping Policy). */
  userAgent: z.string().min(1),
  /**
   * Whether the payload was rendered/captured via the Obscura sidecar. Obscura
   * is for rendering reliability, never for circumventing access — so far every
   * Tier A/B Valleyfield source is plain HTTP, hence the default `false`.
   */
  viaObscura: z.boolean(),
});
export type RawDocumentRecordProvenance = z.infer<
  typeof RawDocumentRecordProvenanceSchema
>;

/** A persisted raw-document metadata record. */
export const RawDocumentRecordSchema = z.object({
  /** Stable id, derived from `source` + `sha256` (idempotent — see `rawDocumentId`). */
  id: z.string().min(1),
  /** Source id that produced the document (e.g. "avis-publics-valleyfield"). */
  source: z.string().min(1),
  /** Exact URL the bytes were fetched from (anti-invention: the real link). */
  sourceUrl: z.string().url(),
  /** Human title exposed by the source listing, when available. */
  title: z.string().min(1).optional(),
  /**
   * Publication/session date exposed by the source listing, when available.
   * May be an ISO date (`YYYY-MM-DD`) or an ISO datetime depending on source.
   */
  publishedAt: z.string().min(4).optional(),
  /** SHA-256 hex digest of the raw bytes — the idempotency key. */
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  /** ISO timestamp of the fetch. */
  fetchedAt: z.string().datetime(),
  /** Object-storage key under which the raw bytes live (`raw/<source>/<Y>/<M>/<D>/<sha>.<ext>`). */
  storageKey: z.string().min(1),
  /** MIME type of the stored payload. */
  contentType: z.string().min(1),
  /** End-to-end provenance. */
  provenance: RawDocumentRecordProvenanceSchema,
  /** Length of the raw payload in bytes. */
  bytesLen: z.number().int().nonnegative(),
});
export type RawDocumentRecord = z.infer<typeof RawDocumentRecordSchema>;

/** SHA-256 hex digest of raw bytes (idempotency primitive). */
export function sha256Hex(body: Uint8Array | string): string {
  return createHash("sha256").update(body).digest("hex");
}

/**
 * Deterministic, idempotent id for a raw document. Byte-identical content from
 * the same source yields the same id, so re-collection is a no-op upsert.
 */
export function rawDocumentId(source: string, sha256: string): string {
  return `raw:${source}:${sha256}`;
}

/** File extension inferred from a content type, used to build the storage key. */
export function extForContentType(contentType: string): string {
  const ct = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  switch (ct) {
    case "text/html":
      return "html";
    case "application/pdf":
      return "pdf";
    case "application/json":
      return "json";
    case "application/xml":
    case "text/xml":
      return "xml";
    case "text/plain":
      return "txt";
    case "text/csv":
      return "csv";
    default:
      return "bin";
  }
}

/**
 * Canonical raw-object key — content-addressed (CAS), spec
 * docs/spec/SPEC_PERSISTENCE_S3_FIRST.md §1.1:
 *   raw/<source>/cas/<sha256>.<ext>
 * The fetch date is deliberately NOT in the key: the same content always maps
 * to the same key, so re-fetching an identical document is a HEAD-skip (no
 * duplicate object). The temporal axis lives in the run manifests instead.
 */
export function rawStorageKey(params: {
  source: string;
  sha256: string;
  contentType: string;
}): string {
  const ext = extForContentType(params.contentType);
  return `raw/${params.source}/cas/${params.sha256}.${ext}`;
}

/** Sibling metadata key for a CAS raw object: `<storageKey>` → `….meta.json`. */
export function rawMetaKey(storageKey: string): string {
  return `${storageKey}.meta.json`;
}

/**
 * Build a validated `RawDocumentRecord` from raw bytes + fetch context. Computes
 * the sha256, the idempotent id and the canonical storage key. Does NOT perform
 * any I/O — the caller is responsible for putting the bytes in object storage
 * under the returned `storageKey` BEFORE persisting the record.
 */
export function buildRawDocumentRecord(input: {
  source: string;
  sourceUrl: string;
  title?: string;
  publishedAt?: string;
  body: Uint8Array;
  fetchedAt: string;
  contentType: string;
  provenance: RawDocumentRecordProvenance;
}): RawDocumentRecord {
  const sha256 = sha256Hex(input.body);
  const storageKey = rawStorageKey({
    source: input.source,
    sha256,
    contentType: input.contentType,
  });
  return RawDocumentRecordSchema.parse({
    id: rawDocumentId(input.source, sha256),
    source: input.source,
    sourceUrl: input.sourceUrl,
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.publishedAt !== undefined ? { publishedAt: input.publishedAt } : {}),
    sha256,
    fetchedAt: input.fetchedAt,
    storageKey,
    contentType: input.contentType,
    provenance: input.provenance,
    bytesLen: input.body.byteLength,
  });
}
