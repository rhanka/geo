# ZONES-PLATFORM report — 2026-07-07

Worker: `ZONES-PLATFORM`

Scope: residual municipal zoning via SIGALE, Geocentriq and GOnet, with strict anti-invention gates:

- reject numeric-only zoning values, affectation labels and letter-only classes;
- require at least 3 distinct real zoning codes;
- verify S3 overlap before depositing;
- do not edit `work/coverage/coverage-matrix.json` manually.

## Inputs read first

- `acquisition/src/zones-geocentriq-run.ts`
- `acquisition/src/zones-sigale-run.ts`
- `acquisition/src/zones-obscura-run.ts`

## SIGALE probes

Reports:

- `work/delegation-mass/zones-platform-probe-sigale-380.json`
- `work/delegation-mass/zones-platform-probe-sigale-050.json`
- `work/delegation-mass/zones-platform-probe-sigale-200.json`
- `work/delegation-mass/zones-platform-probe-sigale-030.json`
- `work/delegation-mass/zones-platform-probe-sigale-410.json`

Result:

- MRC 380: 11 valid zoning layers, all already served on S3 (`wasServed=true`); Bécancour has no usable `Zonage municipal` layer.
- MRC 050: 9 valid layers, all already served on S3; Bonaventure/Saint-Siméon/Paspébiac/Hope Town rejected as numeric-only or affectation-like.
- MRC 200: 0 deposits; all six Île-d'Orléans layers rejected as numeric-only `NUM_ZONE`.
- MRC 030: 1 valid layer already served; Murdochville/Gaspé rejected as numeric-only, Grande-Vallée null, Petite-Vallée no layer.
- MRC 410: 0 deposits; no `Zonage municipal` layer found in the services probed.

Net-new SIGALE deposits: 0.

## Geocentriq probes

Reports:

- `work/delegation-mass/zones-platform-probe-geocentriq-temiscamingue.json`
- `work/delegation-mass/zones-platform-probe-geocentriq-bellechasse.json`

Result:

- Témiscamingue: 16 valid layers, all already served on S3; Kipawa, Laforce and Saint-Eugène-de-Guigues rejected by the code gate.
- Bellechasse: 6 valid layers, all already served on S3; 14 workspaces had no zonage FeatureType.

Net-new Geocentriq deposits: 0.

## GOnet seed run

Pre-run S3 overlap check: the 12 seeded slugs had no zones object on S3.

Report:

- `work/delegation-mass/zones-platform-gonet-seed-20260707.json`

Seeded slugs:

- `aguanish`, `bethanie`, `cap-chat`, `havre-saint-pierre`, `matane`, `natashquan`
- `notre-dame-des-sept-douleurs`, `notre-dame-du-portage`, `saint-adelme`
- `saint-arsene`, `saint-epiphane`, `saint-paul-de-la-croix`

Result: all 12 were rejected with `no-zonage-layer`; the GOnet MapServers loaded but did not expose a usable `Zonage municipal` layer.

Net-new GOnet deposits from this seed: 0.

## Follow-up target

The incomplete prior GOnet sweep under `work/delegation-mass/zones-gonet-final/` has JSON reports only for shards `00` to `07`; shards `08` to `17` are missing JSON. Shard `09` log proves at least one GOnet zoning deposit before interruption (`courcelles-saint-evariste`), so the remaining shard segments are the best next target.

Further network/S3 execution was blocked by the Codex approval usage limit after the seed run, so no additional GOnet deposits were attempted in this turn.
