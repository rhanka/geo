# Auto-refresh pipeline — deploy / orchestration plumbing (geo-socle section)

geo-socle contribution to the canonical auto-refresh design (track `01M1S25MVCND04YZN76KTVNGAE`; i-cond
consolidates the canonical immo doc; geo-cond consolidates geo-side). Owner top-prio: a 100%-automated
refresh on k8s **cluster-mesh**, **all layers**, reduced to the **only-necessary** components (AI included).
Grounded measure-over-infer (file:line + real status).

## SEAM — this domain is the deploy/orchestration PLUMBING
It is NOT a graph-node producer (unlike zones/archi). The **canonical-graph + atomic-PG-writer LOGIC are
IMMO-owned** (immo E5: `api/src/services/graph/canonical-graph-writer.ts` — `upsertGraphAtomic`, already
partial: writer-gated + archive + ETag + concurrent-PUT refusal). **geo NEVER writes `graph_nodes`**: geo
DEPOSITS to S3 and SERVES its contracts (ConstraintHit spatial-join + OGC zones); immo consumes at E4
canonical-merge. This section owns the **DEPLOY/orchestration on cluster-mesh** of the pipeline: netpols
(extension of the A2 model), capture→S3→deposit deploy, full-auto orchestration hooks, and the DEPLOY of the
atomic-PG-writer as an exactly-1 mesh-wide singleton (its logic stays immo E5).

Convergence note: geo-zones independently identified the same two primitives (CronJob self-driver + s3dag
reconcile) → the design is **reconcile-driven on the existing substrate**, not from-scratch.

## (i) Reusable vs to-create

### Reusable (file — status)
- Serving deploy: `deploy/k8s/base/{deployment,service,ingress,kustomization}.yaml` + `overlays/preprod|prod/*` — **both CD paths use kustomize `base/`** (preprod & prod overlays → `../../base`; digest-pinned). LIVE.
- §5 basemap descriptor + OGC-from-S3: `packages/geo/src/basemap/endpoint.ts` + `api/app.ts` — GEL-ratified.
- netpol A2: `overlays/preprod/netpol.yaml` (+ `preprod/geo-api-preprod-sync-job.yaml` allow-geo-sync-egress) — applied → EXTEND for mesh.
- CD/release: `cd-preprod.yml` (main→deploy auto), `cd-prod.yml` (owner-gated same-digest promotion, ADR-0028), `docker-publish.yml`, `npm-publish.yml` (lockstep OIDC) — proven.
- Capture-on-cluster: `deploy/capture-job/*` + `acquisition/src/k8s-capture-run.ts` + `docs/spec/SPEC_CAPTURE_ON_CLUSTER.md` — run in prod.
- ★ Self-driving in-cluster CronJob orchestrator: `deploy/k8s/pv-probable-backlog-cronjob.yaml` (+ `pv-backlog-rbac.yaml`) — schedule + `concurrencyPolicy: Forbid` + coordination.k8s.io lease-lock + state-on-S3 + self-suspend-at-terminal + launches child Jobs from an S3 worklist. Proven → **THE reusable full-auto primitive.**
- Extraction/AI: `deploy/acquisition-job/*` + `deploy/normes-job/*` (Mistral vision extract→deposit) + `acquisition/src/k8s-shard-run.ts`, `k8s-captured-normes-run.ts` — proven.
- ★ Declarative reconcile/DAG: `acquisition/src/s3dag/{pv-dag,reconcile-run,canary-node-run,emit-manifests}.ts` + `deploy/k8s/s3dag-*` — **the desired-state reconcile seed of the full-auto engine.**
- Deposit: `feat/deposit-job-skeleton` (INERT, A′-scoped placeholder secret) + `acquisition/src/zones-*-replace.ts` (proof-v2 re-stamp). Skeleton preserved; real LOT-1 Job = to-create at go-line.
- Refresh propagation (§6.1): `deploy/k8s/preprod/geo-api-preprod-sync-job.yaml` + `geo-api-preprod-verify-job.yaml` + `deployer-preprod-rbac.yaml` (prod→preprod, one-way, fail-closed served_count+set_hash).
- RBAC/creds: `deploy/ci/geo-ci-rbac.yaml`, `deployer-preprod-rbac.yaml`, `tenant-quota.yaml`, `overlays/preprod/sealed-secrets.yaml`.

### To-create (deploy/orchestration plumbing only)
1. ★ **Cross-stage chaining orchestrator** (CORE) — stages are SEPARATE, dispatch-launched (`.github/workflows/geo-jobs.yml` = `workflow_dispatch`; `schedule:` commented L20-21). No auto-chain capture→extract→deposit→serve. → a reconcile-driven orchestrator built on the CronJob self-driver + s3dag; the cross-stage-boundary logic is new.
2. **`render-<job>.ts` per layer** — `geo-jobs.yml:61` renders `deploy/constraints/render-<job>.ts`; only `cptaq-serve` exists. Need reindex / projections / 3D-tiles / zones / norms.
3. **atomic-PG-writer DEPLOY** — writer LOGIC = immo E5 (`api/src/services/graph/canonical-graph-writer.ts`, exists partially). My part: package + deploy as an **exactly-1 mesh-wide singleton** (single-writer invariant, self-heal), netpol'd. geo never writes `graph_nodes`. `postgis-statefulset.yaml` + `geo-postgis-service.yaml` exist (the PG); the writer-workload singleton deploy = to-create.
4. **Mesh-aware manifests** — see (iii).
5. **Full-auto trigger wiring** — pick ONE substrate (Q1), wire per layer.

