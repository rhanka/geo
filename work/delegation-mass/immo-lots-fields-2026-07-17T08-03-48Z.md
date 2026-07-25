# Immo lots fields — shard 0/1

Snapshot initial S3 : `2026-07-17T07:35:55.148Z`.

Snapshot final S3 : `2026-07-17T08:03:48.111Z`.

Le périmètre servi a changé de 837 à 838 municipalités pendant l'intervention
(écritures concurrentes sur le même environnement). Les deux colonnes ci-dessous
sont donc des lectures S3 brutes, pas une attribution causale de chaque delta au
présent shard.

## surface_m2

| Mesure | Avant | Après |
| --- | ---: | ---: |
| Lots avec valeur / lots servis | 3 340 005 / 3 340 005 | 3 340 987 / 3 340 987 |
| Couverture | 100 % | 100 % |

Résidu : aucun dans le snapshot final.

## adresse

| Mesure | Avant | Après |
| --- | ---: | ---: |
| Lots avec valeur / lots servis | 2 236 660 / 3 340 005 | 2 237 532 / 3 340 987 |
| Couverture | 66,97 % | 66,97 % |

Les six produits réenrichis avec rôle actif sont :
`saint-louis-de-gonzague-du-cap-tourmente`, `stanstead--memphremagog`,
`saint-felix-de-dalquier`, `mont-royal`, `riviere-du-loup` et `rimouski`.

Contrôle du piège `--no-role` : la lecture des sidecars de toutes les villes à
adresse incomplète n'a trouvé aucun sidecar sans section `role`. Les nulls restants
ne sont donc pas des régressions de mode `--no-role`. Deux motifs de source ont été
observés pendant le lot : aucun candidat `code_geo` pour Saint-Félix-de-Dalquier,
et un recouvrement rôle insuffisant (1 lot, minimum 98) pour
Saint-Louis-de-Gonzague-du-Cap-Tourmente. Ces adresses restent nulles.

## code_postal

| Mesure | Avant | Après |
| --- | ---: | ---: |
| Lots avec valeur / lots servis | 3 339 905 / 3 340 005 | 3 340 895 / 3 340 987 |
| Couverture | 100 % (arrondi audit) | 100 % (arrondi audit) |

Résidu : aucun à traiter dans le snapshot final selon l'audit; le champ reste une
RTA/FSA à trois caractères, sans code postal complet inventé.

## folded-normes

| Mesure | Avant | Après |
| --- | ---: | ---: |
| Lots avec valeur / lots servis | 806 092 / 3 340 005 | 808 394 / 3 340 987 |
| Couverture | 24,13 % | 24,20 % |

Villes jointes puis rematérialisées :

- `sainte-lucie-des-laurentides`, `berthierville`, `hinchinbrooke`,
  `saint-francois-du-lac`, `huntingdon`, `mille-isles`
- `saint-martin`, `pierreville`, `la-presentation`, `saint-chrysostome`,
  `saint-cuthbert`, `daveluyville`
- `saint-benoit-labre`, `brigham`, `notre-dame-des-neiges`,
  `saint-alexandre-de-kamouraska`, `sainte-anne-de-sabrevois`, `mandeville`,
  `riviere-rouge`, `saint-hubert-de-riviere-du-loup`

Les proportions finales mesurées les plus élevées de ces lots sont
Sainte-Lucie-des-Laurentides 84,20 %, Saint-François-du-Lac 23,20 %, Mandeville
16,29 %, Saint-Alexandre-de-Kamouraska 14,57 % et Saint-Cuthbert 12,70 %.
Les autres codes zone-norme non appariés restent nulls; aucune norme n'a été
propagée par approximation.

Villes skippées :

- `montreal` — interrompue après 300 s sans résultat; plafond par ville respecté.
- `cap-chat`, `sainte-anne-de-bellevue`, `amherst`, `baie-durfe` — couche de zones
  servie absente, donc jointure lot-zone impossible.

## in_tod

| Mesure | Avant | Après |
| --- | ---: | ---: |
| Lots avec valeur / lots dans le périmètre TOD | 28 431 / 28 431 | 28 431 / 28 431 |
| Couverture | 100 % scoped | 100 % scoped |

Résidu : aucun; hors périmètre TOD, le champ demeure sciemment `null`.

## Preuve

La mesure finale provient de
`npx tsx acquisition/src/immo-lots-audit.ts --report /tmp/immo-lots-fields-final.json`.
Elle lit les sidecars déposés sur S3; aucun résultat ci-dessus ne repose sur une
valeur locale ou estimée.
