# deposit-job — LOT-1 served-zonage deposit (INERT SKELETON)

**Status: INERT skeleton.** No cred, no real image, `MODE=inspect` (writes nothing). Prepared ahead of the
LOT-1 "vraies zones" go-line to shorten the path; the **real binding + run are owner-gated** (go-line + A′
secret provisioning) and **i-infra co-val'd** (least-priv). See [`../../CLAUDE.md`](../../CLAUDE.md) on
provenance and `putServedZoneGeojson`.

## What it is

A k8s Job that **replaces a served `qc-zonage-<slug>` collection** with an in-force provider layer
(ArcGIS / WFS / …) by wrapping a **proven** `acquisition/src/zones-*-replace.ts` runner. The runner re-stamps
**proof v2** in the same pass (`putServedZoneGeojson`, byte-for-byte URL + `retrieved_at` + `sha256`) and
enforces the anti-invention / spatial / recoupement / coverage gates before any write. It writes **only** the
served-zonage prefix `normalized/ca-qc-zonage/` (double-layout: flat + sub-folder where geo-api serves both).

We do **not** block LOT-1 on a clean `geo deposit --commit` CLI — wrapping the proven runner is the fast path.
A tidy `deposit --commit` CLI is a **separate later refactor (i-arch)**, a nicety, not required.

## A′ credential isolation (the whole point)

`job-deposit.yaml` binds a **PLACEHOLDER** secret `geo-served-zonage-deposit-cred` via `envFrom` —
the **dedicated A′ secret scoped to `normalized/ca-qc-zonage/*` ONLY**. It is **deliberately NOT**
`geo-s3-credentials` (the broad capture/acquisition cred every existing job orchestrator hardcodes —
`acquisition/src/k8s-shard-run.ts:185`, etc.). Binding the broad cred would re-introduce the exact
capture→served blast-radius A′ exists to isolate.

The A′ secret is **provisioned by the owner at go-line** and its least-priv action-set is **co-val'd by
i-infra** (which reads `acquisition/src/lib/zonage-proof.ts` + these manifests directly). The keyString /
cred **never travels the coordination channel** — i-infra designs, k8s executes, the owner gates.

## Parameters (`job-deposit.yaml` env)

| env | inert default | meaning |
|---|---|---|
| `RUNNER` | `zones-arcgis-replace.ts` | any committed proven `acquisition/src/zones-*-replace.ts` |
| `MODE` | `inspect` | `inspect` = validate gates + print, **NO write**; `deposit` = owner-gated real write |
| `RUNNER_ARGS` | `""` | runner flags (e.g. `--slug … --layer <url> --zone-field …`); must NOT carry `--inspect`/`--deposit` |

## Acceptance (at go-line, before trusting a real deposit)

A read-only **capability** probe (not a write-probe): with the A′ cred,
`kubectl auth can-i` / an S3 policy check shows the identity **CAN** write `normalized/ca-qc-zonage/*` and
**CANNOT** write anything outside it. Then a `MODE=inspect` dry pass shows the gates green for the target
slug, before a `MODE=deposit` run.

## Go-line checklist (owner + i-infra, NOT done here)

1. Owner provisions `geo-served-zonage-deposit-cred` (scoped `normalized/ca-qc-zonage/*` only).
2. i-infra co-vals the least-priv action-set + reads these manifests.
3. Build + push `deploy/deposit-job/Dockerfile` → set the real image tag in `job-deposit.yaml`.
4. Set `RUNNER` / `RUNNER_ARGS` for the target slug(s); run `MODE=inspect` first, then `MODE=deposit`.
5. (If many slugs) a sharding orchestrator — deferred; the single-Job template suffices to start.
