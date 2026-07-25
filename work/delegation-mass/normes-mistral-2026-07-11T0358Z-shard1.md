# Normes via Mistral — shard 1/4 — 2026-07-11T03:58Z

## Portée

- Branche: `feat/cadre-acquisition`.
- Sélection recalculée depuis `work/coverage/coverage-matrix.json`: villes avec `zones.status == done` et `normes.status != done`, triées, puis filtre `index % 4 == 1`.
- Le shard a été recalculé après les merges; les dépôts sortent du reliquat et les indices restants sont redistribués.
- Extraction exclusivement Mistral: OCR `mistral-ocr-4-0` et, pour les grilles transposées, `document_annotation` via `mistral-schema`. Aucun GPT/codex.
- Dépôts parquet-only, puis `zonage-norms-manifest-merge.ts --apply`.
- Budget réel de la passe: environ 0,682 USD, toujours inférieur à 1 USD par ville. Aucun slug n'a dépassé 6 minutes.
- `.claude`, `.track` et secrets laissés intacts.

## Dépôts nets

| slug | moteur | lignes / codes | overlap SIG | publishedFieldPct | coût Mistral de la passe |
|---|---|---:|---:|---:|---:|
| `saint-charles-garnier` | `ocr/mistral-schema`, pages 228..235 | 60 | 45/45 SIG | 22,3 % | 0,032 USD |
| `saint-denis-de-la-bouteillerie` | native-first + OCR Mistral | 19 | 19/22 SIG | 50 % | 0,003 USD |
| `saint-valerien` | `ocr/mistral-schema`, grille séparée 43 pages | 43 | 41/54 SIG | 18,3 % | 0,252 USD |
| `sainte-helene-de-kamouraska` | native-first + OCR Mistral | 19 | 19/21 SIG | 50 % | 0,002 USD |
| `mirabel` | `ocr/mistral-schema`, pages 1..100 des tableaux U-2300 | 50 | 50/711 SIG | 59,3 % | 0,300 USD |

Clés déposées:

- `registry/qc-zonage-norms/qc-zonage-norms-saint-charles-garnier.parquet`
- `registry/qc-zonage-norms/qc-zonage-norms-saint-denis-de-la-bouteillerie.parquet`
- `registry/qc-zonage-norms/qc-zonage-norms-saint-valerien.parquet`
- `registry/qc-zonage-norms/qc-zonage-norms-sainte-helene-de-kamouraska.parquet`
- `registry/qc-zonage-norms/qc-zonage-norms-mirabel.parquet`

Les cinq produits respectent les gates: au moins 3 codes verbatim, overlap SIG non nul, champs publiés non nuls et valeurs verbatim-ou-null.

## Sources officielles productives

- Saint-Charles-Garnier: règlement 167, grille aux pages PDF 228..235. L'OCR simple trouvait 63 codes mais 0 % de champs; le schéma Mistral a produit les valeurs.
- Saint-Denis-de-la-Bouteillerie: annexe officielle `STDEN_381_GRILLES_2025-08-adoption-finale.pdf`, une zone par page.
- Sainte-Hélène-de-Kamouraska: `Grille-adoption-finale.pdf`, retrouvée via le catalogue média officiel.
- Saint-Valérien: le règlement principal ne contenait qu'une page-titre d'annexe; la vraie source est `Grilles-de-Zonage1.pdf`, retrouvée via le catalogue média officiel.
- Mirabel: le règlement principal renvoie au document séparé `1.1_-_TABLEAUX_DES_DISPOSITIONS_U-2300_(U-2679_11_septembre_2025).pdf`. Les pages vont par paires, une zone par paire.

Mirabel est volontairement partiel: 100 pages traitées en environ 4 min 13 s, soit 50 zones certaines sur 711 codes SIG. Un passage complet de 1 564 pages aurait dépassé la limite de 6 minutes. Aucun second segment n'a été forcé, car il aurait écrasé le premier dépôt au lieu de le composer.

