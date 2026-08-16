# col-2 — caractérisation de la traîne « vraie erreur » + routage + gain (post-ratification)

## Objet

L'audit col-2 ratifié (SPEC_COL2_COHERENCE_AUDIT `9787f95f`) est implémenté
(geo-lot, engine `d9b33904`) + scalé 866/866 (`529634c5`, artefact
`lot-zone-consistency-scale-20260815.json`) : **weighted_mismatch 2,25% /
médiane-ville 1,18% / residue_hard 1,04%**. jointures a **VALIDÉ** (4 gates :
contrat=spec exacte, ground-truth, spot-check indépendant granby 0,8%, agrégat).

Ce document caractérise la **traîne** (villes qui tirent le weighted au-dessus de
la médiane 1,18%) et **route** la correction (part « vraie erreur », mandat geo-cond).

## Catch méthodo (transparence)

Ma 1re sonde de caractérisation lisait le layout **FLAT** d'abord ; or geo-api sert
le **NESTED** quand les deux coexistent (CLAUDE.md). Sur les villes flat≠nested je
lisais des zones **périmées** (boischatel 52 vs 4072 réel). **Corrigé** (nested-first) ;
après fix je matche le scale. Remonté à geo-cond AVANT sa présentation owner.

## Classification (`_col2-offset-characterize.ts`, nested-first, read-only)

| ville | assigned | mismatch | codeMissing (contenu/hors) | offset médian | R | classe |
| --- | ---: | ---: | --- | ---: | ---: | --- |
| amherst | 1749 | 100% | 1749 (**1132**/617) | — | — | **codeMissing** (mixte) |
| beaupre | 2929 | 100% | 2929 (0/**2929**) | — | — | codeMissing HORS-ZONE |
| boischatel | 4072 | 100% | 4072 (0/**4072**) | — | — | codeMissing HORS-ZONE |
| mille-isles | 488 | 99,8% | 0 | **1705 m** | 0,89 | OFFSET source |
| saint-camille-de-lellis | 1 | 100% | 0 | 1052 m | 1,0 | OFFSET source (micro) |
| saint-cyrille-de-lessard | 3 | 100% | 0 | 844 m | 1,0 | OFFSET source (micro) |
| saint-cyprien--les-etchemins | 18 | 100% | 0 | 272 m | 0,73 | OFFSET source (micro) |
| saint-barnabe-sud, saint-marcel, saint-marcellin, hatley, saint-celestin | 1–16 | ≥69% | 0 | 53–281 m | ≥0,84 | OFFSET source (micro) |
| saint-raphael | 2637 | 26,8% | 0 | 235 m | 0,14 | dispersé (gros lots) |
| saint-hyacinthe | 19379 | 3,09% | 0 | 32 m | 0,07 | dispersé (slop frontière) |

## Routage + LEVIERS

1. **codeMissing CONTENU → RE-FOLD jointures (VRAI fix, ferme le mismatch)** :
   `amherst` **1132 lots** dont le `code_zone` assigné est absent des zones servies
   courantes MAIS le centroïde est contenu dans une AUTRE zone servie (mislabellés).
   Re-fold containment contre les zones servies courantes → code contenant existant
   → cohérent. ⚠ Contrairement à saint-hyacinthe (no-op), ici les codes ont VRAIMENT
   changé → le re-fold ferme. **GATE : autorité zones (nested FINAL) avant écriture**
   (coordonner lot/zones). **Gain col-2 : −0,05 pt weighted** (petit).

2. **codeMissing HORS-ZONE + OFFSET géométrique → SOURCE zones/cadastre (PAS jointures)** :
   `beaupre` 2929, `boischatel` 4072, `amherst` 617 (hors-zone) + `mille-isles` 487
   (~1,7 km) + ~8 micro-villes = **~8146 lots** dont les zones servies NE COUVRENT
   PAS / sont misregistrées vs les lots. Un re-fold jointures ne peut PAS assigner
   (aucune zone contenante). = géométrie/coverage SOURCE erronée → **route
   zones/cadastre**. **Gain col-2 SI source corrigée : ~−0,39 pt (2,25% → ~1,86%)**.

3. **dispersé / gros-lots → PLANCHER honnête (irréductible)** : `saint-raphael`,
   `saint-hyacinthe`, `montreal` (6%), etc. = slop de frontière cadastre↔zonage +
   queues de gros lots au-delà de 10 m. Reste `residue_hard` (transparence), pas de
   levier propre.

## Chiffre pour l'owner (réponse à « gain du re-fold codeMissing »)

- **Levier jointures direct (re-fold amherst contenu 1132) = −0,05 pt** (2,25→2,20%).
  L'assignation jointures est **essentiellement cohérente** ; sa part col-2 est faite.
- **Levier SOURCE zones/cadastre (~8146 lots, ~5-6 villes) = −0,39 pt** (→ ~1,86%).
  C'est là qu'est le vrai gain, mais **hors lane jointures** (géométrie de zone/cadastre).
- **Plancher ~1,85% weighted / 1,18% médiane** = slop de frontière + gros lots,
  largement irréductible.

**Conclusion honnête (anti-gaming) : jointures a clos sa part col-2. Le col-2 corrigé =
weighted 2,25% (médiane 1,18%), et l'amélioration au-delà relève de la géométrie
SOURCE (zones/cadastre), pas de l'assignation. On ne cache aucune ville cassée
(residue_hard 1,04% toujours affiché).**
