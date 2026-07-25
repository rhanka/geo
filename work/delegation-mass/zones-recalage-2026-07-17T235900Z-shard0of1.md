# Recalage PDF -> zones — shard 0/1 — lot 2026-07-17T23:59Z

## Dépôt confirmé

| slug | source officielle locale | voie | preuves de gate | résultat |
|---|---|---|---|---|
| `saint-polycarpe` | `work/zones-recalage/shard0-20260717T09/saint-polycarpe-plan-norot.pdf` | T2 texte | 42 GCP indépendants, résidu max 14,154 m, holdout 14,118 m; 16 codes lettrés réels, 16/16 dans la bbox; spatial 2,204 km; 1 199/1 785 lots (67,17 %) | **SERVI** : `normalized/ca-qc-zonage/qc-zonage-saint-polycarpe.geojson`, 16 entités. Jointure lots et enrichissement Immo lancés. |

Le produit Immo conserve la vérité observée : 67,17 % des lots ont un `zone_code`; les normes sont absentes (0 %) et ne sont pas inventées.

## Rejets / blocages conservés

| slug | voie vérifiée | preuve | verdict |
|---|---|---|---|
| `austin` | T1 texte puis Claude dict-validé | GeoPDF: résidu 0,16 m. Texte: 0 code admis. Claude: 125 lectures exactes contre le dictionnaire municipal, puis cadastre officiel `normalized/qc-cadastre-lots/austin.geojson` introuvable (`NoSuchKey`). | **ABORT** : aucune géométrie cadastrale, donc aucune zone servie. |
| `chertsey` | T3 -> T2 Claude dict-validé | 13 GCP indépendants, résidu 12,342 m, holdout 16,648 m; 82 lectures exactes. Mais seulement 4 038/8 378 lots (48,2 %) et 24/82 labels dans la bbox cadastrale, les autres venant d'encarts à une autre échelle. | **WITHHOLD** : couverture sous 50 % et encarts non recalables avec le plan principal. |
| `saint-ambroise` | T3 | 19 GCP indépendants, résidu 17,126 m, holdout 12,313 m; texte: 0 code de zone. | **ABORT** : glyphes sans dictionnaire municipal autoritaire disponible; aucune lecture vision non dictée. |
| `bethanie` | T2/T3 | Chamfer seulement, `independent:false`; T2 ne conserve au plus que 5 matches indépendants (minimum 6/8 selon voie). | **ABORT** : seed non servable, pas de GCP indépendants suffisants. |
| `montpellier` | T3 | 213 matches patch-vérifiés mais seulement 9 après pruning, seuil 12. | **ABORT** : GCP indépendants insuffisants. |
| `petit-saguenay` | T3 | 0 candidat, 0 match patch-vérifié, 0 GCP. | **ABORT** : aucune amorce indépendante. |
| `riviere-eternite` | T2 | Plan territoire: 20 seeds franchissent résidu/holdout, mais aucun ne franchit iso/orientation; plan urbain: aucun seed résidu/holdout. | **ABORT** : désambiguïsation géométrique non prouvée. |
| `sainte-thecle` | T3 | 10 candidates patch-vérifiés, seulement 5 GCP après pruning, seuil 12. | **ABORT** : GCP indépendants insuffisants. |

## Lot suivant — découverte officielle et preuves existantes

| slug | source / test | verdict |
|---|---|---|
| `aguanish` | Les pages municipales cacheées ne lient que des politiques, contrats et résolutions; aucun plan de zonage PDF. | **SKIP** : pas de plan officiel récupérable. |
| `alleyn-et-cawood` | T2 sur le PDF cacheé : `svg_points=0`, aucun seed, résidu/holdout non calculables. | **ABORT T2**. |
| `amherst` | Source municipale nouvellement revalidée : `352-02-Zonage-revise-2017.pdf` (87 pages). T1 : pas de `/VP /Measure /GEO`; la recherche textuelle du PDF ne donne aucun plan de zonage. | **ABORT T1/T2** : règlement sans plan recalibrable; pas de faux GeoPDF. |
| `aumond` | Pages municipales : règlement modificatif de zonage, sans plan autonome; T2 cacheé `svg_points=0`, aucun fit. | **ABORT T2**. |
| `baie-johan-beetz` | Pages municipales cacheées sans lien de plan; T2 `svg_points=0`, aucune calibration. | **ABORT T2**. |
| `begin` | Le site municipal expose les chapitres du règlement 15-288, mais le PDF de plan cacheé a `svg_points=0`, sans GCP ni résidu. | **ABORT T2**. |
| `belcourt` | Le plan rural vectoriel produit 15 seeds résidu/holdout valides, mais tous sont rejetés par iso/orientation (meilleur anisotropie 1,662 ou orientation à 90°). | **ABORT** : ne pas contourner le gate. |
| `blanc-sablon` | Page municipale officielle cacheée sans lien de plan de zonage PDF. | **SKIP** : pas de source à recalibrer. |

## Contrôles

- `loop-supervise.ts` avant et après le dépôt : `zones=857 -> 858`.
- Aucun owner harvest AGOL; aucun code séquentiel, code postal, affectation ou libellé inventé n'a été servi.
- Artefacts de ce lot : `work/zones-recalage/root-20260717-saint-polycarpe-{verify,live}/` et le présent JSON compagnon.