## Gates refusés / preuves nouvelles

| slug | preuve |
|---|---|
| `duhamel-ouest` | règlement MRC, 67 pages OCR, 0 zone, 0,067 USD |
| `ripon` | schéma Mistral sur la grille transposée d'une page: 0 zone, gate `<3`, 0,003 USD |
| `moffet` | pages 36..46 du règlement, y compris les catégories et marges: 0 zone même avec expansion préfixée, 0,011 USD |
| `saint-elzear-de-temiscouata` | PDF officiel confirmé; pages 57..58 décrivent l'interprétation des grilles mais ne contiennent pas l'annexe; OCR puis schéma: 0 zone, 0,008 USD |
| `saint-eugene-de-ladriere` | PDF officiel confirmé; page 63 décrit les marges prescrites par une grille séparée absente; OCR puis schéma: 0 zone, 0,004 USD |
| `saint-alexandre-de-kamouraska` | règlement 160-42-2025 confirmé; page détectée = tableaux d'affichage et renvois aux grilles, annexe non incluse |
| `new-carlisle` | l'« annexe » officielle disponible porte sur l'érosion/cadre normatif, pas la grille de spécifications par zone |

## Réutilisation des preuves du shard courant

Après chaque merge, le shard a été repioché. Les lots résiduels ont été recoupés avec tous les rapports `work/delegation-mass/normes-mistral-*.md` existants afin de ne pas repayer les mêmes PDF. Les preuves réutilisées couvrent notamment:

- 0 zone extraite: `adstock`, `belleterre`, `brebeuf`, `east-broughton`, `fortierville`, `namur`, `ragueneau`, `saint-anaclet-de-lessard`, `saint-damien`, `saint-marcel-de-richelieu`, `saint-pierre-de-broughton`, `saint-romain`, `sainte-brigitte-des-saults`, `sainte-rose-de-watford`, `valcourt--le-val-saint-francois--2`;
- overlap SIG nul: `kinnears-mills`, `les-iles-de-la-madeleine`, `lislet`, `notre-dame-du-nord`, `papineauville`;
- `publishedFieldPct=0`: `lac-saint-joseph` et plusieurs règlements où seuls les codes/renvois ont été lus;
- document invalide ou non-grille: `auclair`, `batiscan`, `saint-godefroi`, `saint-lazare`, `sainte-flavie`;
- aucune grille officielle confirmée après crawler/portail: les petites municipalités résiduelles sans PDF local ou absentes de la registry PV.

Ainsi, aucune cible résiduelle n'a été promue sans preuve et aucun échec connu n'a été rejoué aveuglément.

## Merge et dérivés

- Merge 1: manifeste 599 -> 603, ajout des quatre premiers dépôts, aucun stock supprimé.
- Merge 2: manifeste 603 -> 604, ajout de Mirabel, aucun stock supprimé.
- L'entrée parasite `registry` a échoué en lecture lors des deux merges; elle n'a bloqué aucun produit municipal.

| slug | lot-zone-join | lots-enriched |
|---|---|---|
| `saint-charles-garnier` | 484 lots, affectés 100 %, match normes 100 % | normes 100 % |
| `saint-denis-de-la-bouteillerie` | 913 lots, affectés 100 %, match 99,67 % | normes 99,67 % |
| `saint-valerien` | 1 462 lots, affectés 100 %, match 83,86 % | normes 83,86 % |
| `sainte-helene-de-kamouraska` | 976 lots, affectés 99,9 %, match 99,9 % | normes 99,8 % |
| `mirabel` | 7 746 lots, affectés 100 %, match 4,35 % | normes 4,35 %; couverture volontairement partielle |

## Bilan

- 5 dépôts parquet nets via Mistral.
- 5 merges/manifest entries effectifs, aucun produit douteux forcé.
- 11 581 lots reconstruits dans les cinq municipalités.
- Le levier principal a été la récupération de l'annexe/grille séparée officielle, puis `mistral-schema` pour les tableaux transposés.
