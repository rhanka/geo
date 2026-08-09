# PV completion audit — Québec municipalities

Deterministic, local-only audit. Status authority: `work/coverage/coverage-matrix.json` as of 2026-06-23T18:41:02.519Z. No network, S3, deployment, or Track operation was used.

## Result

| State | Cities | Target |
|---|---:|---:|
| complete | 1062 | 1106 |
| incomplete | 1 | 1106 |
| unknown | 41 | 1106 |
| N-A | 2 | 1106 |
| Open (incomplete + unknown) | 42 | 1106 |

The target remains **1106 municipalities**. 1104 are in scope after the two explicit N-A pilot-city exclusions; N-A cities remain in the target and matrix.

## State rules

- `complete`: local coverage PV status is `done` and the canonical city is not excluded.
- `incomplete`: local coverage PV status is `planned`; planned work receives no completion credit.
- `unknown`: local coverage PV status is `to-research`; research receives no completion credit.
- `N-A`: the canonical city list explicitly excludes the municipality (`pilot-city-*`). This state takes precedence over a coverage status.

Local PV probe/research artifacts are not promotion evidence. A probe result cannot change `planned` or `to-research` to `complete` in this audit.

## Exact-universe validation

- Canonical city identities: 1106/1106; duplicate slugs: 0.
- Coverage PV rows: 1106/1106; canonical-only slugs: 0; coverage-only slugs: 0.
- Directory registry cross-check: registry total 1106; matched entries 1100; unmatched entries 6.
- State partition: 1106/1106; every city has exactly one explicit state.

## Sources and as-of

- PV status: `work/coverage/coverage-matrix.json`, generated 2026-06-23T18:41:02.519Z, sha256:0e6e1a37d8f9ad45b4c1b8ff5e99bb1d7a85550c905d39ae0a666f2bff5991ca.
- Canonical city identity and N-A rule: `packages/qc-sources/src/geo/municipalities.qc.json`, sha256:7569b3ae83b61a589ccef3aa20b08747370904eba82b0c8c63792d28c5f966ef. This source embeds no generated-at field.
- Municipal registry cross-check: `packages/qc-sources/src/geo/qc-municipal-directory.json`, generated 2026-06-16T00:52:48.516544Z, sha256:a0af21c85de21348efb0b1d4fa3a4a4cb86581ccd31fb6a6b912da09d6202397; source MAMH — Répertoire des municipalités du Québec.

The JSON matrix contains all 1,106 city identities, their source status/as-of, audit state, and basis. The CSV below is the explicit actionable open-city list.

- Full matrix: `work/coverage/pv-completion-city-audit.json`
- Open-city CSV: `work/coverage/pv-completion-open-cities.csv`

## Open city list

