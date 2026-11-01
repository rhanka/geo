# ADR-0035 — short plan (geo side)

Status: **draft for the owner decision dossier**, 2026-10-31 (Montréal time). It replaces the 9-lot calendar of
`docs/adr-0035-transition-plan.md` as the **proposed execution path**; the 9-lot file stays as the reference for
the deferred improvements. Owner verdict on the 9-lot plan: « plan en 6 mois ? No go, for sure overkill ». Nothing
starts before the owner ratifies ADR-0035 with an owner-direct record.

Units: **wd** = working day (Mon–Fri, Quebec holidays removed); **cal d** = calendar day. Every duration =
build + explicit buffer. Calendar computed by `node scripts/adr-0035-calendar.mjs <T0> short`. Radar estimates:
`rhanka/radar-immobilier` main `docs/spec/reports/etude-geo-dag/radar-lots-estimates.md` (7 agent-days).

## 0. Principle of the short path

Move the **existing** chains, **as they are**, then improve them later. Geo already captures PV on the cluster
(`pv-capture-backlog`, 5 492 PV indexed); radar already extracts and detects signals with Engram and its model
policy. The short path puts radar's extraction next to geo's capture, **with the same code, the same Engram
version, the same model policy and the same seat transport**. Parity is then expected by construction and is
measured once, in one shadow window. Every new function (F-CM, F-EN), the s3-dag engine and the join move to
**after** the transfer, as improvements.

## 1. What is cut or deferred, and why it is acceptable

