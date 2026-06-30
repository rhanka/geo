# GCP3-UI-CODEX -- T2 3-GCP zoning georeference tool

Agent: `gcp3-ui-codex` (Codex 5.5)  
Branch: `feat/cadre-acquisition`  
Date: 2026-06-29  
Scope: TS-only 3-GCP georeference path for the 16 focus-city zoning PDFs with no embedded GeoPDF anchor.

## 0. Status

- Tool built in TypeScript only: CLI + local browser UI + shared T1 serving helpers.
- Demo served: `saint-philippe` via `s3://sentropic-geo/normalized/ca-qc-zonage/qc-zonage-saint-philippe.geojson`.
- Commit hash: **blocked in this Codex sandbox**. `git commit` failed with `.git/index.lock: Read-only file system`; the implementation is staged and ready for a normal commit when `.git` is writable.
- Intended implementation commit:

```bash
git commit -m "feat(zonage): add T2 3-GCP georef pipeline" \
  -m "Co-Authored-By: Codex <codex@openai.com>"
```

- Push status: blocked by the same git-metadata write restriction. `work/coverage/coverage-matrix.json` was not modified.

## 1. Tool Built

### Files

| File | Purpose |
|---|---|
| `acquisition/src/lib/t2-georef.ts` | Manual `>=3` GCP affine page-to-WGS84 georef. Reuses `fitAffine` from `t1-georef.ts`; supports optional input CRS via `proj4`. |
| `acquisition/src/t2-build.ts` | Robust CLI: GCP JSON + PDF + cadastre -> labels -> T1 cadastre line-of-sight -> `qc-zonage-<slug>`. |
| `acquisition/src/t2-georef-ui.ts` | Local UI: rasterized PDF pane + Leaflet basemap + cadastre bbox + click PDF/map GCP capture + preview + local/S3 serve. |
| `acquisition/src/lib/zone-serve.ts` | Shared T1/T2 `haversineKm`, `bboxCenter`, and `mergeByZoneCode` serving contract. |
| `acquisition/src/lib/t2-labels-ocr.ts` | Experimental positioned OCR label path for glyph PDFs. S3 serving requires explicit human OCR review. |
| `acquisition/src/lib/t2-georef.test.ts` | Unit tests for 3-GCP affine fit, top-left conversion, noisy least-squares, and degenerate GCP rejection. |
| `work/gcp/saint-philippe.gcp.json` | Demo GCP file documenting the Saint-Philippe calibration. |

Small T1 changes:

- `acquisition/src/lib/t1-georef.ts`: exports `fitAffine` for reuse.
- `acquisition/src/lib/t1-labels.ts`: adds optional single-page extraction for T2 multi-page PDFs.
- `acquisition/src/t1-build.ts`: uses shared serving helpers; preserves existing T1 behavior.

### Anti-Invention Gates

- Fails on `<3` GCPs or near-collinear GCPs.
- Fails when calibration residual exceeds `--max-residual-m` (default 50 m).
- Requires at least `max(3, --min-codes)` distinct lettered zone codes.
- Rejects non-lettered sequential codes and affectation/CMM-style tokens.
- Requires label centroid within `--spatial-km` of cadastre centroid (default 8 km).
- Geometry is only real cadastral lots from `normalized/qc-cadastre-lots/<slug>.geojson`.
- Text label path uses verbatim selectable PDF text via `pdftotext -bbox-layout`.
- OCR label path is preview-capable but cannot upload to S3 unless `--ocr-reviewed` is passed after human code QA.

## 2. How To Run

### CLI

From `acquisition/`:

```bash
TMPDIR=/tmp npx tsx src/t2-build.ts \
  --slug <slug> \
  --gcp ../work/gcp/<slug>.gcp.json \
  --dry-run \
  --out /tmp/t2-<slug>-check \
  --labels text
```

If the dry run passes and visual QA is acceptable:

