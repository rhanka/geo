# CALAGE-C -- T2 3-GCP focus cities

Date: 2026-06-29  
Branch: `feat/cadre-acquisition`  
Scope: `saint-bruno-de-montarville`, `chateauguay`, `sainte-julie`  
Pipeline: committed T2 path only (`acquisition/src/t2-build.ts`, `acquisition/src/lib/t2-georef.ts`)  

Result: **0 served, 3 flagged**. No object was uploaded to
`normalized/ca-qc-zonage/` for these cities.

## saint-bruno-de-montarville

Status: **flagged, serve nothing**.

Official PDF fetched:
`https://saintbruno-site.s3.ca-central-1.amazonaws.com/wp-content/uploads/2026/04/annexe-a-plan-de-zonage-30-04-2026-2.pdf`

GCP method used:
- Printed coordinate grid: none found. The PDF text has no 5-7 digit coordinate ticks.
- Scale bar exists, but no unambiguous labelled landmark coordinate was available.
- Used visible municipal-boundary extremities matched to official cadastre hull points: north, east, south.

GCP file: `work/gcp/saint-bruno-de-montarville.gcp.json`

Residuals:
- GCP#1 north municipal-boundary tip: **0.00 m**
- GCP#2 east municipal-boundary tip: **0.00 m**
- GCP#3 south municipal-boundary tip: **0.00 m**
- Overall: **max 0.000 m, RMS 0.000 m** (`3` GCPs, exact affine by construction)

Pipeline dry-run numbers:
- Labels: `2532` words, `21` code-like, `20` in-frame, `18` distinct pipeline codes.
- Served-diagnostic features: `14`; lots assigned `6694 / 10261 = 65.24%`; area covered `60.23%`.
- Centroid-in-muni check: label centroid is `0.823 km` from cadastre centroid; `18 / 20` labels inside cadastre bbox.

Flag reason:
The committed text extractor does not recover the real Saint-Bruno zone labels. The accepted tokens are fragmented glyph/text artifacts such as `a1`, `a2`, `a3`, `c1`, `c3`, `h4`, `h9`, `m3`, plus a few partial uppercase tokens (`A14`, `A17`, `V18`). These are not a trustworthy verbatim regulatory zone-code set. Serving would violate the anti-invention code gate even though the spatial gate is numerically inside the municipality.

## chateauguay

Status: **flagged, serve nothing**.

Official PDF fetched:
`https://ville.chateauguay.qc.ca/wp-content/uploads/2026/06/Annexe-A-Plan-de-zonage-2026.06.02.pdf`

GCP method used:
- Printed coordinate grid: none found. Only `04068` appears as the plan number, not a coordinate tick.
- Scale bars exist, but the plan is split into a main frame plus a displaced inset.
- Used the existing main-frame diagnostic cadastre-extent GCP seed, updated to the official PDF URL. This is not a serve-grade full-city transform because a single affine cannot register both the main frame and the separate inset.

GCP file: `work/gcp/chateauguay.gcp.json`

Residuals:
- GCP#1 diagnostic main-frame NW: **0.00 m**
- GCP#2 diagnostic main-frame NE: **0.00 m**
- GCP#3 diagnostic main-frame SW: **0.00 m**
- GCP#4 diagnostic main-frame SE: **0.00 m**
- Overall: **max 0.000 m, RMS 0.000 m** (`4` rectangular extent GCPs, exact by construction)

Pipeline dry-run numbers:
- Labels: `3465` words, `384` code-like, `333` in-frame, `329` distinct pipeline codes.
- Served-diagnostic features: `130`; lots assigned `17959 / 18765 = 95.70%`; area covered `92.03%`.
- Empty labels: `203`, indicating many extracted labels do not produce geometry under the main-frame calibration.
- Centroid-in-muni check: label centroid is `1.929 km` from cadastre centroid; `332 / 333` labels inside cadastre bbox.

Flag reason:
The plan layout needs more than one georeferencing transform: the inset is displaced from the main plan. The dry run also includes non-zoning false positives such as `A08`, `C38`, `N605`, `R7`, `R709`, `R726` alongside real-looking codes. Because the committed T2 pipeline supports one affine/neatline and one label pass, serving this output would mix valid codes with inset/false-positive artifacts. No S3 serve.

## sainte-julie

Status: **flagged, serve nothing**.

Official PDF fetched:
`https://www.ville.sainte-julie.qc.ca/uploads/html_content/Reglementation/2023-01-27_-_Plan_de_zonage_-_R.pdf`

GCP method used:
- Printed coordinate grid: none found. The many numeric labels are lot/address labels, not coordinate ticks.
- Scale bar exists, but no unambiguous labelled landmark coordinate was available.
- Tried visible main-frame municipal/cadastre extent points (north, west, east, south). The plan includes a separate overview/inset, and the four points do not fit a single affine.

GCP file: `work/gcp/sainte-julie.gcp.json`

Residuals from the normal residual gate run:
- GCP#1 north visible plan edge near `I-350`: **1417.99 m**
- GCP#2 west municipal-boundary edge: **1403.85 m**
- GCP#3 east municipal-boundary edge: **688.70 m**
- GCP#4 south highway-corridor edge: **674.56 m**
- Overall: **max 1417.986 m, RMS 1108.016 m**

Pipeline gate:
- Normal run aborts at residual: **1417.99 m > 50 m**.
- Diagnostic relaxed run only (`--max-residual-m 2000`, dry-run, not serveable) measured `11911` words, `227` code-like labels, `227` in-frame labels, `183` distinct pipeline codes, `99` diagnostic features, and `107` empty labels.
- Centroid-in-muni check from the relaxed diagnostic run: label centroid is `2.695 km` from cadastre centroid; `171 / 227` labels inside cadastre bbox.

Flag reason:
Hard residual gate failure. The residual is roughly **28x** the allowed `50 m` maximum, so this is a definitive reject before serving. The relaxed run also shows malformed false positives (`C1791`, `H2004`, `M1998`, `r2405`, etc.), confirming that the output is not safe to publish from this GCP set.

## Final serving decision

No city in this batch passed all gates. I did not upload any `qc-zonage-<slug>` object and did not ping immo, because there are no served cities to announce.
