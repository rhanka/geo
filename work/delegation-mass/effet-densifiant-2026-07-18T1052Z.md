SHARD 1/2 — liste FOCUS triée, `index % 2 == 1`

# Effet densifiant (4a) — 2026-07-18T10:52Z

Périmètre exclusif : `champlain`, `cowansville`, `levis`,
`mont-tremblant`, `petite-riviere-saint-francois`, `preissac`,
`rosemere`, `saint-charles-borromee`, `saint-frederic`,
`saint-mathieu-de-beloeil`, `sainte-catherine`, `stratford`.

## Villes SERVIES

| Ville | Zone | Avant → après | Effet | Zones densifiées |
| --- | --- | --- | --- | ---: |
| `cowansville` | `CBB-1` | 4 → 4 | `stable` | 0 |
| `saint-charles-borromee` | `P9` | 24 → 24 | `stable` | 0 |
| `sainte-catherine` | `H-415` | null → 113 | `inconnu` | 0 |

Les trois contrôles `fold-effet-densifiant.ts --dry-run` passent avec,
respectivement, `1841/2016 → 1841-41-2023/2023`,
`2207-2022/2022 → 2207-5-2024/2024` et
`2009-Z-00/2009 → 229-07-25/2025`.

La lecture API OGC confirme exactement les compteurs et règlements ci-dessus.
Pour H-415, la grille résidentielle officielle (Annexe A p.13) autorise h3
mais laisse le maximum de logements vide pour les colonnes h3; seul le
maximum h1 vaut 1. Le compteur AVANT ne peut donc pas être affirmé et le
verrou conserve `effet_densifiant=inconnu`.

## Inconnu — aucun événement de zonage détectable

| Ville | Constat source |
| --- | --- |
| `preissac` | L’index officiel ne porte aucun avis lié au zonage : les avis 299 à 302-2026 et 296 à 297-2025 ne contiennent aucun signal « zonage », « urbanisme », « usage », « habitation », « logement » ou « densité »; le projet 288-2023 concerne la démolition d’immeubles patrimoniaux. |

## Bloquées — aucun delta servi

| Ville | Événement / garde vérifiée | Raison anti-invention |
| --- | --- | --- |
| `champlain` | Les projets 2026-16/2026-17 modifient le règlement de zonage 2009-03 pour les éoliennes. | Millésime servi nul et aucun compteur de logements des deux côtés. |
| `levis` | Grille servie `RV-2011-11-23 / 2011`. | L’index officiel des avis répond HTTP 403 depuis cet environnement : aucun événement officiel ni paire de grilles ne peut être établie. |
| `mont-tremblant` | Grille servie `2008-102 / 2008`; zones candidates `TO-804`, `CV-323`, `CV-324` présentes. | Aucun document officiel disponible ici ne donne deux compteurs verbatim pour une même zone. |
| `petite-riviere-saint-francois` | Avis de consultation du règlement 783 trouvé. | PDF scanné sans couche texte exploitable, millésime servi nul et aucun compteur AVANT/APRÈS lisible. |
| `rosemere` | PV du 9 mars 2026 : `801-70` (lot inclus à `C-18`, sans changement) et `801-71` (concordance). | Les codes cités `C-18`, `H-74`, `H-164` ne sont pas dans la collection servie `801 / 2011`; le fold les rejetterait. |
| `saint-frederic` | Avis de promulgation 419-26, entré en vigueur le 22 juin 2026, annonce une augmentation du nombre de logements en `Rf51`. | `Rf51`, `A16` et `I93` sont absents de la collection servie `297-15 / 2015`; l’avis ne donne pas le compteur précis. |
| `saint-mathieu-de-beloeil` | Grille servie `08.09`, millésime nul. | Aucun couple règlement/année ni deux grilles ciblées par zone acquis; la garde AVANT est indécidable. |
| `stratford` | Projet 1257 : `RU-13` créé à partir de `RU-5` pour autoriser la récréation extensive d’un camping. | Aucune date d’entrée en vigueur et aucun compteur de logements; millésime servi nul. |

## Contrôles

- Provenance S3 relue pour les douze villes : les huit blocages ci-dessus ne
  passent pas la garde Stage 3 ou n’ont pas leurs deux compteurs verbatim.
- Aucun nouveau fold écrivant S3 n’est justifié; aucun redémarrage de
  `geo-api` n’a été effectué.
