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
