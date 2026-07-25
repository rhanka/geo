# Recalage PDF zones — shard 1/2 — 2026-07-12T20:42:14.967Z

Règle: slugs dont `(index dans la liste triée) % 2 == 1`. Aucun AGOL owner harvest. Aucun code inventé.

Résultat consolidé: **1 dépôt net dans cette passe**, 138 slugs non terminés avec dépôt ou preuve, 0 fallback(s) sans preuve structurée.

## Dépôts nets de cette passe

- **sainte-elisabeth** — 34 GCP indépendants; résidu max 12,977 m / RMS 5,906 m; 177 codes réels verbatim; 131 features; 1092/1119 lots (97,59%); centroïde 1,503 km; dépôt S3 qc-zonage-sainte-elisabeth puis lot-zone-join-run et lots-enriched-run OK (1119 lots, zone_code 97,59%, surface 100%, adresse 98,57%, FSA 100%) — source: work/zonage-plans/sainte-elisabeth-plan.pdf

## Tous les slugs du shard

| index | slug | statut | méthode | preuve |
|---:|---|---|---|---|
| 3 | aguanish | echec | official-site-bounded-discovery | discovery-current-20260712.json: no zoning-plan PDF link; cached official pages expose governance/privacy PDFs and a matrix-graphique link only |
| 11 | ange-gardien | echec | T1-then-T2-auto-seed | T1 dry-run ABORT: embedded-georef corner residual 996.21 m > 50 m. T2 auto-seed ABORT: orientation ambiguity, plausible north-up fits disagree by 180.0 degrees; no GCP file and no deposit. |
| 19 | austin | echec | T1 GeoPDF Claude dict-validé + inventaire S3 | géoréf NAD83 MTM8, résidu 0,16 m; 125/125 lectures Claude exactes contre 125 codes officiels; ABORT sur cadastre canonique absent: NoSuchKey normalized/qc-cadastre-lots/austin.geojson; inventaire S3 normalized/ vérifié: seules les 2 clés qc-zonage-norms-austin existent, aucune clé cadastre austin |
| 27 | baie-johan-beetz | echec | official-site-discovery-plus-existing-T2 | Official bounded discovery found no standalone zoning-plan PDF; cached by-law references plan 6-0431-Z but do not publish the map. Existing T2 report: svg_points=0, no residual/holdout winner. |
| 45 | begin | echec | official-regulation-T1/T2 | Both official PDFs are regulation text, not a recalable map: no embedded georef and existing T2 report has svg_points=0; no GCP or deposit. |
| 55 | blanc-sablon | echec | official-site-bounded-discovery | discovery-current-20260712.json: no zoning-plan PDF link; cached official pages expose general municipal/contractual documents only. |
| 57 | boileau | echec | official-site-discovery-plus-existing-T2 | No standalone official zoning-plan PDF found in bounded discovery; existing cached input/T2 report has svg_points=0 and no residual/holdout winner. |
| 59 | bois-franc | echec | official-site-discovery-plus-existing-T2 | Official page exposes zoning by-law, grid and annexes but no standalone zoning plan; existing T2 report has svg_points=2, below a valid seed, so no deposit. |
| 65 | bonne-esperance | echec | directory-and-local-evidence | No official website is present in the municipal directory; no official zoning PDF or valid GCP evidence. |
| 69 | bowman | echec | preuve rapport antérieur | official site returns citizen portal SPA with no relevant PDF links; local cache only norms/grid, no plan |
| 73 | brome | echec | preuve rapport antérieur | Bounded official-site evidence contains no zoning-plan PDF; no local official plan or recalage input exists. |
| 77 | bryson | echec | directory-and-local-evidence | No official website is present in the municipal directory; no official zoning PDF or valid GCP evidence. |
| 79 | cacouna | echec | preuve rapport antérieur | Cached PDF is ASCII error page `error code: 525`; cached official pages had no zoning/plan PDF link. |
| 81 | campbells-bay | echec | preuve rapport antérieur | Official EN/FR regulation pages expose fiscal, ethics, septic, fire-station, health-alert, or general bylaw PDFs only. |
| 83 | caniapiscau | echec | official-source-check | municipal directory has no official website and no verifiable official zoning PDF |
| 85 | cap-chat | echec | T1 GeoPDF glyphes + classification officielle | les deux cartes officielles sont géoréférencées (résidus 2,96 m et 1,09 m) mais pdftotext donne 0 code; leurs titres/légendes sont explicitement « Zones de contraintes relatives à l'érosion côtière », pas un zonage municipal → ABORT sans servir |
| 93 | cayamant | echec | preuve rapport antérieur | Official regulations page lists municipal bylaws, including CCU/demolition, but no zoning plan or zoning regulation PDF. |
| 95 | chambord | echec | T2 auto-seed | work/zones-recalage/shard1of2/chambord-rural-t2-report.json; work/zones-recalage/shard1of2/chambord-urbain-t2-report.json |
| 99 | chapais | echec | T1 puis T2 auto-seed page 1 | T1 ABORT: aucun /VP /Measure /GEO; T2 pass=false, svg_points=0, aucun GCP retenu, résidu/holdout non calculables |
| 111 | chichester | echec | sondage officiel borné déjà consigné | aucun lien PDF de plan de zonage municipal dans les pages officielles contrôlées |
| 115 | clarendon | echec | preuve rapport antérieur | prior official-site scan found no plan/zoning PDF; current verification HTTP 406 |
| 135 | deleage | echec | preuve rapport antérieur | Official zoning PDF is text bylaw only and not GeoPDF; official zoning map is JPG with no coordinate grid or verified seed GCP, so no controls were invented. |
| 145 | dolbeau-mistassini | echec | T1 puis T2 auto-seed page 1 | T1 ABORT: aucun /VP /Measure /GEO; T2 pass=false, svg_points=0, aucun GCP retenu, résidu/holdout non calculables |
| 161 | east-farnham | echec | preuve rapport antérieur | T2 report: 85 SVG points, 8 attempts, at most 5 independent matches after pruning (<6); no residual+holdout winner. |
| 163 | eastman | echec | T1 then T2 auto-GCP | T1 aborted: no /VP /Measure /GEO georeferencing. T2 auto-GCP command was bounded with timeout 330s and exited 124 without producing work/gcp/eastman.autogcp.shard1of2.report.json. |
| 165 | egan-sud | echec | T1 puis T2 auto-seed page 1 | T1 ABORT: aucun /VP /Measure /GEO; T2 pass=false, svg_points=0, aucun GCP retenu, résidu/holdout non calculables |
| 173 | ferland-et-boilleau | echec | preuve rapport antérieur | official host did not resolve for tested urbanisme pages |
| 187 | gaspe | echec | T1 puis T2 auto-seed + arbitrages | T1 sans /VP /Measure /GEO; T2: seeds résidu/holdout mais iso-gate; arbitrage anisotropie meilleur serving 56,13% < 85%, donc SKIP |
| 193 | gracefield | echec | preuve rapport antérieur | The cached input is the zoning regulation rather than a usable vector plan; T2 report has svg_points=0 and attempts=0. |
| 199 | grande-vallee | echec | preuve rapport antérieur | TLS hostname mismatch on official host for tested urbanisme pages; no TLS bypass used |
| 203 | gros-mecatina | echec | preuve rapport antérieur | official page read, no exploitable zoning plan PDF link |
| 209 | hampden | echec | preuve rapport antérieur | Both official sheets were tested; each T2 report has cadastre_features=338, svg_points=0, attempts=0. |
| 217 | hebertville-station | echec | preuve rapport antérieur | MAMH has no website; local PDF is for Hebertville and is a regulation, not a plan |
| 225 | hope-town | echec | preuve rapport antérieur | official host did not resolve for tested urbanisme pages |
| 235 | kazabazua | echec | preuve rapport antérieur | official bounded discovery: no zoning-plan PDF; prior T2 orientation/isotropy gate |
| 245 | la-dore | echec | preuve rapport antérieur | official documentation page read; no separate recalable zoning plan PDF found in visible links |
| 263 | la-tuque | echec | preuve rapport antérieur | official pages expose document categories but no directly visible recalable zoning plan PDF in links read |
| 267 | labrecque | echec | preuve rapport antérieur | T1 no embedded georef; T2 territory rejected by 180 degree orientation ambiguity; T2 urban perimeter rejected by orientation/isotropy |
| 269 | lac-aux-sables | echec | preuve rapport antérieur | Official zonage annex has no embedded georef and T2 vector auto-GCP has svg_points=0 |
| 271 | lac-bouchette | echec | preuve rapport antérieur | official host timed out on bounded https and http homepage fetches |
| 289 | lac-sergent | echec | T2 auto-seed + lot-assignment | 2 rotations passent le résidu mais tight=0% et serving=0% pour les deux; marge 0 pt < 15 pt; anisotropie serving 0% < 85% → SKIP |
| 291 | lac-superieur | echec | preuve rapport antérieur | Real one-page zoning plan, but across 20 T2 attempts and 20894 SVG points only 0-2 independent matches survived pruning (<6); no winner at 15 m. |
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
| 347 | lochaber-partie-ouest | echec | T1 GeoPDF glyphes | GeoPDF officiel résidu 0,16 m mais 0 code sélectionnable; aucun dictionnaire réglementaire autoritaire trouvé pour ouvrir la voie Claude dict-validée → ABORT |
| 349 | longue-rive | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (2 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 373 | massueville | echec | preuve rapport antérieur | Cached input is a 110-page zoning regulation, not the plan; T2 report has svg_points=0, attempts=0 and no seed at 30 m. |
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
| 601 | saint-casimir | echec | preuve rapport antérieur | Cached official document is a 345-page zoning regulation; no autonomous zoning-plan PDF is available for T1/T2. |
| 607 | saint-charles-de-bourget | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (2 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 613 | saint-clement | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (2 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 623 | saint-cyprien--riviere-du-loup | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (3 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 629 | saint-damase-de-lislet | echec | preuve rapport antérieur | T1 no embedded georef on both plans; existing T2 reports rejected |
| 647 | saint-edouard-de-maskinonge | echec | preuve rapport antérieur | Cached PDF is a five-page road atlas, not zoning; T2 report has svg_points=0, attempts=0. |
| 657 | saint-esprit | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (3 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 663 | saint-eugene-de-guigues | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (0 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 673 | saint-felix-dotis | echec | sondage officiel | liens trouvés: cahier des spécifications, règlement texte et deux extraits d'amendement AVANT/APRÈS; aucun plan de zonage municipal complet téléchargeable dans le scan borné |
| 681 | saint-francois-de-sales | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (0 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
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
| 845 | saint-placide | echec | preuve rapport antérieur | Four-page scanned official input has no selectable zoning labels/vector parcel linework; T2 report has svg_points=0, attempts=0. |
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
| 941 | sainte-christine | echec | T1 texte + contrôle dictionnaire | T1 ABORT: aucun /VP /Measure /GEO; plan vector-glyph sans codes sélectionnables; dictionnaire officiel présent mais limité à 201..205, soit 0 code lettré, donc échec du gate explicite ≥3 codes lettrés |
| 949 | sainte-elisabeth | depot | T2 GCP indépendants + labels texte | 34 GCP indépendants; résidu max 12,977 m / RMS 5,906 m; 177 codes réels verbatim; 131 features; 1092/1119 lots (97,59%); centroïde 1,503 km; dépôt S3 qc-zonage-sainte-elisabeth puis lot-zone-join-run et lots-enriched-run OK (1119 lots, zone_code 97,59%, surface 100%, adresse 98,57%, FSA 100%) |
| 951 | sainte-emelie-de-lenergie | echec | preuve rapport antérieur | Official MapInfo plan yields no selectable code text and T2 report has svg_points=0, attempts=0; raster registration has no honest local seed. |
| 965 | sainte-hedwidge | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (0 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 967 | sainte-helene-de-chester | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (0 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 973 | sainte-jeanne-darc--maria-chapdelaine | echec | sondage borné du site officiel MAMH | 19 pages candidates contrôlées (19 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |
| 977 | sainte-justine-de-newton | echec | preuve rapport antérieur | Two official plan pages were tested: 7 and 13 seeds respectively passed residual+holdout (best residuals 4.521-5.481 m), but none passed orientation/isotropy; no safe rotation winner. |
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
| 1067 | upton | echec | T1 puis T2 auto-seed frais | T1 ABORT: aucun /VP /Measure /GEO exploitable. T2: 2635 points SVG et 9 seeds passent résidu+holdout, mais tous échouent l'iso-gate (anisotropie 1,804–3,088 et/ou orientation non north-up); aucun GCP servi ni dépôt. |
| 1091 | waltham | echec | sondage borné du site officiel MAMH | 0 pages candidates contrôlées (0 HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim |

## Vérifications

- Sélecteur trié: 137/137 slugs non-`done` impairs couverts, plus 1 dépôt net de cette passe; 0 hors shard.
- `austin`: résidu 0,16 m et 125/125 lectures Claude validées; dépôt bloqué par `NoSuchKey normalized/qc-cadastre-lots/austin.geojson`; l'inventaire S3 `normalized/` ne contient que 2 clés de normes pour Austin et aucun cadastre.
- `loop-supervise`: scoreboard zones=822; qualité `821 servis`; Sainte-Élisabeth est le dépôt net de cette passe.

