# Cityweft, reconstruit en full open source — au service des projets immobiliers

> Étude produit + plateforme. Objectif : rendre le même service que Cityweft (et l'étendre vers la
> faisabilité immobilière) en **100 % open source**, avec un modèle économique radical :
> **on ne facture aucune licence ; on facture uniquement le compute (IA + infra) ; et on ne facture
> rien quand le résultat a déjà été calculé.** Capitaliser pour mutualiser, rediffuser à moindre
> coût = leitmotiv Sentropic.
>
> Date : 2026-06-22. Repo d'ancrage : `/home/antoinefa/src/geo-quebec`. Stack imposée : **Node/TypeScript
> uniquement** (cf. note mémoire « no-python-in-geo » : le prototype Python existant doit être porté en TS).

---

## 1. Ce qu'est Cityweft (résumé produit factuel, sourcé)

**Cityweft** (fondée 2024, Tallinn ; CEO Alexander Groth ; ~484 k$ levés via Antler + Proptechfonden)
se définit comme **« the geospatial data layer for the built environment »**. Le produit génère,
**à la demande et n'importe où dans le monde, un modèle de site 3D contextuel** (terrain + bâtiments
environnants + infrastructure), géoréférencé, **prêt pour les workflows CAO / BIM / design génératif**.

Ce n'est **pas** un outil de faisabilité ni d'analyse de zonage : c'est un **générateur de contexte
3D** qui supprime la modélisation manuelle de l'environnement d'un projet. Le blog et les pages
produit ne mentionnent ni *feasibility réglementaire*, ni *zoning analysis*, ni *site selection*, ni
*due diligence* — uniquement massing, contexte de site, études vent/soleil/ombres, rendus.

**Cible** : professionnels AEC (architectes, ingénieurs, studios, équipes BIM), + développeurs via API,
+ PropTech / risque climatique / gaming en cas d'usage secondaires.

**Entrée utilisateur** : on **dessine un polygone** sur une carte (ou on fournit des coordonnées),
on choisit éventuellement le modèle de toiture par défaut, le nombre d'étages par défaut, la
topographie ; on génère.

**Sortie / livrables** : modèle 3D éditable, en couches structurées (topographie, bâtiments,
barrières/clôtures, surfaces, infrastructure), avec métadonnées par bâtiment (hauteur, forme de toit,
empreinte), géoréférencement WGS84, nord vrai préservé. Export dans **10+ formats** :
3DM, SKP, DXF, GLB, GLTF, IFC, OBJ, PLY, STL, DAE, GeoJSON.

**Canaux** : plateforme web (`app.cityweft.com`), **API REST**, et **plugins natifs** (Rhino 7/8,
SketchUp, Autodesk Forma).

**API** (doc GitBook) — modèle d'I/O remarquablement simple et révélateur du modèle de facturation :
- Auth : `Authorization: Bearer <token>`.
- **Un seul endpoint** : `POST https://api.cityweft.com/v1/context`.
- Corps : `polygon` (tableau `[lat,lon][]` fermé) **obligatoire** + `settings` + `origin` optionnels.
  `settings` : `defaultRoofType`, `defaultLevels`, `defaultLevelHeight`, `topographyModel`,
  `geometry` (types à retourner), `cropScene`.
- Réponse JSON : `origin` + `geometry[]` où chaque entrée a `type`
  (`buildings|surface|barriers|infrastructure|topography`), `geometryType`
  (`meshes|nodes|elevationMaps`) et les `meshes[].vertices` (XZY : X=est, Z=altitude, Y=nord).

