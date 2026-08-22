/**
 * The reconciliation tick — the crash-safe heart. One tick: load the run pointer,
 * fold finished Jobs into IMMUTABLE receipts, skip gated-off nodes, submit newly-
 * eligible nodes bounded by the live quota, then advance the mutable `latest.json`
 * via CAS (If-Match).
 *
 * Crash-safety invariants:
 *  - A receipt is written BEFORE `latest` is advanced ⇒ a crash in between is
 *    recovered next tick (the receipt is found and folded).
 *  - Job names are DETERMINISTIC ⇒ re-observe / re-submit is idempotent.
 *  - `latest` advances ONLY by CAS ⇒ a lost race is a no-op-safe abort (immutable
 *    receipts + idempotent submits already persisted), retried next tick.
 * The tick is therefore safe to kill at any point and safe to run twice.
 */

import { availableSlots, type PerJobCost } from "./quota.js";
import {
  buildReceipt,
  classifyEligible,
  deterministicJobName,
  initialRunLatest,
  latestKey,
  manifestKey,
  receiptKey,
  runPhase,
  RUN_MANIFEST_CONTRACT,
  type NodeReceipt,
  type RunLatest,
  type RunManifest,
  type RunPhase,
} from "./state.js";
import type { DagStore, JobExecutor, JobIdentity, QuotaHeadroom } from "./ports.js";
import type { Dag } from "./dag.js";

/** Default ceiling on concurrent Jobs (quota-aware; raise only with proof). */
export const DEFAULT_MAX_ACTIVE_JOBS = 6;

export interface ReconcileArgs {
  dag: Dag;
  runId: string;
  store: DagStore;
  executor: JobExecutor;
  quota: QuotaHeadroom;
  now: string;
  /** Pods held back for the served API (never scheduled over). */
  reservePods?: number;
  /** Concurrent-Job ceiling (default {@link DEFAULT_MAX_ACTIVE_JOBS}). */
  maxActiveJobs?: number;
  /** Per-node resource cost override. */
  perJob?: PerJobCost;
}

export interface ReconcileResult {
  runId: string;
  phase: RunPhase;
  submitted: string[];
  completed: string[];
  failed: string[];
  skipped: string[];
  /** True if the `latest` CAS lost a race — no corruption; retry next tick. */
  conflict: boolean;
}

function parse<T>(body: string): T {
  return JSON.parse(body) as T;
}

function buildManifest(dag: Dag, runId: string, now: string): RunManifest {
  return { contract: RUN_MANIFEST_CONTRACT, dagId: dag.id, runId, createdAt: now, nodes: [...dag.order] };
}

