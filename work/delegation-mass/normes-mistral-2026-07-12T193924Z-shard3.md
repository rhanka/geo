# NORMES via MISTRAL — shard 3/4 — 2026-07-12T193924Z

## Périmètre

- Sélection Node/TS stricte: `coverage-matrix.json`, `zones.status=done`, `normes.status!=done`, liste triée, `index % 4 == 3`.
- Séquence: `loop-supervise.ts` au démarrage puis entre les lots; norme lue: `docs/spec/normes-extraction-retenu.md`.
- Moteurs utilisés: Mistral OCR-4.0 et Mistral `document_annotation` (`mistral-schema`). Aucun GPT-5.5/Codex utilisé pour l’extraction.
- Toutes les extractions de cette passe étaient parquet-only, sans écriture de manifeste pendant les appels, et avec `budget-usd 1` par municipalité.
- `.claude`, `.track` et les secrets n’ont pas été touchés.

## Dépôts nets de cette passe

| slug | source | moteur gagnant | codes | overlap SIG | champs publiés | résultat |
|---|---|---|---:|---:|---:|---|
| `grand-metis` | règlement de zonage officiel MRC, HTTP 200/PDF | `mistral-schema` | 24 | 24 | 38% | déposé |
| `saint-dominique-du-rosaire` | règlement de zonage officiel MRC, HTTP 200/PDF | `mistral-schema` | 40 | 29 | 37,5% | déposé |

Grand-Métis: pages 241–247, coût schema 0,021 USD; l’OCR classique a extrait 32 codes mais 0% de champs et a été rejeté. Saint-Dominique: document complet de 179 pages, coût schema 0,537 USD; 40 codes, 29/30 codes SIG recoupés, gate passé.

Parquets déposés:

- `registry/qc-zonage-norms/qc-zonage-norms-grand-metis.parquet`
- `registry/qc-zonage-norms/qc-zonage-norms-saint-dominique-du-rosaire.parquet`

## Réconciliation et aval

`zonage-norms-manifest-merge.ts --apply` a été exécuté après les dépôts:

- manifeste: 665 → 667 entrées;
- ajoutés: `grand-metis`, `saint-dominique-du-rosaire`;
- supprimés: 0;
- la clé parasite `registry` a été signalée absente par le merge, sans perte d’entrée.

`lot-zone-join-run.ts --slugs grand-metis,saint-dominique-du-rosaire`:

- Grand-Métis: 585 lots, 95,9% affectés, match normes 94,47%, parquet/stats vérifiés;
- Saint-Dominique-du-Rosaire: 85 lots, 100% affectés, match normes 100%, parquet/stats vérifiés.

`lots-enriched-run.ts --slugs grand-metis,saint-dominique-du-rosaire`:

- Grand-Métis: 585 lots, zone_code 95,9%, normes 90,6%, surface 100%, dépôt OK;
- Saint-Dominique-du-Rosaire: 85 lots, zone_code 100%, normes 100%, surface 100%, dépôt OK.

## Lots traités et gates négatifs

Lot initial (15): `aston-jonction, beaulac-garthby, belleterre, cascapedia-saint-jules, dunham, fermont, grand-metis, honfleur, irlande, kinnears-mills, la-guadeloupe, la-redemption, lac-megantic, landrienne, launay`.

- Aston-Jonction: règlement 2025 confirmé; OCR 2 codes, overlap 2/19, rejet `<3 zone_codes`.
- Grand-Métis: OCR rejeté `publishedFieldPct=0`, schema déposé comme indiqué ci-dessus.
- Les autres petits sites ont été sondés par crawler 2-hop et pages officielles; aucune grille PDF exploitable supplémentaire n’a été confirmée dans ce lot.

Lot suivant (15): `les-hauteurs, manseau, marieville, moffet, montreal, new-carlisle, notre-dame-de-stanbridge, notre-dame-du-nord, parisville, pierreville, saint-adrien-dirlande, saint-alexandre-de-kamouraska, saint-anaclet-de-lessard, saint-bruno-de-guigues, saint-camille`.

- PDF officiels confirmés/stagés pour `moffet`, `new-carlisle`, `notre-dame-de-stanbridge`, `notre-dame-du-nord`, `pierreville`, `saint-alexandre-de-kamouraska`, `saint-anaclet-de-lessard`, `saint-camille`.
- OCR puis schema: aucun dépôt; motifs vérifiés: 0 zone, overlap nul, ou `publishedFieldPct=0`. Exemple: `new-carlisle` OCR 4 codes avec overlap 4 mais 0% de champs; schema overlap 0.
- Les preuves antérieures conservées dans `work/delegation-mass/normes-mistral-2026-07-12T0752Z-shard3.md` couvrent les autres slugs du lot sans repayer un document identique.

Lot suivant sondé: `saint-celestin--nicolet-yamaska--2, saint-cleophas-de-brandon, saint-dominique-du-rosaire, saint-edmond-les-plaines, saint-elzear--bonaventure, saint-ephrem-de-beauce, saint-felix-de-kingsey, saint-francois-de-la-riviere-du-sud, saint-gabriel, saint-honore, saint-jean-de-dieu, saint-juste-du-lac, saint-leonard-daston, saint-lin-laurentides, saint-louis-de-gonzague--les-etchemins`.

- Saint-Dominique a produit le second dépôt net.
- Saint-Lin: OCR 0 zone sur 121–141; schema 8 codes, overlap 0/115, rejet.
- Saint-Félix: OCR/schema sans grille exploitable sur la page candidate, rejet par zone-count/overlap.
- Les pages et rapports existants couvrent les autres sites sans source PDF de grille confirmée; aucun code ou champ n’a été inventé.

Pour le reliquat du shard, les rapports Mistral existants de la même sélection documentent les mêmes gates pour Saint-Simon-de-Rimouski, Westbury, Sainte-Anne-de-Sorel, Saint-Théophile, Trois-Pistoles, Val-Saint-Gilles et les autres petits sites sans PDF. Aucun nouveau document officiel distinct n’a été trouvé lors du repiochage; les échecs restent des preuves, pas des dépôts.

## Supervision finale

Le dernier `loop-supervise.ts` observé après les dépôts indiquait `normes=668/1106`, `zones=821/1106`. La sélection shard locale restait à 60 candidats parce que `coverage-matrix.json` et `normes-provenance.json` ne sont pas réécrits par le dépôt S3; les deux slugs déposés ont été exclus manuellement des lots suivants et le manifeste distant a été réconcilié.

## Git

Commit limité au présent rapport; aucun `git add .`. Les PDF et manifestes de travail restent des artefacts non suivis/concurrents et ne sont pas inclus dans ce commit.
