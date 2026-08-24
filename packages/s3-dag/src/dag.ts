/**
 * DAG definition + acyclic validation. A DAG is KNOWN AT BUILD (the frozen
 * contract): a fixed set of nodes with `needs` edges, validated acyclic here so
 * a cycle is a build-time error, never a runtime deadlock. No dynamic node
 * creation, no loops, no human-signal waits — those are out of contract.
 */

import type { NodeReceipt } from "./state.js";

/** Per-node quota cost (defaults applied by the quota planner). One pod by default. */
export interface NodeResources {
  pods?: number;
  requestsCpuMilli?: number;
  requestsMemoryBytes?: number;
  limitsCpuMilli?: number;
  limitsMemoryBytes?: number;
}

/**
 * Gate predicate over the receipts of a node's upstream `needs`. Returns true to
 * RUN the node, false to SKIP it (terminal `skipped`). Default (no predicate):
 * run iff every `needs` succeeded. A gated-off node (e.g. the LLM node before its
 * egress exists) uses `when` to plug in later without changing the graph shape.
 */
export type ReceiptPredicate = (
  upstream: Readonly<Record<string, NodeReceipt | undefined>>,
) => boolean;

/** A single DAG node — an opaque, idempotent unit of work run as one Job. */
export interface NodeDef {
  /** Upstream node ids that must be terminal before this node is considered. */
  needs?: readonly string[];
  /** Optional gate over upstream receipts (default: all `needs` succeeded). */
  when?: ReceiptPredicate;
  /** Nodes sharing a concurrency key never run simultaneously. */
  concurrencyKey?: string;
  /** Per-node quota cost (default: one pod). */
  resources?: NodeResources;
  /**
   * Projected service-account token audiences for this node's Job (NHI): e.g. the
   * LLM gateway audience for an extraction node. Empty by default — a node that
   * needs no minted egress identity mounts no projected token.
   */
  tokenAudiences?: readonly string[];
  /** Opaque job spec handed to the executor (image, args, …). */
  spec: unknown;
}

/** A validated, acyclic DAG with a precomputed topological order. */
export interface Dag {
  readonly id: string;
  readonly nodes: Readonly<Record<string, NodeDef>>;
  /** A topological order of node ids (upstream before downstream). */
  readonly order: readonly string[];
  /**
   * Dedicated per-lane ServiceAccount every node's Job runs as (NHI: the pod
   * authenticates as ITSELF, never the shared `default`). Mandatory: without a
   * distinct identity per lane, a per-lane budget / kill-switch / audit is
   * decorative (a budget on `default` is a mislabelled global one).
   */
  readonly serviceAccountName: string;
}

const SA_RE = /^[a-z0-9]([a-z0-9-]{0,251}[a-z0-9])?$/;

/**
 * Kahn's algorithm. Returns a topological order, or throws if the graph has a
 * cycle or a dangling `needs` reference (both are contract violations).
 */
export function topoOrder(nodes: Readonly<Record<string, NodeDef>>): string[] {
  const ids = Object.keys(nodes);
  const idSet = new Set(ids);
  const indegree = new Map<string, number>(ids.map((id) => [id, 0]));
  const dependents = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const id of ids) {
    for (const need of nodes[id]!.needs ?? []) {
      if (!idSet.has(need)) {
        throw new Error(`s3-dag: node "${id}" needs unknown node "${need}"`);
      }
      indegree.set(id, indegree.get(id)! + 1);
      dependents.get(need)!.push(id);
    }
  }
  // Deterministic order: seed the queue with zero-indegree nodes in id order.
  const queue = ids.filter((id) => indegree.get(id) === 0).sort();
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const dep of dependents.get(id)!) {
      const next = indegree.get(dep)! - 1;
      indegree.set(dep, next);
      if (next === 0) {
        // Insert keeping the queue sorted for a deterministic total order.
        const at = queue.findIndex((q) => q > dep);
        if (at === -1) queue.push(dep);
        else queue.splice(at, 0, dep);
      }
    }
  }
  if (order.length !== ids.length) {
    const stuck = ids.filter((id) => !order.includes(id)).sort();
    throw new Error(`s3-dag: cycle detected among nodes [${stuck.join(", ")}]`);
  }
  return order;
}

/**
 * Validate + freeze a DAG definition. Throws on an empty graph, a dangling
 * `needs`, or a cycle. The returned {@link Dag} carries a stable topo order.
 */
export function defineDag(input: {
  id: string;
  /** Dedicated per-lane ServiceAccount — mandatory, never "default" (NHI). */
  serviceAccountName: string;
  nodes: Record<string, NodeDef>;
}): Dag {
  if (!input.id) throw new Error("s3-dag: dag id is required");
  const sa = input.serviceAccountName;
  if (!sa || sa === "default") {
    throw new Error(
      's3-dag: a dedicated serviceAccountName is required and must not be "default" (NHI: per-lane identity for budget/kill-switch/audit)',
    );
  }
  if (!SA_RE.test(sa)) {
    throw new Error(`s3-dag: invalid serviceAccountName "${sa}" (must be a DNS-1123 subdomain)`);
  }
  const ids = Object.keys(input.nodes);
  if (ids.length === 0) throw new Error(`s3-dag: dag "${input.id}" has no nodes`);
  const order = topoOrder(input.nodes);
  return { id: input.id, nodes: { ...input.nodes }, order, serviceAccountName: sa };
}
