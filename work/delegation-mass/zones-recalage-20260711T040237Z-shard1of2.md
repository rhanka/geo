# Recalage PDF zones — shard 1/2 — 2026-07-11T04:02:37.532Z

Règle: slugs dont `(index dans la liste triée) % 2 == 1`. Aucun AGOL owner harvest. Aucun code inventé.

Résultat consolidé: **2 dépôts nets dans cette passe**, 141 slugs avec dépôt ou preuve, 0 fallback(s) sans preuve structurée.

## Dépôts nets

- **saint-david-de-falardeau** — résidu 0,156 m; 130 codes distincts double-attestés; 26 annotations rejetées; spatial 2,024 km; 61 features; 1786/1786 lots; surface 100%; dépôt S3 + lot-zone join + lots-enriched OK — source: https://www.villefalardeau.ca/_files/ugd/3d921f_1339654cb0054f56b76484f4381b5795.pdf
- **sainte-julienne** — résidu 0 m; pages 1+2 fusionnées; 106 codes double-attestés; 3 annotations rejetées; spatial 0,185 km; 97 features; 8246/8247 lots (99,99%); surface 99,84%; dépôt S3 + lot-zone join + lots-enriched OK — source: https://www.sainte-julienne.com/storage/app/media/municipalite/administration/procedures-et-reglements/2312-177_Zonage_HPU_20251009.pdf

## Tous les slugs du shard

