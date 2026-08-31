# Portfolio city report — 2026-08-30

Rapport **pérenne et reproductible** (généré par `scripts/portfolio-city-report.mjs`, format figé: `docs/spec/SPEC_PORTFOLIO_REPORT.md`). Déterministe, 0 réseau / S3 / déploiement / Track / commit. Unité = la ville ; `unknown` n'est jamais compté `complete` ; chaque partition ferme. Précédent/Δ = diff avec le snapshot 20260810.

| KPI villes | Précédent | Actuel | Δ | Cible |
|---|---:|---|---:|---:|
| Zones — complétion | 868 / 1 106 complete · 195 incomplete · 43 unknown · 0 N/A | 868 / 1 104 complete · 193 incomplete · 43 unknown · 2 N/A | -2 incomplete · +2 N/A | 1 104 (2 N/A explicites) |
| Zones — cohérence lot-zone | 718 / 1 106 complete · 123 incomplete · 265 unknown · 0 N/A | 817 / 1 106 complete · 28 incomplete · 261 unknown · 0 N/A | +99 complete · -95 incomplete · -4 unknown | 1 106 |
| Normes — complétion | 501 / 1 106 complete · 290 incomplete · 315 unknown · 0 N/A | 501 / 1 106 complete · 290 incomplete · 315 unknown · 0 N/A | 0 | 1 106 |
| PV — complétion | 1 062 / 1 106 complete · 1 incomplete · 41 unknown · 2 N/A | 1 062 / 1 106 complete · 1 incomplete · 41 unknown · 2 N/A | 0 | 1 106 |
| Règlement — complétion déclarée | 895 / 1 106 complete · 46 incomplete · 165 unknown · 0 N/A | 895 / 1 106 complete · 46 incomplete · 165 unknown · 0 N/A | 0 | 1 106 |
| Règlement — preuve v2 | 541 / 1 106 complete · 68 incomplete · 497 unknown · 0 N/A | 541 / 1 106 complete · 68 incomplete · 497 unknown · 0 N/A | 0 | 1 106 |
| Usage dominant — complétion | 710 / 1 106 complete · 179 incomplete · 217 unknown · 0 N/A | 710 / 1 106 complete · 179 incomplete · 217 unknown · 0 N/A | 0 | 1 106 |
| Effet densifiant — complétion | 7 / 1 106 complete · 96 incomplete · 1 003 unknown · 0 N/A | 7 / 1 106 complete · 96 incomplete · 1 003 unknown · 0 N/A | 0 | 1 106 |
| Provenance zones — jointure exacte | 870 / 1 106 jointures exactes · 236 sans jointure | 870 / 1 106 jointures exactes · 236 sans jointure | 0 | 1 106 |
| Provenance zones — qualité retained | 584 acceptable · 168 v2 · 43 candidate · 74 orphan · 237 unknown | 584 acceptable · 168 v2 · 43 candidate · 74 orphan · 237 unknown | 0 | 1 106 |
| Provenance zones — preuve v2 exacte | 168 / 1 106 v2 · preuve capture+CAS vérifiée uniquement | 168 / 1 106 v2 · preuve capture+CAS vérifiée uniquement | 0 | 1 106 |
| Provenance zones — URL source servie | 47 / 167 collections avec zone_source_url (http) · 62 stamped-null · 1 unstamped · 57 read-error | 47 / 167 collections avec zone_source_url (http) · 62 stamped-null · 1 unstamped · 57 read-error | 0 | 167 |
| Immo — assignation lot-zone | 347 / 1 100 complete · 543 incomplete · 210 unknown · 6 N/A | 347 / 1 100 complete · 543 incomplete · 210 unknown · 6 N/A | 0 | 1 100 (6 N/A explicites) |
| Immo — normes pliées | 52 / 1 100 complete · 815 incomplete · 233 unknown · 6 N/A | 52 / 1 100 complete · 815 incomplete · 233 unknown · 6 N/A | 0 | 1 100 (6 N/A explicites) |
| Immo champs — lots servis | 873 / 1 106 complete · 233 incomplete · 0 unknown · 0 N/A | 873 / 1 106 complete · 233 incomplete · 0 unknown · 0 N/A | 0 | 1 106 |
| Immo champs — surface m² | 867 / 1 100 complete · 0 incomplete · 233 unknown · 6 N/A | 867 / 1 100 complete · 0 incomplete · 233 unknown · 6 N/A | 0 | 1 100 (6 N/A explicites) |
| Immo champs — code postal | 866 / 1 100 complete · 1 incomplete · 233 unknown · 6 N/A | 866 / 1 100 complete · 1 incomplete · 233 unknown · 6 N/A | 0 | 1 100 (6 N/A explicites) |
| Immo champs — adresse civique | 803 / 1 100 complete · 0 incomplete · 297 unknown · 6 N/A | 803 / 1 100 complete · 0 incomplete · 297 unknown · 6 N/A | 0 | 1 100 (6 N/A explicites) |
| Immo champs — applicabilité TOD | 39 / 39 complete · 0 incomplete · 0 unknown · 1 067 N/A | 39 / 39 complete · 0 incomplete · 0 unknown · 1 067 N/A | 0 | 39 (1 067 N/A explicites) |
| Immo champs — complétion TOD | 4 / 39 complete · 28 incomplete · 7 unknown · 1 067 N/A | 4 / 39 complete · 28 incomplete · 7 unknown · 1 067 N/A | 0 | 39 (1 067 N/A explicites) |

