# Portfolio city report — 2026-08-03

Rapport **pérenne et reproductible** (généré par `scripts/portfolio-city-report.mjs`, format figé: `docs/spec/SPEC_PORTFOLIO_REPORT.md`). Déterministe, 0 réseau / S3 / déploiement / Track / commit. Unité = la ville ; `unknown` n'est jamais compté `complete` ; chaque partition ferme. Précédent/Δ = diff avec le snapshot 20260802.

| KPI villes | Précédent | Actuel | Δ | Cible |
|---|---:|---|---:|---:|
| Zones — complétion | 868 / 1 106 complete · 195 incomplete · 43 unknown · 0 N/A | 868 / 1 106 complete · 195 incomplete · 43 unknown · 0 N/A | 0 | 1 106 |
| Zones — cohérence lot-zone | 713 / 1 106 complete · 121 incomplete · 272 unknown · 0 N/A | 713 / 1 106 complete · 121 incomplete · 272 unknown · 0 N/A | 0 | 1 106 |
| Normes — complétion | 501 / 1 106 complete · 290 incomplete · 315 unknown · 0 N/A | 501 / 1 106 complete · 290 incomplete · 315 unknown · 0 N/A | 0 | 1 106 |
| PV — complétion | 1 062 / 1 106 complete · 1 incomplete · 41 unknown · 2 N/A | 1 062 / 1 106 complete · 1 incomplete · 41 unknown · 2 N/A | 0 | 1 106 |
| Règlement — complétion déclarée | — | 895 / 1 106 complete · 46 incomplete · 165 unknown · 0 N/A | — | 1 106 |
| Règlement — preuve v2 | — | 542 / 1 106 complete · 67 incomplete · 497 unknown · 0 N/A | — | 1 106 |
| Usage dominant — complétion | 710 / 1 106 complete · 179 incomplete · 217 unknown · 0 N/A | 710 / 1 106 complete · 179 incomplete · 217 unknown · 0 N/A | 0 | 1 106 |
| Effet densifiant — complétion | 7 / 1 106 complete · 96 incomplete · 1 003 unknown · 0 N/A | 7 / 1 106 complete · 96 incomplete · 1 003 unknown · 0 N/A | 0 | 1 106 |
| Provenance zones — jointure exacte | 868 / 1 106 jointures exactes · 238 sans jointure | 868 / 1 106 jointures exactes · 238 sans jointure | 0 | 1 106 |
| Provenance zones — qualité retained | 693 acceptable · 55 v2 · 37 candidate · 82 orphan · 239 unknown | 589 acceptable · 162 v2 · 37 candidate · 79 orphan · 239 unknown | +3 complete · -3 incomplete | 1 106 |
| Provenance zones — preuve v2 exacte | 55 / 1 106 v2 · preuve capture+CAS vérifiée uniquement | 162 / 1 106 v2 · preuve capture+CAS vérifiée uniquement | +107 complete · -107 unknown | 1 106 |
| Provenance zones — URL source servie | 560 / 871 collections avec zone_source_url (http) · 310 stamped-null · 1 unstamped · 0 read-error | 560 / 871 collections avec zone_source_url (http) · 310 stamped-null · 1 unstamped · 0 read-error | 0 | 871 |
| Immo — assignation lot-zone | 347 / 1 100 complete · 541 incomplete · 212 unknown · 6 N/A | 347 / 1 100 complete · 541 incomplete · 212 unknown · 6 N/A | 0 | 1 100 (6 N/A explicites) |
| Immo — normes pliées | 52 / 1 100 complete · 815 incomplete · 233 unknown · 6 N/A | 52 / 1 100 complete · 815 incomplete · 233 unknown · 6 N/A | 0 | 1 100 (6 N/A explicites) |
| Immo champs — lots servis | 874 / 1 106 complete · 232 incomplete · 0 unknown · 0 N/A | 874 / 1 106 complete · 232 incomplete · 0 unknown · 0 N/A | 0 | 1 106 |
| Immo champs — surface m² | 868 / 1 100 complete · 0 incomplete · 232 unknown · 6 N/A | 868 / 1 100 complete · 0 incomplete · 232 unknown · 6 N/A | 0 | 1 100 (6 N/A explicites) |
| Immo champs — code postal | 867 / 1 100 complete · 1 incomplete · 232 unknown · 6 N/A | 867 / 1 100 complete · 1 incomplete · 232 unknown · 6 N/A | 0 | 1 100 (6 N/A explicites) |
| Immo champs — adresse civique | 22 / 1 100 complete · 846 incomplete · 232 unknown · 6 N/A | 22 / 1 100 complete · 846 incomplete · 232 unknown · 6 N/A | 0 | 1 100 (6 N/A explicites) |
| Immo champs — applicabilité TOD | 39 / 39 complete · 0 incomplete · 0 unknown · 1 067 N/A | 39 / 39 complete · 0 incomplete · 0 unknown · 1 067 N/A | 0 | 39 (1 067 N/A explicites) |
| Immo champs — complétion TOD | 4 / 39 complete · 28 incomplete · 7 unknown · 1 067 N/A | 4 / 39 complete · 28 incomplete · 7 unknown · 1 067 N/A | 0 | 39 (1 067 N/A explicites) |