| # | cut or deferral | why acceptable | what replaces it |
|---|---|---|---|
| C1 | **No new F-CM function on the path** (gateway pool, budget, workload identity, ledger, MCP) | ADR-0034 (accepted) already lets geo use **radar's current in-pod seat transport**; sentropic gives no F-CM date before ratification and slotting | one extraction pod with the seat keyring, exactly as radar runs today (singleton, `flock`, pending watchdog ported) |
| C2 | **No new F-EN function on the path**; Engram stays on the version radar runs | radar's 19 Engram symbols are identical in 0.21.2 and 0.23.x; same version = same extractions = parity by construction | radar's own merge, verification and profile code, ported unchanged |
| C3 | **s3-dag canary dropped as a prerequisite**; the engine change is deferred | geo's existing PV chain already carries an immutable manifest, CAS state and phases, writes capture to S3 (SPEC_CAPTURE_ON_CLUSTER), and ran a measured campaign (105 attempts, 81.4 % confirmed, 2026-07-30) | CronJobs, as today; s3-dag becomes a later engine swap behind the same contract |
| C4 | **One shadow window of 7 cal d** instead of separate L3 and L4 shadows and 3 preprod cohorts | capture and extraction are compared together on all 528 cities in one window; the **gate values of ADR-0035 are kept unchanged** | single parity report (sha sets + signals) before any cut-over |
| C5 | **2 prod cohorts** (~50 cities for 3 cal d, then all) instead of 3 preprod + 3 prod cohorts of 7 cal d | the shadow already ran on all cities; the first small cohort checks the real switch; per-city rollback stays | allowlist ConfigMap read by both sides |
| C6 | **7 cal d observation with radar suspended** instead of 28 cal d before retirement | the radar CronJob stays deployed and suspended: rollback = unsuspend, effective at the next 6-hour slot | retirement only after the 7 days and an owner go |
| C7 | **Join / `geo_resolutions` (L7) out of the transfer** | radar's `run-geo-mapper` and `populate-geo` keep running unchanged; the join is not needed to move scraping and signals | later lot, unchanged content |
| C8 | **Large PDFs**: a size guard (Content-Length + byte count, durable `too-large` status) instead of full streaming collection | radar already defers oversize documents (radar #806), so parity is not affected; the status is visible, never silent | streaming collection (Track `01M41PRZG9JB8CTE805D23TAE1`) as a later improvement |
| C9 | **Shared profile**: geo pins radar's profile file by `git sha` + interim digest, no Engram bundle | one profile, no fork; F-EN2 bundle later | CI check that fails on digest drift |
| C10 | **Preprod cohorts dropped**; the rollback is rehearsed once in preprod during the shadow | the radar consumer runs a **dry-run on prod data** (`upsertGraphAtomic(..., { preview: true })`, rolled back) during the shadow | rehearsal record before the owner go |

## 2. Minimal plan, lot by lot

| lot | content | owner | duration (build + buffer) and basis | rollback |
|---|---|---|---|---|
| **S1** | Capture: extend the existing geo PV chain to radar's 528 cities (radar's city and source list read once); size guard (C8); CronJob dedup and digest pins (old L0 hygiene, same PR) | geo | 3 + 2 wd (geo PV chain built in 2 wd, 2026-07-26 → 07-29) | stop the CronJob |
| **S2** | Extraction: port radar's refresh extraction (`refresh-profile`, `refresh-model-policy`, `refresh-verification`, merge in `refresh-run`, ~3 100 LOC + tests) **unchanged** into a geo job, same Engram version and model policy (ADR-0034); contract writer `exports/immo/pv-signals/v1/` (snapshot then CAS, size budget of ADR-0035) | geo | 6 + 3 wd (radar `@radar/sources` → `qc-sources` port, 241 files, 6 wd; served contract 1–2 wd) | stop the job; contract prefix unpublished |
| **S2.k** | Seat keyring for the geo extraction pod: credentials minted for the geo namespace, rotation cycle written in `.env` + docs (k8s ↔ tenant rule), terms of use checked (owner Q1) | k8s + radar | 2 wd, **hypothesis** (no comparable measured; date to give by k8s) | revoke the geo copy |
| **R0** | Radar: token instrumentation, then 7-day baseline (needed for the 2× shadow cost cap) | radar | 0.5 agent-day + release (2 wd, hypothesis) + 7 cal d | n/a |
| **R1** | Radar: `radar-pv-consume` (contract client, `event_id` → `::` mapping, dry-run report), allowlist + refresh skip, rollback script | radar | 3 + 1 agent-days (radar estimates) | stop the consumer |
| **S3** | **Single shadow, 7 cal d**: geo capture + extraction on all 528 cities, 4 passes a day; radar unchanged and authoritative; radar dry-run on prod data each day; one preprod rollback rehearsal | geo + radar | 7 cal d, fixed | stop geo jobs |
| **S3.p** | Parity report against the **unchanged** ADR-0035 gate values (L3 sha sets, L4 signals, facets, `needs_review`) | geo + radar | 2 + 1 wd | — |
| **G1** | Owner go: cut-over (geo-prod Environment) | owner | 1 wd, hypothesis | stop here; radar unchanged |
| **S4** | Cohort 1: ~50 cities for 3 cal d (radar skips them); then cohort 2: all remaining cities, radar refresh **suspended, kept deployed** | geo + radar | 3 cal d + 1 wd | per city: remove from allowlist + canonical pre-image; all: unsuspend radar |
| **S5** | Observation, 7 cal d, radar suspended | geo + radar | 7 cal d, fixed | unsuspend radar |
| **G2** | Owner go: retire the radar chain | owner | 1 wd, hypothesis | keep radar suspended |
| **S6** | Radar retirement (refresh-pv, watchdog, keyring PVC moved to geo, PV use of RECUEIL) | radar | 1 (+0.5) agent-day (radar estimates) | pinned previous tag |

**Calendar** (`node scripts/adr-0035-calendar.mjs 2026-11-16 short`), T0 = **2026-11-16** = the day after a
ratification on 2026-11-15 (hypothesis; rerun with the real date). Assumes **2 free geo PR slots** at T0, so S1 and
S2 build in parallel:

| step | content | duration | start | end |
|---|---|---|---|---|
| S1 | [geo] Capture on the existing chain, size guard, CronJob dedup | 5 wd | 2026-11-16 | 2026-11-20 |
| S2 | [geo] Extraction port + contract writer | 9 wd | 2026-11-16 | 2026-11-26 |
| S2.k | [k8s+radar] Seat keyring for the geo pod (hypothesis) | 2 wd | 2026-11-16 | 2026-11-17 |
| R0 | [radar] Instrumentation + release, then baseline | 1 + 2 wd + 7 cal d | 2026-11-16 | 2026-11-25 |
| R1 | [radar] pv-consume + allowlist + rollback script | 3 + 1 wd | 2026-11-16 | 2026-11-19 |
| S3 | Single shadow window | 7 cal d | 2026-11-27 | 2026-12-03 |
| S3.p | Parity report | 3 wd | 2026-12-04 | 2026-12-08 |
| G1 | Owner go: cut-over | 1 wd | 2026-12-09 | 2026-12-09 |
| S4.1 | Prod cohort 1 (~50 cities) | 3 cal d | 2026-12-10 | 2026-12-12 |
| S4.2 | Prod cohort 2 (all), radar suspended | 1 wd | 2026-12-14 | 2026-12-14 |
| S5 | Observation, radar suspended | 7 cal d | 2026-12-15 | 2026-12-21 |
| G2 | Owner go: retire radar chain | 1 wd | 2026-12-22 | 2026-12-22 |
| S6 | Radar retirement | 2 wd | 2026-12-23 | 2026-12-24 |

