# Handoff QA — lot `saint-amable...saint-clet` (refold-167 / loop-msjid8i2)

- Date/heure UTC: `2026-08-08T14:21:20Z → 2026-08-08T14:52:00Z`
- Commandes exécutées:
  - `npx tsx acquisition/src/_lot-zone-refold-batch.ts --slugs saint-amable,saint-barnabe-sud,saint-basile-le-grand,saint-bernard-de-lacolle,saint-bernard-de-michaudville,saint-bruno-de-montarville,saint-calixte,saint-charles-sur-richelieu,saint-chrysostome,saint-clet --out work/coverage/_refold-167-progress.json` (interrompu au stade early par lot long)
  - `npx tsx acquisition/src/_lot-zone-refold-batch.ts --slugs saint-clet,saint-chrysostome,saint-bruno-de-montarville,saint-barnabe-sud,saint-bernard-de-michaudville,saint-calixte,saint-charles-sur-richelieu --out work/coverage/_refold-167-progress.json`
  - `npx tsx acquisition/src/_lot-zone-refold-batch.ts --slugs saint-basile-le-grand --out work/coverage/_refold-167-progress.json` (hors-passage, non terminé après backup)
- Artéfacts mis à jour: `work/coverage/_refold-167-progress.json`

## KPI lot

- Col-12 (`code_zone`) : gain réel du lot = `0 / 10` (`+0` assigned)
- Col-13 (`folded-normes`) : gain réel du lot = `0 / 10` (`+0` normes pliées)
- `complete_final` gagné : `0`
- Bloqués-amont: `3` détectés + `2` en attente d’exécution complète

## Détail municipalité (par lot traité)

| muni | colonne (avant → après) | statut lot | décision | worker |
|---|---|---|---|---|
| saint-amable | — | NON_TRAITE | timeout technique après backup (sans dépôt) | codex |
| saint-barnabe-sud | 12: 1 → 1 / 13: 0 → 0 | BLOC | bloqué-amont (`geometry-suspect`) | codex |
| saint-basile-le-grand | — | NON_TRAITE | timeout technique après backup (sans dépôt) | codex |
| saint-bernard-de-lacolle | 12: 181 → 181 / 13: 0 → 0 | BLOC | bloqué-amont (`geometry-suspect`) | codex |
| saint-bernard-de-michaudville | 12: 642 → 642 / 13: 634 → 634 | FOLD | foldé | codex |
| saint-bruno-de-montarville | 12: 10123 → 10123 / 13: 0 → 0 | FOLD | foldé | codex |
| saint-calixte | 12: 5976 → 5976 / 13: 470 → 470 | BLOC | bloqué-amont (`geometry-suspect`) | codex |
| saint-charles-sur-richelieu | 12: 1367 → 1367 / 13: 975 → 975 | FOLD | foldé | codex |
| saint-chrysostome | 12: 1736 → 1736 / 13: 0 → 0 | FOLD | foldé | codex |
| saint-clet | 12: 946 → 946 / 13: 450 → 450 | FOLD | foldé | codex |

## Décision d’escalade

- `saint-barnabe-sud`, `saint-bernard-de-lacolle`, `saint-calixte` : escalade geo-zones (bloqué-amont confirmé geometry-suspect).
- `saint-amable`, `saint-basile-le-grand` : relance en priorité; si répétition post-backup sans suite -> escalade géométrie/assignation amont avec trace des tentatives.

## Point de reprise

Prochaine cible prioritaire: `saint-barnabe-sud` (si non encore finalisée dans cette passe) puis `saint-basile-le-grand`/`saint-amable`.
