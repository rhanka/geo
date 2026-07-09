# NORMES longshot lane A - 20260709T171841Z

## Baseline

- Branch: `feat/cadre-acquisition`
- Reconcile before work: `normes=560/1106`
- Lane A selection: `normes.status != done`, matrix index even, `pdf-native` candidate track.
- Lane A candidates: 272
- Staged `grille.pdf` in lane A: 56

## Deposited

One verified parquet-only normes deposit:

| slug | method | rows | unique codes | field pct | SIG grid | overlap |
| --- | --- | ---: | ---: | ---: | --- | ---: |
| `saint-elie-de-caxton` | `native-text/grille-native-sweep` | 70 | 70 | 57.5 | no | 0 |

Sample verbatim zone codes: `101`, `102`, `103`, `104`, `105`, `106`, `107`, `108`, `109`, `110`, `111`, `112`.

Manifest: targeted `norms-manifest-refresh.ts --slugs saint-elie-de-caxton --apply` completed. Final manifest readback shows `present=true`, `unique_zone_codes=70`, `published_field_pct=57.5`.

Source note: no source URL was recovered from existing local manifests/artifacts for the staged PDF, so no URL was invented. The manifest/parquet source remains `non-disponible`; the PDF used was the pre-existing `work/zonage-norms/saint-elie-de-caxton/grille.pdf`.

## Rejected Attempts

- Native dry sweep over 56 staged lane-A PDFs: 1 would-deposit, 48 no native zones, 7 below 3-code gate.
- OCR direct-source windows: `thetford-mines` 31..37, `saint-lin-laurentides` 120..142, `trois-rivieres` 1..1 all returned 0 zones.
- Multizone direct-source windows: `thetford-mines` returned 0 zones; `saint-lin-laurentides` rejected with SIG overlap 0/115; `trois-rivieres` rejected with SIG overlap 0/1664.
- GPT-5.5 direct-source retry: `thetford-mines` 31..37 returned 0 zones.

## After

Final reconcile: `normes=561/1106`, lane delta `+1`.

Final reconcile also showed `pv=1051` and `zones=770`; those non-norm changes came from concurrent S3 state, not this lane.

## Artifacts

- `work/delegation-mass/normes-longshot-A-20260709T171841Z.json`
- `work/delegation-mass/normes-longshot-A-20260709T171841Z.native-dry.json`
- `work/delegation-mass/normes-longshot-A-20260709T171841Z.native-apply.json`
- `work/delegation-mass/normes-longshot-A-20260709T171841Z.ocr-targets.json`
- `work/delegation-mass/normes-longshot-A-20260709T171841Z.multizone-targets.json`
- `work/delegation-mass/normes-longshot-A-20260709T171841Z.gpt55-targets.json`
- `work/delegation-mass/normes-longshot-A-20260709T171841Z.gpt55-report.json`
- `work/delegation-mass/normes-longshot-A-20260709T171841Z.manifest-merge-dry.json`
