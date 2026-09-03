# §9 CPTAQ serve — deployability gates (REX)

The stage-2 serve Job (`cptaq-serve-job.yaml`, rendered by `render-cptaq-serve.ts`) runs the
ratified cptaq-runner in the geo-api image against a proof-bound raw capture, publishing the 4
Phase-1 collections under `normalized/ca-qc-constraints/`. Two deployability gates were learned
the hard way — **"merged ≠ deployable"** — and are now enforced so they don't recur.

## Gate 1 — the manifest is valid k8s (CI, client-side)

A Job's pod template gets an auto-injected `batch.kubernetes.io/job-name` label equal to
`metadata.name`, and a label VALUE is capped at 63 chars. The render bounds the name to
`cptaq-serve-<12hex sha256(runStamp)>` (full run identity kept in the `geo.sentropic/run-id`
annotation); `acquisition/src/lib/cptaq-serve-render.test.ts` asserts `name`/labels ≤63 on the
real long runStamp. *(A long runStamp in the name overflowed the pod label → server-side apply
rejected the Job.)*

## Gate 2 — the runner works in the TARGET IMAGE (in-image smoke, before deployable)

**CI and `kubectl apply --dry-run=server` do NOT see the image's toolchain version.** A CRS read
using `ogrinfo -json` (a GDAL 3.7+ option) was green in CI but failed at runtime on the image's
GDAL 3.6.2 (`Unknown option name '-json'`). Two defences:

- **Code (version-robust)** — `inspectLayerSourceCrs` parses `ogrinfo -ro -so` TEXT (no `-json`),
  tolerant of WKT1/WKT2, so it works on GDAL <3.7 AND ≥3.7. Tested against the **REAL** image
  ogrinfo output (`packages/geo/src/acquire/gdal.test.ts`, fixture captured from a GDAL 3.6.2
  in-image pod-probe — not an invented shape).
- **SMOKE gate (mandatory before deployable)** — run the runner against a sample raw **INSIDE the
  target image** (a k8s pod-probe) before declaring the serve deployable. The unit test cannot see
  the image's GDAL version; only an in-image smoke can. **This is the coverage that was missing**
  (the root cause of "green in CI / broken in image").

## Runtime flow (k8s)

`render-cptaq-serve.ts` → `kubectl apply --dry-run=server` → **in-image smoke** → `apply` → watch →
4 collections `normalized/ca-qc-constraints/…` → i-infra prod-pristine + geo-zones OGC verify
(0 phantom `_snapshots`, `.meta` CC-BY, real count) **before any announced count**.
