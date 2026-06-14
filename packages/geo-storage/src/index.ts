/**
 * @sentropic/geo-storage — storage abstraction for normalized datasets.
 *
 * Per ADR-0012, normalized data lives on S3-compatible object storage (Scaleway
 * Object Storage), not in git. The {@link Store} interface is the seam: the
 * acquisition write path and the API read path target either {@link S3Store}
 * (object storage) or {@link FsStore} (a local directory), selected by a store
 * URI via {@link createStore} — without callers depending on `@aws-sdk`.
 */

export const VERSION = "0.1.0";

export type { PutOptions, Store } from "./store.js";
export { FsStore } from "./fs-store.js";
export { S3Store, type S3StoreConfig } from "./s3-store.js";
export {
  createStore,
  parseStoreUri,
  type CreateStoreOptions,
  type ParsedStoreUri,
} from "./uri.js";
