# Feature: captured normes Mistral schema

## Objective

- [ ] Acquire each col-3 grid through cluster CAS and extract only with strict Mistral schema OCR.
- [ ] Preserve an immutable S3 receipt from municipal capture to parquet or explicit refusal.

## Scope / Guardrails

- [x] Read municipal bytes only from S3 after a cluster capture; never fetch or persist them locally.
- [x] Invoke `zonage-norms-schema-ingest.ts --engine mistral-schema` directly; forbid GPT, generic routes and `MODE=full`.
- [x] Keep the shared norms manifest out of the extraction job; parquet and receipt are the per-city truth.
- [ ] Preserve unrelated plans, worktrees, data and `.track` events.

## Plan / Todo (lot-based)

- [ ] **Lot 1 — Exact capture contracts**
  - [ ] UAT: Zod rejects any incomplete, ambiguous or non-normes capture reference.
  - [x] Add strict reference, selection and extraction-receipt contracts to `packages/qc-sources`.
  - [x] Extend the CAS materializer to validate exact line/run/lane/slug/PDF identity.
  - [ ] Test run, line, slug, redaction, CAS-sidecar, size and PDF refusal paths.
- [ ] **Lot 2 — S3-only discovery selection**
  - [ ] UAT: a verified captured HTML page yields only verbatim, scored PDF URLs and an immutable S3 selection.
  - [x] Read/verify a captured HTML CAS body without municipal egress or local persistence.
  - [x] Reuse grille discovery parser and record source capture receipts for every candidate.
  - [ ] Test malformed HTML, wrong media, no candidate, duplicate and source-receipt mismatch.
- [ ] **Lot 3 — Closed Mistral execution**
  - [ ] UAT: an exact captured PDF produces parquet-only plus immutable success/refusal receipt.
  - [x] Add remote `captured` mode that materializes only the selected CAS PDF in its ephemeral volume.
  - [x] Pin direct `mistral-schema`, validate annotation output/chunks and forbid provider overrides.
  - [ ] Test no-GPT invocation, invalid annotation/chunk and no deposit on every refusal.
- [ ] **Lot 4 — Saint-Roch live completion**
  - [ ] UAT: captured Saint-Roch HTML leads to a captured PDF, a schema result or a durable refusal, and an S3 receipt.
  - [ ] Publish candidate worklist from the already captured Saint-Roch CAS page.
  - [ ] Submit PDF capture on OVH, build/push the remote job image, execute extracted selection.
  - [ ] Verify parquet/receipt and the closed city state from S3.
- [ ] **Lot 5 — Review and merge loop**
  - [ ] UAT: scoped tests, two independent reviews, `git diff --check`, PR and merged origin/main.
  - [ ] Run tests and two-peer review after implementation.
  - [ ] Commit only scoped paths, create/merge the PR, then continue with the next city.

## Branch Scope Boundaries

### Allowed

- `packages/qc-sources/src/capture/**`
- `packages/qc-sources/src/sources/grille-ocr-extractor.ts`
- `packages/qc-sources/src/sources/grille-ocr-extractor.test.ts`
- `acquisition/src/capture-cas-materialize.ts`
- `acquisition/src/captured-normes-*.ts`
- `acquisition/src/lib/grille-mistral-schema.ts`
- `acquisition/src/lib/grille-mistral-schema.test.ts`
- `acquisition/src/zonage-norms-schema-ingest.ts`
- `acquisition/src/zonage-norms-schema-ingest.test.ts`
- `deploy/normes-job/**`
- `acquisition/config/normes-col3-*.json`
- `spec/SPEC_*_CAPTURED_NORMES_MISTRAL.md`
- `plan/01-BRANCH_CAPTURED_NORMES_MISTRAL.md`

### Forbidden

- `Makefile`
- `docker-compose*.yml`
- `.cursor/rules/**`
- `.track/**`
- `work/coverage/**`
- Any direct municipal fetch implementation outside the capture job.

### Conditional

- [ ] BRN-EX1: update a shared Mistral/OCR library only with a focused regression test proving a strict schema failure cannot deposit norms.

## Feedback Loop

- [x] Record a durable S3 refusal and proceed when a city has no valid PDF candidate or fails an anti-invention gate.
- [ ] Rebase/merge origin/main before every PR action; never open more than two PRs toward main.
- [ ] Leave Track import to its designated single writer; the named plan is the mergeable source artifact.
