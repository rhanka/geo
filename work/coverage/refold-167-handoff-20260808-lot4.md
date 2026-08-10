# Handoff QA — lot `oka...saint-alexis` (refold-167 / loop-msjid8i2)

- Date/heure UTC: `2026-08-08T13:55:43Z → 2026-08-08T14:21:20Z`
- Commandes exécutées:
  - `npx tsx acquisition/src/_lot-zone-refold-batch.ts --slugs oka,ormstown,otterburn-park,pointe-claire,prevost,repentigny,rosemere,rougemont,saint-alexandre,saint-alexis --out work/coverage/_refold-167-progress.json`
  - `npx tsx acquisition/src/_lot-zone-refold-batch.ts --slugs prevost,repentigny,rosemere,rougemont,saint-alexandre,saint-alexis --out work/coverage/_refold-167-progress.json`
  - `npx tsx acquisition/src/_lot-zone-refold-batch.ts --slugs repentigny,prevost --out work/coverage/_refold-167-progress.json` (prevost non abouti)
  - `npx tsx acquisition/src/_lot-zone-refold-batch.ts --slugs prevost --out work/coverage/_refold-167-progress.json`
- Géométrie zonage: servie (`qc-zonage` check passé pour les traitées).  
- Artéfacts mis à jour: `work/coverage/_refold-167-progress.json`

## KPI lot

- Col-12 (`code_zone`) : gain réel du lot = `0 / 10` (`+0` assigné)
- Col-13 (`folded-normes`) : gain réel du lot = `0 / 10` (`+0` normes pliées)
- `complete_final` gagné : `0`
- Bloqués-amont: `2` confirmés + `1` en attente d’achèvement (`prevost`)

## Détail municipalité

| muni | colonne (avant → après) | statut lot | décision | worker |
|---|---|---|---|---|
| oka | 12: 1910 → 1910 / 13: 1879 → 1879 | FOLD | foldé | codex |
| ormstown | 12: 2421 → 2421 / 13: 62 → 62 | FOLD | foldé | codex |
| otterburn-park | 12: 3929 → 3929 / 13: 924 → 924 | FOLD | foldé | codex |
| pointe-claire | 12: 10815 → 10815 / 13: 6931 → 6931 | BLOC | bloqué-amont (`lot-zone-join:`) | codex |
| prevost | — | NON_TRAITE | blocage technique au passage batch (`post-backup`, sans dépôt) | codex |
| repentigny | 12: 28798 → 28798 / 13: 28742 → 28742 | FOLD | foldé | codex |
| rosemere | 12: 4246 → 4246 / 13: 4246 → 4246 | BLOC | bloqué-amont (`geometry-suspect`) | codex |
| rougemont | 12: 1732 → 1732 / 13: 1732 → 1732 | FOLD | foldé | codex |
| saint-alexandre | 12: 1408 → 1408 / 13: 138 → 138 | FOLD | foldé | codex |
| saint-alexis | 12: 1028 → 1028 / 13: 484 → 484 | FOLD | foldé | codex |

## Décision d’escalade

- `pointe-claire`: escalade geo-zones (join bloquée sans détail exploitable)
- `rosemere`: escalade geo-zones (`geometry-suspect`, outside_all dominant)
- `prevost`: à relancer en priorité avec trace infra; si ETIMEDOUT répété, escalade geo-zones (aucune donnée réelle déposée)

## Point de reprise

Prochaine cible prioritaire: `prevost` (à valider), puis `saint-amable`.
