# Worklist PDF-recalage IN-COHORTE (B-prime 167) — tiéré T1-T4 — 2026-08-11

**Mode : READ-ONLY shovel-ready prep (g-cond). AUCUNE capture / AUCUN dépôt / AUCUNE
écriture cluster-S3.** La capability recalage est **BLOQUÉE** (niveau owner). Ce document
est une worklist tiérée et source-évaluée, à exécuter par un **futur spike de capability**
(geo-archi + recalage-codex sur T1/T2) dès déblocage.

Machine-readable : `work/coverage/zones-pdf-recalage-worklist-incohort-20260811.json`.
Sonde de jonction read-only : `acquisition/src/_zones-pdf-recalage-scan-20260811.ts`
(`join` = construit le résidu in-cohorte ; `validate` = vérifie les compteurs de la worklist).

## Méthode & anti-invention

Résidu assemblé **par construction** depuis les enregistrements committés :
la cohorte 167 (`overlap-bprime167-vs-geo-20260802.json` + statut autoritaire
`zones-recalage-status-167-20260803T003500Z.json`), le résidu RIEN/RASTER
(`zones-vnatif-discovery-{20260810,lot2,lot3,geomsuspect,lot4,lot5}-20260810.json`) et
le résidu SKIP/held/pdf-only (`zones-vnatif-deposit-record-{otherhttp,backlog}-20260810.md`).

Le **tier est assigné depuis la source RÉELLE trouvée** (WebFetch/WebSearch du plan
municipal) quand vérifié, sinon `tier_confidence=estimated` (défaut **T3** = plan municipal
PDF publié, internes non fetchés). Un candidat sans plan public géoréférençable est
documenté **`no-public-plan`**, jamais doté d'un tier fabriqué. `estimated_yield` est une
**estimation étiquetée** (analogie par bande de taille vs munis servies), pas une mesure.

## Compteurs (partition fermée)

| | n |
|---|---:|
| Résidu in-cohorte 167 (total) | 58 |
| — déjà servi (v2 vivant 2026-08-02) → exclu | 7 |
| **Gap PDF-recalage in-cohorte** | **51** |

