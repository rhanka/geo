# Zones reacquire post-DDO - 2026-07-07

## First read

Latest post-DDO session read first: `work/parallel-runs/20260707T175457Z-zones-reacq-postddo.prompt/out`.
Context readback also included `zones-reacquire6.last` and `zones-reacquire5.last`: DDO was already fixed; remaining strict candidates were Charlemagne, Deux-Montagnes, Saint-Bruno-de-Montarville, Saint-Gabriel-de-Brandon, plus the no-code Saint-Ferreol-les-Neiges case.

## Reduction

Deux-Montagnes is removed from the strict restants by refreshing the norms product from the true official municipal grille:

- official source: `https://www.ville.deux-montagnes.qc.ca/storage/app/media/ville-de-deux-montagnes/administration-et-finances/reglements-municipaux/1733-zonage-annexe-b-grilles_adm_2026-06-04.pdf`
- local staged PDF: `work/zonage-norms/deux-montagnes/grille.pdf`
- native route: standalone `Numero de zone` one-zone pages, no OCR/vision calls
- deposit: `registry/qc-zonage-norms/qc-zonage-norms-deux-montagnes.parquet`
- rows: 100
- distinct zone codes: 100
- published field pct: 73.4
- crossval at deposit: SIG 123, extracted 100, overlap 100, recoup extracted 100%, recoup SIG 81%

Strict gate after deposit:

- PASS `deux-montagnes`: features=124 distinct=123 codeLike=100% norms=100 overlap=98
- PASS `dollard-des-ormeaux`: features=86 distinct=86 codeLike=100% norms=31 overlap=12
- FAIL `charlemagne`: current SIG code sample is `URB` only, affectation not zonage
- FAIL `saint-bruno-de-montarville`: SIG is code-like, norms remain disjoint/stale
- FAIL `saint-gabriel-de-brandon`: current served SIG is numeric-only, no true zone-code field
- FAIL `saint-ferreol-les-neiges`: current served SIG has no zone_code

I did not run `zonage-reacquire-audit.ts` because that script contains an internal `sleep` retry helper, explicitly forbidden in this run. The strict gate output above is the current reduction proof.

## Materialized products

`lot-zone-join-run.ts --slugs deux-montagnes`:

- lots=6429
- assigned=99.95%
- multi=0.87%
- match=99.19%
- without_norms=0.81%
- verify parquet=Y stats=Y rows=6429

`lots-enriched-run.ts --slugs deux-montagnes --no-role --no-fsa`:

- lots=6429
- zone_code=99.95%
- norms=99.14%
- surface=100%
- deposit=Y
- bytes=16559261
- note: `code_postal` is null because `--no-fsa` was intentional for a zonage-only materialization.

Both `--verify-only` checks passed for Deux-Montagnes.

## Remaining blockers

- `charlemagne`: official municipal page exposes zonage PDF/JPG plan assets, but the served layer is only `URB`; needs a true coded vector source or georeferenced plan extraction, not an affectation bridge.
- `saint-bruno-de-montarville`: official municipal PDFs exist, but the current norms parquet only covers a stale/mismatched subset (`HA-100F` / `ZONEHA-*`) against SIG codes such as `HA-102`, `AA-890`; needs fresh official grille extraction across annexes.
- `saint-gabriel-de-brandon`: official zoning bylaw/plan/grilles PDFs exist, but current WFS exposes numeric identifiers only; strict gate requires a real coded geometry source, not synthetic prefixing.
- `saint-ferreol-les-neiges`: served geometry has no zone_code and appears to be an MRC affectation layer; official per-zone grilles exist, but a true coded zoning geometry is still missing.