## Réconciliation & notes

- L’univers est de 1 106 villes canoniques pour chaque KPI ville, sauf dénominateur N/A explicitement documenté (les N/A restent dans la partition qui ferme à 1 106).
- **Alignement présence + qualité/provenance** : le rapport mesure la PRÉSENCE (données servies) ET la QUALITÉ/PROVENANCE (URL de source servie, cohérence lot-zone) ; sans cet axe, la ré-acquisition et le stampage sont invisibles.
- **Règlement — DEUX lignes** : « complétion déclarée » (présence d’un règlement déclaré, source `regdens totals.reglement_declared` désormais committée) ET « preuve v2 » (`totals.reglement_proven`, sous-partie alignée sur une preuve de capture v2). Elles mesurent deux choses distinctes ; jamais fondues.
- Règlement — bascule du 20260803 : la ligne unique (preuve 542) est scindée en déclarée + preuve. La déclarée (895) est comparable à l’ancienne mesure déclarée 815 (progrès, PAS une régression) ; le renommage de clé réinitialise la chaîne de diff (Précédent/Δ = «—» cette fois, aucun Δ fabriqué).
- **URL source servie** : 560 / 871 collections servies portent une `zone_source_url` http réelle ; 310 sont stamped-null et 1 unstamped. Toute ré-acquisition qui n’écrit pas la source de preuve dans la même passe fait CHUTER ce KPI (dé-stampage détectable).
- **Cohérence lot-zone** : mesure RÉELLE sur 864 villes auditables (zonage ET lots servis), ville `complete` ssi `mismatch_pct < 5 %`. 30 villes sans AUCUN lot porteur de `code_zone` sont comptées `unknown`, jamais `complete` : leur taux vaut 0 par absence de donnée, pas par qualité. 242 villes non auditables (zonage ou lots non servis) sont également `unknown`. 3 ligne(s) hors univers canonique sans crédit de complétion.
- **Mismatch lot-zone à l’échelle (contexte lots, non mélangé aux KPI villes)** : 4,34 % pondéré par les lots, médiane par ville 2,58 %, p90 5,72 % — le défaut est CONCENTRÉ, pas diffus.
- **Lots sans `code_zone` (contexte lots, non mélangé aux KPI villes)** : 1 093 464 lots servis sur 3 371 939 (32,43 %) n’ont AUCUN `code_zone` — trou de jointure PLUS GROS que le mismatch lui-même, concentré sur quelques villes (montreal 669 287/680 087 ; saguenay 19 135/19 135). À traiter comme un gisement de re-fold distinct, pas comme une incohérence de géométrie.
- Normes pliées (contexte lots, non mélangé aux KPI villes) : 1 041 233 / 3 388 887 lots servis pliés (30,72 %) ; 2 347 654 manquants.
- `acceptable` de provenance n’est PAS une preuve v2. Une v2 est comptée uniquement lorsque le runner rattache le triplet de preuve à une capture et à ses octets CAS rehashés; rien n’est inféré.
- Les slugs `l-assomption`, `l-epiphanie`, `sainte-christine-d-auvergne` ne sont pas des clés villes canoniques : lignes de sources non liées, sans fusion par alias ni crédit de complétion.

