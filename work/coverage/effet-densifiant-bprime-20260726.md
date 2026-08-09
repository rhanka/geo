# Effet densifiant — diagnostic B' — 2026-07-26

Périmètre fermé : les 170 slugs de `acquisition/config/immo-vivier-b-20260725.json`.
La sonde S3 a lu uniquement ces collections, en préférant le layout imbriqué.

## Contrat des folds

`fold-effet-densifiant.ts` ne calcule aucune valeur depuis une grille : il lit
`work/effet-densifiant/<slug>.json`, exige par zone les deux comptes finis
`densite_avant` et `densite_apres`, puis dérive le signe. Ses quatre arguments
explicites portent les règlements et millésimes avant/après. Il les écrit sur
toutes les clés servies existantes avec `putServedZoneAdditive`.

`fold-effet-densifiant-scaffold.ts` ne fournit pas ces données : il pose les
nulls et `effet_densifiant=inconnu`, en ne copiant du polygone courant que le
règlement/millésime APRES connus. Une densité unique `densite_value` issue de
`fold-norms-to-zonage.ts` ne suffit jamais à calculer un delta.

## Mesure servie

| État des collections B' | Collections |
| --- | ---: |
| effet connu | 7 |
| `inconnu` seul | 8 |
| effet absent | 126 |
| non servie | 29 |
| total vivier | 170 |

Partition des 126 collections sans effet :

| Cause primaire mesurée | Collections | Détail |
| --- | ---: | --- |
| aucune norme pliée (`densite_value` fin absente) | 117 | aucune base de densité actuelle |
| normes présentes, une seule densité actuelle | 8 | `chelsea`, `hemmingford--les-jardins-de-napierville--2`, `neuville`, `notre-dame-de-lourdes--lerable`, `saint-gilbert`, `saint-mathieu-de-beloeil`, `saint-raymond`, `sainte-cecile-de-milton` |
| deux densités, millésime manquant | 0 | aucun correctif d'appariement à faire |
| artefact local AVANT/APRÈS non plié | 1 | `saint-raphael`, voir blocage ci-dessous |

Overlay règlement : 2 collections n'ont aucun règlement sur leurs features
servies (`amherst`, `saint-raphael`, 140 features au total); aucune des 126 ne
porte de chaîne de règlement égale à son code de zone. Le cas `RD-104` est
hors de cette partition : Coaticook a un effet connu, mais reste non-joignable
par 4a et donc exclu de l'export.

## Levier retenu

Aucun fold n'est relancé. Le seul candidat local est `saint-raphael` : son
artefact compare 2022-228 avec 2026-244, mais le registre de règlement établit
que 2026-244 est le premier projet, non en vigueur. Le plier fabriquerait un
APRES réglementaire. Aucun objet servi n'a donc été écrit : propriétés et
géométrie restent inchangées (97 features Saint-Raphaël; toutes les autres
collections B' également intactes).

Le levier à plus fort rendement est l'acquisition de deux grilles réglementaires
en vigueur et datées : 117 villes n'ont même pas la première densité servie;
les 8 suivantes exigent un état AVANT distinct. Il n'existe pas de défaut de
millésime dans la donnée servie à corriger en lib.

## Artefact 4a

Le `latest.json` publié (`snapshot_id=fbd89f40c5721161cea3cfa2`,
`generated_at=2026-07-26T05:00:21.463Z`) confirme la mesure : 7 villes B' à
effet connu, 6 villes émises, 130 records et 1 feature connue non joignable.
Le dry-run global, lancé après le diagnostic avec les garde-fous S3, n'a pas
produit de résultat avant la borne de lecture S3. Aucun snapshot redondant
n'est donc publié : aucune collection B' n'a changé. Coaticook (`RD-104`) reste
volontairement non-joignable.
