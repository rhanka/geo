# Géoréférencement du zonage municipal — algorithme T1/T2 et équivalence bi-moteur (Claude 4.8 ⊕ Codex 5.5)

_Statut : capitalisation d'algorithme. Branche `feat/cadre-acquisition`. 2026-06-29._

Cet article documente (1) **l'algorithme** qui transforme un plan de zonage municipal PDF
en collection vectorielle servable, et (2) le fait — vérifié empiriquement — que **deux
moteurs LLM en effort maximal (Claude Opus 4.8 « xhigh » et Codex GPT-5.5 « xhigh »)
produisent une implémentation équivalente** de cet algorithme, ce qui rend la chaîne
robuste à l'épuisement de quota d'un fournisseur.

---

## 1. Problème & contrat de données

« Servir le zonage » d'une municipalité = exposer une collection OGC
`qc-zonage-<slug>` : **GeoJSON de POLYGONES** portant un champ **`zone_code`
réglementaire RÉEL** (ex. `H-3`, `RA-101`, `C-15`). Le frontend (radar-immobilier)
la consomme en passthrough pour colorier la carte et joindre `signal → zone`. Il faut
donc **de la géométrie vectorielle + un code de zone réel** — un PDF de règlement
OCRisé seul (codes sans polygones) ne suffit pas. Voir
[`contrat-jointure-immo-zones-lots.md`](./contrat-jointure-immo-zones-lots.md).

**Invariant anti-invention** (non négociable) : on ne publie qu'un `zone_code`
verbatim issu d'une source réelle, géométrie issue du cadastre réel, et seulement si
les gates QA passent ; sinon on **flague honnêtement** (0 servi) — jamais un identifiant
séquentiel (`OBJECTID`/`NO_ZONE` numérique) ni un libellé d'affectation régionale.

---

## 2. L'algorithme

La géométrie ne vient **jamais** du PDF : elle vient du **cadastre du Québec**
(parcellaire officiel, 100 % province, déjà possédé). Le PDF ne fournit que les
**étiquettes de code de zone géoréférencées**. C'est l'idée centrale (« cadastre
line-of-sight ») : chaque lot cadastral hérite du code de l'étiquette la plus proche en
ligne de vue, puis on dissout les lots par `zone_code`.

### 2.1 T1 — GeoPDF à géoréférencement embarqué

1. **Détection du géoréf embarqué** : un Geospatial PDF (ISO 32000 / « GeoPDF »)
   porte la transformation page→projeté dans les dictionnaires `/VP` (Viewport),
   `/Measure`, `/GPTS` (geo points), `/GCS`/`/PRJ` (système de coordonnées),
   `/Bounds`, `/LGIDict`. **Piège mesuré** : les mesures d'échelle CAD
   `/Subtype/RL` (ratio papier/terrain) **ne sont PAS** un géoréf — un détecteur naïf
   les compte comme tel (faux positif : seuls 4/13 plans focus avaient un vrai ancrage).
2. **Transformation page→WGS84** : affine dérivée des `/GPTS`+`/Bounds`, reprojetée via
   `proj4` (NAD83/MTM ou Lambert selon le PDF). **0 GDAL requis** : la transformation
   est dans le PDF.
3. **Extraction des étiquettes** : texte sélectionnable via `pdftotext -bbox-layout`
   (codes verbatim + position page) → reprojetés en WGS84.
4. **Agrégation cadastre line-of-sight** : chaque lot (`normalized/qc-cadastre-lots/<slug>`)
   prend le code de l'étiquette la plus proche ; dissolve par `zone_code` →
   MultiPolygon par zone, `InteriorPointArea` fidèle GEOS.

### 2.2 T2 — calage 3-GCP manuel (plan SANS géoréf embarqué)

Pour un PDF vectoriel à codes réels mais sans ancrage géo (que des mesures `/RL`) :
un humain (ou un agent) place **≥3 points de contrôle** (point page ↔ point réel) ;
on ajuste une **transformation affine par moindres carrés** (`fitAffine`, partagée avec
T1) ; on rejette si **résidu de calibration > seuil** (défaut 50 m) ou GCP quasi
colinéaires. Le reste de la chaîne = identique à T1 (étapes 3-4). Recette éprouvée
historiquement sur `sainte-catherine` (« calage 3-GCP », ADR-0023).

### 2.3 Étiquettes glyphes — OCR validé par dictionnaire réglementaire

