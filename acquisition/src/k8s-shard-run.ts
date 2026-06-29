/**
 * k8s shard orchestrator for the QC mass-acquisition (TS-only, committable).
 *
 * Replaces the slow LOCAL sequential worker with REMOTE, parallel k8s Jobs: the
 * 563-muni list is split into N shards, each shard becomes a `batch/v1` Job
 * (ns geo) running the `geo-acquisition` image. Every Job discovers + downloads
 * its grille PDFs and extracts+deposits zonage norms to S3
 * (`registry/qc-zonage-norms/`), in parallel, surviving the laptop being off.
 *
 * This driver only shells out to `kubectl` (apply/get/delete/logs) — no k8s
 * client dep. It is idempotent at TWO levels:
 *   - the per-muni batch HEAD-skips any slug already deposited in S3, so a
 *     re-run never redoes a paid Mistral vision pass;
 *   - Job names are deterministic (`geo-acq-<runId>-<i>`); re-applying is a
 *     no-op unless --run-id changes.
 *
 * Anti-collision: each shard writes its OWN manifest (OUT=discovered-shard-<i>
 * .json) inside its pod, so two shards never clobber a shared discovered.json.
 *
 * The geo tenant quota is TIGHT (see deploy/acquisition-job/README): only a few
 * pods and ~512Mi of limit headroom fit at once, so shards run with a bounded
 * --concurrency window (default 2) and modest per-pod resources (overridable).
 *
 * A secret value is NEVER printed/written: creds come from k8s secrets via
 * envFrom (geo-s3-credentials + mistral-credentials) — this orchestrator only
 * references them by NAME and never reads their values.
 *
 * Usage (prove small, then full province):
 *   npx tsx src/k8s-shard-run.ts --shards 2 --limit 6 --mode all
 *   npx tsx src/k8s-shard-run.ts --shards 16 --mode all
 *
 * Flags:
 *   --shards N        number of shards / Jobs (default 16)
 *   --mode M          discover | extract | all (default all)
 *   --limit N         only the first N slugs (after dedup), for proofs
 *   --slugs-file PATH slug list, 1/line (default /tmp/all_slugs.txt; falls back
 *                     to ALL_PV_CITIES when the file is absent)
 *   --concurrency N   max Jobs running at once (default 2 — quota-bounded)
 *   --run-id ID       deterministic Job-name suffix (default: short timestamp)
 *   --image REF       acquisition image (default rg.fr-par.scw.cloud/sentropic-geo/geo-acquisition:0.1.0)
 *   --namespace NS    k8s namespace (default geo)
 *   --req-mem / --lim-mem / --req-cpu / --lim-cpu  per-pod resources
 *                     (defaults 128Mi / 256Mi / 50m / 400m — fit the quota)
 *   --timeout-min N   max minutes to wait per Job before giving up (default 30)
 *   --dry-run         print manifests + plan, apply NOTHING
 *   --keep            do NOT delete Jobs after completion (default: TTL 3600s
 *                     auto-reaps them; --keep also skips that TTL)
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import { ALL_PV_CITIES } from "../../packages/qc-sources/src/sources/proces-verbaux-generic.js";

// ── args ───────────────────────────────────────────────────────────────────────
interface Args {
  shards: number;
  mode: "discover" | "extract" | "all";
  limit?: number;
  slugsFile: string;
  concurrency: number;
  runId: string;
  image: string;
  namespace: string;
  reqMem: string;
  limMem: string;
  reqCpu: string;
  limCpu: string;
  timeoutMin: number;
  dryRun: boolean;
  keep: boolean;
}

const DEFAULT_IMAGE =
  "rg.fr-par.scw.cloud/sentropic-geo/geo-acquisition:0.1.0";

function parseArgs(argv: string[]): Args {
  const get = (k: string): string | undefined => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const has = (k: string): boolean => argv.includes(`--${k}`);
  const modeRaw = get("mode") ?? "all";
  if (modeRaw !== "discover" && modeRaw !== "extract" && modeRaw !== "all") {
    throw new Error(`--mode must be discover|extract|all (got ${modeRaw})`);
  }
  const limitRaw = get("limit");
  const shortTs = new Date()
    .toISOString()
    .replace(/[-:T.]/g, "")
    .slice(2, 12); // yymmddHHMM
  return {
    shards: Number(get("shards") ?? "16"),
    mode: modeRaw,
    ...(limitRaw !== undefined ? { limit: Number(limitRaw) } : {}),
    slugsFile: get("slugs-file") ?? "/tmp/all_slugs.txt",
    concurrency: Number(get("concurrency") ?? "2"),
    runId: get("run-id") ?? shortTs,
    image: get("image") ?? DEFAULT_IMAGE,
    namespace: get("namespace") ?? "geo",
    reqMem: get("req-mem") ?? "128Mi",
    limMem: get("lim-mem") ?? "256Mi",
    reqCpu: get("req-cpu") ?? "50m",
    limCpu: get("lim-cpu") ?? "400m",
    timeoutMin: Number(get("timeout-min") ?? "30"),
    dryRun: has("dry-run"),
    keep: has("keep"),
  };
}

// ── slug source ─────────────────────────────────────────────────────────────────
function loadSlugs(args: Args): string[] {
  let slugs: string[];
  if (existsSync(args.slugsFile)) {
    slugs = readFileSync(args.slugsFile, "utf8")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    console.error(`[orch] slugs from ${args.slugsFile}: ${slugs.length}`);
  } else {
    slugs = ALL_PV_CITIES.map((c) => c.config.citySlug);
    console.error(
      `[orch] slugs from ALL_PV_CITIES (file ${args.slugsFile} absent): ${slugs.length}`,
    );
  }
  // Dedup, stable order.
  const seen = new Set<string>();
  const uniq = slugs.filter((s) => (seen.has(s) ? false : (seen.add(s), true)));
  return args.limit !== undefined ? uniq.slice(0, args.limit) : uniq;
}

/** Round-robin shard so each Job has a similar mix (not contiguous blocks). */
function shard(slugs: string[], n: number): string[][] {
  const buckets: string[][] = Array.from({ length: n }, () => []);
  slugs.forEach((s, i) => buckets[i % n]!.push(s));
  return buckets.filter((b) => b.length > 0);
}

