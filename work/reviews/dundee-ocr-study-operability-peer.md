---
status: completed
reviewer: h2a-codex
target: Dundee raster usage-dominant OCR study
lens: cluster-s3-operability-and-cost-boundary
---

# Independent review — operability

## Finding

No existing versioned runner can process the Dundee PDF directly for
`usage_dominant`.

- The only remote OCR/vision launcher found is explicitly a *captured normes*
  launcher: it requires a `registry/normes-captured-references/` key
  ([`k8s-captured-normes-run.ts:30-39`](../../acquisition/src/k8s-captured-normes-run.ts))
  and labels its Job `lane: normes` ([`k8s-captured-normes-run.ts:61-80`](../../acquisition/src/k8s-captured-normes-run.ts)).
- Its reference contract rejects any capture whose run or manifest lane is not
  `normes` ([`normes.ts:373-402`](../../packages/qc-sources/src/capture/normes.ts)),
  and extraction also requires an immutable discovery selection
  ([`normes.ts:133-164`](../../packages/qc-sources/src/capture/normes.ts)).  The
  Dundee CAS key documented by the study is `usage-dominant-reglement-grid`,
  not such a reference ([`SPEC_STUDY_DUNDEE_RASTER_USAGE_DOMINANT_OCR.md:5-13`](../../spec/SPEC_STUDY_DUNDEE_RASTER_USAGE_DOMINANT_OCR.md)).
  Reclassifying it as `normes` would forge provenance.
- The launcher has the right *remote-only* shape—PDF bytes remain in CAS and
  are materialised only in the pod ([`k8s-captured-normes-run.ts:133-150`](../../acquisition/src/k8s-captured-normes-run.ts))—but its receipt schema is fixed
  to `engine: mistral-schema`, `methode: ocr/mistral-schema`, and a Normes
  parquet outcome ([`normes.ts:133-163`](../../packages/qc-sources/src/capture/normes.ts)).
  It cannot attest an extracted Dundee legend or its zone-to-dominance mapping.

## Option assessment

### A — retain `unknown`

**Viable now.** It is the only option whose result is fully evidenced today:
the native-text probe found no text, which is not evidence either for or against
a legend ([`SPEC_STUDY_DUNDEE_RASTER_USAGE_DOMINANT_OCR.md:7-13`](../../spec/SPEC_STUDY_DUNDEE_RASTER_USAGE_DOMINANT_OCR.md)).  This must remain an explicit
refusal/unknown, not an empty mapping.

### B — dedicated non-paid raster OCR

**Not viable without a new cluster image, runner, and contract.** The reusable
Tesseract helper is a library primitive only: the shipped Docker image lacks
Tesseract and Poppler ([`pdf-ocr.ts:31-40`](../../packages/qc-sources/src/sources/pdf-ocr.ts)),
and the primitive writes the PDF and page rasters to a temporary directory
([`pdf-ocr.ts:234-299`](../../packages/qc-sources/src/sources/pdf-ocr.ts)).  The
latter is acceptable only *inside a pod* after the new runner has read the
immutable CAS object; it is not an S3 receipt pipeline.  Nor does a plain text
transcript prove the graphical legend's code/category relationship.  The new
runner therefore needs deterministic page/raster artefacts and an explicit
legend-pairing validator before it may emit a mapping.

### C — dedicated bounded vision job

**Technically viable only as a new product path; it needs an owner decision.**
`MistralVisionGrille` already makes two differently prompted calls
([`grille-vision-extractor.ts:341-425`](../../packages/qc-sources/src/sources/grille-vision-extractor.ts))
and retains values only when the two calls agree
([`grille-vision-extractor.ts:717-798`](../../packages/qc-sources/src/sources/grille-vision-extractor.ts)).
However it returns `ZoneNorms`, not a usage-dominant legend contract, and it
has no S3 artefact/receipt writer.  It can be reused as a dependency, never as
the Dundee runner itself.

The current Normes job's `--budget-usd` is merely a positive argument passed as
an environment value ([`k8s-captured-normes-run.ts:30-47`](../../acquisition/src/k8s-captured-normes-run.ts),
[`k8s-captured-normes-run.ts:91-103`](../../acquisition/src/k8s-captured-normes-run.ts));
this launcher contains no observed page counter or API-spend cutoff.  A
usage-dominant job must enforce a predeclared page cap and cost ceiling inside
the worker, write actual counted usage to S3, and stop/refuse before either cap
is exceeded.

The available benchmarks do not validate Dundee's task: they cover *grilles de
normes*, not legend extraction ([`model-eval-vision-ocr.md:72-95`](../../docs/study/model-eval-vision-ocr.md)),
use pre-verified page windows ([`model-eval-vision-ocr.md:27-32`](../../docs/study/model-eval-vision-ocr.md)),
and mark Mistral-schema figures as non-persisted ([`model-eval-vision-ocr.md:105-117`](../../docs/study/model-eval-vision-ocr.md)).
They cannot support a cost or accuracy claim for the 13-page Dundee legend.

## Required gates before B or C

1. A separate `usage-dominant` immutable capture-reference schema binds the
   exact CAS key/digest, successful cluster capture manifest line, source URL,
   and a documented page-selection receipt. It must not reuse a `normes`
   reference.
2. A cluster-only runner identifies its image digest in an idempotent job name,
   has an active deadline, and writes every input identifier, rendered-page
   digest, raw OCR/vision response, page selection, actual usage, outcome, and
   refusal to deterministic S3 keys. No workstation may materialise the PDF.
3. The runner enforces, rather than merely declares, a page cap and approved
   external-spend cap; it emits an S3 refusal receipt on cap, HTTP, parsing, or
   ambiguity failure.
4. A mapping is eligible only if two independent reads agree verbatim on both
   a real Dundee zone code and its explicit legend category, and all codes
   cross-validate against the served Dundee zones. Any unmatched/ambiguous code
   remains `null`/`unknown`.
5. Tests must cover receipt validation, cap refusal, S3-only materialisation,
   duplicate-job idempotence, and a raster legend fixture. A single successful
   OCR transcript is not an acceptance test.

## Rejected assumptions

- A normal `captured-normes` reference/job can be pointed at the Dundee object.
- The existing OCR/vision benchmarks establish legend-localisation quality,
  budget, or page count for Dundee.
- A `NORMS_BUDGET_USD` environment value is a spend limiter.
- OCR text alone justifies publishing a dominance mapping.

## Verdict

**needs-owner-decision** — retain option A until the owner chooses whether to
fund and own a dedicated S3-backed `usage-dominant` raster-analysis contract.
Neither B nor C is a safe direct continuation of the current Dundee capture.
