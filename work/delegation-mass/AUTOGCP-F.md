# AUTOGCP-F

Date: 2026-06-29

Served: carignan -> {zones: 142, residual_m: 11.883} (real-GCP served)
Served: brossard -> {zones: 306, residual_m: 10.791} (real-GCP served)

Flagged: varennes -> needs_human_gcp=true, reason: no-match; independent GCP gate passed (48 GCPs, residual_m 9.612, holdout_m 10.299) but the fixed text parser found 0 words / 0 clean zone codes on the PDF page, so nothing was served.
Flagged: saint-basile-le-grand -> needs_human_gcp=true, reason: no-match; independent GCP gate passed (34 GCPs, residual_m 5.924, holdout_m 3.662) but the fixed text parser found 0 in-frame clean zone codes (31 code-like tokens were outside the map frame / title-table style), so nothing was served.

Verification:
- carignan: holdout_m 12.942, label_codes 193, clean_compound_codes 142, spatial_km 1.353, readback source/confidence ok.
- brossard: holdout_m 10.328, label_codes 326, clean_compound_codes 305, spatial_km 1.555, readback source/confidence ok.
- varennes: holdout_m 10.299, parser gate failed, served nothing.
- saint-basile-le-grand: holdout_m 3.662, parser gate failed, served nothing.
- tests: `TMPDIR=/tmp npx vitest run src/lib/t1-labels.test.ts src/lib/t2-georef.test.ts` -> 9 passed.

Git: pending commit/push.
Immo ping: h2a envelope env:1782787941301:51c8 deposited to `claude:radar-immobilier:d42eb6516bcf` for carignan,brossard; recipientLive=false.
