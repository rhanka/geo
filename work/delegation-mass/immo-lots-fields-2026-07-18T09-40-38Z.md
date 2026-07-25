# IMMO lots fields — shard 0/1

Mesures S3 réelles par `npx tsx acquisition/src/immo-lots-audit.ts`.

- Avant : `2026-07-18T09:33:28.861Z` (`/tmp/immo-lots-before.json`)
- Après : `2026-07-18T09:40:38.125Z` (`/tmp/immo-lots-after-final.json`)
- Shard : `0/1` — tous les slugs de chaque liste triée relèvent de ce shard.

## Avant / après par champ

| Champ | Avant S3 | Après S3 | Écart |
|---|---:|---:|---:|
| `surface_m2` | 3 382 905 / 3 382 905 (100 %) | 3 386 747 / 3 386 747 (100 %) | +3 842 / +3 842 |
| `adresse` | 2 556 166 / 3 382 905 (75,56 %) | 2 559 983 / 3 386 747 (75,59 %) | +3 817 / +3 842 |
| `code_postal` | 3 382 904 / 3 382 905 (100 %, arrondi) | 3 386 746 / 3 386 747 (100 %, arrondi) | +3 842 / +3 842 |
| `folded-normes` | 871 804 / 3 382 905 (25,77 %) | 871 805 / 3 386 747 (25,74 %) | +1 / +3 842 |
| `in_tod` (scopé) | 28 431 / 28 431 (100 %) | 28 431 / 28 431 (100 %) | 0 |

Les écarts globaux ne proviennent pas des villes ci-dessous : pendant le shard,
`saint-boniface` a été publié par un autre travail avec 3 842 lots, dont 3 817
adresses, 3 842 codes postaux, 3 842 surfaces et 1 lot avec normes pliées. Les
compteurs de chacune des villes traitées sont inchangés dans l'audit final.

## Villes traitées

### Adresse — jointure rôle activée (jamais `--no-role`)

- Zéros vérifiés, toujours nuls : `franquelin`, `remigny`,
  `saint-eugene-de-ladriere`, `saint-felix-de-dalquier`,
  `saint-gabriel-de-valcartier`,
  `saint-louis-de-gonzague-du-cap-tourmente`, `saint-pierre`.
- Résidus ré-enrichis, compte adresse identique avant/après :
  `stanstead--memphremagog` (1 954/3 087),
  `hemmingford--les-jardins-de-napierville--2` (1 105/1 618),
  `lingwick` (576/811), `chute-saint-philippe` (800/1 022),
  `temiscaming` (195/249), `saint-louis-du-ha-ha` (1 135/1 427).

### Folded-normes — jointure puis enrichissement

- Jointure et enrichissement réalisés : `amos`, `baie-saint-paul`, `bearn`.
  Chaque jointure confirme un taux de correspondance code-zone→norme de 0 % ;
  `folded-normes` reste donc 0 plutôt que d'inventer des valeurs.
- `amos` a seulement 2,52 % de lots assignés ; `baie-saint-paul` et `bearn`
  ont 100 % de lots assignés, mais 0 % de code-zone→norme correspondant.

### Résidu code postal

- `pierreville` ré-enrichie : inchangé à 1 830/1 831 (99,95 %). Le lot restant
  ne tombe dans aucune géométrie RTA/FSA ; il est laissé `null`.

## Villes skippées et raisons vérifiées

- Adresse : `franquelin` (chevauchement rôle 22 < seuil 30), `remigny` (1 <
  30), `saint-eugene-de-ladriere` (4 < 30),
  `saint-gabriel-de-valcartier` (21 < 30),
  `saint-louis-de-gonzague-du-cap-tourmente` (1 < 98), `saint-pierre` (238
  < 639) ; `saint-felix-de-dalquier` n'a aucun candidat `code_geo`. La garde
  de chevauchement a donc correctement refusé une adresse incertaine.
- Normes : `amherst`, `baie-durfe`, `beaconsfield` : zones absentes sous
  `normalized/ca-qc-zonage/`, donc pas de jointure à exécuter. Les 172 autres
  résidus dont `normesStatus=to-research` restent hors mission (lane normes).

## Écart constaté

`lots-enriched-run.ts` reconstruit l'adresse depuis l'index/XML MAMH et sa
validation de chevauchement ; il ne lit pas `registry/role-foncier/<slug>.parquet`.
La présence de ce registre ne suffit donc pas à remplir les cas ci-dessus. Aucun
contournement ni valeur inventée n'a été déposé.
