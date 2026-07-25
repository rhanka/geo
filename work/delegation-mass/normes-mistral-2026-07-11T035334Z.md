# Normes Mistral — shard 3/4 — 2026-07-11T035334Z

## Périmètre et règles

- Branche : `feat/cadre-acquisition`.
- Sélection : clés de `coverage-matrix.json` triées, uniquement `index % 4 == 3`, avec `zones.status == done` et `normes.status != done`.
- Cibles au démarrage : 77.
- Moteurs utilisés : Mistral OCR 4.0 et Mistral `document_annotation` (`mistral-schema`) uniquement. Aucun GPT/codex/Claude.
- Dépôts : parquet-only, puis merge explicite du manifeste.
- Anti-invention : aucun dépôt accepté sans au moins 3 codes, overlap SIG non nul et champs publiés non nuls.

## Dépôt net

### saint-damien-de-buckland

- Source officielle confirmée : `https://saint-damien.com/wp-content/uploads/2022/10/NO-09-2022-zonage-lettre.pdf`.
- PDF local : `work/zonage-norms/saint-damien-de-buckland/grille.pdf`, règlement 09-2022.
- Diagnostic à coût nul : bloc continu de grilles pages 151 à 205.
- Extraction : Mistral `document_annotation`, 55 pages, coût 0,165 USD.
- Gates : 55 codes distincts, SIG 75, overlap 55 (73,3 % du SIG), `publishedFieldPct=45,5 %`, aucun code extrait hors SIG.
- Dépôt : `registry/qc-zonage-norms/qc-zonage-norms-saint-damien-de-buckland.parquet`.
- Merge manifeste : 604 → 605 entrées; `saint-damien-de-buckland` ajouté. Une clé parasite `registry` a été ignorée car absente.
- Join lots-zones : 1 638 lots, 99,88 % assignés, 56,97 % avec normes.
- Lots enrichis : 1 638 lignes déposées, 56,9 % avec normes, surface 100 %, code postal 100 %, adresse 89,68 %.

## Échecs de gate de ce passage

- `alma` : OCR simple 0 zone; route schéma interrompue après 6 minutes, aucun dépôt.
- `saint-lin-laurentides` : OCR 0 zone; schéma pages 186–210, 0 code.
- `saint-simon-de-rimouski` : schéma 32 codes et 48 % de champs publiés, mais overlap SIG = 0; rejet strict.
- `westbury` : OCR puis schéma pages 45–80, 0 code.
- `new-carlisle` : OCR 4 codes recoupés mais 0 % de champs; schéma 7 libellés non recoupés et 0 % de champs; rejet.
- `moffet` : règlement officiel découvert sur le portail MRC Témiscamingue et confirmé HTTP/PDF; OCR 50 pages, 0 zone. Le catalogue ne publie aucune annexe-grille séparée.
- `sainte-anne-de-sorel` : règlement consolidé officiel 436-2009 confirmé; OCR pages 295–309, 8 faux libellés/nombres et overlap 0. La fiche officielle ne publie aucune annexe-grille séparée; rejet.

Coût Mistral connu de ce passage : 0,885 USD au total. La route schéma Alma interrompue n'a pas livré de métrique de facturation; chaque commande est restée plafonnée à 1 USD par ville.

## Découverte et résidu

- Crawler 2-hop sur un nouveau lot de 15 sans PDF : seul `aston-jonction` est présent dans le registre PV; 0 PDF-grille confirmé. Les 14 petites municipalités absentes du registre confirment la limite structurelle du crawler.
- Portail MRC Témiscamingue : source Moffet retrouvée et traitée, mais sans annexe-grille.
- Portail MRC de La Mitis : aucune grille municipale publiée pour `grand-metis`, `les-hauteurs` ou `la-redemption`; les sites officiels accessibles n'exposent pas de PDF de grille.
- `saint-rene-de-matane` : URL historique officielle déjà prouvée HTTP 404 dans les rapports du dépôt.
- Les 24 PDF locaux du shard ont été rapprochés des preuves antérieures ou diagnostiqués dans ce passage. Les meilleurs résidus sans bloc-grille (`saint-guillaume`, `saint-anaclet-de-lessard`, `dunham`, `entrelacs`, `kinnears-mills`, `notre-dame-du-nord`) ne justifient pas une nouvelle dépense OCR.

## Conclusion

Un dépôt net validé et propagé jusqu'aux lots enrichis : `saint-damien-de-buckland`. Tous les autres essais ont été arrêtés par les gates anti-invention ou par absence vérifiée d'annexe exploitable. Les fichiers partagés déjà modifiés par d'autres agents (`.track`, `.claude`, couverture globale) n'ont pas été ajoutés au commit de ce passage.