Certains plans ont les codes en **glyphes** (non sélectionnables) → l'OCR positionné
(tesseract) donne la **position** fiable mais **corrompt le code** (`Re3y`, `Rez3`…).
Solution anti-invention : construire le **dictionnaire des codes réglementaires RÉELS**
(depuis les annexes du règlement de zonage, ou la grille de normes), puis **snapper**
chaque étiquette OCR au code valide le plus proche par distance d'édition **seulement
si non-ambigu** ; sinon rejeter l'étiquette. On ne sert que si le taux de snap
non-ambigu dépasse un seuil (ex. 80 %).

### 2.4 Gates QA anti-invention (communs T1/T2/OCR)

`≥3` codes lettrés distincts · rejet des codes séquentiels purs / affectation
(CMM/PMAD/SAD/`milieux_humides`/inondable/agricole) · gate spatial : centroïde des
étiquettes dans la bonne municipalité (gaffe homonymes : `saint-mathieu` vs
`-de-beloeil`, `dorval` vs `lile-dorval`) · géométrie = lots cadastraux réels uniquement.
Voir [`zonage-acquisition-qa-gate`](../../) (mémoire projet).

---

## 3. Implémentation TypeScript (0 Python, 0 GDAL)

| Module | Rôle | Moteur |
|---|---|---|
| `acquisition/src/lib/t1-zones.ts` | agrégation cadastre nearest-label + InteriorPointArea | Claude 4.8 |
| `acquisition/src/lib/t1-georef.ts` | géoréf embarqué (`/GPTS /Measure /VP /GCS`) → affine `proj4` ; `fitAffine` exporté | Claude 4.8 |
| `acquisition/src/lib/t1-labels.ts` | étiquettes `pdftotext -bbox-layout` (+ extraction mono-page) | Claude 4.8 |
| `acquisition/src/t1-build.ts` | CLI T1 bout-en-bout + gates QA | Claude 4.8 |
| `acquisition/src/lib/t2-georef.ts` | calage ≥3 GCP, affine moindres carrés (réutilise `fitAffine`) | Codex 5.5 |
| `acquisition/src/t2-build.ts` | CLI T2 (GCP JSON + PDF + cadastre → serve) | Codex 5.5 |
| `acquisition/src/t2-georef-ui.ts` | UI locale Leaflet : PDF rasterisé + fond carte + capture GCP + preview/serve | Codex 5.5 |
| `acquisition/src/lib/zone-serve.ts` | contrat de serving partagé (`haversineKm`, `mergeByZoneCode`) | Codex 5.5 |
| `acquisition/src/t1-ocr-build.ts` + `lib/t1-labels-ocr.ts` | snap OCR positionné → dictionnaire réglementaire validé | Codex 5.5 |

Le port T1 reproduit **bit-exact** la recette Python legacy de référence
(`work/legacy-geo-quebec/saint-mathieu/build_zones.py`) — voir §5.

---

## 4. Équivalence bi-moteur (Claude 4.8 « xhigh » ⊕ Codex GPT-5.5 « xhigh »)

### 4.1 Production mesurée

**Claude Opus 4.8 (xhigh)** — port déterministe + T1 auto :
- Porté `build_zones.py` → TS (commits `9a3f9c3`, `7f87428`, `7b7307c`).
- **Golden vert** : `saint-mathieu` bit-exact (8447/8447 lots, 55 features, 0 écart sur
  57 codes) ; `saint-amable` 103/104 codes, 104 features, 90,6 % lot→zone (golden 85,7 %).
- Servi (géoréf embarqué) : **delson** (97 zones, 3330/3330 lots, résidu 0,29 m),
  **la-prairie** (263/267 codes/91,5 %/1,17 m), **candiac** (218/229/100 %/0,29 m),
  **saint-mathieu** (35/38/99,9 %/0,30 m).
- Benchmark : **~3,8 s/ville**, ~340 Mo RAM, $0 OCR, 0 GDAL/cloud/humain.
- Découverte structurante : seuls 4/13 plans focus ont un vrai géoréf embarqué (les 9
  autres = `/RL` CAD → relèvent du T2).

**Codex GPT-5.5 (xhigh)** — outil T2 interactif + OCR-validé :
- Construit l'outil **T2 3-GCP** (CLI + UI Leaflet + helpers partagés) + tests **4/4**
  (commit `1b66b72`, après reprise du commit bloqué par un `.git` read-only côté sandbox).
