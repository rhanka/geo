# Portfolio city report — 2026-07-25

Rapport **pérenne et reproductible** (généré par `scripts/portfolio-city-report.mjs`, format figé: `docs/spec/SPEC_PORTFOLIO_REPORT.md`). Déterministe, 0 réseau / S3 / déploiement / Track / commit. Unité = la ville ; `unknown` n'est jamais compté `complete` ; chaque partition ferme. Précédent/Δ = diff avec le snapshot 20260724.

| KPI villes | Précédent | Actuel | Δ | Cible |
|---|---:|---|---:|---:|
| Zones — complétion | 868 / 1 106 complete · 195 incomplete · 43 unknown · 0 N/A | 868 / 1 106 complete · 195 incomplete · 43 unknown · 0 N/A | 0 | 1 106 |
| Zones — cohérence lot-zone | donnée insuffisante — 1 / 1 106 ville(s) auditée(s) (mont-saint-hilaire : mismatch 4,9 %) | 713 / 1 106 complete · 121 incomplete · 272 unknown · 0 N/A | — | 1 106 |
| Normes — complétion | 502 / 1 106 complete · 290 incomplete · 314 unknown · 0 N/A | 502 / 1 106 complete · 290 incomplete · 314 unknown · 0 N/A | 0 | 1 106 |
| PV — complétion | 1 062 / 1 106 complete · 1 incomplete · 41 unknown · 2 N/A | 1 062 / 1 106 complete · 1 incomplete · 41 unknown · 2 N/A | 0 | 1 106 |
| Règlement — complétion | 815 / 1 106 complete · 269 incomplete · 22 unknown · 0 N/A | 815 / 1 106 complete · 269 incomplete · 22 unknown · 0 N/A | 0 | 1 106 |
| Usage dominant — complétion | 710 / 1 106 complete · 374 incomplete · 22 unknown · 0 N/A | 710 / 1 106 complete · 374 incomplete · 22 unknown · 0 N/A | 0 | 1 106 |
| Effet densifiant — complétion | 5 / 1 106 complete · 1 079 incomplete · 22 unknown · 0 N/A | 5 / 1 106 complete · 1 079 incomplete · 22 unknown · 0 N/A | 0 | 1 106 |
| Provenance zones — jointure exacte | 868 / 1 106 jointures exactes · 238 sans jointure | 868 / 1 106 jointures exactes · 238 sans jointure | 0 | 1 106 |
| Provenance zones — qualité retained | 727 acceptable · 32 candidate · 109 orphan · 238 unknown | 727 acceptable · 32 candidate · 109 orphan · 238 unknown | 0 | 1 106 |
| Provenance zones — preuve v2 exacte | 0 / 1 106 v2 · toutes les lignes retained sont not-assessed | 0 / 1 106 v2 · toutes les lignes retained sont not-assessed | 0 | 1 106 |
| Provenance zones — URL source servie | 538 / 871 collections avec zone_source_url (http) · 329 stamped-null · 4 unstamped · 0 read-error | 538 / 871 collections avec zone_source_url (http) · 329 stamped-null · 4 unstamped · 0 read-error | 0 | 871 |
| Immo — assignation lot-zone | 342 / 1 100 complete · 546 incomplete · 212 unknown · 6 N/A | 342 / 1 100 complete · 546 incomplete · 212 unknown · 6 N/A | 0 | 1 100 (6 N/A explicites) |
| Immo — normes pliées | 52 / 1 100 complete · 816 incomplete · 232 unknown · 6 N/A | 52 / 1 100 complete · 816 incomplete · 232 unknown · 6 N/A | 0 | 1 100 (6 N/A explicites) |
| Immo champs — lots servis | 874 / 1 106 complete · 232 incomplete · 0 unknown · 0 N/A | 874 / 1 106 complete · 232 incomplete · 0 unknown · 0 N/A | 0 | 1 106 |
| Immo champs — surface m² | 868 / 1 100 complete · 0 incomplete · 232 unknown · 6 N/A | 868 / 1 100 complete · 0 incomplete · 232 unknown · 6 N/A | 0 | 1 100 (6 N/A explicites) |
| Immo champs — code postal | 867 / 1 100 complete · 1 incomplete · 232 unknown · 6 N/A | 867 / 1 100 complete · 1 incomplete · 232 unknown · 6 N/A | 0 | 1 100 (6 N/A explicites) |
| Immo champs — adresse civique | 22 / 1 100 complete · 846 incomplete · 232 unknown · 6 N/A | 22 / 1 100 complete · 846 incomplete · 232 unknown · 6 N/A | 0 | 1 100 (6 N/A explicites) |
| Immo champs — applicabilité TOD | 39 / 39 complete · 0 incomplete · 0 unknown · 1 067 N/A | 39 / 39 complete · 0 incomplete · 0 unknown · 1 067 N/A | 0 | 39 (1 067 N/A explicites) |
| Immo champs — complétion TOD | 4 / 39 complete · 28 incomplete · 7 unknown · 1 067 N/A | 4 / 39 complete · 28 incomplete · 7 unknown · 1 067 N/A | 0 | 39 (1 067 N/A explicites) |

## Réconciliation & notes

