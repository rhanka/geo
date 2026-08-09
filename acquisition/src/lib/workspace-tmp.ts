import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

/**
 * Workspace-local scratch root for geo.
 *
 * The host /tmp is tmpfs on our workers; large OCR/raster/worktree scratch must not
 * land there. Keep harness/delegation scratch under the repo-owned, gitignored
 * .h2a tree so cleanup and provenance remain workspace-scoped.
 */
export function workspaceTmp(...parts: string[]): string {
  const root = process.env["GEO_TMPDIR"] ?? process.env["H2A_WORKSPACE_TMP"] ?? join(repoRoot, ".h2a", "tmp");
  const dir = join(root, ...parts);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function workspaceTmpFile(name: string): string {
  return join(workspaceTmp(), name);
}
