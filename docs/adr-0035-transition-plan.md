# ADR-0035 — transition plan (geo side)

Status: **draft for the owner decision dossier**, 2026-10-31. Companion of ADR-0035 (`docs/decisions.md`, PR #427,
`proposed`). It changes no code and starts no lot: nothing begins before the owner ratifies ADR-0035 with an
owner-direct record.

Author: geo-cond. Radar-side lots carry **radar's own estimates**, written by the immo conductor and not by geo:
`radar-lots-estimates.md` (radar `origin/main` `9ca451cf7`, 2026-10-31, sha256
`767b8abaffdce9a1513e7efc91e948831799424bad9f3b49a5c7c45cb58016f8`), at
`rhanka/radar-immobilier` main `docs/spec/reports/etude-geo-dag/radar-lots-estimates.md` (committed by
rhanka/radar-immobilier#967). Radar counts in
agent-days (CI and review included); the calendar rounds them **up** to whole working days. External dates are
those given by their owner; a missing date is `unknown` or `pending`, with the name of whoever has to give it.

## 0. How durations are estimated

- Unit: **working days (wd)**, Monday–Friday, Quebec statutory holidays removed. Observation windows are
  **calendar days (cal d)** and are fixed by ADR-0035 (7 cal d per cohort, 28 cal d before L8).
- Every geo duration = **build estimate + explicit buffer**, shown as two numbers. No margin is hidden inside an
  estimate.
- Basis = comparable geo work, measured on GitHub and `git log` (first PR opened → last PR merged):

| comparable geo work | PRs | measured | used for |
|---|---|---|---|
| s3-dag code + canary wiring (core, OVH CAS store, `/v1/refresh`, identity, k8s executor, quota/lease, runbook, RBAC) | #243–#254 (11) | one burst, ~8 h, 2026-08-22 | L0 canary pieces, L2 identity wiring |
| geo PV chain `pv-capture-backlog` + 2 CronJobs | inside #43 | 2 wd (2026-07-26 → 07-29) | L3 chain extension |
| served contract (`latest.json` → snapshot, CAS) | inside #43 | 1–2 wd (2026-07-26 → 07-28) | L4 `pv-signals/v1` writer |
| bascule preprod | #391–#399 (5) | 1 wd | L0 hygiene, L6 cohort mechanics |
| daily backup + restore | #402–#412 (10) | 2 bursts, ~13 h, 2026-09-26 | L0 canary run and report |
| zoning events v2 (PR-tracked part) | #226–#287 (6) | 9 wd with gaps | L4 reconcile + signals port |
| capture proof index | #165–#170 (4) | 1 wd | L1 digest pin + CI check |
| radar `@radar/sources` → `qc-sources` port | #6 | 6 wd | L8 PV adapters move |

Caveat: geo PRs usually go from open to merged in minutes to hours, in bursts. The buffers below cover review, CI
reruns, and the **2-open-PR limit** (section 5, risk R1). They do not cover owner availability, which is shown
separately as go/no-go gates.

## 1. Lots

`Owner` = who delivers the lot. `Entry` = what must be true to start. `Exit` = criterion to close it.

| lot | content | owner | entry prerequisites | exit criterion | duration (build + buffer) and basis | rollback |
|---|---|---|---|---|---|---|
| **L0.a** | Hygiene: deduplicate CronJob `geo-pv-backlog-pv-probable-20260728-b32de19169bc` (two files), commit or drop untracked `deploy/k8s/geo-pv-refresh-cronjob.yaml`, pin images by digest | geo | ADR-0035 ratified; a free PR slot (R1) | PR merged; `kubectl get cronjob` shows one object | 1 + 1 wd (bascule #391: 5 small PRs in 1 wd) | revert PR |
| **L0.b** | Canary pieces still missing: test-Job manifests for the 3 refusals (`no-token`, `cannot-create-jobs`, `cannot-create-sa`); real image digest instead of `REPLACE_WITH_DIGEST_AT_APPLY`; Dockerfile/CI/Make wiring (`make pv-dag-render\|apply\|status ENV=preprod`) | geo | L0.a merged | PR merged; render output reviewed | 3 + 2 wd (s3-dag wiring #248–#254 in one ~6 h burst; 3 wd covers the CI and image steps not done then) | revert PR |
| **L0.b'** | Narrow VAP-canary Deny (runbook: written by infra, owner go) | k8s | ADR-0035 ratified | VAP applied in preprod | `pending`: date to give by k8s | remove the VAP |
| **G1** | Owner go: VAP + apply + run of the canary | owner | L0.b + L0.b' done; `geo` quota figure known | recorded go | gate, 2 wd allowed (hypothesis) | stop |
| **L0.c** | Canary run on the preprod bucket: 4 owner proofs (crash recovery, real quota respect, complete immo read-model via `/v1/refresh/*`, index rebuild from S3 only) + 3 negative refusals; report | geo | G1 | 4/4 proofs and 3/3 refusals observed and recorded in the report | 2 + 1 wd (backup + restore: 10 PRs, run, verdict, in ~13 h) | delete the canary run prefix `preprod-runs/<sha>/` |
| **G2** | Owner go: canary ratification. **No-go = Argo fallback** (ADR-0035 item 2), which reopens this plan | owner | L0.c report | recorded go, or recorded fallback | gate, 2 wd allowed (hypothesis) | — |
| **L0.r** | Refresh-pv LLM baseline over 7 days. Tokens are recorded nowhere today: instrument first (usage hook → receipt `tokensIn`/`tokensOut`, nullable; migration on `refresh_document_outcomes`; SQL report by `cycle_id`), then measure | radar | ADR-0035 ratified; prod CronJob actually running for the 7 days | baseline report (receipts, tokens per provider/model/transition) | 0.5 agent-day (radar #806, #732) + release and prod promotion (2 wd, hypothesis) + **7 cal d** | n/a |
| **L1.r** | Radar to Engram 0.24.0: bump (19 imported symbols identical, checked in 0.23.0), then F-EN4 adoption; fix on purpose the stale `packageVersion: "0.18.0"` in the refresh run identity (`refresh-pv.ts:247`), an identity change for in-flight city states | radar | F-EN4 published (no published Engram has it, 0.23.0 and 0.23.1 checked) | radar suites green on 0.24.0; merge keeps both citations; one v101b run | 0.5 + 0.5 (F-EN4) + 0.5 buffer agent-day (radar #932) | repin 0.21.2 |
| **L1.p** | Shared profile v2.2 published with digest: Engram project folder `radar/ontology/pv-signals/` pointing at the whole radar profile (787 lines, 9 types, no fork), interim radar digest + CI, switched to F-EN2 when it ships; profile versioning rule (OQ-12) settled | radar + geo | OQ-12 agreed by both conductors; F-EN2 for the final digest | digest published; CI fails on digest drift; OQ-12 recorded in ADR-0035 | inside L1.r for radar; OQ-12: 1 wd geo. The interim → F-EN2 digest switch forces one reviewed digest bump (R11) | previous digest |
| **L1.g** | Geo consumes the profile read-only by `git sha + digest`, CI digest check; graphify 0.17.1 PV profile aligned | geo | G2; L1.p | CI fails on a digest mismatch (negative test) | 1 + 1 wd (capture proof index #165–#170: 1 wd) | pin previous digest |
| **L2.c** | F-CM1, F-CM2, F-CM3 usable in preprod (amended contracts, section 2) | sentropic | ADR-0035 ratified **and** a slot in the sentropic queue; owner Q1 answer (seats) + terms-of-use check; Cloud Code question answered | sentropic exit criteria: 4 concurrent callers across 2 replicas, no provider credential in Job specs, shared 429 honoured, cap never jointly exceeded, forged lane refused, offboarding effective within one token lifetime | `unknown` (sentropic: no date before ratification and slotting) | n/a |
| **L2.v** | Job-creator boundary: whoever creates a Job can pick its service account, so a lane is only an accounting label until an admission policy (VAP) or namespace isolation constrains that choice (`s3-dag/src/identity.ts:22`, sentropic F-CM3 acceptance) | k8s + geo | G2 | a Job of one lane cannot run under another lane's SA (negative test) | geo 1 + 1 wd (VAP pattern of `vap-ci-trigger-suspend-only.yaml`); k8s part `unknown` | remove the policy |
| **L2.g** | Geo extract node: lane service account, token exchange (F-CM3), flag `REFRESH_LLM_TRANSPORT=gateway` | geo | G2; L2.c | one Job calls the gateway in preprod, no credential in the pod spec | 2 + 1 wd (s3-dag identity PRs, same burst) | flag back to `keyring` |
| **L3.b** | Extend `pv-capture-backlog` to radar's 528 cities, one DAG per city, `concurrencyKey = source host`; bounded-memory streaming collection (Track `01M41PRZG9JB8CTE805D23TAE1`, canary: 172 MB vsad.ca PDF under 768 Mi) | geo | G2; `geo` quota figure (k8s); L3 thresholds confirmed by both conductors in the L3 PR | PR merged; memory canary passes | 5 + 3 wd (PV chain: 2 wd; +3 wd for streaming and refreshing the June radar adapter copy, an explicit hypothesis) | stop the DAG |
| **L3.r** | Shadow `detect → capture → text`, 3 consecutive geo cycles; parity on sha sets (ADR-0035 gate values) | geo | L3.b | L3 parity thresholds met | 3 cal d run (hypothesis: one cycle ≤ 1 day, **`unknown` until the first cycle is measured**) + 1 + 2 wd analysis and re-run | stop the DAG |
| **L4.g** | Nodes `extract → verify → reconcile → signals → promote`; signals ported from radar's **live** path (profile-driven extraction with the shared profile, then the deterministic enrichment of `graphify-34-enrichment.ts`: `etape`, `instrument`, and the materialization in `graph-store.ts`), with a golden test against that code. `exploitation/signals.ts` only feeds a count in radar's seed route and is **not** the reference. Contract writer `exports/immo/pv-signals/v1/` with its size budget | geo | L1.g, L2.g, L3.r done; F-EN1, F-EN3, F-EN4 in 0.24.0; verify path decided (R6); split of `etape`/`instrument` derivation decided (R12); L4 thresholds confirmed | PR merged; golden test 100 % identical signals vs the live path | 9 + 5 wd (zoning events v2: 9 wd; served contract: 1–2 wd; s3-dag nodes: one burst) | revert PR; contract prefix unpublished |
| **L4.r** | Shadow on the Q2 sample (budget ≤ 2× the L0.r baseline, kill-switch above it) + v101b benchmark | geo | L4.g; L0.r baseline; owner Q2 sample | L4 parity thresholds met (ADR-0035) | 3 + 2 wd (hypothesis; run length depends on the sample size, `unknown`) | stop |
| **L4.c** | `radar-pv-consume`: contract client (schemas, sha256 checks, size budgets, incomplete snapshot refused), `event_id` → `::` mapping table written in the projection transaction, merge onto the canonical baseline (never the contract alone, since `upsertGraphAtomic` deletes absent nodes), dry-run report per city/kind via `upsertGraphAtomic(..., { preview: true })` | radar | contract v1 field names confirmed by geo-cond; read-only credential on `exports/immo/pv-signals/` (k8s mint + rotation); a golden contract fixture, so the build runs **beside L4.g** | dry-run report: canonical and signal diff, Jaccard, facets before = after, `needs_review` rate | 2 + 1 buffer agent-days (radar #679, #853, #825) | stop |
| **G3** | Owner go: L4 parity accepted, start L5 | owner | L4.r + L4.c | recorded go | gate, 2 wd allowed (hypothesis) | stop at L4 |
| **L5** | Preprod cohorts by allowlist (one ConfigMap read by both CronJobs; radar refresh skips it at `configOnlyCitySlugs()`); rollback rehearsed once inside the windows | geo + radar | G3 | each cohort: 0 incomplete snapshot read as complete, `latest.json` age ≤ 6 h p95, 0 dropped signal; rehearsal done | **N × 7 cal d**, N `unknown`; plan uses **N = 3** (hypothesis); geo allowlist mechanics 1 + 1 wd and radar 1 agent-day (allowlist, prod overlay, rollback runbook), both done during L4 | remove the city from the allowlist + canonical pre-image |
| **G4** | Owner go: prod | owner | L5 exit | recorded go | gate, 2 wd allowed (hypothesis) | stay in preprod |
| **L6** | Prod cohorts; each widening is a geo-prod Environment approval | geo + radar | G4 | same criteria as L5, in prod | N × (1 wd approval + 7 cal d), N = 3 (hypothesis) | same as L5 |
| **L7** | `join` (lot, zone; role only after the Loi 25 decision); `geo_resolutions` fed from the contract. Radar has **two** writers to switch: the `run-geo-mapper` Job and the `populate-geo` daily CronJob (`--no-resolve`) | geo + radar | L6 started; Loi 25 owner decision for role (else role excluded); contract zone/lot ids resolvable to radar canonical ids (`unverified`) | resolution rate reported; both radar writers off; consistency E1 unchanged on identical input | **inside the 28-day window**, not on the critical path: geo 3 + 2 wd; radar 1 + 0.5 agent-day + 7 cal d shadow (radar #253) | re-enable the Jobs |
| **L7.m** | F-CM5 as amended by sentropic: a **geo-owned** read-only MCP provider (overview, runs, freshness) on cluster-mesh's existing MCP composition, in `@sentropic/s3-dag` 0.2.0; add the city dimension to `RefreshFreshness` (lane-level today, `supervision.ts:44`) and bind reads to an authorized tenant/workspace (the `runs/` read lists the whole prefix today, `supervision.ts:117`) | geo | F-CM3 read authority; immo-mcp receiving side | the 3 tools serve authorized `geo-pv` reads and refuse cross-tenant and cross-workspace access before any read | 3 + 2 wd **inside W28** (s3-dag supervision `/v1/refresh` was built in the #247 burst; +2 wd for tenant binding and the city key) | unregister the provider |
| **W28** | 28 cal d after the last cohort, radar CronJob deployed and suspended | — | L6 last cohort | ADR-0035 exit criteria held for 28 d | 28 cal d (fixed) | radar re-arms its CronJob |
| **G6** | Owner go: L8 | owner | W28 | recorded go | gate, 2 wd allowed (hypothesis) | — |
| **L8** | Radar: retire `radar-refresh-pv`, watchdog, keyring PVC and the seat secrets, the `refresh-*` modules not reused by pv-consume, the **PV use** of RECUEIL (the module is shared with 5 other callers and stays) and the `signals.ts` seed count. Radar's enrichment (`graphify-34-enrichment.ts`) **stays** (facets, vivier). Geo: PV adapters into `qc-sources` | radar + geo | G6; every city in the allowlist; F-EN5..F-EN9 needed by radar (P2); owner go for deleting the PVC and secrets | no manifest or workflow still names `radar-refresh-pv`; geo adapters merged | radar 1 (+0.5 if PV adapters/RECUEIL in scope) agent-day (radar #683, #728); geo 2 + 1 wd (`qc-sources` port: 6 wd for the whole package, this is a subset) | pinned previous tag |

## 2. External dependencies

| dependency | needed by | owner | committed date | status as given by the owner |
|---|---|---|---|---|
| F-CM1 gateway pool state (k8s batch profile) | L2.c | sentropic | `unknown` | **amend**: shared batch profile; cluster-mesh 0.27.0 / llm-mesh 0.33.0 / llm-gateway 0.23.0 (proposed allocations). Blockers: ADR-0035, queue slot, F-CM3, qualified shared pool/vault, Codex/Claude terms; Cloud Code `unknown`. Lease deadline semantics amended (the account lease has no expiry field today) |
| F-CM2 budget admission + shared 429 cooldown | L2.c | sentropic | `unknown` | **amend**: reuse the existing llm-gateway admission and cooldown, with a cluster-mesh compose profile on top (answer to (d)); GW 0.23.0 / CM 0.27.0 / LM 0.33.0. Blockers: ADR/queue, enforceable lane identity, caps and periods, qualified shared state, typed refusals |
| F-CM3 workload identity per lane SA | L2.c | sentropic | `unknown` | **amend**: verified SA binding, CM 0.27.0. Blockers: ADR/queue, identity core A2/A4 authority, Kubernetes issuer, SA-choice control (L2.v), revocation |
| F-CM4 usage-receipt ledger | before L8 (P2) | sentropic | `unknown` | **accept**: complete the existing ledger; GW 0.24.0 / CM 0.28.0. Blockers: ADR/queue, F-CM2/F-CM3, correlation schema, authorized export, geo/radar reconciliation |
| F-CM5 MCP supervision over s3-dag | before L8 (P2) | **geo** (amended) | `unknown` | **amend**: geo-owned adapter in s3-dag 0.2.0, cluster-mesh 0.27.0 MCP surface reused → lot L7.m. Blockers: F-CM3 read authority, isolated reads, city freshness, immo-mcp receiving |
| F-CM6 provenance attestation (P3) | not required | geo (s3-dag 0.3.0) + sentropic | `unknown` | **amend**: domain attestation in s3-dag 0.3.0, CM 0.29.0 only if key binding is needed. Not in this plan |
| F-CM7 durable messaging (P3) | not required | sentropic | none | **refuse** the general broker; CAS polling of `latest.json` stays (the accepted fallback) |
| F-CM8 cross-server discovery (P3) | not required | sentropic | `unknown` | **amend**: explicit, revocable enrolment, CM 0.29.0 (provisional); only if a second cluster joins |

Sentropic source: `assessment.md` (Astra, read-only, sha256
`70876567889abf4f96b41966e2f08396b6ac52bd2048807cc54ebcd72926c757`), today in sentropic's local `.tmp/geo-fcm/`,
to be committed by sentropic (Track). **No F-CM preprod date is committed**: every ID stays `unknown` until
ADR-0035 is ratified and the work gets a slot. The sentropic queue ahead of it is: identity A2/A4 (anchor
≈ 2026-11-04) → remote control RC2+ → memory 3×3 co-brainstorm → federation r6 → daily cyber → PG18 (anchor
≈ 2026-11-09). No geo slot is reserved ahead of that queue.
| F-EN1 incremental extraction + coverage registry | L4.g | gr-conductor (engram) | `unknown` | accepted (amended), target 0.24.0; blocked by P1 spec review round 3 |
| F-EN2 profile bundle + digest + compatibility | L1.p | gr-conductor | `unknown` | accepted (amended), 0.24.0; same blocker |
| F-EN3 headless bounded batch with receipts | L4.g | gr-conductor | `unknown` | accepted, 0.24.0; same blocker |
| F-EN4 citation-preserving merge | L1.r, L4.g | gr-conductor | `unknown` | accepted (amended, opt-in), 0.24.0; same blocker |
| F-EN5..F-EN9 (verify, prompt rendering, closed partition, typed geo links, profile validation) | L4.g (F-EN5, see R6), L8 | gr-conductor | `unknown` | accepted in principle, 0.25.x `proposed`; spec starts after the P1 lots |
| `geo` namespace quota figure (and node count, CPU reserved by requests) | G1, L3.b | k8s | `unknown` | asked 2026-10-31, no answer yet |
| VAP-canary Deny | G1 | k8s (infra) + owner go | `unknown` | not in the repo (runbook) |
| s3-dag canary, 4 proofs + 3 refusals | G2 | geo | L0 plan: G2 at T0 + 14 wd | executor and entrypoints exist; **no proof run yet** |
| Owner Q1 (seats), Cloud Code question, Q2 sample, Loi 25 role decision | L2.c, L4.r, L7 | owner | `unknown` | Q1 relayed yes for Codex + Claude Code subject to terms; Cloud Code `unknown` |

Engram constraint (gr-conductor, corrected 2026-10-31): engram is free to release; only radar's classification
pilot keeps its own pin on 0.21.2, and radar is decoupling that pin so that L1.r can adopt 0.24.0.

## 3. Critical path and calendar

**Critical path (geo view):**
T0 ratification → L0.a → L0.b (+ L0.b' VAP, k8s) → G1 → L0.c → G2 → L3.b → L3.r → L4.g → L4.r (+ L4.c radar) →
G3 → L5 (3 × 7 cal d) → G4 → L6 (3 × (1 wd + 7 cal d)) → W28 (28 cal d) → G6 → L8.

L1 and L2 run **beside** L3 and do not drive the path **if** F-EN2/F-EN4 (0.24.0) and F-CM1..F-CM3 are usable
by the end of L3.r. Each is `unknown` today, so **the real critical path is set by the later of those external
dates and the end of L3.r**. Until their owners give dates, the calendar below is an **earliest-start lower bound,
not a commitment**.

**Dating rule (structural).** Sentropic commits F-CM dates only **after** ratification and slotting, and Engram
only after its P1 spec review. A fully dated plan therefore cannot exist **before** T0. What can be secured
before T0 is the part that depends on no external owner: **L0 and L3 (no LLM, no F-CM, no Engram)**, about
14 + 14 wd on the geo side. Options for the owner (not decided here):
- **A.** Ratify ADR-0035 whole; external owners date their lots within an agreed delay after T0; add a go/no-go
  **G2b "dated plan"** before L4.g starts, where the owner sees every committed date and can stop.
- **B.** Ratify ADR-0035 for L0–L3 only (no LLM path); ratify L4+ later, once F-CM and F-EN dates are committed.
- **C.** Wait for dated commitments before any ratification: sentropic says this cannot happen, so the plan stays
  undated.

Totals:
- geo, all lots (including those beside the path or inside W28): build **38 wd** + explicit buffers **25 wd**
  (L2.v and L7.m added after the sentropic assessment);
- radar (its own estimates): **7 agent-days** (7.5 with the L8 option) + buffer **1.5 agent-days**, plus the 7-day
  baseline clock and a 7-day L7 shadow. No radar lot lands on the critical path: L0.r runs beside L0, L1.r beside
  L3, L4.c and the L5/L6 radar work beside L4.g, L7 inside W28, and L8 radar beside L8 geo;
- owner gates: **10 wd** (G1, G2, G3, G4, G6) + **3 wd** of prod cohort approvals;
- fixed windows: **70 cal d** (3 × 7 + 3 × 7 + 28), plus the L3 run.

**Earliest-start calendar**, output of `node scripts/adr-0035-calendar.mjs 2026-11-16` (working days, Quebec
holidays; radar agent-days rounded up). It assumes **T0 = 2026-11-16** (hypothesis: ratification after the
review with the Product Owner) and that every external dependency is ready when needed. Rows tagged `[radar]` or
`[geo]` run beside the critical path; untagged rows are the critical path.

| step | content | duration | start | end |
|---|---|---|---|---|
| L0.a | Hygiene PR | 2 wd | 2026-11-16 | 2026-11-17 |
| L0.r1 | [radar] Token instrumentation (0.5 agent-day) | 1 wd | 2026-11-16 | 2026-11-16 |
| L0.r2 | [radar] Release + prod promotion (hypothesis) | 2 wd | 2026-11-17 | 2026-11-18 |
| L0.b | Canary build (remaining pieces) | 5 wd | 2026-11-18 | 2026-11-24 |
| L0.r3 | [radar] Baseline measurement window | 7 cal d | 2026-11-19 | 2026-11-25 |
| G1 | Owner go: VAP + apply + run | 2 wd | 2026-11-25 | 2026-11-26 |
| L0.c | Canary run, 4 proofs + 3 refusals, report | 3 wd | 2026-11-27 | 2026-12-01 |
| G2 | Owner go: canary ratification | 2 wd | 2026-12-02 | 2026-12-03 |
| L1.r | [radar] Engram 0.24.0 bump + profile folder + digest CI, then F-EN4 adoption (0.5 + 0.5 + 0.5 buffer) | 2 wd | 2026-12-04 | 2026-12-07 |
| L1.g | [geo] Pin shared profile (git sha + digest, CI check) | 2 wd | 2026-12-04 | 2026-12-07 |
| L3.b | Extend chain to 528 cities + bounded-memory collection | 8 wd | 2026-12-04 | 2026-12-15 |
| L2.g | [geo] Lane SA + token exchange, flag | 3 wd | 2026-12-08 | 2026-12-10 |
| L2.v | [geo] Job-creator SA boundary (VAP), negative test (1 + 1) | 2 wd | 2026-12-11 | 2026-12-14 |
| L3.r | Shadow: 3 consecutive geo cycles | 3 cal d | 2026-12-16 | 2026-12-18 |
| L3.p | Parity analysis + re-run margin | 3 wd | 2026-12-21 | 2026-12-23 |
| L4.c | [radar] radar-pv-consume: contract client, mapping, dry-run report (2 + 1 buffer) | 3 wd | 2026-12-24 | 2026-12-29 |
| L4.g | extract/verify/reconcile/signals/contract build | 14 wd | 2026-12-24 | 2027-01-14 |
| L5/6.r | [radar] Allowlist + refresh skip, prod overlay, rollback runbook (1) | 1 wd | 2026-12-30 | 2026-12-30 |
| L4.r | Shadow on Q2 sample + v101b + radar dry-run | 5 wd | 2027-01-15 | 2027-01-21 |
| G3 | Owner go: L4 parity accepted | 2 wd | 2027-01-22 | 2027-01-25 |
| L5.1 | Preprod cohort 1 window | 7 cal d | 2027-01-26 | 2027-02-01 |
| L5.2 | Preprod cohort 2 window | 7 cal d | 2027-02-02 | 2027-02-08 |
| L5.3 | Preprod cohort 3 window | 7 cal d | 2027-02-09 | 2027-02-15 |
| G4 | Owner go: prod | 2 wd | 2027-02-16 | 2027-02-17 |
| L6.1a | Prod cohort 1 approval (geo-prod) | 1 wd | 2027-02-18 | 2027-02-18 |
| L6.1 | Prod cohort 1 window | 7 cal d | 2027-02-19 | 2027-02-25 |
| L6.2a | Prod cohort 2 approval (geo-prod) | 1 wd | 2027-02-26 | 2027-02-26 |
| L6.2 | Prod cohort 2 window | 7 cal d | 2027-02-27 | 2027-03-05 |
| L6.3a | Prod cohort 3 approval (geo-prod) | 1 wd | 2027-03-08 | 2027-03-08 |
| L6.3 | Prod cohort 3 window | 7 cal d | 2027-03-09 | 2027-03-15 |
| L7.g | [geo] join + contract geo_resolutions source (3 + 2 buffer) | 5 wd | 2027-03-16 | 2027-03-22 |
| L7.r | [radar] geo_resolutions writer + shadow diff (1) | 1 wd | 2027-03-16 | 2027-03-16 |
| W28 | 28-day window before L8 (L7 runs inside) | 28 cal d | 2027-03-16 | 2027-04-12 |
| L7.s | [radar] Shadow period (radar proposal) | 7 cal d | 2027-03-17 | 2027-03-23 |
| L7.m | [geo] F-CM5 geo MCP provider in s3-dag 0.2.0, city freshness (3 + 2 buffer) | 5 wd | 2027-03-23 | 2027-03-30 |
| L7.o | [radar] Switch off run-geo-mapper and populate-geo resolve (0.5) | 1 wd | 2027-03-24 | 2027-03-24 |
| G6 | Owner go: L8 | 2 wd | 2027-04-13 | 2027-04-14 |
| L8.r | [radar] Retire refresh-pv, watchdog, keyring PVC, PV use of RECUEIL (1 + 0.5 option) | 2 wd | 2027-04-15 | 2027-04-16 |
| L8.g | [geo] PV adapters into qc-sources | 3 wd | 2027-04-15 | 2027-04-19 |

Lower bound for the end of L8, radar and geo together: **2027-04-19**. Radar's estimates do not move it: every
radar lot fits beside a geo step. Each working day of slip on a critical-path step moves every later date by one
working day. Rerun the script with a new T0 or new durations; never edit the table by hand.

## 4. Radar windows that constrain the plan

- **Classification pilot**: radar's pilot keeps its own Engram pin on 0.21.2 until it ends. Radar is decoupling
  that pin, so L1.r is no longer gated by the pilot (gr-conductor and radar, 2026-10-31). Pilot end date:
  `unknown` (pass 1 in progress; radar gives it). Radar's caution: the pilot fills its deps volume with `npm ci`
  on the repo lock, so L1.r on radar main must either follow the pilot's L2 or freeze that volume.
- **Refresh-pv baseline, 7 days, in L0 (L0.r)**: tokens are recorded nowhere today, so 0.5 agent-day of
  instrumentation and a prod release come first, then the 7-day clock. It must end before L4.r, because the Q2
  budget is 2× that measured baseline. Earliest: 2026-11-19 → 2026-11-25, well before L4.r (2027-01-15). It is
  valid only if the prod CronJob actually runs all 7 days (live state `unverified`). The 2× cap is a cost cap:
  seat-based usage needs a token-to-CAD rule, to set with the owner's Q2 answer.
- Radar refresh slots (05:17, 11:17, 17:17, 23:17 UTC) and geo backup window (03:13–06:30 UTC): geo runs and
  cohort widenings avoid them.

## 5. Risks that stretch the timeline

| # | risk | effect | mitigation |
|---|---|---|---|
| R1 | **2-open-PR limit** (geo `CLAUDE.md`, CI guard). Today #427 and #363 are open: **no new geo PR can open before one closes** | serialises L0.a, L0.b, L1.g, L2.g, L3.b | merge #427 at ratification; owner decides on #363 (ADR-0032, `proposed` since 2026-09-06), which ADR-0035 item 5 may supersede |
| R2 | F-CM1..F-CM3 dates later than the end of L3.r. **Likely**: sentropic gives no date before ratification and slotting, and five programmes are queued ahead (identity A2/A4, RC2+, memory 3×3, federation r6, daily cyber) | L4 waits; the path moves by the gap | dates asked (sentropic answered: `unknown` until slotting); L3 has no LLM, so it moves forward meanwhile; L4.g can build against F-CM interfaces with a stub, but L4.r cannot run before F-CM is usable; owner options A/B in section 3 |
| R15 | Lane identity bypass: a Job creator can pick another lane's service account and escape its budget cap | F-CM2/F-CM3 acceptance fails | lot L2.v (VAP or namespace isolation), negative test before L2.c is accepted |
| R3 | Engram 0.24.0 later than the end of L3.r | same as R2 | same; F-EN P1 spec review is the first unblocking event |
| R4 | `geo` quota or node capacity insufficient (single node measured ~95 % CPU reserved on 2026-09-28) | G1 and L3.b blocked, or L3 cycles too slow | quota figure asked now; L3 concurrency starts at 4 capture Jobs (hypothesis) and grows only when measured |
| R5 | A canary proof fails at G2 | Argo fallback, this plan reopens | no-go point G2; the fallback is documented in ADR-0035 item 2 |
| R6 | Removal-only verification: F-EN5 is P2 (0.25.x), but L4 parity needs a `verify` node | L4.g blocked or waits for 0.25.x | decide at L4 entry: wait for F-EN5, or ask engram to move F-EN5 into the P1 train |
| R7 | One geo L3 cycle longer than 1 day (`unknown` today) | L3.r longer | measure the first cycle and recompute the calendar |
| R8 | Year-end period (L4.g spans 2026-12-24 → 2027-01-14) | lower availability for reviews and owner gates | the buffers stay explicit; G3 is not scheduled before 2027-01-22 |
| R9 | L3 or L4 parity not reached (robots, IP blocks, signal drift) | re-run and analysis | 2 wd re-run margin in L3.p and L4.r; cities below threshold are listed, not hidden |
| R11 | Interim radar profile digest differs from the later F-EN2 digest | one extra digest bump, reviewed by both conductors | planned in L1.p; the bump is a reviewed change, not a surprise |
| R12 | Signal derivation is split today between the LLM extraction and radar's deterministic enrichment (`etape`, `instrument`), which radar keeps for facets and vivier | contract fields `etape`/`etape_date` could be derived twice, or differently | decide at L4 entry who derives `etape` (geo in the contract, or radar's enrichment only); the L4 golden test targets the live path either way |
| R13 | `event_id` → `::` mapping misses existing radar nodes | duplicated or orphaned signals and facets | radar's L4 dry-run: 0 orphan facet, 0 canonical node lost, before G3 |
| R14 | Contract zone/lot ids not resolvable to radar canonical ids (`unverified`) | L7 coverage drops | checked in the L7 shadow before both radar writers go off |
| R10 | Owner gates taking longer than the 2 wd allowed | each gate moves the path | gates are listed by name; the owner can batch G1/G2 if wanted |

## 6. Go / no-go points where the owner can stop

| point | when (earliest, T0 = 2026-11-16) | stop means |
|---|---|---|
| T0 | ratification of ADR-0035 | nothing starts; radar unchanged |
| G1 | 2026-11-25 | canary not run; radar unchanged |
| G2 | 2026-12-02 | canary not ratified → Argo fallback or stop; radar unchanged |
| G2b (options A/B, section 3) | when F-CM and F-EN dates are committed, before L4.g | stop before any LLM-path work; L3 shadow can keep running or stop |
| G3 | 2027-01-22 | stop after shadow; radar unchanged, geo shadow DAGs stopped |
| G4 | 2027-02-16 | stay in preprod; radar keeps prod |
| each L6 cohort approval | 2027-02-18, 02-26, 03-08 | stop widening; cohorts already moved can roll back per city |
| G6 | 2027-04-13 | radar refresh stays deployed and suspended; it can be re-armed |

Radar keeps running on its own path until G6. Every step before L8 can be reverted.