// ── manifest ──────────────────────────────────────────────────────────────────
interface JobPlan {
  name: string;
  index: number;
  slugs: string[];
  manifest: string;
}

function jobManifest(args: Args, name: string, index: number, slugs: string[]): string {
  const out = `/geo/work/zonage-norms/discovered-shard-${index}.json`;
  // restartPolicy Never + backoffLimit 2; TTL auto-reaps unless --keep.
  const ttl = args.keep ? "" : `\n  ttlSecondsAfterFinished: 3600`;
  return `apiVersion: batch/v1
kind: Job
metadata:
  name: ${name}
  namespace: ${args.namespace}
  labels:
    app: geo-acquisition
    geo.run-id: "r${args.runId}"
    geo.shard: "${index}"
spec:
  backoffLimit: 2${ttl}
  template:
    metadata:
      labels:
        app: geo-acquisition
        geo.run-id: "r${args.runId}"
        geo.shard: "${index}"
    spec:
      restartPolicy: Never
      imagePullSecrets:
        - name: geo-registry-pull
      containers:
        - name: acquisition
          image: ${args.image}
          imagePullPolicy: IfNotPresent
          env:
            - name: SLUGS
              value: "${slugs.join(",")}"
            - name: MODE
              value: "${args.mode}"
            - name: OUT
              value: "${out}"
          envFrom:
            - secretRef:
                name: geo-s3-credentials
            - secretRef:
                name: mistral-credentials
          resources:
            requests:
              memory: "${args.reqMem}"
              cpu: "${args.reqCpu}"
            limits:
              memory: "${args.limMem}"
              cpu: "${args.limCpu}"
`;
}

