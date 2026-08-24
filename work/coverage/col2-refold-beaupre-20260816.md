# col-2 — re-fold BEAUPRE (codeMissing hors-zone, post-capture zones) : 100% → 3,65%

## Contexte

2e re-fold de la campagne col-2 (après amherst `4ff09f7a`). beaupre était dans la
traîne « géométrie SOURCE » (codeMissing 2929/2929 HORS-ZONE : les zones servies ne
couvraient AUCUN lot). geo-zones a **capturé + déposé la v2** (`cea1a7c7`) : le
qc-zonage servi porte enfin le VRAI zonage (78 zones réelles, documented, flat+nested
byte-exact, ancienne affectation-null retirée+backupée). Les lots tombent désormais
dans les vraies zones → re-foldable (levier passe de SOURCE-zones à JOINTURES).

**Gate** : geo-zones GO explicite (beaupre FIXÉ) ; vérifié flat==nested byte-exact
(`_amherst-zone-layout-check --slug beaupre`, etag identique) → runner flat-first lit
les vraies zones. SAFE.

## Exécution (chaîne committée idempotente)

1. backup non-destructif (`_replaced/…2026-08-16T045020220ZZ`).
2. `lot-zone-join-run --slug beaupre` → containment contre les 78 vraies zones :
   **assigned 99,86%** (vs 0% avant), codes réels (68-Ri2, 63-Ri1) avec normes.
3. `lots-enriched-run --slug beaupre --preserve-existing-optional-attrs --no-role --no-fsa`
   → re-matérialise (adresse "2000 boulevard Beau-Pre" **préservée** 97,95%, deposit=Y).

## Résultat vérifié (`_col2-offset-characterize` post-re-fold)

| | avant (scale) | après |
| --- | ---: | ---: |
| assigned | 2929 | 2929 |
| mismatch | 2929 (100%) | **107 (3,65%)** |
| codeMissing | 2929 | **0** |

Reste 107 = slop de frontière (dispersé, médiane 53 m). codeMissing 0 (tous les
codes existent désormais).

## Gain col-2 cumulé (amherst + beaupre)

- beaupre : −2822 mismatch → **~−0,12 pt** weighted.
- amherst (`4ff09f7a`) : −1729 mismatch → ~−0,08 pt.
- **Cumulé : weighted 2,25% → ~2,05% (−0,20 pt)**.

Synergie campagne : zones capture/dépose la v2 (source), jointures re-folde
(assignation) → col-2 se ferme. mille-isles reste NON-re-foldable (offset source
inhérent MRC Argenteuil, shift 0 m à la ré-acq → recalage-cadastre différé, geo-zones).
boischatel : réconciliation-layout zones en cours → re-fold à réception du ping.
