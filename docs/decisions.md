# Decision log (ADR) — @sentropic/geo

Décisions prises **en autonomie** par le conductor (`claude:geo`, Opus 4.8) en mode `/loop`,
chacune validée par **double consensus** de deux conseillers Opus-4.8 indépendants quand elle
est structurante. Elles sont **révisables** : ce journal existe pour la revue a posteriori.

Format : `ADR-NNNN — titre · statut · date`. Statut ∈ {accepted, superseded, revisit}.

---

## ADR-0001 — Track & gouvernance en fichiers versionnés · accepted · 2026-06-13

**Contexte.** Le serveur MCP `track` (système de backlog) est indisponible dans cette session.
**Décision.** Tenir le backlog, le registre de licences et ce journal de décisions comme fichiers
versionnés du repo (`docs/backlog.md`, `licenses/registry.json` + `docs/licenses.md`,
`docs/decisions.md`). Durable, public, révisable, et indépendant de la disponibilité MCP.
**Conséquence.** Si `track` revient, on pourra y rejouer le backlog ; la source de vérité reste git.

## ADR-0002 — Taxonomie des packages (juridiction + discriminant `kind`) · accepted · 2026-06-13

**Consensus 4.8** (advisors `abba56cff14084549` #1 / `a22cd3980c7047848` #2).
- **Accord** : un package par juridiction ISO-3166 (`geo-source-ca-qc`, `geo-source-ca`,
  `geo-source-fr`…) ; pas de dépendance code parent↔enfant (tous ne dépendent que de `geo-core`) ;
  un package « province » détient les sources dont la province est l'éditeur autoritatif (Québec →
  Données Québec), un package « pays » détient les sources fédérales.
