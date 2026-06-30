# NORMES BUILD-NOUVEAUX — discovery + extraction parquet-only

Date: 2026-06-30  
Branch: `feat/cadre-acquisition`  
Scope: normes `to-research`, villes absent from live `qc-zonage-norms-<slug>.parquet`, strict anti-invention, no manifest merge, no `coverage-matrix.json` write.

## Resultat court

- **Villes to-research lues**: 692.
- **Discovery HTTP route-guessing**: **233 villes crawlables** (`ALL_PV_CITIES`, absent live parquet) crawled with `grille-discovery-run.ts --download --route-guess --2hop --no-robots`.
- **Discovery JS-wall obscura**: **24 villes rendues** with `normes-obscura-run.ts --download` on the known CMS/gestionweblex residual set.
- **Safety-net manifests preserved locally**: **78 prior burst candidates** filtered against live S3 + spatial data; 0 new eligible.
- **New grilles deposited parquet-only**: **2 villes**:
  - `rosemere`
  - `sainte-clotilde`
- **Live normes parquet count**: **409 -> 411** prefixed `qc-zonage-norms-*.parquet` (+2).
- **Manifest**: not written. Dry merge sees the two new parquets and `dropped=0`.

## Discovery numbers

Static HTTP pass:

| Metric | Count |
|---|---:|
| Crawlable to-research villes attempted | 233 |
| Manifest entries emitted | 15 |
| Confirmed candidate PDF downloads evaluated | 87 |
| Static candidates passing live S3+spatial+real-grille filter before extraction | 4 |

The 4 static extraction candidates were `rosemere`, `pierreville`, `sainte-clotilde`, `saint-guillaume`.

JS-wall obscura rerun:

| Metric | Count |
|---|---:|
| JS-wall villes rendered | 24 |
| Rendered villes with candidate links | 17 |
| PDFs written to scratch manifest | 9 |
| New candidates passing live S3+spatial+real-grille filter | 0 |

The only fresh rendered PDF not already in S3 was `saint-sebastien--le-granit`, but it has no spatial grid, so it was rejected by this task's gate.

## Extraction and gates

Primary engine: GPT-5.5 vision through `codex exec -m gpt-5.5`, mapping output through the frozen `buildVisionField` / `ZoneNorms` guard.  
Fallback engine: `mistral-ocr-4-0` through `zonage-norms-reocr-keepbest.ts --residue --apply --no-manifest`, with `--min-gridless-pub 999999` so gridless deposits cannot pass.

Deposit gate used here:

- at least 3 distinct extracted zone codes;
- live spatial data present;
- SIG overlap at least 3;
- parquet-only deposit (`depositParquetOnly`, no manifest write).

GPT-5.5 results:

| Ville | Selected pages | Distinct codes | SIG overlap | Decision |
|---|---:|---:|---:|---|
| `rosemere` | 6 | 7 | 7/102 | **DEPOSITED** |
| `pierreville` | 1 | 0 | 0/63 | rejected |
| `sainte-clotilde` | 6 | 30 | 30/76 | **DEPOSITED** |
| `saint-guillaume` | 2 | 0 | 0/56 | rejected |

Mistral fallback results:

| Ville | Pages OCR | Distinct codes | SIG overlap | Decision |
|---|---:|---:|---:|---|
| `pierreville` | 1 | 0 | 0 | rejected below 3-code gate |
| `saint-guillaume` | 2 | 0 | 0 | rejected below 3-code gate |

## Deposit verification

Verified after deposit by reading S3 parquet rows back and re-running spatial cross-validation:

| Ville | Parquet rows | Distinct codes | Spatial data | SIG overlap | Pass |
|---|---:|---:|:--:|---:|:--:|
| `rosemere` | 7 | 7 | yes | 7 | yes |
| `sainte-clotilde` | 30 | 30 | yes | 30 | yes |

Pre-deposit live S3 checks showed `parquetExists=false` for both `rosemere` and `sainte-clotilde`; post-deposit checks show `parquetExists=true`.

Dry manifest merge (not applied):

```json
{
  "manifestBefore": 409,
  "parquetSlugs": 412,
  "newParquetSlugs": 3,
  "reconstructed": 2,
  "addedToManifest": 2,
  "droppedStock": [],
  "failed": ["registry"],
  "addedSlugs": ["rosemere", "sainte-clotilde"]
}
```

`failed=["registry"]` is the existing merge-tool quirk around the non-standard `registry/...` key shape; the two new standard parquets reconstruct cleanly. I did not run `--apply`.

## Candidate-limited characterization

This pass confirms the prior plateau. The residue is **candidate-limited**, not compute-limited:

- 233 static HTTP crawls produced only 15 manifest entries, and only 4 had both real-grille classification and spatial data.
- 24 JS-wall renders produced 9 PDFs, but 0 new eligible deposits after excluding existing parquets, non-grilles, unknown routes, and no-spatial candidates.
- The main rejection classes were: no grille link, zoning plans/maps, tariff grids, legal amendment/reglement PDFs without norms tables, 404/download failures, and real grilles with no spatial grid for this task's stricter gate.

No zone code or norm value was fabricated. Anything not verbatim-read and spatially validated was rejected.

## Git end state

Commit/push was attempted but blocked by the sandboxed git directory:

```text
fatal: Unable to create '/home/antoinefa/src/geo/.git/index.lock': Read-only file system
```

Exact command to finish once the branch/index lock is writable:

```bash
git add -f work/delegation-mass/NORMES-BUILD-NOUVEAUX.md
git commit --only work/delegation-mass/NORMES-BUILD-NOUVEAUX.md -m "docs(normes): report build nouveaux discovery"
git push origin feat/cadre-acquisition
```
