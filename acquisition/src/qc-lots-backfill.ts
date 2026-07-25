/**
 * qc-lots-backfill.ts — resumable qc-lots dataprep backfill.
 *
 * For each batch of slugs it runs, as isolated child processes:
 *   1. lot-zone-join-run.ts  --slugs <batch>   (LOT→ZONE→NORMS parquet)
 *   2. lots-enriched-run.ts  --slugs <batch>   (served qc-lots-<slug>.geojson)
 *
 * The runner is intentionally suitable for both local repair and k8s Jobs:
 *   - `--workers N` parallelizes independent batches in-process;
 *   - every batch writes progress, so a failed Job can restart with `--from`;
 *   - child failures are recorded and do not abort unrelated batches.
 *
 * Examples:
 *   npx tsx acquisition/src/qc-lots-backfill.ts \
 *     --plan work/coverage/qc-lots-plan.json \
 *     --progress work/coverage/qc-lots-progress.json \
 *     --workers 4 --enrich-no-role --log work/coverage/qc-lots-backfill.log
 *
 * Plan format:
 *   { "batches": ["slug-a,slug-b", ["slug-c", "slug-d"]] }
 */
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { s3Client } from "./lib/s3.js";
import { computeGap } from "./qc-lots-gap.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const JOIN = join(HERE, "lot-zone-join-run.ts");
const ENRICH = join(HERE, "lots-enriched-run.ts");

interface Plan {
  batches: Array<string | string[]>;
}

interface Args {
  planPath: string;
  progressPath: string;
  logPath: string | null;
  from: number;
  workers: number;
  enrichNoRole: boolean;
  enrichNoFsa: boolean;
  /** When >0 and no --plan given: build the plan live from the S3 gap (top-N slugs). */
  gapLimit: number;
  /** Batch size when planning from the gap (default 4). */
  gapBatch: number;
}

interface MuniStat {
  slug: string;
  lots: number;
  zone_code_pct: number;
  norms_pct: number;
}

interface BatchResult {
  batch: number;
  slugs: string;
  join_code: number;
  enrich_code: number;
  enriched: MuniStat[];
  join_skips: string[];
  enrich_skips: string[];
}

interface Progress {
  plan_batches: number;
  batches_done: number;
  batches_done_ids: number[];
  enriched: MuniStat[];
  join_skips: string[];
  enrich_skips: string[];
  crashed_steps: string[];
  batch_results: BatchResult[];
  avg_zone_code_pct: number;
  avg_norms_pct: number;
  munis_with_norms: number;
  updated_at: string;
}

function parseArgs(argv: string[]): Args {
  let planPath = "";
  let progressPath = "";
  let logPath: string | null = null;
  let from = 1;
  let workers = 1;
  let enrichNoRole = false;
  let enrichNoFsa = false;
  let gapLimit = 0;
  let gapBatch = 4;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--plan") planPath = String(argv[++i] ?? "");
    else if (a === "--progress") progressPath = String(argv[++i] ?? "");
    else if (a === "--log") logPath = String(argv[++i] ?? "") || null;
    else if (a === "--from")
      from = Math.max(1, parseInt(String(argv[++i] ?? ""), 10) || 1);
    else if (a === "--workers")
      workers = Math.max(1, parseInt(String(argv[++i] ?? ""), 10) || 1);
    else if (a === "--enrich-no-role") enrichNoRole = true;
    else if (a === "--enrich-no-fsa") enrichNoFsa = true;
    else if (a === "--gap-limit")
      gapLimit = Math.max(0, parseInt(String(argv[++i] ?? ""), 10) || 0);
    else if (a === "--gap-batch")
      gapBatch = Math.max(1, parseInt(String(argv[++i] ?? ""), 10) || 4);
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!progressPath) throw new Error("need --progress");
  if (!planPath && gapLimit <= 0)
    throw new Error("need --plan <file> OR --gap-limit <N> (build plan from S3 gap)");
  return {
    planPath,
    progressPath,
    logPath,
    from,
    workers,
    enrichNoRole,
    enrichNoFsa,
    gapLimit,
    gapBatch,
  };
}

