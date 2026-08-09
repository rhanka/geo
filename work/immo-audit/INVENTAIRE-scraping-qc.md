# INVENTAIRE exhaustif — acquisition/scraping géospatial Québec (geo)

> **But** : retracer layer-par-layer TOUT le travail d'acquisition de données géospatiales QC fait dans ce repo, essais inclus (réussis, abandonnés, remplacés), pour servir de base au plan cible.
> **Repo** : `/home/antoinefa/src/geo` · **Branche** : `feat/cadre-acquisition` · **HEAD** : `690293b` (désagrégation des agrégats ArcGIS zonage).
> **Méthode** : croisement git-log + code (acquisition/, packages/, scripts/, deploy/) + docs/ADR + **comptes RÉELS mesurés en direct** sur le bucket S3 `sentropic-geo` et l'API OGC `https://api.geo.sent-tech.ca/collections` le 2026-06-22. Lecture seule.
> **Convention de comptage** : tout chiffre ci-dessous est MESURÉ (S3 ListObjectsV2 / OGC live / `wc`/parse de fichiers du repo). Quand un chiffre n'est pas mesurable ici, c'est dit explicitement.

---

## 0. Vue d'ensemble des comptes mesurés

**Bucket S3 `sentropic-geo` (préfixes racine)** : `normalized/`, `registry/`, `sources/`, `pmtiles/`, `raw/`, `deferred/`, `exchange/` + fichiers `catalog.json`, `README.md`.

| Préfixe S3 | Objets | Slugs/munis distincts | Taille |
|---|---:|---:|---:|
| `normalized/qc-cadastre-lots/` | 2205 | **1102 munis** (1102 `.geojson` + 1103 `.meta.json`) | 6,17 Go |
| `normalized/qc-cadastre-lots-preclip/` | 1080 | **1080 munis** (backups pré-clip) | 12,13 Go |
| `normalized/qc-admin-boundaries/` | 2 | 1 geojson + 1 json (frontières SDA) | 4,9 Mo |
| `normalized/ca-qc-sda/` | 6 | 3 geojson + 3 json | 6,7 Mo |
| `normalized/ca-qc-zonage/` | 527 | 118 dirs ArcGIS bruts + **61 dirs per-muni désagrégés** + ~28 geojson top-level (PDF/POC) + 1 anchors | 816 Mo |
| `deferred/ca-qc-zonage/` | 4 | 1 collection mise en attente | 0,8 Mo |
| `registry/index-immo/` | 1103 | **1102 parquet** + 1 manifest | 50,7 Mo |
| `registry/role-foncier/` | 1095 | **1095 parquet** | 233 Mo |
| `registry/qc-zonage-norms/` | 26 | **25 parquet** + 1 manifest (24 entries) | 0,5 Mo |
| `registry/lot-attrs/` | 1 | **1 parquet** (à peine amorcé) | ~0 |
| `sources/qc-zonage-grilles/` | 41 | 39 PDF + 2 json (manifestes grilles stagées) | 451 Mo |
| `raw/zonage-pdf/` | 11 | 11 PDF bruts | 48,5 Mo |
| `raw/zonage-vision/` | 4 | 1 png + 1 geojson + 1 .py + 1 .sh (debug vision) | 31,6 Mo |
| `raw/zonage-ocr-audit/` | 4 | 4 geojson (audit OCR) | ~0 |
| `pmtiles/` | 2 | `qc-lots.pmtiles`, `qc-zones.pmtiles` | — |
| `exchange/geo-immo/` | 1 | 1 json (échange immo) | ~0 |