## Sources locales, as-of et empreintes

- `work/coverage/completion-1-zones-normes-summary-20260723.json` — as-of `2026-07-23` — `sha256:fde3a7aab70ed4d38119935aa3e0f740af7b6b41a18bf38c60167fe578bf515f`
- `work/coverage/pv-completion-city-audit.json` — as-of `2026-06-23T18:41:02.519Z` — `sha256:0352d5ffb08309ae0516f370c29980ed93f2adbe1459c2825eccc24319a15e25`
- `work/coverage/completion-regdens-20260802.json` — as-of `règl. déclarée 2026-08-02 ; règl. preuve v2 2026-07-26T22:55:25.985Z ; usage 2026-07-20T00:11:11.869Z ; effet 2026-07-27` — `sha256:644b886c46a34456170cff25b55541c599727f7dd92923f623fbba69bbcb230e`
- `work/coverage/zone-provenance-quality-matrix-20260803T001639Z-81de8d776a7d73c9.json` — as-of `2026-08-03` — `sha256:81de8d776a7d73c91644d8f9306517f46c12adf55ed96d6a7a6d9c95f57470b4`
- `work/coverage/immo-lot-zone-assignment-matrix-20260802.json` — as-of `canonical_city_universe: 2026-06-23T18:41:02.519Z ; zero_lot_NA_crosscheck: 2026-07-19T19:07:21.413Z` — `sha256:95e5c7bc077bdf0b3087483dd99b95de6b07b3903ded0971a53ef52879da208d`
- `work/coverage/immo-folded-normes-city-matrix-20260802.json` — as-of `couverture 2026-06-23T18:41:02.519Z ; snapshot Immo 2026-07-19T19:07:21.413Z` — `sha256:e6dd636758a0d2e3bf706d78cc5c117659f5d663ba98ff3a043637da0b75ff8f`
- `work/immo-field-completion-matrices/immo-field-completion-matrix.json` — as-of `non daté dans l’artefact (entrées: coverage-matrix, immo-lots)` — `sha256:fb0f8b2df00507b167982accfbeef24e34c70f78fc1fbbf810e833c9fceb9f5c`
- `work/coverage/zone-source-readback-audit-20260802.json` — as-of `2026-08-02T18:53:17.750Z` — `sha256:182068b736a5f199ea62f7a70cabf566926ac0f55a3accd1db4cd41746fddf60`
- `work/coverage/lot-zone-consistency-scale-20260725.json` — as-of `2026-07-25T20:19:03.459Z ; listing S3 2026-07-25T19:36:07.289Z` — `sha256:36cccc45e94ee81a7736f309609d2eec03c69dcab533bb6118d7f903d68268d3`
- `work/coverage/lot-zone-consistency.json` — as-of `AUDIT` — `sha256:8c28487ec1b7f84e9e79a21673942b24e6dab756286534005619588e072419fc`
- `work/coverage/coverage-matrix.json` — as-of `2026-06-23T18:41:02.519Z` — `sha256:003b0d497c34a67e4ff495684843e63821bdd681a31199a403cd3a8bac4ce6f6`

## Validation

- 20 KPI à partition fermée (somme = partitionTotal) ; `unknown` jamais compté `complete`.
- Généré localement, sans réseau, S3, déploiement, Track ni commit. Empreintes sha256 recalculées sur les octets lus.
- Reproduction : `node scripts/portfolio-city-report.mjs` (validation stricte : `--check`).