/** Build a batch plan live from the S3 gap: top-N producible slugs, chunked. */
async function planFromGap(gapLimit: number, gapBatch: number): Promise<Plan> {
  const gap = await computeGap(s3Client());
  const slugs = gap.rows.map((r) => r.slug).slice(0, gapLimit);
  const batches: string[][] = [];
  for (let i = 0; i < slugs.length; i += gapBatch) {
    batches.push(slugs.slice(i, i + gapBatch));
  }
  process.stdout.write(
    `[backfill] plan-from-gap: gap=${gap.rows.length} chosen=${slugs.length} ` +
      `batches=${batches.length} (batch=${gapBatch})\n`,
  );
  return { batches };
}

function normalizeBatch(b: string | string[]): string {
  return Array.isArray(b) ? b.filter(Boolean).join(",") : b;
}

function appendLog(logPath: string | null, msg: string): void {
  if (logPath) appendFileSync(logPath, msg);
}

function runChild(
  label: string,
  script: string,
  slugsCsv: string,
  extraArgs: string[],
  logPath: string | null,
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    const args = ["tsx", script, "--slugs", slugsCsv, ...extraArgs];
    const child = spawn("npx", args, { cwd: REPO, env: process.env });
    let stdout = "";
    const prefix = `[${label}] `;
    child.stdout.on("data", (d: Buffer) => {
      const s = d.toString("utf8");
      stdout += s;
      const out = s
        .split(/(?<=\n)/)
        .map((line) => (line.trim() ? prefix + line : line))
        .join("");
      process.stdout.write(out);
      appendLog(logPath, out);
    });
    child.stderr.on("data", (d: Buffer) => {
      const s = d.toString("utf8");
      const out = s
        .split(/(?<=\n)/)
        .map((line) => (line.trim() ? prefix + line : line))
        .join("");
      process.stderr.write(out);
      appendLog(logPath, out);
    });
    child.on("close", (code, signal) => {
      if (signal)
        process.stderr.write(
          `\n[backfill] ${label} killed by signal ${signal}\n`,
        );
      resolve({ code: code ?? (signal ? 137 : 1), stdout });
    });
    child.on("error", (err) => {
      process.stderr.write(
        `\n[backfill] spawn error ${label}: ${err.message}\n`,
      );
      resolve({ code: 1, stdout });
    });
  });
}

function parseEnrichOk(stdout: string): MuniStat[] {
  const out: MuniStat[] = [];
  for (const line of stdout.split("\n")) {
    const m = line.match(
      /^OK (\S+) lots=(\d+) zone_code=([\d.]+)% norms=([\d.]+)%/,
    );
    if (m)
      out.push({
        slug: m[1]!,
        lots: parseInt(m[2]!, 10),
        zone_code_pct: parseFloat(m[3]!),
        norms_pct: parseFloat(m[4]!),
      });
  }
  return out;
}

function parseSkips(stdout: string): string[] {
  const out: string[] = [];
  for (const line of stdout.split("\n")) {
    const m = line.match(/^SKIP (\S+) (.+)$/);
    if (m) out.push(`${m[1]}: ${m[2]}`);
  }
  return out;
}

function newProgress(planBatches: number): Progress {
  return {
    plan_batches: planBatches,
    batches_done: 0,
    batches_done_ids: [],
    enriched: [],
    join_skips: [],
    enrich_skips: [],
    crashed_steps: [],
    batch_results: [],
    avg_zone_code_pct: 0,
    avg_norms_pct: 0,
    munis_with_norms: 0,
    updated_at: new Date().toISOString(),
  };
}

function loadProgress(path: string, planBatches: number): Progress {
  if (!existsSync(path)) return newProgress(planBatches);
  try {
    const p = JSON.parse(readFileSync(path, "utf8")) as Progress;
    if (!Array.isArray(p.batches_done_ids)) p.batches_done_ids = [];
    if (!Array.isArray(p.batch_results)) p.batch_results = [];
    return { ...newProgress(planBatches), ...p, plan_batches: planBatches };
  } catch {
    return newProgress(planBatches);
  }
}

function recomputeProgress(prog: Progress): void {
  const enr = prog.enriched;
  prog.batches_done = prog.batches_done_ids.length;
  prog.avg_zone_code_pct = enr.length
    ? Math.round(
        (enr.reduce((a, x) => a + x.zone_code_pct, 0) / enr.length) * 100,
      ) / 100
    : 0;
  prog.avg_norms_pct = enr.length
    ? Math.round(
        (enr.reduce((a, x) => a + x.norms_pct, 0) / enr.length) * 100,
      ) / 100
    : 0;
  prog.munis_with_norms = enr.filter((x) => x.norms_pct > 0).length;
  prog.updated_at = new Date().toISOString();
}

