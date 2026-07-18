# SHARD 1/2 — effet_densifiant

Périmètre strict — FOCUS trié, `index % 2 == 1` : `champlain`,
`cowansville`, `levis`, `mont-tremblant`,
`petite-riviere-saint-francois`, `preissac`, `rosemere`,
`saint-charles-borromee`, `saint-frederic`,
`saint-mathieu-de-beloeil`, `sainte-catherine`, `stratford`.

Reprise du 2026-07-18. Les artefacts déjà committés ont été contrôlés par
`fold-effet-densifiant.ts --dry-run`, puis relus dans l’API OGC publique.
Le verrou `readEntries` a donc re-dérivé les effets depuis les deux compteurs;
aucune valeur n’a été créée ou modifiée durant cette reprise.

## Villes servies

| Ville | Zones densifiées | Zones contrôlées | Avant → après | Preuve de service |
| --- | ---: | --- | --- | --- |
| `cowansville` | 0 | `CBB-1` | `4 → 4`, `stable`; `1841/2016 → 1841-41-2023/2023` | Artefact committé `24ef77b`; fold dry-run: 239 entités, 1 correspondance; API OGC relue. |
| `saint-charles-borromee` | 0 | `P9` | `24 → 24`, `stable`; `2207-2022/2022 → 2207-5-2024/2024` | Artefact committé `f7e0346`; fold dry-run: 136 entités, 1 correspondance; API OGC relue. |

Les six propriétés OGC (`densite_avant`, règlement et millésime AVANT,
`densite_apres`, règlement et millésime APRÈS, effet, delta) concordent avec
les artefacts. `CBB-1` est `deduit` avec confiance `high`; `P9` est
`explicit` avec confiance `high`.

## Inconnu — aucun événement final de zonage détectable

| Ville | Constat vérifié |
| --- | --- |
| `levis` | Une seule grille de base `RV-2011-11-23/2011` est disponible; aucun avis/PV ou amendement final zoné avec les deux côtés n’est détecté. |
| `mont-tremblant` | Les signaux 2026 sont au stade avis de motion, sans règlement de zonage final ni grille APRÈS. |
| `preissac` | `239-2014` avec mention « MAJ 2015 » est une consolidation, non un événement numéroté avec zone touchée. |
| `rosemere` | Le signal `801-71` est au stade avis de motion/projet; la grille consolidée `801/2011` est le seul état disponible. |
| `saint-frederic` | `297-15 amendé-5` est une consolidation à un seul état; aucun amendement final zoné et sa grille précédente n’ont été isolés. |

## Bloquées — événement ou signal détecté, mais delta non servable

| Ville | Raison du blocage |
| --- | --- |
| `champlain` | `2012-03` donne l’APRÈS de `122-R` (maximum 8 logements), mais aucun compteur AVANT ni grille pré-2012; `122-R` ne correspond pas exactement au code servi `R-122`. |
| `petite-riviere-saint-francois` | `774`/`783` restent au stade projet ou n’exposent pas les deux compteurs; la collection servie `603` a un millésime nul, donc le garde AVANT/APRÈS est indécidable. |
| `saint-mathieu-de-beloeil` | Des actes ciblés sont repérés, mais la collection servie `08.09` a un millésime nul et aucun couple acte-zone-deux-compteurs n’est isolé. |
| `sainte-catherine` | `2009-Z-94`, entré en vigueur le 30 juin 2026, ajuste une superficie maximale de bâtiments mixtes sans zone nommée ni compteur de logements AVANT/APRÈS. |
| `stratford` | Les amendements signalés ne permettent pas d’établir l’ordre contre le règlement servi `1035` (millésime nul) ni d’extraire deux compteurs verbatim. |

Référence de découverte locale :
[`effet-densifiant-20260718T083225Z.md`](effet-densifiant-20260718T083225Z.md).
