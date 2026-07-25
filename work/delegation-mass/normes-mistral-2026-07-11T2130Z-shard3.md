# NORMES via Mistral — shard 3/4 — 2026-07-11T21:30Z

## Portée et sélection

- Branche: `feat/cadre-acquisition`.
- Shard strict: liste complète des 1106 slugs de `coverage-matrix.json` triée, puis `index % 4 == 3`; filtre productible `zones.status == done && normes.status != done`.
- Résidu initial: 66 municipalités. Après dépôt et rafraîchissement: 65; `saint-janvier-de-joly` est passé à `normes.status == done`.
- Extraction exclusivement Mistral OCR 4.0, dépôt Parquet-only (`--no-manifest`), budget maximal 1 USD par ville. Aucun GPT, Codex ou Claude n'a servi de moteur d'extraction.
- Gates inchangés: au moins 3 codes réels verbatim, overlap SIG non nul lorsque des codes SIG existent, `publishedFieldPct != 0`, valeurs verbatim-or-null.

## Réutilisation et boucle

- `loop-supervise.ts` exécuté au début et après les dépôts. Score normes observé: 630 au départ, 638 à la fin, dont `+1` au dernier rafraîchissement.
- Les rapports `normes-mistral-*.md` existants contenaient déjà une trace pour 61 des 66 cibles initiales; ces preuves ont été réutilisées pour ne pas refacturer des PDF déjà rejetés.
- Le crawler 2-hop isolé sur les cinq slugs sans trace ne connaissait que `saint-leonard-daston` et n'a confirmé aucun PDF. Manifest de preuve: `work/zonage-norms/discovered-shard-3-revalidation-20260711.json`.
- Le fallback portail MRC/VPlus/Wix a ensuite découvert quatre règlements ou grilles officiels et confirmé HTTP 200 + PDF avant extraction.

## Dépôt net

### Saint-Janvier-de-Joly

- Source officielle dédiée: `https://vplus-documents.s3.ca-central-1.amazonaws.com/saint-janvier-de-joly/_publication/fichiers/JOLY_Grille%20spcification%20complte%202026-04-14(1).pdf`.
- Mistral OCR 4.0 + texte natif, 4 pages, coût déclaré 0,002 USD.
- Gates: 37 codes uniques verbatim; SIG 43; overlap 37; recoup extrait 100 %; recoup SIG 86,05 %; `publishedFieldPct=49`.
- Dépôt: `registry/qc-zonage-norms/qc-zonage-norms-saint-janvier-de-joly.parquet`.
- Aval: join lots-zones OK, 962 lots, 99,9 % assignés, 85,22 % de correspondance normes; lots enrichis OK, 962 lots, 85,14 % avec normes, dépôt vérifié.

## Rejets et preuves fraîches

| slug | source officielle | résultat Mistral / preuve | décision |
|---|---|---|---|
| `saint-bruno-de-guigues` | portail urbanisme MRC Témiscamingue, règlement de zonage, 59 pages | OCR 59 pages, 0 zone, 0,059 USD | rejet `<3 codes` |
| `trecesson` | site municipal Wix, règlement de zonage 2015-224, 229 pages | OCR 80 pages, 3 faux codes (`9.13`, `QUAI`, `80`), overlap 0/62, 0,080 USD | rejet anti-invention overlap 0 |
| `saint-juste-du-lac` | portail VPlus, règlement de zonage 2014-259, version administrative février 2026, 159 pages | la table des matières et le texte renvoient aux « grilles de spécifications » mais aucune annexe-grille n'est incorporée; OCR global a échoué sur la taille de sortie et n'a produit aucune zone | aucun dépôt; annexe séparée requise |
| `saint-leonard-daston` | site municipal et inventaire WordPress public | crawler 2-hop: 0 PDF; inventaire exhaustif des 285 médias PDF: aucun zonage, grille ou urbanisme publié | aucun document productible trouvé |

Coût Mistral déclaré de cette passe: 0,141 USD. Toutes les villes restent sous 1 USD et sous six minutes de traitement.

## Fusion et concurrence

- `zonage-norms-manifest-merge.ts --apply`: manifeste 632 → 634. La fusion a reconstruit deux dépôts concurrents (`papineauville`, `saint-andre-de-kamouraska`) et a de nouveau rejeté la pseudo-clé parasite `registry`; ces deux ajouts ne sont pas revendiqués par ce shard.
- Le rafraîchissement suivant a confirmé `saint-janvier-de-joly` à `normes=done` dans la matrice.
- Aucun secret, fichier `.claude/*` ou `.track/*` n'a été touché; aucun `git add .`.

## Résidu

Le shard courant contient 65 slugs. Les 61 cibles déjà documentées conservent leurs preuves antérieures; les quatre résidus fraîchement examinés ci-dessus ont maintenant une preuve d'échec explicite. La prochaine progression nécessite une nouvelle annexe-grille officielle, pas une répétition du même OCR.