## Réconciliation & notes

- L’univers est de 1 106 villes canoniques pour chaque KPI ville, sauf dénominateur N/A explicitement documenté (les N/A restent dans la partition qui ferme à 1 106).
- **Zones — N/A un-zonable prouvé** : 2 municipalité(s) à désignation autoritative MAMH non-municipale-locale comptée(s) N/A dans le KPI Zones — caniapiscau (Territoire non organisé) ; eeyou-istchee-james-bay (Gouvernement régional). Source = attestation d’absence committée (`work/coverage/zones-unzonable-absence-attestation-20260830.json`, N-A-PROVEN sur preuve positive TNO / Gouvernement régional), pas devinée. Reclassification ADDITIVE et partition fermée (dénominateur 1 106 − N/A) ; chaque municipalité est retirée du seul bucket de base qu’elle occupait (état lu dans la matrice zones per-muni, non inféré) ; `unknown` reste jamais compté `complete`.
- **Alignement présence + qualité/provenance** : le rapport mesure la PRÉSENCE (données servies) ET la QUALITÉ/PROVENANCE (URL de source servie, cohérence lot-zone) ; sans cet axe, la ré-acquisition et le stampage sont invisibles.
- **Règlement — DEUX lignes** : « complétion déclarée » (présence d’un règlement déclaré, source `regdens totals.reglement_declared` désormais committée) ET « preuve v2 » (`totals.reglement_proven`, sous-partie alignée sur une preuve de capture v2). Elles mesurent deux choses distinctes ; jamais fondues.
- **URL source servie** : 47 / 167 collections servies portent une `zone_source_url` http réelle ; 62 sont stamped-null et 1 unstamped. Toute ré-acquisition qui n’écrit pas la source de preuve dans la même passe fait CHUTER ce KPI (dé-stampage détectable).
- **Cohérence lot-zone** : mesure RÉELLE sur 866 villes auditables (zonage ET lots servis), ville `complete` ssi `mismatch_pct < 5 %`. 21 villes sans AUCUN lot porteur de `code_zone` sont comptées `unknown`, jamais `complete` : leur taux vaut 0 par absence de donnée, pas par qualité. 240 villes non auditables (zonage ou lots non servis) sont également `unknown`.
- **Mismatch lot-zone à l’échelle (contexte lots, non mélangé aux KPI villes)** : 1,88 % pondéré par les lots, médiane par ville 1,18 %, p90 2,64 % — le défaut est CONCENTRÉ, pas diffus.
- **Lots sans `code_zone` (contexte lots, non mélangé aux KPI villes)** : 1 052 985 lots servis sur 3 359 807 (31,34 %) n’ont AUCUN `code_zone` — trou de jointure PLUS GROS que le mismatch lui-même, concentré sur quelques villes (montreal 669 287/680 087 ; lislet 3 800/3 800). À traiter comme un gisement de re-fold distinct, pas comme une incohérence de géométrie.
- Normes pliées (contexte lots, non mélangé aux KPI villes) : 1 041 233 / 3 388 887 lots servis pliés (30,72 %) ; 2 347 654 manquants.
- `acceptable` de provenance n’est PAS une preuve v2. Une v2 est comptée uniquement lorsque le runner rattache le triplet de preuve à une capture et à ses octets CAS rehashés; rien n’est inféré.
- Les slugs `l-assomption`, `l-epiphanie`, `sainte-christine-d-auvergne` ne sont pas des clés villes canoniques : lignes de sources non liées, sans fusion par alias ni crédit de complétion.