- **Désaccord arbitré** : stat/postal en packages séparés (#1) vs datasets internes taggés (#2).
  **Arbitrage conductor (hybride)** : (a) on ajoute un discriminant `kind: "administrative" |
  "statistical" | "postal"` au `SourceManifest` de `geo-core` (idée #2, fait) ; (b) on crée des
  packages frères `geo-source-<cc>-stat` / `geo-source-<cc>-postal` **seulement au moment de les
  implémenter** (idée #1), justifié par des licences/cadences très différentes (PCCF, La Poste…).
  D'ici là : YAGNI, tout vit dans le package juridiction taggé par `kind`.
- Lib de crosswalk postal↔admin (`geo-referential`) **différée** jusqu'à ≥2 pays.

## ADR-0003 — Registre de licences dérivé, anti-dérive · accepted · 2026-06-13

**Consensus 4.8** (les deux advisors). Source de vérité machine `licenses/registry.json`
(committé) ; vue humaine `docs/licenses.md` **générée** (CLI `geo licenses build`). Les champs
`redistributable` / `attributionRequired` / `shareAlike` sont **dérivés** de `geo-core.LICENSES`
via `resolveLicense(licenseId)` — jamais saisis à la main — pour que la **gate d'acquisition** et
le registre ne divergent jamais. La CI échoue si une entrée dérive de `LICENSES`.

## ADR-0004 — Modèle freshness & re-scrape · accepted · 2026-06-13

**Consensus 4.8.** `.meta.json.fetchedAt` = **fait** de dernière acquisition (ne pas le surcharger).
Ledger séparé `data/requests/<source>__<dataset>.json` = **politique** :
`{ requestedBy, requestedAt, manifestRef, lastFetchedAt, checksum, updateCadence, status }`.
Une demande immo crée/maj une entrée ; `geo refresh [--stale]` compare `now - lastFetchedAt` à
`updateCadence` (déjà sur `DatasetManifest`) et rejoue `acquire`. Un cron CI l'automatisera ensuite.

## ADR-0005 — Layout des données normalisées + FileProvider récursif · accepted · 2026-06-13

**Bug détecté par les deux advisors** : `writeNormalized` écrit
`data/normalized/<sourceSlug>/<datasetId>.geojson` (imbriqué) mais `FileProvider` scannait à plat.
**Décision.** On garde le layout imbriqué (namespacing par source, évite les collisions à l'échelle
mondiale) ; **`FileProvider` doit scanner récursivement** `data/normalized/**/*.geojson` + `.meta.json`.
**Id de collection OGC = `datasetId` globalement unique** : les sources préfixent par juridiction
(ex. `qc-municipalites`, `qc-regions`) pour rester uniques dans l'arbre mondial. Corrige le slice P0.

## ADR-0006 — P0 = municipalités du Québec (SDA, CC-BY 4.0) · accepted · 2026-06-13

**Consensus 4.8.** Première verticale réelle : Données Québec « Découpages administratifs (SDA) »,
provider MERN/MRNF, **CC-BY 4.0 (redistribuable, attribution requise)**, via le service ArcGIS REST
`SDA_WMS/MapServer`, couche municipalités, `outSR=4326&f=geojson`. Flux :
`acquire → writeNormalized → FileProvider → geo-api (/collections/qc-municipalites) → apps/site`.
Risques pinés : dérive d'index de couche ArcGIS (pin `layer` + assert des champs), CRS source
(forcer WGS84 via `outSR=4326`), licences postales restrictives (gate → non redistribuable).

## ADR-0007 — Hermétisme du cache d'acquisition · accepted · 2026-06-13

**Contexte.** Le scrape réel des régions QC a renvoyé **1 feature avec une géométrie Point
synthétique** alors que le service réel renvoie 18 MultiPolygons : le cache `.cache/geo`
(clé = `sha256(url)`) avait été **empoisonné** par un test qui a écrit un fixture sous la même URL.
**Décision.** Les tests d'acquisition DOIVENT utiliser un `cacheDir` temporaire isolé
(`os.tmpdir()`), jamais le défaut `.cache/geo`. `.cache/` reste gitignored ; purge du cache avant
tout scrape réel. À corriger dans les tests `geo-acquire`/`geo-cli`.

## ADR-0008 — Acquisition par fichier bulk via GDAL pour les couches volumineuses/lentes · accepted · 2026-06-13

**Contexte.** Le service ArcGIS REST SDA est **inutilisable pour les municipalités** (1343 features) :
timeout systématique même à 100 features généralisées ; MRC en pleine résolution = 95 MB. GDAL 3.8.4
(`ogr2ogr`/`ogrinfo`) est présent sur la machine. Le GPKG bulk officiel fait 105 MB et est dispo.
**Décision.** `geo-acquire` gagne un **chemin d'acquisition fichier** (`format: "gpkg" | "shp" | "fgdb"`) :
télécharge l'archive (→ cache, gitignored), lit via `ogr2ogr` (virtual FS `/vsizip/`), reprojette
`-t_srs EPSG:4326`, simplifie `-simplify ~30` (mètres, en CRS source Lambert), sort du GeoJSON →
normalisation. L'**ArcGIS REST reste réservé aux petites couches rapides** (ex. régions). Le brut
(105 MB) n'est **jamais commité** ; seule la donnée **normalisée + simplifiée** (committable) l'est.
GDAL devient une **dépendance système** (CI : `gdal-bin` ; image Docker du scraper : gdal). Conséquence
multi-pays : la plupart des référentiels officiels seront acquis ainsi (data.gouv.fr, StatCan…).

## ADR-0009 — Acquisition `.7z` et gros référentiels communaux · revisit · 2026-06-13

**Contexte (France).** IGN ADMIN EXPRESS est livré en **`.7z`** ; or `geo-acquire` (GDAL `/vsizip/`)
ne lit que les ZIP, et ce build GDAL 3.8.4 n'a pas `/vsi7z/`. Par ailleurs `fr-communes` (34 877)
dépasse ~25–30 Mo même simplifié. **Décisions :** (a) régions + départements FR produits ; communes
**déclarées mais non produites** (volume) — à shipper plus tard en TopoJSON ou par découpage
départemental, attributs réduits ; (b) en attendant le support `.7z` dans `geo-acquire`, FR est
produit via un script miroir du pipeline `acquire`. **Follow-up backlog :** ajouter le support
`.7z`/libarchive (ou une étape d'extraction `7z`) à `geo-acquire` pour que `geo fetch fr/...`
fonctionne de bout en bout. Marqué `revisit` car la voie d'acquisition FR n'est pas encore unifiée
avec la CLI.

## ADR-0010 — Budget de données committées (gros référentiels reproductibles, non versionnés) · accepted · 2026-06-13

**Contexte.** `ca-provinces` (StatCan, 13 features) pèse **17.8 Mo** : dominé par le **nombre
d'anneaux** (archipel arctique, lacs) que `ogr2ogr -simplify` ne réduit pas (il enlève des sommets,
pas des anneaux). À l'échelle mondiale, committer toutes les géométries gonflerait le repo de façon
non soutenable.
**Décision.** Budget de **~6 Mo / dataset committé**. En-dessous (régions/MRC/**municipalités QC**
4.9 Mo, régions/départements FR) → committé comme couche de service/seed. Au-dessus → **non versionné**
(`.gitignore`), mais **reproductible** via `geo fetch` (le `SourceManifest` + la licence + l'entrée de
registre restent committés). La donnée lourde est produite au **déploiement** (job k8s `geo fetch` →
volume de l'API) et en dev local. `ca-provinces` est donc documenté + reproductible mais **non seedé**.
**Follow-up.** Étape de généralisation par aire (suppression des anneaux < seuil km², via mapshaper
ou GDAL SQLite) pour produire une couche légère committable de `ca-provinces` (et autres côtières).
Marqué pour `geo-acquire`/scrape.

## ADR-0011 — Modèle des référentiels non-géométriques (stat/postaux) · accepted (revisit) · 2026-06-13

**Contexte.** Les référentiels **statistiques** (INSEE COG, SGC/DGUID StatCan) et **postaux**
(code postal ↔ commune, FSA) sont en partie **non géométriques** (tables de correspondance/codes),
alors que le cœur est centré géométrie (`AdminFeatureCollection`). Décision prise par le conductor
(revisitable).
**Décisions.**
1. **Modèle** : représenter les crosswalks/codes comme des **features à `geometry: null`** (RFC 7946
   l'autorise), la correspondance vivant dans `properties` (ex. `{ postalCode, geoId, country }`).
   → un seul modèle, servi tel quel par l'API OGC existante. Implémentation : élargir `AdminFeature`
   (ou type `ReferentialFeature = Feature<Geometry | null, …>`) dans `geo-core`.
2. **Packages** (suivant [ADR-0002]) : `geo-source-<cc>-postal` (`kind:"postal"`) et
   `geo-source-<cc>-stat` (`kind:"statistical"`), créés à l'implémentation.
3. **Gate licence prioritaire** : uniquement les référentiels **ouverts** (FSA StatCan = OGL ;
   « base officielle des codes postaux » La Poste / BAN = Licence Ouverte ; INSEE COG = Licence
   Ouverte). Les produits **restreints** (PCCF complet, certains produits INSEE) résolvent en
   `redistributable:false` → jamais republiés (la gate l'impose). Entrée de registre par source.
4. **Lib (follow-up geo-acquire)** : ajouter le format **CSV** (parse → features `geometry:null`) et
   le support **`.7z`** (libarchive / étape d'extraction) — débloque aussi `fr-communes` ([ADR-0009]).
Marqué `revisit` : à confirmer/affiner quand un 2e pays postal sera fait (éventuelle lib
`geo-referential` de crosswalk, différée jusqu'à ≥2 pays — [ADR-0002]).

## ADR-0012 — Stockage des données normalisées sur object storage S3 (Scaleway) · accepted · 2026-06-13

**Contexte.** Committer des géométries dans git ne passe pas à l'échelle mondiale (cf [ADR-0010],
ca-provinces 17.8 Mo) — « pas utile de scraper si on ne stocke pas sur S3 ». La valeur du scraping
est un **store durable et servable**.
**Décision.** La donnée normalisée **canonique** vit sur **Scaleway Object Storage** (S3-compatible,
`s3.fr-par.scw.cloud`), bucket `sentropic-geo`, préfixes `normalized/<source>/<dataset>.geojson` +
`.meta.json` + un `catalog.json` index. **git ne stocke plus aucune géométrie** — uniquement le code
(manifests, normalizers), le registre de licences, et au plus un micro-échantillon CI. [ADR-0010]
est ainsi remplacé : plus de « budget » git, la donnée est sur S3.
**Architecture.**
1. **`@sentropic/geo-storage`** (nouveau package) : interface `Store` (`get`/`put`/`list`/`has`) avec
   `FsStore` (local, dev/CI) et `S3Store` (prod, dep `@aws-sdk/client-s3`, endpoint Scaleway custom).
2. **`geo-acquire`/CLI** : `writeNormalized` cible un `Store` ; `geo fetch --out fs:./data/normalized | s3://geo-data/normalized`.
3. **`geo-api`** : `geo serve --data <fs|s3>` ; un `S3Provider`/`StoreProvider` lit depuis le bucket
   (cache mémoire/disque). Plus de dépendance à un PVC repeuplé from-scratch.
4. **Deploy** : le Job `geo fetch` **écrit** sur S3 ; l'API **lit** depuis S3. Secret k8s
   `geo-s3-credentials` (`S3_ACCESS_KEY`/`S3_SECRET_KEY`, endpoint, bucket) — jamais committé. Amende
   la demande poc-k8s (object storage `sentropic-geo` en `fr-par`, comme radar).
**Conséquences.** Les données QC/FR déjà committées en git seront **migrées vers S3** (cleanup) ou
réduites à un échantillon CI. `geo-api` garde le `FileProvider` local pour dev/CI ; `S3Store` pour la
prod.
**Provisionné (2026-06-13, via `scw`).** App IAM `geo-s3` + policy `ObjectStorageFullAccess` +
clé dédiée. Bucket **`sentropic-geo`** en `fr-par` (le nom `geo` était déjà pris → 409). Organisé :
`README.md`, `catalog.json` (index des sources), préfixes `normalized/` + `raw/`. Credentials dans
`poc-k8s/.env` (gitignoré) **et** GitHub Secrets `S3_ACCESS_KEY/SECRET_KEY/ENDPOINT/BUCKET/REGION`
sur `rhanka/geo` + `rhanka/k8s-ops`. Reste à coder : `@sentropic/geo-storage` + repointage fetch/api.
**Revisit.** Choix client S3 (SDK vs léger SigV4), lecture S3 directe vs sync S3→volume.

## ADR-0013 — Capitalisation du scraping immo (scope @sentropic + MIT confirmés) · accepted · 2026-06-13

**Arbitrage user** (forks remontés par le conducteur immo `claude:radar-immobilier`) : scope npm
**`@sentropic/geo-*`** (pas `@rhanka/geo-qc`), **licence MIT** (pas Apache-2.0). Directive :
« **capitaliser en lib le scrapping d'immo et le publier — reproduire le scrapping, reproduire les
assets ; c'est la valeur de la lib** ».
**Périmètre** (source : `/tmp/etude-geo/separation.md`, étude immo, 411 lignes). **Migrent vers geo** :
registre **1106 municipalités QC** (`radar-sources/src/geo/municipalities.qc.json` + schéma
`Municipality` sans les champs immo `priorityRank`/`excluded`/`deprioritized`), recette **SDA MERN
polygones** (`joinField: MUS_CO_GEO` = mon champ SDA) + cadastre allégé, **StatCan CSD** polygones
(fallback immo, name-join 99.8% — immo a résolu le timeout SDA que j'ai aussi contourné), adapter
**terrAPI** adresses, fetcher **MAMH role-evaluation** (XML), **GeoSourceInventory**, spikes
**CPTAQ/BDZI/GRHQ/StatCan census/orthophotos**. **Restent immo** : PV/avis/règlements, ontologie,
scoring, app, priorisation villes pilotes.
**Mapping dans MON architecture** (pas la structure `@rhanka/geo-qc recipes/`) : registre + schéma +
polygones → `geo-source-ca-qc` ; adresses/role/inventory/contraintes → datasets `geo-source-*` +
`geo-acquire` ; données → **S3** ([ADR-0012]). **immo devient consommateur** (`@sentropic/geo-*` + API).
**Garde-fous** : anti-PII (Loi 25), anti-invention (vérifier sources/endpoints réels), **OSM = ODbL →
recettes/URLs seulement, ne pas embarquer la donnée OSM**.

## ADR-0014 — Composant carte dataviz géo WebGL (geo) + frontière dataviz/geo · accepted (revisit) · 2026-06-14

**Mandat user** : chantier dataviz géo de `geo.sent-tech.ca` confié à **geo**. **Frontière réversible**
(à confirmer avec le conducteur dataviz via h2a) : **dataviz** = primitives de rendu WebGL génériques ;
**geo** = le **composant carte WebGL géo** (`GeoMap` dans `@sentropic/geo-ui-svelte`) — renderer WebGL
(classe deck.gl) pour les géographies (basemap vectoriel + couches admin + données QC) + dataviz géo
(choroplèthe, **projection de données sur features linéaires type routes**), **remplaçant
Leaflet/MapLibre-raster**. Stylé par le design-system ; `graphify` = référence rendu WebGL fluide.
**Coordination h2a** : proposé à dataviz (confirm), répondu au thread UI/carto immo, requests de
composants relayés (drumbeat) au design-system.
**Spec carte (feedback user sur SignauxMapView immo)** : labels **FR** ('3851 signaux') ; **recherche
en haut** façon graphify (pas dans le menu) ; **légende/filtre toujours visible** (union des types),
labels FR lisibles — le composant est **ONTOLOGIE-AGNOSTIQUE** (immo fournit catégories
labellisées+colorées + schéma de détail) ; **panneau détail dépliable** (citation + lien PDF + métadonnées
+ choix des niveaux) ; richesse « comme la carte de Steve ». Composants DS natifs (search-on-top,
légende+bulle, chrome) à fournir par le design-system.
**Décision réversible (en l'absence du user)** : on démarre **spec → double-revue 4.8 → build → publish →
deploy (GitHub Pages site + k8s API)** côté geo sans bloquer sur la confirmation async dataviz/DS.

## ADR-0015 — Consensus double-revue 4.8 de la spec carte → GO-with-fixes · accepted · 2026-06-14

Les **deux reviewers Opus-4.8** concluent **GO-with-fixes** (architecture saine ; API ontologie-agnostique
juste ; blockers = wiring/séquencement, pas design). Fixes verrouillés (réversibles) :
1. **CORS geo-api** : ✅ fait (`origin:*`, API publique read-only). **Pagination `/items`** : le consommateur
   passe un `limit` explicite (sinon 1106→100 silencieux) ; transport des couches denses (vector tiles/PMTiles)
   = incrément ultérieur.
2. **Bundle** : `deck.gl` + `maplibre-gl` en **`peerDependencies`** de `geo-ui-svelte` ; tests WebGL = **Playwright**
   (jsdom ne rend pas le WebGL → les tests unitaires ne couvrent que la garde SSR + le DOM).
3. **Abandonner le cull Canvas2D de graphify** (aucun code ne transfère ; concept → toggle de couches sur
   `movestart`/`idle`). Labels **GPU** (`symbol` MapLibre), pas DOM.
4. **Découpler du DS non-livré** : binder **`AppChrome`** (réel aujourd'hui), PAS `@sentropic/app-shell`
   (private/incubation). geo livre des **légende/recherche/détail minimaux** (compose Drawer/Accordion/Search),
   swap vers les composants DS plus tard. **Ne pas gater les incréments** sur le backlog DS.
5. **Deploy = migration réelle** : API → sous-domaine **`api.geo.sent-tech.ca`** ; site → **GitHub Pages** sur
   l'apex `geo.sent-tech.ca` ; CORS fait. (⇒ MAJ ingress poc-k8s + DNS + workflow Pages.)
6. **Vocabulaire couches** : aligner sur le DS `GeoMap` (`geojson|choropleth|points` + alias
   `density|hexbin|cluster|flow`) ; `GeoLinearLayer` = extension documentée. **PMTiles** basemap auto-hébergé
   (recette OSM **ODbL**, build CI) + **self-host glyphs/sprites** (pas `demotiles`).

**Plan d'incréments révisé** (réordonné) : (1) **MVP** carte MapLibre vector (polygones admin + pan/zoom/fit,
sans dépendance nouvelle) ; (2) choroplèthe + légende minimale ; (3) recherche + panneau détail ; (4) basemap
PMTiles + glyphs auto-hébergés ; (5) projection linéaire (deck.gl + échantillon route OSM). Linéaire déplacé
**après** la recherche (aucune donnée route n'existe encore).

## ADR-0016 — `GeoMap` consomme les builders géo de `@sentropic/dataviz-core` · accepted · 2026-06-14

**Contexte.** Le conducteur dataviz a (via h2a) **confirmé le split** ([ADR-0014]) et offert : `@sentropic/dataviz-core@0.4.36`
(npm, MIT, deps: none) expose déjà **7 builders géo agnostiques, pure-data, zéro rendu** —
`buildChoroplethModel`, `buildGeoPointModel`, `buildGeoFlowModel`, `buildGeoHexbinModel`,
`buildGeoClusterModel`, `buildGeoDensityModel`, `buildGeoJsonLayerModel`.
**Décision (réversible).** `GeoMap` (`geo-ui-svelte`) **consomme ces builders** pour le binning/agrégation
(pure data) ; geo n'implémente QUE le **rendu** (deck.gl/MapLibre) + les projections. Cela **remplace** le
binning inline `choropleth.ts` (inc.2) et **referme le gap de parité de vocabulaire** (hexbin/cluster/
density/flow) que la double-revue 4.8 ([ADR-0015]) avait relevé. dataviz garde ses composants `Geo*Map`
(usages dataviz génériques, cible différente) — pas de conflit ; si dataviz expose un jour des primitives
WebGL réutilisables, geo les consommera aussi.
**Suite.** Refactor `geo-ui-svelte` : dép `@sentropic/dataviz-core`, `choropleth.ts` → wrapper sur
`buildChoroplethModel`, + couches hexbin/cluster/density via les builders. Coordination ouverte avec dataviz
(signatures, ajustements éventuels).

**Mise à jour · 2026-06-14 (inc.2b/2c, double-revue 4.8 GO).** Refactor livré : `geo-ui-svelte`
consomme `@sentropic/dataviz-core` — d'abord `0.4.36` (inc.2b : choroplèthe via `buildChoroplethModel`
+ hexbin/cluster/density via les builders, rendu MapLibre natif `fill`/`circle`/`heatmap`), puis
adoption de `0.4.37` (inc.2c, commit `1dd05b2`) qui implémente les **3 ajustements** demandés
(additif/rétro-compat) : `classify()` + `ChoroplethConfig.classification` → `ChoroplethModel.breaks`,
`GeoPointConfig.geometry` (supprime le pont `__lng/__lat`), et `polygon` sur `GeoHexbin`/`GeoDensityCell`
(supprime la synthèse `hexRing`). ~80 lignes de glue locale retirées ; équivalence de rendu **prouvée
empiriquement** par la revue adversariale (`classify` 4000/4000 identiques à 1e-9, cas dégénérés
conformes), `npm run verify` EXIT=0, **352 tests verts**. **Décision réversible consignée** : le type
publié `Cell = string|number|boolean|null` n'admet pas l'objet géométrie attendu au runtime par le mode
`geometry` ; dataviz **diffère volontairement** l'élargissement de `Cell` (type fondamental de `Row`)
tant qu'il n'y a qu'un seul consommateur. geo conserve donc un **cast `as unknown as Cell` (1 ligne,
documentée)** comme soupape — réversible : si dataviz élargit `Cell`, le cast est retiré.

## ADR-0017 — Refonte de la taxonomie des packages (sources = manifestes data, ≤5 libs continent) · accepted · 2026-06-14 · **supersede ADR-0002**

**Contexte.** [ADR-0002] = 1 package npm par juridiction (+ `kind`). À l'échelle mondiale → **explosion** :
le QC seul (1106 munis × niveaux), a fortiori la planète, ferait des milliers/dizaines de milliers de
packages. Feedback user : « avec le QC à l'atome ça fait ~20000 packages, ça va pas » ; « max ~5 libs de
sources (une par continent), 2-3 pour le reste » ; « lazy, pas charger des To ».

**Décision (réversible).** Découpler « ajouter une juridiction » de « publier un package ».
- **Une source = un MANIFESTE** (`SourceManifest`, donnée). Un **normaliseur générique piloté par `fieldMap`**
  (dans `geo`) traite la majorité des sources sans code. Le code **bespoke** (rare : jointure StatCan CSD,
  XML MAMH, `.7z` IGN) vit dans la lib du continent, référencé par `recipe: "<id>"`. **Ajouter un pays /
  niveau / ville = ajouter un manifeste, jamais un package.**
- **Packages publiés (plafond ~11, constant vs nombre de juridictions)** :
  - `@sentropic/geo-core` — modèle/types/licences/schéma manifeste/catalogue. **Léger, browser-safe**
    (importé par le front).
  - `@sentropic/geo` — moteur Node : acquire (download/GDAL/CSV/`.7z`/arcgis) + storage (S3/fs) + **API OGC
    `createApp`** + **CLI** (bin). **Node-only, deps lourdes isolées.** Fusionne
    geo-acquire+geo-storage+geo-sources+geo-api+geo-cli.
  - `@sentropic/geo-ui-svelte` (+ `-react`/`-vue` plus tard) — composant `GeoMap`. `geo-ui-core` (pilote de
    rendu framework-agnostique) **extrait au 2ᵉ port** (`choropleth.ts`/`point-layers.ts`/`dataviz-adapter.ts`
    sont déjà neutres → simple déplacement).
  - `@sentropic/geo-sources-<continent>` (≤5 : americas/europe/asia/africa/oceania) — manifestes (data) +
    recettes bespoke du continent.
- **Données jamais en package** — S3 uniquement, lues **par collection à la demande** (OGC `bbox`/`limit`,
  `geo fetch <une-source>`). Lazy de bout en bout ; le front n'installe que `geo-core` + `geo-ui-svelte`.
- **Moteur WebGL** = `maplibre-gl` (**BSD-3-Clause**) + `deck.gl` (**MIT**) en **`peerDependencies`** (browser,
  partagées, non embarquées → nos packages restent **MIT purs**). Pilote = `geo-ui-core`. **geo3D / WebGPU =
  piste future** (couche deck.gl/luma.gl custom), **jamais un moteur from-scratch** (ROI défavorable ;
  deck.gl couvre déjà 3D Tiles/point clouds/glTF/extrusions, MapLibre le terrain/globe).

**Premier publish (couverture CA/QC/FR) = 5** : `geo-core`, `geo`, `geo-ui-svelte`, `geo-sources-americas`
(CA+QC), `geo-sources-europe` (FR). (vs 16.)

**Migration.** Consolidation 16→5 sur branche `refactor/packages-v2`, pilotée par agents Opus 4.8 +
double-revue ; **préserver la logique testée (352 tests)** ; convertir les sources simples en manifestes
`fieldMap`, garder les complexes en `recipe`. Staged et réversible (rien n'est publié).

**Conséquences.** Supersede [ADR-0002]. Conserve : [ADR-0011] (`kind` → champ de manifeste), [ADR-0012]
(données S3), [ADR-0013] (capitalisation immo, scope `@sentropic`, MIT), [ADR-0014]/[ADR-0015]/[ADR-0016]
(carte WebGL, builders dataviz-core).

## ADR-0018 — Migration 16→5 exécutée (`refactor/packages-v2`) · accepted · 2026-06-14 · **met en œuvre ADR-0017**

**Contexte.** [ADR-0017] décide la cible (5 packages, sources = manifestes, inventaire injecté). Cette ADR
consigne son **exécution** sur la branche `refactor/packages-v2` (non mergée, rien publié), pilotée par
agents Opus 4.8, en 5 phases A→E avec `npm run verify` EXIT=0 à chaque borne.

**Réalisé.**
- **A** (`20bf694`) — `geo-core` : `FieldMap`/`DatasetManifest.recipe?`/`SourceRegistry`/`NormalizerFn` +
  `featuresToCollection` déplacé ici (les recettes continent ne dépendent que de `geo-core` → zéro cycle).
- **B** (`ca935ff`) — `@sentropic/geo` créé ; `geo-acquire`+`geo-storage` fusionnés (`src/{acquire,storage}`).
- **C** — `geo-api`+`geo-cli`+`geo-sources` repliés dans `geo` (`src/{api,cli,catalog,normalize}`).
  **Inventaire injecté** : `buildInventory(registries)`, `createApp(provider, inventory?)`,
  `buildRegistry(registries)`. `fetch.ts` dispatche la recette dans le slot d'`acquire` selon `format`.
  Continents chargés par **import dynamique optionnel** (`continents.ts`, try/catch) → l'engine NE dépend
  PAS des libs continent (pas d'arête de dep → tri topo acyclique). Normaliseur générique `makeFieldMapNormalizer`
  (factory livrée + testée ; **conversion des recettes existantes différée**, réversible). Tests moteur sur une
  **fixture hermétique** in-`geo` (`catalog/fixtures.ts`) — l'engine n'importe aucun package source. Suppression
  de `geo-api`/`geo-cli`/`geo-sources`.
- **D** — `@sentropic/geo-sources-americas` (6 sources CA/QC) + `@sentropic/geo-sources-europe` (3 FR) :
  chaque lib expose `registry = { manifests, recipes }` (helper `build-registry.ts` qui tague chaque dataset
  `recipe:"<sourceId>#<datasetId>"` sans muter les manifestes → **slugs S3 et ids datasets inchangés**).
  Normaliseurs **conservés tels quels** comme recettes (`normalizers`/`referentialNormalizers`/`csvNormalizers`
  unifiés en `NormalizerFn`). Ré-exports nommés préservés : `QC_MUNICIPALITIES`, `fetchQcCivicAddresses`,
  `parseQcCivicAddresses`, `fetchRoleXml`. Sources civiques = manifestes seuls (fetcher/adapter, parsing/PII
  côté consommateur, [ADR-0013]). `americas` **peer-dépend** de `@sentropic/geo` (`sha256Hex`). Suppression des
  9 `geo-source-*`. Test d'intégration du pipeline ca-qc réel relocalisé dans `americas`.
- **E** — `apps/site` (`buildInventory([americas, europe])` + deps), scripts racine (`@sentropic/geo`),
  `npm-publish.yml` (5 packages, ordre deps), `pages.yml` (paths), `Dockerfile`/entrypoint/`job-fetch`
  (chemins `dist/cli/cli.js` + `dist/api/server.js`, bin `geo` inchangé), docs (backlog + cette ADR).

**Résultat.** 5 packages publiables : `geo-core` → `geo` → `geo-sources-americas`/`geo-sources-europe`/
`geo-ui-svelte`. `npm run verify` EXIT=0, **363 tests**, 0 erreur type/svelte-check, **0 cycle topo**. Le bin
`geo` résout les 13 sources et les recettes `ca-qc/sda` de bout en bout (smoke OK). **Rien mergé sur `main`,
rien publié.**

**Différé / réversible.** La **conversion des normaliseurs simples en `fieldMap`** (SDA, ca-provinces,
fr-régions/départements) est différée : les recettes bespoke sont conservées intactes ; le normaliseur générique
existe mais n'est encore câblé sur aucune source. À reprendre incrémentalement, source par source, chacune sous
garde de test.

**Conséquences.** Met en œuvre [ADR-0017]. Aucune décision d'architecture nouvelle (exécution conforme).

## Méthode de décision

Décisions structurantes : 2 conseillers Opus-4.8 indépendants (lecture seule) → le conductor
verrouille les accords, arbitre les désaccords et consigne l'arbitrage ici avec les `agentId` pour
audit. Décisions mineures : prises directement et consignées si elles engagent l'architecture.