## (ii) Full-auto flow — reduced to ONLY-necessary
```
[schedule] in-cluster CronJob orchestrator (pv-backlog pattern: lease-lock + S3 state + self-suspend)
   → [decide] s3dag reconcile: desired-state diff — which layers/slugs are STALE? (idempotent, "rejouable")
   → [work]   launch stage Job(s): capture → normes/extract → deposit (each writes S3 + updates S3 state;
              the reconcile loop picks up the next stage)
   → [serve]  geo-api serves S3 LIVE (OGC) — a deposit is served with no rollout;
              atomic-PG-writer projects S3→PG (graph) as a mesh singleton (immo logic)
   → [verify] verify-served (served_count + set_hash fail-closed) → loop marks the unit fresh
```
Only-necessary = **ONE** orchestrator substrate + **ONE** reconcile brain (s3dag) + the stage Job packagings
+ the atomic-PG-writer deploy. DROP: the manual `workflow_dispatch` path once auto; the superseded flat
manifests (see prune).

## (iii) Cluster-mesh integration + the deploy→mesh SEAM
- Serving on the mesh: geo-api per-cluster replicated vs single + mesh-routed (Q3, i-infra/mesh). netpol A2 extends to cross-cluster egress (S3, provider) + ingress (mesh routing).
- Capture/stage jobs: run where compute is; **S3 is the shared cross-cluster substrate** (pods hold no local state, `SPEC_CAPTURE_ON_CLUSTER.md`) → mesh-native by construction.
- atomic-PG-writer as a mesh singleton: exactly ONE writer mesh-wide (cross-cluster lease/singleton), self-heal without grounding loss — the hard mesh invariant. Deploy owns the singleton guarantee; logic = immo E5 (`canonical-graph-writer.ts`). geo never writes `graph_nodes`.
- **THE SEAM (deploy → cluster-mesh):** where geo's workload manifests (base/overlays/netpols/jobs/CronJobs) meet the mesh substrate — cluster/namespace targeting, cross-cluster service discovery, mesh netpols. **i-infra/mesh owns the substrate; geo-socle owns the geo-workload manifests that run on it.**

## Prune-audit (only-necessary) — read-only result; DELETION HELD for a design PR
Both CD paths use kustomize `base/` (preprod & prod overlays → `../../base`), so the flat serving manifests are **CD-unused (superseded by base/, ADR-0028 deployment-plane adoption)** — but **doc-entangled**, so deletion is NOT trivial. The superseded set is **6 files** (two parallel lines of Deployment/Service/Ingress); note there is NO `deploy/k8s/service.yaml` — `base/service.yaml` is the kept kustomize source:
- `geo-api-deployment.yaml`, `geo-api-service.yaml`, `geo-api-ingress.yaml` — CD-unused; referenced as "the serving manifest" by `deploy/k8s/README.md`, `docs/spec/DESIGN_GEO_DEPLOYMENT_PLANE_ADOPTION_2026-08-19.md`, `docs/spec/DOSSIER_PIPELINES_*.md` (cite `geo-api-deployment.yaml:34-53`), `docs/spec/contrat-jointure-immo-zones-lots.md`. → delete + **repoint those citations to `base/deployment.yaml` etc.**
- `deployment-api.yaml`, `service-api.yaml`, `ingress.yaml` — the older "librairie" line, README says **NON déployée**; CD-unused. → delete + clean README/`docs/deploy.md`.
- `job-fetch.yaml` — **KEEP / migrate**: referenced by `SPEC_CAPTURE_ON_CLUSTER.md` (the 3 SDA `geo fetch` calls) — part of capture, not dead. Fold into the capture line rather than delete.
- `postgis-statefulset.yaml` + `geo-postgis-service.yaml` — **KEEP** until the atomic-PG-writer lands.
⟹ The prune is a bounded **design PR** (manifests + doc-citation repoints), co-val'd, not unilateral. The single canonical serving-manifest source = kustomize `base/` + overlays.

## Open questions (converge)
- Q1 Trigger substrate: in-cluster CronJob (mesh-native, GH-independent) **[lean]** vs GH schedule. *(emerging consensus, pending i-cond/i-infra cross-check)*
- Q2 Chaining: reconcile desired-state (s3dag, idempotent/self-heal, "rejouable") **[lean]** vs per-stage completion-hooks. *(emerging consensus)*
- Q3 Mesh serving boundary: per-cluster replicated vs single + mesh-routed. → i-infra/mesh.
- Q4 geo↔immo seam: exact deposit→immo-consume + S3→PG-projection handoff point. → i-cond/i-arch.
