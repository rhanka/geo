# zones-longshot-A-20260709T174537Z

Lane A selector: `zones.status != done`, PDF candidate track present, `index % 2 == 0`.

## Counts

- Initial reconcile: `pv=1050`, `normes=560`, `zones=769`, `cadastre=1106`, `role-foncier=1106`, `tod=39`.
- Final reconcile: `pv=1051`, `normes=561`, `zones=770`, `cadastre=1106`, `role-foncier=1106`, `tod=39`.
- Lane A zones delta: `+1` (`saint-damien`). Initial reconcile had `zones (+0)`, so no already-served-but-unreconciled S3 zone candidate was found at start.

The `pv`/`normes` before/after movement came from S3 reconciliation outside this zones deposit. This lane only deposited a zones collection.

## Success

### saint-damien

- Source PDF: `https://www.st-damien.com/uploads/8/0/4/0/80408348/753_-_zonage_-_final_-_conformit%C3%A9_mrc__plan_de_zonage_.pdf`
- Method: T2 auto-GCP, affine, moderate-anisotropy lot-coverage arbitration.
- S3: `normalized/ca-qc-zonage/qc-zonage-saint-damien.geojson`
- Gates: 47 independent GCPs, 0 bbox-derived; residual max `25.90 m`, RMS `7.083 m`; holdout max `27.768 m`.
- Arbitration: `SERVE`, density/rot0, serving coverage `90.48%` >= `85%`, 97 distinct text codes.
- Build: 61 zone features, 2928/3236 lots assigned (`90.48%`), area covered `84.16%`, 93/98 labels inside cadastre bbox, label centroid distance `3.004 km`.
- Downstream: `lot-zone-join-run` OK, 3236 rows, assigned `90.51%`, parquet/stats verified; `lots-enriched-run` OK, zone_code `90.51%`, surface `100%`, code_postal `100%`, adresse `98.86%`.
- Warning: norms match `0%`; no matching norms for the served codes.

## Rejected / skipped

- `saint-zotique`: T1 no embedded georef; T2 had 0 labels/codes and 0% serving coverage.
- `sainte-marcelline-de-kildare`: source PDF parser/catalog invalid for T1; no deposit.
- `saint-telesphore`: T1 no embedded georef.
- `roxton-falls`: T1 georef existed, but extracted labels were amendment dates (`sept.2005`, `jan.2007`, etc.), not zone codes. Rejected manually despite dry-run mechanics.
- `bolton-ouest`: T1 no embedded georef.
- `lac-superieur`: T1 no embedded georef; T2 affine failed safe anisotropy/orientation gates; similarity fallback cleared no seed.
- `stanstead--memphremagog--2`: T1 no embedded georef; T2 affine had extreme anisotropy; similarity fallback produced no surviving independent matches.
- `mayo`: T1 no embedded georef.
- `peribonka`: T1 GeoPDF georef passed (residual `0.17 m`) but text labels yielded 0 code-like labels; no authoritative dict found for glyph/vision path.
- `sainte-monique--lac-saint-jean-est`: T1 no embedded georef; T2 had `svg_points=0`.
- `petit-saguenay`: T1 no embedded georef; T2 SVG extraction hit `ERR_STRING_TOO_LONG`.

## Commands

Exact command list is in `work/delegation-mass/zones-longshot-A-20260709T174537Z.json`.

Key publish commands:

```sh
npx tsx src/t2-autogcp.ts --slug saint-damien --auto-seed --pdf /tmp/saint-damien-plan.pdf --out-gcp /tmp/saint-damien.longshotA.gcp.json --report /tmp/saint-damien.longshotA.autogcp.report.json --max-residual-m 30 --min-gcps 12 --rotation-disambig lots --aniso-lot-arbitrate
npx tsx src/t2-build.ts --slug saint-damien --gcp /tmp/saint-damien.longshotA.gcp.json --pdf /tmp/saint-damien-plan.pdf --require-independent-gcps --max-residual-m 30 --source t2-auto-seed-aniso-lot-arbitrate --confidence contour-auto-gcp
npx tsx src/lot-zone-join-run.ts --slugs saint-damien
npx tsx src/lots-enriched-run.ts --slugs saint-damien
npx tsx src/coverage-reconcile.ts
```
