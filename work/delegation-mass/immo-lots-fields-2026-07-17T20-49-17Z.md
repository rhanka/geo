# WP9 — champs lots immo, shard 0/1

Mesures S3 : 2026-07-17T20:40:03.541Z → 2026-07-17T20:49:17.920Z.
Le shard `0/1` contient tous les slugs de la liste triée. Les chiffres ci-dessous
proviennent exclusivement de `immo-lots-audit.ts` et des sidecars S3.

## Avant / après par champ

| Champ | Avant | Après | Écart mesuré |
| --- | ---: | ---: | ---: |
| `surface_m2` | 3 359 823 / 3 359 823 (100 %) | 3 359 823 / 3 359 823 (100 %) | 0 |
| `adresse` | 2 255 367 / 3 359 823 (67,13 %) | 2 534 516 / 3 359 823 (75,44 %) | +279 149 |
| `code_postal` | 3 359 822 / 3 359 823 (100 % arrondi) | 3 359 822 / 3 359 823 (100 % arrondi) | 0 |
| `folded-normes` | 854 877 / 3 359 823 (25,44 %) | 854 877 / 3 359 823 (25,44 %) | 0 |
| `in_tod` (scopé) | 28 431 / 28 431 (100 %) | 28 431 / 28 431 (100 %) | 0 |

Le delta global `adresse` est confirmé par l'audit, mais il est **concurrent** :
aucune des villes déposées dans ce shard n'a changé de pourcentage. Il ne lui est
donc pas attribué.

## Villes effectivement traitées et vérifiées

Réenrichissement avec rôle foncier et FSA, sans `--no-role` ni `--no-fsa` :
`abercorn`, `alma`, `saint-felix-de-dalquier`,
`hemmingford--les-jardins-de-napierville--2`, `lac-sainte-marie`,
`mont-laurier`, `windsor`, `portneuf`, `lejeune`,
`saint-antoine-de-lisle-aux-grues`, `saint-remi-de-tingwick`, `pierreville`.

Les 12 dépôts ont chacun retourné `deposit=Y`. Leur couverture par champ reste
inchangée à l'audit final. Les valeurs nulles qui restent nulles sont conservées :
elles ne sont pas complétées par estimation.

Pour `folded-normes`, la chaîne `lot-zone-join-run.ts` puis
`lots-enriched-run.ts` a aussi été exécutée et vérifiée pour :

- `lejeune` — matching code-zone/norme 0 %, donc 0 % de normes foldées ;
- `saint-antoine-de-lisle-aux-grues` — matching 0 %, donc 0 % ;
- `saint-remi-de-tingwick` — matching réel 3,28 %, conservé à 3,28 %.

## Villes skippées / limites constatées

- `saint-felix-de-dalquier` : le rôle 2026 n'a aucun candidat `code_geo` ;
  `adresse` reste entièrement nulle.
- `pierreville` : un lot n'intersecte pas une RTA/FSA ; `code_postal` reste
  1 830 / 1 831 (99,95 %), sans inventer de code.
- `montreal` : interrompue à 360 s sans ligne `OK` ni dépôt vérifié ; non
  comptée, conformément au plafond par ville.
- `laval`, `longueuil`, `quebec`, `trois-rivieres`, `gatineau`,
  `thetford-mines`, `saint-constant`, `sainte-adele`,
  `saint-lin-laurentides` et `pointe-claire` : les runs groupés ont cessé avant
  de retourner une ligne `OK` et une vérification de dépôt par ville ; ils ne
  sont pas comptés comme traités.
- `mont-laurier` (jointure normes), `lascension-de-patapedia`, `val-des-bois`,
  `la-corne` et `saint-roch-ouest` : même absence de `OK`/dépôt vérifié après le
  run groupé ; non comptés. La réexécution par ville est nécessaire.

## Contrôles

- Vérification explicite du piège : `--no-role` désactive le contexte rôle puis
  écrit `adresse=null`; ce drapeau n'a jamais été utilisé dans les dépôts ci-dessus.
- Audit final : `npx tsx acquisition/src/immo-lots-audit.ts --report
  work/coverage/immo-lots-after-shard0.json`.
