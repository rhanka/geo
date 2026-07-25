# Effet densifiant (4a) — SHARD 1/2 — 2026-07-18T08:32:25Z

Périmètre strict : FOCUS trié, `index % 2 == 1` : `champlain`,
`cowansville`, `levis`, `mont-tremblant`,
`petite-riviere-saint-francois`, `preissac`, `rosemere`,
`saint-charles-borromee`, `saint-frederic`,
`saint-mathieu-de-beloeil`, `sainte-catherine`, `stratford`.

## Villes SERVIES

| Ville | Zones densifiées | Vérification | 
| --- | ---: | --- |
| `cowansville` | 0 | `CBB-1` : 4 → 4, `stable`. Artefact existant replié avec AVANT `1841/2016`, APRÈS `1841-41-2023/2023`; l’OGC public retourne ces six champs. |
| `saint-charles-borromee` | 0 | `P9` : 24 → 24, `stable`. Artefact existant replié avec AVANT `2207-2022/2022`, APRÈS `2207-5-2024/2024`; l’OGC public retourne ces six champs. |

Les deux artefacts sont les commits existants `24ef77b` et `f7e0346`.
Le verrou `readEntries` a accepté les compteurs et a redérivé `stable`; aucune
densification n’est affirmée sans les deux compteurs.

## Inconnu — aucun événement de zonage final détectable

| Ville | Constat |
| --- | --- |
| `levis` | Aucun avis/PV ou amendement de zonage avec acte final et deux côtés détectable dans le corpus accessible. |
| `mont-tremblant` | Les signaux 2026 sont au stade avis de motion; aucun règlement final zoné avec grille APRÈS n’est publié. |
| `preissac` | L’index officiel ne contient que quatre dérogations mineures; elles sont exclues de cette lane. |
| `rosemere` | Le PV du 9 mars 2026 ne donne pour `801-71` qu’un avis de motion et l’adoption d’un projet, sans règlement final ni grille APRÈS. |
| `saint-frederic` | La grille « amendé-5 » est une consolidation; aucun amendement zoné final avec paire de grilles n’est détectable. |

## Événement détecté, mais delta interdit

| Ville | Événement / garde | Raison anti-invention |
| --- | --- | --- |
| `champlain` | `2012-03` : agrandissement de `122-R` et maximum APRÈS de 8 logements. | Aucun compteur AVANT ni grille pré-2012; code servi `R-122` non raccordable sans canonicalisation réglementaire. |
| `petite-riviere-saint-francois` | `774`, adopté le 14 avril 2026 : `U-38` créée à même `U-13`; avant 6 logements, après 6 unités résidentielles. | La collection servie `603` a un millésime nul : le sens AVANT/APRÈS est indécidable selon Stage 3, donc aucun fold. |
| `saint-mathieu-de-beloeil` | PV du 1er juin 2026 : `22.10.17.26` adopté, ciblant IDC-1..4 et IDR-1/6; d’autres actes concernent I-10 ou l’affichage. | La collection servie est `08.09` avec millésime nul; aucun changement de compteur de logements à deux côtés n’est isolé. |
| `sainte-catherine` | `2009-Z-94`, entré en vigueur le 30 juin 2026. | L’acte ne modifie que la superficie maximale de bâtiments mixtes dans des zones non nommées, sans compteur de logements AVANT/APRÈS. |
| `stratford` | Des amendements de zonage sont signalés dans le corpus (notamment 1206, 1208, 1236 et 1257). | Le règlement servi `1035` a un millésime nul; la garde AVANT interdit tout delta sans ordre pré/post prouvable ni deux grilles comptables. |

## Contrôles de service

- `fold-effet-densifiant.ts` : `cowansville` et `saint-charles-borromee` ont
  chacun `matched=1`; les enveloppes GeoJSON ont été conservées.
- API relue avec `curl -s` : `CBB-1` porte `4/4`, `1841/2016`,
  `1841-41-2023/2023`, `stable`; `P9` porte `24/24`, `2207-2022/2022`,
  `2207-5-2024/2024`, `stable`.
- Aucun redémarrage de `geo-api`.
