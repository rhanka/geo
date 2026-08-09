# Handoff QA — lot `franklin...la-prairie` (refold-167 / loop-msjid8i2)

- Date/heure UTC: `2026-08-08T12:53:32Z → 2026-08-08T13:09:58Z`
- Commande exécutée: `npx tsx acquisition/src/_lot-zone-refold-batch.ts --slugs franklin,hampstead,havelock,hemmingford--les-jardins-de-napierville,hemmingford--les-jardins-de-napierville--2,howick,hudson,joliette,kirkland,la-prairie --out work/coverage/_refold-167-progress.json`
- Géométrie zonage: servie pour les lotables, avec `geometry-suspect` détecté pour les bloqués-amont.
- Artéfacts mis à jour: `work/coverage/_refold-167-progress.json`

## KPI lot

- Col-12 (`code_zone`): gain réel du lot = `0 / 10` (`+0` assigned)
- Col-13 (`folded-normes`): gain réel du lot = `+0` (`+0`)
- `complete_final`: `0`
- Bloqués-amont: `2` (`hampstead`, `hemmingford--les-jardins-de-napierville`)

## Détail municipalité (par lot traité)

| muni | colonne (avant → après) | statut lot | décision | worker |
|---|---|---|---|---|
| franklin | 12: 1370 → 1370 / 13: 1368 → 1368 | FOLD | foldé | codex |
| hampstead | 12: 1861 → 0 / 13: 1847 → 0 | BLOC | bloqué-amont (`geometry-suspect`) | codex |
| havelock | 12: 566 → 566 / 13: 12 → 12 | FOLD | foldé | codex |
| hemmingford--les-jardins-de-napierville | 12: 20 → 0 / 13: 19 → 0 | BLOC | bloqué-amont (`geometry-suspect`) | codex |
| hemmingford--les-jardins-de-napierville--2 | 12: 571 → 537 (rollback → 571) / 13: 549 → 515 (rollback → 549) | BLOC | bloqué-amont par rollback (perte absolue) | codex |
| howick | 12: 394 → 394 / 13: 365 → 365 | FOLD | foldé | codex |
| hudson | 12: 3309 → 3309 / 13: 344 → 344 | FOLD | foldé | codex |
| joliette | 12: 7193 → 7193 / 13: 1739 → 1739 | FOLD | foldé | codex |
| kirkland | 12: 6498 → 6498 / 13: 5243 → 5366 | FOLD | foldé | codex |
| la-prairie | 12: 9399 → 9399 / 13: 472 → 472 | FOLD | foldé | codex |

## Décision d’escalade

- Escalade geo-zones requise pour: `hampstead`, `hemmingford--les-jardins-de-napierville`
- `hemmingford--les-jardins-de-napierville--2` et `dollard-des-ormeaux` (lots précédents) ont été traités en rollback anti-régression (`code_zone/normes`), sans dépôt final.

## Point de reprise

Prochaine cible prioritaire: `lassomption` (après `la-prairie` dans `work/coverage/_refold-167-candidates.txt`).
