/**
 * Ports — the ONLY I/O surfaces the engine depends on. Concrete adapters
 * (a real S3 store, a Kubernetes Jobs executor, a live ResourceQuota reader)
 * live outside this lib; tests inject in-memory fakes. Keeping the engine pure
 * against these ports is what makes reconciliation deterministic + crash-safe.
 */

/**
 * A minimal object store with compare-and-set (If-Match) semantics — the single
 * source of truth. Immutable objects (manifests, receipts) are written with
 * {@link put}; the one mutable pointer per run (`latest.json`) is advanced only
 * with {@link putIfMatch}, so two concurrent reconcilers can never both win.
 */
export interface DagStore {
  /** Read an object + its ETag, or `undefined` if absent. */
  get(key: string): Promise<{ body: string; etag: string } | undefined>;
  /** Unconditional write (immutable objects, keyed by content/attempt). */
  put(key: string, body: string): Promise<{ etag: string }>;
  /**
   * Compare-and-set write. `etag` is the expected current ETag, or `null` to
   * require the object be ABSENT (create). Resolves `{ok:false}` on mismatch
   * (the S3 `If-Match`/`If-None-Match` 412) — never throws on a lost race.
   */
  putIfMatch(
    key: string,
    body: string,
    etag: string | null,
  ): Promise<{ ok: true; etag: string } | { ok: false }>;
  /** List keys under a prefix (for index reconstruction from immutable objects). */
  list(prefix: string): Promise<string[]>;
}

/** Lifecycle status of a submitted Job, as observed from the cluster. */
export type JobStatus = "missing" | "pending" | "active" | "succeeded" | "failed";

/** A Job observed by name (deterministic name ⇒ observation survives a crash). */
export interface ObservedJob {
  name: string;
  status: JobStatus;
  failureReason?: string | undefined;
}

/**
 * Non-human identity a Job runs as. The executor MUST create the Job with this
 * dedicated ServiceAccount (never the shared `default`) and mount a projected
 * token for each audience — so a per-lane budget / kill-switch / audit is real.
 */
export interface JobIdentity {
  serviceAccountName: string;
  /** Projected service-account token audiences (e.g. the LLM gateway); may be empty. */
  tokenAudiences: readonly string[];
}

/** One Job to submit — identified by a DETERMINISTIC name so submit is idempotent. */
export interface JobSubmission {
  name: string;
  runId: string;
  nodeId: string;
  attempt: number;
  /** NHI identity the executor binds to the Job (dedicated SA + projected tokens). */
  identity: JobIdentity;
  /** Opaque per-node spec; the executor interprets it (image, args, resources). */
  spec: unknown;
}

/**
 * Executes DAG nodes as at-least-once idempotent Jobs. `submit` MUST be
 * idempotent by `name` (re-submitting an existing Job is a no-op) so a crashed
 * tick can re-run safely. In prod: Kubernetes Indexed Jobs, `backoffLimit:0`.
 */
export interface JobExecutor {
  observe(names: readonly string[]): Promise<ObservedJob[]>;
  submit(job: JobSubmission): Promise<void>;
}

/**
 * Cluster headroom at tick time, in Kubernetes units — a pure input to slot
 * computation (never exceed it; reserve the served API's own slot).
 */
export interface QuotaHeadroom {
  pods: number;
  requestsCpuMilli: number;
  requestsMemoryBytes: number;
  limitsCpuMilli: number;
  limitsMemoryBytes: number;
}
