/**
 * S3 state model + PURE transition helpers (generalizes `pv-capture-backlog`'s
 * immutable-manifest + mutable-CAS-pointer split). Two object classes:
 *   - IMMUTABLE: the run manifest and per-attempt node receipts — write-once.
 *   - MUTABLE (via If-Match): one `latest.json` pointer per run.
 * All state derives from immutable receipts, so indexes are reconstructible from
 * the receipts alone (the "rebuild from S3 only" gate proof), and a reconciler
 * crash never corrupts anything: the next tick recomputes from the same objects.
 */

import { createHash } from "node:crypto";

import type { Dag } from "./dag.js";

export const RUN_MANIFEST_CONTRACT = "s3-dag/run-manifest/v1";
export const RUN_LATEST_CONTRACT = "s3-dag/run-latest/v1";
export const NODE_RECEIPT_CONTRACT = "s3-dag/node-receipt/v1";

/** Immutable: what this run is meant to execute (the frozen node set + order). */
export interface RunManifest {
  contract: typeof RUN_MANIFEST_CONTRACT;
  dagId: string;
  runId: string;
  createdAt: string;
  nodes: readonly string[];
}

export type NodeOutcome = "succeeded" | "failed" | "skipped";

/** Immutable: the terminal record of ONE node attempt (proof v2 of the node). */
export interface NodeReceipt {
  contract: typeof NODE_RECEIPT_CONTRACT;
  runId: string;
  nodeId: string;
  attempt: number;
  outcome: NodeOutcome;
  jobName: string;
  finishedAt: string;
  /** Optional promoted-artifact pointer (freshness reads this, not Job status). */
  artifact?: string | undefined;
  failureReason?: string | undefined;
}

/** Per-node position in the run (mutable, folded into `latest.json`). */
export type NodePhase =
  | "pending"
  | "submitted"
  | "succeeded"
  | "failed"
  | "skipped";

export interface NodeState {
  nodeId: string;
  phase: NodePhase;
  attempt: number;
  jobName: string | null;
  receiptKey: string | null;
}

export type RunPhase = "running" | "complete" | "failed";

/** The single mutable pointer per run — advanced only via CAS (If-Match). */
export interface RunLatest {
  contract: typeof RUN_LATEST_CONTRACT;
  runId: string;
  dagId: string;
  phase: RunPhase;
  updatedAt: string;
  nodes: Record<string, NodeState>;
}

// ── key layout ────────────────────────────────────────────────────────────────
const sanitize = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export const runPrefix = (runId: string): string => `runs/${runId}`;
export const manifestKey = (runId: string): string => `${runPrefix(runId)}/manifest.json`;
export const latestKey = (runId: string): string => `${runPrefix(runId)}/latest.json`;
export const receiptKey = (runId: string, nodeId: string, attempt: number): string =>
  `${runPrefix(runId)}/nodes/${nodeId}/${attempt}/receipt.json`;
export const receiptsPrefix = (runId: string): string => `${runPrefix(runId)}/nodes/`;

/**
 * DETERMINISTIC Job name for a (run, node, attempt) — identical across ticks so a
 * crashed reconciler re-observes/re-submits the SAME Job (idempotent recovery).
 * DNS-1123 safe: `s3dag-<sanitized-node>-<hash12>` (≤ 43 chars).
 */
export function deterministicJobName(runId: string, nodeId: string, attempt: number): string {
  const hash = createHash("sha256")
    .update(`${runId}|${nodeId}|${attempt}`)
    .digest("hex")
    .slice(0, 12);
  const node = sanitize(nodeId).slice(0, 24) || "node";
  return `s3dag-${node}-${hash}`;
}

// ── pure transitions ────────────────────────────────────────────────────────
/** Fresh run pointer: every node pending, attempt 0. */
export function initialRunLatest(dag: Dag, runId: string, now: string): RunLatest {
  const nodes: Record<string, NodeState> = {};
  for (const id of dag.order) {
    nodes[id] = { nodeId: id, phase: "pending", attempt: 0, jobName: null, receiptKey: null };
  }
  return {
    contract: RUN_LATEST_CONTRACT,
    runId,
    dagId: dag.id,
    phase: "running",
    updatedAt: now,
    nodes,
  };
}

const TERMINAL: ReadonlySet<NodePhase> = new Set(["succeeded", "failed", "skipped"]);
export const isTerminal = (phase: NodePhase): boolean => TERMINAL.has(phase);

/**
 * Split the currently-eligible pending nodes (all `needs` terminal) into those to
 * RUN and those to SKIP. Default gate: run iff every `need` succeeded; a `when`
 * predicate overrides it (evaluated over the upstream receipts). A node with a
 * failed/skipped need and the default gate is skipped (cascade), never stuck.
 */
export function classifyEligible(
  dag: Dag,
  latest: RunLatest,
  receipts: Readonly<Record<string, NodeReceipt | undefined>>,
): { runnable: string[]; skippable: string[] } {
  const runnable: string[] = [];
  const skippable: string[] = [];
  for (const id of dag.order) {
    const st = latest.nodes[id];
    if (!st || st.phase !== "pending") continue;
    const needs = dag.nodes[id]!.needs ?? [];
    const allNeedsTerminal = needs.every((n) => {
      const ns = latest.nodes[n];
      return ns !== undefined && isTerminal(ns.phase);
    });
    if (!allNeedsTerminal) continue;
    const upstream: Record<string, NodeReceipt | undefined> = {};
    for (const n of needs) upstream[n] = receipts[n];
    const when = dag.nodes[id]!.when;
    const gate = when
      ? when(upstream)
      : needs.every((n) => upstream[n]?.outcome === "succeeded");
    (gate ? runnable : skippable).push(id);
  }
  return { runnable, skippable };
}

/** Overall run phase from node phases: any failure ⇒ failed; all terminal ⇒ complete. */
export function runPhase(latest: RunLatest): RunPhase {
  const states = Object.values(latest.nodes);
  if (states.some((s) => s.phase === "failed")) return "failed";
  if (states.every((s) => isTerminal(s.phase))) return "complete";
  return "running";
}

/** Build an immutable receipt for a finished node attempt. */
export function buildReceipt(input: {
  runId: string;
  nodeId: string;
  attempt: number;
  outcome: NodeOutcome;
  jobName: string;
  finishedAt: string;
  artifact?: string | undefined;
  failureReason?: string | undefined;
}): NodeReceipt {
  return {
    contract: NODE_RECEIPT_CONTRACT,
    runId: input.runId,
    nodeId: input.nodeId,
    attempt: input.attempt,
    outcome: input.outcome,
    jobName: input.jobName,
    finishedAt: input.finishedAt,
    ...(input.artifact !== undefined ? { artifact: input.artifact } : {}),
    ...(input.failureReason !== undefined ? { failureReason: input.failureReason } : {}),
  };
}
