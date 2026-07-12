# NORMES via Mistral — shard 0/4 — 2026-07-12

## Périmètre

- Sélecteur: liste globale triée, `index % 4 == 0`.
- 57 cibles productibles (`zones=done`, `normes!=done`), traitées en lots `15 + 15 + 15 + 16`.
- Extraction: Mistral OCR-4 (`OCR_MODEL=mistral-ocr-4-0`) et, pour la grille image/transposée, Mistral `document_annotation` (`mistral-schema`).
- Tous les dépôts d’extraction ont utilisé `--no-manifest`/parquet-only; aucun appel GPT/codex.
- Coût Mistral observé, estimé par page: environ `$1.27` au total; jamais plus de `$1` pour une ville.

## Dépôt validé

### saint-joseph-de-sorel

- PDF: `work/zonage-norms/saint-joseph-de-sorel/grille.pdf`.
- Source officielle: `https://www.vsjs.ca/file-16712`.
- Route finale: `ocr/mistral-schema`, fenêtre grille pages 180–278.
- Gate: 50 codes réels, 50 lignes, `publishedFieldPct=39.5`, SIG `53` codes, overlap `47`, recoupement extrait `94%`.
- `zonage-norms-manifest-merge.ts --apply`: manifeste `705 → 706`, aucune entrée existante perdue.
- `lot-zone-join-run`: 678/678 lots assignés (100%), match zone `93.95%`, avertissement attendu `<95%`.
- `lots-enriched-run`: dépôt confirmé, 678 lignes, zone_code `100%`, normes `93.95%`, surface `100%`, code postal `100%`.

## Gates / preuves négatives

- `notre-dame-des-pins`: 18 codes, overlap 2, `publishedFieldPct=0` → rejet strict.
- `riviere-bleue`: 26 codes, overlap 2, `publishedFieldPct=0` → rejet strict.
- `sainte-lucie-de-beauregard`: 10 codes, overlap 0 avec grille SIG → rejet strict.
- `normandin`, `clermont--abitibi-ouest` et autres essais schema: faux code de titre ou 0 zone/champ → aucun dépôt.
- Plusieurs règlements locaux étaient sans annexe/grille exploitable; le crawler a confirmé 0 PDF pour les pages accessibles d’Abercorn, East Broughton, Frontenac et Baie-des-Sables. Les villes sans URL officielle confirmée ont conservé `non-disponible` ou n’ont pas été inventées.
- Erreur non-ville de la fusion: objet S3 `registry` absent; 1 échec de lecture, sans perte d’entrée et sans effet sur le dépôt validé.

## Contrôles finaux

- Manifeste relu avec crossval live: `saint-joseph-de-sorel`, 50 codes, overlap 47, `recoupSig=0.887`.
- Supervision de boucle relancée entre les lots; shard 0/4 épuisé.
