# Portfolio city report — 2026-08-03

Rapport **pérenne et reproductible** (généré par `scripts/portfolio-city-report.mjs`, format figé: `docs/spec/SPEC_PORTFOLIO_REPORT.md`). Déterministe, 0 réseau / S3 / déploiement / Track / commit. Unité = la ville ; `unknown` n'est jamais compté `complete` ; chaque partition ferme. Précédent/Δ = diff avec le snapshot 20260725.

| KPI villes | Précédent | Actuel | Δ | Cible |
|---|---:|---|---:|---:|
| Zones — complétion | 868 / 1 106 complete · 195 incomplete · 43 unknown · 0 N/A | 868 / 1 106 complete · 195 incomplete · 43 unknown · 0 N/A | 0 | 1 106 |
| Zones — cohérence lot-zone | 713 / 1 106 complete · 121 incomplete · 272 unknown · 0 N/A | 718 / 1 106 complete · 122 incomplete · 266 unknown · 0 N/A | +5 complete · +1 incomplete · -6 unknown | 1 106 |
| Normes — complétion | 502 / 1 106 complete · 290 incomplete · 314 unknown · 0 N/A | 501 / 1 106 complete · 290 incomplete · 315 unknown · 0 N/A | -1 complete · +1 unknown | 1 106 |
| PV — complétion | 1 062 / 1 106 complete · 1 incomplete · 41 unknown · 2 N/A | 1 062 / 1 106 complete · 1 incomplete · 41 unknown · 2 N/A | 0 | 1 106 |
| Règlement — complétion | 815 / 1 106 complete · 269 incomplete · 22 unknown · 0 N/A | unknown | — | 1 106 |
| Usage dominant — complétion | 710 / 1 106 complete · 374 incomplete · 22 unknown · 0 N/A | unknown | — | 1 106 |
| Effet densifiant — complétion | 5 / 1 106 complete · 1 079 incomplete · 22 unknown · 0 N/A | unknown | — | 1 106 |
| Provenance zones — jointure exacte | 868 / 1 106 jointures exactes · 238 sans jointure | 868 / 1 106 jointures exactes · 238 sans jointure | 0 | 1 106 |
| Provenance zones — qualité retained | 727 acceptable · 32 candidate · 109 orphan · 238 unknown | 706 acceptable · 42 v2 · 37 candidate · 82 orphan · 239 unknown | +21 complete · -22 incomplete · +1 unknown | 1 106 |
| Provenance zones — preuve v2 exacte | 0 / 1 106 v2 · toutes les lignes retained sont not-assessed | 42 / 1 106 v2 · preuve capture+CAS vérifiée uniquement | +42 complete · -42 unknown | 1 106 |
| Provenance zones — URL source servie | 538 / 871 collections avec zone_source_url (http) · 329 stamped-null · 4 unstamped · 0 read-error | 529 / 871 collections avec zone_source_url (http) · 341 stamped-null · 1 unstamped · 0 read-error | -9 complete · +12 incomplete · -3 unknown | 871 |
| Immo — assignation lot-zone | 342 / 1 100 complete · 546 incomplete · 212 unknown · 6 N/A | 347 / 1 100 complete · 541 incomplete · 212 unknown · 6 N/A | +5 complete · -5 incomplete | 1 100 (6 N/A explicites) |
| Immo — normes pliées | 52 / 1 100 complete · 816 incomplete · 232 unknown · 6 N/A | 52 / 1 100 complete · 815 incomplete · 233 unknown · 6 N/A | -1 incomplete · +1 unknown | 1 100 (6 N/A explicites) |
| Immo champs — lots servis | 874 / 1 106 complete · 232 incomplete · 0 unknown · 0 N/A | 873 / 1 106 complete · 233 incomplete · 0 unknown · 0 N/A | -1 complete · +1 incomplete | 1 106 |
| Immo champs — surface m² | 868 / 1 100 complete · 0 incomplete · 232 unknown · 6 N/A | 867 / 1 100 complete · 0 incomplete · 233 unknown · 6 N/A | -1 complete · +1 unknown | 1 100 (6 N/A explicites) |
| Immo champs — code postal | 867 / 1 100 complete · 1 incomplete · 232 unknown · 6 N/A | 866 / 1 100 complete · 1 incomplete · 233 unknown · 6 N/A | -1 complete · +1 unknown | 1 100 (6 N/A explicites) |
| Immo champs — adresse civique | 22 / 1 100 complete · 846 incomplete · 232 unknown · 6 N/A | 803 / 1 100 complete · 0 incomplete · 297 unknown · 6 N/A | +781 complete · -846 incomplete · +65 unknown | 1 100 (6 N/A explicites) |
| Immo champs — applicabilité TOD | 39 / 39 complete · 0 incomplete · 0 unknown · 1 067 N/A | 39 / 39 complete · 0 incomplete · 0 unknown · 1 067 N/A | 0 | 39 (1 067 N/A explicites) |
| Immo champs — complétion TOD | 4 / 39 complete · 28 incomplete · 7 unknown · 1 067 N/A | 4 / 39 complete · 28 incomplete · 7 unknown · 1 067 N/A | 0 | 39 (1 067 N/A explicites) |

## Réconciliation & notes

