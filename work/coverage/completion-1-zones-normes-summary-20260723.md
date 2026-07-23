# Completion 1 — Zones et Normes

Analyse locale déterministe au **2026-07-23**. Aucun réseau, S3, déploiement ni écriture Track.

Une ville est `complete` seulement si son statut portefeuille est `done` et si l’artefact local correspondant le corrobore; pour Normes, un `winner=error` de revalidation force `unknown`. `unknown` n’est jamais compté comme `complete`. Aucun `N-A` n’a été inféré.

## Validation

- Univers portefeuille : **1106/1106** villes, exact.
- Matrice Zones : **1106** lignes; matrice Normes : **1106** lignes.
- Toutes les lignes sont dans `complete|incomplete|unknown|N-A`; les portes `complete` sont validées.

## Résumé

| Couche | Complete | Incomplete | Unknown | N-A |
|---|---:|---:|---:|---:|
| Zones | 868 | 195 | 43 | 0 |
| Normes | 501 | 290 | 315 | 0 |

Les statuts de provenance Zones (orphan/candidate, v2 non évalué) restent des avertissements de qualité distincts de cette mesure de présence/couverture; ils ne sont jamais promus en preuve v2.

## Sources et as-of

| Source | Chemin | As-of déclaré | SHA-256 |
|---|---|---|---|
| coverage_matrix | `work/coverage/coverage-matrix.json` | 2026-06-23T18:41:02.519Z | `0e6e1a37d8f9ad45b4c1b8ff5e99bb1d7a85550c905d39ae0a666f2bff5991ca` |
| zones_provenance_manifest | `work/coverage/zone-provenance-status-manifest-20260722.json` | 2026-07-22 | `74345365b898d65ff05b08bc897f62f0c7052bd5917b7203f8afe57afce828aa` |
| normes_manifest_current | `work/zonage-norms/manifest-current.json` | {"min":"2026-06-22","max":"2026-07-07"} | `067fc474bc0a3689496722e71556670d8cf3f65a7a658e48956081bb47821c2a` |
| normes_provenance | `work/coverage/normes-provenance.json` | {"min":"2026-06-29T11:17:37.309Z","max":"2026-07-04T21:33:39.124Z"} | `6e5f8f94e52bf4132f183a189cd4e7c511030be036bc5107eb9f3014c276e3c6` |

## Écarts de source non appariés

- Zones : 3 lignes locales non appariées à l’univers portefeuille : `l-assomption`, `l-epiphanie`, `sainte-christine-d-auvergne`.
- Normes : 4 lignes locales non appariées à l’univers portefeuille : `bedford`, `hemmingford`, `valcourt`, `valcourt-normes`.

## Top 25 déficits — Zones

| État | Ville | Règle de réconciliation |
|---|---|---|
| unknown | baie-durfe | matrix_done_but_unconfirmed_by_local_served_collection |
| unknown | beaconsfield | matrix_done_but_unconfirmed_by_local_served_collection |
| unknown | beauharnois | matrix_done_but_unconfirmed_by_local_served_collection |
| unknown | beloeil | matrix_done_but_unconfirmed_by_local_served_collection |
| unknown | blainville | matrix_done_but_unconfirmed_by_local_served_collection |
| unknown | bois-des-filion | matrix_done_but_unconfirmed_by_local_served_collection |
| unknown | calixa-lavallee | matrix_done_but_unconfirmed_by_local_served_collection |
| unknown | lery | matrix_done_but_unconfirmed_by_local_served_collection |
| unknown | lile-cadieux | matrix_done_but_unconfirmed_by_local_served_collection |
| unknown | lile-dorval | matrix_done_but_unconfirmed_by_local_served_collection |
| unknown | lile-perrot | matrix_done_but_unconfirmed_by_local_served_collection |
| unknown | lorraine | matrix_done_but_unconfirmed_by_local_served_collection |
| unknown | marieville | matrix_done_but_unconfirmed_by_local_served_collection |
| unknown | mascouche | matrix_done_but_unconfirmed_by_local_served_collection |
| unknown | mcmasterville | matrix_done_but_unconfirmed_by_local_served_collection |
| unknown | mercier | matrix_done_but_unconfirmed_by_local_served_collection |
| unknown | mont-saint-gregoire | matrix_done_but_unconfirmed_by_local_served_collection |
| unknown | napierville | matrix_done_but_unconfirmed_by_local_served_collection |
| unknown | pincourt | matrix_done_but_unconfirmed_by_local_served_collection |
| unknown | pointe-calumet | matrix_done_but_unconfirmed_by_local_served_collection |
| unknown | pointe-des-cascades | matrix_done_but_unconfirmed_by_local_served_collection |
| unknown | richelieu | matrix_done_but_unconfirmed_by_local_served_collection |
| unknown | saint-blaise-sur-richelieu | matrix_done_but_unconfirmed_by_local_served_collection |
| unknown | saint-cyprien-de-napierville | matrix_done_but_unconfirmed_by_local_served_collection |
| unknown | saint-edouard | matrix_done_but_unconfirmed_by_local_served_collection |

## Top 25 déficits — Normes

| État | Ville | Règle de réconciliation |
|---|---|---|
| unknown | chelsea | local_retest_error_prevents_complete_claim |
| unknown | farnham | local_retest_error_prevents_complete_claim |
| unknown | franklin | local_retest_error_prevents_complete_claim |
| unknown | hemmingford--les-jardins-de-napierville--2 | local_retest_error_prevents_complete_claim |
| unknown | hudson | local_retest_error_prevents_complete_claim |
| unknown | kingsey-falls | local_retest_error_prevents_complete_claim |
| unknown | la-peche | local_retest_error_prevents_complete_claim |
| unknown | lac-beauport | local_retest_error_prevents_complete_claim |
| unknown | lac-des-ecorces | local_retest_error_prevents_complete_claim |
| unknown | lac-etchemin | local_retest_error_prevents_complete_claim |
| unknown | lac-sainte-marie | local_retest_error_prevents_complete_claim |
| unknown | lacolle | local_retest_error_prevents_complete_claim |
| unknown | lange-gardien--la-cote-de-beaupre | local_retest_error_prevents_complete_claim |
| unknown | lange-gardien--les-collines-de-loutaouais | local_retest_error_prevents_complete_claim |
| unknown | lisle-aux-coudres | local_retest_error_prevents_complete_claim |
| unknown | mont-laurier | local_retest_error_prevents_complete_claim |
| unknown | mont-saint-hilaire | local_retest_error_prevents_complete_claim |
| unknown | mont-saint-michel | local_retest_error_prevents_complete_claim |
| unknown | nominingue | local_retest_error_prevents_complete_claim |
| unknown | notre-dame-de-lourdes--joliette | local_retest_error_prevents_complete_claim |
| unknown | notre-dame-du-sacre-coeur-dissoudun | local_retest_error_prevents_complete_claim |
| unknown | orford | local_retest_error_prevents_complete_claim |
| unknown | potton | local_retest_error_prevents_complete_claim |
| unknown | preissac | local_retest_error_prevents_complete_claim |
| unknown | prevost | local_retest_error_prevents_complete_claim |
