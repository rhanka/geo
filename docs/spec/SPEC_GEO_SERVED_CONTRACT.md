# SPEC — contrat servi Geo → consommateurs

Statut : normative v1.0.0 — producteur `@sentropic/geo`. Ce contrat décrit
uniquement les objets que Geo sert; il ne prescrit ni modèle, ni seuil, ni
priorité à un consommateur.

## 1. Publication versionnée et vérifiable

URI stable du pointeur :

```text
s3://sentropic-geo/exports/immo/geo-served-contract/v1/latest.json
```

Une publication réussie produit d'abord les octets canoniques du manifeste,
puis l'instantané immuable :

```text
s3://sentropic-geo/exports/immo/geo-served-contract/v1/snapshots/<sha256-hex>.json
```

où `<sha256-hex>` est le SHA-256 des **octets exacts** du snapshot (préfixe
`sha256:` omis dans le chemin). `latest.json` est un pointeur JSON vers cet URI
et ce hash, écrit seulement après l'instantané. Son écriture est
compare-and-swap (`If-None-Match` au premier pointeur, `If-Match` ensuite) : un
run concurrent ou en erreur échoue fermé et ne déplace jamais `latest`.

Le générateur est
`acquisition/src/geo-served-contract-export.ts`; la logique et les invariants
testables sont dans `acquisition/src/lib/geo-served-contract.ts`.

Les octets du snapshot sont une sérialisation JSON déterministe : clés d'objet
triées lexicographiquement, ordre des tableaux déjà défini par la spec,
UTF-8, aucune espace superflue et un seul LF final. Le consommateur vérifie :

1. `latest.json` contient `snapshot_sha256` et `snapshot_s3_uri` sous le
   préfixe ci-dessus;
2. le SHA-256 des octets téléchargés du snapshot vaut exactement
   `snapshot_sha256`;
3. le nom du snapshot est ce hash sans le préfixe;
4. le manifeste a `schema_version:"1.0.0"` et `complete:true`.

La version consommable est donc le couple
`schema_version + snapshot_sha256`; elle ne dépend jamais du pointeur mutable.
`complete:true` signifie que toutes les listes, lectures, parsings et
revalidations S3 de ce run ont abouti. Il ne signifie pas « couverture métier
complète ».

Un changement de listing entre la sélection et la fin des lectures annule le
run. Une erreur réseau, une lecture disparue, une réponse illisible ou un
index PV mal lu n'est jamais converti en absence. Le runner ne pose aucun
timeout applicatif de lecture S3 : une expiration serait une mesure d'absence
mensongère.

## 2. Univers, collections `qc-zonage-<slug>` et clé

L'univers est le registre committé
`packages/qc-sources/src/geo/municipalities.qc.json` : exactement 1 106 slugs
uniques. Le manifeste porte son chemin et son SHA-256. Il porte une ligne,
ordonnée par `city_slug`, pour chacune des 1 106 villes, y compris les villes
sans collection.

Les collections sont lues sous :

```text
s3://sentropic-geo/normalized/ca-qc-zonage/
```

La sélection est normative : quand les layouts plat et sous-dossier existent,
le sous-dossier est sélectionné (`nested_when_present_else_flat`), car c'est
celui servi par geo-api. Le manifeste conserve l'objet sélectionné (URI, SHA
des octets lus, ETag, taille, date S3) et les layouts éclipsés. Une collection
S3 dont le slug est hors registre reste visible dans
`unregistered_collections`; elle n'est pas silencieusement jointe.

La clé Geo généralisée est :

```text
{ city_slug, zone_ref_canon_v1, reglement_number }
```

Pour les zones servies, `zone_ref_verbatim` est
`feature.properties.zone_code`, `zone_ref_canon_v1` est le résultat exact de
`canonicalizeZoneCodeForJoin(zone_code)`, et `reglement_number` est
`feature.properties.reglement_numero`. Le manifeste fige aussi le chemin et le
SHA de l'implémentation de `zone_ref_canon_v1`.

La canonisation normalise des variantes de présentation; elle n'est donc pas
une preuve d'unicité. Le producteur ne déduplique pas les collisions. Toute
collision de la triade `{zone_ref_canon_v1, reglement_number}` entre plusieurs
valeurs verbatim est publiée dans `canonical_collisions`; les features touchées
sont comptées dans `blocked_canonical_collision` et **retirées de
`joinable`**. Le consommateur conserve toujours `zone_ref_verbatim`.
Les multipolygones restent des features distinctes : la clé est une clé de
jointure, pas un identifiant de feature ni de nœud tiers.

## 3. Champs servis, millésime, provenance et partitions

Le manifeste mesure, pour les features de chaque collection sélectionnée, les
champs ci-dessous. Une partition de feature est toujours
`known + explicit_unknown + absent + invalid = feature_count`; une partition
par ville ferme toujours sur 1 106. `explicit_unknown` n'est jamais `known` ni
`complete`.

| Champ Geo | Sens contractuel | Mesure |
| --- | --- | --- |
| `zone_code` / `zone_ref_canon_v1` | Référence de zone verbatim et canonique | partition de feature + collisions canoniques |
| `reglement_numero` | Numéro de règlement de la zone, composante de clé | partition de feature et partition-ville |
| `reglement_millesime` | Millésime métier de ce règlement; distinct de `generated_at` | partition de feature et partition-ville |
| `usage_dominant` | Usage de la **zone Geo** | partition de feature et partition-ville; ce n'est jamais le champ homonyme d'un Signal Immo |
| `zone_source_url`, `zone_source_level` | Provenance de la géométrie de zone | partition sémantique : URL HTTP(S) réelle et vocabulaire de niveau validé |
| `proof` de collection/feature | Forme de preuve géométrique servie | `structurally_valid`, `absent` ou `invalid` par ville |

