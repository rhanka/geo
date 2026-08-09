# Lots Immo sans `code_zone` — vivier B — 2026-07-26

Source : `work/coverage/lot-zone-consistency-scale-20260725.json`, cohorte des 170 villes Immo, Montréal exclue. La mesure croisée couvre 140 villes : 47 253 / 567 925 lots sans code. Trois villes Immo hors mesure faute de `qc-zonage` ont été lues directement : 2 065 / 2 065 lots sans code. Total connu : **49 318 / 569 990 (8,65 %)**.

## Classement (top 20, lots sans code)

| # | Ville | Sans code | Lots | Assignés | Mismatch |
|---:|---|---:|---:|---:|---:|
| 1 | saguenay | 19 135 | 19 135 | 0 | — |
| 2 | varennes | 5 019 | 8 287 | 3 268 | 98,68 % |
| 3 | mont-blanc | 4 996 | 4 996 | 0 | — |
| 4 | lislet | 3 800 | 3 800 | 0 | — |
| 5 | saint-boniface | 1 937 | 3 842 | 1 905 | 1,73 % |
| 6 | pont-rouge | 1 841 | 5 906 | 4 065 | 3,84 % |
| 7 | bouchette* | 1 726 | 1 726 | — | — |
| 8 | disraeli--les-appalaches | 1 446 | 1 482 | 36 | 83,33 % |
| 9 | baie-des-sables | 1 111 | 1 112 | 1 | 100,00 % |
| 10 | hemmingford--les-jardins-de-napierville--2 | 1 081 | 1 618 | 537 | 8,38 % |
| 11 | saint-amable | 1 059 | 5 213 | 4 154 | 12,08 % |
| 12 | saint-marcel-de-richelieu | 593 | 593 | 0 | — |
| 13 | saint-aubert | 590 | 2 013 | 1 423 | 1,26 % |
| 14 | amos | 502 | 515 | 13 | 53,85 % |
| 15 | gaspe | 420 | 1 614 | 1 194 | 1,42 % |
| 16 | stratford | 312 | 2 021 | 1 709 | 4,21 % |
| 17 | brome* | 299 | 299 | — | — |
| 18 | sainte-cecile-de-milton | 299 | 1 518 | 1 219 | 6,89 % |
| 19 | huberdeau | 228 | 876 | 648 | 4,17 % |
| 20 | saint-benoit-labre | 214 | 1 710 | 1 496 | 1,87 % |

\* Lecture directe `qc-lots`: 0 code; absence de collection `qc-zonage` confirmée. Le JSON détaille les rangs 21–40; les 58 suivantes ont 1 à 27 lots sans code.

## Causes mesurées

| Cause | Lots | Décision |
|---|---:|---|
| Pas de `qc-zonage` | 2 065 | Bouchette, Brome, Chibougamau : acquérir polygones en vigueur + code + preuve v2. |
| Matérialisation `qc-lots` périmée | 24 167 | Saguenay, Mont-Blanc, Hemmingford (34), Saint-Marcel (2). Voir contrôles ci-dessous. |
| Fold exécuté mais code nul par couverture géométrique | 23 086 | Ré-acquérir/corriger la couverture, jamais attribuer par proximité. |
| Zonage sans aucun code exploitable | 0 | Aucun gros cas. |

Preuves top : parquet et `qc-lots` sont synchrones à Varennes (3 268), Saint-Boniface (1 905), Pont-Rouge (4 065), Disraeli (36), Baie-des-Sables (1), Saint-Amable (4 154), Saint-Aubert (1 423), Amos (13), Gaspé (1 194), Stratford (1 709), Sainte-Cécile (1 219), Huberdeau (648) et Saint-Benoît-Labre (1 496). Lislet est confirmé à 0/3 800 et Baie-des-Sables à 1/1 112 par dry-run actuel : le manque est géométrique, pas un code inventable.

## Re-folds

| Ville | Avant | Après tentative | Décision |
|---|---|---|---|
| saguenay | 19 135/19 135, mismatch 5,30 % | identique | Conservé; le zéro-code du 25 juillet avait déjà été corrigé avant notre backup. Gain net propre : 0. |
| mont-blanc | 0/4 996, mismatch non calculable | 4 898/4 996, mismatch 3,10 % | **Restauré** depuis `2026-07-26T033049416ZZ`; vérification finale 0/4 996. |

Tous les runs S3 ont utilisé `NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10`. Les collections `qc-zonage` n'ont pas été écrites. Gain net retenu : **0 lot**.
