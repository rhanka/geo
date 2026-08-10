# Handoff QA — lot `clarenceville...farnham` (refold-167 / loop-msjid8i2)

- Date/heure UTC: `2026-08-08T11:33:03Z → 2026-08-08T12:52:48Z`
- Commande exécutée: `npx tsx acquisition/src/_lot-zone-refold-batch.ts --slugs clarenceville,contrecoeur,cote-saint-luc,coteau-du-lac,crabtree,delson,deux-montagnes,dollard-des-ormeaux,dorval,farnham --out work/coverage/_refold-167-progress.json`
- Géométrie zonage: servie (`qc-zonage` check passé pour les lots traitables; les autres ont été bloquées par la logique d’exécution)
- Artéfacts mis à jour: `work/coverage/_refold-167-progress.json`

## KPI lot

- Col-12 (`code_zone`): gain réel du lot = `0 / 10` (`+0` assigné)
- Col-13 (`folded-normes`): gain réel du lot = `0 / 10` (`+0` normes pliées)
- `complete_final`: `0`
- Bloqués-amont: `0` (aucun `not-served` ou `geometry-suspect` dans ce lot)

## Détail municipalité (par lot traité)

| muni | colonne (avant → après) | statut lot | décision | worker |
|---|---|---|---|---|
| clarenceville | 12: 1546 → 1546 / 13: 0 → 0 | FOLD | foldé | codex |
| contrecoeur | 12: 4653 → 4653 / 13: 961 → 961 | FOLD | foldé | codex |
| cote-saint-luc | 12: 4890 → 4890 / 13: 3549 → 3549 | FOLD | foldé | codex |
| coteau-du-lac | 12: 3883 → 3883 / 13: 3228 → 3228 | FOLD | foldé | codex |
| crabtree | 12: 1830 → 1830 / 13: 625 → 625 | FOLD | foldé | codex |
| delson | 12: 3330 → 3330 / 13: 3315 → 3315 | FOLD | foldé | codex |
| deux-montagnes | 12: 6426 → 6426 / 13: 6374 → 6374 | FOLD | foldé | codex |
| dollard-des-ormeaux | 12: 12562 → 12559 (rollback à 12562) / 13: 1901 → 1901 | BLOC | bloqué-amont **(rollback suite régression code_zone)** | codex |
| dorval | 12: 6174 → 6174 / 13: 6109 → 6109 | FOLD | foldé | codex |
| farnham | 12: 4950 → 4950 / 13: 35 → 35 | FOLD | foldé | codex |

## Décision d’escalade

- Dollard-des-Ormeaux: rollback automatique au timestamp `2026-08-08T124832568ZZ`, aucune régression persistante.
- Bloqué-amont à escalader vers `geo-zones`: **non requise** pour ce lot.

## Point de reprise

Prochaine cible prioritaire: `farnham` est déjà terminé sur ce lot; poursuivre au prochain slug non traité de `work/coverage/_refold-167-candidates.txt`.