| tier | définition | in-cohorte |
|---|---|---:|
| **T1** GeoPDF auto-calage | géoréférence embarquée (OGC/Adobe/QGIS geospatial-PDF) | **1** |
| **T2** vecto-calque | PDF vecteur sélectionnable (export QGIS/CAD sans géoréf) | **1** |
| **T3** raster géoréf | image raster/aplati, sans géoréf → points de calage | **46** |
| **T4** scan calé-sur-lots | scan basse qualité → ancrage sur les lots | **0** (aucun prouvé ; certains ruraux pourraient s'y révéler) |
| **no-public-plan** | aucun plan public (texte-loi seul / email / viewer proprio) | **2** |
| **other-gap** | pas un problème PDF (viewer proprio / identité) | **1** |

Confiance : **7 vérifiés** (5 plans WebFetchés + rosemère no-public-plan + saint-pierre
other-gap), **44 estimés** (défaut T3). Les 7 déjà-servis exclus : franklin, ormstown,
saint-mathieu-de-beloeil, sainte-catherine, sainte-clotilde, varennes, vercheres (RIEN au
re-scan vecteur 2026-08-10 mais preuve v2 vivante au 2026-08-02 → **pas un gap**).

## Note spike-ready (par où commencer)

**Démarrer par les 2 gains T1/T2 vérifiés — ils prouvent les deux chemins sur données réelles
avant de passer au volume T3 :**

1. **saint-amable — T1 GeoPDF VÉRIFIÉ.** Le plan (recto/verso, maj 2023-02-15) embarque un
   **CRS WGS 1984 Web Mercator + des couches OCG** → auto-calage immédiat. Le plus haut
   ratio valeur/effort in-cohorte.
2. **vaudreuil-dorion — T2 vecto-calque VÉRIFIÉ.** Annexe 1 (5 feuillets), producteur PDF
   **QGIS 3.44.3** → plan vecteur exporté ; **probablement T1** si le flag « géoréférencer »
   de l'export QGIS était actif (vérifier le Geo/LGIDict). Gros territoire (~40k hab).

**Ensuite**, re-fetcher les plans récents « codifié » / multi-feuillets (les-coteaux R19-2022,
saint-stanislas-de-kostka 330-2018 A/B/C, chateauguay Annexe-A-2025, vaudreuil-dorion
feuillets 1-4) pour **reclasser T3→T2/T1** là où ce sont aussi des exports GIS-vecteur : le
motif de production QGIS/GeoPDF se répand, donc le **vrai compte T1/T2 est probablement > 2**.

**Puis** le volume T3 raster (villes du ring montréalais : chateauguay, beloeil, pointe-claire,
dorval, sainte-therese…) = calage classique par points de contrôle, plus haut rendement
absolu mais effort/muni supérieur.

## Candidats in-cohorte (triés tier puis rendement)

### T1 — GeoPDF auto-calage (vérifié)

| slug | rang | source plan | rendement est. | note |
|---|---:|---|---|---|
| **saint-amable** | — | st-amable.qc.ca/.../saint-amable-plan-zonage-urbanisme-ville.pdf (recto/verso, WGS84 WebMercator + OCG) | ~120-200 | GeoPDF vérifié — auto-calage LOW effort |

### T2 — vecto-calque (vérifié)

| slug | rang | source plan | rendement est. | note |
|---|---:|---|---|---|
| **vaudreuil-dorion** | — | Règl. 1872 Annexe 1 (5 feuillets, QGIS 3.44) | ~350-500 | vecteur QGIS ; T1 si géoréf export actif |

### T3 — raster géoréf (calage par points de contrôle)

*Vérifiés raster :* **chateauguay** (Annexe-A 2025, /Im image XObjects) ~400-600 ·
**beloeil** (plan 2019, image objects) ~250-350 · **sainte-julienne** (8.5 Mo image-heavy) ~80-150.

*Estimés (plan municipal PDF présumé, internes non fetchés) — triés rendement décroissant :*

| slug | rang | rendement est. | contexte source |
|---|---:|---|---|
| pointe-claire | — | ~250-400 | ville reconstituée agglo MTL, plan PDF propre |
| sainte-therese | — | ~150-300 | served = JMap raster ; plan PDF |
| dorval | — | ~150-300 | ville reconstituée agglo MTL |
| saint-basile-le-grand | — | ~100-200 | MRC VDR ne sert que zonageSAR |
| farnham | — | ~100-200 | MRC BM cartobm = matrice, zoning PDF |
| saint-philippe | — | ~60-120 | MRC Roussillon, pas de grille vecteur |
| les-coteaux | — | ~60-120 | R19 codifié 2022 — CANDIDAT T2/T1 au re-fetch |
| hudson | — | ~60-120 | MRCVS Maps « under construction » |
| lepiphanie | — | ~60-120 | LBP 60037 token-gated ; carte=matrice |
| saint-calixte | — | ~50-110 | MRC Montcalm PDF only |
| saint-ours | **153** | ~50-110 | goAzimut v1 DEAD ; MRC PdS pas d'app zonage |
| saint-paul | — | ~50-110 | carte municipale PDF (confirmer annexe zonage) |
| oka | — | ~50-110 | MRC 2M affectation only |
| montreal-ouest | — | ~40-90 | Règl 2010-002 refonte, plan Annexe 1 |
| sainte-anne-de-bellevue | — | ~40-90 | Règl 874 annexes intégrées |
| rougemont | — | ~40-90 | MRC Rouville PDF schema |
| saint-charles-sur-richelieu | — | ~40-90 | cartes zonage PDF (doc centre) |
| saint-denis-sur-richelieu | — | ~40-90 | Règl 2011-R-195 PDF |
| saint-chrysostome | — | ~40-90 | MRC HSL affectation only |
| lacolle | — | ~40-90 | MRC HR hub cadastre/UEV/affectation |
| saint-alexandre | — | ~40-90 | MRC HR (Iberville) hub only |
| pointe-calumet | — | ~40-90 | MRC 2M affectation only |
| saint-damase--les-maskoutains | **104** | ~40-90 | goAzimut v1 DEAD ; Geocentriq proprio |
| saint-dominique | **167** | ~40-90 | goAzimut v1 DEAD ; Geocentriq proprio |
| saint-bernard-de-lacolle | **123** | ~50-110 | goAzimut v1 DEAD ; MRC HR PDF |
| hemmingford--les-jardins-de-napierville (canton) | **117** | ~40-90 | goAzimut v1 DEAD ; annexe-A plan général |
| tres-saint-sacrement | — | ~30-70 | MRC HSL affectation only |
| saint-clet | — | ~30-70 | MRCVS SADR3 PDF |
| saint-liguori | — | ~30-70 | MRC Montcalm PDF only |
| saint-sulpice | — | ~30-70 | LBP ne couvre pas 60020 |
| saint-mathieu | — | ~30-70 | MRC Roussillon (homonyme wetlands rejeté) |
| saint-placide | — | ~30-70 | MRC 2M affectation only |
| saint-stanislas-de-kostka | — | ~30-70 | plans 330-2018 A/B/C — CANDIDAT T2/T1 au re-fetch |
| sainte-marie-madeleine | — | ~30-70 | Maskoutains/Geocentriq |
| havelock | — | ~30-70 | MRC HSL affectation only |
| saint-etienne-de-beauharnois | — | ~20-50 | MRC BHS carte=patrimoine ; Beauharnois plan analog |
| howick | — | ~15-40 | MRC HSL, petit village |
| hemmingford--…--2 (village) | — | ~15-40 | Règl 293 plan ; micro-veine PDF |
| saint-barnabe-sud | — | ~15-40 | Maskoutains/Geocentriq, petit rural |
| saint-bernard-de-michaudville | — | ~15-40 | Maskoutains/Geocentriq, petit rural |
| sainte-madeleine | — | ~15-40 | Maskoutains/Geocentriq, village |
| saint-roch-ouest | — | ~10-30 | ~150 hab, quasi tout agricole (Règl 150-2023) |

### no-public-plan (genuinely stuck)

| slug | rang | raison |
|---|---:|---|
| **rosemere** | — | texte-loi publié (Règl 801) mais le **PLAN sur demande courriel** — aucun plan téléchargeable (vérifié) |
| **notre-dame-de-stanbridge** | — | Règl 315-08 référencé, **plan MAP non localisé** en recherche publique (recheck site muni au spike) |

### other-gap (pas un tier PDF)

| slug | rang | type | raison |
|---|---:|---|---|
| **saint-pierre** | — | proprietary-viewer + identité | résolu à **Saint-Pierre-de-l'Île-d'Orléans** (le Saint-Pierre région-MTL fusionné dans Lachine 2002) ; zonage via viewer **Sigale/Altus** sans export ; **réconcilier l'identité** de la cohorte avant tout travail |

## Hors-cohorte — other-capability-gaps (référence, NON in-cohorte, NON tiers PDF)

Blockers non-recalage déjà documentés dans les records ; **tous out-of-cohort** :

- **request-bounded (ArcGIS paginé)** : rouyn-noranda (MapServer/5, 1058 zones ~48 Mo, full-extent time-out → capture multi-payload, casse la preuve v2 single-payload).
- **token requis** : alma (REST v2.0 session-id).
- **web-map embarqué (esri)** : havre-saint-pierre, plessisville (Web Map www.arcgis.com, featureCollection embarquée, pas de FeatureServer).
- **zip-shapefile** : neuville, saint-gilbert, saint-raymond (portneuf.blob .zip MTM → extract+convert+reproject).
- **micro-veine PDF hors-cohorte** : chelsea, preissac, saint-armand, sainte-petronille (PDF-only, candidats recalage d'une passe out-of-cohort ultérieure).
- **empty-code coverage-gate** : padoue, saint-joseph-de-lepage, saint-gabriel, saint-charles-garnier, saint-donat--la-mitis, beaupre (source vecteur EXISTE mais ≥1 feature à code vide que le servi legacy retient → dépôt bloqué par l'anti-perte + anti-invention ; **pas** un problème PDF).

## Discipline

READ-ONLY : uniquement WebFetch + lecture des records committés + cette worklist committée
(+ sonde read-only). Aucune capture/dépôt/putServedZone*. Le tier reflète la source réelle
trouvée ; sans plan géoréférençable = `no-public-plan`, jamais un tier fabriqué. Le
rendement est une estimation étiquetée. **Aucun dépôt maintenant** — prep pour capability bloquée.