**Données sources** (déclaratif) : OpenStreetMap, Google Open Buildings, Microsoft ML Buildings,
Esri Community Buildings pour la couverture globale ; **cadastres nationaux faisant autorité + 3D haute
fidélité (hauteurs, toits, empreintes vérifiées)** pour **12 pays premium** (Belgique, **Canada**,
Danemark, France, Allemagne, Japon, Pays-Bas, Norvège, Pologne, Espagne, Suisse, Royaume-Uni).
**Topographie** : DEM survey-grade là où dispo (Suisse 25 cm, Danemark 40 cm, France/UK 1 m) ;
sinon DEM globaux gradés (« <2 m / 2–5 m / 5–15 m / >15 m »). Couverture annoncée : 200+ pays,
3 G+ bâtiments indexés.

**Tarification** (le point clé pour notre modèle) — **facturation à l'aire, au km²** :
- *Pro Export* (pay-as-you-go) : à partir de **30 €/km²**, ≤ 10 km²/export.
- *Packs* (1 unique, 12 mois) : ex. **150 € / 20 km²** = 7,50 €/km², options 5/20/50/100 km².
- *Professional* : 99 €/mois, 20 km²/mois inclus.
- *Small Business* : 199 €/mois, 100 km², 3 sièges.
- *Business* : 499 €/mois, 1000 km², sièges illimités.
- *Enterprise* : sur devis. *Étudiants* : gratuit < 1 km².

> **Lecture stratégique.** L'unité de valeur facturée par Cityweft est **l'aire générée (km²)**, pas
> le siège ni la licence logicielle. C'est presque déjà un modèle « compute-only » déguisé : ils
> facturent un proxy de coût de génération. **Mais** ils refacturent la même aire à chaque client et à
> chaque export — alors que le coût marginal de re-servir un km² déjà calculé sur **données publiques**
> est ~0. **C'est exactement la marge que notre modèle mutualisé attaque.**

**Concurrents / voisinage de marché** (pour cartographier les fonctions) :
- *Contexte 3D* (même créneau que Cityweft) : Blender-GIS/OSM2World/CADmapper-like, Google Photorealistic 3D Tiles.
- *Faisabilité / massing / zonage* (l'extension immo qu'on vise) : **TestFit** (site solver,
  FAR/setbacks/parking/financier), **Deepblocks** (site funneling + rapports de zonage + massing
  conforme + ROI), **UrbanFootprint** (site selection / urban analytics), Saturate, Forma (Autodesk).
- *Briques data/géo open* : OSM/Overpass, GDAL/GEOS, Turf.js, PDAL-like (LiDAR), MapLibre, deck.gl.

Sources : cityweft.com/fr, /fr/pricing, /fr/for-business, /fr/integrations/api, /coverage,
cityweft.gitbook.io/docs (+ quickstart), post Graphisoft ; Crunchbase, PitchBook, AEC Magazine,
aecplustech, aechub.

---

## 2. Décomposition fonctionnelle