| index | slug | statut | méthode | preuve |
|---:|---|---|---|---|
| 3 | aguanish | echec | preuve rapport antérieur | official site/reglements pages expose only administrative/confidentiality PDFs; no zoning plan PDF found |
| 11 | ange-gardien | echec | T2 retry disambig | best candidate full/rot0° serving coverage 42.89% < floor 85% — anisotropy NOT confirmed real (labels do not land on lots) → SKIP |
| 19 | austin | echec | T1 Claude glyph | GeoPDF residual 0.16 m; 125/125 lectures Claude dict-validees; blocage cadastre S3 NoSuchKey normalized/qc-cadastre-lots/austin.geojson. |
| 27 | baie-johan-beetz | echec | T2 auto-GCP | no (extent × rotation) seed cleared the residual+holdout gate |
| 45 | begin | echec | T2 auto-GCP | no (extent × rotation) seed cleared the residual+holdout gate |
| 55 | blanc-sablon | echec | preuve rapport antérieur | official regulation pages expose annual/contractual PDFs; no zoning/urbanism/plan PDF found |
| 57 | boileau | echec | preuve rapport antérieur | INTROUVABLE |
| 59 | bois-franc | echec | T2 auto-GCP | no (extent × rotation) seed cleared the residual+holdout gate |
| 65 | bonne-esperance | echec | preuve rapport antérieur | MAMH directory has no website; local prior reports show no-url / AGOL 0 items / pdf-discovery-required |
| 69 | bowman | echec | preuve rapport antérieur | published zoning by-law is a text PDF; T1 no georef; T2 auto-GCP svg_points=0 |
| 73 | brome | echec | preuve rapport antérieur | NO-PDF |
| 77 | bryson | echec | preuve rapport antérieur | Municipal directory returned no website; no local official zoning PDF found. |
| 79 | cacouna | echec | T1 | work/pdf-cache/cacouna.pdf est ASCII text, pas un PDF exploitable; T1 refuse le georef. |
| 81 | campbells-bay | echec | preuve rapport antérieur | Official EN/FR regulation pages expose fiscal, ethics, septic, fire-station, health-alert, or general bylaw PDFs only. |
| 83 | caniapiscau | echec | preuve rapport antérieur | Municipal directory returned no website; no local official zoning PDF found. |
| 85 | cap-chat | echec | T1 GeoPDF glyph | Deux GeoPDF passent georef (residual 2.96 m et 1.09 m) mais pdftotext donne 0 code; crop rendue sans codes lisibles, aucune lecture positionnee disponible. |
| 93 | cayamant | echec | preuve rapport antérieur | Official regulations page lists municipal bylaws, including CCU/demolition, but no zoning plan or zoning regulation PDF. |
| 95 | chambord | echec | preuve rapport antérieur | Official zoning PDFs found are amendments with text/grids only; no full zoning plan PDF. |
| 99 | chapais | echec | preuve rapport antérieur | Official regulations page fetched; extracted links had no zoning/plan PDF. |
| 111 | chichester | echec | preuve rapport antérieur | Official Pontiac Ouest regulation page has no zoning/plan PDF links. |
| 115 | clarendon | echec | preuve rapport antérieur | Official EN/FR bylaw pages have no zoning/plan PDF. |
| 135 | deleage | echec | preuve rapport antérieur | Official zoning PDF is text bylaw only and not GeoPDF; official zoning map is JPG with no coordinate grid or verified seed GCP, so no controls were invented. |
| 145 | dolbeau-mistassini | echec | preuve rapport antérieur | svg_points=0; no seed |
| 161 | east-farnham | echec | preuve rapport antérieur | NO-PDF |
| 163 | eastman | echec | preuve rapport antérieur | T1 no embedded georef; T2 auto-seed exceeded per-slug time budget without producing GCP |
| 165 | egan-sud | echec | preuve rapport antérieur | svg_points=0; no seed |
| 173 | ferland-et-boilleau | echec | preuve rapport antérieur | official host did not resolve for tested urbanisme pages |
| 187 | gaspe | echec | T1 puis rapports T2 | 13 seed(s) cleared the residual+holdout gate but none cleared the orientation/isotropy gate (anisotropy/mirror/north-up) |
| 193 | gracefield | echec | preuve rapport antérieur | svg_points=0; no seed |
| 199 | grande-vallee | echec | preuve rapport antérieur | TLS hostname mismatch on official host for tested urbanisme pages; no TLS bypass used |
| 203 | gros-mecatina | echec | preuve rapport antérieur | official page read, no exploitable zoning plan PDF link |
| 209 | hampden | echec | preuve rapport antérieur | svg_points=0; no seed |
| 217 | hebertville-station | echec | preuve rapport antérieur | MAMH has no website; local PDF is for Hebertville and is a regulation, not a plan |
| 225 | hope-town | echec | preuve rapport antérieur | official host did not resolve for tested urbanisme pages |
| 235 | kazabazua | echec | preuve rapport antérieur | T1 no embedded georef; both T2 plans rejected by orientation/isotropy gate |
| 245 | la-dore | echec | preuve rapport antérieur | official documentation page read; no separate recalable zoning plan PDF found in visible links |
| 263 | la-tuque | echec | preuve rapport antérieur | official pages expose document categories but no directly visible recalable zoning plan PDF in links read |
| 267 | labrecque | echec | preuve rapport antérieur | T1 no embedded georef; T2 territory rejected by 180 degree orientation ambiguity; T2 urban perimeter rejected by orientation/isotropy |
| 269 | lac-aux-sables | echec | preuve rapport antérieur | T1 no embedded georef; existing T2 report has svg_points=0 and no attempts |
| 271 | lac-bouchette | echec | preuve rapport antérieur | official host timed out on bounded https and http homepage fetches |
| 289 | lac-sergent | echec | preuve rapport antérieur | T1 no embedded georef; T2 rejected by 179.7 degree orientation ambiguity |
| 291 | lac-superieur | echec | preuve rapport antérieur | ABORT |
| 295 | laforce | echec | preuve rapport antérieur | MAMH directory has no website and no local official zoning plan PDF found |
| 303 | lanse-saint-jean | echec | preuve rapport antérieur | official pages read, no exploitable zoning plan PDF link |
| 305 | larouche | echec | preuve rapport antérieur | official pages expose zoning regulation and forms; local PDF is regulation text, not recalable plan; T1 no embedded georef |
| 307 | lascension-de-notre-seigneur | echec | preuve rapport antérieur | bounded https and http fetches produced empty files; no zoning plan PDF recovered |
| 313 | laurierville | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (19 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 319 | lebel-sur-quevillon | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (2 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 327 | les-cedres | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (4 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 333 | les-mechins | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (2 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 341 | lisle-aux-allumettes | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (3 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 343 | lisle-verte | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (3 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 345 | litchfield | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (2 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 347 | lochaber-partie-ouest | echec | preuve rapport antérieur | T1 georef residual 0.16 m but text labels produced 0 code-like labels; glyph path needs authoritative dict |
| 349 | longue-rive | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (2 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 373 | massueville | echec | preuve rapport antérieur | ABORT-RASTER |
| 375 | matane | echec | T1 puis T2 auto-GCP page 2 | T1 sans géoréf embarqué; T2: 13 fits passent résidu/holdout (jusqu'à 45 GCP, résidu min 10,358 m), mais rotation ambiguë; couverture tight 0%, serving max 1,89%, aniso serving 0,26% < 85%, seulement 2 codes → SKIP |
| 377 | mayo | echec | preuve rapport antérieur | T1 no embedded georef; existing T2 affine/similarity reports no seed cleared residual/holdout |
| 381 | messines | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (3 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 399 | montcerf-lytton | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (2 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 417 | newport | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (2 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 425 | notre-dame-de-ham | echec | preuve rapport antérieur | T1 no embedded georef; existing T2 report no seed cleared residual/holdout |
| 433 | notre-dame-de-montauban | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (5 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 453 | ogden | echec | T1 GeoPDF Claude dict-validé | géoréf résiduel 0,18 m et 48/48 lectures validées, mais gate spatial échoue: centroïde labels à 17,01 km du cadastre (>8 km) → ABORT sans dépôt |
| 457 | otter-lake | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (2 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 467 | petit-saguenay | echec | preuve rapport antérieur | T1 no embedded georef; T2 SVG extraction failed with ERR_STRING_TOO_LONG |
| 469 | petite-vallee | echec | sondage borné du site officiel MAMH | 0 pages candidates contrôlées (0 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 487 | port-cartier | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (7 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 489 | portage-du-fort | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (2 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 491 | portneuf-sur-mer | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (0 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 519 | riviere-heva | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (2 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 523 | roberval | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (2 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 531 | sacre-coeur | echec | classification T1/T2 | deux plans officiels vector-glyph (512/457 chemins), zéro code texte; registre de normes absent, donc aucun dictionnaire autoritaire pour la voie Claude dict-validée; aucun dépôt |
| 533 | saguenay | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (3 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 535 | saint-adelme | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (0 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 551 | saint-alexis-des-monts | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (8 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 555 | saint-alphonse-rodriguez | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (0 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 557 | saint-ambroise | echec | classification T3 | deux plans officiels raster-scan (une grande image chacun, 0 chemin vectoriel); t2-raster-register exige un seed GCP grossier local absent; aucun recalage démontrable sans fabriquer de contrôles |
| 573 | saint-arsene | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (2 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 575 | saint-aubert | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (2 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 577 | saint-augustin--maria-chapdelaine | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (0 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 593 | saint-boniface | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (19 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 601 | saint-casimir | echec | preuve rapport antérieur | INTROUVABLE-PDF |
| 607 | saint-charles-de-bourget | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (2 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 613 | saint-clement | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (2 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 623 | saint-cyprien--riviere-du-loup | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (3 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 629 | saint-damase-de-lislet | echec | preuve rapport antérieur | T1 no embedded georef on both plans; existing T2 reports rejected |
| 633 | saint-david-de-falardeau | depot | T1 GeoPDF texte + dictionnaire grille×plans | résidu 0,156 m; 130 codes distincts double-attestés; 26 annotations rejetées; spatial 2,024 km; 61 features; 1786/1786 lots; surface 100%; dépôt S3 + lot-zone join + lots-enriched OK |
| 647 | saint-edouard-de-maskinonge | echec | preuve rapport antérieur | ABORT-OTHER |
| 657 | saint-esprit | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (3 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 663 | saint-eugene-de-guigues | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (0 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 673 | saint-felix-dotis | echec | sondage officiel | liens trouvés: cahier des spécifications, règlement texte et deux extraits d'amendement AVANT/APRÈS; aucun plan de zonage municipal complet téléchargeable dans le scan borné |
| 681 | saint-francois-de-sales | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (0 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 711 | saint-honore | echec | classification T1 glyph | deux plans officiels vector-glyph (7292/2968 chemins), zéro code texte; registre de normes absent, donc voie Claude dict-validée non ouvrable honnêtement |
| 735 | saint-jean-port-joli | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (0 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 737 | saint-jerome | echec | audit résidu PDF | aucun plan PDF officiel présent dans le cache ou les rapports de recalage; seuls des artefacts ArcGIS historiques existent et l'AGOL owner harvest est explicitement hors mission |
| 755 | saint-lambert-de-lauzon | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (0 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 759 | saint-leandre | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (2 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 809 | saint-nazaire | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (0 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 815 | saint-norbert-darthabaska | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (0 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 819 | saint-onesime-dixworth | echec | sondage borné du site officiel MAMH | 0 pages candidates contrôlées (0 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 827 | saint-paul-dabbotsford | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (19 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 829 | saint-paul-de-lile-aux-noix | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (0 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 831 | saint-paulin | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (0 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 833 | saint-philibert | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (19 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 839 | saint-pierre-baptiste | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (0 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 845 | saint-placide | echec | preuve rapport antérieur | NO-PDF |
| 847 | saint-prime | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (2 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 859 | saint-roch-de-mekinac | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (2 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 861 | saint-roch-des-aulnaies | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (19 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 865 | saint-samuel | echec | sondage officiel | liens officiels trouvés uniquement vers règlement de zonage et projets de règlement; aucun plan/cartographie de zonage autonome |
| 869 | saint-severe | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (0 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 871 | saint-severin--mekinac | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (2 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 877 | saint-sixte | echec | T2 auto-GCP + arbitrage aniso | 7 seeds passent résidu/holdout mais aucun l'iso-gate; meilleure couverture serving 70,04% < seuil 85% → SKIP |
| 879 | saint-stanislas--maria-chapdelaine | echec | classification T3 | deux plans officiels raster purs: 0 texte, 0 chemin vectoriel, une image chacun; aucun seed GCP local fiable pour T3 |
| 897 | saint-valentin | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (18 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 907 | saint-zenon | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (0 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 913 | sainte-agathe-des-monts | echec | preuve rapport antérieur | autogcp: aucun seed n'a passe residu+holdout |
| 915 | sainte-angele-de-monnoir | echec | sondage officiel | résultats officiels = règlement PIIA et document composite annexes/plans; aucun lien qualifié explicitement comme plan de zonage municipal autonome |
| 931 | sainte-beatrix | echec | preuve rapport antérieur | plan MapInfo PDF Printer = raster imprime, 0 point vectoriel -> autogcp sans seed (T3 raster requis) |
| 941 | sainte-christine | echec | classification T1 glyph | plan officiel vector-glyph (65514 chemins), zéro code texte; aucun dictionnaire réglementaire déposé pour valider une lecture Claude |
| 949 | sainte-elisabeth | echec | preuve rapport antérieur | ABORT |
| 951 | sainte-emelie-de-lenergie | echec | preuve rapport antérieur | ABORT-RASTER |
| 965 | sainte-hedwidge | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (0 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 967 | sainte-helene-de-chester | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (0 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 973 | sainte-jeanne-darc--maria-chapdelaine | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (19 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 975 | sainte-julienne | depot | T1 GeoPDF multisheet texte + dictionnaire grille×plan | résidu 0 m; pages 1+2 fusionnées; 106 codes double-attestés; 3 annotations rejetées; spatial 0,185 km; 97 features; 8246/8247 lots (99,99%); surface 99,84%; dépôt S3 + lot-zone join + lots-enriched OK |
| 977 | sainte-justine-de-newton | echec | preuve rapport antérieur | INTROUVABLE |
| 983 | sainte-madeleine-de-la-riviere-madeleine | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (3 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 985 | sainte-marguerite | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (2 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 991 | sainte-marie-salome | echec | classification T3 | annexe B officielle = raster pur, 0 texte et 0 chemin vectoriel; T3 non ouvrable sans seed GCP grossier local réel |
| 999 | sainte-perpetue--lislet | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (19 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 1003 | sainte-rita | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (0 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 1005 | sainte-rose-du-nord | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (8 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 1011 | sainte-sophie-dhalifax | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (2 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 1015 | sainte-therese-de-la-gatineau | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (2 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 1019 | saints-martyrs-canadiens | echec | T2 retry aniso | best candidate density+10%/rot0° serving coverage 1.22% < floor 85% — anisotropy NOT confirmed real (labels do not land on lots) → SKIP |
| 1031 | shawville | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (2 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 1055 | thorne | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (0 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 1067 | upton | echec | preuve rapport antérieur | autogcp: aucun seed n'a passe residu+holdout |
| 1091 | waltham | echec | sondage borné du site officiel MAMH | 0 pages candidates contrôlées (0 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |

## Vérifications

- `t1-labels.test.ts`: 195 tests passés (incluant le filtre dictionnaire texte).
- `loop-supervise`: scoreboard zones=816 après les dépôts.
- Les deux dépôts ont exécuté `lot-zone-join-run.ts` puis `lots-enriched-run.ts` avec dépôt vérifié.
