# col-2 — mismatch par tolérance de frontière (dossier A/B, garde-fou anti-circularité)

## Contexte

geo-cond (`…ack-evidence-circularity…t2014`) : le **B naïf est CIRCULAIRE** — un
audit « cohérence aire-majorité » alors que l'assignation EST aire-majorité serait
tautologique (col-2=100% par construction = gaming). Il faut un **signal
INDÉPENDANT robuste au désalignement**. PREP demandé : chiffrer un audit à
tolérance de frontière vs le centroïde actuel.

## Mesure (`_col2-boundary-tolerance-quantify.ts`, read-only, HOLD respecté)

Signal indépendant retenu (évite la tautologie) : la **distance métrique du
centroïde du lot à sa zone `code_zone` ASSIGNÉE** (frame local-equirectangulaire,
`projConstants`). Un lot « misassigned » (centroïde hors zone assignée) dont le
centroïde est à quelques mètres de la frontière de sa zone assignée = artefact de
désalignement cadastre(MERN)↔zonage(municipal), pas une erreur.

| ville | assigned | strict | dist médiane | 2 m | 5 m | 10 m | 25 m | 50 m |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **saint-hyacinthe** | 19379 | 6,47% | **8,8 m** | 5,29% | 4,18% | 3,09% | 1,82% | 1,18% |
| varennes | 8287 | 4,98% | 9,3 m | 4,30% | 3,45% | 2,46% | 1,21% | 0,58% |
| ormstown | 2421 | 2,81% | 6,8 m | 2,02% | 1,65% | 1,24% | 0,58% | 0,45% |

(mismatch_pct à la tolérance X = (misassigned dont centroïde > X m de sa zone +
outside_all) / assigned.)

## Lecture (pour archi/qa/owner)

- **La distance médiane d'un lot misassigned à sa zone assignée est ~7-9 m** :
  c'est la signature d'un **slop de frontière** entre deux couches de sources
  différentes (cadastre MERN vs zonage municipal), pas d'une mauvaise assignation.
- **Plus de la moitié** du mismatch strict s'effondre à une tolérance de 10 m
  (saint-hyacinthe 6,47%→3,09%). L'essentiel du col-2 « incomplete » est donc un
  **artefact d'alignement**, mesuré ici par un signal (distance du centroïde)
  **indépendant de la méthode d'assignation** → PAS la tautologie du B naïf.
- **Un résidu ~0,5-1,2% persiste au-delà de 50 m** : lots dont le centroïde est
  profondément dans une autre zone (gros lots à cheval, ou vraie erreur). C'est
  la seule part qui mériterait investigation lot-par-lot.

## Décision A/B (rappel — non tranchée ici)

- **A** = re-fold vers le centroïde : gaming (ferme le chiffre sans corriger la donnée).
- **B correct** (non tautologique) : audit à **tolérance de frontière** (ex. la
  distance-centroïde ci-dessus, ou recouvrement-recalculé + tolérance) — archi
  définit le contrat. Cette mesure chiffre l'ampleur de l'artefact pour ce choix.

HOLD strict respecté : aucune écriture servie, aucun changement d'audit.