```bash
TMPDIR=/tmp npx tsx src/t2-build.ts \
  --slug <slug> \
  --gcp ../work/gcp/<slug>.gcp.json \
  --out ../work/t2-out-<slug> \
  --labels text
```

For glyph/OCR PDFs, use preview first:

```bash
TMPDIR=/tmp npx tsx src/t2-build.ts \
  --slug <slug> \
  --gcp ../work/gcp/<slug>.gcp.json \
  --dry-run \
  --out /tmp/t2-<slug>-ocr-check \
  --labels ocr
```

Only after a human has checked the OCR code list against the plan:

```bash
TMPDIR=/tmp npx tsx src/t2-build.ts \
  --slug <slug> \
  --gcp ../work/gcp/<slug>.gcp.json \
  --out ../work/t2-out-<slug> \
  --labels ocr \
  --ocr-reviewed
```

### Local UI

From `acquisition/`:

```bash
TMPDIR=/tmp npx tsx src/t2-georef-ui.ts --port 8088
```

Use `--allow-s3` only when the operator is ready to publish passing results:

```bash
TMPDIR=/tmp npx tsx src/t2-georef-ui.ts --port 8088 --allow-s3
```

The UI flow is:

1. Pick a city and verify or paste the official zoning PDF URL/path.
2. Load the PDF; the left pane shows a rasterized plan, the right pane shows the basemap/cadastre area.
3. Click the same recognizable point on the PDF and map for three spread-out GCPs.
4. Click `Calculer + Apercu`.
5. Check residuals, label count, served feature count, lot coverage, and the map overlay.
6. Save the GCP JSON.
7. Serve local first; use S3 only when gates pass and the overlay/code list is credible.

### GCP JSON Format

```json
{
  "slug": "saint-philippe",
  "pdf": "/tmp/stphilippe.pdf",
  "page": 1,
  "pageW": 2384,
  "pageH": 3370,
  "gcps": [
    { "fx": 0.387, "fy": 0.080, "lon": -73.462, "lat": 45.3934, "note": "north tip" },
    { "fx": 0.213, "fy": 0.598, "lon": -73.5214, "lat": 45.313, "note": "west/southwest bend" },
    { "fx": 0.808, "fy": 0.310, "lon": -73.3892, "lat": 45.349, "note": "east tip" }
  ],
  "neatline": { "fx0": 0.02, "fy0": 0.02, "fx1": 0.98, "fy1": 0.75 }
}
```

`fx` is left-to-right page fraction. `fy` is top-to-bottom page fraction. `neatline` clips legends/titles so off-frame labels do not drive cadastre assignment.

## 3. Per-City Human Recipe

| City | Label path | Starting recipe |
|---|---|---|
| `saint-constant` | text | Use UI seed URL, page 1. Pick three municipal-boundary/cadastre corner points around the main map. Run CLI with `--labels text`; serve only if `>=10` codes and spatial gate pass. |
| `saint-philippe` | text | Demo GCP exists in `work/gcp/saint-philippe.gcp.json`. Re-run CLI text path for regression or adjust GCPs in UI if a newer PDF is used. |
| `carignan` | text | Use UI seed URL. Watch insets and title/legend content; set a tight `neatline` around the main map before serving. |
| `brossard` | glyph | UI seed URL exists. Use OCR only for preview, then human-check the OCR code list against the plan before `--ocr-reviewed`. |
| `varennes` | glyph | Paste the current official zoning plan PDF. Use three boundary/cadastre points, OCR preview, and human code QA before any S3 serve. |
| `saint-basile-le-grand` | glyph | Same glyph recipe: UI pick, OCR preview, human code QA, then `--ocr-reviewed` only if code fidelity is credible. |
| `mont-royal` | glyph | Same glyph recipe. Prefer more than 3 GCPs if the plan has local distortion; residual then becomes a useful error signal. |
| `dollard-des-ormeaux` | glyph | Same glyph recipe. Do not serve OCR noise that merely matches the regex. |
| `kirkland` | glyph | Same glyph recipe. Use official plan PDF and save GCP JSON before any serve. |
| `saint-lambert` | unknown | Paste current official zoning plan PDF. Try `--labels text`; if text yield is low, switch to OCR preview and human code QA. |
| `boucherville` | unknown | Paste current official zoning plan PDF. Use UI + dry-run first; publish only on passing gates. |
| `saint-bruno-de-montarville` | unknown | Paste current official zoning plan PDF. Multi-page plans should set `page` explicitly. |
| `chateauguay` | unknown | UI seed URL exists. Try text path first; if plan labels are raster/glyphs, use OCR preview and review. |
| `montreal-ouest` | unknown | UI seed URL exists. Use tight neatline; small municipality means spatial gate should be strict. |
| `montreal-est` | unknown | No trusted plan seed committed. Paste the current official zoning plan PDF; do not use specification-grid PDFs as the map source. |
| `sainte-julie` | unknown | UI seed URL exists. If multiple pages/revisions are present, use the page containing the zoning plan and set `page` in the GCP JSON. |

