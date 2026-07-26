# SPEC — artefact 4a « delta de grille » Geo → Immo

Statut : normative v1.0.0 — producteur `@sentropic/geo`, consommateur `immo`.

## 1. Frontière et périmètre

Geo produit l'objet S3 séparé ci-dessous; il ne lit ni n'écrit `graph_nodes`,
`geo_resolutions` ou un autre stockage Immo. Immo est l'unique projecteur dans
son graphe. La production et les mesures sont restreintes au vivier B' committé
`acquisition/config/immo-vivier-b-20260725.json` (170 `city_slug`); la mesure
reste exhaustive sur toutes les collections `qc-zonage-*` réellement servies
afin de distinguer B' du reste.

URI stable consommée par Immo :

```
s3://sentropic-geo/exports/immo/artefact-4a-delta-grille/v1/latest.json
```

Chaque publication écrit d'abord l'instantané immuable
`s3://sentropic-geo/exports/immo/artefact-4a-delta-grille/v1/snapshots/<snapshot_id>.json`,
puis `latest.json`. Immo ne consomme que `complete:true`.

## 2. Clé de jointure

La clé est `{city_slug, zone_ref_canon_v1, reglement_number}` : `city_slug` est
le slug B' exact; `zone_ref_canon_v1` est
`canonicalizeZoneCodeForJoin(geo_zone_code)`; `reglement_number` est
**strictement** `densite_apres_reglement`, avec un
`densite_apres_millesime` explicite et sans égalité canonique avec le code de
zone. C'est la clé la plus sûre que Geo
puisse prouver : Geo ne possède aucun `node_id` Immo, le code source exact est
conservé dans `zone_ref_verbatim`/`geo_zone_code`, et la canonisation est
déterministe et anti-fusion (jamais fuzzy). Le numéro de règlement courant
`reglement_numero` n'est jamais un repli. La clé n'affirme pas qu'un code de
zone survit à une refonte : elle identifie la zone de la collection Geo servie;
une renumérotation non explicitement matérialisée ne crée aucune jointure.
`delta_id=sha256("geo-4a-v1|city_slug|zone_ref_canon_v1|reglement_number")`
sert seulement à l'upsert de l'artefact, jamais d'identifiant de nœud Immo.

## 3. Schéma JSON (une ligne = un delta de zone)

```json
{"schema_version":"1.0.0","artifact":"geo-4a-delta-grille","complete":true,"snapshot_id":"…","generated_at":"ISO-8601"}
{"scope":{"id":"immo-vivier-b-20260725","as_of":"2026-07-25","city_count":170,"source_sha256":"…"}}
{"source":{"producer":"@sentropic/geo","layout_rule":"nested_when_present_else_flat","omission_rule":"omit_cities_without_known_effect_and_unjoinable_records"}}
{"coverage":{"served_collections":871,"b_prime":{},"rest":{},"b_prime_export":{}}}
{"source_collections":[{"city_slug":"…","collection_s3_uri":"s3://…","object_sha256":"…","selected_layout":"nested|flat"}]}
{"records":[{"delta_id":"sha256","join_key":{"city_slug":"…","zone_ref_canon_v1":"…","zone_ref_verbatim":"…","reglement_number":"…"}}]}
{"records[].geo_zone_collection":"qc-zonage-…","geo_zone_code":"…","effet_densifiant":"densifie|reduit|stable"}
{"records[].densite_avant":0,"densite_avant_millesime":"…|null","densite_avant_reglement":"…|null"}
{"records[].densite_apres":0,"densite_apres_millesime":"…|null","densite_apres_reglement":"…"}
{"records[].geo_zone_usage_dominant":"…|null","provenance":{"projection_source":{},"grid_delta_evidence":null,"zone_geometry":{}}}
```

`geo_zone_usage_dominant` désigne exclusivement l'usage de la **zone** issu de
la grille Geo. Il n'existe aucun champ nu `usage_dominant` dans cet artefact et
il ne couvre donc jamais `usage_dominant` du **Signal** Immo.

## 4. Source, millésime et provenance

La source est le GeoJSON servi sous
`s3://sentropic-geo/normalized/ca-qc-zonage/`. Quand les deux layouts existent,
le sous-dossier est retenu, car c'est celui que sert geo-api; sinon la clé plate
est retenue. Chaque record porte les millésimes et règlements avant/après tels
que servis, plus l'URI et le SHA-256 exacts de l'objet source. Les URLs de
géométrie et de règlement sont isolées dans `zone_geometry`.
`grid_delta_evidence` vaut explicitement `null`: les collections actuellement
servies ne matérialisent pas une preuve `source_avant/source_apres`; Geo ne doit
jamais faire passer une preuve de géométrie pour une preuve de densité. Le
millésime de diffusion est `generated_at`/`snapshot_id`; le millésime métier est
porté champ par champ avant/après.

## 5. Anti-invention et omissions

Un effet connu n'est émis que si les deux densités finies sont présentes et que
son signe est exactement dérivé (`après>avant → densifie`, `< → reduit`, `= →
stable`). Toute contradiction échoue fermée. Une valeur source inconnue reste
`"inconnu"` avec densités `null` dans la collection source; elle n'est jamais
transformée en effet connu. Les villes qui n'ont aucun effet connu et les
records sans les trois éléments de jointure sont **omis** : Immo conserve ainsi
son placeholder `inconnu`, sans que Geo prétende avoir observé une zone ou un
règlement. Une chaîne de règlement qui est en réalité le code de zone (cas
`RD-104`) est également non-joignable : aucun regex ne transforme cette
ambiguïté en règlement. Les compteurs de couverture exposent séparément `known_effect`,
`unknown_only`, `absent`, `invalid_only` et les features non-joignables.

## 6. Exécution, cadence et preuve

Le générateur est `acquisition/src/immo-4a-delta-grille-export.ts`; son
`--dry-run` lit et mesure sans aucun `PUT`. Toute exécution S3 est préfixée par
`NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10`. Il doit être
rejoué après chaque publication validée d'un delta B' et au minimum une fois par
jour ouvré par l'opération Geo; un échec ne met jamais à jour `latest.json`.
Les tests unitaires utilisent un faux S3; l'objet produit est le seul objet
écrit, sous le préfixe neuf `exports/immo/artefact-4a-delta-grille/`.
