# ZONES recalage/vectoriel - shard B

Date: 2026-07-07

## Portee

Residus zones traites avec gate strict puis service lots:

- boischatel
- chateau-richer
- ormstown
- riviere-du-loup
- saint-hyacinthe
- saint-tite-des-caps

## Points code

- `acquisition/src/verify-zone-overlap.ts`: le gate strict accepte maintenant les codes QC debutant par des chiffres et suffixes par une lettre, par exemple `4052-C`, sans ouvrir la porte aux zones purement numeriques.
- `acquisition/src/lib/zonage-norms.ts`: le fichier comportait deja un diff local autour de `exists` et `headExistsStrict`; l'import `exists` a ete retabli dans le workspace pour permettre l'audit, sans staging de ce fichier afin de ne pas embarquer le diff preexistant.

## Gates stricts

`verify-zone-overlap.ts` a ete execute sur les 6 slugs. Resultat: 6 PASS.

| Slug | Features | Distinct codes | Code-like | Normes overlap |
| --- | ---: | ---: | ---: | ---: |
| boischatel | 55 | 55 | 100.00% | 1 |
| chateau-richer | 97 | 96 | 100.00% | 59 |
| ormstown | 102 | 102 | 100.00% | 5 |
| riviere-du-loup | 222 | 222 | 100.00% | 2 |
| saint-hyacinthe | 1091 | 1089 | 100.00% | 237 |
| saint-tite-des-caps | 66 | 66 | 100.00% | 2 |

## Service lots

Sorties ecrites et verifiees:

- `normalized/qc-lot-zonage/<slug>.parquet`
- `normalized/qc-lot-zonage/<slug>.stats.json`
- `normalized/qc-lots/qc-lots-<slug>.geojson`
- `normalized/qc-lots/qc-lots-<slug>.stats.json`

| Slug | Lots | Assignes | Multi-zone | Normes match | Enrichi zone_code | Enrichi normes | Adresse |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| boischatel | 4077 | 99.88% | 0.00% | 0.47% | 99.88% | 0.47% | 92.00% |
| chateau-richer | 2955 | 100.00% | 6.60% | 76.55% | 100.00% | 76.55% | 90.73% |
| ormstown | 2421 | 99.01% | 0.00% | 1.29% | 99.01% | 1.28% | 99.17% |
| riviere-du-loup | 8812 | 99.99% | 2.28% | 0.18% | 99.99% | 0.18% | 90.92% |
| saint-hyacinthe | 19379 | 100.00% | 4.54% | 57.73% | 100.00% | 57.73% | 90.25% |
| saint-tite-des-caps | 1291 | 99.69% | 2.48% | 1.01% | 99.69% | 1.01% | 91.71% |

Les faibles taux `normes match` sont attendus pour les municipalites ou le lexique de normes reste partiel; l'objectif de ce shard etait le recalage/vectoriel et l'affectation lot-zone. Les taux d'affectation lot-zone sont tous superieurs a 99%.

## Residus non deposes

Audit apres traitement: `zonesDone=761`, `ok=307`, `reacquire=7`, `reacquireAffectation=2`, `reacquireSigNoCodes=0`, `reacquireDisjoint=5`, `normesSuspect=20`.

Residus restant a reacquerir ou recalage source:

- charlemagne
- deux-montagnes
- dollard-des-ormeaux
- mont-tremblant
- saint-bruno-de-montarville
- saint-gabriel-de-brandon
- sainte-paule

Ces 7 slugs n'ont pas ete deposes dans ce passage: aucune source vectorielle strictement joignable n'a ete prouvee pour eux pendant le shard.