function saveProgress(path: string, prog: Progress): void {
  recomputeProgress(prog);
  writeFileSync(path, JSON.stringify(prog, null, 2), "utf8");
}

async function runBatch(
  batchIndex: number,
  slugsCsv: string,
  args: Args,
): Promise<BatchResult> {
  const n = slugsCsv.split(",").filter(Boolean).length;
  process.stdout.write(`\n===== BATCH ${batchIndex} (${n} munis) =====\n`);

  const jr = await runChild(
    `b${batchIndex}:join`,
    JOIN,
    slugsCsv,
    [],
    args.logPath,
  );
  const enrichExtra = [
    args.enrichNoRole ? "--no-role" : "",
    args.enrichNoFsa ? "--no-fsa" : "",
  ].filter(Boolean);
  const er = await runChild(
    `b${batchIndex}:enrich`,
    ENRICH,
    slugsCsv,
    enrichExtra,
    args.logPath,
  );

  return {
    batch: batchIndex,
    slugs: slugsCsv,
    join_code: jr.code,
    enrich_code: er.code,
    enriched: parseEnrichOk(er.stdout),
    join_skips: parseSkips(jr.stdout),
    enrich_skips: parseSkips(er.stdout),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const plan: Plan = args.planPath
    ? (JSON.parse(readFileSync(args.planPath, "utf8")) as Plan)
    : await planFromGap(args.gapLimit, args.gapBatch);
  const batches = plan.batches.map(normalizeBatch).filter(Boolean);
  const prog = loadProgress(args.progressPath, batches.length);
  const done = new Set<number>(prog.batches_done_ids);
  const queue = batches
    .map((slugs, idx) => ({ batchIndex: idx + 1, slugs }))
    .filter((b) => b.batchIndex >= args.from && !done.has(b.batchIndex));

  process.stdout.write(
    `[backfill] plan_batches=${batches.length} pending=${queue.length} workers=${args.workers}` +
      ` enrichNoRole=${args.enrichNoRole} progress=${args.progressPath}\n`,
  );

  let next = 0;
  async function worker(workerId: number): Promise<void> {
    while (next < queue.length) {
      const item = queue[next++]!;
      process.stdout.write(
        `[backfill] worker=${workerId} taking batch=${item.batchIndex}\n`,
      );
      const r = await runBatch(item.batchIndex, item.slugs, args);
      prog.batch_results.push(r);
      prog.batches_done_ids.push(r.batch);
      prog.enriched.push(...r.enriched);
      prog.join_skips.push(...r.join_skips);
      prog.enrich_skips.push(...r.enrich_skips);
      if (r.join_code !== 0)
        prog.crashed_steps.push(`join batch ${r.batch} code=${r.join_code}`);
      if (r.enrich_code !== 0)
        prog.crashed_steps.push(
          `enrich batch ${r.batch} code=${r.enrich_code}`,
        );
      prog.batches_done_ids = [...new Set(prog.batches_done_ids)].sort(
        (a, b) => a - b,
      );
      saveProgress(args.progressPath, prog);
      process.stdout.write(
        `----- progress: batches ${prog.batches_done}/${prog.plan_batches} enriched=${prog.enriched.length} ` +
          `avg_zone_code=${prog.avg_zone_code_pct}% avg_norms=${prog.avg_norms_pct}% with_norms=${prog.munis_with_norms} ` +
          `crashed=${prog.crashed_steps.length}\n`,
      );
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(args.workers, Math.max(queue.length, 1)) },
      (_, i) => worker(i + 1),
    ),
  );
  saveProgress(args.progressPath, prog);
  process.stdout.write(
    `\n===== BACKFILL DONE: batches=${prog.batches_done}/${prog.plan_batches} enriched=${prog.enriched.length} ` +
      `avg_zone_code=${prog.avg_zone_code_pct}% avg_norms=${prog.avg_norms_pct}% ` +
      `with_norms=${prog.munis_with_norms} crashed_steps=${prog.crashed_steps.length}\n`,
  );
  if (prog.crashed_steps.length)
    process.stdout.write(`crashed: ${prog.crashed_steps.join(" | ")}\n`);
}

main().catch((e) => {
  process.stderr.write((e instanceof Error ? e.message : String(e)) + "\n");
  process.exit(1);
});
