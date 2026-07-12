# NORMES via MISTRAL — shard 3/4 — 2026-07-12T224744Z

## Périmètre

- Branche : `feat/cadre-acquisition`.
- Sélection déterministe : `coverage-matrix.json`, villes triées, `zones.status == done`, `normes.status != done`, puis `index % 4 == 3`.
- Sélection initiale : 54 cibles; lot 1 traité : `aston-jonction, beaulac-garthby, belleterre, cascapedia-saint-jules, dunham, fermont, honfleur, irlande, kinnears-mills, la-guadeloupe, la-redemption, lac-megantic, launay, les-hauteurs, marieville`.
- Après le dépôt de Belleterre, re-sélection Node/TS : 53 cibles restantes dans le shard. Les rapports shard 3 antérieurs couvrent les preuves de découverte/gate des 52 restantes; aucune nouvelle source officielle distincte n’a été trouvée pendant la repioche.
- `loop-supervise.ts` exécuté au démarrage, avant la repioche et au contrôle final. Scoreboard après dépôt : `normes=705`, soit `+1` dans cette passe.
- `docs/spec/normes-extraction-retenu.md` relu. Extraction payante exclusivement Mistral OCR-4.0 et Mistral `document_annotation`; aucun GPT-5.5/Codex utilisé.
- Toutes les extractions étaient Parquet-only et plafonnées à `--budget-usd 1` par ville. `.claude`, `.track` et les secrets n’ont pas été touchés.

## Découverte

- Inventaire local du lot 1 : PDF pour 8/15 slugs. Les documents manifestement hors cible ont été écartés sans coût : Aston-Jonction (`grille.pdf` = amendement; `grille-base.pdf` scanné sans fenêtre textuelle), Fermont (brochure), La Guadeloupe (annexe agricole H), Lac-Mégantic (fichier HTML de 4 KiB).
- Crawler TS borné pour les 7 absentes (`cascapedia-saint-jules, honfleur, irlande, la-redemption, launay, les-hauteurs, marieville`) : `0 muni` dans la registry PV, donc aucun PDF téléchargé. Preuve conservée dans `work/zonage-norms/discovered-shard-3-lot01.json`.
- Les sources officielles déjà connues ont été réutilisées pour Beaulac-Garthby, Belleterre et Kinnear’s Mills. Dunham possède un PDF local de règlement mais aucune URL PDF officielle directement confirmable; aucun appel payant supplémentaire n’a été fait sur cette source non confirmée.

## Extractions Mistral et gates

| slug | voie | preuve | décision |
|---|---|---|---|
| `beaulac-garthby` | OCR-4.0, 210 pages, `$0.080` | 0 zone | rejet zone-count |
| `beaulac-garthby` | `document_annotation`, 210 pages, `$0.630` | 23 codes, `publishedFieldPct=13,6%`, overlap `0/91`; codes génériques (`RA`, `RM`, `RC`, …) | rejet anti-invention |
| `belleterre` | OCR-4.0, 58 pages, `$0.058` | 0 zone | rejet zone-count |
| `belleterre` | `document_annotation`, 58 pages, `$0.174` | 14 codes, `publishedFieldPct=62,5%`, overlap `1/29` | **dépôt accepté** |
| `kinnears-mills` | OCR-4.0, 80 pages, `$0.080` | 4 codes numériques, overlap `0/67` | rejet anti-invention |
| `kinnears-mills` | `document_annotation`, p.129–131, `$0.009` | 12 codes de catégories, `publishedFieldPct=0%`, overlap `0/67` | rejet anti-invention |

Aucune valeur non verbatim n’a été publiée. Les rejets conservent leurs preuves de gate : codes insuffisants, overlap nul ou champs publiés nuls.

## Dépôt et aval

- Parquet accepté : `registry/qc-zonage-norms/qc-zonage-norms-belleterre.parquet`.
- `zonage-norms-manifest-merge.ts --apply` exécuté : manifeste 704 → 704; le parquet municipal était déjà présent dans la vue distante; l’entrée globale `registry` reste une clé S3 absente et a été signalée sans bloquer le dépôt.
- `lot-zone-join-run.ts --slugs belleterre` : 295 lots, affectation 100%, parquet/stats vérifiés; correspondance zone/normes 1,36% (avertissement de qualité, pas un échec technique).
- `lots-enriched-run.ts --slugs belleterre` : 295 lots, zone_code 100%, normes 1,36%, surface 100%, dépôt vérifié.

## Commit ciblé

Le dépôt net justifie un commit limité au rapport et à la preuve de découverte de ce lot. Aucun `git add .` et aucun fichier concurrent n’est inclus.
