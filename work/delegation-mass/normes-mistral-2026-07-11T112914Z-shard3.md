# Normes Mistral — shard 3/4 — 2026-07-11T11:29:14Z

## Portée

- Shard figé au démarrage sur la liste triée des 297 villes `zones.status=done` et `normes.status!=done`: indices où `index % 4 == 3`, soit 74 slugs.
- Le shard initial a été conservé malgré les dépôts concurrents afin d'éviter que le retrait de villes de la matrice ne décale les indices et ne crée des chevauchements entre lanes.
- Extraction exclusivement Mistral: `mistral-ocr-4-0` et `ocr/mistral-schema` (`document_annotation`). Aucun appel GPT/Codex.
- Tous les dépôts sont parquet-only, puis réconciliés par `zonage-norms-manifest-merge.ts --apply`.
- Budget observé: environ 1,044 USD au total, toujours inférieur à 1 USD par ville.

## Dépôts nets

| Slug | Source / pages | Moteur | Codes | Overlap SIG | Champs publiés | Résultat |
|---|---|---:|---:|---:|---:|---|
| `saint-charles-de-bellechasse` | règlement 23-372, p.128–180 | Mistral schema | 53 | 53/53 | 47,2 % | parquet déposé |
| `saint-gervais` | règlement 247-04, annexe I p.77–81 | Mistral schema | 35 | 32/36 | 42,5 % | parquet déposé |
| `saint-thomas-didyme` | règlement 370-10, cahier p.320–328 | Mistral schema | 45 | 41/50 | 56,9 % | parquet déposé |

Manifeste: 616 entrées avant fusion, 618 après; `saint-gervais` et `saint-thomas-didyme` ajoutés. `saint-charles-de-bellechasse` était déjà présent au moment de la fusion concurrente.

## Reconstruction aval

| Slug | Lots | Zone assignée | Lots avec normes | Lots sans normes |
|---|---:|---:|---:|---:|
| `saint-charles-de-bellechasse` | 2 386 | 99,92 % | 100 % des lots zonés | 0 % |
| `saint-gervais` | 1 760 | 100 % | 98,98 % | 1,02 % |
| `saint-thomas-didyme` | 698 | 100 % | 96,85 % | 3,15 % |

`lot-zone-join-run.ts` et `lots-enriched-run.ts` ont terminé avec `ok=3`, aucune vérification ni aucun dépôt aval en échec.

## Rejets anti-invention Mistral

| Slug | Preuve / gate bloquant |
|---|---|
| `bedford--brome-missisquoi--2` | auto-grid p.38–42; 0 zone extraite; l'annexe B n'est pas incorporée au règlement |
| `dosquet` | OCR: 2 codes (`LAC`, `115`), overlap 0/34; schema p.55–60: 0 zone |
| `dupuy` | règlement officiel confirmé; l'annexe 3 ne contient qu'une page de garde; 1 faux code `92`, 0 norme |
| `fugereville` | 0 zone extraite sur 55 pages |
| `ivry-sur-le-lac` | 0 zone sur les 80 premières pages; les grilles sont une annexe séparée |
| `lassomption` | OCR: 91 nombres, overlap 0/359; pont numérique strict: 0 bridge; schema: 4 classes, 0 norme |
| `laverlochere-angliers` | p.57–67: dispositions textuelles par catégorie; 0 zone extraite |
| `moffet` | 0 zone extraite sur 50 pages |
| `namur` | vraie grille: 24 zones et 69,3 % de champs, mais overlap 0 avec les 4 codes SIG actuels |
| `parisville` | p.193–194: seulement la page de garde de l'annexe; 0 zone |
| `saint-andre-de-restigouche` | le PDF local est l'annexe de Saint-Alexis; 6 faux codes/libellés, overlap 0/33 |
| `saint-charles-de-bellechasse` | OCR simple rejeté (0 % champs puis `MIN`/`MAX`); schema ciblé a ensuite passé tous les gates |
| `saint-cyrille-de-lessard` | règlement officiel confirmé; annexe B p.159–160 traitée par schema: 0 zone |
| `saint-edouard-de-fabre` | tableaux textuels p.56–66 traités par OCR Mistral: 0 zone |
| `saint-remi-de-tingwick` | vraie grille: 38 zones et 54,9 % de champs, mais overlap 0/26 SIG |
| `sainte-anne-de-sorel` | p.295–296: pages de garde d'annexe; 0 zone |

## Faux documents locaux éliminés sans coût Mistral

- `lac-megantic/grille.pdf` et l'ancien `saint-lazare/grille.pdf`: non-PDF.
- `price/src.pdf`: cahier de spécifications de Pointe-Lebel, pas Price.
- `saint-benjamin/grille.pdf`: ordre du jour du conseil.
- `saint-malo/grille.pdf`: modification du règlement sur les permis, pas une grille.
- `saint-pie/grille.pdf`: programme de mise aux normes des installations septiques.
- `sainte-aurelie/grille.pdf`: procès-verbal.
- `schefferville/grille.pdf`: document sans grille de zonage; les autres PDF sont des grilles tarifaires/pompiers.
- `notre-dame-des-pins/grille.pdf`: plan d'urbanisme et grille d'affectation du sol.
- nouveau PDF officiel de `saint-lazare`: règlement modificatif 1173 seulement, trois grilles modifiées mais non reproduites intégralement.
- `riviere-bleue`: le PDF officiel 2026-487.1 est classifié `plan-image`, une seule page, sans grille de normes.

## Découverte

- Le crawler PV n'a confirmé aucun PDF pour Aston-Jonction et ignore la majorité des petites municipalités, ce qui confirme qu'il ne peut pas être utilisé seul.
- Découverte par portails MRC/municipaux et recherche web officielle effectuée par lots: Témiscamingue, Abitibi-Ouest, Avignon/Bonaventure, Matapédia/La Mitis, Bellechasse, Etchemins, Témiscouata, Nicolet-Yamaska et Maria-Chapdelaine.
- Sources HTTP 200 + PDF confirmées et classifiées pour Dupuy, Laverlochère-Angliers, Notre-Dame-des-Pins, Rivière-Bleue, Saint-Cyrille-de-Lessard, Saint-Édouard-de-Fabre, Saint-Gervais, Saint-Thomas-Didyme et Saint-Lazare. Les faux documents/pages de garde ont été conservés comme preuve, jamais déposés.
- Les URL menant explicitement à un projet de règlement, un amendement seul, une carte de zonage ou une autre municipalité ont été rejetées.

## Conclusion

Trois produits normes Mistral ont passé les gates stricts et alimentent maintenant les lots enrichis. Les 74 slugs du shard initial ont reçu soit un dépôt, soit une preuve de non-productibilité ou d'échec de gate dans cette passe. Les sources rejetées ont été arrêtées sur preuve vérifiable (`0 zone`, moins de 3 codes, overlap SIG nul, `publishedFieldPct=0`, annexe absente ou mauvais document), sans invention ni assouplissement du contrat.
