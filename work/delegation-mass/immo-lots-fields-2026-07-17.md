# WP9 — champs lots immo — shard 0/1

Date : 2026-07-17 (America/Toronto). Le shard `0/1` couvre tous les slugs
triés. Tous les ré-enrichissements ont été lancés **avec** le rôle foncier ;
`--no-role` / `--enrich-no-role` n'a jamais été utilisé.

## Audit S3 avant / après

Les deux mesures proviennent de `npx tsx acquisition/src/immo-lots-audit.ts`.
Les chiffres ci-dessous sont présentés champ par champ ; la différence de
nombre de dépôts/lots entre les deux instantanés est partagée avec les autres
travaux actifs et n'est pas attribuée à cette exécution.

| Champ | Avant | Après |
| --- | --- | --- |
| `surface_m2` | 3 369 947 / 3 369 947 (100 %), 848 munis pleines | 3 371 619 / 3 371 619 (100 %), 849 munis pleines |
| `adresse` | 2 544 149 / 3 369 947 (75,50 %), 613 munis pleines, 841 avec une valeur | 2 545 630 / 3 371 619 (75,50 %), 613 munis pleines, 842 avec une valeur |
| `code_postal` | 3 369 946 / 3 369 947 (100 %), 848 munis pleines | 3 371 618 / 3 371 619 (100 %), 849 munis pleines |
| `folded-normes` | 862 611 / 3 369 947 (25,60 %), 211 munis pleines, 575 avec une valeur | 862 745 / 3 371 619 (25,59 %), 211 munis pleines, 576 avec une valeur |
| `in_tod` | 28 431 / 28 431 (100 % scoped), 4 munis | 28 431 / 28 431 (100 % scoped), 4 munis |

## Villes traitées

### Adresse, surface et code postal

Ré-enrichissement avec rôle + FSA :

`aguanish`, `caniapiscau`, `cote-nord-du-golfe-du-saint-laurent`,
`franquelin`, `havre-saint-pierre`, `lile-danticosti`, `metis-sur-mer`,
`remigny`, `saint-eugene-de-ladriere`, `saint-felix-de-dalquier`,
`saint-gabriel-de-valcartier`,
`saint-louis-de-gonzague-du-cap-tourmente`, `saint-pierre`.

Après audit, les 13 restent à `adresse=0`. Les six communes
`aguanish`, `caniapiscau`, `cote-nord-du-golfe-du-saint-laurent`,
`havre-saint-pierre`, `lile-danticosti` et `metis-sur-mer` ont 0 lot cadastre :
aucune valeur ne peut être calculée. Pour les autres, la jointure rôle ne
franchit pas la garde d'overlap ou ne produit pas d'adresse source ; les nulls
sont donc conservés.

Les résidus `surface_m2` sont ces mêmes six communes vides. Les six premiers
résidus `code_postal` sont également vides. `pierreville` a été ré-enrichie :
l'audit confirme 1 830 / 1 831 (99,95 %) ; le dernier lot reste null car le
géocodage RTA/FSA source ne le couvre pas.

### Folded normes

Jointure `lot-zone-join-run.ts`, puis enrichissement avec rôle, pour :

- `remigny`, `saint-eugene-de-ladriere`, `saint-gabriel-de-valcartier`,
  `franquelin`, `bearn`, `mont-carmel`, `riviere-au-tonnerre`,
  `lac-superieur`;
- `ferme-neuve`, `val-dor`, `kingsbury`, `les-escoumins`, `duhamel`,
  `temiscaming`, `leclercville`, `hatley-township-municipality`,
  `belleterre`, `saint-roch-ouest`.

Les sorties de jointure confirment notamment : Ferme-Neuve 9 / 116,
Val-d'Or 18 / 129, Kingsbury 161 / 165, Les Escoumins 1 / 165 et Duhamel
57 / 218 lots avec normes. Les communes du premier lot ont produit des taux
de correspondance norme-zone de 0 % lorsqu'ils ont été signalés par le runner
(`remigny`, `saint-eugene-de-ladriere`, `saint-gabriel-de-valcartier`,
`franquelin`, `bearn`) : aucune norme n'a été fabriquée.

## Villes skippées / reste

- `aguanish`, `caniapiscau`, `cote-nord-du-golfe-du-saint-laurent`,
  `havre-saint-pierre`, `lile-danticosti`, `metis-sur-mer` : données cadastre
  vides, donc `surface_m2`, adresse et RTA ne sont pas calculables.
- `pierreville` : un lot hors polygone RTA, `code_postal` laissé null.
- Les 174 communes dont l'audit donne `normesStatus=to-research` et
  `folded-normes<100` sont skippées : aucune norme déposée, donc elles relèvent
  de la lane normes. La liste exacte est lue dans
  `work/coverage/immo-lots.json` au moment de l'audit.
- 630 communes `normesStatus=done` ont encore `folded-normes<100`. Elles ne
  sont pas déclarées faites : la boucle doit continuer dans un prochain lot
  borné, après cette exécution.

## Garde appliquée

Le runner confirme que `--no-role` désactive la jointure et écrit
`adresse=null`. Cette option n'a pas été employée. Chaque valeur conservée
provient donc d'une jointure rôle, géométrie ou RTA/FSA effectivement mesurée
sur S3 ; aucune valeur n'a été inférée.