Result: **cut-over complete on 2026-12-14 (4 weeks after T0)**, radar chain retired on **2026-12-24 (about 5.5
weeks)**. Critical path: S2 → S3 → S3.p → G1 → S4 → S5 → G2 → S6. If only **one** geo PR slot is free (today #427
and #363 are both open), S1 and S2 run one after the other: end on **2026-12-31** (`... short one-slot`).

## 3. Residual risks introduced by the cuts

| # | risk | from | mitigation |
|---|---|---|---|
| K1 | Extraction throughput no better than radar's (one pod, seat keyring singleton), and the 2026-10-09 Pending incident can recur | C1 | port the `flock` and the pending watchdog with the code; parallel extraction arrives with F-CM later |
| K2 | Seat credentials now live in a geo pod | C1, S2.k | minted for the geo namespace with a documented rotation cycle; radar's copy revoked at S6; terms of use checked before S3 (owner Q1) |
| K3 | No s3-dag crash-recovery proof | C3 | the existing chain is idempotent (immutable manifest, CAS state, report on every pass); a failed pass is re-run, never half-applied |
| K4 | One 7-day window may miss rare signal kinds | C4 | per-kind Jaccard thresholds kept; kinds with too few cases in the window are listed as `unverified`, not passed |
| K5 | Shorter observation (7 cal d instead of 28) | C6 | radar kept deployed and suspended: rollback = unsuspend; retirement needs an owner go |
| K6 | Doubled LLM cost during the shadow | C4 | capped at 2× the R0 baseline, with a kill-switch; 7 days only |
| K7 | Profile change by radar during the shadow breaks parity | C9 | digest pinned in geo CI; profile frozen from S3 to S5 |
| K8 | Very large PDFs not extracted | C8 | `too-large` status visible per document; same behaviour as radar today |
| K9 | Only one geo PR slot free | — | owner decides on #363 at T0, or the plan takes the one-slot calendar (+5 wd) |
| K10 | `geo` namespace quota for one more pod | S2 | quota figure asked from k8s (`unknown` today); the extraction pod replaces radar's, so the cluster total does not grow after S6 |

## 4. What stays strictly unchanged

- **No radar downtime**: radar stays authoritative until G1, and stays deployed and suspended until G2.
- **A rollback at every step**: stop geo jobs (S1–S3), allowlist + canonical pre-image per city (S4), unsuspend
  radar (S4–S5), pinned previous tag (S6).
- **Parity measured before cut-over**: S3.p against the ADR-0035 gate values, unchanged; no cut-over without G1.
- **Loi 25**: no owner fields in any geo output; capture, contract and storage stay in the OVH BHS bucket
  (Beauharnois, Québec) as today, and the jobs run on the same cluster as radar's (its region is not restated
  here: `unverified` in this file). The LLM calls carry the same public municipal PV text as radar's calls today, with the same
  providers; the transfer adds no new data flow.
- ADR-0024 (no Mistral vision), 0 Python, capture on the cluster only, at most 2 open geo PRs.

## 5. Deferred after the transfer (improvements, each its own decision)

s3-dag engine swap with its canary (old L0) · F-CM1..F-CM3 gateway pool, parallel extraction (old L2) ·
Engram 0.24.0 with F-EN1..F-EN4 and the profile bundle (old L1) · bounded-memory streaming collection · join and
`geo_resolutions` (old L7) · F-CM4 ledger, F-CM5 MCP supervision. The 9-lot plan
(`docs/adr-0035-transition-plan.md`) keeps their content, entry and exit criteria.