export async function reconcileTick(args: ReconcileArgs): Promise<ReconcileResult> {
  const { dag, runId, store, executor, quota, now } = args;
  const maxActiveJobs = args.maxActiveJobs ?? DEFAULT_MAX_ACTIVE_JOBS;
  // NHI: every Job runs as the lane's dedicated SA (+ the node's token audiences).
  const identityFor = (id: string): JobIdentity => ({
    serviceAccountName: dag.serviceAccountName,
    tokenAudiences: dag.nodes[id]!.tokenAudiences ?? [],
  });
  const empty = (conflict: boolean, phase: RunPhase): ReconcileResult => ({
    runId, phase, submitted: [], completed: [], failed: [], skipped: [], conflict,
  });

  // 1. Load the run pointer, or create it (manifest immutable + latest via CAS-create).
  let cur = await store.get(latestKey(runId));
  let etag: string | null;
  let latest: RunLatest;
  if (!cur) {
    await store.put(manifestKey(runId), JSON.stringify(buildManifest(dag, runId, now)));
    latest = initialRunLatest(dag, runId, now);
    const created = await store.putIfMatch(latestKey(runId), JSON.stringify(latest), null);
    if (!created.ok) {
      cur = await store.get(latestKey(runId));
      if (!cur) return empty(true, "running");
      latest = parse<RunLatest>(cur.body);
      etag = cur.etag;
    } else {
      etag = created.etag;
    }
  } else {
    latest = parse<RunLatest>(cur.body);
    etag = cur.etag;
  }

  // 2. Load terminal receipts (upstream context for gating).
  const receipts: Record<string, NodeReceipt | undefined> = {};
  for (const id of dag.order) {
    const rk = latest.nodes[id]?.receiptKey;
    if (!rk) continue;
    const r = await store.get(rk);
    if (r) receipts[id] = parse<NodeReceipt>(r.body);
  }

  const submitted: string[] = [];
  const completed: string[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];

  // 3. Fold finished Jobs into receipts (receipt-first for crash-safety).
  for (const id of dag.order) {
    const st = latest.nodes[id];
    if (!st || st.phase !== "submitted" || st.jobName === null) continue;
    const rk = receiptKey(runId, id, st.attempt);
    const already = await store.get(rk);
    let rec: NodeReceipt | undefined = already ? parse<NodeReceipt>(already.body) : undefined;
    if (!rec) {
      const [obs] = await executor.observe([st.jobName]);
      if (obs && (obs.status === "succeeded" || obs.status === "failed")) {
        rec = buildReceipt({
          runId, nodeId: id, attempt: st.attempt,
          outcome: obs.status === "succeeded" ? "succeeded" : "failed",
          jobName: st.jobName, finishedAt: now, failureReason: obs.failureReason,
        });
        await store.put(rk, JSON.stringify(rec));
      } else if (!obs || obs.status === "missing") {
        // Job vanished before completion and no receipt exists → re-submit
        // (idempotent by deterministic name; at-least-once). Stays submitted.
        await executor.submit({ name: st.jobName, runId, nodeId: id, attempt: st.attempt, identity: identityFor(id), spec: dag.nodes[id]!.spec });
        continue;
      } else {
        continue; // pending/active — still running
      }
    }
    st.phase = rec.outcome === "succeeded" ? "succeeded" : rec.outcome === "failed" ? "failed" : "skipped";
    st.receiptKey = rk;
    receipts[id] = rec;
    if (st.phase === "succeeded") completed.push(id);
    else if (st.phase === "failed") failed.push(id);
  }

  // 4. Classify newly-eligible pending nodes; skip the gated-off ones (receipt-first).
  const { runnable, skippable } = classifyEligible(dag, latest, receipts);
  for (const id of skippable) {
    const st = latest.nodes[id]!;
    const rk = receiptKey(runId, id, st.attempt);
    const rec = buildReceipt({ runId, nodeId: id, attempt: st.attempt, outcome: "skipped", jobName: "", finishedAt: now });
    await store.put(rk, JSON.stringify(rec));
    st.phase = "skipped";
    st.receiptKey = rk;
    receipts[id] = rec;
    skipped.push(id);
  }

  // 5. Submit runnable nodes, bounded by quota slots + concurrency keys.
  const activeJobs = Object.values(latest.nodes).filter((s) => s.phase === "submitted").length;
  let slots = availableSlots(activeJobs, quota, {
    maxActiveJobs,
    ...(args.reservePods !== undefined ? { reservePods: args.reservePods } : {}),
    ...(args.perJob !== undefined ? { perJob: args.perJob } : {}),
  });
  const busyKeys = new Set(
    Object.values(latest.nodes)
      .filter((s) => s.phase === "submitted")
      .map((s) => dag.nodes[s.nodeId]?.concurrencyKey)
      .filter((k): k is string => typeof k === "string"),
  );
  for (const id of runnable) {
    if (slots <= 0) break;
    const key = dag.nodes[id]!.concurrencyKey;
    if (typeof key === "string" && busyKeys.has(key)) continue;
    const st = latest.nodes[id]!;
    const jobName = deterministicJobName(runId, id, st.attempt);
    await executor.submit({ name: jobName, runId, nodeId: id, attempt: st.attempt, identity: identityFor(id), spec: dag.nodes[id]!.spec });
    st.phase = "submitted";
    st.jobName = jobName;
    if (typeof key === "string") busyKeys.add(key);
    slots -= 1;
    submitted.push(id);
  }

  // 6. Advance the run phase + persist `latest` via CAS.
  latest.phase = runPhase(latest);
  latest.updatedAt = now;
  const written = await store.putIfMatch(latestKey(runId), JSON.stringify(latest), etag);
  return { runId, phase: latest.phase, submitted, completed, failed, skipped, conflict: !written.ok };
}
