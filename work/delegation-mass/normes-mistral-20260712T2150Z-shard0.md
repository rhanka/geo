# Normes Mistral — shard 0/4 — 2026-07-12

## Périmètre et méthode

- Source de cibles: `work/coverage/coverage-matrix.json`, slugs triés, garde `index % 4 == 0`.
- Sélection observée: 58 cibles productibles (`zones.status=done`, `normes.status!=done`) au dernier recalcul; aucune cible des shards 1–3 traitée.
- Spécification lue: `docs/spec/normes-extraction-retenu.md`.
- Supervision: `npx tsx acquisition/src/loop-supervise.ts` au début et entre les lots; la première exécution sandboxée a échoué avant acquisition (pipe IPC), puis l’exécution autorisée a réussi.
- Extraction: routes Mistral OCR Document-AI et Mistral `document_annotation` (`mistral-schema`) uniquement; budget CLI `--budget-usd 1` par muni; dépôts parquet-only (`--no-manifest`).
- Garde appliquée: au moins 3 codes, overlap SIG non nul lorsque la grille SIG existe, champ publié non nul, valeurs verbatim ou null.

## Dépôts nets

| slug | moteur/fenêtre | codes | overlap | champs publiés | résultat |
|---|---|---:|---:|---:|---|
| `gatineau` | Mistral schema, PDF local, 2 pages | 6 | 1 | 75,0 % | parquet `registry/qc-zonage-norms/qc-zonage-norms-gatineau.parquet` |
| `forestville` | Mistral schema, PDF officiel confirmé, pages 1–10 | 112 | 16 | 22,4 % | parquet `registry/qc-zonage-norms/qc-zonage-norms-forestville.parquet` |

La jointure post-dépôt a été exécutée pour les deux munis:

- `gatineau`: 39 666 lots, 99,99 % assignés, 0,12 % avec normes; avertissement attendu car un seul code SIG recoupé.
- `forestville`: 1 989 lots, 98,89 % assignés, 53,28 % de match zone-normes; enrichissement 52,69 % avec normes.

`zonage-norms-manifest-merge.ts --apply` a ajouté Forestville. Le merge signale encore `registry: The specified key does not exist` pour une entrée concurrente; le manifeste a néanmoins été écrit (`manifestAfter=694`). Gatineau était déjà visible dans le manifeste au second passage.

## Preuves de gates négatifs

Les tentatives Mistral ont été arrêtées sans dépôt dès qu’un gate échouait. Cas représentatifs:

- `clermont--abitibi-ouest`: 97 codes schema, 38,9 % de champs, mais overlap 0/29 → rejet.
- `grosse-ile`: 2 codes, overlap 0/39 → rejet.
- `les-iles-de-la-madeleine`: 2 codes, overlap 0/167 → rejet.
- `notre-dame-des-pins`: 18 codes, `publishedFieldPct=0` → rejet.
- `notre-dame-du-bon-conseil--drummond--2`: 11 codes, 60,2 % de champs, overlap 0/11 → rejet.
- `sainte-lucie-de-beauregard`: 10 codes OCR mal routés, overlap 0/40 → rejet.
- `forestville` OCR initial: 7 codes, `publishedFieldPct=0`; la voie schema a ensuite produit le dépôt valide.
- `saint-joseph-de-sorel`: OCR 0 code; schema sur pages 90–170: 0 code, 0 % → aucun dépôt.
- `albanel`, `auclair`, `east-broughton`, `ivry-sur-le-lac`, `la-pocatiere`, `la-visitation-de-lile-dupas`, `lac-des-plages`, `lepiphanie`, `new-richmond`, `normandin`, `port-daniel-gascons`, `ragueneau`, `riviere-bleue`, `saint-camille-de-lellis`, `saint-cyprien-de-napierville`, `saint-damase--les-maskoutains`, `saint-hilaire-de-dorset`, `saint-jacques-de-leeds`, `saint-jean-de-la-lande`, `saint-jules`, `saint-marcel-de-richelieu`, `saint-pie`, `saint-pierre-de-broughton`, `saint-prosper`, `abercorn`, `frontenac`, `saint-epiphane`, `sainte-rose-de-watford`: 0 code ou gate négatif; aucun parquet publié.

## Découverte et limites

- PDF locaux réutilisés en priorité dans `work/zonage-norms`, `work/zonage-plans` et `work/pdf-cache`.
- Le crawler résiduel n’a trouvé aucun PDF confirmé pour `warden`, `saint-patrice-de-beaurivage` et `baie-des-sables`; les autres slugs absents de sa registry ont été vérifiés par les domaines municipaux disponibles, sans URL PDF de grille confirmée.
- La découverte curée a confirmé HTTP 200/PDF pour Forestville et Saint-Joseph-de-Sorel. Les grilles de Forestville ont ensuite passé la voie schema; Saint-Joseph a échoué les gates.
- Les fichiers de plan/carte seuls (`sainte-justine`, carte Forestville initiale) n’ont pas été traités comme grille réglementaire.
- Aucun fichier `.claude` ou `.track` n’a été modifié par cette session; leurs modifications initiales concurrentes sont conservées.
