# Provenance règlement — shard 0/2 — pliage de rattrapage 2

Date : 2026-07-17T21:00:00Z

Périmètre strict : slugs d’indice pair dans la liste triée `served && reglement=false`.

## Villes servies sur S3

Les neuf entrées ci-dessous étaient déjà curées dans le registre, mais la matrice de couverture les présentait comme sans règlement. Le pliage a été rejoué : `cellsChanged=0` sur chaque objet, ce qui prouve que les quatre champs étaient déjà déposés. Les numéros ont été relus directement dans les PDF ou corpus locaux avant l’opération.

| slug | avant norme servie | numéro verbatim | contrôle OGC `/items` |
|---|---|---|---|
| saint-eustache | `null` | `1288` — «REGLEMENT 1288 / Ville de Saint-Eustache», entrée en vigueur `88-02-17` (p1) | `1288` |
| saint-gilles | `null` | `363-08` — «RÈGLEMENT N° 363-08», adopté le 8 février 2008 (p1) | `363-08` |
| saint-marc-du-lac-long | `null` | `2015-02` — «Règlement de zonage numéro 2015 02» (p1) | `null` — cache geo-api antérieur au pliage, voir diagnostic |
| saint-prosper-de-champlain | `null` | `04-04-2009` — cité verbatim par le projet municipal modifiant ce règlement de zonage (p1) | `04-04-2009` |
| saint-rene | `null` | `119-06` — «LE RÈGLEMENT DE ZONAGE NO 119-06», adoption 5 novembre 2006 (p1) | `119-06` |
| sainte-angele-de-merici | `null` | `2010-06` — «modifiant le règlement de zonage numéro 2010-06» (p1) | `2010-06` |
| schefferville | `null` | `2013-120` — «Règlement de zonage n°: 2013-120», remplacement du `93-02-10` (p2) | `2013-120` |
| sorel-tracy | `null` | `2222` — «Règlement numéro 2222», adoption 25 février 2013 (p1) | `2222` |
| tres-saint-redempteur | `null` | `288-2026` — «RÈGLEMENT Nº 288-2026 / RÈGLEMENT DE ZONAGE» (p2) | collection OGC inconnue / cache, voir diagnostic |

## Diagnostic des deux contre-vérifications OGC négatives

Reproduction déterministe : après le pliage, l’API rend encore `null` pour `saint-marc-du-lac-long` et `404 Unknown collection` pour `tres-saint-redempteur`.

Preuves :

- l’inventaire S3 ne trouve pour chacun que la clé plate attendue, respectivement `normalized/ca-qc-zonage/qc-zonage-saint-marc-du-lac-long.geojson` et `.../qc-zonage-tres-saint-redempteur.geojson`;
- le repliage lit ces objets et produit `cellsChanged=0` avec les numéros `2015-02` et `288-2026`;
- un GET OGC à paramètre inédit livre pour Saint-Marc un instantané frais (`timeStamp=2026-07-17T20:58:18Z`) mais sans les champs, et la collection Très-Saint-Rédempteur reste inconnue.

Cause établie : l’API conserve une collection en mémoire indépendante de l’objet S3 déjà stampé (`geo-api-collection-cache`), et aucune invalidation est dans le périmètre de cette mission. Aucun contournement ni écrasement n’a été tenté. Le dépôt S3, relu idempotent par le fold, reste la preuve durable; la remise à jour OGC relève du prochain rebuild de l’API.

## Villes null

Aucune nouvelle ville null dans ce lot : toutes les neuf avaient un numéro déjà curé et vérifié. Les millésimes restés `null` le sont parce que les documents ne donnent pas d’adoption/entrée en vigueur ferme de la base (notamment `saint-marc-du-lac-long`, `saint-prosper-de-champlain`, `sainte-angele-de-merici`, `schefferville`, `tres-saint-redempteur`).
