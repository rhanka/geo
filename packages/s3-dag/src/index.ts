/**
 * `@sentropic/s3-dag` — a narrow, publishable orchestrator for acyclic DAGs whose
 * state lives in S3 and whose nodes run as idempotent Kubernetes Jobs.
 *
 * Frozen contract (NOT a general workflow engine): the DAG is known at build and
 * acyclic; execution is at-least-once via idempotent Jobs; state is immutable
 * receipts + a CAS (If-Match) pointer per run. No loops, no human signals, no
 * distributed transactions — those require a different tool (documented fallback:
 * Argo). Reusability is bounded ON PURPOSE.
 */

export { defineDag, topoOrder, type Dag, type NodeDef, type NodeResources, type ReceiptPredicate } from "./dag.js";
export { availableSlots, DEFAULT_PER_JOB_COST, type PerJobCost } from "./quota.js";
export {
  reconcileTick,
  DEFAULT_MAX_ACTIVE_JOBS,
  type ReconcileArgs,
  type ReconcileResult,
} from "./reconcile.js";
export {
  buildReceipt,
  classifyEligible,
  deterministicJobName,
  initialRunLatest,
  isTerminal,
  runPhase,
  latestKey,
  manifestKey,
  receiptKey,
  receiptsPrefix,
  runPrefix,
  RUN_LATEST_CONTRACT,
  RUN_MANIFEST_CONTRACT,
  NODE_RECEIPT_CONTRACT,
  type NodeOutcome,
  type NodePhase,
  type NodeReceipt,
  type NodeState,
  type RunLatest,
  type RunManifest,
  type RunPhase,
} from "./state.js";
export type {
  DagStore,
  JobExecutor,
  JobIdentity,
  JobStatus,
  JobSubmission,
  ObservedJob,
  QuotaHeadroom,
} from "./ports.js";
export { InMemoryDagStore, FakeJobExecutor } from "./testing.js";
