# col-2 — CHIFFRE DE RÉFÉRENCE RATIFIÉ (2026-08-24)

## Chiffre owner (ratifié geo-cond)

**weighted_mismatch 1,88 % / residue_hard 0,67 %** (median-ville 1,18 % ; p90 2,64 %).

- **owner dossier+spec** = geo-jointures ; **owner chiffre** = geo-cond (ratifié 2026-08-24).
- **owner artefact scale** = geo-lot (vouché + committé).

## Provenance (par construction)

- Artefact : `work/coverage/lot-zone-consistency-scale-20260824.json`, engine-exact.
- Engine : `lot-zone-consistency-audit.ts --scale` (#192, commit `2e4ed118`), bands
  T=10 m cohérent / d>10 mismatch / d>50 résidu dur, centroïde→bord zone ASSIGNÉE (ENU mètres).
- Couverture : **866/866 mesurées**, 845 concluantes, 0 pending, 21 inconclusive_zero_assigned.
- Agrégat : denom 2 306 822, mismatch 43 320, residue_hard 15 393
  → 43 320 / 2 306 822 = **1,88 %** ; 15 393 / 2 306 822 = **0,67 %**.
- generatedAt 2026-08-24T02:30:36Z, asOfS3Listing 2026-08-24T02:08:28Z.
- **Committé sur origin/main au merge SHA `1ce772ab3e6af36f80347004f1ccf9ad72233cc8`**
  (PR #257, 2026-08-24T11:38:55Z).
- Vouch croisé : geo-lot (owner artefact) a reproduit les valeurs par-ville à l'entier
  (spot-check indépendant de l'engine).

## Supersède 2,25 % (photo périmée, conservée pour diff)

Le `lot-zone-consistency-scale-20260815.json` (2,25 % / 1,04 %) est une photo
`asOfS3Listing 2026-08-16T03:24Z`, prise **~1 h avant** le dépôt sur main des re-folds
amherst/beaupre/boischatel (`#196`/`#199`/`#201`, backups S3 04:14Z/04:50Z). **Même univers**
(845/866 concluantes, ZÉRO exclusion), instant antérieur. L'écart 2,25 → 1,88 = ces 3
corrections mergées, PAS un changement de méthode/univers :

| ville | avant (photo 2,25%) | après (ratifié) |
| --- | ---: | ---: |
| amherst | 100 % | 1,69 % |
| beaupre | 100 % | 3,65 % |
| boischatel | 100 % | 1,28 % |

Le 20260815 reste sur main pour diff historique.

## Anti-gaming (SPEC §4)

- residue_hard **0,67 % TOUJOURS affiché** = plancher d'erreur dure, jamais soustrait.
- Seule exclusion = `outside_all → UNKNOWN` (ratifié) : les ~566 lots hors-zone d'amherst
  qu'AUCUNE zone servie ne couvre → candidats ré-acquisition zones, PAS du gaming.
- **mille-isles** (99,8 %, résidu 487) et **saint-raphael** (26,81 %, résidu 624) restent
  COMPTÉS dans le résidu → le 1,88 % ne masque aucune ville cassée.

## Statut

Réconciliation du chiffre col-2 **CLOSE**. Levier jointures col-2 = clos+mergé.
Outil de réconciliation réutilisable : `acquisition/src/_col2-scale-summary.ts` (read-only).
