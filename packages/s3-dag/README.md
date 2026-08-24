# @sentropic/s3-dag

A **narrow, publishable** orchestrator for acyclic DAGs whose **state lives in S3**
and whose nodes run as **idempotent Kubernetes Jobs**. No database, no permanent
workers, no supervision server — the run state IS a set of S3 objects, and the API
that supervises it reads those objects directly.

> **This is not a general workflow engine.** It deliberately omits loops, human
> signals, and distributed transactions. If you need those, use a workflow engine
> (Argo/Temporal) — that is the documented fallback. Bounded reusability is the point.

## Frozen contract

- **Acyclic DAG known at build.** `defineDag` validates the graph and rejects cycles
  and dangling edges at definition time.
- **At-least-once execution via idempotent Jobs.** Every node is one Job with a
  **deterministic name** per `(run, node, attempt)`, so re-observe / re-submit is safe.
- **Immutable state + CAS pointer.** Run manifests and per-attempt node **receipts**
  are write-once; a single `latest.json` per run advances only by **compare-and-set**
  (S3 `If-Match`). A crashed reconciler never corrupts state — the next tick
  recomputes from the immutable objects, and indexes are **reconstructible from the
  receipts alone**.
- **Quota-bounded.** Each tick submits at most `availableSlots(...)` Jobs, honouring
  every `ResourceQuota` dimension and reserving the served API's own pods.
- **NHI identity (mandatory).** Every Job runs as a **dedicated per-lane
  ServiceAccount** (never the shared `default`) with optional projected token
  audiences — so a per-lane budget / kill-switch / audit is real, not decorative.

## API

```ts
import { defineDag, reconcileTick } from "@sentropic/s3-dag";

const dag = defineDag({
  id: "pv",
  serviceAccountName: "geo-pv-sa", // dedicated identity, never "default"
  nodes: {
    capture:   { spec: { image: "…", args: ["capture"] } },
    normalize: { needs: ["capture"], spec: { … } },
    extract:   { needs: ["normalize"], tokenAudiences: ["llm-gateway"], // gated, plugs in later
                 when: (up) => up.normalize?.outcome === "succeeded", spec: { … } },
    serve:     { needs: ["normalize"], spec: { … } },
  },
});

// A short reconciler CronJob calls this each tick (single-writer via a k8s lease):
await reconcileTick({ dag, runId, store, executor, quota, now, reservePods: 1 });
```

Supervision (the immo-facing `/v1/refresh/*` read-model) is built on the same
immutable S3 objects; **freshness is the last promoted artifact, not the last green Job**.

## Ports (the only I/O)

`DagStore` (get / put / **putIfMatch** / list), `JobExecutor` (observe / submit), and
`QuotaHeadroom` — injected. In-memory doubles (`InMemoryDagStore`, `FakeJobExecutor`)
ship for unit-testing your own DAGs without a cluster.

## Status

**Phase 0 — pure core + tests**: `dag` (acyclic validation), `state` (S3 model +
transitions + deterministic naming), `reconcile` (crash-safe tick), `quota` (slot
planning), ports + test doubles.

**Phase 1a — state / read / immo-API side** (this PR): `s3-store` (the `DagStore`
adapter over OVH Object Storage, with the [#236] checksum-`WHEN_REQUIRED` fix so
`If-Match`/412 is proven on its own merits), `supervision` (the immo read-model —
overview / freshness / runs / run, freshness = last **promoted artifact**, never a
Job status), and `http` (the read-only `/v1/refresh/*` Hono sub-app geo-api mounts).
No cluster needed — all exercised against the in-memory doubles + a mocked S3 client.

**Phase 1b — executor + canary** (next PR): the real Kubernetes Jobs executor
(per-run dedicated SA, projected tokens), the PV DAG, and the reconciler CronJob,
run on the OVH poc-ca to prove the owner's four gates (crash recovery · quota
respect · complete immo read-model · index rebuild from S3 only) — else Argo
fallback. License: Apache-2.0.
