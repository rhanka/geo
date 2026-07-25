# Zones recalage shard 1/2

Regle: slugs dont index trie % 2 == 1. Anti-invention: aucun slug servi sans gate; pas d AGOL owner harvest.

Depots nets: 1 (`entrelacs`).

| slug | statut | methode | preuve |
|---|---:|---|---|
| alma | echec | T1 puis T2 | T1 sans /VP /Measure /GEO; T2 auto-GCP stop ERR_STRING_TOO_LONG pendant extractSvgVectorPoints. |
| austin | echec | T1 Claude glyph | GeoPDF residual 0.16 m; 125/125 lectures Claude dict-validees; blocage cadastre S3 NoSuchKey normalized/qc-cadastre-lots/austin.geojson. |
| baie-johan-beetz | echec | T2 auto-GCP | no (extent × rotation) seed cleared the residual+holdout gate |
| begin | echec | T2 auto-GCP | no (extent × rotation) seed cleared the residual+holdout gate |
| boileau | echec | T2 auto-GCP | no (extent × rotation) seed cleared the residual+holdout gate |
| bois-franc | echec | T2 auto-GCP | no (extent × rotation) seed cleared the residual+holdout gate |
| cacouna | echec | T1 | work/pdf-cache/cacouna.pdf est ASCII text, pas un PDF exploitable; T1 refuse le georef. |
| cap-chat | echec | T1 GeoPDF glyph | Deux GeoPDF passent georef (residual 2.96 m et 1.09 m) mais pdftotext donne 0 code; crop rendue sans codes lisibles, aucune lecture positionnee disponible. |
| east-farnham | echec | T2 auto-GCP | no (extent × rotation) seed cleared the residual+holdout gate |
| entrelacs | depot | T2 auto-GCP + text | GCP 11 independants, residual max 0.986 m, holdout 1.245 m, 43 codes, 34 features, lots 85.45%; lot-zone join et lots-enriched OK. |
| gaspe | echec | T1 puis rapports T2 | 13 seed(s) cleared the residual+holdout gate but none cleared the orientation/isotropy gate (anisotropy/mirror/north-up) |
| massueville | echec | T1 puis T2 | no (extent × rotation) seed cleared the residual+holdout gate |
| ange-gardien | echec | T2 retry disambig | best candidate full/rot0° serving coverage 42.89% < floor 85% — anisotropy NOT confirmed real (labels do not land on lots) → SKIP |
| saints-martyrs-canadiens | echec | T2 retry aniso | best candidate density+10%/rot0° serving coverage 1.22% < floor 85% — anisotropy NOT confirmed real (labels do not land on lots) → SKIP |
