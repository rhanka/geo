# NORMES Mistral — shard 0/4

Date d’exécution : 2026-07-12T02:44Z  
Branche : `feat/cadre-acquisition`  
Règle de sélection : matrice triée par slug, `zones.status == done`, `normes.status != done`, puis `index % 4 == 0`.

## Provenance et méthode

- `npx tsx acquisition/src/loop-supervise.ts` exécuté au démarrage et entre les lots.
- `docs/spec/normes-extraction-retenu.md` lu avant traitement.
- Découverte priorisée sur les règlements de zonage et annexes officiels; crawler registry puis pages municipales officielles et validation HTTP 200/PDF.
- Extraction uniquement Mistral : `mistral-ocr-4-0` et `mistral-schema` (`document_annotation`). Aucun GPT/codex.
- Toutes les commandes d’extraction ont utilisé `--no-manifest` / dépôt Parquet-only; le manifeste a été fusionné seulement après le dépôt validé.
- 68/68 slugs du shard courant ont été soit sourcés/testés, soit couverts par une preuve de découverte sans PDF confirmé. Aucun slug hors shard n’a été traité.
- Dépense OCR/schema observée dans les sorties : environ `$0.879`, jamais plus de `$1` par slug.

## Dépôt validé

### `schefferville`

- Source officielle confirmée : `https://schefferville.ca/wp-content/uploads/2025/07/2013-120-Reglement-remplacant-le-reglement-93-02-10-et-le-plan-de-zonage.pdf`
- Route validée : `mistral-schema`, pages 62–79, 18 pages, `$0.054`.
- Gates : `distinctZones=21`, `publishedFieldPct=34.5`, `overlap=16/53`, `gatesOk=true`.
- Parquet : `registry/qc-zonage-norms/qc-zonage-norms-schefferville.parquet`.
- Fusion : manifeste `641 → 642`, `schefferville` ajouté; l’entrée historique `registry` a échoué sur clé absente et n’a pas été modifiée.
- Jointure : 482 lots, 100 % assignés, match normes 60.58 %, vérification Parquet OK.
- Enrichissement : 482 lots, dépôt OK, 60.58 % avec normes publiées.

## Preuves de refus / absence de dépôt

- `auclair`, `brebeuf`, `fermont`, `ivry-sur-le-lac`, `mont-carmel`, `saint-didace`, `saint-celestin--nicolet-yamaska`, `sainte-anne-des-plaines` : extraction Mistral à zéro code; gates bloqués à `< 3 unique zone_code`.
- `lassomption` : 63 zones, `publishedFieldPct=47.6`, mais `overlap=0`; refus anti-invention.
- `normandin` : 367 zones, `publishedFieldPct=17.8`, `overlap=0`; refus anti-invention.
- `saint-pierre-de-broughton` : 19 zones, champs publiés 0 %, `overlap=0`; refus.
- `ripon` : OCR a retourné 1003 codes mais `publishedFieldPct=0`; schema a retourné 0 zone; refus.
- `schefferville` route OCR initiale : 322 codes, `overlap=0`; la route schema ciblée 62–79 a ensuite passé les gates et seule cette sortie a été déposée.
- `senneterre--la-vallee-de-lor` : OCR simple `fetch failed`; schema pages 504–506, 0 code; refus.
- `notre-dame-des-prairies` : URL officielle relevée sur la page municipale mais HTTP 404 au téléchargement; aucun appel Mistral.
- Les autres slugs des lots ont été soumis au crawler/aux pages officielles disponibles; aucune URL PDF de grille/règlement confirmée n’a été trouvée dans le temps imparti. Les manifestes de découverte et seeds conservent les preuves reproductibles.

## Fichiers de provenance

- Seeds : `work/zonage-norms/seed-shard-0-mistral-20260711-lot1.json`, `...lot2.json`, `...lot3.json`, `...lot4.json`, `...schefferville.json`.
- Manifestes de découverte : `work/zonage-norms/discovered-shard-0-mistral-20260711-lot1.json`, `...lot1-seed.json`, `...brebeuf-chap7.json`, `...lot2.json`, `...lot3.json`, `...lot4.json`, `...schefferville.json`, `...reliquat.json`.

## État final

Un seul dépôt net et validé sur le shard courant : `schefferville`. Aucun Parquet refusé n’a été publié; les gates ont été conservés comme garde-fou anti-invention.
