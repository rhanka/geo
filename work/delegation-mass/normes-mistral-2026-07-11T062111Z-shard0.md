# NORMES via Mistral — shard 0/4 — 2026-07-11T06:21:11Z

## Portée

- Branche: `feat/cadre-acquisition`.
- Partition stricte: villes de `coverage-matrix.json` avec `zones.status == done` et `normes.status != done`, liste triée, puis `index % 4 == 0`.
- Matrice au début: 305 productibles, 77 dans le shard. Après les merges concurrents et celui de cette passe: 302 productibles, 76 dans le shard.
- Extraction exclusivement Mistral: OCR `mistral-ocr-4-0`, puis `document_annotation` via `mistral-schema` pour la grille transposée. Aucun GPT/Codex utilisé pour extraire.
- Dépôts Parquet-only; aucun secret, fichier `.claude` ou `.track` touché.
- Aucun slug traité plus de 6 minutes; budget inférieur à 1 USD par ville.

## Dépôt net

| slug | source officielle | moteur | codes | overlap SIG | publishedFieldPct | coût |
|---|---|---|---:|---:|---:|---:|
| `saint-hubert-de-riviere-du-loup` | `https://www.municipalite.saint-hubert-de-riviere-du-loup.qc.ca/documents/pdf/2024/grille_de_specifications.pdf` | native-first + Mistral OCR 4.0 | 14 | 5/39 SIG | 25 % | 0,028 USD |

La source est une grille de spécifications séparée, trouvée au second niveau du site municipal officiel puis confirmée HTTP 200, `application/pdf`, signature `%PDF`. Le parquet a été déposé sous `registry/qc-zonage-norms/qc-zonage-norms-saint-hubert-de-riviere-du-loup.parquet`. Les gates stricts ont tous passé: au moins 3 codes réels, overlap SIG non nul, champs publiés non nuls, valeurs verbatim-or-null.

## Merge et dérivés

- `zonage-norms-manifest-merge.ts --apply`: manifeste 605 -> 608. Le merge a intégré Saint-Hubert ainsi que deux parquets concurrents déjà présents (`alma`, `notre-dame-du-bon-conseil--drummond`); aucun stock supprimé. L'entrée parasite `registry` a échoué sans bloquer les produits municipaux.
- `lot-zone-join-run.ts --slugs saint-hubert-de-riviere-du-loup`: 1 706 lots, 95,25 % affectés, match normes 4,06 %.
- `lots-enriched-run.ts --slugs saint-hubert-de-riviere-du-loup`: 1 706 lots, surface 100 %, code postal 100 %, adresse 93,79 %, normes 3,87 %.
- La faible couverture normes est conservée et rapportée: la grille certaine ne recoupe que 5 codes SIG; aucune propagation ou recodification incertaine n'a été forcée.

## Échec gate nouveau

### Saint-Gédéon-de-Beauce

- Source officielle confirmée HTTP 200/PDF: `https://www.st-gedeon-de-beauce.qc.ca/_files/ugd/d4d74a_14cd45e0795c4aacafc151e544d6cf75.pdf`.
- Mistral OCR 4.0: 49 codes, overlap 48/55 SIG, mais `publishedFieldPct=0`; rejet anti-invention. Coût 0,080 USD.
- Table des matières vérifiée: grilles de spécification aux pages PDF 45..55.
- Fallback Mistral `document_annotation` sur 45..55: 55 codes, overlap 55/55 SIG, mais encore `publishedFieldPct=0`; rejet. Coût 0,033 USD.
- Aucun dépôt: le document confirme les codes/usages mais ne fournit aucune valeur publiable dans les champs de normes du produit.

## Découverte et épuisement du shard

Le premier lot courant était:

`abercorn, auclair, batiscan, belleterre, brebeuf, chazel, cloridorme, duhamel-ouest, east-broughton, esprit-saint, fortierville, gallichan, grand-saint-esprit, hope, kinnears-mills`.

Les preuves Mistral existantes ont été réutilisées sans repayer les mêmes PDF: plan ou amendement au lieu d'une grille (`abercorn`, `auclair`), faux PDF HTML (`batiscan`), 0 zone (`belleterre`, `duhamel-ouest`, `east-broughton`, `fortierville`), moins de 3 codes (`brebeuf`), overlap/champs nuls (`kinnears-mills`), ou aucune source officielle confirmée pour les petites municipalités restantes.

Un audit Node exact de tous les rapports `normes-mistral-*.md` a couvert 61/77 cibles initiales. Les 16 résiduels ont ensuite été inventoriés localement, passés au crawler 2-hop quand présents dans la registry, puis au crawl direct des pages urbanisme/règlements officielles:

- le crawler ne connaissait que `saint-fortunat`, `saint-julien`, `saint-theophile`; 0 PDF de grille confirmé;
- le crawl direct a trouvé les deux sources officielles traitées ci-dessus;
- aucun PDF de grille/règlement de zonage confirmé pour les autres résiduels, sans inventer d'URL documentaire.

Après le merge, une nouvelle repioche exacte a laissé seulement trois slugs sans mention antérieure: `rapide-danseur`, `saint-andre-de-restigouche`, `saint-ephrem-de-beauce`. Le crawler ne connaissait que Saint-Éphrem et a trouvé 0 PDF; le crawl direct officiel 2-niveaux a trouvé 0 PDF de zonage/grille pour les trois (le seul PDF remonté à Saint-André était un guide de bac, rejeté comme hors sujet).

Le shard courant de 76 slugs est donc couvert par un dépôt ou une preuve d'échec/découverte infructueuse. Coût Mistral propre à cette passe: environ 0,141 USD, maximum 0,113 USD pour une ville.
