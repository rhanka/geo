# NORMES Mistral — shard 1/4 — 2026-07-11T064320Z

## Périmètre et méthode

- Shard appliqué sur la liste complète des 1 106 slugs triés : `index % 4 == 1`.
- Résiduel initial : 84 municipalités avec `zones.status=done` et `normes.status!=done`.
- Moteurs utilisés exclusivement : Mistral OCR 4.0 et Mistral `document_annotation` (`mistral-schema`). Aucun GPT/Codex d'extraction.
- Dépôts parquet uniquement; réconciliation par `zonage-norms-manifest-merge.ts --apply`.
- Gates appliqués : au moins 3 codes réels, overlap SIG non nul, `publishedFieldPct` non nul, valeurs verbatim ou null.
- Coût Mistral observé pour cette passe : environ 0,718 USD au total, toujours inférieur à 1 USD par ville.

## Dépôts nets

| Slug | Source officielle | Méthode | Résultat gates | Aval |
|---|---|---|---|---|
| `saint-david-de-falardeau` | Cahier des spécifications Wix officiel, SHA/source vérifiés | `mistral-schema`, pages 8..25, 0,054 USD (+ OCR 0,004) | 144 codes, overlap 21/61, champs 61,1 % | manifeste fusionné; jointure 1 786 lots, normes 26,65 %; lots enrichis déposés |
| `saint-malachie` | Règlement de zonage 616-25, CDN GestionWeblex officiel | `mistral-schema`, pages 129..200, 0,216 USD (+ OCR 0,005) | 72 codes, overlap 72/72, champs 47,4 % | manifeste fusionné; jointure 1 759 lots, normes 100 %; lots enrichis déposés |
| `saint-vallier` | Règlement de zonage 164-2013, CDN GestionWeblex officiel | OCR Mistral, 0,071 USD | 180 codes, overlap 38/43, champs 7,6 % | manifeste fusionné; jointure 1 122 lots, normes 99,38 %; lots enrichis déposés |

Clés parquet :

- `registry/qc-zonage-norms/qc-zonage-norms-saint-david-de-falardeau.parquet`
- `registry/qc-zonage-norms/qc-zonage-norms-saint-malachie.parquet`
- `registry/qc-zonage-norms/qc-zonage-norms-saint-vallier.parquet`

## Échecs de gate nouvellement prouvés

| Slug | Preuve Mistral | Décision |
|---|---|---|
| `saint-elzear-de-temiscouata` | OCR 80 pages : 0 zone; schéma 57..58 : 0 code | rejet `<3` |
| `saint-joseph-de-coleraine` | schéma 101..106 : 31 codes, champs 36,7 %, overlap 0/103 | rejet overlap |
| `sainte-monique--nicolet-yamaska` | OCR : défaut de rendu `stderr maxBuffer`; schéma 116..122 : 7 codes, champs 0 %, overlap 0/19 | rejet overlap/champs |
| `saint-gedeon-de-beauce` | OCR : 49 codes, overlap 48/55, champs 0 %; schéma 50..53 : 13 codes, champs 0 % | rejet champs |
| `saint-remi-de-tingwick` | grille H/P/C directe; OCR 74 codes overlap 0; schéma 63 codes, champs 26,4 %, overlap 0/26 | rejet overlap (millésime/codification disjoints) |

## Lots parcourus et découverte

- Lot de tête (15) : preuves Mistral antérieures réutilisées sans refacturation. Denholm/Dosquet échouent overlap ou champs; Duhamel-Ouest/Fugèreville extraient zéro zone; crawler historique 0 PDF confirmé pour les autres petites municipalités.
- Lot 2 (15) : crawler `--2hop` sur les 5 slugs présents dans la registry, 0/5 PDF confirmé; 10 slugs absents. Les PDF locaux déjà testés conservent leurs rejets documentés (L'Assomption overlap 0/359, Léry champs 0, Namur overlap 0, etc.).
- Lot 3 : sources locales/rapports existants réutilisés; nouveau dépôt Saint-David-de-Falardeau; Saint-Elzéar rejeté.
- Lot 4 : portail MRC des Appalaches sondé en lot. Nouveau PDF Coleraine confirmé mais rejeté. Les autres sites ne publient pas de grille de base exploitable.
- Lots 5-6 : portails Nicolet-Yamaska, Bellechasse, Montmagny, Beauce-Sartigan et Arthabaska sondés. Trois sources productibles confirmées à Bellechasse/Beauce/Arthabaska, donnant deux dépôts (Saint-Malachie, Saint-Vallier) et deux rejets (Saint-Gédéon, Saint-Rémi).
- Dernier résiduel sans rapport antérieur : `normetal`, `saint-gedeon-de-beauce`, `saint-ignace-de-loyola`, `saint-jacques-le-majeur-de-wolfestown`, `saint-jean-de-lile-dorleans`, `saint-marcellin`, `saint-pie-de-guire`, `saint-remi-de-tingwick`. Crawler : 0/2 parmi les seules entrées registry; fallback sites officiels : sources trouvées et testées pour Saint-Gédéon/Saint-Rémi, trois sites injoignables et aucun PDF de grille confirmé pour les autres.

## Réconciliation et limite finale

- Les fusions de manifeste ont intégré les trois dépôts de ce shard. Des parquets déposés simultanément par d'autres lanes ont aussi été détectés par le merge global; ils ne sont pas revendiqués ici.
- La dernière relance de `loop-supervise.ts` à 06:43Z a été refusée par la limite d'usage/approbation de l'environnement. Aucune tentative de contournement n'a été faite. La supervision précédente affichait 611 normes; les fusions suivantes ont porté le manifeste observé à 614 entrées.
- Le dépôt était massivement sale avant cette passe; `.claude`, `.track`, les modifications de code et les artefacts d'autres lanes n'ont pas été touchés ni inclus dans le périmètre de commit.
