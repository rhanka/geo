# Validation geo-independante — superset ≥prod, 3 villes

Généré le : 2026-08-02T17:24:44.656Z

Cette validation prouve, côté geo et sans credentials, que l’objet ≥prod de recette contient tous les nœuds prod-PG et les 15 ids cibles : 0 nœud prod perdu.

Le fait que l’ancien objet S3 (24/24/23) soit un sous-ensemble de prod (S3-only=0) est l’attestation de lecture-S3 de recette; geo n’a pas les credentials du bucket `radar-immobilier-docs-pocs` et ne le re-vérifie donc pas ici. Le PUT lui-même revient à immo (décision frontière v3.4).

## Résultats bruts

### saint-urbain-premier — FAIL

- node_count(latest) : 47; node_count(subgraph) : 47; attendu : 47
- |subgraph_only| : 0
- edge_count(latest) : 52; attendu : 52
- ids cibles présents (0/5) : (aucun)
- ids cibles absents (5/5) : rezonage-R4-H2-2026-03-30, piia-12-terrasse-vincent-2026-03-09, piia-213-215-principale-2026, densification-R4-bifamiliale-2026, piia-243a-principale-2026-05-04
- raisons d’échec : target ids absent (5/5): rezonage-R4-H2-2026-03-30, piia-12-terrasse-vincent-2026-03-09, piia-213-215-principale-2026, densification-R4-bifamiliale-2026, piia-243a-principale-2026-05-04

### saint-jean-baptiste — FAIL

- node_count(latest) : 50; node_count(subgraph) : 50; attendu : 50
- |subgraph_only| : 0
- edge_count(latest) : 47; attendu : 47
- ids cibles présents (0/5) : (aucun)
- ids cibles absents (5/5) : rezonage-R2-multifamilial-2026-05-05, modif-lotissement-R2-2026-05-05, cptaq-1006-26-2026-05-05, derogation-DPDRL260017-2026-04-07, piia-projet-integre-2026-02
- raisons d’échec : target ids absent (5/5): rezonage-R2-multifamilial-2026-05-05, modif-lotissement-R2-2026-05-05, cptaq-1006-26-2026-05-05, derogation-DPDRL260017-2026-04-07, piia-projet-integre-2026-02

### saint-mathieu — FAIL

- node_count(latest) : 40; node_count(subgraph) : 40; attendu : 40
- |subgraph_only| : 0
- edge_count(latest) : 51; attendu : 51
- ids cibles présents (0/5) : (aucun)
- ids cibles absents (5/5) : derogation-2025-00034, derogation-2026-00001, lotissement-2427246, modification-zonage-315-2024-01, derogation-mineure-lotissement
- raisons d’échec : target ids absent (5/5): derogation-2025-00034, derogation-2026-00001, lotissement-2427246, modification-zonage-315-2024-01, derogation-mineure-lotissement

## Verdict global : FAIL
