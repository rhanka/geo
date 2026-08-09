# SPEC — geo owns effet_densifiant (4a) end-to-end

Status: consolidated design, ratified by double consensus (Opus 4.8xhigh ⊕ Codex 5.6-luna
xhigh, independent reviews, strong convergence, no material disagreement). Steve out of
loop by owner decision. immo ownership transfer proposed via h2a (loop-mrjumq96).

## Why

`effet_densifiant` (Steve's central criterion: does a zoning change raise the permitted
number of dwellings on the touched zone?) was stuck at 3/845 while sibling axes with a
fleet lane jumped (reglement 530, usage_dominant 222). Root cause was NOT a data
dependency on immo — it was the absence of a lane. The 3 served cities were done by hand;
I invented a "wait for immo's PPCMOI PDF" dependency instead of acquiring the document, which
geo does for every other axis (PV 96%, reglement 63%, normes 66%).

## Ownership (proposed to immo, geo executes its side unconditionally)

- **geo produces**: (1) zoning-event detection/classification, (2) signal→zone resolution
  (the mapper #74, moved from immo — resolved against real served `zone_code`, not fuzzy),
  (3) the before/after diff served on `qc-zonage-<slug>`.
- **immo keeps**: the product — UI filter, A/B ancien↔nouveau display, scoring vs Steve.
- **Contract**: geo SERVES, immo READS. No writing to immo's DB, no PDF round-trips.

## The overriding invariant (DONE — commit 675f8f6)

It must be structurally impossible to serve `effet_densifiant='densifie'` unless both
before AND after dwelling counts are read verbatim. Enforced in `fold-effet-densifiant.ts`
`readEntries`: effet is DERIVED from the counts (null count → inconnu; two counts → sign of
comparison; a contradicting effet throws). Plus `findKeys` stamps ALL served S3 keys (the
sub-folder key geo-api reads — memory fold-double-key-s3). Golden test proves the 3
hand-served cities satisfy the invariant.

## Pipeline (lane `geo-4a`, sharded)

Per muni, per detected zoning event:

### Stage 0 — $0 deterministic pre-gate (before ANY paid read)
1. **Event exists**: `isAvisLieAuZonage()` over avis-publics ∪ PV index ∪ reglement-provenance
   registry, with a bylaw identity + source PDF. ~800/845 munis are empty → skipped at $0.
   NB: only ~6 avis adapters configured → an empty result is a DISCOVERY gap, recorded as
   `inconnu:no-event-detected`, NEVER conflated with `inconnu:counts-not-extractable`.
2. **Zone resolves (targeted events)**: free local text pass (`pdftotext -layout`) extracts
   candidate zone tokens; resolve by EXACT match to the served `zone_code` set (loaded as a
   graphify registry — deterministic, $0). Zero matches → `zone_codes_non_resolus`, do not pay.
   Refonte scope uses a separate global gate; absence of named zones ≠ "no affected zones".
3. **Two-sided availability (the AVANT guard, below)**: if only one side is obtainable → inconnu.

Only `(muni, event, resolved zone)` triples passing all three reach a paid read.

### Stage 1 — DETECT → event ledger
Ledger `work/effet-densifiant/<slug>.events.json`, keyed by `(slug, canon(bylaw), millesime,
canon(zone_code))` with `sha256(source_pdf)` as document revision. Records: detection,
resolution, before/after grid identity, verbatim counts, served revision, and
`served_grid_state ∈ {pre, post, unknown}`. Re-processing the same event+hash is a no-op;
a later event on the same zone forms an explicit chronological chain.

### Stage 2 — RESOLVE zones (recall NER → exact resolution, STRICTLY separate)
- **Detection (recall)**: find EVERY candidate zone mention — prose, tables, headings, OCR,
  variant spellings, ranges ("zones 100 à 110") — retaining raw span + page. graphify
  `profile` mode (ontology `node_types={zone,reglement,date,muni}`, shared
  `ontology-profile.yaml` with immo) is the recall engine; its PAID LLM extraction runs only
  on gate-passing candidates (Stage 0 uses the free local pass). geo does NOT adopt
  graphify's graph store (no spatial/CRS — decided in studies/archi-decisions.md); it consumes
  graphify's `.graphify/ontology/*.json` typed-entity output.
- **Resolution (precision)**: EXACT match to the served set. `H 3`/`H3`/OCR variants →
  `zone_codes_non_resolus` unless a documented canonicalization applies. NEVER fuzzy — this
  is the class of bug that mis-resolved immo's mapper HC-14 → Compton at conf 0.45.
- **Exhaustivity is MEASURED** on an annotated gold set (scanned/table/prose/refonte/PPCMOI):
  mention-level recall, per-event set recall, exact-resolution vs unresolved rate, stratified
  by layout/OCR quality. A zoning event with 0 detected zones + poor extraction coverage →
  `detection_incomplete`, never silently zone-free.

### Stage 3 — DIRECTION GUARD (the AVANT problem, Q1 crux)
Compare the served polygon's `(reglement_numero, millesime)` EXACTLY to the event bylaw's:
- `canon(B) == canon(R_s)` → served grid IS the amendment = **APRÈS**; avant = acquire the
  predecessor codification. (Using served as avant here double-counts → false stable.)
- `canon(B) != canon(R_s)` AND `M_s < M_B` → served grid = **AVANT** (the exact case of the
  3 existing cities: served 330-2018/115-12-2020/2022-228, new bylaw acquired fresh).
- anything else (missing pair, `M_s == M_B`, or a later règlement already superseded B) →
  **`unknown` → serve NO delta**. `fold-effet-densifiant-scaffold.ts` hard-codes
  `densite_apres_reglement := served reglement_numero`; this guard OVERRIDES that presumption.

Failure mode if missing: once geo re-folds a refonte into `qc-zonage-norms`, the served grid
becomes 451-2025; a guard-less lane sets avant := served (the AFTER state) → the 7
hand-verified saint-stanislas densifie flip to false `stable`, or sign-invert to `reduit`.

### Stage 4 — ACQUIRE + DIFF (verbatim)
Refonte → whole-grille OCR + exhaustive old→new zone mapping. Ponctuel/PPCMOI →
single-zone vision (`zonage-norms-amendment-ingest.ts` `extractZonePageFromPdf`). Freeze
verbatim counts + source sha256 + page provenance in the ledger. Steve's numeric hint (e.g.
coaticook 9→12) is a COHERENCE CHECK, never a served value.