- L’univers est de 1 106 villes canoniques pour chaque KPI ville, sauf dénominateur N/A explicitement documenté (les N/A restent dans la partition qui ferme à 1 106).
- **Alignement présence + qualité/provenance** : le rapport mesure la PRÉSENCE (données servies) ET la QUALITÉ/PROVENANCE (URL de source servie, cohérence lot-zone) ; sans cet axe, la ré-acquisition et le stampage sont invisibles.
- **URL source servie** : 529 / 871 collections servies portent une `zone_source_url` http réelle ; 341 sont stamped-null et 1 unstamped. Toute ré-acquisition qui n’écrit pas la source de preuve dans la même passe fait CHUTER ce KPI (dé-stampage détectable).
- **Cohérence lot-zone** : mesure RÉELLE sur 866 villes auditables (zonage ET lots servis), ville `complete` ssi `mismatch_pct < 5 %`. 26 villes sans AUCUN lot porteur de `code_zone` sont comptées `unknown`, jamais `complete` : leur taux vaut 0 par absence de donnée, pas par qualité. 240 villes non auditables (zonage ou lots non servis) sont également `unknown`.
- **Mismatch lot-zone à l’échelle (contexte lots, non mélangé aux KPI villes)** : 4,33 % pondéré par les lots, médiane par ville 2,6 %, p90 5,69 % — le défaut est CONCENTRÉ, pas diffus.
- **Lots sans `code_zone` (contexte lots, non mélangé aux KPI villes)** : 1 062 111 lots servis sur 3 359 807 (31,61 %) n’ont AUCUN `code_zone` — trou de jointure PLUS GROS que le mismatch lui-même, concentré sur quelques villes (montreal 669 287/680 087 ; lislet 3 800/3 800). À traiter comme un gisement de re-fold distinct, pas comme une incohérence de géométrie.
- Normes pliées (contexte lots, non mélangé aux KPI villes) : 1 041 233 / 3 388 887 lots servis pliés (30,72 %) ; 2 347 654 manquants.
- `acceptable` de provenance n’est PAS une preuve v2. Une v2 est comptée uniquement lorsque le runner rattache le triplet de preuve à une capture et à ses octets CAS rehashés; rien n’est inféré.
- Les slugs `l-assomption`, `l-epiphanie`, `sainte-christine-d-auvergne` ne sont pas des clés villes canoniques : lignes de sources non liées, sans fusion par alias ni crédit de complétion.

## Sources locales, as-of et empreintes

- `work/coverage/completion-1-zones-normes-summary-20260723.json` — as-of `2026-07-23` — `sha256:fde3a7aab70ed4d38119935aa3e0f740af7b6b41a18bf38c60167fe578bf515f`
- `work/coverage/pv-completion-city-audit.json` — as-of `2026-06-23T18:41:02.519Z` — `sha256:0352d5ffb08309ae0516f370c29980ed93f2adbe1459c2825eccc24319a15e25`
- `work/coverage/completion-regdens-20260723.json` — as-of `—` — `n/a` — **ABSENTE**
- `work/coverage/zone-provenance-quality-matrix-20260726T130555Z-8c02991472f0e3a0.json` — as-of `2026-07-26` — `sha256:8c02991472f0e3a086b4423fba311577e26fa52f8adad8cd1682f9cfa493f50c`
- `work/coverage/immo-lot-zone-assignment-matrix-20260802.json` — as-of `canonical_city_universe: 2026-06-23T18:41:02.519Z ; zero_lot_NA_crosscheck: 2026-07-19T19:07:21.413Z` — `sha256:95e5c7bc077bdf0b3087483dd99b95de6b07b3903ded0971a53ef52879da208d`
- `work/coverage/immo-folded-normes-city-matrix-20260803.json` — as-of `couverture 2026-06-23T18:41:02.519Z ; snapshot Immo 2026-07-19T19:07:21.413Z` — `sha256:71cf3ab87103b362bfcd577e1ed2faf3a2902ad22892428de3ece7719ec2f308`
- `work/immo-field-completion-matrices/immo-field-completion-matrix.json` — as-of `non daté dans l’artefact (entrées: coverage-matrix, immo-lots)` — `sha256:798e4ad82942158727b083a474298f65ce278355ad98e0ae747e2c67994665ef`
- `work/coverage/zone-source-readback-audit-20260724.json` — as-of `2026-07-24T14:54:56.406Z` — `sha256:5b0205f106f174e3926f754425bb48f589f90e21c4ccad6f8dff690d3b1dfeb4`
- `work/coverage/lot-zone-consistency-scale-20260803.json` — as-of `2026-08-03T19:56:18.958Z ; listing S3 2026-08-03T19:55:55.219Z` — `sha256:5f18b360645c973262752aa878f759ea4629afc03b1a348c44325f41ac9eb035`
- `work/coverage/lot-zone-consistency.json` — as-of `AUDIT` — `sha256:8c28487ec1b7f84e9e79a21673942b24e6dab756286534005619588e072419fc`
- `work/coverage/coverage-matrix.json` — as-of `2026-06-23T18:41:02.519Z` — `sha256:003b0d497c34a67e4ff495684843e63821bdd681a31199a403cd3a8bac4ce6f6`

## Validation

- 16 KPI à partition fermée (somme = partitionTotal) ; `unknown` jamais compté `complete`.
- Généré localement, sans réseau, S3, déploiement, Track ni commit. Empreintes sha256 recalculées sur les octets lus.
- Reproduction : `node scripts/portfolio-city-report.mjs` (validation stricte : `--check`).

## Avertissements

- Source absente: work/coverage/completion-regdens-20260723.json (KPI concernés → unknown)
