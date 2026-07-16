# Objective

- [ ] Build a deterministic local-only staging runner for Saint-Amable's 109 official zoning features and 109 linked PDF grids.
- [ ] Preserve every regulatory column as a variant and emit no production write capability.

# Scope / Guardrails

- [x] Keep S3, live API, Track publication, manifests and deployment outside the runner.
- [x] Abort on source-fence drift, missing/duplicate source records, invalid PDF integrity or extraction ambiguity.
- [x] Preserve unrelated shared-worktree changes.
- [x] Require deterministic manifests and explicit diagnostic output on every failure.

# Branch Scope Boundaries

## Allowed

- [ ] `acquisition/src/zonage-norms-arcgis-zonepdf-stage.ts`
- [ ] `acquisition/src/zonage-norms-arcgis-zonepdf-stage.test.ts`
- [ ] `acquisition/src/lib/arcgis-zonepdf-stage.ts`
- [ ] `acquisition/src/lib/arcgis-zonepdf-stage.test.ts`
- [ ] `acquisition/src/lib/arcgis-zonepdf-stage-runner.ts`
- [ ] `acquisition/src/lib/arcgis-zonepdf-stage-runner.test.ts`
- [ ] `packages/qc-sources/src/sources/grille-zone-variants.ts`
- [ ] `packages/qc-sources/src/sources/grille-zone-variants.test.ts`
- [ ] `packages/qc-sources/src/sources/fixtures/saint-amable/**`
- [ ] `spec/SPEC_EVOL_SAINT_AMABLE_OFFICIAL_STAGING.md`
- [ ] `BRANCH.md`

## Forbidden

- [ ] `Makefile`
- [ ] `docker-compose*.yml`
- [ ] `.cursor/rules/**`
- [ ] `acquisition/src/lib/s3.ts`
- [ ] Production deposit, publish, manifest or deployment paths
- [ ] Existing live artifacts under `work/coverage/**`

## Conditional

- [ ] `packages/qc-sources/src/sources/grille-vision-*.ts` only through `BRSA-EX1` if a frozen extractor bug blocks local staging.
- [ ] `packages/qc-sources/src/sources/grille-vision-*.test.ts` only with the same `BRSA-EX1` and an isolated regression proof.
- [ ] `BRSA-EX1` requires two-peer review, no behavior widening outside QC grille extraction, and rollback by reverting the isolated lot.

# Lot 1 — Source fence and PDF manifest

- [x] Add pure source-record validation for OID, raw/canonical code, PDF URL, item ID and group.
- [x] Read FeatureService fences at T0/T1 and require stable modified/editing/count/OID sets.
- [x] Query sorted OID chunks instead of offset-only pagination.
- [x] Validate ArcGIS URL and redirect host allowlists.
- [x] Validate item owner/title/type/access/created/modified/size before and after download.
- [x] Validate PDF magic, one page, size bound and SHA-256.
- [x] Test duplicate OID/code/PDF, canonical collision, moving fence, bad redirect, truncated PDF and title mismatch.
- [x] Lot gate: deterministic 109-record content manifest for recorded fixtures; zero network mutation paths.

# Lot 2 — Native variant extraction

- [x] Represent one official zone with ordered `variants[]` keyed by column index and bbox.
- [x] Pin the authoritative manifest code while requiring independently observed matching PDF headers.
- [x] Reject footnote suffix pseudo-zones and normalization collisions.
- [x] Restrict usages to h1–h5, c1–c6, p1–p3, i1–i3 and a1 inside the usage section.
- [x] Preserve structure labels and footnotes outside `usages`.
- [x] Preserve per-variant norm conflicts instead of richest-row collapse.
- [x] Add goldens H-59, CEN-181, HCV-187, PCV-197 and TR-184.
- [x] Lot gate: exact variant counts and expected height ranges; zero synthetic zone or structural usage.

# Lot 3 — Deterministic local staging runner

- [x] Add local CAS download cache with `.part` plus atomic rename.
- [x] Add resume keyed by source fence, PDF SHA and configuration hash.
- [x] Add bounded metadata/PDF concurrency, Retry-After and capped retries.
- [x] Keep vision fallback disabled by default and bounded by explicit pages/USD when enabled.
- [x] Emit variants, conservative mono-row preview, parquet candidate, diff, content manifest and run receipt.
- [x] Omit timestamps and latency from canonical manifest hashing.
- [x] Ingest the serialized Lot 2 `snake_case` contract with exact code/PDF SHA/prepared-set, bbox and closed norms validation.
- [x] Exit nonzero and omit `READY_STAGING` on any partial failure or unresolved invariant.
- [x] Lot gate: same inputs reproduce the same manifest SHA-256; runner imports no S3 client and exposes no publish flag.

# Lot 4 — End-to-end acceptance and review

- [ ] Run the 109-item local staging against a frozen source fence.
- [ ] Verify 109/109 source records, PDFs and zone outputs with no missing/extra/duplicate.
- [x] Verify the five blocking goldens and all package tests.
- [x] Verify `git diff --check` and scoped typecheck baseline.
- [x] Obtain independent correctness and operations reviews.
- [x] Reconcile all findings and rerun acceptance.
- [ ] Lot gate: `READY_STAGING` only; explicitly no `GO_PRODUCTION`.

# Current Blocker

- [ ] External source-read quota prevents the next live 109/109 run until 2026-07-21.
- [x] Decide whether the one-page invariant or the source document is wrong: neither. The count itself was measured wrong — raw `/Type /Page` occurrences overcount a one-page PDF that keeps a superseded page object from an incremental update (reproduced in test). The page count now reads the page tree `/Count`; a divergent page tree fails closed.
- [ ] Confirm on the 2026-07-21 live run that the previously rejected PDF passes. The offending PDF stays unidentified until then (source read is quota-blocked), but the diagnostic now carries `pageObjectCount` beside `pageCount`, so one run separates an incremental-update artifact from a genuine two-page document.

# Feedback Loop

- [ ] Record a blocker when source fences move, a PDF fails integrity, variants cannot be represented, or a required path leaves scope.
- [ ] Escalate the future live multi-variant contract as a separate owner decision.
- [ ] Keep production promotion, compare-and-swap and rollback design in a separate plan after staging acceptance.
