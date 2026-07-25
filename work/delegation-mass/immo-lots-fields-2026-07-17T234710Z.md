# WP9 — champs lot immo, shard 0/1

Date de re-mesure S3 : `2026-07-17T23:47:10.603Z`.

## Avant / après par champ

| Champ | Avant (lots/denom.) | Après (lots/denom.) | Écart mesuré |
| --- | ---: | ---: | ---: |
| `surface_m2` | 3 368 162 / 3 368 162 (100 %) | 3 368 162 / 3 368 162 (100 %) | 0 |
| `adresse` | 2 542 382 / 3 368 162 (75,48 %) | 2 542 382 / 3 368 162 (75,48 %) | 0 |
| `code_postal` | 3 368 161 / 3 368 162 (100 % arrondi) | 3 368 161 / 3 368 162 (100 % arrondi) | 0 |
| `folded-normes` | 860 646 / 3 368 162 (25,55 %) | 862 611 / 3 368 162 (25,61 %) | +1 965 |
| `in_tod` (périmètre TOD) | 28 431 / 28 431 (100 %) | 28 431 / 28 431 (100 %) | 0 |

Le gain `folded-normes` est une différence S3 observée entre les deux audits. Le worktree et les dépôts S3 étant partagés, il n'est pas attribué à cette exécution : le contrôle ciblé d'Acton Vale reste à 154/4 273 (3,60 %).

## Villes traitées et vérifiées

- Adresse, rôle foncier activé (jamais `--no-role`) : `saint-louis-de-gonzague-du-cap-tourmente`, `stanstead--memphremagog`, `saint-felix-de-dalquier`, `temiscouata-sur-le-lac`, `amqui`, `coaticook`, `hemmingford--les-jardins-de-napierville--2`, `nicolet` et `acton-vale`.
- Les sorties S3 vérifiées ne montrent aucun gain d'adresse pour ce lot. Les causes explicites sont : chevauchement rôle insuffisant pour `saint-louis-de-gonzague-du-cap-tourmente`, aucun candidat `code_geo` pour `saint-felix-de-dalquier`; les autres villes restent au plafond de leurs jointures rôle existantes.
- Normes : présence S3 du parquet `qc-zonage-norms` vérifiée pour `mont-blanc`, `farnham`, `brownsburg-chatham`, `lac-brome`, `acton-vale`, `boischatel`, `nicolet` et `temiscouata-sur-le-lac`. La jointure puis le ré-enrichissement d'`acton-vale` sont déposés et vérifiés; le taux de correspondance exact code-zone→norme est 3,69 %, donc 154 lots foldés, sans extrapolation.
- Résidu `code_postal` : `pierreville` re-enrichie et vérifiée, 1 830/1 831 (99,95 %). Le lot restant est hors RTA/FSA; aucune valeur n'a été fabriquée.
- Résidu `surface_m2` : aucun lot restant dans l'audit de départ ni d'arrivée.

## Villes skippées / non comptées

- `quebec` : exécution interrompue avant résumé de dépôt; non comptée comme traitée, l'audit reste à 59 513/66 054 adresses (90,10 %).
- `mont-blanc` : jointure zone→norme arrêtée par la limite dure de 360 s, sans sortie ni dépôt vérifiable; non comptée.
- `farnham`, `brownsburg-chatham`, `lac-brome`, `boischatel`, `nicolet`, `temiscouata-sur-le-lac` : non lancées après la timebox de `mont-blanc`; restent à reprendre dans une exécution isolée.

## Preuves

- Audit avant : `work/coverage/immo-lots-before-20260717T-fields-shard0.json`.
- Audit après : `work/coverage/immo-lots-after-20260717T-fields-shard0.json`.
- Les deux audits lisent les sidecars S3 de 853 produits `qc-lots`; aucun statut n'est déduit d'un log local.
