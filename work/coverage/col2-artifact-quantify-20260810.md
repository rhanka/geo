# col-2 — quantification de l'artefact centroïde vs aire-majorité (dossier A/B)

## Contexte

Décision **A/B** routée archi+qa+owner (geo-cond `…hold-col2-methodo…t2005`) :
l'audit col-2 (`lot-zone-consistency-audit.ts`) flagge un lot MISASSIGNED quand
son **centroïde** tombe hors de sa zone `code_zone` assignée — or `code_zone` est
servi par **aire-majorité** (`lot-zone-join-run` / `assignLotZones`). Ces méthodes
divergent → mismatch structurel qu'un re-fold aire-majorité ne ferme PAS (prouvé :
saint-hyacinthe re-foldé = byte-identique, col-2 inchangé 6,47%).

- **A** = re-folder `code_zone` vers la zone du centroïde (audit-cohérent, col-2→~0)
  mais dévie de l'aire-majorité (un lot 96% dans B, centroïde dans un sliver de A → A).
- **B** = l'aire-majorité est la sémantique correcte → l'audit doit mesurer
  l'aire-majorité, le mismatch est un artefact de méthode, pas une erreur de donnée.

## Mesure (`_col2-artifact-quantify.ts`, méthode KPI exacte réutilisée)

Décomposition du `misassigned` par `multi_zone` (straddling) :

| ville | état | lots | mismatch | misassigned | …multi_zone | …**mono_zone** | outside | multi_zone_total |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **saint-hyacinthe** | **propre** (aire-maj vs v2 courante) | 19379 | 6,47% | 1246 | 338 | **908** | 8 | 880 |
| brossard | ⚠ non-refoldé vs v2 0dcb13a0 | 24823 | 7,38% | 1828 | 170 | 1658 | 0 | 411 |
| boucherville | ⚠ non-refoldé vs v2 0dcb13a0 | 16269 | 4,65% | 756 | 118 | 638 | 0 | 300 |
| varennes | contexte | 8287 | 4,98% | 404 | 58 | 346 | 9 | 146 |
| ormstown | contexte | 2421 | 2,81% | 64 | 35 | 29 | 4 | 96 |
| sorel-tracy | contexte | 16736 | 5,05% | 840 | 274 | 566 | 0 | 623 |
| drummondville | contexte | 30722 | 5,00% | 1512 | 344 | 1168 | 24 | 945 |

## Lecture (saint-hyacinthe = cas propre, seul non-confondu)

Le mismatch est **dominé par des lots MONO-zone** (908 vs 338 multi). Un lot
mono-zone est dominant (aire-majoritaire) dans UNE zone — correctement assigné —
mais son centroïde tombe de l'autre côté d'une frontière. Comme le cadastre (MERN)
et le zonage (municipal) sont des **couches de sources différentes**, leurs
frontières ne s'alignent pas au mètre : le centroïde d'un lot de bordure peut
franchir une zone voisine sans que l'assignation aire-majorité (basée sur le
recouvrement réel d'aire) soit fausse.

**Conclusion (non tranchante) :** ces 908 mono + 338 multi sont des artefacts
d'alignement/méthode, PAS des erreurs de donnée — l'aire-majorité assigne la zone
dominante, l'audit centroïde est sensible au désalignement de frontière. Cela
**renforce l'option B** (corriger l'audit vers l'aire-majorité, ou mesurer la
cohérence au recouvrement, plutôt que re-folder vers le centroïde = gaming du KPI).

⚠ brossard/boucherville : leur `code_zone` servi n'est PAS re-foldé contre la v2
`0dcb13a0` → leur mismatch mêle l'artefact ET le gap-non-refoldé ; non
interprétable pour A/B tant que non re-foldés. saint-hyacinthe est le seul cas
propre. **HOLD respecté : aucune écriture servie.**