### Stage 5 — SERVE
`fold-effet-densifiant --slug` onto `qc-zonage-<slug>` (all keys) + project the events feed
immo consumes (schema TBD with immo; candidate `qc-zoning-events-<slug>`). The served
artifact is a pure projection of the ledger → idempotent by construction.

## Routing (Q3)
`ppcmoi` → ponctuel (single-zone). `derogation-mineure` → excluded (no grille dwelling
change). `entree-en-vigueur`/`projet-reglement` of a zoning bylaw → AMBIGUOUS: classify by a
$0 PDF scope probe (zone-token count + page count), NEVER by `AvisType` alone. Ambiguous →
unresolved, never defaulted to refonte or "all zones". (`AvisType` has no `amendement` value.)

## Regression / rollout (Q5)
Shadow mode: run the lane, require EXACT equality of `(zone_code, densite_avant, densite_apres,
effet_densifiant, effet_densifiant_delta)` against the 3 committed artifacts before serving new
output. All 3 are REFONTES — the ponctuel/PPCMOI branch has NO golden yet. **coaticook RD-104
is the first ponctuel golden**, hand-verified before that branch is trusted; geo acquires the
RD-104 document itself (it is a coaticook bylaw in their avis-publics/PV) — no immo dependency.

## Fleet lane
Config `acquisition/config/fleet.json` lane `geo-4a`, engine claude (fallback codex). The $0
pre-gate keeps the paid LLM off the ~800 event-free munis. Prompt:
`work/delegation-mass/agent-prompts/effet-densifiant-4a-base.txt`.

## Top risks carried from review (ranked)
1. ~~Serve-time cross-field hole~~ — FIXED (675f8f6).
2. Missing AVANT direction guard → false stable / sign inversion. Stage 3, mandatory.
3. LLM flip-flop across runs → freeze counts + sha256 in ledger; verdict = pure function.
4. ~~Dual-S3-key serving null~~ — FIXED (675f8f6).
5. Bylaw-number/millésime trap (title number wrong ~1/4) → read verbatim from body art.1.1.
6. Missed zone mentions → recall NER + measured exhaustivity; 0-zone+poor-coverage = incomplete.
7. avis-publics ~6 adapters → discovery gap, distinct inconnu reason.
8. Ponctuel branch unverified → coaticook golden first.
