/**
 * Path helpers. The CLI writes normalized data under `data/normalized` relative
 * to the current working directory (the repo root in normal use), unless an
 * explicit `--out`/`--data` directory is given.
 */

import { isAbsolute, resolve } from "node:path";

/** Default normalized-data directory, relative to cwd. */
export const DEFAULT_DATA_DIR = "data/normalized";

/**
 * Resolve the normalized-data directory. An explicit `dir` (absolute or
 * relative to `cwd`) wins; otherwise the default `data/normalized` under `cwd`.
 */
export function resolveDataDir(dir?: string, cwd: string = process.cwd()): string {
  const target = dir && dir.length > 0 ? dir : DEFAULT_DATA_DIR;
  return isAbsolute(target) ? target : resolve(cwd, target);
}
