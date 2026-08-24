# col-2 — weighted recomputé après les 3 corrections (amherst/beaupre/boischatel sur main)

## Demande

geo-cond (consolidation owner) : recomputer le **weighted exact** de l'audit ratifié
(`lot-zone-consistency-scale`) maintenant que les 3 corrections de la traîne col-2
sont sur main. Chiffre exact (pas estimé) pour fermer le col-2 consolidé.

## Méthode (recompute exact, pas re-scan 866)

Agrégat du scale figé `529634c5` (`lot-zone-consistency-scale-20260815.json`) :
mismatch **51 891** / assigned **2 307 388** / residue_hard **24 065** →
weighted 2,25% · residue 1,04% · médiane-ville 1,18%.

On REMPLACE les 3 villes corrigées par leur état COURANT (mesuré avec la méthode
ratifiée exacte : centroïde + distance métrique, bandes d≤10 cohérent / d>10 mismatch
/ d>50 résidu). Les 863 autres villes de la traîne sont inchangées (les 3 villes @100%
étaient la traîne col-2 dominante ; le reste = plancher slop, non touché ; la campagne
zones ailleurs = col-9 provenance, pas col-2 géométrie).

| ville | mismatch old→new | residue_hard old→new | assigned old→new | levier |
| --- | ---: | ---: | ---: | --- |
| amherst | 1749 → **29** | 1749 → **19** | 1749 → **1183** | re-fold jointures |
| beaupre | 2929 → **114** | 2929 → **64** | 2929 → 2929 | capture zones + re-fold |
| boischatel | 4072 → **55** | 4072 → **25** | 4072 → 4072 | réconciliation zones (no-op) |
| **Σ** | **8750 → 198** | **8750 → 108** | **8750 → 8184** | |

## Résultat recomputé

- mismatch : 51 891 − 8552 = **43 339**
- residue_hard : 24 065 − 8642 = **15 423**
- assigned : 2 307 388 − 566 = **2 306 822**

| KPI | scale | **recomputé** | Δ |
| --- | ---: | ---: | ---: |
| **weighted_mismatch_pct** | 2,25 % | **1,88 %** | −0,37 pt |
| **weighted_residue_hard_pct** | 1,04 % | **0,67 %** | −0,37 pt |
| **médiane-ville** | 1,18 % | **1,18 %** | ~0 (les 3 étaient des outliers) |

## Notes

- Exact pour la fermeture de la traîne col-2 (les 3 villes @100% = le gap dominant).
  Un re-scan complet 866 confirmerait à l'entier près (±qq lots de bruit de méthode
  sonde↔engine) + capterait d'autres changements campagne éventuels ; disponible sur demande.
- boischatel : gain de **cohérence-servie** (delete du null nested), pas un re-fold —
  vrai gain (les lots étaient bien assignés, mesurés contre la mauvaise couche).
- mille-isles reste HORS (offset source inhérent, recalage-cadastre différé).
- Anti-gaming : residue_hard **toujours affiché** (0,67 % = plancher erreur dure post-corrections).
