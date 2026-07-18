# Effet densifiant (4a) — SHARD 0/3 — 2026-07-18T08:00:20Z

Slugs triés où `index % 3 == 0` : `alma`, `cowansville`,
`mont-saint-hilaire`, `petite-riviere-saint-francois`, `rimouski`,
`saint-charles-borromee`, `saint-gilbert`, `sainte-catherine`.

## Villes SERVIES

| slug | zones densifiées | résultat vérifié |
|---|---:|---|
| cowansville | 0 | Déjà servi au départ (commit `24ef77b`) : `CBB-1` 4 → 4, stable. |
| rimouski | 1 | Déjà servi au départ (commit `8d144f6`) : `H-3018` 1 → 16, densifié. |
| saint-charles-borromee | 0 | Servi ici : `P9` 24 → 24, stable. Le fold et l’API confirment `densite_avant=24`, `densite_apres=24`, `effet_densifiant=stable`. |

### Preuve Saint-Charles-Borromée

- Événement final : le règlement `2207-5-2024` a été adopté le 25 mars 2024,
  a reçu le certificat de conformité de la MRC le 18 avril, et est entré en
  vigueur le 1er mai. Son avis officiel dit que `RES-3` est agrandie à même
  `P-9` : https://www.vivrescb.com/storage/app/media/Avis-publics/avis-public-deev-web-reglement-2207-5-2024.pdf
- AVANT, la grille 2207-2022, zone `P-9`, p.50, donne verbatim `Nombre de
  logement par bâtiment min/max 6/24` :
  `work/zonage-norms/saint-charles-borromee/grille-2207-2022.pdf`.
- APRÈS, la grille officielle du 29 avril 2025, même zone et même p.50, donne
  le même compteur verbatim :
  https://www.vivrescb.com/storage/app/media/uploaded-files/grilles-version-finale-web-29-avril-2025.pdf
- Le polygone servi emploie la forme exacte `P9`; le document emploie `P-9`.
  Cette variation lettre-nombre est la canonicalisation documentée par
  `packages/geo/src/zonage/lotZoneJoin.ts::canonicalizeZoneCodeForJoin`.
- Garde AVANT : la grille servie est `2207-2022/2022`, antérieure à
  `2207-5-2024/2024`; le fold a donc reçu ces deux identités, sans inversion.

## inconnu — sans événement de zonage adopté détectable

| slug | éléments consultés | raison |
|---|---|---|
| mont-saint-hilaire | Répertoire officiel et avis publics; seule piste actuelle `1235-37` libellée « 1er projet » | Aucun règlement de zonage postérieur adopté avec PDF deux-côtés dans la fenêtre consultée; la codification 1235 du 26 mai 2026 est un seul côté. |
| petite-riviere-saint-francois | Avis publics et page des règlements d’urbanisme | Aucun amendement municipal de zonage 603 publié avec source PDF; le règlement 603 « à jour 20-02-2026 » est une consolidation courante, donc un seul côté. |

## inconnu — événement détecté, mais delta non servable

| slug | événement | raison anti-invention |
|---|---|---|
| alma | `426-2024`, art. 9 : ajout dans `Rd9` de `R9` et de l’usage spécifiquement autorisé `10 log.` | La grille pré-événement disponible (annexes 2023) ne contient pas `Rd9`; le compteur AVANT n’est donc pas lisible. Le `10` APRÈS seul ne peut pas devenir un delta. Les autres changements 485-2026 sont des transferts de limites de zones. |
| saint-gilbert | `U-05-2023`, entré en vigueur : agrandit `Af/b-1` à même `Af/c-1` | Changement de limite entre deux zones agroforestières; l’avis final ne fournit aucun compteur de logements AVANT/APRÈS. Les `U-154-2025` et `U-161-2026` disponibles sont des projets, pas une preuve d’entrée en vigueur. |
| sainte-catherine | `2009-Z-94`, en vigueur le 30 juin 2026 | L’objet et l’art. 236 ne modifient que la superficie maximale des bâtiments mixtes/commerces/bureaux, pas le nombre de logements. Les autres événements ciblés (`Z-92` industriel I-220, `Z-88` ajout d’usage C8B) ne donnent pas non plus les deux compteurs de logements. |

## Garanties

- Aucun compteur n’est déduit d’un numéro de règlement ni d’un indice de Steve.
- Le seul nouveau artefact comporte les deux compteurs verbatim; son effet est
  dérivé `stable` par le verrou de `fold-effet-densifiant.ts`.
- Aucun redémarrage de `geo-api` n’a été effectué.
