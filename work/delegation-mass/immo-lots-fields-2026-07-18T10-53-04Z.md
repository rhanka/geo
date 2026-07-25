# IMMO lots fields — shard 0/1

Date UTC: 2026-07-18T10:53:04Z

Shard rule: all sorted slugs are eligible (`index % 1 == 0`). This pass used the S3 audit to select and process the actionable residuals below. No `--enrich-no-role` invocation was used.

## Audit S3 — before / after

| Field | Before (lots) | After (lots) | Before | After |
|---|---:|---:|---:|---:|
| `surface_m2` | 3,386,747 / 3,386,747 | 3,386,747 / 3,386,747 | 100% | 100% |
| `adresse` | 2,559,983 / 3,386,747 | 2,559,983 / 3,386,747 | 75.59% | 75.59% |
| `code_postal` | 3,386,746 / 3,386,747 | 3,386,746 / 3,386,747 | 100% (arrondi) | 100% (arrondi) |
| `folded-normes` | 872,229 / 3,386,747 | 872,229 / 3,386,747 | 25.75% | 25.75% |
| `in_tod` (scopé) | 28,431 / 28,431 | 28,431 / 28,431 | 100% | 100% |

Source de preuve: `work/coverage/immo-lots.before-shard0of1.json` et `work/coverage/immo-lots.after-shard0of1.json`, tous deux produits par `immo-lots-audit.ts` en lecture S3.

## Villes traitées

### Adresse — rôle foncier actif

Ré-enrichies sans `--no-role`: `saint-pierre`, `saint-louis-de-gonzague-du-cap-tourmente`, `saint-felix-de-dalquier`, `franquelin`, `saint-gabriel-de-valcartier`, `saint-eugene-de-ladriere`, `remigny`.

Résultat: les sept restent à 0% d’adresse. La jointure officielle a été exécutée, mais le garde-fou de recouvrement refuse un rôle sans suffisamment de numéros de lot communs; aucune adresse n’a été devinée ni conservée artificiellement.

### Normes foldées — jointure puis enrichissement

Traitement complet `lot-zone-join-run.ts` puis `lots-enriched-run.ts` avec rôle actif:

- `baie-des-sables`: 0.09% → 0.09%
- `saint-boniface`: 0.03% → 0.03%
- `fossambault-sur-le-lac`: 0.05% → 0.05%
- `becancour`: 0.07% → 0.07%
- `lavenir`: 0.09% → 0.09%
- `saint-romain`: 0.10% → 0.10%

Les dépôts parquet et qc-lots sont vérifiés pour les six villes. Les couvertures n’augmentent pas car les seules normes jointes sont exactement celles déjà compatibles avec les codes de zone; les écarts restants ne peuvent pas être comblés par un fold sans inventer une correspondance.

### Résidu `code_postal`

- `pierreville`: ré-enrichie avec l’index FSA actif, 99.95% → 99.95%. Un lot demeure hors polygone RTA; `code_postal` reste donc `null`.

Il n’y avait aucune ville avec lots et `surface_m2 < 100%` dans l’audit courant.

## Villes skippées et raison

### Rôle foncier non admissible

- `saint-pierre`: meilleur recouvrement 238 lots, seuil 639 (`code_geo=61020`).
- `saint-louis-de-gonzague-du-cap-tourmente`: 1 < 98 (`code_geo=21015`).
- `saint-felix-de-dalquier`: aucun candidat `code_geo`.
- `franquelin`: 22 < 30 (`code_geo=96015`).
- `saint-gabriel-de-valcartier`: 21 < 30 (`code_geo=22025`).
- `saint-eugene-de-ladriere`: 4 < 30 (`code_geo=10075`).
- `remigny`: 1 < 30 (`code_geo=85105`).

### Normes sans jointure valide additionnelle

- `saint-louis-de-gonzague-du-cap-tourmente`: zones sans `zone_code` exploitable.
- `saint-joseph-de-beauce`, `roxton-pond`, `vercheres`, `sainte-beatrix`, `mont-laurier`: taux zone↔norme 0%.
- `val-des-monts`, `saint-come`, `plessisville`, `beauceville`, `mont-blanc`, `lac-brome`: taux zone↔norme 0% confirmé par vérification S3.

Ces cas nécessitent une correction/provenance de normes ou de codes de zone dans leur lane; ils ne sont pas enrichissables honnêtement par cette mission.
