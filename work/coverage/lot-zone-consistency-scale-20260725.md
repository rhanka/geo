# Cohérence lot↔zone à l'échelle — 2026-07-25

Mesure RÉELLE, lecture seule (S3), zéro écriture / zéro dépôt. Outil : `acquisition/src/lot-zone-consistency-audit.ts` (fonction `auditCity` réutilisée telle quelle), exécuté par un pool de processus avec reprise idempotente (JSONL append-only).

## 1. Univers mesurable

| Ensemble | n |
| --- | ---: |
| Univers portefeuille (rapport) | 1 106 |
| Collections `qc-zonage-<slug>` servies | 871 |
| Collections `qc-lots-<slug>` servies | 897 |
| **Auditables (zonage ET lots servis)** | **867** |
| Zonage servi mais PAS de lots | 4 |
| Lots servis mais PAS de zonage | 30 |
| Ni zonage ni lots servis (reste du portefeuille) | 239 |

Pourquoi les autres ne sont pas auditables — **aucune extrapolation** : l'audit croise deux géométries SERVIES ; sans l'une des deux il n'y a rien à comparer.

- **4 villes** ont un zonage servi mais aucun `qc-lots` servi : les-cedres, saint-marc-du-lac-long, saint-theodore-dacton, sainte-justine-de-newton.
- **30 villes** ont des lots servis mais aucun `qc-zonage` servi (rien à quoi confronter le `code_zone`) : aguanish, alleyn-et-cawood, aumond, baie-durfe, baie-johan-beetz, beaconsfield, beauharnois, begin, blainville, blanc-sablon, bois-des-filion, bois-franc, bonne-esperance, bouchette, brome, bryson, cacouna, calixa-lavallee, campbells-bay, caniapiscau, cap-chat, cayamant, chapais, chartierville, chibougamau, chichester, clarendon, colombier, cote-nord-du-golfe-du-saint-laurent, sainte-anne-de-bellevue.
- Les **239** villes restantes du portefeuille n'ont ni l'un ni l'autre servi — hors de portée de cette mesure par construction.

## 2. Couverture de la passe

| Statut | n |
| --- | ---: |
| Mesurées et **concluantes** (≥ 1 lot avec `code_zone`) | 837 |
| Mesurées mais **non concluantes** (0 lot assigné ⇒ taux non calculable) | 30 |
| **Non mesurées** (erreur / interruption) | 0 |
| Restant à traiter (hors passe) | 0 |
| **Total auditable** | **867** |

## 3. Résultat agrégé

| Grandeur | Valeur |
| --- | ---: |
| Lots examinés (villes mesurées) | 3 371 939 |
| Lots avec `code_zone` (dénominateur) | 2 278 475 |
| Lots `matched` | 2 179 607 |
| Lots `misassigned` (dans une AUTRE zone servie) | 87 556 |
| Lots `outside_all` (hors de TOUTE zone servie) | 11 312 |
| Lots `unassigned` (exclus du taux) | 1 093 464 |
| **Mismatch pondéré par les lots** | **4,34 %** |
| Mismatch médian par ville | 2,58 % |
| Mismatch p90 par ville | 5,72 % |

### Distribution du mismatch (villes concluantes)

