/**
 * Run the committed served-zone enrichment folds after a geometry replacement.
 *
 * This deliberately orchestrates the existing fold scripts; it does not copy
 * their business rules.  Each script writes through putServedZoneAdditive, so the
 * freshly proved geometry remains byte-identical while its metadata is restored.
 */
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "..");
const TSX = resolve(HERE, "../../../node_modules/.bin/tsx");

interface FoldSpec { script: string; args: (slug: string) => string[]; }

const FOLDS: readonly FoldSpec[] = [
  { script: "fold-reglement-to-zonage.ts", args: (slug) => ["--slugs", slug] },
  { script: "fold-norms-to-zonage.ts", args: (slug) => ["--slugs", slug] },
  { script: "fold-usage-dominant.ts", args: (slug) => ["--slugs", slug] },
  { script: "fold-geometry-status-to-zonage.ts", args: (slug) => ["--slugs", slug] },
  // The scaffold only fills absent keys and therefore never overwrites a verified
  // before/after artifact that was carried forward with the matching zone_code.
  { script: "fold-effet-densifiant-scaffold.ts", args: (slug) => ["--slugs", slug] },
];

function run(script: string, args: string[]): Promise<void> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [TSX, resolve(SRC, script), ...args], {
      cwd: resolve(SRC, ".."),
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`enrichment fold ${script} failed (code=${code ?? "null"}, signal=${signal ?? "none"})`));
    });
  });
}

/**
 * Reapply folds that can derive their values from their committed inputs.
 *
 * `fold-zone-source-to-zonage` is intentionally not called here: it restores a
 * historical source ledger, while a successful replacement has just acquired a
 * newer exact geometry source.  The caller stamps that source last from its v2
 * proof. `fold-effet-densifiant.ts` needs an explicit verified before/after
 * artifact plus four regulation arguments, so it cannot be inferred safely; the
 * idempotent scaffold restores only the honest contract where no such artifact is
 * supplied.
 */
export async function reapplyServedZonageEnrichment(slug: string): Promise<void> {
  for (const fold of FOLDS) {
    console.error(`[zonage-enrichment] ${slug}: ${fold.script}`);
    await run(fold.script, fold.args(slug));
  }
  if (slug === "quebec") {
    console.error(`[zonage-enrichment] ${slug}: fold-reglement-quebec-arrondissement.ts`);
    await run("fold-reglement-quebec-arrondissement.ts", []);
  }
}
