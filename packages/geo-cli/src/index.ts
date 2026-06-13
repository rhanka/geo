/**
 * @sentropic/geo-cli — the `geo` command-line interface.
 *
 * Command logic lives in `./commands/*` as plain, testable functions; this
 * module re-exports them (and the commander program builder) so they can be
 * consumed programmatically and unit-tested. The executable entry is `./cli.ts`.
 */

export const VERSION = "0.1.0";

export { buildProgram } from "./program.js";
export { defaultRegistry, getSource, type RegisteredSource } from "./registry.js";
export { DEFAULT_DATA_DIR, resolveDataDir } from "./paths.js";

export {
  listSources,
  showSource,
  formatSourceList,
  formatSourceDetail,
  type SourceSummary,
  type SourceDetail,
  type DatasetSummary,
} from "./commands/sources.js";

export {
  fetchSource,
  formatFetchResult,
  type FetchOptions,
  type FetchDeps,
  type FetchResult,
  type FetchedDataset,
} from "./commands/fetch.js";

export {
  startServer,
  DEFAULT_PORT,
  type ServeOptions,
  type ServeDeps,
  type ServeHandle,
} from "./commands/serve.js";

export {
  buildLicenses,
  assertNoLicenseDrift,
  renderLicensesMarkdown,
  DEFAULT_REGISTRY_PATH,
  DEFAULT_OUT_PATH,
  type Registry,
  type RegistryEntry,
  type LicensesBuildOptions,
  type LicensesBuildResult,
} from "./commands/licenses.js";

export {
  refresh,
  isStale,
  parseIso8601Duration,
  formatRefreshResult,
  DEFAULT_REQUESTS_DIR,
  type LedgerEntry,
  type RefreshOptions,
  type RefreshDeps,
  type RefreshResult,
  type RefreshedEntry,
} from "./commands/refresh.js";
