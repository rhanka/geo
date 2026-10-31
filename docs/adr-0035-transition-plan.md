# ADR-0035 — transition plan (geo side)

Status: **draft for the owner decision dossier**, 2026-10-31. Companion of ADR-0035 (`docs/decisions.md`, PR #427,
`proposed`). It changes no code and starts no lot: nothing begins before the owner ratifies ADR-0035 with an
owner-direct record.

Author: geo-cond. Radar-side lots carry radar's own estimates, sent separately by the immo conductor; this file
does not estimate them (marked `pending radar estimate`). External dates are those given by their owner; a
missing date is `unknown` or `pending`, with the name of whoever has to give it.

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
| **L0.r** | Refresh-pv LLM baseline over 7 days (tokens and receipts per run) | radar | ADR-0035 ratified | baseline report | `pending radar estimate` (fixed 7 cal d inside) | n/a |
| **L1.r** | Radar to Engram 0.24.0 (F-EN4; see section 2) | radar | F-EN1..F-EN4 published in 0.24.0 | radar CI green on 0.24.0 | `pending radar estimate` | repin 0.21.2 |
| **L1.p** | Shared profile v2.2 published with digest (radar folder `radar/ontology/pv-signals/`); profile versioning rule (OQ-12) settled | radar + geo | F-EN2 in 0.24.0; OQ-12 agreed by both conductors | digest published; OQ-12 recorded in ADR-0035 | `pending radar estimate` for publication; OQ-12: 1 wd geo | previous digest |
| **L1.g** | Geo consumes the profile read-only by `git sha + digest`, CI digest check; graphify 0.17.1 PV profile aligned | geo | G2; L1.p | CI fails on a digest mismatch (negative test) | 1 + 1 wd (capture proof index #165–#170: 1 wd) | pin previous digest |
| **L2.c** | F-CM1, F-CM2, F-CM3 usable in preprod | sentropic | owner Q1 answer (seats) + terms-of-use check; Cloud Code question answered | F-CM acceptance tests from `requests-cluster-mesh.md` pass in preprod | `pending sentropic assessment` | n/a |
| **L2.g** | Geo extract node: lane service account, token exchange (F-CM3), flag `REFRESH_LLM_TRANSPORT=gateway` | geo | G2; L2.c | one Job calls the gateway in preprod, no credential in the pod spec | 2 + 1 wd (s3-dag identity PRs, same burst) | flag back to `keyring` |
| **L3.b** | Extend `pv-capture-backlog` to radar's 528 cities, one DAG per city, `concurrencyKey = source host`; bounded-memory streaming collection (Track `01M41PRZG9JB8CTE805D23TAE1`, canary: 172 MB vsad.ca PDF under 768 Mi) | geo | G2; `geo` quota figure (k8s); L3 thresholds confirmed by both conductors in the L3 PR | PR merged; memory canary passes | 5 + 3 wd (PV chain: 2 wd; +3 wd for streaming and refreshing the June radar adapter copy, an explicit hypothesis) | stop the DAG |
| **L3.r** | Shadow `detect → capture → text`, 3 consecutive geo cycles; parity on sha sets (ADR-0035 gate values) | geo | L3.b | L3 parity thresholds met | 3 cal d run (hypothesis: one cycle ≤ 1 day, **`unknown` until the first cycle is measured**) + 1 + 2 wd analysis and re-run | stop the DAG |
| **L4.g** | Nodes `extract → verify → reconcile → signals → promote`; radar `signals.ts` rules ported unchanged with a golden test; contract writer `exports/immo/pv-signals/v1/` with its size budget | geo | L1.g, L2.g, L3.r done; F-EN1, F-EN3, F-EN4 in 0.24.0; verify path decided (R6); L4 thresholds confirmed | PR merged; golden test 100 % identical signals | 9 + 5 wd (zoning events v2: 9 wd; served contract: 1–2 wd; s3-dag nodes: one burst) | revert PR; contract prefix unpublished |
| **L4.r** | Shadow on the Q2 sample (budget ≤ 2× the L0.r baseline, kill-switch above it) + v101b benchmark | geo | L4.g; L0.r baseline; owner Q2 sample | L4 parity thresholds met (ADR-0035) | 3 + 2 wd (hypothesis; run length depends on the sample size, `unknown`) | stop |
| **L4.c** | `radar-pv-consume` dry-run: canonical and signal diff per city and kind, facets before = after | radar | L4.r output | radar's L4 criteria | `pending radar estimate` | stop |
| **G3** | Owner go: L4 parity accepted, start L5 | owner | L4.r + L4.c | recorded go | gate, 2 wd allowed (hypothesis) | stop at L4 |
| **L5** | Preprod cohorts by allowlist, radar refresh skips them; rollback rehearsed once inside the windows | geo + radar | G3 | each cohort: 0 incomplete snapshot read as complete, `latest.json` age ≤ 6 h p95, 0 dropped signal; rehearsal done | **N × 7 cal d**, N `unknown`; plan uses **N = 3** (hypothesis); geo allowlist mechanics 1 + 1 wd, done during L4 | remove the city from the allowlist + canonical pre-image |
| **G4** | Owner go: prod | owner | L5 exit | recorded go | gate, 2 wd allowed (hypothesis) | stay in preprod |
| **L6** | Prod cohorts; each widening is a geo-prod Environment approval | geo + radar | G4 | same criteria as L5, in prod | N × (1 wd approval + 7 cal d), N = 3 (hypothesis) | same as L5 |
| **L7** | `join` (lot, zone; role only after the Loi 25 decision); `geo_resolutions` from the contract; `run-geo-mapper` shadow then off (radar) | geo + radar | L6 started; Loi 25 owner decision for role (else role excluded) | resolution rate reported; radar's mapper off | geo 3 + 2 wd, **inside the 28-day window**, not on the critical path; radar part `pending radar estimate` | re-enable the Job |
| **W28** | 28 cal d after the last cohort, radar CronJob deployed and suspended | — | L6 last cohort | ADR-0035 exit criteria held for 28 d | 28 cal d (fixed) | radar re-arms its CronJob |
| **G6** | Owner go: L8 | owner | W28 | recorded go | gate, 2 wd allowed (hypothesis) | — |
| **L8** | Retire `radar-refresh-pv`, watchdog, keyring PVC, RECUEIL, radar signal derivation (radar); PV adapters into geo `qc-sources` (geo) | radar + geo | G6; every city in the allowlist; F-EN5..F-EN9 needed by radar (P2) | radar objects removed; geo adapters merged | radar `pending radar estimate`; geo 2 + 1 wd (`qc-sources` port: 6 wd for the whole package, this is a subset) | pinned previous tag |

## 2. External dependencies

| dependency | needed by | owner | committed date | status as given by the owner |
|---|---|---|---|---|
| F-CM1 gateway pool state (k8s batch profile) | L2.c | sentropic | **pending sentropic assessment** | assessment running (Astra, read-only), answer to come with a hash; blocked by owner Q1 on pooled seats |
| F-CM2 budget admission + shared 429 cooldown | L2.c | sentropic | **pending sentropic assessment** | same |
| F-CM3 workload identity per lane SA | L2.c | sentropic | **pending sentropic assessment** | same |
| F-CM4 usage-receipt ledger | before L8 (P2) | sentropic | **pending sentropic assessment** | same |
| F-CM5 MCP supervision over s3-dag | before L8 (P2) | sentropic | **pending sentropic assessment** | same |
| F-CM6, F-CM7, F-CM8 | not required (P3) | sentropic | **pending sentropic assessment** | same |
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
by the end of L3.r. Each is `unknown` or `pending` today, so **the real critical path is set by the later of those
external dates and the end of L3.r**. Until their owners give dates, the calendar below is an **earliest-start
lower bound, not a commitment**.

Totals, all geo lots (including those beside the path or inside W28): build **34 wd** + explicit buffers **22 wd**.
Owner gates: **10 wd** (G1, G2, G3, G4, G6) + **3 wd** of prod cohort approvals. Fixed windows: **70 cal d**
(3 × 7 + 3 × 7 + 28), plus the L3 run.

**Earliest-start calendar**, computed by `node scripts/adr-0035-calendar.mjs 2026-11-16` (working days, Quebec
holidays). It
assumes **T0 = 2026-11-16** (hypothesis: ratification after the review with the Product Owner) and that every
external dependency is ready when needed:

| step | content | duration | start | end |
|---|---|---|---|---|
| L0.a | Hygiene PR | 2 wd | 2026-11-16 | 2026-11-17 |
| L0.b | Canary build (remaining pieces) | 5 wd | 2026-11-18 | 2026-11-24 |
| G1 | Owner go: VAP + apply + run | 2 wd | 2026-11-25 | 2026-11-26 |
| L0.c | Canary run, 4 proofs + 3 refusals, report | 3 wd | 2026-11-27 | 2026-12-01 |
| G2 | Owner go: canary ratification | 2 wd | 2026-12-02 | 2026-12-03 |
| L1.g / L2.g | beside L3 (needs F-EN2 and F-CM1..3) | 2 + 3 wd | 2026-12-04 | 2026-12-10 |
| L3.b | Extend chain to 528 cities + bounded-memory collection | 8 wd | 2026-12-04 | 2026-12-15 |
| L3.r | Shadow: 3 consecutive geo cycles | 3 cal d | 2026-12-16 | 2026-12-18 |
| L3.p | Parity analysis + re-run margin | 3 wd | 2026-12-21 | 2026-12-23 |
| L4.g | extract/verify/reconcile/signals/contract build | 14 wd | 2026-12-24 | 2027-01-14 |
| L4.r | Shadow on Q2 sample + v101b + radar dry-run | 5 wd | 2027-01-15 | 2027-01-21 |
| G3 | Owner go: L4 parity accepted | 2 wd | 2027-01-22 | 2027-01-25 |
| L5.1–L5.3 | Preprod cohort windows | 3 × 7 cal d | 2027-01-26 | 2027-02-15 |
| G4 | Owner go: prod | 2 wd | 2027-02-16 | 2027-02-17 |
| L6.1–L6.3 | Prod cohorts (1 wd approval + 7 cal d each) | 3 × 8 | 2027-02-18 | 2027-03-15 |
| W28 | 28-day window before L8 (L7 inside) | 28 cal d | 2027-03-16 | 2027-04-12 |
| G6 | Owner go: L8 | 2 wd | 2027-04-13 | 2027-04-14 |
| L8 (geo) | PV adapters into qc-sources | 3 wd | 2027-04-15 | 2027-04-19 |

Lower bound for the end of L8 (geo side): **2027-04-19**, before radar's L8 estimate. Each working day of
slip on a critical-path step moves every later date by one working day. Rerun the script with a new T0 or new
durations; never edit the table by hand.

## 4. Radar windows that constrain the plan

- **Classification pilot**: radar's pilot keeps its own Engram pin on 0.21.2 until it ends. Radar is decoupling
  that pin, so L1.r is no longer gated by the pilot (gr-conductor, 2026-10-31). Pilot end date: `pending radar
  estimate`.
- **Refresh-pv baseline, 7 days, in L0 (L0.r)**: it can start at T0 in parallel with the geo canary. It must end
  before L4.r, because the Q2 budget is 2× that measured baseline. With T0 = 2026-11-16 it fits easily before
  2027-01-15. Radar gives the exact window.
- Radar refresh slots (05:17, 11:17, 17:17, 23:17 UTC) and geo backup window (03:13–06:30 UTC): geo runs and
  cohort widenings avoid them.

## 5. Risks that stretch the timeline

| # | risk | effect | mitigation |
|---|---|---|---|
| R1 | **2-open-PR limit** (geo `CLAUDE.md`, CI guard). Today #427 and #363 are open: **no new geo PR can open before one closes** | serialises L0.a, L0.b, L1.g, L2.g, L3.b | merge #427 at ratification; owner decides on #363 (ADR-0032, `proposed` since 2026-09-06), which ADR-0035 item 5 may supersede |
| R2 | F-CM1..F-CM3 dates later than the end of L3.r | L4 waits; the path moves by the gap | ask for dates now (done); L3 has no LLM, so it moves forward meanwhile; L4.g can build against F-CM interfaces with a stub, but L4.r cannot run before F-CM is usable |
| R3 | Engram 0.24.0 later than the end of L3.r | same as R2 | same; F-EN P1 spec review is the first unblocking event |
| R4 | `geo` quota or node capacity insufficient (single node measured ~95 % CPU reserved on 2026-09-28) | G1 and L3.b blocked, or L3 cycles too slow | quota figure asked now; L3 concurrency starts at 4 capture Jobs (hypothesis) and grows only when measured |
| R5 | A canary proof fails at G2 | Argo fallback, this plan reopens | no-go point G2; the fallback is documented in ADR-0035 item 2 |
| R6 | Removal-only verification: F-EN5 is P2 (0.25.x), but L4 parity needs a `verify` node | L4.g blocked or waits for 0.25.x | decide at L4 entry: wait for F-EN5, or ask engram to move F-EN5 into the P1 train |
| R7 | One geo L3 cycle longer than 1 day (`unknown` today) | L3.r longer | measure the first cycle and recompute the calendar |
| R8 | Year-end period (L4.g spans 2026-12-24 → 2027-01-14) | lower availability for reviews and owner gates | the buffers stay explicit; G3 is not scheduled before 2027-01-22 |
| R9 | L3 or L4 parity not reached (robots, IP blocks, signal drift) | re-run and analysis | 2 wd re-run margin in L3.p and L4.r; cities below threshold are listed, not hidden |
| R10 | Owner gates taking longer than the 2 wd allowed | each gate moves the path | gates are listed by name; the owner can batch G1/G2 if wanted |

## 6. Go / no-go points where the owner can stop

| point | when (earliest, T0 = 2026-11-16) | stop means |
|---|---|---|
| T0 | ratification of ADR-0035 | nothing starts; radar unchanged |
| G1 | 2026-11-25 | canary not run; radar unchanged |
| G2 | 2026-12-02 | canary not ratified → Argo fallback or stop; radar unchanged |
| G3 | 2027-01-22 | stop after shadow; radar unchanged, geo shadow DAGs stopped |
| G4 | 2027-02-16 | stay in preprod; radar keeps prod |
| each L6 cohort approval | 2027-02-18, 02-26, 03-08 | stop widening; cohorts already moved can roll back per city |
| G6 | 2027-04-13 | radar refresh stays deployed and suspended; it can be re-armed |

Radar keeps running on its own path until G6. Every step before L8 can be reverted.
