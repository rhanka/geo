# PROPOSAL — graphify typed-linking capability (geo request, consolidated)

Status: consolidated proposal from geo to @sentropic/graphify. Double-reviewed:
Opus 4.8 ⊕ Codex luna (the geo-4a design) then Fable 5 (this capability generalization,
grounded in graphify's own code). Awaiting graphify maintainer's feasibility reply.

## Goal (the user's framing)

Make zone-code detection a **parametrization of graphify**, not a bespoke NER pipeline in
geo — and capitalize it as a GENERAL capability: given **(input entities / a gazetteer)** +
**(a detection type / a strategy)**, extract typed entities. Reusable for any closed-set
entity type, shared ontology across consumers (immo + geo), so nothing drifts.

## The NLP frame that dictates everything

Extracting `zone_code` is NOT open-world NER. It is ENTITY LINKING against a CLOSED gazetteer
that is scoped **per document** (this municipality's served zone_code set). A generic NER
model sees `HCV-191` as noise. Right technique: gazetteer + normalization + EXACT match,
never fuzzy (fuzzy mis-resolved immo's mapper HC-14 → COMPTON:C-15 at conf 0.45).

## What graphify already has (so this is extension, not graft)

- `ontology-profile.yaml` node_types with `registry` binding + `aliases` + `status_policy`
  (`src/ontology-profile.ts`) — the right SURFACE for the parameter.
- **`src/cite-grounding.ts` (`graphify cite`)** — the architectural precedent: corpus →
  localizable `SourceUnit` (page/section/para), one normalizer shared by candidate-match AND
  the verbatim gate (`normalizeForMatch`), a HARD anti-hallucination invariant ("a quote that
  cannot be relocated in the source is dropped, never invented"), and `heuristic|assistant|api`
  modes where the LLM is an opt-in recall booster gated by the same deterministic verifier.
  THE NEW CAPABILITY IS A SIBLING PRODUCER PASS TO `cite` (`graphify link` / `ground-entities`),
  not a tweak of the profile prompt-builder. The current profile LLM mode becomes ONE detector.
- Deterministic resolution cascade already specified (SPEC_ONTOLOGY_OUTPUT_ARTIFACTS §
  Canonicalization: registry-ID → exact normalized label → exact alias) — expose it at
  MENTION level with a pluggable normalizer.

## Decompose the "strategy" into 3 orthogonal axes (Fable 5)

An opaque `gazetteer-exact` enum fuses three things graphify separates everywhere else:
- **DETECTION (recall)** — how candidates are generated. Cost lives here.
- **RESOLUTION (precision)** — how a candidate becomes a link. Always $0, deterministic.
- **VERIFICATION (evidence)** — the candidate must relocate verbatim in the source (span+page).

- **Resolvers (2)**: `exact` (canonical key; ambiguity → `ambiguous` bucket, NEVER auto-decided)
  and `none` (open extraction = current mode). Optional ordered secondary `key_fns`, each
  uniqueness-gated (geo already ships this: `zoneNumberOf` bridge in `lotZoneJoin.ts` with
  double-uniqueness anti-merge guard — exact on a derived key, NOT fuzzy).
- **Detectors (3)**: `lexicon` ($0 registry-term scan), `pattern` (form regex + range expanders
  **filtered by registry membership** — geo memory "expand-categories = invention"), `llm`
  (paid, opt-in, gated by the same resolver).
- **Presets (3)**: `gazetteer-exact` = lexicon+pattern→exact; `open-extraction` = llm→none
  (unchanged); `hybrid-recall` = gazetteer-exact then llm ONLY on residual docs by declarative
  trigger, same resolution.
- **fuzzy is NOT a linking strategy** — it stays where graphify already puts it: the
  reconciliation REVIEW queue (human, non-destructive reversible patches). Per-node-type flag
  `reconciliation.fuzzy: off` (mechanism `fuzzyExcludeTypes` exists).

## PARAMETER #1 — gazetteer scoping (the hole in geo's first proposal)

graphify registries are project-global; `C-15` exists in dozens of munis. Exact match against
the UNION reproduces HC-14→COMPTON at confidence 1.0 — worse than the fuzzy 0.45 it kills,
because it looks certain. Symptom already mechanical: `compileNodes` (`src/ontology-output.ts`)
flags `needs_review` for any alias on ≥2 nodes → mass ambiguity at 800 munis. REQUIRED:
`registries.<r>.partition_column` (e.g. `slug`) + a document→partition binding (source
frontmatter / input layout / fn). The reconciliation EXACT tier must also respect the partition
(risk #2), not only the fuzzy tier.

## Normalization = function reference under a mechanically-verified contract (not a DSL)

geo's `canonicalizeZoneCodeForJoin` does digit-first inversion (`20HA`→`HA-20`), leading-zero
drop, presentation-paren strip, with an anti-merge invariant ("two codes collapse IFF same
letters AND same numeric value; `H-1`≠`H-10`, `C-408`≠`C-40`"). No declarative DSL expresses
this without becoming Turing-complete. So:
- **`normalize.fn`** = `module#export` (consumer-local ESM), with a contract graphify verifies
  at load ($0): idempotence (`f(f(x))===f(x)` over the lexicon) AND the **anti-merge audit** —
  applying `normalize` to the registry keys must merge NO distinct IDs of the same partition; a
  bad normalizer is killed before any document is read.
- **`normalize.builtin`** = composable list for the trivial 80% (`case_fold`, `dash_fold`,
  `collapse_ws`, `strip_parenthetical`); default = cite-grounding's `normalizeForMatch`.
- Two consistency requirements: (a) the normalizer hash enters `profile_hash` (cache
  namespacing — else stale caches served silently); (b) the SAME normalizer per node_type must
  be used by linking, the reconciliation exact tier, AND ontology-output's `normalizedTerm` —
  graphify has THREE normalizers today; a 4th un-unified = "linked ≠ reconciled ≠ cited".

## Measurement is intrinsic — but the pivot artifact must first EXIST

BLOCKING: `occurrences.json` is a hardcoded empty array (`src/ontology-output.ts:286`
`writeJson(..., [])`). geo's "reuse occurrences.json" reuses a stub. The occurrence layer is
LOT 1, not a given. Occurrence schema (the measurement substrate):
`{id, node_type, raw_span, normalized, source_file, page, offsets, detector,
resolution ∈ {linked|unlinked|ambiguous}, registry_record_id?, registry_partition}`.

Then `graphify profile evaluate` (deterministic, $0) crosses run vs an annotated gold
(same occurrence schema, hand-labeled, stratified by layout/OCR quality) → `evaluation.json` +
report section:
- **mention recall** (spans found / gold spans),
- **set recall per document** (distinct-entity set — for geo, zones per event),
- **resolution precision** ALWAYS paired with the **unresolved rate** (a resolver that links
  nothing has perfect precision; publishing one without the other is a structural lie),
- stratified by layout / OCR / spelling-family.
Gate: non-zero exit if a declared floor is breached — this is ALSO the cross-consumer compat
test (immo + geo each commit their gold; a profile change that breaks the other's gold fails
CI before serving). Structure `validation.json` too ({code, node_type, severity, refs}), today
free-text and un-gateable.

## Recommended capability contract (ontology-profile.yaml, all optional; absent = unchanged)

```yaml
node_types:
  Zone:
    registry: zones
    linking:
      preset: gazetteer-exact          # or decompose:
      detect: [lexicon, {pattern: {form: "[A-Z]{1,3}[-\\s]?\\d{1,4}", expand: {ranges: registry-membership-only}}},
               {llm: {trigger: "zero_candidates && scanned", budget_usd: 0.10, dry_run: true}}]
      resolve: {mode: exact, keys: [canonical]}       # ambiguity → bucket, never auto
      normalize: {builtin: [case_fold, dash_fold, collapse_ws], fn: "./src/canon.js#canonicalizeZoneCodeForJoin"}
      evidence: {verbatim: required, context_window: 240}
      reconciliation: {fuzzy: off}
registries:
  zones: {source: zones, id_column: zone_id, label_column: zone_code, partition_column: slug}
evaluation:
  gold: eval/zones.gold.json
  floors: {mention_recall: 0.95, set_recall: 0.98, resolution_precision: 0.995}
```

Outputs: real `occurrences.json` (3 buckets + span+page+detector+partition), `evaluation.json`,
structured `validation.json`. Implementation = sibling producer to `graphify cite`.

## Division of ownership (what graphify does vs what geo keeps)

graphify STOPS at typed occurrences + links + measures. geo keeps the business semantics: the
AVANT/APRÈS direction guard, event chaining, the served `qc-zoning-events` schema. Do NOT
absorb geo's Stage-3 event logic into graphify (over-generalization, risk #6).

## Top risks (Fable 5, ranked)
1. Gazetteer scoping absent → exact-match on the union = HC→Compton at conf 1.0. `partition_column` is param #1.
2. Fuzzy/auto-merge leak via reconciliation; the EXACT tier must respect the partition too.
3. Normalization-regime drift across graphify's 3 normalizers; unify + hash into profile_hash.
4. Ontology drift between consumers (shared profile = shared API); per-consumer gold as CI compat test + pinnable profile version.
5. $0/paid boundary erosion; declarative `trigger` + `budget_usd` + `dry_run` per llm detector.
6. Over-generalization (strategy enum cartesian blow-up → the decomposition; and absorbing geo business logic → keep it out).
7. Pivot artifact absent: `occurrences.json` empty stub + free-text `validation.json` — build the occurrence layer first.
