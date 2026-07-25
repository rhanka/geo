# Mont-Tremblant — blocage couverture zonage (consignation)

- **Date** : 2026-07-10T19:54Z
- **Slug** : `mont-tremblant`
- **Branche** : `feat/cadre-acquisition`
- **Statut** : **BLOQUÉ — décision requise (immo/principal)**. Rien de servi n'a été modifié.
- **Objet** : la mission « couverture complète MT (tout lot affiche RA-1xx + norme) » est
  **structurellement impossible à partir des actifs existants** sans (a) trancher une ambiguïté
  de millésime et (b) une nouvelle acquisition. Aucun code fabriqué (anti-invention tenu).

---

## 1. TL;DR

Le zonage servi de Mont-Tremblant (`normalized/ca-qc-zonage/qc-zonage-mont-tremblant.geojson`,
source `t2-gcp3`) est **le feuillet plan3 du règlement (2008)-102**, schéma **RA-1xx**, **19
zones**, `real_zoning=true`, recouvrement grille strict **100 %** — **immo l'a validé (MT=100 %)**.
Il ne couvre que le **secteur CENTRAL** (~27 % des 10 016 lots). Les **73 % de lots ruraux**
(dont le lot cible **4 650 233**, 8e Rang) sont **hors emprise plan3** et relèvent d'un **autre
millésime** (« À jour jusqu'au 102-60 », schéma **RA-4xx**) pour lequel **il n'existe ni grille de
normes ni géoréférencement**.

**On NE PEUT PAS** donner à un lot rural un « **RA-1xx + norme** » : RA-1xx est le résidentiel
central 2008 (= plan3 géographiquement), pas le code en vigueur d'un lot rural.

> **MISE À JOUR (2026-07-10, source vérifiée — voir §6.1).** Le blocage géoréférencement est
> **LEVÉ** : MT expose son zonage **EN VIGUEUR** comme couche **vecteur ArcGIS** publique
> (`Ancien_zonage/FeatureServer/1`, 628 polygones MT, champ `Zone`=code, geoJSON, WGS84 —
> vérifié en direct). Plus besoin de géoréférencer les rasters ni de GCP manuel. Restent :
> (a) **extraire la grille de normes** actuelle (Annexe A PDFs, série par série, « compilé au
> 102-73 ») et (b) la **décision millésime/remplacement** (immo/principal) — servir la couche
> en vigueur CHANGE les codes du centre (RA-1xx 2008 → in-force RA-4xx/etc.) et rend plan3 obsolète.

---

## 2. Split de millésime (le crux)

MT publie **deux jeux de cartes disjoints** :

| Jeu | Feuillets | Millésime (stamp) | Schéma de codes | Grille de normes registry ? | Servi ? |
|---|---|---|---|---|---|
| **2008 annexe-B** | `annexe-b-plan1.pdf` (1/3, aperçu territoire), `annexe-b-plan3.pdf` (3/3, central) | « **ce plan n'est pas à jour** » | **RA-1xx** (RA/TM/VA/RF/PI, 54 codes) | ✅ **oui** (`registry/qc-zonage-norms/qc-zonage-norms-mont-tremblant.parquet`, 54 codes) | ✅ **plan3 = 19 zones** |
| **Actuel** | `annexe-b-ensemble-territoire.pdf` (aperçu), `annexe-b-centre-ville.pdf` (détail) | « **À jour jusqu'au 102-60** » | **RA-4xx** + AG/CF/RE/V/VR/TO/TV/CA/CV/LT-xxxx (renuméroté) | ❌ **aucune** | ❌ **non** |

Preuve visuelle (renders inspectés, 2026-07-10) :
- **plan3** : cartouche « RÈGLEMENT DE ZONAGE (2008)-102 », « OCTOBRE 2008 », « 3/3 », nord en
  haut, codes RA-100…RA-157 / TM-101…TM-158 / VA-116…VA-146 / RF-148 / PI-154 = **exactement la
  grille de 54 codes**.
- **ensemble-territoire** : « À jour jusqu'au 102-60 », nord en haut, codes RA-404, RA-405,
  TM-472, VR-1521, TO-435, AG-1027, LT-1052, CF-1063, RE-201, IE-206…
- **centre-ville** : « À jour jusqu'au 102-60 », codes RA-434, RA-425, CA-431, CV-433, CV-439,
  VR-458, VR-1023, TV-716… (même schéma RA-4xx que l'ensemble).
- **plan1** : « ce plan n'est pas à jour », aperçu territoire complet, mêmes préfixes que plan3.

La **grille de normes** du registry = les **54 codes RA-1xx** = le feuillet plan3 (millésime
2008). Il n'y a **aucune** entrée de grille pour les codes RA-4xx actuels ni pour les préfixes
ruraux (AG/CF/RE/V/VR/TO/TV).

---

## 3. Blocages précis (3)

1. ~~**Géoréférencement manquant des cartes actuelles.**~~ **SUPERSEDED (§6.1)** — inutile de
   géoréférencer les rasters : une **couche vecteur ArcGIS en vigueur** existe (`Ancien_zonage`).
   *(Historique : l'auto-seed `t2-autogcp` échouait sur le RÉSIDU sur `annexe-b-ensemble` /
   `-centre-ville` — dry-runs `WITHHELD` — ce qui aurait imposé des GCP manuels ; désormais sans
   objet grâce à la source vecteur, source préférée du gate QA « ArcGIS > GeoPDF ».)*
2. **Ambiguïté de millésime — décision NON-agent.** Servir le millésime actuel (RA-4xx, tout le
   territoire) donnerait à chaque lot son **vrai code en vigueur** mais : (a) **0 % de fold norme**
   (pas de grille RA-4xx), et (b) **conflit de millésime** avec le plan3 servi (le centre aurait
   RA-114 en 2008 vs RA-4xx actuel). Trancher 2008-102/RA-1xx (servi, validé immo) vs 102-60/RA-4xx
   (en vigueur) est une **décision immo/principal**, pas d'un agent.
3. **Grille de normes RA-4xx absente.** Le registry n'a que la grille 54 codes RA-1xx (2008).
   Aucune grille pour les zones actuelles → même géoréférencées, les zones RA-4xx **ne folderaient
   aucune norme**.

Piste ArcGIS écartée : la seule couche ArcGIS MT (`services6.arcgis.com` … `Zonage_region`, 585
feats) porte des codes **`CODE_AFFEC`** d'**affectation** (CO-939, VA-RTF-303) — affectation MRC,
**rejetée** par le gate zonage (pas du zonage municipal). Une recherche de source actuelle
(vecteur/service ou grille de normes) a été lancée pour informer la future acquisition (voir §6).

---

## 4. Preuve que plan3 est déjà au plafond (aucun gain sûr côté central)

Dry-run `t2-build --labels claude` (GCP `mont-tremblant-plan3-northup.autogcp.json`, reads
`mont-tremblant.claude-reads.json`, dict 54 codes) :

- 59 reads → **50 validés** (9 rejets not-in-dictionary : RM-111, etc.) → **19 zones servies**,
  **31 labels « empty »** (aucun lot ne les a comme plus-proche-dans-cutoff : slivers denses du
  centre ombragés par leurs voisins — limite intrinsèque de l'assignation par point-label, pas un
  bug de placement).
- **2 674 / 10 016 lots assignés (26,7 %)** ; **7 342 lots (73 %) restent > 1 500 m** de tout label
  plan3 ; distance médiane lot→label = **2,97 km**. ⇒ Les lots ruraux sont **géographiquement
  hors** du feuillet ; densifier les codes lus **n'ajoute aucun lot**. Augmenter le cutoff pour les
  attraper = mislabeling (interdit).

Sortie identique aux **19 zones déjà servies** → **re-publier ne change rien**.

Gate cohérence (baseline, `work/coverage/_mt-coherence-baseline.json`) : `zone_features=19`,
`real_zoning=true`, `flags=[ok]`, `recouvrement_strict=1`, `codes_grille`=54.

---

## 5. Lot cible 4 650 233 (8e Rang)

Rural, **hors emprise plan3**. Son code en vigueur est **rural** (AG/CF/RE/V/VR, renuméroté 4xx sur
la carte 102-60), **pas RA-1xx**. Impossible de lui servir « RA-1xx + norme » depuis les actifs
existants sans fabriquer (interdit). Nécessite le jeu **actuel** géoréférencé + une **grille RA-4xx**.

(NB : voisin documenté même cas — lot 5094305, villégiature, unassigned à 2,33 km de la zone servie.)

---

## 6.1 Source EN VIGUEUR vérifiée (ArcGIS vecteur) — lève le blocage géoréf

MT exploite sa **propre org ArcGIS Online publique** (`services6.arcgis.com/GnhEJPl3z9NGOl6b`,
owner `Mont_Tremblant`). Endpoints **vérifiés en direct (WebFetch, 2026-07-10)** :

- **Zonage municipal EN VIGUEUR (à utiliser)** — `Ancien_zonage/FeatureServer/1`
  (nom « Ancien zonage » = par opposition à la *refonte* proposée ; le champ `Grille` pointe
  `...REGLEMENTATION EN VIGUEUR\ZONAGE\Grilles - excell compilé au 102-73\400\RA-415-1.xlsx` →
  c'est bien le règlement **en vigueur**, compilé à l'amendement **102-73**).
  - `esriGeometryPolygon`, **628 features**, tous `Municipalité=Mont-Tremblant`, `geoJSON` supporté,
    maxRecordCount 2000. Champs : `OBJECTID, Zone, Affectation, Superficie_km2, Municipalité, Grille, Shape__Area, Shape__Length`.
  - **`Zone` = zone_code** (échantillon vérifié : `RA-415-1, CA-304, CL-320-2, CV-322, CA-464,
    RA-407, RM-406, RF-330, RA-331, RF-334, RF-336, PI-448`). ~**478 codes distincts**, préfixes
    AF/AG/CA/CF/CL/CO/CV/EX/FA/IN/PI/RA/RC/RE/RF/RM/RT/TF/TM/TO/TV/V/VA/VF/VR.
  - **Requête GeoJSON prête** (couche → features WGS84) :
    `https://services6.arcgis.com/GnhEJPl3z9NGOl6b/arcgis/rest/services/Ancien_zonage/FeatureServer/1/query?where=1=1&outFields=*&outSR=4326&f=geojson`
  - SR natif MTM (~WKID 32188) → passer `outSR=4326`. **Track = `agol-account`** (déjà dans les
    candidateTracks zones du matrix), donc pipeline standard, **sans georef**.
- **NE PAS confondre** (aussi vérifiés) : `Au_Zonage_Village/FeatureServer/4` = **refonte/PROJET**
  (codes `VA-RF-311`, `VA-RTF-303`… — pas en vigueur) ; `Zonage_region/FeatureServer/5` = **affectation
  MRC** (`CODE_AFFEC`, `CO-939`…) — rejetée par le gate.

**Grille des usages et normes (en vigueur)** — publiée en **PDF Annexe A** par série de zones sur
`vdmt.ca` (page : `https://vdmt.ca/citoyens/urbanisme/reglements-durbanisme`) :
- Index/liste des grilles : `https://vdmt.ca/storage/app/media/services/reglements-durbanisme/zonage/reglement-2008-102-annexe-a-liste-grille.pdf`
- Séries : `.../reglement-2008-102-annexe-a-zone-100.pdf` … `-zone-1000.pdf` (100,200,…,1000).
- Pas de REST/JSON de normes → **extraction PDF-tableau requise** (tracks `pdf-vision`/`pdf-native`).

**Caveats à réconcilier avant tout join** (source de vérité = la couche vecteur, PAS mes lectures
raster basse-résolution) : la couche est « compilé 102-73 » (plus **récente** que les rasters
« 102-60 ») ; certains codes que j'avais lus sur les rasters ne matchent pas la couche
(`RA-404/405` absents → la couche a `RA-403/407/408` ; pas de préfixe `LT-` ; `IE-` ≈ `IN-` ;
numéros très hauts type `VR-1521` au-delà du max ~1045 de la couche = probables mélectures). Tirer
le set distinct (`.../FeatureServer/1/query?where=1=1&outFields=Zone&returnDistinctValues=true&f=json`)
et le réconcilier avant de faire confiance à un join 1:1.

## 6. Ce qu'il faut pour débloquer (pour immo/principal — hors autonome)

1. **Trancher le millésime (DÉCISION immo/principal)** : garder 2008-102/RA-1xx plan3 servi (folde
   une norme, validé immo, mais périmé + central) **ou** basculer sur la couche **en vigueur**
   (§6.1, tout le territoire, codes RA-4xx/etc.) — ce qui **change les codes du centre** et rend
   plan3 obsolète, et impose l'étape 2 pour garder le fold norme.
2. **Ingérer le zonage en vigueur** : couche vecteur ArcGIS `Ancien_zonage/FeatureServer/1` (§6.1),
   track **`agol-account`**, **sans georef** → tout le territoire, geometry réelle, `Zone`=code.
3. **Acquérir la grille de normes en vigueur** : extraire les **Annexe A PDFs** par série (§6.1,
   `pdf-vision`/`pdf-native`) → grille RA-4xx/etc. pour que les codes foldent une norme.
   - Priorité source (mémoire QA gate) : **ArcGIS > GOnet/WFS > T1 GeoPDF > 3-GCP** → la voie ArcGIS
     est la meilleure et est **disponible**.

---

## 7. Garde-fous (NE PAS)

- **NE PAS** remplacer / écraser le serve RA-1xx plan3 — immo l'a **validé (MT=100 %)**.
- **NE PAS** deviner le millésime (décision immo/principal).
- **NE PAS** relâcher le gate résidu ni augmenter le cutoff (= mislabeling / invention).
- **NE PAS** servir l'affectation `Zonage_region` (CODE_AFFEC) comme zonage.

---

## 8. Reproductibilité (commandes read-only / dry-run utilisées)

```
# Baseline gate (écrit dans un scratch, PAS le fichier partagé)
npx tsx acquisition/src/zone-grille-coherence-gate.ts --slugs mont-tremblant \
  --out work/coverage/_mt-coherence-baseline.json

# Dry-run plan3 (preuve plafond 19 zones / 26,7 % lots) — n'upload rien
npx tsx acquisition/src/t2-build.ts --slug mont-tremblant \
  --gcp work/gcp/mont-tremblant-plan3-northup.autogcp.json \
  --pdf work/zonage-plans/mont-tremblant/annexe-b-plan3.pdf --page 1 \
  --labels claude --dict work/zonage-norms-focus/mont-tremblant.norms-codes.json \
  --reads work/gcp/mont-tremblant.claude-reads.json --dry-run --out <scratch>
```

## 9. PING-IMMO

```
PING-IMMO slug=mont-tremblant action=blocage-consigné
  zones_servies=19/54 (plan3 central, 2008-102/RA-1xx, real_zoning=true, overlap_strict=100%)
  lots_zone_code_pct≈27%(central) lots_norme_pct=inchangé
  lot_4650233=rural/8e-Rang HORS plan3 → code en vigueur rural (AG/CF/RE/V/VR-4xx), PAS RA-1xx, pas de norme
  blocage=split-millésime[2008-102/RA-1xx servi+grille(plan3,validé)  vs  en-vigueur/RA-4xx tout-le-territoire]
  source_en_vigueur=TROUVÉE+vérifiée: ArcGIS Ancien_zonage/FeatureServer/1 (628 feats MT, Zone=code, geoJSON, compilé 102-73) → georef PLUS requis
  reste=extraction grille normes Annexe-A PDFs (vdmt.ca) + DÉCISION millésime/remplacement
  décision_requise=immo/principal (garder plan3 RA-1xx  vs  basculer couche en-vigueur RA-4xx) ; serve plan3 INCHANGÉ (rien cassé)
  real_zoning=true
```