// ── kubectl helpers ─────────────────────────────────────────────────────────────
function kubectl(
  args: string[],
  input?: string,
): { code: number; stdout: string; stderr: string } {
  const r = spawnSync("kubectl", args, {
    input,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    code: r.status ?? 1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

type JobStatus = "pending" | "running" | "complete" | "failed" | "missing";

function jobStatus(ns: string, name: string): JobStatus {
  const r = kubectl([
    "get",
    "job",
    name,
    "-n",
    ns,
    "-o",
    "jsonpath={.status.conditions[*].type}|{.status.active}|{.status.succeeded}|{.status.failed}",
  ]);
  if (r.code !== 0) return "missing";
  const [conds, active, succeeded] = r.stdout.split("|");
  if ((conds ?? "").includes("Complete") || Number(succeeded ?? 0) > 0)
    return "complete";
  if ((conds ?? "").includes("Failed")) return "failed";
  if (Number(active ?? 0) > 0) return "running";
  return "pending";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── orchestration ────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const slugs = loadSlugs(args);
  if (slugs.length === 0) {
    console.error("[orch] no slugs — nothing to do");
    return;
  }
  const buckets = shard(slugs, args.shards);
  const plans: JobPlan[] = buckets.map((b, i) => {
    const name = `geo-acq-${args.runId}-${i}`;
    return { name, index: i, slugs: b, manifest: jobManifest(args, name, i, b) };
  });

  console.error(
    `[orch] runId=${args.runId} mode=${args.mode} image=${args.image}`,
  );
  console.error(
    `[orch] ${slugs.length} slugs → ${plans.length} shards ` +
      `(~${Math.ceil(slugs.length / plans.length)}/shard), ` +
      `concurrency=${args.concurrency}, ns=${args.namespace}`,
  );
  console.error(
    `[orch] per-pod resources: req ${args.reqMem}/${args.reqCpu}, lim ${args.limMem}/${args.limCpu}`,
  );

  if (args.dryRun) {
    console.error(`[orch] --dry-run: manifests below, applying NOTHING\n`);
    for (const p of plans) {
      console.error(`# shard ${p.index} (${p.slugs.length} slugs): ${p.name}`);
      console.log(p.manifest);
      console.log("---");
    }
    return;
  }

  // Bounded-concurrency scheduler: apply up to `concurrency` Jobs, poll, and as
  // each finishes apply the next. Honours --timeout-min per Job.
  const deadline = new Map<string, number>(); // name → epoch ms timeout
  const queue = [...plans];
  const inflight = new Set<string>();
  const done: { name: string; index: number; status: JobStatus }[] = [];

  const launch = (p: JobPlan): void => {
    console.error(
      `[orch] apply shard ${p.index} (${p.slugs.length} slugs) → ${p.name}`,
    );
    const r = kubectl(["apply", "-f", "-"], p.manifest);
    if (r.code !== 0) {
      console.error(`[orch] APPLY FAILED ${p.name}: ${r.stderr.trim()}`);
      done.push({ name: p.name, index: p.index, status: "failed" });
      return;
    }
    inflight.add(p.name);
    deadline.set(p.name, Date.now() + args.timeoutMin * 60_000);
  };

  // Prime the pipeline.
  while (inflight.size < args.concurrency && queue.length > 0) {
    launch(queue.shift()!);
  }

  while (inflight.size > 0) {
    await sleep(10_000);
    for (const name of [...inflight]) {
      const p = plans.find((x) => x.name === name)!;
      const st = jobStatus(args.namespace, name);
      if (st === "complete" || st === "failed") {
        console.error(`[orch] shard ${p.index} ${name}: ${st.toUpperCase()}`);
        inflight.delete(name);
        done.push({ name, index: p.index, status: st });
      } else if (Date.now() > (deadline.get(name) ?? Infinity)) {
        console.error(
          `[orch] shard ${p.index} ${name}: TIMEOUT after ${args.timeoutMin}min (status=${st})`,
        );
        inflight.delete(name);
        done.push({ name, index: p.index, status: "failed" });
      } else {
        // progress heartbeat
        process.stderr.write(`[orch] shard ${p.index} ${name}: ${st}\n`);
      }
    }
    // Refill from the queue.
    while (inflight.size < args.concurrency && queue.length > 0) {
      launch(queue.shift()!);
    }
  }

  // ── report ─────────────────────────────────────────────────────────────────
  done.sort((a, b) => a.index - b.index);
  const ok = done.filter((d) => d.status === "complete").length;
  const ko = done.filter((d) => d.status === "failed").length;
  console.error(`\n[orch] === DONE: ${ok} complete, ${ko} failed ===`);
  for (const d of done) {
    console.error(`[orch]   shard ${d.index} ${d.name}: ${d.status}`);
  }
  if (ko > 0) {
    console.error(
      `[orch] inspect a failure: kubectl logs job/<name> -n ${args.namespace}`,
    );
    process.exitCode = 1;
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
