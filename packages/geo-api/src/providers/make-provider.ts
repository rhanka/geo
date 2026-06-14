/**
 * Provider selection from a data location.
 *
 * A data location is either a plain directory path (served by {@link FileProvider})
 * or a store URI — `s3://<bucket>/<prefix>` or `fs:<path>` — served by
 * {@link StoreProvider} over a {@link Store} from `@sentropic/geo-storage`. This
 * keeps the FileProvider fast-path (a bare directory) untouched while routing
 * store URIs through `createStore`.
 *
 * Selection is purely string-based (`parseStoreUri`) and store construction is
 * lazy w.r.t. the network: building an `S3Store` does not open a connection, and
 * `StoreProvider` only lists/reads on first request — so calling this at import
 * time never requires a live S3.
 */

import { createStore, type CreateStoreOptions } from "@sentropic/geo/storage";

import { FileProvider } from "./file-provider.js";
import { StoreProvider } from "./store-provider.js";
import type { FeatureProvider } from "../provider.js";

/**
 * Whether `location` is a store URI (`s3://…` or `fs:…`) rather than a bare
 * directory path. A bare path parses as `{kind:"fs"}` too, so we test the
 * scheme prefix explicitly.
 */
export function isStoreUri(location: string): boolean {
  return location.startsWith("s3://") || location.startsWith("fs:");
}

/**
 * Build the {@link FeatureProvider} for a data `location`:
 *
 * - a store URI (`s3://bucket/prefix`, `fs:dir`) → a {@link StoreProvider} over
 *   `createStore(location)`;
 * - any other string → a {@link FileProvider} on that directory.
 *
 * `createStore` bakes the URI's prefix into the store itself (an `S3Store`
 * rooted at `bucket/prefix`, an `FsStore` rooted at `dir`), and `list()`/`get()`
 * key off that root — so the {@link StoreProvider} lists with an empty prefix to
 * avoid double-scoping.
 *
 * `storeOptions` is forwarded to `createStore` (e.g. an injected S3 client or
 * explicit credentials); it is ignored for the FileProvider path.
 */
export function makeProvider(
  location: string,
  storeOptions: CreateStoreOptions = {},
): FeatureProvider {
  if (!isStoreUri(location)) return new FileProvider(location);
  return new StoreProvider(createStore(location, storeOptions));
}
