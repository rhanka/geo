# Recalage PDF → zones — shard 0/1 — lot 2026-07-18T00:19:12Z

## Dépôt confirmé

| slug | source officielle | voie | gates mesurés | résultat |
|---|---|---|---|---|
| `saint-casimir` | https://www.saint-casimir.com/file-23022 (`200 application/pdf`, `reglement_zonage_st-casimir_refondu_04-2025.pdf`) ; Annexe II, plan feuille 1/2, p. 344 du règlement local | T3 raster : chamfer puis 48 GCP cadastraux indépendants ; libellés glyphes contraints par le dict des codes `A-1`…`A-16` lus verbatim sur le plan | seed 0,336 m / 99,88 % inliers, puis résidu max **22,009 m**, holdout max **14,512 m** ; 16/16 codes exacts, 16/16 in-bbox, distance spatiale 0,308 km ; 1 585/1 672 lots (**94,8 %**) | **SERVI** : `normalized/ca-qc-zonage/qc-zonage-saint-casimir.geojson`, 16 codes de zones agricoles réelles du feuillet 1. `lot-zone-join-run` vérifié (1 672 lignes, 94,8 %) puis `lots-enriched-run` redéposé (zone_code 94,8 %, surface 100 %, RTA 100 %, adresse 88,58 %). |

Le plan de la feuille 2 est un agrandissement du noyau urbain ; il n'a pas été fusionné sans son propre recalage indépendant. Le dépôt actuel garde donc uniquement les codes du feuillet 1 que le gate a pu prouver.

## Entrées rejetées / sans plan recalable

| slug | entrée vérifiée | preuve | verdict |
|---|---|---|---|
| `cap-chat` | Règlement 068-2006 (308 p.) et cartes officielles locales | aucune planche de zonage dans le règlement ; `cap-chat-carte-anse.pdf` et `cap-chat-carte-cap-chat.pdf` sont explicitement des **zones de contraintes relatives à l’érosion côtière** | **REJET** : affectation/contrainte, jamais code de zone réglementaire. |
| `saint-jean-port-joli` | règlement local 139 p. | les pages annexes à faible texte ne sont pas un plan de zonage ; p. 125 = fiche technique « Boutures » de protection des rives | **REJET** : aucun plan de zonage municipal dans le PDF fourni. |
| `saint-paul-de-lile-aux-noix` | règlement 231-2006, 174 p. | texte/grilles, p. 174 blanche ; aucune annexe-cartographie de zonage | **REJET** : aucune géométrie de plan. |
| `saint-felix-dotis` | règlement 268-2015, 384 p. | p. 384 est l'index « Annexe D : Plans de zonage » des amendements, pas une planche ; aucun feuillet cartographique joint | **REJET** : pas de plan à géoréférencer. |
| `saint-gedeon` | règlement 2018-464, 327 p. | le document se termine à la page d'ouverture « ANNEXES » p. 327 ; aucun plan n'est joint | **REJET** : annexe-cartographie absente. |
| `saint-henri-de-taillon` | règlement local, 197 p. | p. 194 (et 196) est vide ; les annexes présentes sont terminologie, géotechnique, éoliennes et distances, non un zonage | **REJET** : aucune planche de zonage. |
| `saint-omer` | `work/zonage-plans/saint-omer.pdf`, 304 p. | le document se désigne « Ville de Carleton-sur-Mer » (Annexe A, p. 280) | **REJET spatial** : mauvais municipalité, donc inutilisable pour Saint-Omer. |

## Artefacts

- GCP et rapports : `work/gcp/saint-casimir-p344.{autogcp, chamfer, t3}.report.json` et `work/gcp/saint-casimir-p344.t3.gcp.json`.
- Dictionnaire et lectures contraints : `work/gcp/saint-casimir-p344-a-zones.dict.json`, `work/gcp/saint-casimir-p344.claude-reads.json`.
- Aucun owner harvest AGOL ; aucun code séquentiel, postal ou d'affectation n'est publié.
