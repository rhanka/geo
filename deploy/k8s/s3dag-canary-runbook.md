# s3-dag PV canary — runbook (poc-ca, ns `geo`)

The canary proves the **orchestrator (4 owner proofs) + run isolation** on the OVH
poc-ca cluster, on the **preprod bucket only** (`sentropic-geo-preprod`, prefix
`preprod-runs/<sha>/`, never `/normalized`). It does **NOT** prove per-lane egress
enforcement — that is the CI identity boundary (VAP), a prod-gate item (D2+A3).

poc-k8s applies everything; nothing runs without direct owner GO.

## What it deploys (all from tested builders — `emit-manifests.ts`)

```
S3DAG_IMAGE=ghcr.io/rhanka/geo-capture@sha256:<digest> \
S3DAG_PREFIX=preprod-runs/<sha> \
tsx acquisition/src/s3dag/emit-manifests.ts | kubectl apply -f -
```

- **8 pre-provisioned per-lane worker SAs** `s3dag-<lane>-sa` — bare, no RoleBinding,
  `automountServiceAccountToken:false` → default-deny, no `jobs:create`.
- **Reconciler SA + minimal Role/RoleBinding** — `jobs` create/get/list, `pods`
  get/list, `resourcequotas` get, self-suspend (own CronJob), lock lease; **NO
  `serviceaccounts` verb**.
- **Reconciler CronJob** `s3dag-pv-reconciler` (schedule `*/2`, Forbid, tick
  `backoffLimit:0`) → one `reconcileTick` per tick in **lane mode** (assigns
  `s3dag-pv-sa` to every node Job; the reconciler is the only `jobs:create` holder,
  lease-guarded).

## The four owner proofs

1. **Crash recovery** — kill the reconciler pod mid-tick; the next tick recomputes
   from the immutable receipts + CAS `latest.json` (a lost CAS is a no-op, retried).
2. **Real quota respect** — with `tenant-quota` near full, each tick submits at most
   `availableSlots(...)` Jobs (`reservePods:1`); never exceeds any dimension.
3. **Complete immo read-model** — `/v1/refresh/*` (supervision) reports the run from
   the S3 objects; freshness = last promoted artifact, not last green Job.
4. **Index rebuild from S3 only** — reconstruct run state from the manifest +
   receipts alone (no cluster read).

## The three mandatory negative refusals (self-verifying — green Job = proof)

Run `tsx acquisition/src/s3dag/canary-negative-check-run.ts <mode>` in a test Job:

| mode | pod config | expected |
|---|---|---|
| `no-token` | worker config (automount **off**) | exit 0: **no** SA token mounted → worker has no k8s API credential |
| `cannot-create-jobs` | automount **on** (test only) | exit 0: POST jobs → **403** (SA has no `jobs:create`) |
| `cannot-create-sa` | automount **on** (test only) | exit 0: POST serviceaccounts → **403** (cannot invent identity) |

Plus, observed at apply:
- **Undeclared lane** → a Job referencing `s3dag-<undeclared>-sa` is refused (the SA
  does not exist; pods are never created).
- **Cross-lane** (a creator stamping another lane's SA) → closed by the **VAP**
  (`{creator × target SA}`, infra) — a prod-gate item, **not** claimed by this canary.

## Reporting

Report the 4 proofs + CAS-OVH + the 3 negative refusals (observed) to geo-cond →
owner gate (ratify custom `@sentropic/s3-dag` vs Argo fallback + sequence the legacy
strangle). Until the gate, the lane is an **accounting label**; budget/kill-switch are
**not** presented as applied.
