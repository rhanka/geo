# Recalage PDF — shard 0/1 — 2026-07-17T07:47:51Z

Règle appliquée : uniquement des zones municipales depuis des plans officiels ou
archivés déjà identifiés comme officiels ; aucun zonage d'affectation et aucune
géométrie/cote inventée. Les échecs ci-dessous sont des gates effectifs, pas des
résultats négatifs déduits.

| Slug | Entrée contrôlée | Résultat | Décision |
|---|---|---|---|
| bowman | plan PDF archivé | T3 : 7 GCP indépendants, seuil 8 | rejeté |
| inverness | plans municipaux 1 et 2 de 3 + grille officielle | S1 : 33 GCP, labels Claude dict-validés ; S2 : 12 GCP mais gate spatial 4,95 km | non déposé |
| sainte-therese-de-la-gatineau | `plan.pdf` archivé | règlement de 124 pages, sans géoréf T1 ; aucune feuille de zonage isolée | rejeté |
| riviere-eternite | feuilles urbaine et territoire archivées | urbaine : 5 matches indépendants, seuil 6 ; territoire : anisotropie minimale 1,319, seuil 1,1 | rejeté |
| la-tuque | `la-tuque-zonage.pdf` archivé | aucun `/VP`/`/Measure`/`/GEO` lisible par T1 | rejeté |
| ange-gardien | plan urbain archivé | T1 GPTS présent mais résidu des coins 996,21 m, seuil 50 m | rejeté |
| saint-mathieu-du-parc | deux plans de zonage archivés | aucun `/VP`/`/Measure`/`/GEO` lisible par T1 | rejeté |
| noyan | R444 archivé + inventaire municipal antérieur | R444 = construction, pas zonage ; le zonage R442 n'est pas publié | rejeté |

## Inverness — preuve détaillée

La source municipale officielle est
`https://www.invernessquebec.ca/fr/citoyens/urbanisme-et-environnement/reglements-d-urbanisme/`.
La grille officielle a fourni les 80 codes du dictionnaire, y compris `A/R-*` et
`R/C-*`. Les libellés de plan étaient des glyphes : lecture Claude 4.8 locale,
conservée dans `work/reads/`, puis validation stricte par ce dictionnaire.

* Feuillet 1 : le recalage raster T3 a 33 GCP indépendants ; le build à blanc a
  validé 35 codes et passé son gate spatial (1,166 km).
* Feuillet 2 : le recalage raster T3 a 12 GCP indépendants, résidu maximal
  14,774 m et holdout maximal 12,321 m. Les 24 lectures sont toutes validées par
  dictionnaire, mais le build à blanc échoue le gate spatial : 4,95 km du
  cadastre, avec seulement 11/24 labels dans sa boîte.
* Les deux feuillets sont complémentaires. Le runner multisheet T2 stable ne
  supporte pas les lectures Claude ; le runner Claude disponible exige T1
  embarqué, absent ici. Aucun dépôt partiel ou assemblage ad hoc n'a été fait.

## Références de preuves

* `work/delegation-mass/zones-recalage-20260717T-bowman-t3-register.json`
* `work/delegation-mass/zones-recalage-20260717T-inverness-s1-t3-register.json`
* `work/delegation-mass/zones-recalage-20260717T-inverness-s2-t3-register.json`
* `work/gcp/riviere-eternite-territoire.report.json`
* `work/delegation-mass/zones-recalage-2/noyan.json`

Résultat de ce lot : 0 dépôt supplémentaire. Le refus d'Inverness protège
l'exactitude spatiale malgré la disponibilité de vraies sources et de vrais codes.