| Bande | Villes | Lots assignés |
| --- | ---: | ---: |
| 0 % (parfait) | 8 | 595 |
| ] 0 – 1 %] | 40 | 45 481 |
| ] 1 – 2 %] | 223 | 368 912 |
| ] 2 – 5 %[ | 445 | 1 185 846 |
| [5 – 10 %[ | 87 | 626 051 |
| [10 – 25 %[ | 14 | 32 687 |
| [25 – 50 %[ | 3 | 9 634 |
| [50 – 100 %] | 17 | 9 269 |
| **Total** | **837** | **2 278 475** |

### Seuil KPI 5 %

Règle du rapport (`docs/spec/SPEC_PORTFOLIO_REPORT.md`) : ville `complete` ssi `mismatch_pct < 5 %`.

- **716 villes < 5 %** (`complete`) — soit 85,54 % des villes concluantes.
- **121 villes ≥ 5 %** (`incomplete`) — file de travail de correction.
- 30 villes non concluantes + 0 non mesurées : à NE PAS compter comme `complete` (leur `mismatch_pct` vaut 0 mécaniquement, pas par qualité).
- Couverture atteinte : 867 villes sur un minimum requis de 553 (50 % de 1 106) ⇒ le KPI **peut** sortir de « donnée insuffisante ».

## 4. TOP 20 des pires villes (par taux de mismatch)

| # | Ville | mismatch | assignés | misassigned | outside_all | unassigned |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | amherst | 100,00 % | 1 749 | 1 132 | 617 | 84 |
| 2 | baie-des-sables | 100,00 % | 1 | 0 | 1 | 1 111 |
| 3 | hatley-township-municipality | 100,00 % | 2 | 0 | 2 | 274 |
| 4 | saint-barnabe-sud | 100,00 % | 1 | 0 | 1 | 680 |
| 5 | saint-camille-de-lellis | 100,00 % | 1 | 0 | 1 | 929 |
| 6 | saint-cyprien--les-etchemins | 100,00 % | 18 | 0 | 18 | 740 |
| 7 | saint-cyrille-de-lessard | 100,00 % | 3 | 0 | 3 | 1 243 |
| 8 | saint-marcellin | 100,00 % | 3 | 0 | 3 | 1 005 |
| 9 | varennes | 98,68 % | 3 268 | 3 223 | 2 | 5 019 |
| 10 | ormstown | 95,58 % | 2 397 | 2 288 | 3 | 24 |
| 11 | bedford--brome-missisquoi--2 | 91,67 % | 36 | 1 | 32 | 608 |
| 12 | hemmingford--les-jardins-de-napierville | 90,00 % | 20 | 0 | 18 | 472 |
| 13 | disraeli--les-appalaches | 83,33 % | 36 | 0 | 30 | 1 446 |
| 14 | saint-celestin--nicolet-yamaska | 68,75 % | 16 | 0 | 11 | 661 |
| 15 | notre-dame-de-lourdes--joliette | 65,74 % | 1 687 | 1 096 | 13 | 59 |
| 16 | amos | 53,85 % | 13 | 0 | 7 | 502 |
| 17 | val-dor | 50,00 % | 18 | 0 | 9 | 111 |
| 18 | saint-bernard-de-lacolle | 28,73 % | 181 | 0 | 52 | 955 |
| 19 | saint-raphael | 28,52 % | 2 637 | 748 | 4 | 0 |
| 20 | cowansville | 27,96 % | 6 816 | 1 889 | 17 | 4 |

⚠️ Les taux à ~100 % en tête de ce classement ont un **dénominateur minuscule** (p. ex. 1 lot assigné sur 1 000 lots servis) : ce sont des villes où la jointure lot→zone est quasi absente, pas des villes massivement mal jointes. Le classement exploitable est le suivant.

### TOP 20 robuste (≥ 200 lots assignés)

| # | Ville | mismatch | assignés | misassigned | outside_all | unassigned |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | amherst | 100,00 % | 1 749 | 1 132 | 617 | 84 |
| 2 | varennes | 98,68 % | 3 268 | 3 223 | 2 | 5 019 |
| 3 | ormstown | 95,58 % | 2 397 | 2 288 | 3 | 24 |
| 4 | notre-dame-de-lourdes--joliette | 65,74 % | 1 687 | 1 096 | 13 | 59 |
| 5 | saint-raphael | 28,52 % | 2 637 | 748 | 4 | 0 |
| 6 | cowansville | 27,96 % | 6 816 | 1 889 | 17 | 4 |
| 7 | berthierville | 17,09 % | 1 984 | 149 | 190 | 3 |
| 8 | plaisance | 14,17 % | 833 | 21 | 97 | 4 |
| 9 | schefferville | 13,07 % | 482 | 55 | 8 | 0 |
| 10 | saint-pierre | 12,69 % | 268 | 3 | 31 | 21 054 |
| 11 | saint-amable | 12,08 % | 4 154 | 359 | 143 | 1 059 |
| 12 | hampstead | 11,88 % | 1 861 | 40 | 181 | 5 |
| 13 | montreal | 11,81 % | 10 800 | 1 215 | 60 | 669 287 |
| 14 | temiscaming | 11,43 % | 245 | 26 | 2 | 4 |
| 15 | sainte-famille-de-lile-dorleans | 11,14 % | 664 | 73 | 1 | 0 |
| 16 | westmount | 10,99 % | 5 013 | 506 | 45 | 27 |
| 17 | saint-lin-laurentides | 10,74 % | 4 200 | 181 | 270 | 6 735 |
| 18 | beaulac-garthby | 10,37 % | 2 074 | 56 | 159 | 10 |
| 19 | esterel | 9,80 % | 898 | 21 | 67 | 7 |
| 20 | saint-maxime-du-mont-louis | 9,67 % | 486 | 7 | 40 | 41 |

18 villes ≥ 5 % avec < 200 lots assignés (dénominateur trop petit, à traiter comme un défaut de JOINTURE, pas de géométrie) : baie-des-sables (1/1 112) · hatley-township-municipality (2/276) · saint-barnabe-sud (1/681) · saint-camille-de-lellis (1/930) · saint-cyprien--les-etchemins (18/758) · saint-cyrille-de-lessard (3/1 246) · saint-marcellin (3/1 008) · bedford--brome-missisquoi--2 (36/644) · hemmingford--les-jardins-de-napierville (20/492) · disraeli--les-appalaches (36/1 482) · saint-celestin--nicolet-yamaska (16/677) · amos (13/515) · val-dor (18/129) · saint-bernard-de-lacolle (181/1 136) · franquelin (43/43) · lac-superieur (66/66) · notre-dame-de-bonsecours (54/230) · kingsbury (165/165).

## 5. TOP 20 par VOLUME de lots en défaut (impact absolu)

| # | Ville | lots en défaut | mismatch | assignés | misassigned | outside_all |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | laval | 7 396 | 5,29 % | 139 794 | 7 261 | 135 |
| 2 | longueuil | 3 767 | 5,62 % | 66 975 | 3 740 | 27 |
| 3 | quebec | 3 585 | 5,44 % | 65 961 | 3 516 | 69 |
| 4 | varennes | 3 225 | 98,68 % | 3 268 | 3 223 | 2 |
| 5 | ormstown | 2 291 | 95,58 % | 2 397 | 2 288 | 3 |
| 6 | trois-rivieres | 2 076 | 4,94 % | 42 003 | 2 037 | 39 |
| 7 | cowansville | 1 906 | 27,96 % | 6 816 | 1 889 | 17 |
| 8 | gatineau | 1 838 | 4,63 % | 39 663 | 1 811 | 27 |
| 9 | amherst | 1 749 | 100,00 % | 1 749 | 1 132 | 617 |
| 10 | granby | 1 661 | 6,40 % | 25 946 | 1 587 | 74 |
| 11 | brossard | 1 660 | 6,70 % | 24 793 | 1 513 | 147 |
| 12 | sherbrooke | 1 649 | 4,49 % | 36 754 | 1 582 | 67 |
| 13 | drummondville | 1 536 | 5,00 % | 30 721 | 1 512 | 24 |
| 14 | levis | 1 332 | 4,41 % | 30 225 | 1 322 | 10 |
| 15 | montreal | 1 275 | 11,81 % | 10 800 | 1 215 | 60 |
| 16 | saint-hyacinthe | 1 254 | 6,47 % | 19 379 | 1 246 | 8 |
| 17 | repentigny | 1 237 | 4,30 % | 28 798 | 1 221 | 16 |
| 18 | saint-jerome | 1 150 | 4,10 % | 28 037 | 1 085 | 65 |
| 19 | notre-dame-de-lourdes--joliette | 1 109 | 65,74 % | 1 687 | 1 096 | 13 |
| 20 | boucherville | 986 | 6,07 % | 16 242 | 942 | 44 |

## 6. Non mesurables / non mesurées — et pourquoi

### 27 villes mesurées mais SANS aucun lot porteur de `code_zone` (taux non calculable)

Leurs lots servis existent mais sont tous dépourvus de `code_zone` : la jointure lot→zone n'a jamais été repliée (ou a été effacée). Ce n'est PAS une cohérence de 100 %, c'est une absence de donnée — et le KPI la compterait `complete` à tort (`mismatch_pct` = 0 mécanique).

riviere-au-tonnerre (63 lots) · sainte-gertrude-manneville (285 lots) · saint-pie-de-guire (724 lots) · notre-dame-du-bon-conseil--drummond--2 (911 lots) · saint-marcel-de-richelieu (593 lots) · bethanie (333 lots) · sainte-clotilde-de-beauce (629 lots) · fort-coulonge (931 lots) · sainte-madeleine (947 lots) · saint-joachim (993 lots) · les-hauteurs (626 lots) · sacre-coeur-de-jesus (818 lots) · saint-martin (1 818 lots) · saint-marcel (907 lots) · saint-pamphile (1 742 lots) · sainte-anne-de-beaupre (2 130 lots) · saint-anaclet-de-lessard (2 310 lots) · frontenac (1 339 lots) · lac-des-plages (1 409 lots) · lislet (3 800 lots) · saint-ferreol-les-neiges (3 090 lots) · saint-louis-de-gonzague-du-cap-tourmente (3 284 lots) · low (1 262 lots) · mont-blanc (4 996 lots) · saint-michel-des-saints (3 547 lots) · rouyn-noranda (629 lots) · saguenay (19 135 lots)

### 3 villes dont la collection `qc-lots` servie est VIDE (0 entité)

metis-sur-mer · lile-danticosti · havre-saint-pierre

## 7. Contrôle de non-régression

Seule ville de la mesure antérieure (`work/coverage/lot-zone-consistency.json`) : **mont-saint-hilaire**, mesurée là à 4,9 % (361 misassigned / 58 outside_all / 8 547 assignés). Cette passe reproduit **4,90 %** (361 / 58 / 8 547) — **identique**. La méthode et le pipeline sont donc reproductibles ; l'ancien fichier n'est pas contredit, il est seulement 866 fois trop étroit.

## 8. Lecture

- Le mismatch pondéré par les lots (**4,34 %**) est la mesure de référence ; la médiane par ville (2,58 %) montre que le défaut est **concentré**, pas diffus.
- `misassigned` domine `outside_all` (87 556 vs 11 312) : le mode de défaillance principal est une jointure calculée contre une géométrie de zone ANTÉRIEURE, pas un lot hors couverture.
- **1 093 464 lots servis sur 3 371 939 (32,43 %) n'ont AUCUN `code_zone`** : c'est un gisement de qualité distinct et plus gros que le mismatch lui-même. Il est concentré sur quelques très grosses villes — montreal à lui seul porte 669 287 lots non assignés sur 680 087 servis (seuls 10 800 lots y sont joints à une zone), et saguenay 19 135/19 135.
- Conséquence pour le KPI : appliqué tel quel, il compterait `complete` les 30 villes à 0 lot assigné (mismatch 0 mécanique). Le JSON les marque `status: "inconclusive_zero_assigned"` et `mismatch_pct: null` pour permettre de les exclure explicitement.
- Rappel méthode : le centroïde est un proxy premier ordre. Les villes du TOP 20 sont des CANDIDATS de re-fold, à confirmer ville par ville (cf. mémoire `rectifier-zone-exige-refold-lots`).
