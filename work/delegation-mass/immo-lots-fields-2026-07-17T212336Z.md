# IMMO lots fields — shard 0/1

Audit S3 de départ : `2026-07-17T21:12:41.464Z`.

Audit S3 final : `2026-07-17T21:23:36.985Z`.

Ce shard couvre tous les slugs : index dans la liste triée modulo `1` égal à `0`.

## Avant / après, par champ

| Champ | Avant (lots renseignés / lots) | Après (lots renseignés / lots) | Écart mesuré |
| --- | ---: | ---: | ---: |
| `surface_m2` | 3 365 896 / 3 365 896 (100%) | 3 365 896 / 3 365 896 (100%) | 0 |
| `adresse` | 2 535 069 / 3 365 896 (75,32%) | 2 540 332 / 3 365 896 (75,47%) | +5 263 |
| `code_postal` | 3 365 895 / 3 365 896 (100% arrondi) | 3 365 895 / 3 365 896 (100% arrondi) | 0 |
| `folded-normes` | 855 340 / 3 365 896 (25,41%) | 855 340 / 3 365 896 (25,41%) | 0 |
| `in_tod` (scopé) | 28 431 / 28 431 (100%) | 28 431 / 28 431 (100%) | 0 |

## Villes traitées

- Adresse, ré-enrichissement avec jointure rôle active : `saint-pierre`, `saint-alphonse-rodriguez`, `saint-louis-de-gonzague-du-cap-tourmente`, `saint-felix-de-dalquier`, `franquelin`, `saint-gabriel-de-valcartier`, `saint-eugene-de-ladriere`, `remigny`.
  - Seule `saint-alphonse-rodriguez` a un rôle admissible : 0% → 96,09%, soit les +5 263 adresses S3 constatées.
  - Les autres sorties restent à `null` conformément au garde-fou : chevauchement rôle insuffisant ou aucun `code_geo` admissible. Aucune adresse n'a été inventée.
- Fold normes, jointure lots→zones puis ré-enrichissement : `chateauguay`, `shawinigan`, `saint-eustache`, `saint-georges`, `saint-constant`.
  - Les dépôts de jointure sont vérifiés. Les taux de correspondance zone→norme réels restent respectivement 0,03%, 0%, 0%, 0,87% et 4,26%; le total `folded-normes` ne varie donc pas.
- Code postal : `pierreville` ré-enrichie; 1 830 / 1 831 lots ont un FSA. Le dernier lot reste `null`, absent de l'index FSA.

## Villes skippées / hors périmètre de données

- `blainville` (fold normes) : aucune couche zones servie sous `normalized/ca-qc-zonage/`; pas de jointure zone possible.
- Surface : `aguanish`, `caniapiscau`, `cote-nord-du-golfe-du-saint-laurent`, `havre-saint-pierre`, `lile-danticosti`, `metis-sur-mer` ont zéro lot; aucun résidu lot-pondéré à enrichir.
- Code postal : les mêmes six villes ont zéro lot; seul résidu avec des lots, `pierreville`, a été traité ci-dessus.

## Preuve

Les mesures proviennent exclusivement de `immo-lots-audit.ts` lu sur S3. Les exports complets correspondants sont `work/coverage/immo-lots-shard0-before.json` et `work/coverage/immo-lots-shard0-after.json`.