- Servi **saint-philippe** via calage 3-GCP (gates QA passés : résidu < 50 m, ≥3 codes,
  gate spatial).
- Servi **pointe-claire** via OCR validé : dictionnaire = règlement **PC-2775 annexe 3**
  (274 codes réels) ; **253/294** étiquettes snappées sans ambiguïté (86,1 %), 41
  rejetées, 165 codes distincts validés. (A correctement **écarté** une sortie Mistral
  OCR `Re1..Re70` séquentielle suspecte — réflexe anti-invention.)

### 4.2 Verdict de parité

Les deux moteurs ont **livré une implémentation correcte, testée, anti-invention tenue**,
de parties **complémentaires** du même algorithme — Claude le noyau déterministe (port +
golden + T1 auto), Codex la couche interactive (T2 3-GCP + OCR validé). Chacun réutilise
les primitives de l'autre (`fitAffine`, `zone-serve`). **Conclusion opérationnelle :
l'un peut prendre le relais de l'autre** — la chaîne n'est pas captive d'un fournisseur,
ce qui a permis de continuer quand le quota Claude s'est épuisé.

### 4.3 Notes opérationnelles

- **Sandbox Codex** : `.git` en lecture seule → Codex ne peut pas committer/pusher
  lui-même ; le dépôt S3 (writable) réussit, mais **le code doit être committé par un
  porteur à `.git` writable** (ici Claude conducteur). À prévoir dans tout pipeline Codex.
- **Quota** : Claude (souscription) et Codex (GPT) ont des limites indépendantes ;
  alterner les deux évite le throttle/épuisement d'un seul. Effort : « xhigh » des deux côtés.
- **Coût** : T1 auto ≈ $0 OCR ; OCR-validé ≈ $0,001/ville ; T2 = temps humain de calage
  (~5-10 min/ville) ou GCP autonome de l'agent sous gate de résidu.

---

## 5. Résultats & reproductibilité

Au moment de cet article, **focus-30 = 14/30** servies proprement (dont 6 par cette
chaîne : delson/la-prairie/candiac/saint-mathieu en T1, saint-philippe en T2,
pointe-claire en OCR-validé). Endpoints : `https://api.geo.sent-tech.ca/collections/qc-zonage-<slug>/items`.

Reproduire : `npx tsx acquisition/src/t1-build.ts --slug <slug> …` (T1) ;
`npx tsx acquisition/src/t2-build.ts --slug <slug> --gcp <fichier.gcp.json> …` (T2) ;
golden : `npx vitest run acquisition/src/lib/t1-zones.test.ts acquisition/src/lib/t2-georef.test.ts`.

---

## 6. Références

**Standards & méthode**
- Geospatial PDF / « GeoPDF » : ISO 32000 (PDF) + extensions géospatiales Adobe/OGC —
  dictionnaires `/VP`, `/Measure` (`/GEO`), `/GPTS`, `/LGIDict`.
- Géoréférencement par points de contrôle (GCP) → transformation affine par moindres
  carrés ; cf. modèle GDAL (`gdal_translate -gcp`, `gdalwarp`) — ici réimplémenté en
  pur-Node via `proj4`.
- `proj4js` / EPSG : reprojection NAD83 (MTM/Lambert) → WGS84.
- Cadastre du Québec (parcellaire officiel) — donnée ouverte (Données Québec).

**Artefacts internes (vérifiables)**
- Recette de référence : `work/legacy-geo-quebec/saint-mathieu/build_zones.py`.
- ADR-0023 (résolution zonage T1/T2) ; `work/immo-audit/zonage-resolution.md`,
  `gisement-mrc.md`, `INVENTAIRE-scraping-qc.md`.
- Rapports de run : `work/delegation-mass/T1-PORT-DELSON.md`, `T1-ROLLOUT.md`,
  `GCP3-UI-CODEX.md`, `POINTE-CLAIRE-CODEX.md`.
- Commits : `9a3f9c3`, `7f87428`, `7b7307c` (Claude T1) ; `1b66b72` (Codex T2/OCR).
- Garde anti-invention : mémoire projet `zonage-acquisition-qa-gate`, contrat
  [`contrat-jointure-immo-zones-lots.md`](./contrat-jointure-immo-zones-lots.md).
