# NORMES shard 1/4 relance 20260709T030635Z

## Résultat

- Succès parquet-only: `hatley` déposé dans `registry/qc-zonage-norms/qc-zonage-norms-hatley.parquet`.
- Gate `hatley`: 11 lignes/codes, `publishedFieldPct=50`, `gridFound=false`; overlap nul non bloquant car aucun SIG informatif n'est disponible pour ce slug.
- Supervision après dépôt: `SCOREBOARD /1106 : pv=1050 (+2) | normes=558 (+0) | zones=767 (+0) | cadastre=1106 (+1) | role-foncier=1106 (+0) | tod=39 (+0)`.
- Tous les essais d'extraction ont été lancés en parquet-only avec `NORMS_NO_MANIFEST=1` / `--no-manifest`; aucun manifest partagé n'a été écrit.

## Méthodes lancées

- Status S3/SIG sur le shard: tous les slugs candidats étaient libres au départ; 21 avaient un `work/zonage-norms/<slug>/grille.pdf` local.
- OCR/native-first borné avec `zonage-norms-batch.ts`, budget `NORMS_BUDGET_USD=1`.
- OCR auto-grid borné sur PDFs locaux avec SIG: `bearn`, `bristol`, `east-broughton`.
- GPT-5.5 borné avec `zonage-norms-gpt55-batch.ts --no-manifest`, report JSON dédié.
- Discovery bornée sur les premiers slugs sans PDF local: le registre crawlable a retenu `abercorn` et `baie-des-sables`; aucun PDF grille confirmé.

## Rejets / non-dépôts

- `champlain`: OCR 65..198, 134 pages, `0 zones extracted`.
- `calixa-lavallee`: OCR 96..106, 22 codes extraits, rejet `publishedFieldPct=0`.
- `la-macaza`: OCR page 40 puis GPT-5.5 page 40, `0 zones extracted`.
- `bearn`: auto-grid sans page-grille détectée, OCR 1..20, `0 zones extracted`.
- `bristol`: auto-grid sans page-grille détectée, OCR 1..20, `0 zones extracted`.
- `east-broughton`: auto-grid sans page-grille détectée, OCR 1..16, `0 zones extracted`.
- `barnston-ouest`: GPT-5.5 page 1, `0 zones extracted`.
- `lac-des-plages`: GPT-5.5 page 1, 30 codes extraits et overlap SIG 11/11, mais rejet `publishedFieldPct=0`.
- `gatineau`: GPT-5.5 pages 1..2, overlap 1 mais rejet seuil dépôt: 1 code unique < 3.

## Fix runner

- `zonage-norms-batch.ts`: correction de l'idempotence S3. `listSlugs("registry/qc-zonage-norms/", ".parquet")` retourne `qc-zonage-norms-<slug>`; le batch faisait une correspondance partielle et skippait à tort `champlain` via `saint-prosper-de-champlain` et `hatley` via `sainte-catherine-de-hatley`.
- Re-observation: après normalisation exacte du préfixe, `champlain` et `hatley` n'ont plus été skippés; `hatley` a été traité et déposé.

## Artefacts

- `work/delegation-mass/normes-relaunch-1-20260709T030635Z.targets.json`
- `work/delegation-mass/normes-relaunch-1-20260709T030635Z.autogrid-targets.json`
- `work/delegation-mass/normes-relaunch-1-20260709T030635Z.gpt55-targets.json`
- `work/delegation-mass/normes-relaunch-1-20260709T030635Z.gpt55-report.json`
- `work/delegation-mass/normes-relaunch-1-20260709T030635Z.discovery.json`
