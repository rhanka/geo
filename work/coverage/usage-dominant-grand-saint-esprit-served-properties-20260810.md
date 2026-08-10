# Grand-Saint-Esprit — propriétés de zonage servies (2026-08-10)

Statut : **non-dérivation** de `usage_dominant`.

Lecture S3 seulement de
`normalized/ca-qc-zonage/qc-zonage-grand-saint-esprit.geojson` : la collection
servie contient 14 polygones, aux codes `A-01` à `A-06`, `H-01`, `H-02` et
`HC-01` à `HC-06`.

Pour chacun des 14 polygones, les champs potentiellement descriptifs sont
strictement nuls : `kind`, `affectation` et `num_zone`. La preuve attachée à
chaque entité déclare la géométrie disponible via
`https://www.goazimut.com/gis109-11/arcgis/rest/services/500_NicoletYamaska/50065_GrandSaintEsprit/MapServer/173`,
mais la source de réglementation est explicitement `unavailable` avec le gap
`regulation_source_unavailable`.

Les préfixes de codes ne sont pas une légende. Cette inspection ne justifie
donc aucune correspondance de dominance. Elle confirme que toute future carte
doit partir d'un règlement ou d'une légende publiés, capturés par le cluster et
conservés sur S3.

## Vérification réglementaire officielle ultérieure

La campagne cluster `normes-20260810T071155Z-1-e0380804-fe80-46f4-9ab3-dfa3ae110b8d`
a capturé avec HTTP 200 la page officielle
`https://www.grandsaintesprit.qc.ca/fr/services-aux-citoyens/centre-documentaire/c1474/reglements-municipaux/page-1`.
Son reçu S3 immuable est
`registry/normes-captured-discovery-run-receipts/v4/normes-20260810T071155Z-1-e0380804-fe80-46f4-9ab3-dfa3ae110b8d/grand-saint-esprit.json`;
le HTML correspondant est
`raw/normes-grille-discovery/cas/79ecfc1c0b200f063c42fb06f051d7c4b74f6564d5edda02a80d4a943b883646.html`.

Le reçu conclut `candidate_count: 0` et `status: refused` avec
`no classified grille PDF candidate in eligible captured HTML`. Cette preuve
établit seulement le résultat de cette page, à cette capture : elle ne prouve
pas l'absence de tout règlement municipal. Elle ne fournit toutefois aucun
règlement-base, annexe ou légende reliant `A-*`, `H-*` ou `HC-*` à une catégorie
de dominance. Le statut `usage_dominant` reste donc **unknown**.
