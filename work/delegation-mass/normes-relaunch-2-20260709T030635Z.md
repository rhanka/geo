# NORMES shard 2/4 relance 20260709T030635Z

## Résultat

- Succès parquet-only: `ogden` déposé dans `registry/qc-zonage-norms/` via `--no-manifest`.
- Gate `ogden`: 4 codes de zone, `publishedFieldPct=62.5`, `gridFound=false`; overlap nul non bloquant car aucun SIG informatif.
- Supervision après dépôt: `SCOREBOARD /1106 : pv=1050 (+0) | normes=558 (+2) | zones=767 (+1) | cadastre=1106 (+0) | role-foncier=1106 (+0) | tod=39 (+0)`.

## Méthodes lancées

- Inventaire local: 17 PDFs présents dans le shard; tous libres côté `qc-zonage-norms`.
- Extraction OCR/vision parquet-only avec `NORMS_NO_MANIFEST=1`, `NORMS_BUDGET_USD=1`.
- Probes lecture seule: `normes-window-probe.ts`, `grille-native-probe.ts`, `norms-status-check.ts`.
- GPT-5.5 borné avec `zonage-norms-gpt55-batch.ts --no-manifest` via le runner.
- Discovery bornée tentée sur les premiers slugs crawlables; `brome` et `cayamant` sans grille confirmée, `campbells-bay` interrompu avant écriture de manifest pour respecter la borne.

## Rejets / non-dépôts

- `lambton`: fenêtre manifest initiale 66 = page d'articles; fenêtre corrigée 97..100 en OCR puis page 97 en gpt55 -> 0 zones.
- `notre-dame-des-prairies`: OCR 167..169 puis gpt55 168 -> 0 zones.
- `princeville`: OCR 51..125 rejeté overlap=0 (`1-19`, `1` hors SIG); OCR 115..133 et gpt55 115 -> 0 zones.
- `lassomption`: vision 28..34 -> 0 zones; pages lues = annexes mouvement de terrain, pas grille de codes réglementaires.

## Artefacts

- `normes-relaunch-2-20260709T030635Z.targets.json`
- `normes-relaunch-2-20260709T030635Z.targets2.json`
- `normes-relaunch-2-20260709T030635Z.gpt55-targets.json`
- `normes-relaunch-2-20260709T030635Z.gpt55-report.json`
- `normes-relaunch-2-20260709T030635Z.gpt55-gridless-targets.json`
- `normes-relaunch-2-20260709T030635Z.gpt55-gridless-report.json`
