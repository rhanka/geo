# IMMO lots fields — shard 0/1

Date de clôture : `2026-07-18T09:28:09Z`. Le shard `0/1` couvre chaque slug de la liste lexicographiquement triée.

## Mesure S3, avant / après

Les deux mesures sont les sidecars S3 relus par `immo-lots-audit.ts` :
[`before`](immo-lots-fields-20260718T092154Z-before.json) et
[`after`](immo-lots-fields-20260718T092743Z-after.json). Aucune valeur n'est
déduite de journaux locaux.

| Champ | Avant | Après | Delta |
|---|---:|---:|---:|
| `surface_m2` | 3 379 358 / 3 379 358 (100 %) | 3 379 358 / 3 379 358 (100 %) | 0 |
| `adresse` | 2 552 682 / 3 379 358 (75,54 %) | 2 552 682 / 3 379 358 (75,54 %) | 0 |
| `code_postal` | 3 379 357 / 3 379 358 (100 %) | 3 379 357 / 3 379 358 (100 %) | 0 |
| `folded-normes` | 871 804 / 3 379 358 (25,80 %) | 871 804 / 3 379 358 (25,80 %) | 0 |
| `in_tod` (périmètre TOD) | 28 431 / 28 431 (100 %) | 28 431 / 28 431 (100 %) | 0 |

## Villes traitées

Le comportement du piège connu a été vérifié dans `lots-enriched-run.ts` :
sans rôle, la sortie fixe `adresse` à `null`. Toutes les relances ci-dessous
ont donc utilisé le rôle (aucun `--no-role`). Les sept dépôts ont été vérifiés,
mais la jointure conservatrice du rôle les laisse honnêtement à zéro :

| Slug | Lots | Résultat rôle vérifié |
|---|---:|---|
| `saint-pierre` | 21 322 | meilleur code `61020`, 238 recouvrements, seuil 639 : rejeté |
| `saint-louis-de-gonzague-du-cap-tourmente` | 3 284 | meilleur code `21015`, 1 recouvrement, seuil 98 : rejeté |
| `saint-felix-de-dalquier` | 936 | aucun candidat `code_geo` |
| `franquelin` | 43 | meilleur code `96015`, 22 recouvrements, seuil 30 : rejeté |
| `saint-gabriel-de-valcartier` | 23 | meilleur code `22025`, 21 recouvrements, seuil 30 : rejeté |
| `saint-eugene-de-ladriere` | 5 | meilleur code `10075`, 4 recouvrements, seuil 30 : rejeté |
| `remigny` | 1 | meilleur code `85105`, 1 recouvrement, seuil 30 : rejeté |
| `pierreville` | 1 831 | re-enrichi pour le seul résidu FSA matériel : `code_postal` reste 1 830 / 1 831 |

## Villes skippées et raisons

- `aguanish`, `caniapiscau`, `cote-nord-du-golfe-du-saint-laurent`,
  `havre-saint-pierre`, `lile-danticosti` et `metis-sur-mer` : le produit servi
  contient zéro lot. Les résidus `surface_m2`/FSA affichés à 0 % viennent donc
  d'un dénominateur nul; un enrichissement ne peut pas les augmenter.
- `beauharnois` et `bois-des-filion` : normes déposées mais jointure lot-zone
  absente; `lot-zone-join-run.ts` a été tenté et a refusé correctement les deux
  villes, faute de zones sous `normalized/ca-qc-zonage/`.
- `folded-normes` : gate anti-régression exécuté sur 68 candidats à normes
  déposées : 51 `STERILE`, 15 `REGRESSIF`, 2 `NO-JOIN`, et aucun
  `REJOUABLE-GAIN`. Les relances de join/fold sur les 66 cas déjà repliés ou
  régressifs auraient produit zéro gain ou une baisse; elles ont été écartées.
  Les deux `NO-JOIN` sont les villes ci-dessus, déjà refusées faute de zones.

## Artefacts

- [`triage`](immo-lots-fields-20260718T092154Z-triage.json) : cibles shardées
  par champ avant intervention.
- Les snapshots avant/après sont les seules preuves de couverture utilisées
  dans ce rapport.