- L’univers est de 1 106 villes canoniques pour chaque KPI ville, sauf dénominateur N/A explicitement documenté (les N/A restent dans la partition qui ferme à 1 106).
- **Alignement présence + qualité/provenance** : le rapport mesure la PRÉSENCE (données servies) ET la QUALITÉ/PROVENANCE (URL de source servie, cohérence lot-zone) ; sans cet axe, la ré-acquisition et le stampage sont invisibles.
- **URL source servie** : 538 / 871 collections servies portent une `zone_source_url` http réelle ; 329 sont stamped-null et 4 unstamped. Toute ré-acquisition qui n’écrit pas la source de preuve dans la même passe fait CHUTER ce KPI (dé-stampage détectable).
- **Cohérence lot-zone** : mesure RÉELLE sur 864 villes auditables (zonage ET lots servis), ville `complete` ssi `mismatch_pct < 5 %`. 30 villes sans AUCUN lot porteur de `code_zone` sont comptées `unknown`, jamais `complete` : leur taux vaut 0 par absence de donnée, pas par qualité. 242 villes non auditables (zonage ou lots non servis) sont également `unknown`. 3 ligne(s) hors univers canonique sans crédit de complétion.
- **Mismatch lot-zone à l’échelle (contexte lots, non mélangé aux KPI villes)** : 4,34 % pondéré par les lots, médiane par ville 2,58 %, p90 5,72 % — le défaut est CONCENTRÉ, pas diffus.
- Δ cohérence lot-zone non calculable : le snapshot 20260724 portait ce KPI en "donnée insuffisante" (aucun champ numérique). Aucun Δ n’est fabriqué ; le premier Δ réel sortira au prochain run.
- **Lots sans `code_zone` (contexte lots, non mélangé aux KPI villes)** : 1 093 464 lots servis sur 3 371 939 (32,43 %) n’ont AUCUN `code_zone` — trou de jointure PLUS GROS que le mismatch lui-même, concentré sur quelques villes (montreal 669 287/680 087 ; saguenay 19 135/19 135). À traiter comme un gisement de re-fold distinct, pas comme une incohérence de géométrie.
- Normes pliées (contexte lots, non mélangé aux KPI villes) : 1 041 867 / 3 389 752 lots servis pliés (30,74 %) ; 2 347 885 manquants.
- `acceptable` de provenance = preuve locale retained historique/legacy ; ce n’est PAS une preuve v2. Aucune preuve v2 n’est inférée (0 / 1 106).
- Les slugs `l-assomption`, `l-epiphanie`, `sainte-christine-d-auvergne` ne sont pas des clés villes canoniques : lignes de sources non liées, sans fusion par alias ni crédit de complétion.

## Sources locales, as-of et empreintes

- `work/coverage/completion-1-zones-normes-summary-20260723.json` — as-of `2026-07-23` — `sha256:baf433b68e84fc963296247f27100f7712560067d6fc4fb55edffb77093b7df1`
- `work/coverage/pv-completion-city-audit.json` — as-of `2026-06-23T18:41:02.519Z` — `sha256:0352d5ffb08309ae0516f370c29980ed93f2adbe1459c2825eccc24319a15e25`
- `work/coverage/completion-regdens-20260723.json` — as-of `couverture 2026-06-23T18:41:02.519Z ; enrichissement 2026-07-20T00:11:11.869Z ; audit événements 2026-07-22T01:26:34.868Z` — `sha256:da46f7afb00e874934571a68222e27b80718a45bf324d8ebea210141519d46b1`
- `work/coverage/zone-provenance-quality-matrix-20260723-74345365.json` — as-of `2026-07-23` — `sha256:fe11a6e72c939da1a7aa9f2ba48ba24ce09a8f3cfab428e37bca08c7b4589ae9`
- `work/coverage/immo-lot-zone-assignment-matrix-20260723.json` — as-of `lot-level assignment proof and counts: 2026-07-22T23:43:37.049Z ; Immo per-city lot-count snapshot: 2026-07-19T19:18:23.051Z ; separate zone-geometry provenance status: 2026-07-22` — `sha256:7b54d9a3bffd5c7b51ed963f966e91063cfb6df4ce54dbc784df0fb166ce53b7`
- `work/coverage/immo-folded-normes-city-matrix.json` — as-of `couverture 2026-06-23T18:41:02.519Z ; snapshot Immo 2026-07-19T19:18:23.051Z` — `sha256:7b3dc630bb24e40879072dc15ec68de2673c4fbbcbce86931966b9efe0e528e5`
- `work/immo-field-completion-matrices/immo-field-completion-matrix.json` — as-of `non daté dans l’artefact (entrées: coverage-matrix, immo-lots)` — `sha256:fb0f8b2df00507b167982accfbeef24e34c70f78fc1fbbf810e833c9fceb9f5c`
- `work/coverage/zone-source-readback-audit-20260724b.json` — as-of `2026-07-25T02:30:31.808Z` — `sha256:7c20c4e09426e3712cc89b2c74d65c739a47d9431f1fa679bd8ff36587b70a8b`
- `work/coverage/lot-zone-consistency-scale-20260725.json` — as-of `2026-07-25T20:19:03.459Z ; listing S3 2026-07-25T19:36:07.289Z` — `sha256:36cccc45e94ee81a7736f309609d2eec03c69dcab533bb6118d7f903d68268d3`
- `work/coverage/lot-zone-consistency.json` — as-of `AUDIT` — `sha256:f5a6183baed75af3eee676dd08c2420a3245897426cf0c0eef686421265a05f2`
- `work/coverage/coverage-matrix.json` — as-of `2026-06-23T18:41:02.519Z` — `sha256:0e6e1a37d8f9ad45b4c1b8ff5e99bb1d7a85550c905d39ae0a666f2bff5991ca`

## Validation

- 19 KPI à partition fermée (somme = partitionTotal) ; `unknown` jamais compté `complete`.
- Généré localement, sans réseau, S3, déploiement, Track ni commit. Empreintes sha256 recalculées sur les octets lus.
- Reproduction : `node scripts/portfolio-city-report.mjs` (validation stricte : `--check`).
