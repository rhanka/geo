# IMMO lots fields — shard 0/1

Audits S3 : avant `2026-07-18T07:41:23.553Z`, après `2026-07-18T07:54:50.229Z`.
Le second audit contient `mayo` (1 005 lots), nouvelle ville servie entre les deux mesures. Les deltas agrégés ci-dessous proviennent donc de cette arrivée concurrente ; aucun gain n'est attribué aux villes de cette passe.

## Avant / après, par champ

| Champ | Avant | Après | Delta mesuré |
| --- | --- | --- | --- |
| `surface_m2` | 3 376 204 / 3 376 204 (100%) | 3 377 209 / 3 377 209 (100%) | +1 005 / +1 005 (`mayo`) |
| `adresse` | 2 549 903 / 3 376 204 (75,53%) | 2 550 813 / 3 377 209 (75,53%) | +910 / +1 005 (`mayo`) |
| `code_postal` | 3 376 203 / 3 376 204 (100%) | 3 377 208 / 3 377 209 (100%) | +1 005 / +1 005 (`mayo`) |
| `folded-normes` | 865 791 / 3 376 204 (25,64%) | 865 959 / 3 377 209 (25,64%) | +168 / +1 005 (`mayo`) |
| `in_tod` (scopé) | 28 431 / 28 431 (100%) | 28 431 / 28 431 (100%) | 0 / 0 |

## Villes traitées

- Adresse, enrichissement avec rôle actif (jamais `--no-role`) : `saint-pierre`, `saint-louis-de-gonzague-du-cap-tourmente`, `saint-felix-de-dalquier`, `franquelin`, `saint-gabriel-de-valcartier`, `saint-eugene-de-ladriere`, `remigny`. Le contrôle S3 confirme 0 adresse pour chacune : aucun candidat rôle ne satisfait le seuil de recouvrement, sauf `saint-felix-de-dalquier` sans candidat `code_geo`.
- Folded-normes, jointure puis enrichissement : `berthierville`, `hinchinbrooke`, `huntingdon`, `mille-isles`, `saint-martin`, `saint-polycarpe`, `la-presentation`, `saint-chrysostome`, `saint-cuthbert`, `saint-benoit-labre`, `brigham`. Les dépôts sont vérifiés S3, mais leur couverture est inchangée : les taux de correspondance zone→normes sont 0% à 12,7% (et l'assignation de zones est 0% pour `saint-martin`).
- Code postal : `pierreville` ré-enrichie ; 1 lot sur 1 831 reste hors RTA, donc `code_postal=null` est conservé.

## Villes skippées / résidus non inventables

- Pas de couche zones S3, donc pas de jointure normes possible : `cap-chat`, `sainte-anne-de-bellevue`, `amherst`, `baie-durfe`.
- Résidu `surface_m2` sans lot : `aguanish`, `caniapiscau`, `cote-nord-du-golfe-du-saint-laurent`, `havre-saint-pierre`, `lile-danticosti`, `metis-sur-mer`. Ces six villes ont `numLots=0` ; aucune surface ne peut être produite.
- Les mêmes six villes sont également hors périmètre matériel de `code_postal` ; le seul résidu avec lots est `pierreville`, traité ci-dessus.
- Les 829 villes avec une adresse partielle et les 790 villes restantes avec `folded-normes<100%` restent à reprendre. Cette passe ne les déclare pas faites : les vérifications menées montrent des sources rôle/zones/normes insuffisantes ou incompatibles, sans valeur de remplacement admissible.

## Preuve d'attribution

Pour chaque ville ciblée, les compteurs S3 `adresse`, `code_postal` et `folded-normes` sont identiques avant/après. La seule nouvelle clé servie est `mayo`; elle explique exactement les +1 005 lots de dénominateur et les deltas de compteurs globaux. `in_tod` n'a pas été modifié.
