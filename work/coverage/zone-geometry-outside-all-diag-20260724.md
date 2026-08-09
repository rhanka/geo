# Diagnostic outside_all — 7 villes (géométrie partielle vs résidu topo) — 2026-07-24

**Mandat** : les 7 villes « mismatch lot↔zone dominé par `outside_all` » sont-elles des géométries de zonage INCOMPLÈTES (zones non dessinées) ou un `outside_all` légitime ?
**Méthode** : `acquisition/src/_zone-geometry-gap-diag.ts` — lecture S3 réelle (`qc-zonage-*`, `qc-lots-*`), centroïde shoelace + point-in-polygon (avec trous), **zéro fold, zéro écriture servie**. Codes attendus = `sigZoneCodes` de la crossval normes (`completion-1-normes-matrix-20260723.json`) sinon plans réglementaires.

## Résultat charnière (réfutation)
Pour **les 7 villes** : `code_not_drawn = 0` et `outside_zone_bbox ≈ 0`. Autrement dit, **tout lot `outside_all` a son code de zone DESSINÉ et son centroïde tombe DANS l'emprise du zonage servi** ⇒ ce sont des **gaps interstitiels** (frontières, emprises de rue, plans d'eau, polygones non-jointifs), **PAS de la géométrie absente**. L'hypothèse « outside_all = zones manquantes » est donc **fausse pour les 7**.

Le vrai signal de **géométrie partielle** est ailleurs : **% de lots `unassigned`** + **(codes dessinés ≪ codes SIG)**. Il ne flague que **2 villes** : `saint-frederic` et `saint-boniface`.

## Tableau par ville

| ville | zones dessinées (feat/codes) | codes attendus | lots | assigned | unassigned % | outside_all | not_drawn / out_bbox | verdict | source de ré-acq |
|---|---|---|---|---|---|---|---|---|---|
| **saint-frederic** | 10 / **6** | **43** (geocentralis) | 1041 | 246 | **76.4 %** | 30 | 0 / 0 | **(a) PARTIELLE RÉCUPÉRABLE** | geocentralis `siadmin_pzon_99_s` id=27065 → **43 feat** |
| **saint-boniface** | 21 / **21** | **~100+** (PZ-2000) | 3842 | 1905 | **50.4 %** | 22 | 0 / 0 | **(a) PARTIELLE — HARD/TERMINAL** | saint-bo.ca PZ-1..4 `file-16589..16592` + Annexe B `file-23003` (raster plat, auto-GCP+flotte ÉCHOUÉS) |
| rosemere | 117 / 102 | 102 (SIG) | 5767 | 4246 | 26.4 % | 277 | 0 / 0 | (b) PLATEAU | — (102/102 déjà servi) |
| plaisance | 71 / 53 | 53 (SIG goAzimut) | 837 | 833 | 0.5 % | 97 | 0 / 0 | (b) PLATEAU | — (53/53 goAzimut) |
| sainte-cecile-de-milton | 37 / 32 | 32 (SIG) | 1518 | 1219 | 19.7 % | 67 | 0 / 1 | (b) PLATEAU | — |
| preissac | 25 / 25 | 25 (SIG) | 683 | 562 | 17.7 % | 11 | 0 / 0 | (b) PLATEAU | — |
| notre-dame-de-lourdes--lerable | 38 / 38 | n/d (pas de crossval) | 795 | 704 | 11.4 % | 5 | 0 / 0 | (b) PLATEAU (résidu minime) | — |

## Classement

### RÉCUPÉRABLES (une meilleure source existe)
1. **saint-frederic — CIBLE NETTE.** Servi = `vision-vectorized`, **6 codes** (A-19, A-27, AF-30, F-31, F-32, I-90). Le SIG municipal EN VIGUEUR est public chez **geocentralis (PG Solutions)** :
   `https://geoserver.geocentralis.com/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=evb:siadmin_pzon_99_s&CQL_FILTER=id_municipalite=27065`
   → **numberMatched=43** (`outputFormat=application/json` : 43 features, **42 codes `etiquette_1` distincts**, `description="zonage 2024"`, `annee=2024`). **Recoupement VÉRIFIÉ** : les 6 codes servis (A-19, A-27, AF-30, F-31, F-32, I-90) sont **tous présents** dans le jeu geocentralis (A10..A27, AF30, F31, F32, I90..I92, M80..M87, P40, P41, RR70, Rf50..Rf55, Rm60, Rm61) ⇒ même municipalité, même nomenclature, **géométrie 7× plus complète**. Témoin sonde saint-mathieu 57045→54 = OK. Les **795 lots unassigned (76 %)** = les ~36 zones non tracées. Lane [[geocentralis-zonage-municipal-lane]] / [[jmap-rest-vector-lane]] (celle qui a résolu alma & saint-mathieu).
2. **saint-boniface — récupérable en PRINCIPE seulement.** La source réglementaire est publique (plans PZ-1..4-2000 `saint-bo.ca/file-16589..16592`, grille Annexe B #337 `file-23003`, ~100+ codes numériques 100s–500s), MAIS les PZ-2000 sont des **rasters plats Esri non-GeoPDF** : auto-GCP T2 échoué idempotent et **flotte-remote `t2-pdf-vectoriel-calage` autorisée+exécutée+ÉCHOUÉE (2026-07-12, OPTION B)**. geocentralis id 51085 = 0, ArcGIS MRC Maskinongé = 499 token. Voie restante = **GCP manuels denses/TPS humains**. ⚠️ Nouveau depuis la mémoire : le **secteur central (21 zones, codes 105..136) est désormais servi via `t2-gcp3`** ; il reste les ~80 zones rurales (PZ-2/3/4) → 50 % unassigned. **Ne pas re-sonder/re-lancer la flotte** ([[saint-boniface-cohere-status]], bloc CONSOLIDÉ).

### PLATEAU (outside_all LÉGITIME = gaps topo, géométrie complète vs source autoritaire)
3. **rosemere** — 102/102 codes SIG (`ocg-street-georef`) ; outside_all=277 (4.8 %) = gaps interstitiels ; déjà terminal/cohérent ([[rosemere-cohere-status]]).
4. **plaisance** — 53/53 codes SIG (goAzimut) ; unassigned quasi nul (0.5 %) ; outside_all=97 (11.6 %) tous dans l'emprise, misassigned bas (21) ⇒ recalage bon.
5. **sainte-cecile-de-milton** — 32/32 codes SIG (`boundary-georef`) ; outside_all=67 (5.5 %), 1 seul hors bbox.
6. **preissac** — 25/25 codes SIG (`geopdf-esri` officiel) ; outside_all=11 (2 %).
7. **notre-dame-de-lourdes--lerable** — 38 codes (`t2-gcp3`) ; outside_all=5 (0.7 %) ; résidus trop faibles pour une géométrie partielle (pas de crossval SIG pour confirmer le compte attendu).

**Pour les 5 « plateau », aucune ré-acquisition n'aide** : le SIG autoritaire est déjà dessiné en entier. Le `outside_all` ne s'améliorerait que par un snap/re-fold des centroïdes (hors mandat), pas par une nouvelle source.

## Artefacts
- Données chiffrées complètes : `work/coverage/zone-geometry-outside-all-diag-20260724.json`
- Script reproductible (non committé) : `acquisition/src/_zone-geometry-gap-diag.ts`
- Brut S3 : `scratchpad/zone-gap-diag.json` + `zone-gap-diag-2.json`
