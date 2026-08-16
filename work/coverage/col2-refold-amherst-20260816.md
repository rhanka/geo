# col-2 — re-fold AMHERST (codeMissing contenu) : 100% → 1,69%

## Contexte

Post-ratification `SPEC_COL2_COHERENCE_AUDIT` + validation (scale 866/866,
weighted 2,25%). La caractérisation (`col2-characterization-routing-20260815.md`,
`f076432f`) a identifié **amherst** comme le **seul levier JOINTURES direct** de la
traîne : 1749 lots @ 100% mismatch parce que leur `code_zone` assigné (vieille
version) est ABSENT des zones servies courantes (codeMissing), dont **1132
géométriquement CONTENUS** dans une autre zone servie (mislabellés) → re-foldables.

**GATE respecté** : geo-zones a confirmé le GO (aucun recalage/ré-acquisition en
cours sur amherst ; qc-zonage servi FINAL/autoritaire). Vérifié : amherst est
**flat-only** (nested absent) → pas de piège flat/nested périmé, le runner lit la
bonne géométrie servie.

## Exécution (runners committés, backup non-destructif)

1. `_lot-zone-refold-s3 --slug amherst --mode backup` → backup S3
   (`_replaced/…2026-08-16T041407341ZZ`) : qc-lots geojson+stats + qc-lot-zonage parquet+stats.
2. `lot-zone-join-run --slug amherst` → re-dérive `code_zone` par aire-majorité
   containment contre les zones servies courantes (parquet re-écrit).
3. `lots-enriched-run --slug amherst --preserve-existing-optional-attrs --no-role --no-fsa`
   → re-matérialise le qc-lots servi (adresse/CP **préservés** verbatim, guard
   anti-régression OK ; deposit=Y, 9 236 054 o).

## Résultat vérifié (`_col2-offset-characterize` post-re-fold)

| | avant | après |
| --- | ---: | ---: |
| assigned | 1749 | **1183** |
| mismatch | 1749 (100%) | **20 (1,69%)** |
| codeMissing | 1749 | **0** |

- Les **1132 contenus** portent désormais leur code de zone contenante réel
  (ex. `10-F`, dominant_fraction=1, avec normes) → cohérents. Reste 20 = slop de
  frontière (dispersé, médiane 31 m).
- Les **~650 hors-zone** (les 617 out-of-zone + qq) → `code_zone` **null**
  (unassigned honnête ; aucune zone servie ne les couvre) → exclus du dénominateur,
  jamais un code inventé (anti-invention). Ils restent candidats ré-acquisition
  (triage zones `zones-col2-source-triage-20260816`).

## Gain col-2 (weighted, pour l'owner)

amherst 1749→20 mismatch, assigned 1749→1183 →
**weighted 2,25% → ~2,17% (−0,08 pt)** ; residue_hard 1,04% → ~0,97%.

Petit en points (une ville), mais **ferme intégralement le mislabel** (100%→1,69%)
et **prouve le levier codeMissing-contenu**. Le reste de la traîne (~8000 lots,
géométrie SOURCE) est routé zones/cadastre par geo-cond. Backup préservé ;
re-fold **idempotent** (si zones ré-acquiert amherst, re-fold trivial).