## 4. Demo: Saint-Philippe End-To-End

Why Saint-Philippe: it is one of the 16 T2 cities, has a clean one-page vector zoning plan with selectable text labels, and avoids inset-map ambiguity for the first proof.

PDF used: `/tmp/stphilippe.pdf` in this sandbox, matching the seeded official URL:

```text
https://ville.saintphilippe.quebec/wp-content/uploads/2026/06/zonag-501-33-36x365000-1.pdf
```

GCPs used:

| # | PDF fraction `(fx, fy)` | WGS84 `(lon, lat)` | Landmark |
|---:|---|---|---|
| 1 | `(0.387, 0.080)` | `(-73.4620, 45.3934)` | north tip of municipal outline |
| 2 | `(0.213, 0.598)` | `(-73.5214, 45.3130)` | west/southwest boundary bend |
| 3 | `(0.808, 0.310)` | `(-73.3892, 45.3490)` | east boundary tip |

With exactly 3 GCPs, affine calibration residual is mathematically 0.00 m at the control points. Quality therefore depends on point choice plus downstream spatial/coverage gates.

Command:

```bash
cd /home/antoinefa/src/geo/acquisition
TMPDIR=/tmp npx tsx src/t2-build.ts \
  --slug saint-philippe \
  --gcp ../work/gcp/saint-philippe.gcp.json \
  --out ../work/t2-demo-saint-philippe \
  --min-codes 10 \
  --spatial-km 8
```

Served output:

```text
s3://sentropic-geo/normalized/ca-qc-zonage/qc-zonage-saint-philippe.geojson
s3://sentropic-geo/normalized/ca-qc-zonage/qc-zonage-saint-philippe.stats.json
```

Hard numbers from S3 readback:

| Metric | Result |
|---|---:|
| PDF words | 445 |
| code-like words | 129 |
| labels in neatline | 103 |
| distinct label codes | 102 |
| served features | 81 |
| served distinct codes | 81 |
| missing geometry | 0 |
| lots assigned | 5069 / 5202 |
| lot-to-zone | 97.44% |
| area covered | 54.3072 / 61.8253 km2 = 87.84% |
| spatial gate | 3.097 km label centroid to cadastre centroid, pass under 8 km |
| labels inside cadastre bbox | 103 / 103 |
| empty labels | 22 |
| cutoff | 1500 m |
| source/confidence | `t2-gcp3` / `contour-manual-gcp` |
| S3 GeoJSON bytes | 1,586,135 |

Sample verbatim served zone codes: `I-04`, `P-42`, `H-46`, `H-45`, `H-01`, `P-08`, `H-40`, `H-05`, `H-28`, `C-301`, `AH-311`, `A-303`.

