# Saint-Raphaël (MRC Bellechasse) — grille des spécifications (provenance)

Ré-extraction de la grille de normes de zonage **en vigueur** (l'ancien parquet
servait des codes numériques `1033..1550` + fragments CPTAQ « ÉLEVAGE / TYPE A/B/C »
= mauvaise table OCR'd → strict zone∩grille 4.69 %, real_zoning=false).

## Source de record
- Règlement : **Règlement de zonage no 2022-228** — Municipalité de Saint-Raphaël (en vigueur ; le projet 2026-244 n'est qu'un 1er projet, NON en vigueur).
- URL : https://www.saint-raphael.ca/fichiersUpload/fichiers/20251006101542-reglement-zonage-2022-228.pdf (191 p.)
- Grille : **Annexe L « Grilles de spécification »**, PDF **pp. 128–191** (1 page/zone = 64 zones), codes Lettre-Num (HA, M, P, I, A, AF, F, V, CO, R, C).

## Extraction (rejouable)
```
npx tsx acquisition/src/zonage-norms-run.ts \
  --slug saint-raphael \
  --pdf work/zonage-norms/saint-raphael/grille.pdf \
  --source-url https://www.saint-raphael.ca/fichiersUpload/fichiers/20251006101542-reglement-zonage-2022-228.pdf \
  --reglement 2022-228 --route zoneheader --first-page 128 --last-page 191 --no-manifest
```
- Route `zoneheader` : natif-first ($0) via `parseLabelValueGrillePage`, 60/64 zones en natif, 4 pages en fallback vision Mistral (~$0.012).
- Cross-validation SIG : sig=64, extracted=64, **overlap 63/64 = 98.4 %**, real_zoning=true.
- Dépôt : `registry/qc-zonage-norms/qc-zonage-norms-saint-raphael.parquet` (64 zones, publishedFieldPct 36.1 % — le format grille ne porte pas frontage/superficie ; verbatim-or-null).

## Serving + fold
- `publish-norms-grilles.ts --slug saint-raphael --align-sig-code` → `normalized/qc-zonage-norms/qc-zonage-norms-saint-raphael.geojson` (geometry 98.44 %, norms 93.75 %, servi sous la chaîne SIG exacte `Ha-2`).
- Re-fold `focus-zone-pipeline.ts --slug saint-raphael` : lots=2637, zone_code=100 %, **norms 99.96 %** (av. 18.16 %).
- Géométrie SIG = MRC Bellechasse ArcGIS (64 zones), déjà en place — inchangée.
