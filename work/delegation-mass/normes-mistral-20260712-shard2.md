# NORMES Mistral — shard 2/4 — 2026-07-12

## Périmètre

- Branche : `feat/cadre-acquisition`
- Sélection déterministe : `Object.keys(coverage-matrix.cities).sort()`, slug si `index % 4 == 2`.
- Productible : `zones.status == done` et `normes.status != done`.
- Moteur : Mistral OCR-4.0 (`route ocr`) et Mistral `document_annotation` (`mistral-schema`) uniquement.
- Dépôts : parquet-only (`--no-manifest`/défaut schema), puis `zonage-norms-manifest-merge.ts --apply`.
- Provenance initiale : `npx tsx acquisition/src/loop-supervise.ts` exécuté; provenance globale observée `323 villes`, `43 déposés` avant cette passe.
- Aucun appel GPT-5.5/Codex d’extraction.

## Dépôts acceptés

| slug | voie | zones | champs publiés | SIG / overlap | coût Mistral observé |
|---|---|---:|---:|---:|---:|
| elgin | OCR + auto-grid pages 94–98 | 4 | 46,9% | 26 / 4 (100% extrait) | $0,004 |
| howick | OCR pages 138–160 | 39 | 34,9% | 42 / 38 (97,4% extrait) | $0,019 |
| la-trinite-des-monts | `mistral-schema` pages 1–45 | 45 | 18,9% | 42 / 39 (92,9% SIG) | $0,135 |
| saint-damien | `mistral-schema` pages 1–10 | 10 | 75,0% | 61 / 2 | $0,030 |
| saint-edouard-de-lotbiniere | `mistral-schema` pages 29–69 | 41 | 61,0% | 34 / 16 | $0,123 |
| saint-francois-dassise | `mistral-schema` pages 165–182 | 45 | 62,5% | 45 / 45 (100%) | $0,054 |
| saint-just-de-bretenieres | `mistral-schema` pages 1–12 | 12 | 62,5% | 39 / 6 | $0,036 |
| sainte-famille-de-lile-dorleans | `mistral-schema` pages 1–16 | 64 | 50,0% | 67 / 64 (95,5% SIG) | $0,048 |
| nantes | OCR + auto-grid pages 1–9 | 59 | 10,6% | 82 / 57 (96,6% extrait) | $0,001 |
| saint-ignace-de-stanbridge | OCR + auto-grid pages 11–15 | 17 | 14,0% | 20 / 5 | $0,003 |

Total publié : 336 codes de zone; coût des dix dépôts acceptés : environ **$0,453**.

Les dix slugs ont ensuite reçu `lot-zone-join-run.ts` et `lots-enriched-run.ts`. Résultats notables : Sainte-Famille 95,18% de lots normés, Saint-François-d’Assise 100%, Howick 92,64%, La Trinité-des-Monts 99,44%, Nantes 73,29%, Saint-Ignace 23,84%. Saint-Damien est volontairement limité aux dix pages traitées (2,6% de lots normés); Saint-Just est limité aux douze pages traitées (7,53%).

## Gates / preuves d’échec

- `batiscan` : `grille.pdf` local = HTML (2 630 octets), `pdftotext` impossible; aucun appel Mistral.
- `brebeuf`, `clerval`, `dundee`, `esterel`, `guerin`, `lac-frontiere`, `latulipe-et-gaboury`, `saint-pamphile`, `saint-simon` : appels Mistral sans au moins trois zones exploitables (`0 zones extracted`).
- `lac-saint-joseph` : `mistral-schema` a extrait 15 zones et 60,8% de champs, mais `overlap=0` avec les codes SIG réels (`H-*`, `CN-*`, `F-*`, `P-*`); dépôt refusé.
- `martinville` : schema à 0 zone; tentative vision Mistral bornée page 194, passes divergentes sans `zone_code`; dépôt refusé.
- `saint-celestin--nicolet-yamaska` : schema image 4 pages, 0 zone.
- `saint-venant-de-paquette` : schema 12 zones et 57,3% de champs, mais codes génériques `COM-*`/`RES-*` sans overlap SIG; dépôt refusé.
- `sainte-brigitte-des-saults` : schema annexe page 196, 0 zone.
- `sainte-helene-de-bagot` : 3 zones, overlap 3, mais `publishedFieldPct=0`; dépôt refusé.
- `saint-pierre` : règlement officiel confirmé, mais la fenêtre auto-grid a ciblé le corps du règlement; OCR Mistral borné pages 60–64 = 0 zone, dépôt refusé.
- `godbout` : règlement officiel confirmé HTTP 200/PDF, mais projet de règlement sans annexe grille exploitable.
- `gallichan`, `laval`, `lile-du-grand-calumet`, `nantes` et plusieurs candidats suivants : aucun PDF local confirmé; crawler registry/2-hop n’a pas fourni de grille pour les slugs hors registre. Aucun dépôt inventé.

Les rejets restent parquet-free et ne modifient pas le manifeste partagé. Les manifestes ont été réconciliés après chaque groupe accepté; la commande de merge a signalé `registry: The specified key does not exist` pour une entrée concurrente, sans empêcher les ajouts de ce shard.

## État final

Après la dernière supervision et le merge, le sélecteur shard 2/4 a listé 46 slugs encore `zones=done & normes!=done`; ils restent à reprendre par une prochaine passe avec nouvelles sources officielles/MRC. Les dépôts de cette passe sont les dix lignes ci-dessus. Les modifications préexistantes et concurrentes dans `.claude`, `.track`, `acquisition/src`, `packages` et `work/` ont été laissées intactes.

## Addendum — passe Mistral du 2026-07-12

- Le recalcul courant a observé 40 candidats au départ, puis 39 et 38 après changements concurrents. La garde est restée `index % 4 == 2`; aucun slug hors shard n’a été déposé.
- Extraction additionnelle : Mistral `document_annotation` sur l’annexe « Grilles des spécifications par zones » de Saint-Ferdinand, pages 310–425, 116 pages / 15 chunks / `$0,348`.
- Saint-Ferdinand passe les gates : 103 codes, `overlap=42`, `publishedFieldPct=42,5 %`. Parquet : `registry/qc-zonage-norms/qc-zonage-norms-saint-ferdinand.parquet`.
- Manifest fusionné avec `zonage-norms-manifest-merge.ts --apply`. `lot-zone-join-run.ts` : 2 078 lots, 100 % assignés, 15,26 % match normes. `lots-enriched-run.ts` : dépôt réussi, `zone_code=100 %`, `norms=15,26 %`.
- Preuves supplémentaires : Saint-Augustin (56 codes, overlap 0), Saint-Pamphile (8 codes, 62,5 % champs, overlap 0), Saint-Paul-de-Montminy (3 codes, overlap 0), Saint-Venant (10 codes, 60 % champs, overlap 0), Saint-Antonin (2 codes, overlap 0) ; tous rejetés par les gates stricts. Saint-Célestin, Saint-René, Sainte-Brigitte, Saint-Émile, Sainte-Anne, Saint-Pierre et Sainte-Hélène n’ont produit aucun produit publiable.
- Les sources officielles supplémentaires confirmées mais non déposées étaient des plans, amendements ou règlements sans feuillet grille exploitable. Aucun GPT-5.5/codex n’a été utilisé.