## Sources locales, as-of et empreintes

- `work/coverage/completion-1-zones-normes-summary-20260723.json` — as-of `2026-07-23` — `sha256:fde3a7aab70ed4d38119935aa3e0f740af7b6b41a18bf38c60167fe578bf515f`
- `work/coverage/completion-1-zones-matrix-20260723.json` — as-of `2026-07-23` — `sha256:518e7a7eb1b1626045fd5dc1b9ae0ac23745678752f82ef2e893901ec3488f22`
- `work/coverage/pv-completion-city-audit.json` — as-of `2026-06-23T18:41:02.519Z` — `sha256:0352d5ffb08309ae0516f370c29980ed93f2adbe1459c2825eccc24319a15e25`
- `work/coverage/completion-regdens-20260808.json` — as-of `règl. déclarée 2026-08-02 ; règl. preuve v2 2026-08-07T15:37:55.516Z ; usage 2026-07-20T00:11:11.869Z ; effet 2026-07-27` — `sha256:1e2ad84f68d6a36d5f670490afc9186ff15ca882d0240618e091b22e438054bb`
- `work/coverage/zone-provenance-quality-matrix-20260810T013417Z-ad1126284740439d.json` — as-of `2026-08-10` — `sha256:ad1126284740439db1b5fa36cca1ba01985fefc18d4dea657655f306ea241969`
- `work/coverage/immo-lot-zone-assignment-matrix-20260810.json` — as-of `canonical_city_universe: 2026-08-10T08:21:11.844Z ; zero_lot_NA_crosscheck: 2026-07-19T19:07:21.413Z` — `sha256:cf6205967b3961b42bf1ea6864f9f16d269e6f469ba7bc33b2a002dc46159a10`
- `work/coverage/immo-folded-normes-city-matrix-20260810.json` — as-of `couverture 2026-08-10T01:56:41.264Z ; snapshot Immo 2026-07-19T19:07:21.413Z` — `sha256:51c8e67f8b335c88650595792b1ca9088c81a1a0e6794eee485b8cf3e737dd54`
- `work/immo-field-completion-matrices/immo-field-completion-matrix.json` — as-of `non daté dans l’artefact (entrées: coverage-matrix, immo-lots)` — `sha256:798e4ad82942158727b083a474298f65ce278355ad98e0ae747e2c67994665ef`
- `work/coverage/zone-source-readback-audit-20260810.json` — as-of `2026-08-10T01:35:03.601Z` — `sha256:68799d0696c7e9ad222567ccb2f17b220c80f55465d0bd1c114b6d09d023780e`
- `work/coverage/lot-zone-consistency-scale-20260824.json` — as-of `2026-08-24T02:30:36.116Z ; listing S3 2026-08-24T02:08:28.089Z` — `sha256:8391c1411903b5ca53d4bc1fff6adae717d4e139dc7f647f169788f27929a620`
- `work/coverage/lot-zone-consistency.json` — as-of `AUDIT` — `sha256:8c28487ec1b7f84e9e79a21673942b24e6dab756286534005619588e072419fc`
- `work/coverage/zones-unzonable-absence-attestation-20260830.json` — as-of `2026-08-30T23:52:19.215Z` — `sha256:c82efce7eeaffc0bf78f4dc660dcc684b47304d553f0b548e84da0b3fd7c87ce`
- `work/coverage/coverage-matrix.json` — as-of `2026-08-10T08:36:28.730Z` — `sha256:e886e452ca106d1c2b3e6d9558d0943d42257fecb0a118261fe7848d2a6e999e`

## Validation

- 20 KPI à partition fermée (somme = partitionTotal) ; `unknown` jamais compté `complete`.
- Généré localement, sans réseau, S3, déploiement, Track ni commit. Empreintes sha256 recalculées sur les octets lus.
- Reproduction : `node scripts/portfolio-city-report.mjs` (validation stricte : `--check`).
