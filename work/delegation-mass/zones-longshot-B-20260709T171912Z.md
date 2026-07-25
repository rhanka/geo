# zones-longshot-B-20260709T171912Z

Branch: `feat/cadre-acquisition`

Lane B constraint: `zones.status != done`, candidate track in
`pdf-georef-t1/pdf-vectorize-t2/pdf-raster-t3/pdf-scan-t4/pdf-discovery-required`,
and coverage-matrix index `% 2 == 1`.

## Counts

- Lane-B eligible candidates: 173.
- Lane-B with MAMH code for vector probes: 170.
- Lane-B with official-page crawler config: 74.
- Matrix `zones.status=done` before local work: 769.
- Matrix `zones.status=done` after local work: 770.
- S3 `normalized/ca-qc-zonage` before: 729.
- S3 `normalized/ca-qc-zonage` after: 730.
- Own successful zone deposits: 0.
- Own net delta: 0.

The matrix and S3 totals each showed +1 by the end of this run, but not from this
lane: both attempted slugs (`rougemont`, `acton-vale`) remained absent in the final
S3 check, and every lane command either used `--no-deposit` or aborted/withheld
before upload.

## Probes

- Geocentralis WFS: 170 lane-B MAMH pairs probed, 170 `no-features`, 0 deposits.
  Report: `work/delegation-mass/zones-longshot-B-20260709T171912Z.wfs-probe.json`.
- Geocentriq: `kipawa` only. Rejected `zone` values as usage/class labels
  (`F`, `Ra`, `Rv`, etc.), not real zone codes. 0 deposits.
  Report: `work/delegation-mass/zones-longshot-B-20260709T171912Z.geocentriq-probe.json`.
- Official PDF discovery over the 74 PV-configured lane-B slugs was interrupted
  after the useful window. Observed candidates: `rougemont` and `acton-vale` sheets.
  No deposit was made from discovery alone.

## Gate Results

### Rougemont

- Source: `https://rougemont.ca/wp-content/uploads/2026/05/Zonage_urbain_concordance_2018-242.pdf`
- Dictionary: `work/zonage-dicts/rougemont.codes.json`, exported from the deposited
  norms parquet; 75 real codes.
- Command: `t1-build --allow-numeric-codes`.
- Result: ABORT.
- Gate: numeric dictionary guard passed with 53 dict-validated numeric codes, but
  label centroid was 4540.8 km from cadastre under the embedded PDF transform.
  This is a hard spatial-georef mismatch; no upload.

### Acton-Vale

- Sources:
  - `https://ville.actonvale.qc.ca/wp-content/uploads/2026/02/Plan-de-zonage-1-de-2-Acton-Vale-02-2026.pdf`
  - `https://ville.actonvale.qc.ca/wp-content/uploads/2026/02/Plan-de-zonage-2-de-2-Acton-Vale-02-2026.pdf`
- Dictionary: `work/zonage-dicts/acton-vale.codes.json`, exported from the deposited
  norms parquet; 5 real numeric codes (`101`..`105`).
- Text labels: `pdftotext` returned no selectable text on both PDFs.
- Command: `t2-build-multisheet --labels text --allow-numeric-codes`.
- Result: WITHHELD.
- Gates:
  - Sheet 1: unresolved 180-degree orientation ambiguity.
  - Sheet 2: residual/holdout candidates existed, but none cleared orientation/isotropy.
- Report: `work/delegation-mass/zones-longshot-B-20260709T171912Z/acton-vale-t2ms-text/qc-zonage-acton-vale.stats.json`.

## Immo Follow-Up

No `lot-zone-join-run` or `lots-enriched-run` was run, because no zone acquisition
passed gates. This respects the "at every success" rule: there were no successes.

## Commands Run

See `work/delegation-mass/zones-longshot-B-20260709T171912Z.json` for the command list.

## Anti-Invention

No zone code or geometry was fabricated. Numeric dictionaries came from deposited
norms parquet files. Bad source gates were rejected, and no `.track` or `.claude`
files were edited by this lane.
