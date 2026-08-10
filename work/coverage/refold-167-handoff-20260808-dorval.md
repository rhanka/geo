# Handoff QA — lot `dorval` (refold-167)

- Date/heure UTC: `2026-08-08T12:16:20Z → 2026-08-08T12:17:05Z`
- Commande exécutée: `npx tsx acquisition/src/_lot-zone-refold-batch.ts --slugs dorval --max-seconds 1800 --simplify-zones-m 0 --out work/coverage/_refold-167-progress.json`
- Géométrie zonage: SERVIE (`qczonage` check OK)
- Résultat: `OK dorval` (deposited=true)
- Backup: `2026-08-08T121622154ZZ` via `_lot-zone-refold-s3.ts`
- Mirror: `flat-only`

## KPI lot (contrats)

- Col-12 (`code_zone`):
  - avant: `6174 / 6245`
  - après: `6174 / 6245`
  - gain: `0`
  - statut: `au-plafond` (pas de régression, pas de gain)
- Col-13 (`folded-normes`):
  - avant: `6109 / 6245`
  - après: `6109 / 6245`
  - gain: `0`
  - statut: `au-plafond`

## Classification de lot

- Type: lot déposé
- Bloqué amont: non
- Handoff QA: OK
- Escalade geo-zones: **non requise pour dorval**

## Artéfacts mis à jour

- `work/coverage/_refold-167-progress.json`
- Résumé automatique: `npx tsx acquisition/src/_refold-progress-summary.ts --journal work/coverage/_refold-167-progress.json`

## Prochaine municipalité cible distincte

- `farnham`