Quality flag: **PASS for serving contract**. The output is real cadastre geometry and verbatim selectable PDF labels. Residual is not an independent quality estimate with only 3 GCPs; use more than 3 GCPs for hard residual QA on future cities.

API endpoint was not verified from this sandbox because public DNS resolution failed, but S3 normalized readback passed.

## 5. Claude 4.8 vs Codex 5.5 Method Comparison

| City/method | Features | Codes | Lot-to-zone | Georef quality | Notes |
|---|---:|---:|---:|---:|---|
| Claude 4.8 `delson` auto-T1 | 97 | 101 labels | 3330/3330 = 100% | embedded GPTS residual 0.29 m, spatial 0.37 km | No human GCPs; true GeoPDF. |
| Claude 4.8 `candiac` auto-T1 | 218 | 229 labels | 7725/7725 = 100% | embedded GPTS residual 0.29 m, spatial 0.93 km | No human GCPs; selectable text in chosen PDF. |
| Codex 5.5 `saint-philippe` T2 GCP | 81 | 102 label codes, 81 served | 5069/5202 = 97.44% | manual 3-GCP affine; spatial 3.097 km | Human supplies registration; downstream T1 pipeline unchanged. |

Method difference:

- Claude auto-T1 is stronger when embedded GeoPDF `/GPTS` exists: no human input, measurable embedded residual, and near-zero registration ambiguity.
- Codex T2 replaces only the georef source: human GCP affine instead of embedded GPTS. Labels, cadastre nearest-label assignment, dissolve, stats, and S3 serving contract are the same T1 path.
- For clean selectable-text T2 PDFs, Codex can carry this work at practical parity: the Saint-Philippe output passes the same anti-invention gates and reaches 97.44% lot coverage.
- Quality is not identical to true T1: manual GCP picks and neatline choice become operator-controlled. More than 3 GCPs is recommended for serious QA because the least-squares residual then detects bad picks.
- For glyph/raster labels, quality parity is not automatic. OCR is explicitly gated behind human code review before S3 because regex-valid OCR noise is still fabricated data.

Verdict: **Codex can carry the 16-city T2 work for clean text PDFs now**. It can also provide an operator workflow for glyph PDFs, but those should be treated as human-reviewed OCR/manual-label jobs rather than auto-serves.

## 6. Verification

Commands run:

```bash
cd /home/antoinefa/src/geo/acquisition
npm test -- --run src/lib/t2-georef.test.ts
npm run typecheck -- --pretty false
TMPDIR=/tmp npx tsx src/t2-build.ts --slug saint-philippe --gcp ../work/gcp/saint-philippe.gcp.json --dry-run --out /tmp/t2-demo-saint-philippe-check --min-codes 10 --spatial-km 8
```

Results:

- `src/lib/t2-georef.test.ts`: 4/4 passing.
- Saint-Philippe dry run: passing, same numbers as served output.
- S3 readback: 81 features, 81 distinct served codes, 0 missing geometry.
- Full repo typecheck still fails on three pre-existing out-of-scope errors:
  - `src/check-manifest.ts(5,31)` Buffer passed where string expected.
  - `src/recense-ville.ts(29,8)` missing `../../packages/geo/dist/catalog/recense-platform.js`.
  - `src/recompose-zones-pdf-svg.ts(402,22)` nullable tuple passed where `[number, number]` required.

## 7. Remaining Operational Notes

- Public HTTP/DNS was blocked in this sandbox for some URLs; local cached PDFs and S3 access were sufficient for the demo. Operators should verify official PDF URLs in a normal networked session.
- The UI uses Leaflet/OSM tiles in the browser. Offline use still works for CLI if GCP coordinates and the PDF file are already available.
- The two pre-existing untracked files `acquisition/src/lib/t1-labels-ocr.ts` and `acquisition/src/t1-ocr-build.ts` were not included in this scoped work.
- `work/coverage/coverage-matrix.json` was not touched.
