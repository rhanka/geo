# ADR-0035 — one-iteration plan (geo side)

Status: **draft for the owner decision dossier**, 2026-10-31 (Montréal time). Owner constraint: « ça doit être
fait en une itération max (7 j dev puis test) ». This file **replaces** `docs/adr-0035-short-plan.md` as the
proposed execution path; the short plan and the 9-lot plan stay as references for what comes after. Nothing
starts before the owner ratifies ADR-0035 with an owner-direct record.

Times are **Montréal time** (EST, UTC−5 since 2026-11-01). Radar refresh slots (prod cron `0 5,11,17,23 * * *`
UTC) = **00:00, 06:00, 12:00, 18:00**; a pass lasts up to **5 h 15** (radar measure, 2026-10-31). Calendar computed by `node scripts/adr-0035-calendar.mjs <T0> one`. Agents work every calendar day, so the
iteration is counted in **calendar days**, D1 = T0.

## 1. Dev, D1–D7: what is built, and nothing more

Scope = exactly four pieces: **geo's PV chain on radar's cities**, **radar's extraction ported unchanged**, the
**v1 contract**, and **radar-pv-consume in dry-run**. Same code, same Engram version (radar's pin), same model
policy (ADR-0034, accepted), same in-pod seat transport as radar today. Everything else is in section 6.

**Effort vs capacity** (two different figures, both stated):
- **Effort**, geo: **16 agent-days**, buffers included = short plan S1 + S2 (5 + 9 = 14) + the parity tool
  (2, new: in the short plan it was folded into S3.p). One agent cannot do it in 7 days.
- **Capacity**, geo: **3 lanes × 7 days = 21 agent-days**, so **5 agent-days of slack**, shown per lane below.
- **Three geo lanes in parallel + the radar lane** make it fit:

| lane | owner | D1 | D2–D4 | D5–D6 | D7 | effort (build + buffer) / slack in the 7 days | basis |
|---|---|---|---|---|---|---|---|
| **G-A capture** | geo | read radar's city + source list; contract of capture outputs (S3 text keys) frozen with G-B | extend `pv-capture-backlog` to the 528 cities; size guard (`too-large` status); CronJob dedup + digest pins | preprod run on the 528 cities, including the 183-day backfill used by the L3 parity; measure throughput | fixes | 3 + 2 = 5 / slack 2 | geo PV chain built in 2 wd (2026-07-26 → 07-29) |
| **G-B extraction** | geo | port plan; Engram pin = radar's | port `refresh-profile`, `refresh-model-policy`, `refresh-verification`, merge of `refresh-run` (~3 100 LOC + tests) **unchanged**; keyring `flock` + pending watchdog | job wrapper reading G-A's text keys; preprod run on 20 documents with the geo keyring | fixes | 4 + 2 = 6 / slack 1 | `qc-sources` port, 241 files in 6 wd (short plan S2 minus its contract part) |
| **G-C contract + parity** | geo | **freeze contract v1** (field list, section 5) + golden fixture, shared with radar | writer `exports/immo/pv-signals/v1/` (per-city objects → snapshot → verify → CAS pointer, size budget); parity tool (L3 sha sets; L4 graph delta built by radar's code from geo's extraction vs radar's own, Jaccard per signal category, `needs_review`) | integrate G-B → writer; end-to-end preprod smoke | one preprod rollback rehearsal with radar | contract 2 + 1, parity tool 2 (hypothesis) = 5 / slack 2 | served contract built in 1–2 wd; capture proof index in 1 wd |
| **R radar** | radar | token instrumentation (0.5) | `radar-pv-consume` dry-run: contract client, then radar's existing `extractionToV23Graph` → enrich → `upsertGraphAtomic(..., { preview: true })` on geo's extractions; Source re-binding by `docSha`; `rawRef` → geo | allowlist + refresh skip + rollback script; dry-run on G-C's preprod contract | rehearsal with G-C | 3.5 before the review; **radar re-estimates** with the re-binding and `rawRef` items | `radar-lots-estimates.md` |

**Dependencies between lanes** (all frozen on D1, so the lanes then work apart):
- G-C → G-B and R: the contract v1 field list and golden fixture (D1). R builds against the fixture, not against
  geo's code.
- G-A → G-B: the S3 keys of the extracted text (D1 interface; G-B tests on fixtures until G-A's preprod run, D5).
- G-B → G-C: the extraction output shape is radar's (unchanged port), known on D1.
- Keyring (blocker B4) → G-B preprod run on D5. Radar read credential (B5) → R dry-run on D5.

**PRs**: two geo PRs, **PR-1 = G-A**, **PR-2 = G-B + G-C**, each merged on D7 (geo rule: each lot ends merged). This
needs **two free PR slots** (blocker B2).

## 2. Test, right after: shadow and parity

- **Shadow**: geo capture + extraction on the 528 cities at radar's 4 slots; radar stays authoritative and
  unchanged; radar runs its dry-run on prod data at each cycle (`upsertGraphAtomic(..., { preview: true })`,
  rolled back). Geo writes the contract to the **preprod** bucket during the shadow.
- **Minimum duration: 4 consecutive cycles = 24 h.** Justification, without padding:
  - the L3 gate requires **3 consecutive geo cycles**, and its failure rule (a city radar reaches must not fail
    in geo on **2 consecutive** cycles) needs at least one cycle after a first failure → 3 is the floor;
  - the 4th cycle makes the shadow cover **each of radar's 4 daily slots once** (00:00, 06:00, 12:00, 18:00), so
    time-of-day effects on municipal sites (rate limits, night maintenance) are seen once, side by side;
  - longer windows add few cases: radar takes **at most 1 document per city per pass**. The case count for the L4
    signal parity comes from (a) every document radar extracts during the 4 cycles and (b) a **replay sample** of
    documents radar already extracted, at least 20 per signal kind where they exist. A kind with fewer than 20
    cases is reported `unverified`, never counted as passed;
  - the L3 sha parity runs on the 183-day backfill captured in D5–D7, not on documents collected during the 24 h.
- **Parity measured** against the **ADR-0035 gate values, unchanged** (L3 sha recall ≥ 98 % overall and ≥ 95 % per
  city, error rate ≤ 17.6 %; L4, where "kind" = `node_type:category` (radar's proposal, to confirm in B6): 100 %
  identical graph delta when radar's code runs on the same extraction, Jaccard ≥ 0.90 / ≥ 0.80 per kind,
  `evidenceRefs` on 100 %, 0 orphan facet, 0 canonical node lost, `needs_review` ≤ 5 %), plus one v101b
  benchmark run. The report lists every city or kind below threshold.
- If a city fails on 2 consecutive cycles, only that city is re-run on the next cycle; it does not restart the
  window for the others.
- **Cost**: tokens are measured from D1 (radar instrumentation, also ported). The shadow doubles the LLM calls
  for 24 h plus the replay sample; kill-switch above 2× radar's daily use. This replaces the 7-day L0 baseline:
  the baseline is measured during the shadow itself.

## 3. Cut-over at the owner's go

- After the parity report, **owner go** (geo-prod Environment).
- **Two waves the same day**: wave 1 = ~50 cities at the 12:00 slot; wave 2 = all remaining cities at the 18:00
  slot, if wave 1 shows 0 incomplete snapshot read as complete, 0 dropped signal and facets unchanged. Radar's
  refresh skips allowlisted cities, then is **suspended and kept deployed** after wave 2.
- **Rollback**: per city = remove from the allowlist + canonical pre-image (radar's script, rehearsed on D7);
  everything = unsuspend radar, effective at the next slot (≤ 6 h).
- **Retirement of the radar chain: later, outside the iteration**, after an observation period with radar
  suspended and a separate owner go.

## 4. Blockers to remove before D1

| # | blocker | who removes it | what "removed" means |
|---|---|---|---|
| B1 | **Ratification** of ADR-0035 and of this plan | owner | owner-direct record |
| B2 | **2-open-PR limit**: #427 and #363 are open today; the iteration needs 2 free slots for PR-1 and PR-2 | owner decides; geo-cond executes | #427 merged at ratification, and #363 closed or merged by owner decision, **or** an owner waiver of the limit for this iteration |
| B3 | **`geo` namespace quota** | k8s | current figure given, and headroom confirmed for the shadow, while radar still runs. Added in ns `geo` (radar figures, main/preprod): extraction pod **50m/512Mi requests, 150m/1536Mi limits** (heap 1024, emptyDir 512Mi; init 5m/16Mi → 50m/64Mi); watchdog **10m/64Mi requests, 100m/128Mi limits** (every 5 min, 180 s); up to 4 capture Jobs **60m/120Mi requests, 150m/176Mi limits** each; 1 PVC 1Gi (B4) |
| B4 | **Seat keyring for the geo extraction pod** (old S2.k) | k8s mints, radar gives its enrolment procedure, owner checks terms of use | credentials in ns `geo` on **geo's own keyring PVC** (1Gi RWO, `csi-cinder-high-speed-gen2`, as radar's; sharing radar's PVC is excluded: an RWO attach collision kept both passes Pending 4 h 30 on 2026-10-09); rotation cycle written in `.env` + docs; Codex and Claude Code terms checked (owner Q1); Cloud Code decided (open question) |
| B5 | Radar read-only credential on `exports/immo/pv-signals/` **and** `extractions/cas/` (and geo `raw/` for `rawRef`) in both buckets | k8s | minted, with rotation; needed by R on D5 |
| B6 | Contract v1 field list (section 5) | geo-cond + immo | agreed before D1 (one exchange) |

## 5. Contract v1, minimal (to agree in B6)

**Revised after radar's review** (radar `de97c78f`, 2026-10-31): a flat signal list is enough for parity but not
for radar's merge, which applies a graph **delta** (nodes, edges, refs) built from the extraction
(`extractionToV23Graph` → enrich → `upsertGraphAtomic`, `refresh-run.ts:520-532`). Since geo runs radar's
extraction **unchanged**, the iteration contract carries **that extraction itself**, not a geo-derived signal
list. Radar then builds its graph with its own code, so node ids (`<prefix>-<city>-<local>`), edges
(`raises_signal`, `derived_from`, `supports`), non-signal nodes, facet fields and the evidence shape are
**radar's by construction**. This also removes the `event_id` → `::` mapping from the iteration.

- `latest.json` → `snapshots/<sha256>.json` (city index: slug, revision sha256, object URI, counts) → per-city
  `cities/<slug>/<sha256>.json`: one record per document with `doc_sha`, `source_url`, `retrieved_at`, `raw_ref`
  (geo S3 key of the raw bytes), `coverage_state` (**radar's enum**: `pending`, `covered`, `abandoned`),
  `model_receipts`, run identity (`profile_hash`, `registry_hash`, `engram_version`, `model_policy`) and
  `extraction_cas_key` + its sha256.
- The extraction objects, exactly as the ported code produces them, are immutable objects under
  `extractions/cas/<sha256>.json` in the same bucket; the per-city object references them by key. Their evidence
  refs keep radar's shape (`docSha`, `rawRef`, `page`, `excerpt`, `sourceUrl`, `documentDate`, `publishedAt`,
  `fetchedAt`, `refresh-v23.ts:71-80`).
- **Absent means absent**: `etape`/`instrument` are omitted when not extracted (radar fills them only when
  absent, `graphify-34-enrichment.ts:84-101`), never `""`, `inconnu` or `autre`.
- v1 is **add-only** (no tombstone). Size budget and write order as in ADR-0035 item 4, applied to the index and
  per-city objects; extraction objects are outside that budget.
- Radar side, before cut-over: re-bind Source ids by `docSha` (`refresh-run.ts:550-564`) and point `rawRef`
  at geo (`routes/documents.ts:23-40`). Both belong to lane R; radar re-estimates R with them.
- The event-level contract of ADR-0035 item 4 (served PV events, `event_id`) comes after the iteration.

## 6. After the iteration (not built in D1–D7)

Radar retirement (after observation) · join and `geo_resolutions` (L7) · s3-dag engine and its canary · F-CM1..F-CM5
(gateway pool, parallel extraction, ledger, MCP) · Engram 0.24.0 with F-EN1..F-EN9 and the profile bundle ·
bounded-memory streaming collection (the size guard covers the iteration) · preprod cohorts. Their content stays
in `docs/adr-0035-transition-plan.md`.

## 7. Residual risks and what stays unchanged

| # | risk | mitigation |
|---|---|---|
| I1 | A lane slips (G-B is the tightest: 6 agent-days of effort, 1 day of slack) | D1 freezes all interfaces; G-B's port is unchanged code, not a rewrite; if G-B is not merged on D7, the shadow does not start and the go is not asked |
| I2 | 183-day backfill throughput unknown (capture of ~20 000 radar-known PDFs) | measured on D5; if it cannot finish by D7, the L3 parity is computed on the cities fully backfilled and the others are listed `unverified`, not passed |
| I3 | 24 h shadow sees each slot once only | per-city re-run rule; kinds with too few cases `unverified`; radar suspended (not removed) after cut-over |
| I4 | One extraction pod and seat keyring in geo, as in radar today | `flock` + pending watchdog ported; parallel extraction comes later with F-CM |
| I5 | Blockers B2–B5 not removed before D1 | D1 does not start; the dates move by the delay |
| I6 | **Radar's own refresh is not extracting today**: on 2026-10-31 every observed pass exited 1 (preprod: `systemic-city-failures`, 0 documents extracted; prod logs not read). The live shadow may then have no radar case to compare, and the cost of a pass that extracts is `unknown` | the L4 parity rests on the **replay sample** of documents radar extracted earlier; radar diagnoses its failing passes before D1 (radar-owned), otherwise the shadow compares geo against no live baseline and that is stated in the report |
| I7 | A pass takes up to 5 h 15 per 6 h slot (radar measure) | the 4-cycle window holds; a pass that overruns its slot is a cycle failure for the cities it did not reach, and re-run on the next cycle |

Unchanged: **no radar downtime** (radar authoritative until the go, then suspended and deployed); **a rollback at
every step**; **parity measured before cut-over**, gate values unchanged, owner go; **Loi 25**: no owner fields in
any output, storage in the OVH BHS bucket (Québec) as today, same LLM flows as radar today; ADR-0024; 0 Python;
capture on the cluster only.

## 8. Calendar

`node scripts/adr-0035-calendar.mjs 2026-11-16 one`, T0 = D1 = **2026-11-16**, the day after a ratification on
2026-11-15 (hypothesis; rerun with the real date), blockers B2–B6 removed before D1:

| step | content | duration | start | end |
|---|---|---|---|---|
| D1–D7 | Development, 4 parallel lanes (G-A capture, G-B extraction, G-C contract + parity, R radar) | 7 cal d | 2026-11-16 | 2026-11-22 |
| G0 | Owner approval: deploy the shadow jobs (geo-prod Environment), then shadow starts at the next radar slot | 1 cal d | 2026-11-23 | 2026-11-23 |
| T1 | Shadow: 4 consecutive cycles (24 h), radar authoritative, radar dry-run each cycle | 1 cal d | 2026-11-24 | 2026-11-24 |
| T2 | Parity report against the ADR-0035 gate values; re-run cycle only for failed cities | 1 cal d | 2026-11-25 | 2026-11-25 |
| G1+C | Owner go, then cut-over in 2 waves the same day (2 radar slots); radar suspended | 1 cal d | 2026-11-26 | 2026-11-26 |

Result: **dev 2026-11-16 → 11-22, test 11-23 → 11-25, cut-over 2026-11-26** (wave 1 at 12:00, wave 2 at 18:00),
i.e. **11 days from T0**, if parity is reached on the first shadow and the owner gives both approvals the same day
they are asked.
