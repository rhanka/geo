# IMMO lots fields — shard 0/1

Audit S3 avant : `work/coverage/immo-lots-before-20260717-shard0-current.json` (2026-07-17T23:55:09.081Z).

Audit S3 après : `work/coverage/immo-lots-after-20260717-shard0-current.json` (2026-07-18T00:04:10.506Z).

## Avant / après par champ

| Champ | Avant | Après | Lecture S3 |
|---|---:|---:|---|
| `surface_m2` | 3 368 162 / 3 368 162 (100 %) | 3 369 947 / 3 369 947 (100 %) | Aucun résidu réel dans le shard avant le lot. |
| `adresse` | 2 542 382 / 3 368 162 (75,48 %) | 2 544 149 / 3 369 947 (75,50 %) | Aucun gain sur les cibles traitées. L’écart global accompagne une ville servie supplémentaire pendant l’audit ; il n’est pas attribué à ce lot. |
| `code_postal` | 3 368 161 / 3 368 162 (100 % arrondi) | 3 369 946 / 3 369 947 (100 % arrondi) | Pierreville conserve 1 / 1 831 lot hors RTA/FSA, donc `null` conformément à la source. |
| `folded-normes` | 862 611 / 3 368 162 (25,61 %) | 862 611 / 3 369 947 (25,60 %) | Aucun gain sur les jointures rejouées ; les sources et codes disponibles ne permettent pas de compléter davantage. |
| `in_tod` | 28 431 / 28 431 (100 % scoped) | 28 431 / 28 431 (100 % scoped) | Hors périmètre, déjà complet. |

Les dénominateurs globaux ont changé de 853 à 854 villes servies entre les deux lectures S3. Aucun delta global n’est revendiqué comme résultat du présent lot.

## Villes traitées

- `saint-pierre` — ré-enrichie avec rôle/FSA et jointure lot→zone→normes recalculée : 129 / 21 322 normes (0,61 %) inchangé. Adresse maintenue à `null` : meilleur rôle `61020`, chevauchement 238 < seuil 639.
- `saint-felix-de-dalquier` — jointure et ré-enrichissement : 71 / 936 normes (7,59 %) inchangé ; correspondance code→norme 8,51 %. Adresse `null` : aucun `code_geo` candidat sûr.
- `franquelin` — jointure et ré-enrichissement : 0 / 43 norme, correspondance code→norme 0 %. Adresse `null` : chevauchement 22 < 30.
- `saint-gabriel-de-valcartier` — jointure et ré-enrichissement : 0 / 23 norme, correspondance 0 %. Adresse `null` : chevauchement 21 < 30.
- `saint-eugene-de-ladriere` — jointure et ré-enrichissement : 0 / 5 norme, correspondance 0 %. Adresse `null` : chevauchement 4 < 30.
- `remigny` — jointure et ré-enrichissement : 0 / 1 norme, correspondance 0 %. Adresse `null` : chevauchement 1 < 30.
- `pierreville` — ré-enrichie avec rôle/FSA pour le résidu code postal : 1 / 1 831 lot reste hors polygone RTA/FSA ; aucune valeur n’a été inventée.

## Villes skippées

- `saint-louis-de-gonzague-du-cap-tourmente` — ré-enrichie avec rôle/FSA (adresse toujours `null`, meilleur chevauchement 1 < 98). La jointure normes est skippée : les zones n’ont aucun `zone_code` exploitable.
- `montreal` — tentative limitée à six minutes sans drapeau `--no-role`, mais aucun `OK … deposit=Y` n’a été produit. L’audit S3 final est inchangé pour cette ville (adresse 279 149 / 680 087 ; normes 0 / 680 087) ; elle n’est donc pas comptée comme traitée.

## Contrôles appliqués

- `lots-enriched-run.ts` a été vérifié avant les exécutions : `--no-role` désactive explicitement le rôle et laisse `adresse` nulle. Aucun appel de ce lot n’a utilisé `--no-role` ni `--enrich-no-role`.
- Chaque exécution a été bornée par `timeout 360s` ; seules les écritures S3 confirmées par `deposit=Y` sont rapportées comme traitées.
- L’audit final S3 est la seule source des chiffres avant/après ci-dessus.
