# IMMO lots — champs WP9, shard 0/1

Audit S3 de départ : `2026-07-18T01:00:55.083Z`.
Audit S3 final : `2026-07-18T01:16:09.602Z`.

## Avant / après, par champ

| Champ | Avant S3 | Après S3 | Constat |
| --- | --- | --- | --- |
| `surface_m2` | 3 374 404 / 3 374 404 lots (100%) | 3 374 404 / 3 374 404 lots (100%) | Aucun résidu sur une ville ayant des lots. Les six villes à 0% dans le décompte municipal ont chacune 0 lot. |
| `adresse` | 2 548 225 / 3 374 404 lots (75,52%) | 2 548 225 / 3 374 404 lots (75,52%) | Les réenrichissements avec le rôle actif n'ont produit aucune adresse supplémentaire : les jointures non fiables restent nulles. |
| `code_postal` | 3 374 403 / 3 374 404 lots (100% arrondi) | 3 374 403 / 3 374 404 lots (100% arrondi) | Le seul lot sans RTA/FSA, à `pierreville`, reste sans polygone RTA au centroïde; il n'a pas été comblé. |
| `folded-normes` | 862 745 / 3 374 404 lots (25,57%) | 862 745 / 3 374 404 lots (25,57%) | Les jointures recalculées confirment les taux existants; les résidus viennent des couches de zones absentes ou des codes zones/normes non appariés. |
| `in_tod` (périmètre TOD) | 28 431 / 28 431 lots (100%) | 28 431 / 28 431 lots (100%) | Déjà complet dans les quatre municipalités avec produit TOD. |

## Villes traitées

### Adresse, rôle foncier conservé

- `franquelin`, `remigny`, `saint-eugene-de-ladriere`, `saint-felix-de-dalquier`, `saint-gabriel-de-valcartier`, `saint-louis-de-gonzague-du-cap-tourmente`, `saint-pierre`.
- Commande exécutée sans `--no-role` ni `--enrich-no-role`, avec `--time-box 360`.
- Chaque dépôt `qc-lots` a été vérifié par le runner. Aucune adresse n'a été ajoutée, car la validation cadastre↔rôle a refusé les candidats insuffisamment recouvrants (détails ci-dessous).

### Normes foldées, jointure puis enrichissement

- `amos` : jointure exécutée, 2,52% de lots assignés et 0% de codes appariés aux normes; réenrichi, résultat 0% normes.
- `amqui` : jointure 100% assignée, 99,64% de codes appariés; réenrichi, résultat 99,64% normes.
- `ange-gardien` : jointure 84,76% assignée, 3,03% de codes appariés; réenrichi, résultat 2,57% normes.
- `armagh` : jointure 100% assignée, 0,45% de codes appariés; réenrichi, résultat 0,45% normes.
- `arundel` : jointure 97,17% assignée, 75,24% de codes appariés; réenrichi, résultat 73,11% normes.
- `ascot-corner` : jointure 97,20% assignée, 20,20% de codes appariés; réenrichi, résultat 19,63% normes.

### Code postal

- `pierreville` : réenrichie avec l'index RTA/FSA; 1 830 / 1 831 lots restent renseignés (99,95%).

## Villes skippées ou résidus confirmés

- `amherst` : skip de `lot-zone-join-run.ts`, aucune couche de zones sous `normalized/ca-qc-zonage/`; les normes déposées ne peuvent donc pas être foldées dans les lots.
- `franquelin` : rôle candidat `96015`, 22 lots appariés, sous le seuil 30.
- `remigny` : rôle candidat `85105`, 1 lot apparié, sous le seuil 30.
- `saint-eugene-de-ladriere` : rôle candidat `10075`, 4 lots appariés, sous le seuil 30.
- `saint-felix-de-dalquier` : aucun `code_geo` candidat pour le slug.
- `saint-gabriel-de-valcartier` : rôle candidat `22025`, 21 lots appariés, sous le seuil 30.
- `saint-louis-de-gonzague-du-cap-tourmente` : rôle candidat `21015`, 1 lot apparié, sous le seuil 98.
- `saint-pierre` : rôle candidat `61020`, 238 lots appariés, sous le seuil 639.
- `amos`, `ange-gardien`, `armagh`, `arundel` et `ascot-corner` : normes déposées mais taux de correspondance codes zone↔normes sous 95%; c'est un résidu de la lane normes/couches zones, pas une valeur à déduire dans la lane lots.
- `pierreville` : centroïde du seul lot résiduel hors couverture RTA/FSA; `code_postal` reste null.

## Garde-fous appliqués

- Vérification préalable de `lots-enriched-run.ts` : `--no-role` saute la jointure rôle foncier et force effectivement les adresses à null; cette option n'a jamais été employée.
- Les champs absents de la source, les rôles non validés et les géocodages RTA absents restent nulls.
- Les chiffres ci-dessus proviennent exclusivement des audits S3 `immo-lots-audit.ts`.
