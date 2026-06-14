/**
 * The {@link Store} abstraction: a minimal key→bytes object store. Normalized
 * datasets (ADR-0012) live on S3-compatible object storage (Scaleway), not git;
 * a {@link Store} is the seam that lets the acquisition write path and the API
 * read path target either object storage ({@link S3Store}) or a local directory
 * ({@link FsStore}) without depending on `@aws-sdk` directly.
 *
 * Keys are forward-slash-separated paths (e.g. `ca-qc/qc-regions.geojson`).
 * Implementations map them to their backend (a file under a root dir, or an
 * S3 object key under a prefix).
 */

/** Options accepted by {@link Store.put}. */
export interface PutOptions {
  /** MIME type recorded with the object (e.g. `application/geo+json`). */
  contentType?: string;
}

/** A minimal key→bytes object store. */
export interface Store {
  /** Write `body` at `key`, creating any intermediate structure. */
  put(key: string, body: Uint8Array | string, opts?: PutOptions): Promise<void>;
  /** Read the bytes at `key`, or `undefined` if no object exists there. */
  get(key: string): Promise<Uint8Array | undefined>;
  /** Whether an object exists at `key`. */
  has(key: string): Promise<boolean>;
  /** List keys, optionally restricted to those starting with `prefix`. */
  list(prefix?: string): Promise<string[]>;
  /** Delete the object at `key`; a no-op when nothing exists there. */
  delete?(key: string): Promise<void>;
}
