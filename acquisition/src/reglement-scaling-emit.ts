/**
 * reglement-scaling-emit.ts — the reglement-lifecycle SCALING runner (committed CODE;
 * the RUN is separate). It wires the validated scaling fixture through the capitalized
 * batch lib (`./lib/zoning-events-batch-emit.ts`) and serves the events per muni.
 *
 * ⚠ The actual serving RUN (writing to S3) is a SEPARATE, conductor-go'd, S3-prefixed
 * invocation — it is NOT a free local agent run. This runner therefore DEFAULTS TO
 * DRY-RUN: it reads the existing served set, computes the tombstone-safe merge, and
 * prints the per-muni report (greenfield vs merged, counts, slug) that is the conductor's
 * pre-run scope-check input — WITHOUT writing. Only `--serve` (used by the conductor's
 * executor, post-merge, with `NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10`)
 * actually writes. A proof-less input is skipped + reported by the reject-guard, never a
 * batch-crash.
 *
 *   npx tsx src/reglement-scaling-emit.ts            # DRY-RUN: emit + merge-report, no write
 *   npx tsx src/reglement-scaling-emit.ts --serve    # conductor-go'd write to S3
 */
import { readFileSync } from "node:fs";

import { s3ZoningEventsStore, type ReglementLifecycleInput } from "./zoning-events-emit.js";
import { emitZoningEventsBatch, serveZoningEventsBatch } from "./lib/zoning-events-batch-emit.js";

const FIXTURE = new URL(
  "../../work/coverage/reglement-lifecycle-scaling-inputs-20260830.json",
  import.meta.url,
);

async function main(): Promise<void> {
  const serve = process.argv.includes("--serve");
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
    inputs: ReglementLifecycleInput[];
    pending_backfill?: unknown[];
  };

  // Reject-guard: a proof-less/invalid input is skipped + reported, never a batch-crash.
  const { built, rejected } = emitZoningEventsBatch(fixture.inputs);

  console.log(`\nreglement-scaling-emit — ${serve ? "SERVE (conductor-go'd)" : "DRY-RUN (no write)"}`);
  console.log(`  inputs=${fixture.inputs.length} · built=${built.length} · rejected=${rejected.length} · pending_capture=${fixture.pending_backfill?.length ?? 0}`);
  if (rejected.length > 0) {
    console.log(`  ⚠ REJECTED (skipped, not served — never a silent decided):`);
    for (const r of rejected) console.log(`    - ${r.ref} :: ${r.reason}`);
  }

  const store = s3ZoningEventsStore();
  const { reports } = await serveZoningEventsBatch(built, {
    store,
    asOf: new Date().toISOString(),
    dryRun: !serve,
  });

  // Per-muni scope-check report (additive vs overwrite, 0 silent retraction) — conductor's go input.
  console.log(`\n  per-muni ${serve ? "SERVED" : "would-serve"} report (${reports.length} munis):`);
  for (const r of reports.sort((a, b) => a.slug.localeCompare(b.slug))) {
    const flag = r.updated > 0 ? ` ⚠ UPDATED=${r.updated}` : "";
    console.log(
      `    ${r.slug.padEnd(20)} ${r.mode.padEnd(10)} existing=${r.existing} +added=${r.added} =total=${r.total}${flag}`,
    );
  }
  const totalUpdated = reports.reduce((n, r) => n + r.updated, 0);
  console.log(
    `\n  Σ munis=${reports.length} · served=${reports.reduce((n, r) => n + r.added, 0)} new · ${totalUpdated} updated · ${serve ? "WRITTEN" : "NOT written (dry-run)"}\n`,
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exitCode = 1;
});
