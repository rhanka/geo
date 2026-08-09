# Triage des échecs d'extraction PV

Rapports batch committés lus: 326. Les clés CAS sont présentes dans `documents[].storage_key`; 60 échecs n'ont pas d'offset individuel reconstruisible après skips, donc le tableau groupe l'offset de sélection porté par chaque rapport.

## Recensement

| Offsets de sélection | Issues d'échec |
| --- | ---: |
| 0-99 | 14 |
| 100-199 | 8 |
| 200-299 | 50 |
| 300-399 | 5 |
| 600-699 | 1 |
| 800-899 | 1 |
| 900-999 | 21 |
| 1000-1099 | 86 |
| 1500-1599 | 8 |

## Échantillon fermé de 30

| Cause | N | Exemple CAS / premiers octets / constat |
| --- | ---: | --- |
| a_pdf_sans_couche_texte_scan_pur | 30 | `raw/pv-index/cas/080a27bab62f2769a8835eee23e2b7416e4c19df9ff311de021111a86a926858.pdf`; `255044462d312e370d25e2e3cfd30d0a372030206f626a0d3c3c2f4c696e6561`; pdfinfo lit le PDF; pdftotext retourne zéro texte; pdffonts ne trouve aucune police et pdfimages trouve des images. |
| b_pdf_chiffre_ou_protege | 0 | — |
| c_contenu_non_pdf | 0 | — |
| d_pdf_valide_extracteur_en_echec | 0 | — |
| e_fichier_tronque_ou_octets_manquants | 0 | — |
| f_autre | 0 | — |

## Limite et arbitrage OCR

30/30 échantillons sont des scans purs démontrés; ceci ne classe pas par extrapolation les 186 CAS uniques. 194 issues d'échec, soit 186 CAS uniques, portent explicitement «pas de couche texte» dans le rapport source: c'est le périmètre candidat OCR, pas une preuve octet par octet hors échantillon. OCR n'a pas été lancé. Le tarif documenté est 0,001 USD/page; aucun total USD n'est calculé sans dénombrement complet des pages, pour ne pas estimer. Aucun PDF valide en échec d'extracteur dans l'échantillon: le défaut n'est pas démontré chez nous.
