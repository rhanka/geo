# col-2 — BOISCHATEL : fixé par la réconciliation zones (NO-OP re-fold, vérifié)

## Résultat

**100% → 1,28%** (mismatch 4072→52, codeMissing 4072→0) — **sans re-fold jointures**.

3e ville de la campagne col-2 (après amherst `4ff09f7a`, beaupre `2ac44408`), mais
ici le levier était **entièrement côté zones** : geo-zones a réconcilié le layout
(`6d532474`, option A) — la couche **nested null mal-déposée** (17 poly, 0 code,
backupée+supprimée) retirée → geo-api sert désormais le **flat = 55 vraies zones**
(Cn1-105, V1-106, Dd-008…), layout unique.

## Pourquoi PAS de re-fold (vérifié avant d'écrire)

Le qc-lots servi boischatel portait **DÉJÀ** les bons codes (Dd-008, Ru-057, Up-031 ;
zone_code 99,88%) qui matchent le flat. Le « 100% mismatch » du scale venait
uniquement de ce que geo-api servait le NULL nested (0 code) → les codes ne
matchaient pas le null. La suppression du null nested → geo-api sert le flat → les
codes matchent → **col-2 cohérent sans réassignation** (comme saint-hyacinthe = no-op).

Vérifié `_col2-offset-characterize --slug boischatel` après suppression : assigned
4072, mismatch **52 (1,28%)**, codeMissing 0. Les 52 = slop de frontière (R=0,13),
le plancher. **Aucun `lots-enriched-run` exécuté** — qc-lots servi intact.
(Le parquet qc-lot-zonage a été re-dérivé par `lot-zone-join-run` mais à contenu
identique — inoffensif ; backup `_replaced/…050620639`.)

## Bilan campagne col-2 (levier jointures)

| ville | avant | après | levier |
| --- | ---: | ---: | --- |
| amherst | 100% | 1,69% | RE-FOLD jointures (`4ff09f7a`) |
| beaupre | 100% | 3,65% | RE-FOLD jointures post-capture zones (`2ac44408`) |
| **boischatel** | 100% | **1,28%** | **zones seul (suppression null nested) — no-op jointures** |
| mille-isles | 99,8% | — | NON-refoldable (offset source inhérent, différé) |

⚠ Col-3 séparée : grille de normes boischatel périmée pour les nouvelles zones
(match 0,47%) → re-extraction normes (lane norms/zones, KPI col-3, hors col-2).