| # | Fonction | Input | Output | Valeur pour un projet immobilier |
|---|----------|-------|--------|----------------------------------|
| F1 | **Contexte 3D de site** (cœur Cityweft) | polygone/bbox | maillage bâtiments + terrain + surfaces + barrières, géoréf WGS84, formats CAO/BIM | base de tout : massing voisin, échelle, rendus, études vent/soleil/ombre |
| F2 | **Terrain / DEM** | bbox + résolution | elevation map + mesh terrain | pentes, plateformes, déblai/remblai, drainage, accessibilité PMR |
| F3 | **Métadonnées bâtiments** | empreintes + sources hauteur | hauteur, étages, type de toit, empreinte, usage | gabarit réglementaire, vis-à-vis, ensoleillement, COS/CES voisins |
| F4 | **Extraction de zonage** (notre extension) | PDF/plan municipal + cadastre + OSM | polygones de zones géoréférencés + code de zone | savoir CE QUI est constructible et SOUS QUELLES règles — manquant chez Cityweft |
| F5 | **Association lot ↔ zone** | cadastre + zones | lot → code de zone, stats par zone | rattacher un terrain précis à sa réglementation |
| F6 | **Lecture de règlement (IA)** | règlement de zonage (texte/PDF) | grille normalisée par zone (hauteur max, COS, CES, marges, usages, densité) | transformer du juridique en paramètres calculables |
| F7 | **Constructibilité / enveloppe** | lot + grille de zone + terrain | volume constructible max, surface de plancher max, nb logements théoriques | le chiffre que cherche tout promoteur |
| F8 | **Massing génératif** | enveloppe + contraintes | masses 3D conformes (setbacks/hauteur/FAR) | pré-faisabilité visuelle en secondes |
| F9 | **Accessibilité / isochrones** | graphe routier OSM + point | isochrones marche/vélo/auto, scores de proximité (transit, écoles, commerces) | attractivité, walkability, valorisation |
| F10 | **Voisinage / morphologie** | cadastre + bâtiments + OSM | densité, mixité, taille de lots, fragmentation, tissu urbain | comparables, potentiel de densification |
| F11 | **Potentiel de subdivision** | lot + règles min de lot + accès | scénarios de découpe, nb de lots dérivés | upside foncier |
| F12 | **Due diligence foncière** | lot + couches de contraintes (zonage, environnement, servitudes, risques) | rapport de drapeaux rouges/verts | risque réglementaire et physique avant achat |
| F13 | **Scoring de site** | sorties F4–F12 pondérées | score 0–100 + sous-scores | classer/filtrer des dizaines de sites (site selection) |
| F14 | **Rapport / livrable** | toutes sorties | PDF/Web : cartes, tableaux, 3D, score, synthèse IA | document de décision investisseur/comité |
| F15 | **Exports CAO/BIM/SIG** | géométries | 3DM/SKP/IFC/GLB/GeoJSON… + plugins | continuité de workflow AEC (parité Cityweft) |

