# Normes Mistral - shard 2/4 - 2026-07-10T17:01:22Z

Mission: traiter uniquement les slugs productibles du shard courant `index trie % 4 == 2`.
Moteur utilise: Mistral uniquement (`mistral-ocr-4-0`, `mistral-schema`, `multizone` Mistral). Aucun GPT/codex utilise pour l'extraction.
Mode depot: parquet-only (`--no-manifest` ou runner schema sans `--manifest`), puis merge manifest.

## Demarrage

- `git status --short` execute en premier: worktree deja tres sale, incluant `.claude/*` et `.track/*`. Ces chemins n'ont pas ete modifies.
- `loop-supervise.ts` execute apres approbation hors sandbox pour tsx.
- Spec lue: `docs/spec/normes-extraction-retenu.md`.
- Shard initial observe: 79 slugs. La matrice a evolue pendant la session; apres plusieurs depots concurrents, le shard courant contenait notamment `honfleur`, `ivry-sur-le-lac`, `saint-gabriel-lalemant`, `saint-simon-de-rimouski`, etc.

## Depot net

### saint-gabriel-lalemant

- Source officielle: `https://www.saintgabriellalemant.qc.ca/fichiersUpload/fichiers/20260625134258-55-26-reglement-final-zonage-signe-2de2.pdf`
- PDF local preexistant: `work/zonage-norms/saint-gabriel-lalemant/20260625134258-55-26-reglement-final-zonage-signe-2de2.pdf`
- Route: `zonage-norms-schema-ingest.ts --engine mistral-schema --deposit`
- Cout Mistral estime: USD 0.228
- Resultat:
  - depose: oui
  - key: `registry/qc-zonage-norms/qc-zonage-norms-saint-gabriel-lalemant.parquet`
  - zones distinctes: 30
  - SIG codes: 37
  - overlap: 23
  - publishedFieldPct: 65
  - gates: OK (`>=3` codes, overlap non nul, champs publies non nuls, valeurs Mistral verbatim/null)

## Pipeline aval

- `zonage-norms-manifest-merge.ts --apply`: manifest 589 -> 592, `saint-gabriel-lalemant` ajoute. Le merge a aussi integre deux parquets d'autres lanes (`saint-bruno-de-kamouraska`, `saint-frederic`) et a signale une cle parasite `registry` absente, sans bloquer l'ecriture.
- `lot-zone-join-run.ts --slugs saint-gabriel-lalemant`: 922 lots, assignes 99.78 %, match normes 67.83 %, parquet/statistiques OK.
- `lots-enriched-run.ts --slugs saint-gabriel-lalemant`: depot OK, surface 100 %, code postal 100 % RTA, adresse 93.49 %, normes 67.68 %.
- Supervision finale: scoreboard `normes=594 (+1)`.

## Rejets gate / echecs utiles

- `albanel`: PDF officiel local, OCR Mistral 4 pages, 0 zone.
- `fugereville`: MRC Temiscamingue, OCR Mistral 55 pages, 0 zone.
- `la-pocatiere`: fichiers locaux et URL `gstDocument` = HTML, pas PDF.
- Crawler registry sur lot initial: seulement 3 slugs pris par la registry PV, 0 PDF confirme.
- `notre-dame-du-nord`: 3 codes extraits, SIG=107, overlap=0 -> rejet anti-invention.
- `lorrainville`: OCR Mistral 57 pages, 0 zone.
- `saint-anaclet-de-lessard`: OCR Mistral 80 pages, 0 zone.
- `guerin`: PDF officiel MRC confirme, OCR Mistral 55 pages, 0 zone.
- `lile-danticosti`: PDF officiel telecharge, 13 codes, overlap=1, `publishedFieldPct=0` -> rejet.
- `saint-damien-de-buckland`: PDF officiel telecharge, 4 codes, overlap=3, `publishedFieldPct=0` -> rejet.
- `sainte-perpetue--nicolet-yamaska`: auto-grid pages 123..130; OCR/schema echouent `stderr maxBuffer`; route multizone lit 22 codes avec overlap=22 mais `publishedFieldPct=0` -> rejet.
- `saint-nazaire-de-dorchester`: PDF officiel telecharge, 10 codes, overlap=2, `publishedFieldPct=0` -> rejet.
- `saint-simon-de-rimouski`: annexe B officielle; OCR 0 zone, schema lit 32 zones et 46.1 % de champs, mais overlap SIG=0 -> rejet.
- `mont-carmel`, `saint-andre-de-kamouraska`, `westbury`, `saint-lin-laurentides`, `lery`: OCR Mistral sur fenetre bornee, 0 zone.

## Artefacts crees localement

- `work/zonage-norms/discovered-shard-2-20260710-a.json`
- `work/zonage-norms/lile-danticosti/grille.pdf`
- `work/zonage-norms/saint-damien-de-buckland/grille.pdf`
- `work/zonage-norms/saint-nazaire-de-dorchester/grille.pdf`
- ce rapport

## Notes

- Les rejets sont conformes au gate strict: pas d'overlap nul, pas de `publishedFieldPct=0`, pas de depot avec moins de 3 codes.
- Les portails MRC Temiscamingue testés contiennent souvent le reglement sans annexe exploitable; les grilles dediees ou parties scannees via schema sont plus productives.