| Municipality | Slug | MRC | State | Local PV status | Status as-of | Basis |
|---|---|---|---|---|---|---|
| Belleterre | `belleterre` | Témiscamingue | unknown | `to-research` | 2026-06-23T05:45:22.715Z | coverage PV status is to-research; research is not complete |
| Bonne-Espérance | `bonne-esperance` | Le Golfe-du-Saint-Laurent | unknown | `to-research` | 2026-06-23T05:54:56.463Z | coverage PV status is to-research; research is not complete |
| Bryson | `bryson` | Pontiac | unknown | `to-research` | 2026-06-23T05:35:29.546Z | coverage PV status is to-research; research is not complete |
| Caniapiscau | `caniapiscau` | — | unknown | `to-research` | 2026-06-23T05:54:48.047Z | coverage PV status is to-research; research is not complete |
| Chapais | `chapais` | — | unknown | `to-research` | 2026-06-23T05:46:57.572Z | coverage PV status is to-research; research is not complete |
| Charette | `charette` | Maskinongé | incomplete | `planned` | 2026-06-23T05:19:45.736Z | coverage PV status is planned; planned is not complete |
| Colombier | `colombier` | La Haute-Côte-Nord | unknown | `to-research` | 2026-06-23T05:48:30.185Z | coverage PV status is to-research; research is not complete |
| Côte-Nord-du-Golfe-du-Saint-Laurent | `cote-nord-du-golfe-du-saint-laurent` | Le Golfe-du-Saint-Laurent | unknown | `to-research` | 2026-06-23T05:54:51.251Z | coverage PV status is to-research; research is not complete |
| Eeyou Istchee James Bay | `eeyou-istchee-james-bay` | — | unknown | `to-research` | 2026-06-23T05:53:58.397Z | coverage PV status is to-research; research is not complete |
| Ferland-et-Boilleau | `ferland-et-boilleau` | Le Fjord-du-Saguenay | unknown | `to-research` | 2026-06-23T05:41:17.765Z | coverage PV status is to-research; research is not complete |
| Gros-Mécatina | `gros-mecatina` | Le Golfe-du-Saint-Laurent | unknown | `to-research` | 2026-06-23T05:54:53.098Z | coverage PV status is to-research; research is not complete |
| L'Île-Dorval | `lile-dorval` | — | unknown | `to-research` | 2026-06-23T05:00:40.862Z | coverage PV status is to-research; research is not complete |
| La Visitation-de-l'Île-Dupas | `la-visitation-de-lile-dupas` | D'Autray | unknown | `to-research` | 2026-06-23T05:12:38.810Z | coverage PV status is to-research; research is not complete |
| Les Méchins | `les-mechins` | La Matanie | unknown | `to-research` | 2026-06-23T05:52:19.147Z | coverage PV status is to-research; research is not complete |
| Lochaber | `lochaber` | Papineau | unknown | `to-research` | 2026-06-23T05:22:07.873Z | coverage PV status is to-research; research is not complete |
| Moffet | `moffet` | Témiscamingue | unknown | `to-research` | 2026-06-23T05:46:10.233Z | coverage PV status is to-research; research is not complete |
| Mont-Saint-Pierre | `mont-saint-pierre` | La Haute-Gaspésie | unknown | `to-research` | 2026-06-23T05:53:32.078Z | coverage PV status is to-research; research is not complete |
| Notre-Dame-des-Anges | `notre-dame-des-anges` | — | unknown | `to-research` | 2026-06-23T05:34:55.691Z | coverage PV status is to-research; research is not complete |
| Notre-Dame-du-Nord | `notre-dame-du-nord` | Témiscamingue | unknown | `to-research` | 2026-06-23T05:48:00.130Z | coverage PV status is to-research; research is not complete |
| Rivière-Éternité | `riviere-eternite` | Le Fjord-du-Saguenay | unknown | `to-research` | 2026-06-23T05:42:21.081Z | coverage PV status is to-research; research is not complete |
| Rivière-Saint-Jean | `riviere-saint-jean` | Minganie | unknown | `to-research` | 2026-06-23T05:54:16.010Z | coverage PV status is to-research; research is not complete |
| Saint-André-du-Lac-Saint-Jean | `saint-andre-du-lac-saint-jean` | Le Domaine-du-Roy | unknown | `to-research` | 2026-06-23T05:40:25.798Z | coverage PV status is to-research; research is not complete |
| Saint-Augustin | `saint-augustin--maria-chapdelaine` | Maria-Chapdelaine | unknown | `to-research` | 2026-06-23T05:42:36.142Z | coverage PV status is to-research; research is not complete |
| Saint-Benoît-du-Lac | `saint-benoit-du-lac` | Memphrémagog | unknown | `to-research` | 2026-06-23T05:18:37.189Z | coverage PV status is to-research; research is not complete |
| Saint-Clet | `saint-clet` | Vaudreuil-Soulanges | unknown | `to-research` | 2026-06-23T11:26:32.902Z | coverage PV status is to-research; research is not complete |
| Saint-Dominique-du-Rosaire | `saint-dominique-du-rosaire` | Abitibi | unknown | `to-research` | 2026-06-23T05:47:46.319Z | coverage PV status is to-research; research is not complete |
| Saint-Édouard-de-Fabre | `saint-edouard-de-fabre` | Témiscamingue | unknown | `to-research` | 2026-06-23T05:46:45.594Z | coverage PV status is to-research; research is not complete |
| Saint-Elphège | `saint-elphege` | Nicolet-Yamaska | unknown | `to-research` | 2026-06-23T05:15:22.160Z | coverage PV status is to-research; research is not complete |
| Saint-Eugène-d'Argentenay | `saint-eugene-dargentenay` | Maria-Chapdelaine | unknown | `to-research` | 2026-06-23T05:43:22.695Z | coverage PV status is to-research; research is not complete |
| Saint-Guy | `saint-guy` | — | unknown | `to-research` | 2026-06-23T05:45:54.268Z | coverage PV status is to-research; research is not complete |
| Saint-Jean-de-l'Île-d'Orléans | `saint-jean-de-lile-dorleans` | L'Île-d'Orléans | unknown | `to-research` | 2026-06-23T05:37:53.758Z | coverage PV status is to-research; research is not complete |
| Saint-Lambert | `saint-lambert--abitibi-ouest` | Abitibi-Ouest | unknown | `to-research` | 2026-06-23T05:51:55.596Z | coverage PV status is to-research; research is not complete |
| Saint-Louis-de-Gonzague-du-Cap-Tourmente | `saint-louis-de-gonzague-du-cap-tourmente` | La Côte-de-Beaupré | unknown | `to-research` | 2026-06-23T05:38:30.737Z | coverage PV status is to-research; research is not complete |
| Saint-Médard | `saint-medard` | Les Basques | unknown | `to-research` | 2026-06-23T05:45:47.417Z | coverage PV status is to-research; research is not complete |
| Saint-Octave-de-Métis | `saint-octave-de-metis` | La Mitis | unknown | `to-research` | 2026-06-23T05:49:19.380Z | coverage PV status is to-research; research is not complete |
| Saint-Pierre-de-la-Rivière-du-Sud | `saint-pierre-de-la-riviere-du-sud` | Montmagny | unknown | `to-research` | 2026-06-23T05:38:32.339Z | coverage PV status is to-research; research is not complete |
| Saint-Tharcisius | `saint-tharcisius` | La Matapédia | unknown | `to-research` | 2026-06-23T05:51:46.966Z | coverage PV status is to-research; research is not complete |
| Sainte-Hedwidge | `sainte-hedwidge` | Le Domaine-du-Roy | unknown | `to-research` | 2026-06-23T05:40:22.235Z | coverage PV status is to-research; research is not complete |
| Sainte-Marguerite-Marie | `sainte-marguerite-marie` | La Matapédia | unknown | `to-research` | 2026-06-23T05:51:51.675Z | coverage PV status is to-research; research is not complete |
| Sainte-Rita | `sainte-rita` | Les Basques | unknown | `to-research` | 2026-06-23T05:45:25.546Z | coverage PV status is to-research; research is not complete |
| Très-Saint-Sacrement | `tres-saint-sacrement` | Le Haut-Saint-Laurent | unknown | `to-research` | 2026-06-23T11:24:14.683Z | coverage PV status is to-research; research is not complete |
| Val-Saint-Gilles | `val-saint-gilles` | Abitibi-Ouest | unknown | `to-research` | 2026-06-23T05:51:07.792Z | coverage PV status is to-research; research is not complete |

## N-A cities (retained in target)

| Municipality | Slug | MRC | Basis | Status as-of |
|---|---|---|---|---|
| Laval | `laval` | — | canonical city exclusion: pilot-city-laval | 2026-06-23T05:55:02.666Z |
| Montréal | `montreal` | — | canonical city exclusion: pilot-city-montreal | 2026-06-23T05:55:00.786Z |

## Reproduce

```bash
node scripts/audit-pv-completion.mjs
```