**Parité Cityweft** = F1–F3, F15. **Différenciation immobilière** = F4–F14 (là où vivent déjà les
capacités du repo Québec et où l'IA apporte le plus de valeur).

---

## 3. Architecture open-source cible

### 3.1 Diagramme texte (6 briques)

```
                ┌──────────────────────────────────────────────────────────────┐
                │  CLIENTS : Web app (MapLibre/deck.gl) · API REST · Plugins     │
                │  Rhino/SketchUp/Forma · CLI · SDK TS                           │
                └───────────────┬──────────────────────────────────────────────┘
                                │  POST /v1/* (polygon|bbox|lotId + settings)
        ┌───────────────────────▼───────────────────────────────────────────────┐
   (6)  │  API GATEWAY + ORCHESTRATEUR DE COMPUTE  (Node/TS, Fastify)            │
        │  - résout les inputs en clé de cache déterministe (§5)                  │
        │  - CACHE HIT → renvoie l'artefact (FACTURE 0)                           │
        │  - CACHE MISS → planifie un job, mesure tokens IA + temps infra,        │
        │    écrit l'artefact dans le store adressé par contenu, facture le réel  │
        └───────┬───────────────────────────────┬───────────────────────────────┘
                │                                │
   (5) MOTEURS D'ANALYSE (workers TS)            │   (3) COUCHE IA (workers TS)
   ┌──────────────────────────────┐             │   ┌─────────────────────────────┐
   │ context3D (F1-3) · terrain    │             │   │ zoning-extract (F6, vision  │
   │ zoning (F4-5) · buildability  │◀────────────┼──▶│  + texte sur PDF/plans)     │
   │ (F7) · massing (F8) · iso     │   appellent │   │ report-synth (F14)          │
   │ (F9) · morpho (F10) · subdiv  │   @sentropic│   │ georef-assist (GCP picking) │
   │ (F11) · duediligence (F12)    │   /geo      │   │  via modèle Claude          │
   │ · scoring (F13)               │             │   └─────────────────────────────┘
   └───────────────┬──────────────┘             │
                   │  s'appuient tous sur ▼
        ┌──────────────────────────────────────────────────────────────────────┐
   (2)  │  @sentropic/geo  (lib Node/TS géospatiale maison — cœur réutilisable)  │
        │  graphes routiers · features OSM · projections/CRS · intersections ·   │
        │  association lot/zone · géoréférencement · stats morpho  (+backlog §4) │
        └───────────────────────────────┬──────────────────────────────────────┘
                                         │ lit
        ┌──────────────────────────────────────────────────────────────────────┐
   (4)  │  STORE D'ARTEFACTS (content-addressed) : S3/MinIO + métadonnées (PG)   │
        │  artefacts publics rediffusables  ‖  artefacts privés chiffrés/cloison │
        └───────────────────────────────┬──────────────────────────────────────┘
                                         │ alimenté par
        ┌──────────────────────────────────────────────────────────────────────┐
   (1)  │  PIPELINE DE DONNÉES (ingestion TS, jobs batch)                        │
        │  cadastre QC · zonage municipal (PDF) · OSM/Overpass · DEM/LiDAR ·     │
        │  bâtiments (Google/MS/Esri open) → normalisation (zod) → tuiles        │
        └──────────────────────────────────────────────────────────────────────┘
```

### 3.2 Les 6 briques

1. **Pipeline de données** (ingestion + normalisation + stockage source). Jobs TS (`tsx`/`node`,
   `@aws-sdk/client-s3`, `zod`) qui ingèrent : cadastre Québec (GeoJSON/GML), plans de zonage
   municipaux (PDF AutoCAD/GeoPDF), OSM via Overpass, DEM/LiDAR (open gov), empreintes de bâtiments
   open (Google Open Buildings, MS ML, Esri). Normalisation vers un schéma canonique versionné
   (zod), tuilage spatial, dépôt dans le store. **C'est l'ETL géospatial que le repo Québec fait
   déjà** (extraction de traces PDF, GCP, RANSAC/ICP, association lot↔zone), à **porter en TS**.

2. **`@sentropic/geo`** (lib géospatiale maison, réutilisable, open source) — voir §4 pour le backlog.
   Toutes les analyses s'y appuient ; Turf.js + GEOS-wasm (ou `geos-wasm`/`jsts`) en dépendances bas
   niveau, proj4 pour les CRS.

3. **Couche IA** (workers TS appelant l'API Claude) — voir §3.3.

4. **Store d'artefacts content-addressed** (S3/MinIO + Postgres pour les métadonnées/clé→hash) ;
   frontière public/privé (§5.4).

5. **Moteurs d'analyse** (workers TS, un par fonction F1–F13), déterministes et versionnés. Chaque
   moteur déclare : sa version d'algo, ses inputs canoniques, s'il produit un artefact public ou privé.

6. **API gateway + orchestrateur de compute** (Fastify/Hono) : c'est **le cerveau économique** —
   résolution de clé de cache, hit/miss, mesure et facturation du réel, écriture content-addressed.
   Parité d'API avec Cityweft (`POST /v1/context` polygon-in / meshes-out) **plus** des endpoints
   immo (`/v1/zoning`, `/v1/buildability`, `/v1/site-score`, `/v1/report`).

### 3.3 Couche IA — où l'IA crée de la valeur (reliée au repo)

- **Extraction de règlements de zonage (F6)** : le repo associe déjà lot↔zone et produit des stats,
  mais **la grille de règles par zone (hauteur, COS, CES, marges, usages) reste à extraire du texte
  réglementaire**. C'est le job IA #1 : *vision + texte sur PDF de règlement* → JSON normalisé (zod),
  avec citation de l'article source pour traçabilité. Modèle : **Claude** (API Anthropic), prompt
  structuré + sortie validée par schéma.
- **Assistance au géoréférencement (georef-assist)** : aujourd'hui le repo lit des amers « à l'œil »
  (cf. `petite-riviere/fusion/vision_landmarks.json` saisis manuellement). L'IA vision peut
  **proposer des GCP** (lire les noms de rues/amers sur le rendu du plan) → alimente le RANSAC/ICP
  existant. Garde le déterministe en aval (le calcul reste vérifiable), l'IA n'est qu'un *suggéreur*.
- **Synthèse de rapport (F14)** : transformer les sorties chiffrées en narratif de décision
  (forces/risques, comparables, recommandation) avec garde-fous (chiffres injectés, pas hallucinés).
- **Lecture de plans / PDF divers** (servitudes, certificats de localisation) en due diligence.

> Principe : **l'IA propose, le moteur géométrique déterministe dispose.** Tout livrable chiffré
> doit être reproductible sans l'IA ; l'IA accélère l'extraction et la rédaction, pas le calcul de vérité.

---

## 4. Ce que `@sentropic/geo` doit fournir en plus (backlog geo)

Base supposée déjà présente : graphes routiers, features OSM, projections, intersections, association
lot/zone, géoréférencement, stats morpho. **8 capacités à ajouter** (extraites directement des besoins
du repo Québec et des fonctions F2–F13) :

1. **Géoréférencement de plans raster/PDF** : portage TS du pipeline existant — extraction de traces
   vectorielles PDF (équivalent `mutool draw -F trace`), décodage GeoPDF `/Measure /GEO`, fitting
   **affine/similarité RANSAC**, **ICP + PCA** de contour (boundary-match), **fusion multi-signal
   IRLS (Tukey biweight)**, plus les **garde-fous de qualité** (IoU contour, résidu médian m,
   Hausdorff, ambiguïté d'orientation). *(C'est aujourd'hui en Python : `parse_trace`, `georef`,
   `boundary_match`, `fuse_irls`, `georef_sr` — à porter.)*
2. **Reconstruction de polygones de zones depuis un maillage de bordures** : union de triangles →
   « murs » → différence/`polygonize` → faces → étiquetage par point-in-polygon des codes de zone
   (cf. `rosemere/zones.py`). Robustesse géométrique (`make_valid`, buffer±).
3. **Extraction de texte/glyphes positionnés** depuis PDF (runs de glyphes, fontes, matrices) pour
   reconstituer noms de rues et codes de zone (cf. `saint-mathieu/extract_glyphs.py`).
4. **Terrain / DEM** : lecture de DEM (GeoTIFF/COG), génération de mesh terrain, calcul de pente,
   exposition, déblai/remblai, drapage de géométrie sur terrain (F2). Manque total aujourd'hui.
5. **Enveloppe constructible (buildability)** : à partir d'un lot + grille de règles → application des
   marges/setbacks (offset négatif robuste), hauteur max, **calcul de COS/CES/FAR**, surface de
   plancher et nb de logements théoriques ; sorties paramétriques pour le massing (F7/F8).
6. **Isochrones & accessibilité** sur le graphe routier déjà présent : Dijkstra/A* multi-modal,
   polygones d'isochrone, scores de proximité aux POI/transit (F9).
7. **Subdivision / scénarios fonciers** : découpe de lot sous contraintes (façade min, profondeur,
   accès voirie) → comptage de lots dérivés (F11) ; **overlay de contraintes** (servitudes, zones
   inondables, milieux humides) pour la due diligence (F12).
8. **Couche tuilage + I/O d'export** : tuilage spatial déterministe (clé de tuile = base du cache,
   §5), et **exports multi-format** (GeoJSON natif, glTF/GLB, IFC, OBJ, 3DM) — parité Cityweft (F15).

Transverse : tout exposé en **TS pur** (Turf/geos-wasm/jsts + proj4), avec pour chaque opération une
**version d'algorithme** (`algoVersion`) injectée dans la clé de cache.

---

## 5. Le moteur **compute-only + cache mutualisé** (design technique détaillé)

C'est le cœur de la demande : **ne jamais refacturer un calcul déjà fait**, et faire tendre le coût
marginal des calculs sur **données publiques** vers ~0 pour la communauté.

### 5.1 Modèle de coût (zéro licence)

Prix d'une requête = **coût réel mesuré**, sans marge de licence :

```
prix = (tokens_in·p_in + tokens_out·p_out)         // coût IA réel (API Claude), si la requête en a
     + (cpu_seconds·p_cpu + gpu_seconds·p_gpu)      // temps infra worker réel
     + (octets_servis·p_egress)                     // egress/stockage marginal
     + frais_plateforme_fixe_minime                 // soutenable, transparent, optionnel
```

- **Cache HIT (artefact déjà calculé)** → `prix = coût de service seul (≈ egress)`, et pour un
  artefact **public** rediffusable on peut viser **prix = 0** (servi depuis CDN/communauté).
- **Cache MISS** → on calcule, on **mesure** (compteurs par job : tokens, CPU/GPU s, octets), on
  facture le réel, on **publie l'artefact** pour que personne ne repaie ce calcul.
- Transparence totale : chaque facture renvoie le `cacheKey`, le statut hit/miss, et la ventilation.

### 5.2 Clé de cache déterministe

```
cacheKey = blake3(
   canonicalize({
     op:            "buildability",         // nom du moteur
     algoVersion:   "buildability@1.4.0",   // version d'algo (invalide à chaque bump)
     inputs: {                              // inputs CANONIQUES (pas l'objet requête brut)
       geometry:    quantize(polygon, grid=1e-6),   // arrondi déterministe (évite le bruit flottant)
       params:      sortedSettings,                  // settings normalisés/triés/défauts résolus
       dataRefs: [                                    // hashes des datasets sources utilisés
         "cadastre-qc@2026-05",                       // versionnés → invalidation par version data
         "osm-tile/15/9637/11534@2026-06-15",
         "zoning-rosemere@v3"
       ]
     }
   })
)
```

Propriétés :
- **Déterministe** : mêmes inputs canoniques + même `algoVersion` + mêmes `dataRefs` ⇒ même clé.
- **Quantification** des géométries (grille fixe) pour que deux polygones « identiques au flottant
  près » tombent sur la même clé (taux de hit ↑).
- **Invalidation par version** : bump d'`algoVersion` **ou** d'un `dataRef` ⇒ nouvelle clé,
  ancien artefact conservé (immutable, reproductible a posteriori). Pas d'invalidation destructive.
- **Composition** : un moteur de haut niveau (site-score) référence dans sa clé les `cacheKey` des
  sous-résultats (zoning, buildability, iso) → un graphe de dépendances de cache (mémoïsation type
  build system / Nix / Bazel). Recalcul minimal quand une seule brique change.

### 5.3 Store adressé par contenu (content-addressed)

- Artefact stocké à `s3://artifacts/<blake3(content)>` ; table Postgres `cacheKey → contentHash →
  {bytes, métriques de coût, algoVersion, dataRefs, visibility, license, createdAt}`.
- **Dédup naturelle** : deux requêtes différentes produisant le même contenu pointent le même blob.
- **Immutable + reproductible** : on peut rejouer un calcul historique (audit, litige, science).
- Self-host : MinIO + Postgres ; service mutualisé : S3 + CDN public pour les artefacts publics.

### 5.4 Frontière public / privé (qui est rediffusable)

| Type d'artefact | Dérivé de… | Visibilité | Rediffusable | Facturation au 2e demandeur |
|---|---|---|---|---|
| Zonage normalisé, lot↔zone, isochrones, contexte 3D, morpho | **données publiques** (cadastre, zonage, OSM, DEM open) | **public** | **Oui** (licence ouverte) | **0** (servi du cache/CDN communautaire) |
| Buildability/massing sur un **lot public**, paramètres standard | données publiques + algo public | **public** | Oui | 0 |
| Étude liée à un **projet client** (programme privé, hypothèses confidentielles, document fourni) | inputs privés | **privé** | Non | recalcul facturé (mais sous-résultats publics réutilisés gratuitement) |
| Sortie mixte (lot public + paramètres privés du promoteur) | mixte | **privé**, mais **sous-clés publiques extraites** | partiellement | seul le delta privé est facturé |

Règle d'or : **un artefact est public ssi tous ses `dataRefs` et tous ses inputs sont publics.** Sinon
privé, chiffré, cloisonné par tenant. La **décomposition** (5.2 composition) est ce qui permet, même
dans une étude privée, de **réutiliser gratuitement** les briques publiques (le zonage d'une commune
ne se recalcule jamais deux fois) et de ne facturer que la part réellement privée.

### 5.5 Économie du partage (coût marginal → 0, redistribué)

- **Capitalisation** : chaque MISS public enrichit un **bien commun** (le cache public est un dataset
  ouvert qui grossit). Plus la communauté calcule, plus le coût attendu d'une requête future baisse.
- **Pré-calcul opportuniste** : remplir le cache public en batch pour les zones à forte demande
  (grandes villes, communes traitées) ⇒ requêtes ultérieures servies à 0.
- **Mutualisation des frais** : le coût d'un MISS public peut être (a) porté par le premier demandeur,
  (b) sponsorisé (municipalité, fonds commun), ou (c) amorti par un micro-pool ; les HIT suivants
  étant gratuits, **le coût total/utilisateur décroît avec l'adoption** — l'inverse d'une licence.
- **Anti-gaspillage** : pas de double facturation d'un même calcul ; le `cacheKey` rend la non-double-
  facturation **prouvable** (on peut montrer le hit). Incitation à publier (artefacts publics =
  réputation/crédits communautaires éventuels), self-host = coût compute à prix coûtant.
- **Fédération** : plusieurs instances self-host peuvent **partager le même registre de hash** et
  échanger les artefacts publics (un calcul fait ailleurs n'est jamais refait) — réseau de cache
  pair-à-pair par contenu.

---

## 6. Modèle open source (licence, hébergement, gouvernance)

- **Licence code** : `@sentropic/geo` et le SDK clients en **Apache-2.0** (permissif, adoption AEC,
  clause brevets). Le **service/serveur** (orchestrateur, web app) peut être en **AGPL-3.0** pour
  préserver le commun (toute amélioration du service hébergé revient à la communauté) — combo
  « lib permissive + service copyleft » classique et défendable.
- **Licence données / artefacts publics** : aligner sur les sources. OSM = **ODbL** (share-alike,
  attribution). Zonage/cadastre municipaux : souvent **non rediffusables** (cf. meta du repo :
  `"redistributable": false` pour Rosemère ; géométrie *dérivée* via OSM ODbL). ⇒ le cache public ne
  publie que ce que la licence source autorise ; sinon l'artefact reste **calculable mais
  non-rediffusable** (servi seulement à qui a le droit à la source). Chaque artefact porte ses
  champs `license` + `attribution` (déjà présents dans les `*.meta.json` du repo).
- **Self-host vs service mutualisé** :
  - *Self-host* (MinIO+PG+workers, `docker compose`) : souveraineté data, coût compute à prix coûtant,
    idéal municipalités/bureaux d'études. Peut se **fédérer** au registre de hash public.
  - *Service mutualisé* (hébergé) : commodité, cache public chaud, facturation compute-only ;
    données privées clients chiffrées et cloisonnées.
- **Gouvernance** : noyau `@sentropic/geo` en open governance (CONTRIBUTING, RFC d'`algoVersion`,
  versionnage sémantique des algos car il impacte le cache). Un **registre public de datasets**
  (avec licences) gouverné comme un commun. Modèle de soutenabilité : facturation compute du service
  hébergé + sponsoring de pré-calculs publics, **pas** de licence.

---

## 7. Roadmap MVP → V1

**Phase 0 — Socle (port TS).** Porter le pipeline Python existant en TS dans `@sentropic/geo` :
trace PDF, georef RANSAC/ICP/IRLS, reconstruction de zones, association lot↔zone, stats morpho
(backlog §4.1–§4.3). Sortir 2–3 communes Québec déjà faites (Rosemère, Sainte-Cécile, Saint-Mathieu)
comme golden tests. Schémas zod canoniques. *Livrable : lib TS + datasets normalisés versionnés.*

**Phase 1 — MVP cache compute-only.** Orchestrateur (Fastify) + store content-addressed + clé de
cache déterministe + compteurs de coût + frontière public/privé. Un endpoint de parité Cityweft
(`/v1/context` polygon→meshes, via empreintes OSM/open buildings + DEM) **et** `/v1/zoning` (zones
Québec). Web app MapLibre minimal (dessiner polygone → résultat + facture hit/miss transparente).
*Livrable : « ne refacture jamais un calcul déjà fait » démontré sur le Québec.*

**Phase 2 — Valeur immo.** Couche IA d'extraction de règlement (F6, Claude) → grille de zone
normalisée ; moteurs buildability (F7) + isochrones (F9) + morpho (F10). Rapport/score de site
(F13/F14). Terrain/DEM (§4.4). *Livrable : pré-faisabilité réglementaire automatisée sur un lot.*

**Phase 3 — Parité AEC + écosystème.** Exports IFC/3DM/GLB + plugins Rhino/SketchUp/Forma (parité
Cityweft F15). Massing génératif (F8), subdivision (F11), due diligence (F12). Couverture data
au-delà du Québec (archi généralisée). *Livrable : parité Cityweft + différenciation immo.*

**Phase 4 — Commun mutualisé / fédération.** Registre public de hash, pré-calcul des grandes zones,
fédération inter-instances, sponsoring de calculs publics, gouvernance ouverte. *Livrable : coût
marginal communautaire → 0.*

---

## 8. Risques

- **Données / licences** : beaucoup de plans de zonage municipaux **ne sont pas rediffusables** (le
  repo le note déjà). Mitigation : publier la *géométrie dérivée* via OSM/ODbL quand permis, sinon
  artefact calculable mais à diffusion restreinte ; champ `license` obligatoire par artefact.
- **Légal / réglementaire** : une enveloppe constructible ou un avis de zonage **n'est pas un avis
  juridique** ni une garantie d'obtention de permis. Mitigation : traçabilité (citation de l'article
  de règlement par l'IA), disclaimers, score de confiance, « human-in-the-loop ».
- **Qualité du géoréférencement** : le repo montre que certaines communes échouent les garde-fous
  (Petite-Rivière différée, IoU 0,89 ; Saint-Raymond couverture 63 %). Mitigation : **conserver les
  garde-fous** (IoU/résidu/Hausdorff) comme contrat de qualité ; ne déposer/diffuser que les
  artefacts qui passent ; exposer la confiance dans la facture/rapport.
- **Hallucination IA** sur l'extraction de règles et la rédaction. Mitigation : sorties validées par
  schéma (zod), chiffres injectés non générés, vérification déterministe en aval, citations sources.
- **Adoption** : le marché AEC est outillé (Rhino/Revit/Forma) ; sans plugins, friction. Mitigation :
  parité d'API/format dès le MVP, plugins en Phase 3, valeur immo (faisabilité) comme différenciateur
  que Cityweft n'offre pas.
- **Soutenabilité du modèle compute-only** : risque de ne pas couvrir les coûts fixes. Mitigation :
  micro-frais de plateforme transparent sur les MISS, sponsoring de pré-calculs publics, offre
  hébergée managée pour les pros — tout en gardant **zéro licence**.
- **Cohérence de cache** : un changement d'`algoVersion` mal versionné casserait la non-double-
  facturation. Mitigation : versionnage sémantique strict des algos, RFC, golden tests par version,
  cache immuable (jamais d'écrasement).
