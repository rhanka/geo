---
status: completed
reviewer: h2a-claude
target: Dundee raster usage-dominant OCR study
lens: proof-contract-and-anti-invention
---

# Independent review — proof contract

## Verdict

**needs-owner-decision**. A dedicated cluster-to-S3 path is technically
possible, but neither the existing captured-normes job nor the existing vision
extractor can lawfully be pointed at the Dundee object to publish
`usage_dominant`. Reusing either as-is would cross both a provenance-contract
boundary and the lane's anti-invention boundary.

## Evidence and findings

1. The study establishes only a CAS key and a raster observation; it does not
   establish a `registry/normes-captured-references/*.json` input or an
   immutable discovery selection for Dundee. The current normes contract is
   intentionally narrower: its reference requires the exact run, manifest line,
   URL, final URL, retrieval timestamp, digest, CAS key, and selection key
   (`packages/qc-sources/src/capture/normes.ts:27-39`). Its extraction receipt
   rejects a null selection key (`.../capture/normes.ts:133-163`).

2. `k8s-captured-normes-run.ts` rejects every reference key outside
   `registry/normes-captured-references/*.json` (`acquisition/src/k8s-captured-normes-run.ts:30-40`),
   parses precisely that normes schema (`:133-139`), and labels the Job and its
   pod `lane: normes` (`:66-79`). The remote-only property is useful—PDF bytes
   stay in CAS until the pod materialises them (`:133-150`)—but it does not make
   a `raw/usage-dominant-reglement-grid/...` object a normes reference. Retagging
   or fabricating a reference would sever the documented discovery proof.

3. The existing vision extractor is not a general Dundee legend contract. Its
   sole output is `ZoneNorms`, with `usages` plus norm fields
   (`packages/qc-sources/src/sources/grille-vision-extractor.ts:703-799`). It
   accepts a filesystem PDF/image path and renders a PNG into `tmpdir()`
   (`:239-274`, `:805-820`); it can therefore be used only from a *new pod-side*
   wrapper, never from the operator workstation. Its direct Mistral request
   uses the rendered image as a base64 payload (`:341-425`), so a new runner
   must keep the rendered file ephemeral in the pod and persist only declared
   S3 artefacts/receipts.

4. A concordant OCR read of permitted uses cannot establish dominant use. The
   existing extractor merely intersects the two `usages` arrays (`:779-798`).
   The usage-dominant fold expressly forbids using a grid's `usages`: it requires
   the official zone nomenclature and a committed per-slug map
   (`acquisition/src/fold-usage-dominant.ts:9-25`). Its only publishable values
   are five categories or explicit null (`:46-64`); longest-prefix matching
   makes explicit nulls safety-critical (`:49-54`, `:177-231`). Thus a page
   containing H/C/I/A checkmarks is not evidence that any one is dominant.

5. The two pass guard is valuable but insufficient for this new claim. The
   current implementation calls the same Mistral model twice with prompt/
   temperature variation (`grille-vision-extractor.ts:341-380`, `:721-724`)
   and applies concordance to norm cells. It does not require an explicit
   code-or-prefix-to-dominant-category assertion, does not preserve a legend
   transcription contract, and does not prove that both calls selected the
   authoritative nomenclature rather than a permissive-use matrix.

## Required gates before any Dundee map/fold

1. Define a **separate usage-dominant captured-reference and receipt schema**;
   bind it to the existing Dundee capture manifest line and CAS digest, without
   reclassifying it as a normes discovery. If no manifest/provenance tuple can
   be recovered, end in an S3 refusal receipt and retain `unknown`.
2. Add a pod-only runner, image digest, bounded deadline/retry and explicit
   approved cost ceiling. It must read the PDF from S3, render only in pod
   scratch, and write to S3: both raw model responses, page/page-render hashes
   or durable references, model/prompt identifiers, concordance result, and a
   success-or-refusal receipt. This follows the capture contract's separation:
   raw content and temporal manifest live on S3, not on an operator machine
   (`docs/spec/SPEC_CAPTURE_ON_CLUSTER.md:150-161, 163-189, 409-411`).
3. The prompt/output schema must seek a **verbatim nomenclature statement**
   that explicitly associates each actually-served code/prefix with one of the
   five categories. It must emit `null` for public, mixed, absent, ambiguous,
   or contradictory cases; never infer dominance from permitted-use marks.
4. Require two separately persisted reads and equality on the verbatim
   code/prefix, category label, and source page. A divergence, unreadable
   legend, or code not represented in the legend is a refusal/null—not a
   fallback to a category. The selected mapping must be checked against the
   served Dundee code distribution before a config is written.
5. Add contract/unit tests for: missing or mismatched capture identity;
   cross-lane reference rejection; empty/ambiguous/mixed legend; divergent
   reads; and an apparently plausible permitted-use matrix that yields no
   dominance map. Only a validated, cited result may become
   `acquisition/config/usage-dominant-map/dundee.json`, then the existing fold
   may run.

## Rejected assumptions

- “Raster PDF” does not mean “a dominance legend exists” (the study correctly
  says this); no map can be predeclared.
- A `CapturedNormesReference` cannot be synthesized from a CAS key alone.
- The existing norms Mistral job cannot be renamed or fed Dundee as a shortcut.
- Two OCR/vision answers, even if textually concordant, do not convert a
  permitted-use table into a zone's dominant use.
- No local PDF/image rendering, OCR test, or model call is admissible.