**API OGC live (2026-06-22)** : **2574 collections** servies, dont :
- `qc-lots-*` : **1102** (= cadastre lots, 1 par muni).
- collections « nues » (nom de muni, sans préfixe `qc-`) : **1080** = *alias lots* per-muni (mêmes données cadastre, props `NO_LOT/level/code` — vérifié : `abercorn`=1822 feats, `acton-vale`=5305, `alma`=12264). C'est un **double nommage** des lots, pas une nouvelle donnée.
- `qc-zonage-*` : **387** = **118** `*-arcgis` (couches ArcGIS brutes agrégées) + **269** non-arcgis (≈99 1:1 munis dont 61 désagrégés + couches CKAN multi-thèmes des grandes villes).
- `anchors-*` : 1 (points d'ancrage zone-code PDF, ex. `anchors-saint-frederic`=23 points).
- autres `qc-*` : 4 (`qc-municipalites`=1343 polygones SDA, `qc-mrc`, `qc-regions`, `qc-cadastre-lots` placeholder vide).

> ⚠️ **Note d'honnêteté structurelle (état de branche)** : sur la branche `feat/cadre-acquisition`, `packages/geo-sources-americas` n'a que son **`dist/` compilé** committé (pas de `src/` ni `package.json`). Le **code source `.ts` du harvest zonage** (`scripts/ca-qc-zonage-arcgis/harvest.mjs`, `harvest-mamh.mjs`, `lib.mjs`, `src/ca-qc-zonage-{arcgis,ckan}/index.ts` — 52 fichiers src) existe bien mais vit sur **`main`** et `feat/qc-zones-lots-acquisition` ; sur cette branche seuls les artefacts compilés + le registre généré (`registry.generated.json`) sont présents (les comptes restent valides : registre `main` committé et `dist/` ici = **118 entries identiques**). Le **harvester cadastre** (`scripts/run-cadastre-lots.mjs`) et **l'acquisition des frontières SDA** ne sont PAS dans ce repo — seules leurs **sorties S3** sont consommées. Les `acquisition/src/*.ts` sont des **ports fidèles TS** d'originaux Python `acquisition/*.py` supprimés (cf. MEMORY « no Python in geo »). `docs/decisions.md` (les ADR) **n'existe pas sur cette branche** — il vit sur `feat/qc-zones-lots-acquisition` (lu via git). **L'implémentation de l'extraction PDF→GeoJSON de l'ADR-0023 (T1/T2/contours) n'est PAS committée sur cette branche** : c'est un design accepté + POC prouvé hors-arbre (artefacts dans `_acquisition-shared/`) ; les sorties (ex. `qc-zonage-saint-amable`, `anchors-saint-frederic`) sont en S3, produites par une exécution hors-branche.

---

## 1. INVENTAIRE LAYER-PAR-LAYER

| # | Layer | Méthode(s) d'acquisition (essais inclus) | Source(s) | Couverture (compte RÉEL) | Stockage (S3 / OGC) | Code (script/package) | Statut |
|---|---|---|---|---|---|---|---|
| 1 | **Frontières admin (SDA / municipalités)** | Téléchargement frontières SDA (MERN) → GeoJSON ; consommé en index local pour le clip. **L'acquisition elle-même n'est pas dans ce repo** (consommée seulement). | SDA — Système sur le découpage administratif, MERN/MRNF (CC-BY 4.0) | **1343 polygones** (`qc-municipalites` OGC) ; 1 fichier `normalized/qc-admin-boundaries/qc-municipalites.geojson` | S3 `normalized/qc-admin-boundaries/` (+ `normalized/ca-qc-sda/`) ; OGC `qc-municipalites`, `qc-mrc`, `qc-regions` | Consommé par `acquisition/src/cadastre-clip-sda.ts` (`SDAIndex`). Acquisition d'origine hors-repo (`@sentropic/geo acquire/`, dist only). ADR-0006. | **Prod** (servi) — code d'acquisition hors-branche |
| 2 | **Cadastre lots (géométrie)** | Moisson **cadastre rénové/allégé** via ArcGIS REST (`Cadastre_allege/MapServer`) par **subdivision quad de bbox** par ville (dédup `NO_LOT`, resumable) ; PUIS **clip à la frontière SDA** par point-in-polygon strict (suppression de la sur-capture d'emprise, backup non-destructif). | ArcGIS REST `geo.environnement.gouv.qc.ca/.../Reference/Cadastre_allege/MapServer` (cadastre allégé du QC, Données Québec) | **1102 munis** (S3 + OGC). **1080** ré-clippés SDA (preclip backup). Total ≈1,78 M lots (ADR-0021 : 40 villes pilotes / 1 782 312 lots). | S3 `normalized/qc-cadastre-lots/<slug>.geojson` (+ `.meta.json`) ; backup `…-preclip/` ; OGC `qc-lots-<slug>` (1102) + alias nus (1080) | Clip : `acquisition/src/cadastre-clip-sda.ts` + `cadastre-clip-province.ts`. Harvest : `scripts/run-cadastre-lots.mjs` (**hors-repo**) + `packages/geo-sources-americas/dist/ca-qc-cadastre/`. | **Prod** (100 % province) — harvester hors-branche |
| 3 | **Rôle foncier (XML MAMH)** | Téléchargement index CSV + XML par muni (`RL{code_geo}_{millesime}.xml`), parse `fast-xml-parser`, jointure `NO_LOT(sans espaces) = RL0103Ax` (matricule) → attrs bâtiment verbatim. | `donneesouvertes.affmunqc.net/role/indexRole2026.csv` + `RL{code}_2026.xml` ; landing `donneesquebec.ca/.../roles-d-evaluation-fonciere` (CC-BY 4.0). Millésime déf. **2026**. | **1095 munis** (parquet S3) | S3 `registry/role-foncier/<slug>.parquet` | `acquisition/src/role-foncier.ts` + `cadastre-role-province.ts` ; adaptateur recueil `packages/qc-sources/src/sources/role-evaluation-mamh.ts` + `-parser.ts` (valeur seule, PII jamais extraite). | **Prod** (99 %) |
| 4 | **Index zéro-copie immo** (cadastre ⋈ rôle ⋈ code_zone) | Jointure SANS copie de géométrie : référence `feature_id`(geoId)+`no_lot`, ajoute `code_zone` (point-in-polygon centroïde sur grille zonage) + attrs rôle (jointure `no_lot` normalisé). Parquet par muni + manifest. | Dérivé interne (cadastre clippé + rôle + grilles zonage S3) | **1102 parquet** (S3). Honnêteté contrat : `code_zone` non-null seulement où grille existe — **~15 munis** avec grille exploitable / **32,99 %** des lots de l'index portent un `code_zone**. | S3 `registry/index-immo/<slug>.parquet` + `manifest.json` (`join_keys=["feature_id","no_lot"]`) | `acquisition/src/build-index-immo.ts` + `cadastre-index-province.ts`. Contrat : `docs/spec/contrat-jointure-immo-zones-lots.md`. | **Prod** (100 % servi ; `code_zone` partiel par nature) |
| 5 | **code_zone sur lots (enrich PIP)** | Back-fill `properties.code_zone` sur le GeoJSON lots depuis l'index immo (lookup `no_lot→code_zone`), seulement si la part non-null > seuil (déf. 50 %). Non-destructif/idempotent. | Dérivé (index immo) | **28 munis** code_zone-isés (status report) ; suit la couverture des grilles | S3 `normalized/qc-cadastre-lots/<slug>.geojson` (clé `code_zone` ajoutée) ; servi via OGC + index | `acquisition/src/enrich-lots-codezone.ts` (le PIP réel est dans `build-index-immo.ts`) | **Partiel** (suit le zonage) |
| 6 | **ZONES spatiales (grilles de zonage)** | **Multiples voies** (cascade) — voir §2 détail. (a) Moisson **ArcGIS Hub/AGOL par compte** (118 endpoints, 61 comptes) ; (b) **CKAN Données Québec** (grandes villes) ; (c) **portails MRC SHP** (ex. Portneuf, `ogr2ogr`) ; (d) **extraction PDF→GeoJSON** (T1 GeoPDF auto-calage cadastre, T2/T4 3-GCP, vision) ; (e) **désagrégation** des agrégats multi-munis ; (f) **essais ratés** (keyword AGOL/CKAN stériles, faux positifs affectation/milieux-humides). | ArcGIS Online/Hub, Données Québec CKAN, portails MRC, PDF municipaux, MELCCFP | **Servi (OGC) : 387 `qc-zonage-*`** = 118 couches ArcGIS brutes + 269 non-arcgis. **Réellement exploitable (grille réglementaire) : faible** — ADR-0023 : sur 302 collections, **~51 vraies grilles** ; `gisement-mrc.md` : **38 mappent 1:1** un muni. **+61 désagrégées** (HEAD 690293b) → **~99 collections 1:1**. Status report : **28 grilles servables** spatialisées (~23-29 munis vectorisés). | S3 `normalized/ca-qc-zonage/` (118 `*-arcgis` + 61 `qc-zonage-<slug>` + ~28 top + anchors) ; OGC `qc-zonage-*` (387) | Désagrég. : `acquisition/src/disaggregate-zonage.ts`. PDF : `acquisition/src/grille-discovery-run.ts`, `lib/geo.ts`, `lot-attrs-geom.ts`. ArcGIS/CKAN : `packages/geo-sources-americas/dist/ca-qc-zonage-{arcgis,ckan}/` (registry 118 endpoints + 53 suppl. ; CKAN 124 datasets/~14 villes). ADR-0023. | **Partiel** (plafond zonage ouvert QC) — désagrégation faite, crawl PDF en cours |
| 7 | **NORMES / grilles de spécifications** (valeurs réglementaires) | Découverte des PDF en **réutilisant le crawler PV** (`grille-discovery`, robots.txt, 2-hop, route-guess `native\|multizone\|vision`) ; **3 routes d'extraction** : (1) texte natif `pdftotext -layout` (grilles horizontales), (2) **vision Mistral multizone** (colonnes), (3) **vision Mistral monozone** (vertical) ; `pdf-ocr` tesseract en réserve (non câblé). | Sites municipaux (règlement de zonage + Annexe A) ; modèle `mistral-medium-latest` API `api.mistral.ai` | **25 parquet déposés** (S3, manifest 24+sherbrooke). **18 jeux en prod** (status report, pilote Sherbrooke). Découverte : `discovered.json`=15 munis (4 multizone/1 vision/10 auto), `munis.json`=18, `discovered-ready.json`=5. **41 PDF** téléchargés localement. | S3 `registry/qc-zonage-norms/<slug>.parquet` + manifest ; PDF stagés `sources/qc-zonage-grilles/` | `packages/qc-sources/src/sources/grille-{discovery,page-locator,specifications-parser,vision-extractor,vision-multizone}.ts` ; `acquisition/src/{grille-discovery-run,stage-grilles-s3,pull-grilles-s3,zonage-norms-run,zonage-norms-batch}.ts` + `lib/zonage-norms.ts`. Design : `docs/spec/normes-extraction-retenu.md`. Job : `deploy/normes-job/`. | **Partiel / en cours** (pilote prod ; crawl province à lancer) |
| 8 | **PV / procès-verbaux** (signaux zonage/règlement) | Scrapers procès-verbaux municipaux (index → liens PDF → texte) ; **détecteur de changement de zonage** : chaîne « avis de motion → n° règlement → zonage » → `{changementZonage, reglementNumbers[], zoneRefs[], densiteAutorisee}`. **Migré depuis immo** (`@radar/sources`), pas réécrit. robots.txt respecté (ajouté pour le crawl grilles). | Sites municipaux (PV de conseil, avis publics) | **563 villes** configurées (`ALL_PV_CITIES`, `proces-verbaux-generic.ts:4529` : 35 fixtures golden + 528 config). Annuaire : **1106 munis** (`municipalities.qc.json`). | (pas de dépôt S3 dédié vu ; sorties raw SCW) | `packages/qc-sources/src/sources/proces-verbaux-*` (63 fichiers) + `proces-verbaux-parser.ts`, `reglements-urbanisme-parser.ts`, `robots-txt.ts` | **Prod migré — bascule production immo→geo À FAIRE** (code+1218 tests verts, cutover non flippé) |
| 9 | **PMTiles** (tuiles vectorielles) | Tuilage Tippecanoe (docker `klokantech/tippecanoe`) : zones (`-Z4 -z13`) depuis `ca-qc-zonage/`, lots (`-Z11 -z16`) depuis cadastre. Version durable = **Scaleway Serverless Job** (tile-join par batch de 60 villes). | Dérivé (S3 normalized) | **2 archives province** (`qc-zones.pmtiles`, `qc-lots.pmtiles`) | S3 `pmtiles/qc-{zones,lots}.pmtiles` | `scripts/build-pmtiles.mjs` ; `deploy/pmtiles/{Dockerfile,build-pmtiles-job.sh}`. ADR-0022. | **Prod** (livré) |
| 10 | **Rapport de statut** | Collecte **lecture seule** S3 (ListObjectsV2 + GetObject Range) → comptes par préfixe → rendu Markdown + DOCX (`docx` npm). 100 % TS. | S3 `sentropic-geo` | Rapports datés `out/status-quebec-<date>.{md,docx}` + `-latest` | (S3, sorties locales) | `packages/qc-status-report/src/{collect,docx,markdown,index,s3}.ts` | **Prod** (idempotent) |

---

## 2. ZONES — détail des voies essayées (réussies / abandonnées)

Le zonage est le poste le plus exigeant et celui qui a vu **le plus d'essais**. Distinction clé : **collections servies** (387 `qc-zonage-*`) vs **réellement exploitables** (grille réglementaire avec `code_zone` par polygone — minorité).

### 2.A Moisson ArcGIS Online / Hub (AGOL) — par compte
- **Voie principale qui a rapporté.** Deux voies de découverte fusionnées par `serviceUrl` : (1) **AGOL search** — `harvest.mjs` pagine `arcgis.com/sharing/rest/search` avec 4 mots-clés `[zonage, urbanisme, affectation, zoning]` dans la bbox QC `-79.8,44.9,-57.0,62.6` ; (2) **MAMH domain-probe** — `harvest-mamh.mjs` lit l'annuaire (1076 villes), dérive les hôtes ArcGIS (8 sous-domaines gis/carte/geo/sig/map/geomatique).
- **Porte « vérifié live » (tout doit passer)** : service répond `?f=json` sans auth ; layer `geometryType` /Polygon/i ; champ code-zone détecté (11 regex ordonnées) ; `query?where=1=1&resultRecordCount=1&returnGeometry=true&outSR=4326` HTTP 200 ≥1 feature dont le 1er vertex (WGS84) passe **point-in-polygon vs un polygone QC simplifié 18-vertex** (anti faux-positif NB/ON) ; HTTPS requis, denylist non-QC (cornwall/ottawa). UA `sentropic-geo/0.1`, timeout 8 s, délai 250 ms.
- Registre généré `…/ca-qc-zonage-arcgis/registry.generated.json` = **118 endpoints vérifiés** (`verifiedAt`) : **117 `agol-search` + 1 `mamh-domain-probe`** (la voie MAMH est **PROD-mais-morte : 1 seul résultat**). **61 comptes ArcGIS distincts** (dont ~10 MRC), 59 citySlug distincts. Schéma : `{citySlug, serviceUrl, zoneCodeField, verifiedAt, source, meta}`.
- **+ 53 endpoints supplémentaires** (`SUPPLEMENTAL_ZONAGE_ARCGIS_ENDPOINTS`, comptés dans le `dist/` de CETTE branche) : **30 `manual-demo-unverified` + 23 `manual-supplemental`** — beaucoup = contraintes (PIIA, inondables, patrimoine), **pas** des grilles. (Note : la version `src` sur `main` en a 52 = 29+23 ; écart de 1 entre branches.)
- En S3 : **118 dirs `ca-qc-zonage-…-arcgis`** sous `normalized/ca-qc-zonage/` (247 geojson nichés au total).
- Crawler générique sous-jacent : `crawlArcgisLayer` (`@sentropic/geo acquire/arcgis-crawl`) — quad-tiling bbox récursif + pagination offset, backoff `Retry-After` (commit `21a6edb` ; fix pagination `301d547`).

### 2.B CKAN Données Québec — grandes villes
- `…/ca-qc-zonage-ckan/index.js` : **16 manifests nommés** (11 villes distinctes + Montréal ×3 + Saint-Hyacinthe ×2 + Shawinigan) + **124 datasets supplémentaires** (`SUPPLEMENTAL_ZONAGE_CKAN_DATASETS`, 125 `datasetId`) → **140 manifests `QC_ZONAGE_CKAN_MANIFESTS` au final**, **14 fournisseurs** (Longueuil, Gatineau, Saguenay, Lévis, Trois-Rivières, Sherbrooke, Québec, Repentigny, Rimouski, Rouyn-Noranda + MSP/MTMD/MCC/Shawinigan), tous `cc-by-4.0`. API `donneesquebec.ca/recherche/api/3/action` (+ `donnees.montreal.ca`). Pas de normaliseur (GeoJSON direct).
- Cas-limites en GeoJSON brut : Sherbrooke via `opendata.arcgis.com`, Shawinigan via FS `?f=geojson`, et **MSP inondations 2017/2023 via WFS `getfeature&outputformat=geojson`** (4 URLs pré-bakées — **pas d'adaptateur WFS générique**).
- **Épuisée** : `q=zonage` ≈ 50 packages = grandes villes seulement ; **MRC sur DQ ≈ orthophoto** (12 orgs MRC, quasi aucune ne publie du zonage). Beaucoup de ces datasets = **affectation/contraintes** (PUM 2050, limites hauteur, PIIA Laval CDU, zone inondable), pas la grille réglementaire municipale.

### 2.C Portails MRC SHP — hétérogènes
- 1 adaptateur ad-hoc par portail. Cas prouvé : **MRC Portneuf = SHP par muni** → `ogr2ogr`→GeoJSON, géométrie de zone EXACTE (neuville 127, saint-gilbert 29, saint-raymond). **Pas de découverte générique** — c'est le gisement incrémental réel mais coûteux.

### 2.D Extraction PDF → GeoJSON (ADR-0023)
- Typologie 4 types (détecteur `gdalinfo`+`pdffonts`+`pdfimages`) :
  - **T1 GeoPDF géoréf = 100 % AUTO** : labels code-zone géoréférencés + **contours par agrégation cadastre line-of-sight** (les lots servis donnent les contours, le PDF les labels). **Prouvé POC saint-amable : 104 zones, lot→zone 78,2 % in-frame, 0 invention** → `qc-zonage-saint-amable` (104 MultiPolygons, props `zone_code/kind/source/confidence/n_lots`).
  - **T2 vectoriel AutoCAD + T4 scan = SEMI-ASSISTÉ 3-GCP** (3 clics humains/ville ; auto-calage page→WGS84 résolu, résidu médian 4,2 m, 3 GCP = qualité de 151 ; mais **NO-GO auto-pur**, calibré sainte-catherine vs vérité « Steve »).
  - **T3 raster géoréf** ; **SHP/DWG MRC** = `ogr2ogr` direct.
- Cas dégradé honnête : `qc-zonage-saint-frederic` = enveloppe groupée non attribuée (`zone_code=null`, anti-invention) + `anchors-saint-frederic` = 23 points d'ancrage.
- Vision Mistral pour les rasters (`raw/zonage-vision/`, `raw/zonage-ocr-audit/`).
- Contrat de sortie verrouillé immo : Feature `{zone_code verbatim, kind (H/C/I/A/P), source, confidence}`, MultiPolygon WGS84 EPSG:4326, 1 feature/zone (`ST_Union` par code).

### 2.E Désagrégation des agrégats multi-munis (Ét.0 — HEAD 690293b)
- **Problème** : ~291 collections ArcGIS sont des **agrégats** (un layer MRC couvre N munis, discriminés par `mun_nom`/`MuniTopo`/`MUS_NM_MUN`…) → immo ne peut pas les puller par ville.
- `disaggregate-zonage.ts` : détecte l'attribut muni (liste de candidats) + l'attribut code-zone, **split par muni → slug canonique** (`municipalities.qc.json`), **vérif spatiale anti-faux-positif** (bbox des features vs centroïde registre, tolérance 25 km), écrit `normalized/ca-qc-zonage/qc-zonage-<slug>/` avec `confidence='disaggregated-from:<id>'`. Additif/idempotent, anti-invention (slug non mappé ou spatial KO → skip justifié, jamais deviné).
- **Résultat RÉEL** : **+61 collections per-muni** (Bellechasse 20, Coaticook 12, Côte-de-Beaupré 9, Vallée-du-Richelieu 15, L'Assomption 5) → **~38 → 99 collections 1:1 (+160 %)**. **Seulement 5/118 agrégats désagrégeables** (le reste = mono-muni/thématique). **Les 11 villes absentes ne sont PAS dans les agrégats → acquisition requise.** (Mesuré en S3 : exactement **61 dirs `qc-zonage-<slug>`** sous `ca-qc-zonage/`.)

### 2.F Géoportails WFS / JMap / GoNet — détection seulement (NON moissonnés)
- **Aucun harvest WFS générique.** Le WFS n'apparaît que comme 4 URLs GeoJSON pré-bakées (MSP inondations) dans le CKAN. Pas d'adaptateur GetCapabilities/GetFeature.
- **Détection de plateforme codée, mais pas de harvest** : `packages/geo/src/catalog/recense-platform.ts` (commit `07be0e9`) détecte `arcgis|jmap|gonet|ckan` (JMap/Kheops, GoNet/GoAzimut/PG Solutions) par patterns URL/body, MAIS la résolution automatique du site est **« non implémentée » (TODO : annuaire MAMH)** = **stub**.
- Inventaire de sources `GeoSourceInventory` (`arcgis|ckan|jmap|gonet|pdf|unknown`) porté (commit `07be0e9`).

### 2.G Deux pipelines PDF DISTINCTS (à ne pas confondre)
- **6a — PDF → GÉOMÉTRIE de zone (ADR-0023)** : produit des polygones `qc-zonage-<slug>` (T1 GeoPDF auto via cadastre line-of-sight, T2/T4 3-GCP, SHP MRC `ogr2ogr`). **Design accepté + POC prouvé (saint-amable), MAIS code NON committé sur cette branche** ; « calage lots »/ancrage cadastre appartient à CE pipeline.
- **6b — grille PDF → TABLE de NORMES (parquet)** : produit `registry/qc-zonage-norms/<slug>.parquet` (40 colonnes : hauteurs/marges/frontage/densité par code de zone). **AUCUNE géométrie, AUCUN ancrage cadastre** (vérifié : 0 occurrence). C'est le **layer 7** ci-dessus. PROD pilote (Sherbrooke natif TS $0 ; sinon vision Mistral). **Provider LLM = Mistral uniquement** (`api.mistral.ai`, `mistral-medium-latest`) — **0 Anthropic/Claude/OpenAI** dans le code d'extraction zone (« Claude » n'apparaît que dans les trailers `Co-Authored-By`).

### 2.H Essais ABANDONNÉS / RATÉS / REMPLACÉS (zonage) — voir aussi §3

---

## 3. ESSAIS ABANDONNÉS / REMPLACÉS (transversal, honnête)

1. **Python → TS** : tout le pipeline acquisition était en **Python** (`acquisition/*.py` : `cadastre_clip_sda.py`, `role_foncier.py`, `build_index_immo.py`, `lot_attrs_geom.py`…). **Porté fidèlement en TS et le Python supprimé** (MEMORY « no Python in geo »). Les `.ts` portent la mention « Port fidèle de … ».
2. **Recherche AGOL/Hub/CKAN par mot-clé (keyword)** : **stérile et bruitée** pour les MRC (`gisement-mrc.md` §B : MRC Joliette / Des Chenaux / Érable / Abitibi-Ouest / Beauce-Sartigan / Maskinongé « zonage » = **0 chacune**). Remplacé par **énumération par compte** + confirmation spatiale.
3. **Faux positifs « Zonage » qualifiés affectation/milieux-humides** : MRC Roussillon « Zonage » owner `Martin_Lessard0` = couche **milieux-humides/marais** (821 feats, 0 au centroïde Ste-Catherine) ; `A_zoning` owner `diego_NBSE` = **démo/autre « Alma »** (45 feats, 0 au centroïde) ; `a-mercier-mrchsf` = polygone provincial « ZONAGE NON DISPONIBLE ». Tous **exclus** après vérif live. → règle : « un hit zonage exige une vérif live obligatoire » (purge ADR-0020 : 74→67 collections, 7 faux positifs retirés).
4. **Route-guess naïf / découverte heuristique slug→domaine** (`sig.<slug>.ca`) : codée mais **~30-40 % seulement** (annuaire MAMH d'URLs reste le goulot). `mamh-domain-probe` n'a rapporté **qu'1 endpoint** sur 118.
5. **Homonyme NDL-Joliette vs NDL-l'Érable** : geo possède `qc-zonage-notre-dame-de-lourdes--joliette` (Lanaudière) ; immo demande **NDL-l'Érable** (Centre-du-Québec, ~130 km plus à l'ouest). **NE PAS** servir la collection `--joliette` pour cette ville (mauvaise municipalité) → NDL-l'Érable = ABSENT.
6. **« 329 collections = couverture » = mauvais proxy** : remplacé par la mesure honnête « confirmation spatiale par muni » (audit #4 : 3/14 quick wins ; gisement : 38 1:1 / 291 agrégats-bruit).
7. **Auto-calage pur PDF AutoCAD (sans GCP)** : visé puis **NO-GO** (pas de lots matchables dans le PDF AutoCAD) → remplacé par **3-GCP humain** (réutilise l'éditeur Leaflet de Steve).
8. **CKAN niveau MRC** : **vérifiée négative** (12 MRC sur DQ, quasi toutes orthophoto seulement ; MRC Érable & Laurentides = 0 package).
9. **`pdf-ocr.ts` tesseract** : présent mais **NON câblé** dans le pipeline normes live (utilitaire de réserve ; le conteneur API ne ship pas tesseract).
10. **Apache Iceberg** : **écarté** (ADR-0022) — pas d'index spatial R-tree, sur-dimensionné pour servir tuiles/features → PMTiles + PostGIS retenus.
11. **`StoreProvider` eager** (charge tout le préfixe au boot → OOM, ADR-0021) : remplacé par shards per-city + lazy-load + PMTiles/PostGIS (ADR-0022).
12. **Mono-fichier cadastre 2,63 Go** : supprimé au profit des **shards per-ville** (ADR-0021).
13. **`deferred/ca-qc-zonage/`** (4 objets, 1 collection) : collection mise en **attente/différée** (non servie).

---

## 4. CHIFFRES CLÉS DE COUVERTURE (réels, par layer)

| Layer | Couverture mesurée | Source du compte | Plafond / réserve |
|---|---|---|---|
| Frontières admin | 1343 polygones munis ; SDA province | OGC `qc-municipalites` | complet |
| Cadastre lots | **1102 munis** (≈1,78 M lots) ; **1080** ré-clippés SDA | S3 + OGC (1102) | ~100 % province (dénom. 1106) |
| Rôle foncier | **1095 munis** | S3 `registry/role-foncier/` (parquet) | ~99 % |
| Index immo zéro-copie | **1102 parquet** servis | S3 `registry/index-immo/` | 100 % servi ; `code_zone` non-null sur ~15 munis / **32,99 % des lots de l'index** |
| code_zone sur lots | **28 munis** | status report | suit le zonage |
| **Zones spatiales** | **387 servies** (118 arcgis + 269) ; **38 1:1 → +61 désagrégées = ~99 1:1** ; **~28 grilles spatialisées servables** ; **~51 « vraies grilles » sur 302** (ADR-0023) | OGC + S3 + 690293b + gisement-mrc | **Plafond zonage ouvert ≈ 23-32 % des munis** ; ~700-750 munis resteront PDF/scan/sans source |
| Normes / grilles | **25 parquet déposés** (S3) ; **18 en prod** ; 41 PDF locaux ; 18 munis manifeste extract | S3 `registry/qc-zonage-norms/` | ~2 % province ; crawl province à lancer |
| PV / signaux | **563 villes** configurées ; annuaire 1106 | `ALL_PV_CITIES` ; `municipalities.qc.json` | scrapers prêts, **bascule prod non faite** |
| PMTiles | **2 archives** province | S3 `pmtiles/` | livré |
| lot-attrs géométriques | **1 parquet** | S3 `registry/lot-attrs/` | à peine amorcé |

---

## 5. LES PLUS GROS TROUS DE COUVERTURE (où est le gisement)

1. **Zones spatiales — la longue traîne PDF.** Le zonage vecteur ouvert plafonne : ~38 1:1 + 61 désagrégées ≈ **99 munis 1:1**, ~28 grilles réellement spatialisées. **~700-750 munis (surtout < 5 000 hab.) n'ont QUE du PDF/scan ou aucune source ouverte.** Gisement MRC/AGOL réaliste au-delà de l'existant : **+80 à +180 munis** (médian ≈ +120), porterait à ~25-32 % des munis en vecteur. C'est le plus gros trou structurel.
2. **`code_zone` par lot** (le produit que consomme immo) : non-null sur **~15 munis seulement** (32,99 % des lots de l'index). Directement borné par le trou #1 ; chaque grille acquise débloque un muni.
3. **Normes / grilles de spécifications** : **25/1106 munis** déposés (~2 %), pilote Sherbrooke en prod. Le crawl province (réutilisant le crawler PV + robots) est **à lancer** (job Scaleway codé mais non build/déployé). Gros gisement de valeur réglementaire encore non-extrait.
4. **PV / signaux municipaux** : code migré + testé (563 villes, 1218 tests) mais **bascule production immo→geo non effectuée** — donnée potentielle non encore servie côté geo.
5. **11 villes ABSENTES priorisées par immo** (sainte-catherine, alma, saint-charles-borromee, saint-boniface, la-sarre, saint-come-liniere, petite-riviere-saint-francois, champlain, plaisance, saint-mathieu-de-beloeil, notre-dame-de-lourdes--lerable) : **0 quick-coverable via MRC** à la sonde légère → cascade PDF/site municipal. Les plus grosses (alma 30k, sainte-catherine 18k, saint-charles-borromée 17k) méritent une **sonde nominative** (pas keyword) avant de les classer PDF-only.

---

## Annexe — traçabilité des chiffres
- S3 mesuré live 2026-06-22 via `acquisition/src/lib/s3.ts` (`s3Client`/ListObjectsV2, creds `/home/antoinefa/src/_acquisition-shared/s3.env`).
- OGC live 2026-06-22 : `https://api.geo.sent-tech.ca/collections?f=json` (2574 collections) + sondes `/collections/<id>/items?limit=1`.
- Registres repo : `…/ca-qc-zonage-arcgis/registry.generated.json` (118), `index.js` (53 suppl. = 30+23), `ca-qc-zonage-ckan/index.js` (124 datasets), `municipalities.qc.json` (1106), `proces-verbaux-generic.ts:4529` (`ALL_PV_CITIES`=563).
- Commits : HEAD `690293b` (+61 désagrégées, 5/118), `68ef706` (ADR-0023), `e997cd2` (ADR-0022), 15 commits `data(zonage)`.
- Docs : `gisement-mrc.md`, `zonage-resolution.md`, `contrat-jointure-immo-zones-lots.md`, `normes-extraction-retenu.md`, `cadre-acquisition-on-demand.md`, `status-quebec-latest.md`.
