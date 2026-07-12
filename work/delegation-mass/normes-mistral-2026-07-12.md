# Normes via Mistral — shard 3/4 — 2026-07-12

## Périmètre et méthode

- Sélection déterministe : `sorted-index % 4 == 3`, coverage `zones=done` et `normes!=done`.
- 59 slugs éligibles au départ, traités en quatre lots (15 + 15 + 15 + 14).
- Supervision exécutée au démarrage puis entre les lots et après les dépôts.
- Moteurs utilisés exclusivement : `mistral-ocr-4-0` (`--route ocr`) et Mistral `document_annotation` (`--engine mistral-schema`). Aucun GPT/Codex.
- Dépôts parquet-only (`--no-manifest` pour les runners), puis `zonage-norms-manifest-merge.ts --apply`.
- Budget : au plus 1 USD par ville ; coût Mistral estimé du shard : **≈ 5,131 USD**.

## Dépôts qui passent les gates

| slug | moteur | pages | codes | champs publiés | SIG / overlap | coût | résultat |
|---|---|---:|---:|---:|---:|---:|---|
| `saint-theophile` | `ocr/mistral-schema` | 126 | 16 | 13,3 % | 55 / 2 | 0,378 USD | parquet déposé |
| `wotton` | `ocr/mistral-schema` | 156 | 39 | 29,5 % | 58 / 7 | 0,468 USD | parquet déposé |

Les deux produits ont satisfait : au moins 3 codes réels, overlap SIG non nul, `publishedFieldPct` non nul et valeurs verbatim-or-null. Le manifeste a ajouté les deux entrées ; l’échec de lecture de la clé `registry` pendant la fusion n’a pas empêché les reconstructions parquet.

Post-traitements exécutés :

- `saint-theophile` : lot-zone join 464/464 lots assignés ; lots enrichis déposés.
- `wotton` : 1 217/1 218 lots assignés ; lots enrichis déposés.

Les taux de correspondance normes restent respectivement 5,6 % et 35,41 % ; ils sont rapportés comme tels, sans élargissement ni invention.

## Preuves d’échec / gates

Les slugs suivants ont été tentés avec le flux Mistral disponible et n’ont pas été déposés :

- `aston-jonction` (2 codes puis 0), `beaulac-garthby` (overlap 0), `belleterre` (overlap 0), `dunham` (0), `fermont` (0), `kinnears-mills` (overlap 0), `la-guadeloupe` (champs publiés 0), `lac-megantic` (PDF local invalide, `pdftotext` en erreur).
- `moffet` (overlap 0), `new-carlisle` (champs 0/overlap 0), `notre-dame-de-stanbridge` (0), `notre-dame-du-nord` (overlap 0), `parisville` (overlap 0), `pierreville` (0), `saint-alexandre-de-kamouraska` (0), `saint-anaclet-de-lessard` (champs 0), `saint-bruno-de-guigues` (champs 0), `saint-camille` (0).
- `saint-felix-de-kingsey` (overlap 0), `saint-honore` (carte/champs 0), `saint-juste-du-lac` (champs 0), `saint-lin-laurentides` (0).
- `saint-michel-du-squatec` (overlap 0), `saint-simon-de-rimouski` (overlap 0), `sainte-anne-de-sorel` (0), `westbury` (1 code, sous le minimum).

Les slugs sans PDF local ni entrée de découverte productible ont été constatés et laissés en preuve, sans fabrication d’URL ni dépôt : `cascapedia-saint-jules`, `honfleur`, `irlande`, `la-redemption`, `landrienne`, `launay`, `les-hauteurs`, `manseau`, `marieville`, `montreal`, `saint-adrien-dirlande`, `saint-cleophas-de-brandon`, `saint-edmond-les-plaines`, `saint-elzear--bonaventure`, `saint-ephrem-de-beauce`, `saint-francois-de-la-riviere-du-sud`, `saint-gabriel`, `saint-jean-de-dieu`, `saint-leonard-daston`, `saint-louis-de-gonzague--les-etchemins`, `saint-marcel`, `saint-medard`, `saint-philippe-de-neri`, `saint-rene-de-matane`, `saint-sylvestre`, `sainte-germaine-boule`, `shigawake`, `val-saint-gilles`.

`saint-pierre-de-lile-dorleans` ne disposait que d’un plan local ; `trois-pistoles` avait un PDF local de 3 KB non exploitable. Le crawler PV ciblé des petites municipalités a retourné 0 cible car ces slugs ne sont pas dans sa registry ; les pages officielles ciblées n’ont pas fourni de PDF de grille confirmé dans ce lot.

## État final

- Le sélecteur final du shard indique `57` slugs encore éligibles et `2` passés à `normes=done` (`saint-theophile`, `wotton`). Les 57 ont chacun une preuve de non-dépôt ci-dessus.
- Aucun secret, `.claude` ou `.track` n’a été modifié intentionnellement.
