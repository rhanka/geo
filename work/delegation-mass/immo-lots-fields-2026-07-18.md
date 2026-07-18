# WP9 — champs LOT immo, shard 0/1

Mesure S3 avant : `2026-07-18T09:44:49.364Z`.
Mesure S3 après : `2026-07-18T09:59:43.925Z`.

Les deux mesures portent sur 863 produits `qc-lots` servis et leurs sidecars S3. Les chiffres ci-dessous sont rapportés champ par champ ; aucun avancement total agrégé n'est déduit.

| Champ | Avant (lots renseignés / périmètre) | Avant | Après (lots renseignés / périmètre) | Après | Écart confirmé S3 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `surface_m2` | 3 386 747 / 3 386 747 | 100% | 3 386 747 / 3 386 747 | 100% | 0 lot |
| `adresse` | 2 559 983 / 3 386 747 | 75,59% | 2 559 983 / 3 386 747 | 75,59% | 0 lot |
| `code_postal` | 3 386 746 / 3 386 747 | 100% | 3 386 746 / 3 386 747 | 100% | 0 lot |
| `folded-normes` | 871 805 / 3 386 747 | 25,74% | 871 805 / 3 386 747 | 25,74% | 0 lot |
| `in_tod` (périmètre TOD) | 28 431 / 28 431 | 100% | 28 431 / 28 431 | 100% | 0 lot |

## Villes traitées et dépôts vérifiés

### Adresse — relance avec rôle foncier, sans `--no-role`

- `saint-pierre` (21 322 lots) : dépôt vérifié ; adresse reste 0%. La garde de recouvrement a refusé le meilleur rôle (`61020`, 238 lots appariés, minimum 639).
- `saint-louis-de-gonzague-du-cap-tourmente` (3 284) : dépôt vérifié ; adresse reste 0%. Recouvrement rôle insuffisant (1 appariement, minimum 98).
- `saint-felix-de-dalquier` (936) : dépôt vérifié ; adresse reste 0%. Aucun candidat `code_geo` pour le slug.
- `franquelin` (43) : dépôt vérifié ; adresse reste 0%. Recouvrement rôle insuffisant (22, minimum 30).
- `saint-gabriel-de-valcartier` (23) : dépôt vérifié ; adresse reste 0%. Recouvrement rôle insuffisant (21, minimum 30).
- `saint-eugene-de-ladriere` (5) : dépôt vérifié ; adresse reste 0%. Recouvrement rôle insuffisant (4, minimum 30).
- `remigny` (1) : dépôt vérifié ; adresse reste 0%. Recouvrement rôle insuffisant (1, minimum 30).

Ces sept relances confirment que le résidu ne vient pas de l'ancien mode sans rôle : aucune adresse n'a été créée sans jointure rôle/cadastre validée.

### Normes foldées — jointure lot → zone → normes, puis enrichissement avec rôle

- `val-des-monts` (5 342 lots) : jointure et dépôt vérifiés ; 78,38% de lots zonés mais 0% de correspondance code-zone/normes, donc `folded-normes` reste 0%.
- `disraeli--les-appalaches` (1 482) : jointure et dépôt vérifiés ; 2,43% zonés, 0% de correspondance normes, donc reste 0%.
- `berthier-sur-mer` (1 469) : jointure et dépôt vérifiés ; 99,86% zonés, mais 0% de correspondance normes, donc reste 0%.
- `saint-leon-de-standon` (1 468) : jointure et dépôt vérifiés ; correspondance normes de 4,29%, inchangée.
- `saint-fabien-de-panet` (1 378) : jointure et dépôt vérifiés ; 100% zonés, mais 0% de correspondance normes, donc reste 0%.

## Villes skippées

- `saint-come` (5 301 lots) : calcul `lot-zone-join-run` interrompu après dépassement de la limite de six minutes ; aucun dépôt ni progrès n'est attribué.
- Les villes non sélectionnées dont `normesStatus` est `to-research` ne sont pas traitées ici : l'absence ou l'indisponibilité de normes relève de la lane normes. Aucune valeur n'a été produite pour elles.

## Preuve et garde-fous

- Audit initial : `work/delegation-mass/immo-lots-fields-before-20260718T000000Z.json`.
- Audit final : `work/delegation-mass/immo-lots-fields-after-20260718T000000Z.json`.
- `lots-enriched-run.ts` a été lu avant les relances : `--no-role` remet effectivement `adresse` à `null`; ce drapeau n'a jamais été utilisé ici.
- Toutes les valeurs absentes à la source ou refusées par la garde de recouvrement restent `null`.
