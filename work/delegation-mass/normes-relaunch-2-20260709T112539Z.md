# NORMES shard 2/4 relance 20260709T112539Z

## Resultat

- Succes parquet-only: `saint-boniface` depose dans `registry/qc-zonage-norms/` via `--no-manifest`.
- Gate `saint-boniface`: 5 codes de zone, `publishedFieldPct=62.5`, `gridFound=false`; overlap nul non bloquant car aucun SIG informatif.
- Verification S3: `DEPOSITED sig=NO saint-boniface`.
- Supervision apres depot: `SCOREBOARD /1106 : pv=1050 (+0) | normes=559 (+1) | zones=768 (+1) | cadastre=1106 (+0) | role-foncier=1106 (+0) | tod=39 (+0)`.

## Methodes lancees

- Inventaire local du shard: 17 PDFs presents; `ogden` deja depose, 16 libres.
- Probes lecture seule: `norms-status-check.ts`, `zonage-norms-vision-shard.ts`, `normes-window-probe.ts`, `grille-native-probe.ts`, `pdf-page-text.ts`.
- Extraction OCR/native parquet-only sur `saint-boniface` pages 4..20 avec `NORMS_NO_MANIFEST=1`, budget bas: echec fournisseur `fetch failed`, 0 zone.
- Fallback GPT-5.5 borne sur `saint-boniface` pages 4..8, `dpi=120`, via `zonage-norms-gpt55-batch.ts --no-manifest`: depot accepte.
- Discovery borne sur `authier-nord, barraute, begin, berry, biencourt`: 0 muni dans le registre crawler; aucun PDF telecharge.

## Non-depots / rejets constates

- `denholm`: page 93 = article amenagements paysagers / aires tampons, pas grille de normes.
- `bowman`: pages 44..46 = articles de reglement, pas grille de normes.
- `notre-dame-de-ham`: annexe d'amendement pour une seule zone `I2`; sous le gate de 3 codes.
- `coaticook`: PDF local = plan de contraintes, pas grille de normes.
- `saint-benjamin`: PDF local = ordre du jour/PV, pas grille de normes.
- `messines`: pages 1..4 = table de modifications; pas relance en extraction sur cette fenetre.
- `lambton`, `lassomption`, `notre-dame-des-prairies`, `princeville`: non relances a l'identique, deja documentes en echec dans `normes-relaunch-2-20260709T030635Z.md`.

## Artefacts

- `normes-relaunch-2-20260709T112539Z.targets.json`
- `normes-relaunch-2-20260709T112539Z.gpt55-targets.json`
- `normes-relaunch-2-20260709T112539Z.gpt55-report.json`
- `normes-relaunch-2-20260709T112539Z.discovery.json`
- `normes-relaunch-2-20260709T112539Z.summary.json`