`structurally_valid` signifie uniquement que l'objet actuellement servi passe
le garde de forme Geo (`url`, `retrieved_at`, `sha256`, niveau source et
cohérence collection/features). Ce n'est **pas** une preuve v2 vérifiée : le
contrat ne relit pas le manifeste de capture ni les octets CAS. Une preuve v2
exige en plus le triplet exact de capture `(url, retrieved_at, sha256)`, une
clé CAS cohérente et le rehash des octets conservés, conformément à
`packages/qc-sources/src/capture/manifest.ts` et
`acquisition/src/lib/zonage-proof.ts`.

Le rapport portfolio local observé le 2026-07-26 (SHA-256
`72d9d93983cd4aa84427941d2f774317e7f84ac61f0e3f9831681f7caf0d46dc`), avec
son dénominateur fixe de 1 106 villes, donne le repère mesuré suivant. Ce sont
des KPI historiques de portefeuille; le snapshot publié les remesure depuis
les objets S3 et expose ses partitions plus strictes, il ne réutilise pas ce
fichier comme entrée.

| Axe | complete | incomplete | unknown | N/A |
| --- | ---: | ---: | ---: | ---: |
| Zones | 868 / 1 106 | 195 | 43 | 0 |
| `reglement_numero` | 815 / 1 106 | 269 | 22 | 0 |
| `usage_dominant` (zone Geo) | 710 / 1 106 | 374 | 22 | 0 |
| `effet_densifiant` | 5 / 1 106 | 1 079 | 22 | 0 |

Le taux 710 / 1 106 est donc explicitement borné : il ne permet jamais de
traiter les 396 autres villes comme porteuses d'un usage connu.

## 4. Artefact 4a « delta de grille »

L'artefact 4a reste son produit versionné propre :

```text
s3://sentropic-geo/exports/immo/artefact-4a-delta-grille/v1/latest.json
```

Sa spec normative est `SPEC_ARTEFACT_4A_DELTA_GRILLE.md`. Sa clé est aussi
`{city_slug, zone_ref_canon_v1, reglement_number}`, avec une source explicitement
différente pour la troisième composante :
`densite_apres_reglement`, jamais un repli sur `reglement_numero`. Ses
millésimes et règlements avant/après sont portés par record.

Le contrat général lit ce `latest`, valide sa forme, résout le snapshot 4a
nommé par `snapshot_id` et exige l'égalité exacte de leurs octets. Il publie
alors l'URI et le SHA du snapshot 4a dans
`artefacts.geo_4a_delta_grille`; sinon son état est explicitement `absent` ou
`invalid`. Il ne prend jamais `complete:true` de 4a pour une mesure de
couverture des 1 106 villes.

L'homonyme est séparé par nom et objet : 4a expose
`geo_zone_usage_dominant`, soit l'usage de la **zone** Geo. Il ne sert ni ne
décrit `usage_dominant` d'un **Signal** appartenant à un consommateur.

## 5. PV : index oui, octets non

Geo sert et mesure les clés exactes :

```text
s3://sentropic-geo/registry/qc-pv/<city_slug>/index.json
```

Chaque index déclaré présent est lu, comparé à l'ETag/taille listés, parsé comme
objet JSON et hashé. `present_valid_index` exige au minimum un tableau
`entries` et, pour chaque entrée, une URL HTTP(S) non vide; il ne valide pas les
octets visés. Les états par ville ferment sur
`present_valid_index + absent + invalid_index = 1 106`. Un index est une
liste/référence : il ne prouve ni ne transporte les octets des PV. Le manifeste
le déclare sans ambiguïté :

```json
{"kind":"index_only","bytes_of_pv_documents":"not_served"}
```

Repère portfolio observé le 2026-07-26 : **1 062 / 1 106** villes ont un PV
`complete`, 1 est `incomplete`, 41 sont `unknown` et 2 `N/A`. Ce KPI ne change
pas la déclaration fondamentale : Geo est le référentiel de l'**index** PV,
pas aujourd'hui le référentiel des **octets** PV.

## 6. Ce que Geo ne porte pas

- Les octets des PV, leur hash de contenu et une preuve de capture des PV.
- Une preuve v2 de capture revalidée pour une zone, sauf dans le workflow de
  preuve spécialisé qui rehash les CAS; le présent contrat ne la revendique pas.
- Une preuve de delta de densité avant/après au-delà de ce qui est explicitement
  matérialisé dans l'artefact 4a (`grid_delta_evidence` y reste `null`).
- L'usage dominant d'un Signal tiers, tout identifiant de nœud ou projection de
  graphe d'un consommateur.
- Une jointure lorsque la triade de zone est absente, inconnue, invalide ou en
  collision non résolue.

## 7. Exécution

Le runner n'appelle aucune API de modèle, OCR ou autre API tierce facturée : il
utilise seulement le stockage objet déjà servi par Geo. Toute exécution S3
exige :

```bash
NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
  npx tsx acquisition/src/geo-served-contract-export.ts
```

Sans `--publish`, la commande construit et vérifie seulement la publication
potentielle. `--publish` écrit exclusivement le snapshot et le pointeur sous
le préfixe neuf du contrat; il n'écrit aucune géométrie servie. Les tests
unitaires utilisent un faux S3, sans réseau ni coût.
