# Decision log (ADR) — @sentropic/geo

Décisions prises **en autonomie** par le conductor (`claude:geo`, Opus 4.8) en mode `/loop`,
chacune validée par **double consensus** de deux conseillers Opus-4.8 indépendants quand elle
est structurante. Elles sont **révisables** : ce journal existe pour la revue a posteriori.

Format : `ADR-NNNN — titre · statut · date`. Statut ∈ {proposed, accepted, superseded, revisit}
(`proposed` = record durable rédigé mais **pas encore ratifié owner** ; flip `accepted` UNIQUEMENT en
référençant la ratification **owner-directe capturée** — jamais sur un relais ni un say-so conducteur).

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

## ADR-0019 — Annuaire municipal QC (`ca-qc/municipal-directory`, MAMH + Wikidata) · accepted · 2026-06-16

**Contexte.** L'acquisition zonage (ArcGIS) avait besoin d'une table **slug-ville → site web officiel**
pour (a) le domain-probing d'endpoints et (b) nettoyer l'attribution. Aucune source unique ne mappait les
~1100 municipalités QC à leur site.

**Décision.** Capter l'annuaire **MAMH** (Ministère des Affaires municipales, fichier ouvert `MUN.csv` :
`mcode`/`munnom`/`mweb`) comme source **primaire**, corroboré par **Wikidata** (`P856` site officiel).
Capitalisé **sans nouveau package** ([ADR-0017]) : données `ca-qc/municipalities/municipal-directory.qc.json`
(1100 villes, 1076 sites, **CC-BY 4.0**) + manifest `ca-qc/municipal-directory` + accessors
`websiteForSlug`/`directoryWebsites` dans `geo-sources-americas` ; `recensePlatformForCity(slug, lookup)`
branché dans `geo` (détecte arcgis/ckan/… pour un site donné).

**Réalisé / vérifié.** Source MAMH confirmée live (encodage **UTF-8** servi par la CDN, pas CP1252).
Jointure par **nom NFD-normalisé** (le registre `QC_MUNICIPALITIES` n'a aucun `code` peuplé → `mcode`
inutilisable comme clé) ; 29 homonymes Ville/Canton/Paroisse désambiguïsés par **population exacte**.
**1100/1106 joints (99.5 %)**. Wikidata corrobore (243 overlap, 74 % même host ; MAMH gardé primaire).
Preuve Lot D : chaîne `slug → site → recensePlatform` OK (ArcGIS détecté live sur gatineau). Tests verts.

**Conséquences.** Donnée committée (396 KB < seuil S3 d'[ADR-0012]). Entrée registre licences (CC-BY 4.0).
Réutilisable au-delà du zonage (toute capacité « site officiel d'une ville QC »).

## ADR-0020 — Acquisition zonage municipal QC via ArcGIS (AGOL) + CKAN, avec filtre-QC et purge des faux-positifs · accepted · 2026-06-16

**Contexte.** Découvrir et servir le zonage municipal QC **à l'échelle**. Deux voies : portails ouverts
**CKAN** (donneesquebec.ca) et **ArcGIS Online (AGOL)**. L'heuristique slug→domaine plafonnait (~30-40 %).

**Décision.** Découverte **voie AGOL** (`www.arcgis.com/sharing/rest/search`, bbox QC, requêtes
zonage/urbanisme/affectation/zoning) → registre `ca-qc-zonage-arcgis/registry.generated.json` (produit par
`scripts/ca-qc-zonage-arcgis/harvest.mjs`, **jamais édité à la main** — `verifiedAt` par entrée). Ingestion
par un **runner** `scripts/acquire-arcgis-zonage.ts` (la passe-through GeoJSON de `acquire()` était câblée à
la CLI pour les CKAN ; le **crawl ArcGIS paginé** ne l'était pas → runner). Données normalisées WGS84 →
**S3** `normalized/ca-qc-zonage/<slug>.geojson` + `.meta.json` ([ADR-0012]).

**CAVEAT filtre-QC (assumé).** Le filtre de découverte = échantillon reprojeté WGS84 + **point-in-polygon
QC** + champ code-zone + HTTPS + query 200. Comme **QC/ON/NB s'imbriquent** le long de la rivière des
Outaouais et du fleuve, un bbox seul échoue et même le point-in-polygon laisse passer des **townships
ontariens frontaliers**. Décision : **acquérir large, puis purger à la consolidation** sur preuve
géométrique + terminologie.

**Purge exécutée (consolidation 2026-06-16).** Registre **122 → 113 endpoints** ; S3 **74 → 67 collections /
99 966 → 50 095 features**. 7 faux-positifs retirés (registre + S3) :
- **Ontario confirmés** (centroïde ON + terminologie ANGLAISE « Zoning By-law ») : `plan-admin` ×5 +
  `quinnjackson3` (org AGOL `G6F8XLCl5KtAlZ2G` = Ville d'**Ottawa**, ~30 972 feat) ; `jhughes-ncr4`
  (NCR/Ottawa, 14 089 feat) ; `cityofcornwall` (**Cornwall ON**, 370 feat) ; `sade` (= comté **SDG**
  *Stormont-Dundas-Glengarry* ON : titres « SS_Zoning2016 », « South Glengarry Zoning », champ `SDGZoneID`,
  964 feat).
- **Redondants QC** (donnée QC réelle mais doublon d'une collection autoritative) : `bassants-utoronto/sag_zonage`
  (bbox **identique** à la collection CKAN `saguenay`, 2 798 feat) ; `shawinigan-arcgis` (octet-pour-octet
  identique au CKAN `shawinigan`, 678 feat).
- **Ambigus tranchés KEEP** (centroïde in-QC + champs **français**, croisés avec l'annuaire [ADR-0019]) :
  `taherif-uofguelph/ZONAGE` (`EXVILLE=Masson-Angers`, secteur de **Gatineau**) ;
  `guillaume-allard/Carleton` (RCM **Avignon**, Gaspésie : Carleton/Nouvelle/Maria/St-François…) ;
  `jean-rene-hickey` (`exville=Aylmer`, secteur de **Gatineau**).

**Résultat.** **67 collections zonage QC réelles / 50 095 features** servies (`geo serve` → GET /collections
= 67 ; les 6+ slugs purgés répondent 404 ; collections gardées /items OK : quebec 4785, saguenay 2838,
gatineau 1871, …). Voie MAMH (`harvest-mamh.mjs`) testée : rendement marginal (ArcGIS self-hosted déjà
indexé AGOL) ⇒ AGOL est la source scalable. **122 ≈ le marché ArcGIS-ouvert réel QC** ; union AGOL+CKAN+immo
couvre le marché.

**Caveats résiduels (assumés).** (1) **Slugs = noms-owner AGOL bruts** → attribution `provider.name` =
owner, `license: "unknown"` au niveau source (endpoints publics sans licence déclarée) ; requalification
ville-par-ville + via [ADR-0019] différée. (2) Le filtre QC reste heuristique : une passe future devrait
remplacer le point-in-polygon par le **polygone QC précis** (frontière Outaouais/fleuve) pour éliminer le
faux-positif à la source. (3) **Doublon de préfixe S3** dans les clés écrites par le runner
(`normalized/ca-qc-zonage/normalized/ca-qc-zonage/…`) — bénin (listing récursif), à corriger au prochain run.

## ADR-0021 — Lots cadastraux QC servis par **shards par ville** (pas de monolithe) · accepted · 2026-06-16

**Contexte.** Acquisition province-wide du **cadastre allégé** QC (polygones `NO_LOT`). Le runner
`scripts/run-cadastre-lots.mjs` (crawl ArcGIS par quad-subdivision bbox/ville, dédup `NO_LOT`, résumable,
mémoire bornée) a livré **40 villes prioritaires / 1 782 312 lots**. Il écrivait **deux** artefacts S3 :
des **shards par ville** `normalized/qc-cadastre-lots/<slug>.geojson` **et** un **monolithe** mergé
`normalized/qc-cadastre-lots.geojson` (**2,63 Go**).

**Problème.** Le `StoreProvider` de l'API **charge en mémoire chaque `.geojson` du préfixe** au premier
accès (parse complet + index `byId`). Servir le monolithe 2,63 Go d'un bloc = **OOM**. Servir le préfixe
qui le contient = OOM a fortiori.

**Décision.** **Supprimer le monolithe** de S3 (donnée intégralement préservée : `count` monolithe
**1 782 312** == Σ des 40 shards au checkpoint, vérifié) et rendre les lots servables comme **40 collections
séparées** `qc-lots-<slug>` (un `.meta.json` par shard, **CC-BY 4.0**, `© Gouvernement du Québec — Cadastre
allégé (MRNF/BDGQ)`). Chaque shard (18–147 Mo) est individuellement chargeable. **Preuve** : `geo serve
--data s3://…/_proof-lots` (sous-ensemble) → GET /collections liste `qc-lots-saint-mathieu` (9 708),
`qc-lots-varennes` (13 853), `qc-lots-saint-isidore--roussillon` (16 368) ; /items rend des polygones réels
(`NO_LOT` verbatim, ex. « 6 223 823 » à -73.345,45.686, Varennes).

**Limite connue → tuilage requis (différé).** Servir **les 40 shards d'un coup** (Σ 2,63 Go) **OOM** toujours,
car le `StoreProvider` est **eager** (charge toutes les collections du préfixe au boot, même pour un simple
`list`). Les shards sont la **bonne unité servable** mais le provider doit gagner soit (a) un **chargement
paresseux par collection** (lister via `.meta.json` sans parser les géométries ; charger un shard à la
1re requête `/items`), soit (b) un **tuilage** (MVT/découpe spatiale) pour les très grosses villes. C'est
le **pré-requis** pour servir tous les lots simultanément ; hors scope de cette acquisition, consigné au
backlog. En attendant, on sert les lots **par sous-ensembles** de shards.

**Conséquences.** Aucune donnée volumineuse committée (lots = S3 only, [ADR-0012]). Monolithe retiré
(−2,63 Go). 40 shards + 40 meta sur S3. Le runner reste résumable (`_checkpoint.json` conservé) et
extensible province (40 → 1104 villes) sans changer le modèle de service.

## ADR-0022 — Refonte des WP : 10 « couche/require » → 7 par artefact, QA et provenance intégrées, premier niveau **gelé** · accepted · 2026-07-30

**Contexte.** Le découpage track mesurait le *require* (`pv/scraper-configured · <ville>`) et non la
donnée servie ; 26 des 48 WP étaient des `voie:*` (leviers d'acquisition), d'où 27 WP fantômes. Le
compteur et la réalité vivaient dans des WP différents : « couche: pv » affichait 96 % (1 065/1 106)
quand la couverture réelle du graphe était 640/1 106, connue seulement après un script écrit exprès.

**Décision.** Sept WP par **artefact servi**, chacun possédant sa donnée, sa preuve et son compteur
(cf. `docs/spec/SPEC_WORKPACKAGES.md`) : **wp1** cadastre · **wp2** zones · **wp3** reglements ·
**wp4** pv · **wp5** jointures · **wp6** archi (règles et contrats **uniquement, pas de code/build**) ·
**wp7** socle (BUILD du socle — GeometryKernel, geo-lib, kernel de capture — + API OGC + npm + pmtiles).
Rôles propriétaires (RACI gravés dans track) : lot, zones, reglement, pv, jointures, archi, socle ;
transverses : conductor, qa.
**Pas de WP « QA »** : la QA est une obligation de structure de chaque WP (partition fermée à états
nommés — un refus est un état — + un script de mesure committé). **Le premier niveau est GELÉ : aucun
WP racine ne sera créé sans l'accord explicite du propriétaire** (règle inscrite dans `AGENTS.md`/`CLAUDE.md`).

**Mise en œuvre.** Migration track append-only, `validate` OK : 41 sous-arbres reparentés, 8 conteneurs
annulés, 26 `voie:*` démotées. Piège désamorcé (`immo-lots-enrichment` portait 5 feuilles-villes en
enfant direct → reparentées avant annulation). 4 items inter-workspace (`geo`/`geo-lib`) **convergés
vers `ws:5ce6`** par recréation fidèle (titre+body+état+scope+enfants préservés, nouvel ULID) puis
annulation de l'original — track n'ayant ni move-workspace ni renommage. Fusion 4a (ADR-C) : deux items
« 4a » réconciliés en un seul dans wp3.

## ADR-0023 — **geo possède l'acquisition des PV** (révoque le volet PV d'ADR-0013) · accepted · 2026-07-30

**Contexte.** ADR-0013 (2026-06-13) disait « restent immo : PV/avis/règlements » ; `SPEC_QC_ZONING_EVENTS_V2.md:26`
disait « owner decision — geo owns ALL acquisition ». Contradiction sans ADR de révocation, périmètre
de wp4 contestable. immo a par ailleurs vérifié dans son code que sa phase B **ne dépend pas** de nos PV.

**Décision (propriétaire).** **geo possède l'acquisition, l'indexation et le service des événements de
PV** (wp4) ; immo reste **consommateur** du graphe (jamais écrivain de son graphe, SPEC events v2). Ceci
**révoque explicitement le volet « PV/avis/règlements » d'ADR-0013** ; le reste d'ADR-0013 (ontologie,
scoring, app, priorisation villes) demeure chez immo. Conforme à la réalité mesurée : 5 492 PV indexés,
couverture 640/1 106.

## ADR-0024 — **`mistral-medium-latest` (Mistral vision-chat) BANNI** ; seul `/v1/ocr` sanctionné · accepted · 2026-08-14

**Contexte.** Une facture **Mistral.ai de 480 €** est apparue. La lane normes/grilles a extrait
**319 municipalités** via la route vision `mistral-medium-latest` (2 passes/page, le chemin le plus
cher) — preuve `work/coverage/normes-provenance.json` (méthode `"mistral-vision"` ×319). Ce modèle était
codé **en dur comme défaut** des 3 classes vision (`grille-vision-extractor.ts`, `-multizone.ts`,
`-zoneheader.ts`). ADR-0013/décision 4 (`normes-reglements-decisions.md`) n'avait sanctionné que
l'**OCR bon marché** `/v1/ocr` (`mistral-ocr-latest`, ~1 $/1000 pages) en 2ᵉ passe — **jamais** le
vision-chat. Le passage au vision-chat par défaut est une **dérive de code** au-delà du décidé, et le
modèle « n'a jamais fonctionné » (propriétaire, erreur récurrente).

**Décision (propriétaire, 2026-08-14).** `mistral-medium-latest` (et la lignée vision-chat Mistral :
`pixtral-*`) est **BANNI**. Aucun chemin de code ne peut résoudre un modèle vision-chat Mistral. Le
défaut est **supprimé** ; un modèle vision doit être **explicite et sanctionné**. Garde gravée dans la
lib : `packages/qc-sources/src/sources/vision-engine-policy.ts` (`assertVisionModelAllowed`,
`BANNED_VISION_MODEL_PATTERN = /mistral-medium|pixtral/i`) appelée par les 3 constructeurs ; test/CI
`vision-engine-policy.test.ts` **échoue** si le ban est contourné. Seul `/v1/ocr` (`mistral-ocr`) reste
sanctionné pour Mistral ; `voxtral-*` (audio) inchangé.

**Conséquence.** La route vision est **intentionnellement inopérante** (échec dur, « vert par omission
= rouge ») tant qu'un **moteur de remplacement** n'est pas choisi. Le remplaçant (un modèle vision plus
fort derrière la gateway — a priori `gpt-5.6-terra`/`luna` xhigh, le prompt JSON strict par cellule +
gardes anti-décalage conservés) est **en cours de double-consensus** (fable5 + codex), **benchmarké sur
des grilles déjà extraites** (vérité terrain, sans re-payer Mistral), à **ratifier par geo-archi** — ADR
de suivi à venir. Les routes native/OCR ne sont pas affectées.

## ADR-0025 — **Moteur carto geo RENDERER-NEUTRE (geo-owned) ; gel gaté sur démo 3D** · accepted · 2026-08-15

**Contexte.** Vue géo mutualisée geo↔immo à capitaliser (brief : shell / responsive / légendes-outils /
layers). Revue Fable5 (F1–F8) : le vrai moteur (réconciliateur déclaratif + viewport + tokens→paint +
caméra + ré-injection post-`setStyle` + tool-plugin) est **greenfield ET framework-indépendant** ; le
dupliquer ×4 = anti-pattern déjà tranché (dataviz-core agnostique + adaptateurs minces). immo a un spec 3D
**committé** (`SPEC_EVOL_3D_MAPS_2026-08-14.md`) → le 3D n'est pas prospectif.

**Décision (propriétaire, 2026-08-15).** (1) geo détient un **moteur carto unique** (package TS pur
agnostique, repo geo ; API + versioning geo-owned) ; N adaptateurs framework MINCES + chrome présentationnel
= DS-owned ; **zéro-copie**. (2) Le moteur est **RENDERER-NEUTRE dès la v1** (2D maplibre + 3D Cesium/deck) :
aucune expression de peinture maplibre brute dans le contrat public, tokens résolus par le moteur selon le
renderer, geo-core expose **zoom normalisé + équivalence caméra 2D/3D**. (3) `dataviz-core` émet des **bins
neutres** ; le moteur compile par renderer. (4) Le **gel du seam v1 (§1) est GATÉ sur une DÉMO 3D concrète**
(un renderer 3D réel satisfait le contrat couche+caméra neutre, round-trip 2D↔3D) — **jamais sur
l'abstraction seule** ; la ratification/gel restent la conduite geo-cond → owner. Détail autoritaire :
`docs/spec/SPEC_GEO_MAP_ENGINE.md`.

**Conséquence.** OWNER-GATED des deux côtés : aucune implémentation avant ratification. Séquence amont :
démo 3D verte → **gel §1** → (L1–L4 adaptateurs de base) ‖ (refactor `dataviz-core` → bins neutres,
owner-gated) → L5 chrome/choroplèthe → L6 migration immo (fetch-out élargi). Co-signé DS ↔ geo ↔ immo
(i-cond). Naming/shell/gates : sections §2–6 DS-authoritative du SPEC.

## ADR-0026 — **Gel du seam moteur carto v1 (renderer-neutre)** · accepted (ratifié owner) · 2026-08-16

**Contexte.** ADR-0025 a décidé un moteur carto geo-owned **renderer-neutre** (`SPEC_GEO_MAP_ENGINE.md §1`),
laissé **NON-GELÉ**, son gel **gaté sur une démo 3D concrète** (§9) — on ne fige pas un contrat renderer-neutre
non prouvé satisfiable en 3D.

**Décision.** Le **contrat §1 (seam moteur v1) est GELÉ (stable)**, ratifié owner. Le gel a été **gagné sur
preuve** au gate §9 :
- *1er run* `spike/engine-3d-20260815 @931f27a6` (deck.gl) = **ROUGE-constructif** : satisfiabilité 3D prouvée,
  mais §1.5 « zoom normalisé » sous-spécifié → convention **gravée en §1.5.1** (main `ce1edb99`) + sémantique
  round-trip clarifiée (préservation de l'état courant).
- *Re-run canonique* `spike/engine-3d-rerun-20260816 @b67eb222` (deck.gl) = **VERT** : §1.5.1 validé **7/7 dans
  les octets** (mesuré : 512·2^zoom=32768px@z6, FOV 0.6435 rad, pitchMax 60 refuse 61, sans terrain/padding/roll/wrap),
  **fixtures DS réelles lues** (import, zéro synthèse), **F7b prouvé** (`setTokens` light→dark, framebuffer
  `2a6dd3ee→fead4a30`), **round-trip vp3d-préservé** + assertion négative, render WebGL2 réel (4 frames, 25 pické),
  round-trip 7.1e-15° / 5.5e-12 px, **zéro expression maplibre**. Verify-the-verifier geo-archi confirmé dans le
  code (`data.ts` import, `deck-compiler.ts`).

**Conséquences.**
- **Implémentation Phase 0 AUTORISÉE** : build moteur (W1–W10) dans le **cap 74–118 p-j** (ajustable, cf.
  `CHIFFRAGE_MOTEUR_CARTO_2026-08-15.md §6.1`) ; tout dépassement → **re-check owner** (anti-chèque-en-blanc).
- **DS démarre L1–L6** contre le contrat gelé (mock conforme au contrat gelé possible) ; **immo** planifie la migration.
- **Toute évolution du seam gelé = nouvelle version (semver) + ADR**, jamais un changement silencieux.
- Le gel couvre le **§1** (seam moteur geo-owned) ; **§2–6 restent le ressort DS** (cadence de ratification propre).

**Réf.** `SPEC_GEO_MAP_ENGINE.md` §0/§1/§1.5.1/§1.8/§9 ; spike `931f27a6` / re-run `b67eb222` ;
`CHIFFRAGE_MOTEUR_CARTO_2026-08-15.md §6.1` ; ADR-0025.

## ADR-0027 — **geo-preprod : tier de serving preprod (namespace-par-env, S3-only, bucket séparé, promotion same-digest, coherence_id servi, parité miroir-plein)** · accepted (ratifié owner) · 2026-08-18

**Contexte.** Le dossier §6/§6.1 (owner 2026-08-15) acte un **tier preprod joint cross-repo** (immo+geo+poc-k8s) :
immo-preprod consomme **geo-preprod** (jamais geo-prod), au même point de cohérence, alimenté par un cycle de récup
prod→preprod **assaini (Loi 25), sens-unique, idempotent**. geo n'avait **pas de preprod de serving**. Cadrage WP6 =
`SPEC_GEO_PREPROD_SERVING_2026-08-15.md`, groundé sur faits LIVE socle (`geo-preprod-infra-facts.mjs @203bb250`, kubectl
lecture seule).

**Décision (propriétaire, 2026-08-18 — « ratifie, GO build gaté »).** Le cadrage geo-preprod est **ratifié**. Invariants gravés :
1. **Namespace-par-env** — ns dédié `geo-preprod` (RBAC/secrets/quota isolés ; épouse la séparation immo-preprod↔geo-preprod du §6).
2. **Serving S3-only** — geo-api sert la surface OGC depuis **S3 seul** (`GEO_DATA_URI`) ; le **postgis n'est PAS dans le chemin de serving** → tranche preprod = **1 pod geo-api-preprod** (0 postgis, 0 PVC).
3. **Bucket S3 séparé (OVH-BHS)** — geo-preprod écrit dans un **bucket preprod distinct** ; le sens-unique §6.1 est imposé au **niveau credential/bucket** (aucune cred preprod n'écrit le bucket prod `sentropic-geo`), **pas** par policy de préfixe (write-deny par préfixe **non garanti** sur OVH S3, `unknown` — probe documentaire différée, sans effet sur la décision).
4. **Promotion « même-digest » (registre-agnostique)** — l'invariant = la promotion preprod→prod **re-pointe le MÊME digest** (jamais rebuild), **indépendant du registre**. **Cible = GHCR-by-digest** (canal unique, promotion littérale). **Interim bring-up = le digest du BUILD POST-MERGE** (docker-publish depuis main après implémentation de CE cadrage) — il embarque l'expo `coherence_id/served_count/set_hash` + le runner de sync ; **PAS `f8b152b1`** (build 07-08 **antérieur** à l'impl → expo absente ⇒ gate INERTE + Job ENOENT). `ghcr.io/rhanka/geo-api` n'existe pas encore (job GHCR gaté, jamais publié — socle 2026-08-18) → interim = build post-merge (Scaleway) ; **follow-up = publier geo-api sur GHCR** (PR distincte post-kubeconfig) → bascule GHCR-by-digest. Manifests portant `REPLACE_WITH_POST_MERGE_GEO_DIGEST` (résolu à l'apply). geo-preprod = pull secret `geo-registry-pull` (interim) → GHCR (cible).
5. **coherence_id servi (§4.1)** — **watermark unique dataset-level** stampé par le sync (`normalized-preprod/coherence.json`), **exposé par geo-api en OGC top-level** sur `/collections/<id>` **et** landing `/` (chemin confirmé contre la sortie OGC réelle, zéro collision), lu THROUGH l'API par la gate de fraîcheur (un pod stale ÉCHOUE) — conditionnel/rétrocompat prod (absent → omis → fail-closed).
6. **Parité de serving = MIROIR PLEIN data-driven (invariant §4/§7)** — geo-preprod sert **EXACTEMENT le set que geo-prod sert aujourd'hui** : **miroir complet** du préfixe `normalized/` (les 2 layouts plat + sous-dossier), **PAS une whitelist de familles ni un sous-ensemble**. Set réel groundé geo-socle = **3885 collections**, dont **~1088 « slug-nu » de ville** (`abercorn`, `acton-vale`…, même structure OGC) **HORS** des familles de conso immo → une parité par whitelist **sous-servirait ~1088 collections**. Les familles immo (`qc-zonage-<slug>` + variantes suffixées `-arcgis`/`-rcu`/`-affectations-arcgis`… `startsWith`, `qc-lots-<slug>`, `qc-zonage-norms-*`, `qc-tod-<slug>`, `qc-zoning-events` ; i-cond `ogc-pull.ts:689`) sont **ILLUSTRATIVES** (exemples de conso), **PAS la définition de parité**. Le sync **miroir** le set complet ; la gate coherence_id fait un **count/set-match vs prod** (set complet) — un slug-nu manquant **échoue** la gate, sinon = **faux vert**. *(Familles = conso immo i-cond ; set-complet 3885/~1088-slug-nu = serving prod vérifié geo-socle.)*

**Conséquences.**
- **Build gaté AUTORISÉ** : geo-socle construit geo-preprod (ns/deploy/ingress/secrets/sync/refresh) ; poc-k8s pose la topologie du tier joint (§6) + le chargement cross-repo ; **déploiement PROD reste owner** (KUBE_CONFIG_DATA).
- **Addition geo-api** (petite, `packages/geo`) : exposer `coherence_id` top-level (lire le manifeste au build d'index) — **preneur = socle**, ordonnancé geo-cond ; **revue geo-archi** contre §4.1. Gate socle (`geo-verify-served-collections.mjs`) + refresh (`geo-preprod-refresh.mjs`) déjà livrés+committés, fail-closed en attendant.
- **Sens-unique + Loi 25** : jambe geo = copie idempotente S3→S3 (données servies **publiques**) ; l'assainissement PII reste **immo-side** (`caveat` §9 : vérifier qu'aucune couche geo-servie n'embarque de PII d'origine immo).
- **Reste externe** : enregistrement **DNS** `api.preprod.geo.sent-tech.ca` (owner/infra) ; probe prefix-deny OVH (documentaire, différée).

**Réf.** `SPEC_GEO_PREPROD_SERVING_2026-08-15.md` (§3 Q1–Q6, §4/§4.1, §5, §7) ; immo `DOSSIER_DECISION_PREPROD_2026-08-15.md §6/§6.1` ; faits socle `geo-preprod-infra-facts.mjs @203bb250` ; gate/refresh socle `@349c3da5` ; parité conso immo `ogc-pull.ts:689` (i-cond).

## ADR-0028 — **geo adopte le plan de déploiement plateforme (CD push-CI : main→preprod auto, tag→prod same-digest)** · accepted (ratifié owner, fork O1) · 2026-08-19

**Contexte.** L'owner a **gelé le déploiement manuel** geo-preprod et demandé l'adoption du **CD plateforme** aligné
immo/sentropic (`ARCH-17`/`BR-55`, DV2 « un tier non-prod main-aligned auto-CD »). Le **fork de canal** (résidence
Loi-25) a été tranché **O1 = push-CI ratifié tel quel** (pas de GitOps, pas de re-ratification). Design d'adoption =
`DESIGN_GEO_DEPLOYMENT_PLANE_ADOPTION_2026-08-19.md` (#230). Le substrat ADR-0027 (manifests preprod committés +
invariant same-digest + `PREPROD_ACCEPTANCE`) était prêt → **adoption, zéro rework**.

**Décision (propriétaire, 2026-08-19).** geo **adopte le plan de déploiement plateforme (mécanisme B, push-CI apply)** :
1. **`main` → deploy AUTO preprod** — job CI `deploy-preprod` (kubeconfig SA least-priv ns-scopé → `kubectl apply -k
   deploy/k8s/overlays/preprod`, digest post-merge résolu par `kustomize edit set image`, self-gate coherence/complétude).
2. **tag → promotion prod** — `release-prod` off-main, **same-digest** (le digest preprod-validé, jamais rebuild ;
   ADR-0027 §8), **gaté BR-55d** (plateforme-pending) + `PREPROD_ACCEPTANCE` (self-gate + UAT owner + orthogonalité cross-repo).
3. **Manifests = Kustomize** `deploy/k8s/base` + `overlays/{preprod,prod}` (fin des manifests plats-par-env pour la ligne servie).
4. **Secrets = SealedSecrets** (controller bitnami installé) committés dans l'overlay — **évolution du modèle secrets** :
   d'« éphémère minté-en-fenêtre » (ADR-0027) → « minté 1× → scellé (`kubeseal`) → committé → long-vécu + rotation » ;
   **scoping A2 préservé** (poc-k8s mint RW-dest/RO-source puis scelle), **ferme le gap « creds live-only »**.

**Supersede le volet MANUEL de l'ADR-0027 §8** (l'apply manuel devient le pipeline CD) ; l'**invariant same-digest est
PRÉSERVÉ** (désormais enforced par la CD). Les autres invariants ADR-0027 (namespace-par-env, S3-only, bucket séparé,
coherence_id servi, parité miroir-plein, isolation A2) sont **inchangés**.

**Conséquences.**
- **Ownership** : geo = **workloads + config** (Kustomize, job CI, ADR, structure SealedSecrets) ; **poc-k8s** = tenant
  (ns/quota/RBAC SA least-priv, réf **immo `11-ci-deployer-preprod-rbac.yaml`**) + minting/scellement des creds + cert
  sealed-secrets ; **owner** = GH secret `KUBE_CONFIG_DATA_PREPROD` + **DNS** `api.preprod.geo.sent-tech.ca`.
- **Chantiers** : **C1** Kustomize base+overlays (cet ADR) · **C2** job CI `deploy-preprod` + cible Makefile · **C3**
  SealedSecrets · **C4** promotion prod (attend **BR-55d**). Coût ~6–11 p-j (preprod C1+C2+C3 maintenant).
- **Anti-invention** : adoption d'un **standard ratifié** (pas greenfield) ; conventions confirmées contre la réf **immo
  committée** (SA/RBAC, secret name) ; le Job de récup (`geo-preprod-sync`, §6.1) reste **gated-window poc-k8s** (hors CD auto).

**Réf.** `DESIGN_GEO_DEPLOYMENT_PLANE_ADOPTION_2026-08-19.md` (#230) ; ADR-0027 §8 ; standard s-archi `ARCH-17`/`BR-55`
(`SPEC_DECISION_DEPLOYMENT_PLANE.md`, hors repo geo) ; réf RBAC immo `radar-immobilier:deploy/k8s/11-ci-deployer-preprod-rbac.yaml`.

## ADR-0029 — **Adoption geo-map-engine v2.0 (basemap satellite 2D scopé, renderer-neutre)** · proposed · 2026-08-31

**⚠ Statut `proposed`** — record durable rédigé, **PAS ratifié**. Flip `accepted` **uniquement** en
référençant la ratification **owner-directe capturée** (owner présent à la session bundlée, ses mots
capturés durablement, ex. un id de décision track comme le §9 `01M1A0GDF3NRZT6CQSGW8AXMAF`) — **jamais**
sur un relais conducteur ni un say-so.

**Contexte.** Le seam moteur **v1 est GELÉ** (ADR-0026) : basemap `blank | raster | vector`, où `raster` v1
= `{ tiles: readonly string[]; attribution: string }` — un **XYZ statique à attribution statique**. Correct
pour un bare-XYZ ouvert, mais **incapable** d'exprimer un provider satellite à **clé + session + attribution
dynamique**. L'owner a choisi **Voie A = Google** (2026-08-31) et veut le **fond satellite vite**. Le draft
v2 photoréel complet a reçu un 2e avis **fable-5 = NEEDS-REWORK (borné)** (8 blockers + 9 should-fix) → le
conducteur (geo-cond) a **splitté** (2026-08-31) : le **2D part d'abord et seul** (ratifiable en jours), le
**3D photoréel suit sur son track** (mini-gate wp7). ADR-0026 grave : « toute évolution du seam gelé =
nouvelle version (semver) + ADR » → cet ADR EST le record requis pour le MAJOR.

**Décision (proposed).** Adopter **`SPEC_GEO_MAP_ENGINE_V2_BASEMAP_2D.md`** comme **v2.0 (MAJOR)** :
1. **Nouveau membre basemap `raster-source`** — **additif PUR** : les 3 membres v1 (`blank`/`raster`/`vector`)
   restent **inchangés** (vérifié byte-for-byte contre `basemap.ts`) ⟹ pas de re-piège de laxité (NOTE W5).
2. **`RasterSource { id, imageryType, attribution, policy }`** — source **ABSTRAITE** (l'adaptateur résout
   `id`→URL/clé, jamais un provider/secret au contrat) ⟹ **provider-neutre** (Google **ni** aucun autre
   n'apparaît dans le contrat public).
3. **`AttributionSpec = static{text≠∅} | dynamic`** — l'attribution peut être **dynamique** (Google 2D =
   par-viewport) ; **refus fail-closed sur ABSENCE DE MÉCANISME** (pas seulement « string vide »).
4. **`policy: SourcePolicy` REQUISE** (`live-embed-only | cacheable`) — absence **non représentable** (pas de
   fail-open) ; **garde committée + test CI MANDATÉS** (pattern ADR-0024) refusant tout octet d'une source
   `live-embed-only`, provenance portée par le **manifeste de capture** (`source_policy`).
5. **Canal d'erreur `onError` / `GeoMapError`** — additif à `GeoMapEvents` ; live-embed = refus runtime NORMAL
   (session/quota/clé) → repli déclaré obligatoire, **jamais un blanc silencieux**.
**Double-instruction PASSÉE** : fable-5 full-draft (NEEDS-REWORK) → split + rework → **re-check focalisé =
RATIFY-WITH-FIXES** (3 fixes + 1 nit intégrés, commit `fc054803`).

**Conditions de GEL (avant que le contrat soit marqué FIGÉ + que wp7 build dessus).** (b) **ratification
owner-directe** (le flip `accepted` de cet ADR) ; (c) **mini-gate wp7** — Google 2D réel : tuiles rendues +
attribution dynamique **visible dans le DOM** + garde policy **refuse** une tentative de capture S3 + **zéro
octet d'imagerie provider sur S3**. Doctrine v1 « **gel gagné sur preuve** » (ADR-0026 / SPEC §9).

**Conséquence.** Additif : v1 intact, rollback = retirer `raster-source`. **wp6** = ce contrat + les règles ;
**wp7/geo-socle** = l'adaptateur (session/clé/CSP/résolution/flux-attribution) + la garde policy committée +
le mini-gate. Le **track 3D** (`tileset-3d`/`terrain`/drape/caméra) réutilise ces types comme fondation et
ouvre son **propre PR** (après merge du §9-runner ; cap ≤2 PR).

**Réf.** `SPEC_GEO_MAP_ENGINE_V2_BASEMAP_2D.md` (PR #301, commit `fc054803`) ; `SPEC_GEO_MAP_ENGINE.md` §1/§1.5.1/§9 ;
ADR-0026 (règle semver+ADR sur le seam gelé) ; ADR-0024 (pattern garde+test par-construction) ; ADR-0030
(ODbL-reversal, décision jumelle) ; `SPEC_WORKPACKAGES.md` §1 (frontière wp6/wp7).

## ADR-0030 — **ODbL-reversal : fond satellite Google live-embed 2D (Voie A) supersède la posture blank-ODbL-safe** · accepted · 2026-08-31

**⚠ Statut `accepted` — CONDITIONNÉ à un RECORD owner-direct GENUINE.** Le flip `accepted` NE TIENT QUE sur
la **parole directe de l'owner CAPTURÉE durablement** (record ci-dessous, porté par geo-cond) — **JAMAIS** un
say-so peer, un relais, ni un record synthétisé (anti-laundering ; header decisions.md + ligne geo-archi wp6).

> **Record owner-direct** — **capturé par geo-cond, 1re main.** Session Claude Code
> `session_01BoKz6A5PUiLxg4shntStXu` (geo-cond [a0e6b7]), **2026-09-04** (horodatage = commit de ce record),
> question fermée (modal `AskUserQuestion`, 3 options) : « GO#1 — Autorises-tu le flip ODbL (ADR-0030 →
> accepted) + flag préprod ON, c'est-à-dire afficher le fond satellite Google Map Tiles 2D en direct sur
> preprod.immo.sent-tech.ca (préprod seulement, prod intouchée, plafond <50€/mois, clé restreinte) ? » —
> **réponse owner, verbatim (option sélectionnée) : « Oui — j'autorise GO#1 : flip ODbL + Google 2D live en
> préprod »**.
> **Corroboration antérieure, 1re main i-cond** (session `session_01RRZqXjiQE9rEV61i7Gx1yg`, 2026-09-04
> ~21:05Z, modal fermée) : « Pour afficher la 2D satellite en préprod, geo a besoin de 2 GO dans le repo
> geo : (1) merger #335 = accepter l'ADR-0030 (licence ODbL) + flag préprod ON ; (2) approuver le mint de la
> clé Google (#334). Tu confirmes ? » — **réponse owner, verbatim : « Oui les deux — exécute (Recommandé) »**.
> **Désambiguïsation** : « les deux » = (1) **GO#1** = ce flip (Voie A Google, fond satellite 2D live-embed,
> préprod-only) — **c'est ce record** ; (2) **GO#2** = mint de la clé (#334, dispatch `basemap-activate.yml`
> owner-approuvé), consentement enregistré ici, exécution gatée séparément (bootstrap owner + mini-gate wp7).
> Les deux captures convergent. **Aucune synthèse, aucun relais** : deux paroles owner directes, citées verbatim.

Cette PR est authorée en **DRAFT par geo-socle** (flip MÉCANIQUE : statut + flag overlay) et reste
**non-mergée** tant que (1) le record ci-dessus n'est pas renseigné par geo-cond ET (2) le contenu est
ratifié par **geo-archi (wp6)**. geo-archi VÉRIFIE à l'ouverture que le record est genuine (pas synthétisé).
⟹ **GO#1 = le merge owner APRÈS record renseigné** ; **GO#2 = le dispatch activate-serve approuvé** (mint
clé + secret). Entre les deux : flag-ON + clé absente → **503 fail-closed** (double-gate, 0 tuile live).

**Contexte.** `GeoMap.svelte:292` grave **délibérément** la posture « Tokenized blank background — **NO
external tiles** (ODbL-safe ; PMTiles basemap is a later increment) », avec `attributionControl: false`
(`:305`). C'était le choix **ODbL-safe** (aucune tuile externe, aucune obligation d'attribution externe).
L'owner (2026-08-31) : « le geo-map 3D ne présente aucun intérêt sur de la donnée non géographie … **on
cherche déjà à faire le fond** » → il veut un **vrai fond satellite** et a choisi **Voie A = Google**.

**Décision (accepted).** **Reverser** la posture blank-ODbL-safe → adopter un **fond satellite Google
live-embed 2D** (Voie A), sous les invariants du contrat v2.0 (ADR-0029) :
1. **live-embed / no-cache / no-redistribution** — les tuiles vont **navigateur → Google en direct**,
   **jamais capturées / cachées / proxifiées sur S3** (ToS Google ; précédent `SPEC_WORKPACKAGES §2` Google
   Street View « cache/rediffusion interdits »). Distinct du principe fondateur S3 (qui régit la donnée
   **capturée** ; un embed vif sous licence n'est **pas** une capture) — gravé par `policy: live-embed-only`
   + garde put-S3 (ADR-0029).
2. **attribution DYNAMIQUE rendue** — l'adoption **corrige le trap `attributionControl:false`**
   (`GeoMap.svelte:305`) : quand le `raster-source` Google lande, l'attribution Google (par-viewport) **DOIT**
   être rendue et visible (sinon = violation licencielle qui a l'air conforme).
3. **coût tenu par quota-cap** — usage Google 2D Map Tiles ; préprod = free-tier/faible ; garde-fou budgétaire
   à capitaliser (runbook `GCP_BUDGET_GUARDRAIL_3DTILES.md`, routé i-infra → repo GEO).
4. **RÉVERSIBILITÉ PRÉSERVÉE par le `source` abstrait** (ADR-0029) — un switch ultérieur vers l'**open**
   (Sentinel-2/EOX bare-XYZ, ou PMTiles auto-hébergé `cacheable`) ne change **QUE** le `source`, pas le
   contrat. La reversal est donc elle-même réversible (décision coût/licence owner, sans rework).

**Conséquence.** Supersède la posture « blank-only / no-external-tiles » de `GeoMap.svelte:292` **pour le
basemap** (les couches data continuent de porter le sens). Prend effet à ce **flip `accepted`** (owner-direct
= le merge de cette PR) : la PR flippe AUSSI l'overlay préprod `BASEMAP_2D_ENABLED` 0→1 = la **forme
déploiement** du flip (durable, git — non écrasée par cd-preprod). Le pod devient flag-ON mais **clé absente
→ 503 fail-closed** (double-gate) jusqu'à **GO#2** (dispatch activate-serve : mint clé restreinte + secret +
restart). Le **mini-gate wp7** (ADR-0029) prouve l'attribution **DYNAMIQUE** rendue (endpoint viewport —
**gratuit/non-billable**, cf `usage-and-billing` : 0 fuite coût) + le no-cache avant gel.

**Réf.** `GeoMap.svelte:292` (posture blank-ODbL-safe) / `:305` (`attributionControl:false`) ; ADR-0029
(contrat v2.0 + `source` abstrait/réversibilité) ; `SPEC_WORKPACKAGES.md` §2 (précédent Google no-cache) ;
turn owner 2026-08-31 (« on cherche déjà à faire le fond », Voie A = Google).

## ADR-0031 — **§5 basemap : mint côté CLIENT (B) — l'adaptateur minte la session Map Tiles depuis le navigateur ; l'endpoint geo-api devient un descripteur public flag-gaté** · accepted · 2026-09-05

**Décision TECHNIQUE** (choix d'implémentation DANS le scope §5 owner-autorisé d'ADR-0030), consensus geo-archi
(§3.3) + i-infra (egress/sécurité) + i-cond + geo-cond. **PAS owner-gated** (≠ ADR-0030 = scope owner) :
scope/coût/restriction inchangés, MOINS de surface ⟹ **aucun nouveau GO owner**.

**Contexte.** §2.5 posait le mint **serveur** (geo-api `createSession` → Google). Mesuré 2026-09-05 :
`/basemap/2d/session` server-mint → **502 `BasemapMintFailed` "fetch failed"** ; `/collections` 200 (geo-api UP).
Cause : netpol serving préprod (`overlays/preprod/netpol.yaml`) = egress **kube-dns + S3-BHS /32:443 SEULEMENT**
(isolation **A2** : le serving n'atteint jamais prod/internet) ; CNI **Calico** ⇒ **pas de FQDN policy**. Le seam
server-mint exigeait un egress geo-api→Google jamais prévu.

**Décision.** Mint **côté CLIENT (B)**. L'endpoint devient un **descripteur public flag-gaté**
`{ key, mapType, language?, region? }` (0 appel serveur→Google) ; l'adaptateur fait `createSession` + tuiles
**côté navigateur**. **§3.3** : la clé referrer-restreinte côté client est un **identifiant public restreint**
(referrer + API + quota), **pas un secret serveur** — déjà exposée dans chaque URL de tuile par le live-embed §3.2,
donc B ajoute **0 exposition**. Risque résiduel (spoof Referer par un client non-navigateur) **backstoppé par le
guardrail quota** (<50€, override×4).

**Alternative A (mint serveur) — REJETÉE.** Exigerait : (i) **brèche A2** — egress **large `0.0.0.0/0:443`**
pod-scopé (Calico = pas de FQDN policy) ; (ii) **2 clés** — IP-restreinte serveur (IP d'egress incertaine, nœuds
autoscalés) + referrer-restreinte browser (les tuiles portent `?key=`) ; (iii) `Referer` serveur = **spoof
INTERDIT** (clé fuitée + Referer forgé = illimitée). Plus lourd, plus de surface, moins least-priv.

**Conséquences.** 0 egress serveur ; **A2 intacte** ; pattern Map Tiles natif ; **1 clé** ; referrer-restriction
signifiante. Préserve double-gate 503 fail-closed + `no-store` + activation-par-flag owner. `SPEC §2.5.8` révise
§2.5.2/3/6. Semver+ADR (ADR-0026). **Robustesse (0.6.1, #354)** : bounded-retry descripteur `[200,400,800]ms`
(`BasemapDisabled`→OSM-immédiat / autre-503→retry / persistant→OSM) — couvre le cold-503 de warm-up rollout ;
refine le fail-closed, non-contrat.

**GEL empirique — RATIFIÉ 2026-09-05** (mini-gate P1.1–P1.6, geo-archi, **3/3 cold loads** `about:blank`→navigate) :
P1.1 descripteur 200 + **createSession navigateur→Google 200** (viabilité B confirmée au run) · P1.2 2dtiles Québec
peignent (3/3, screenshot) · P1.3 browser→Google direct + **0-S3 / 0-OSM** · P1.4 attribution **DYNAMIQUE
« Imagerie ©2026 NASA »** + refresh `moveend` (viewport-info per-bbox distinctes) · P1.6 clé QUE browser→Google ·
0 erreur console. **Nuance latence (consignée, PAS un défaut)** : rend cleanly **après ~5-8s de warm-up cold**
(**1-replica geo-api** + chaîne descripteur→createSession→viewport→20 tuiles) — pas « instantané ». **DEUX leviers
d'amélioration future, NON-worked sans owner-GO** : **(a) geo-side [levier PRIMAIRE, lane geo] — `geo-api scale≥2`**
(réduit le RT createSession + le warm-up de fetch tuiles ; 1-replica actuel) ; **(b) vues-side — perceived-perf**
(prefetch/warm createSession au load, warm-tile bas-zoom, skeleton/transition). **Distinct** du cold-503 ingress
(Traefik SPOF = item infra i-infra séparé — ne pas confondre latence-geo et 503-infra). Preuve visuelle =
**screenshot** (canvas WebGL sans `preserveDrawingBuffer` → pixel-readback inexploitable).

**Réfs.** ADR-0030 (reversal ODbL, scope owner) · ADR-0029 (contrat v2 + `source` abstrait/réversibilité) · ADR-0026
(semver+ADR sur seam) · `SPEC §2.5.8` · #341 (CORS/referrer préprod-immo) · `overlays/preprod/netpol.yaml` (A2) ·
#352 (client-mint 0.6.0) · #354 (retry 0.6.1) · mesures 502 + GEL 3/3 du 2026-09-05.

## ADR-0032 — **Moteur LLM d'extraction : credential IN-POD (D1=A, override owner de la reco B) ; D4=α = COMPTE ENRÔLÉ PAR LANE (quota + révocation EXTERNES) = LA containment d'A — le containment ne peut PAS vivre dans le pod** · accepted (ratifié owner, vérifié 1re-main i-cond) · 2026-09-06

**✅ Statut `accepted` — RATIFIÉ OWNER, vérifié 1re-main (2026-09-06).** Le **record owner-direct D1 (D1=A)** est **attesté
EN 1re MAIN par i-cond** = la **SOURCE** : l'owner a répondu **dans la session d'i-cond** (`session_016HbmM38GS7JcSCWVVRaVVW`,
qui a porté le surface `AskUserQuestion`), i-cond l'a **attesté directement à geo-archi** — **pas un relais ni un say-so
conducteur**. L'attestation a même **corrigé la troncature du relais** (verbatim complet ci-dessous) = preuve d'un
vrai check-à-la-source, pas d'un rubber-stamp. Le **containment-CADRE est FINALISÉ** (invariant compte-par-lane · gemini
in-pod-direct + requiert `8aee7f615` · 3e terme sans objet dès le per-lane-binding · parité/cap-gateway MOOT). ⟹ **flip
`accepted`** : record genuine **vérifié à la source** **+** cadre final (pattern ADR-0030). *(Record durable = CE commit git,
`decisions.md` = source-of-truth des décisions geo, ADR-0001 ; view-ref de la PRÉSENTATION = Artefact dossier pipeline `0a947e61`.)*

> **Record owner-direct D1 — ATTESTÉ EN 1re MAIN PAR i-cond (`i-cond [2622d1]`, la SOURCE), vérifié genuine par
> geo-archi.** L'owner a répondu **dans la session d'i-cond** (i-cond a porté le surface `AskUserQuestion`) ; i-cond a
> **attesté directement à geo-archi** — **pas un relais**. **Décideur = l'OWNER** (le porteur ≠ le décideur).
> - **Session** : `session_016HbmM38GS7JcSCWVVRaVVW` (session d'i-cond, modale D1) · **Horodatage** : 2026-09-06.
> - **Question fermée (verbatim COMPLET — l'attestation 1re-main a corrigé la troncature du relais)** : « **D1 — le cœur
>   du dossier credential/egress : où vit le credential du compte enrôlé quand cluster-mesh pilote la CLI ?** »
>   *(parenthèse : « approuver B adopte aussi la reco D2–D8 »)*.
> - **Options** : **A** = « pod exec la CLI » (credential dans le pod) · **B** = « host-side + reco D2–D8 » · **C** = « différer ».
> - **Réponse owner sélectionnée : A** — confirmée 1re-main. **Override assumé** (classe-de-risque €480 visible dans l'option).
> **Genuine-verification SATISFAITE** : attestation d'i-cond (source — l'owner a répondu dans sa session), **directe** à
> geo-archi, pas un relais ni un say-so ; verbatim **vérifié + corrigé à la source**. **Record durable = CE commit ADR**
> (git ; `decisions.md` = source-of-truth des décisions geo, ADR-0001) — **pas de track record fabriqué** (geo est
> file-based ; ne pas inventer un `--targets`, même discipline que le refus de fabriquer des preuves track). **View-ref de
> la PRÉSENTATION** (D1 surfacé en §2.4/§7-GATE#2 du dossier pipeline) :
> `https://claude.ai/code/artifact/0a947e61-1a56-4be6-bd9a-0fce3ca946ab` — corroboration de présentation, **distincte** du
> record de capture ci-dessus (qui, lui, est l'autorité).

**Contexte.** Le dossier D-moteur-2 (`DOSSIER_DMOTEUR2_LLM_HOSTING.md`) posait la FORME du LLM-serving d'extraction
(axes : frontière d'identité, opérateur) sur 2 options : **(A)** identité in-cluster / **credential IN-POD** (le pod
exécute la CLI, la creds vit dans le pod) vs **(B)** **egress central gateway** (workspace-JWT → gateway distante).
La reco geo-archi (fidèle, au-niveau-des-enjeux) **penchait B**, motif décisif : **B porte NATIVEMENT la
containment** — enrôlement central 1×, budget/quota/kill-switch centraux, et surtout **révocation-indépendance**
(révoquer la creds centrale coupe tous les pods, indépendamment de tout pod). geo-archi avait **explicitement gardé A
ouvert** + **disclosé** que la facilité-présentateur pouvait teinter la reco B.

**Décision (propriétaire — override, D1=A).** L'owner **choisit A** : **le pod exécute la CLI, le credential vit DANS
le pod** — override assumé de la reco B (risque €480 visible). geo **adopte A** pour ses pods d'extraction LLM.
**Substance-contrat geo-archi (wp6) — le containment d'A vit HORS du pod ; codex RÉSOLU, gemini PENDING**
*(mesh-mesuré, corrections en cascade intégrées 2026-09-06)* **:**

> **✅ CONTAINMENT-CADRE FINALISÉ (geo-archi).** Sous A, **les 2 jambes sont IN-POD-DIRECT** (le pod appelle le fournisseur
> lui-même ; **le démon host-side `:3002` = credential-sur-l'hôte = forme B, EXCLUE par D1=A**). Mesuré : k8s base = 0
> gateway/mesh/Service ⟹ **parité-(b) / cap-gateway / caller-auth-gateway = MOOT** (le pod ne traverse aucun gateway).
> **Invariant compte-par-lane externe = le cap**, dans les 2 jambes ; fail-closed = **429 fournisseur** (appel direct).
> **codex** = CLI-direct (`auth.json`) ; **gemini** = HTTP in-pod via `cloud-code-transport.ts` (**requiert `8aee7f615`** =
> cause directe du mode d'échec €480-class — point 6). **1 credential in-pod/lane → épinglage intrinsèque → 3e terme
> `selectAccountWithFallback` SANS OBJET** dès le per-lane-binding. **Reste à spécifier (non bloquant)** : per-lane-binding +
> les no-gateway-properties de gemini. **Flip gaté SEULEMENT sur genuine-verification du record D1** (voir statut).

1. **Le containment d'un chemin off-gateway ne peut PAS vivre dans le code que ce chemin exécute.** Un cap **appliqué
   in-pod** est appliqué par la chose même qu'il contraint (pod bogué le contourne, pod redémarré le perd) ; un **garde
   que le chemin bypasse** (`assertVisionModelAllowed`, gateway) **ne peut pas contenir** ce chemin (le gateway ne
   mesure pas ce qui le bypasse). ⟹ **le containment doit être EXTERNE au pod.**
2. **D4=α = COMPTE FOURNISSEUR ENRÔLÉ PAR LANE (externe), tenu par 2 MÉCANISMES** — **fail-closed-sur-épuisement** (le
   quota est un **PLAFOND**, pas un point de redirection) **+ épinglage PAR LANE** (une lane ⇒ un compte). Invariant LIÉ
   **A ⟹ α** : cap = quota-compte externe · kill-switch = révocation-compte externe **par lane** · compteur in-pod =
   **courtoisie seulement**. **A-sans-α = retour €480, INTERDIT par construction** ; α = prix non-négociable d'A.
3. **Fail-closed-sur-épuisement — sous A, appel fournisseur DIRECT (0 gateway) ; 3e terme SANS OBJET avec le
   per-lane-binding.** Mesuré : k8s base = 0 gateway/mesh/Service → le pod appelle le fournisseur **lui-même**. **Chemins
   sous A :**
   - **(a) codex** = CLI-direct in-pod (`~/.codex/auth.json`, 0 proxy) — containment = **429 FOURNISSEUR + compte-par-lane**.
   - **(b) gemini** = HTTP in-pod via `cloud-code-transport.ts` (0 proxy) — containment = **429 FOURNISSEUR + compte-par-lane**
     (point 6).
   - **(c) démon host-side `:3002`** = credential-sur-l'hôte = **forme B → EXCLU par D1=A** (pas un chemin sous A).
   - **Chemin runtime poolé `selectAccountWithFallback`** (`index.ts:1465/1868`, clé `job.id`) = là où le **débordement
     cross-fournisseur est RÉEL** — **mais 1 credential in-pod/lane (épinglage intrinsèque) ne le traverse pas** ⟹ le **3e
     terme (repli désactivé) devient SANS OBJET dès le per-lane-binding** (ceinture-bretelles si un job-launch poolé
     subsistait). ⟹ **L'invariant compte-par-lane + 429-fournisseur tient les 2 jambes.**
4. **Épinglage PAR LANE = LE VRAI AJOUT (câblage + provisionnement, PAS un flag).** Aujourd'hui le sticky binding est
   **PER-SESSION** gateway (`sessionId` HMAC ; `stickyBind`/`getBinding`), **PAS per-lane**. Le containment per-lane
   exige : **(i)** binder par le **PRINCIPAL de lane** (pas `sessionId`) · **(ii)** **pré-provisionner** lane → **compte
   unique** · **(iii)** **contraindre la sélection des nouvelles sessions** à ce compte. = **la dépendance
   « enroll-comptes-par-lane »** (build-lane + mesh) — c'est ce qui reste à construire, pas un flag.
5. **A ne PERD pas la révocation-indépendance — elle en DÉPLACE le locus ; le compte-par-lane la RESTAURE** (par lane,
   chirurgicale) = **demande owner** (« inclus au quota du compte »). *(Reco B = enrôlement central ; A = enrôlement PAR
   LANE — externe dans les deux cas, jamais in-pod. Endossé geo-cond.)*
6. **gemini sous A = IN-POD-DIRECT (DÉTERMINÉ par D1=A, PAS un open-item).** Le démon host-side `:3002` =
   credential-sur-l'hôte = **forme B écartée par l'owner** → sous A, gemini = **in-pod-direct**, déterminé (la seule
   « question » était la cohérence D1=A sur les 2 jambes = **OUI**). Le pod fait le HTTP lui-même via `cloud-code-transport.ts`
   (**constructeur de requête, pas un client** : `buildCloudCodeRequest → {url,headers,body}`). **À réunir dans le pod** :
   endpoint interne Google `…/v1internal:streamGenerateContent?alt=sse` (**SSE uniquement**) · credential enrôlé ·
   **`cloudaicompanionProject`** dans les métadonnées (**le transport LÈVE si absent**) · **User-Agent figé
   `antigravity/cli/1.1.10`** (se présente comme la CLI Antigravity = **dépendance fragile, à surveiller**).
   **3 conséquences** : **(1)** 1 credential in-pod → **aucune sélection de compte** → **3e terme SANS OBJET** (comme codex) ·
   **(2)** aucun proxy → le verdict fail-closed-proxy **NE S'APPLIQUE PAS** → containment = **429 fournisseur + compte-par-lane**
   · **(3)** bibliothèque **pas service** → **ni caller-auth, ni plafond, ni attestation** du gateway (le pod ne le traverse
   pas) → **À ÉCRIRE EXPLICITEMENT** (sinon supposé acquis).
   **⚠ CRITIQUE — `8aee7f615` = la CAUSE DIRECTE du mode d'échec gemini (classe-€480), pas un prérequis parmi d'autres.**
   Enrôlement cassé (`provider-connections.ts:1139-1140` avale les échecs de découverte, jeton pas rafraîchi) → l'enrôlement
   « réussit » **SANS `cloudaicompanionProject`** → le transport **LÈVE À L'APPEL** (pas à l'enrôlement) = exactement
   « enrôlement passe, appels échouent » = **le pattern €480**. **La jambe gemini REQUIERT `8aee7f615` mergé** (déjà écrit).
   **codex = solide** (CLI-direct : 429-fournisseur + compte-par-lane).
7. **Conséquence provisionnement (actée).** Sans repli, un compte **manquant** ne **dégrade plus** — il **ARRÊTE la
   lane** (fail-closed **voulu** ; missing-account = lane-stop, **PAS** silent-degrade).
8. **Least-priv IN-POD (convergent).** Le compte enrôlé **scopé à la lane** = least-priv ET cap ; creds in-pod
   **courte-vie + rotative + jamais-S3/logs** (durcissement) ; **révocation-compte = containment PRIMAIRE**.
9. **Gates d'admission = #362 (inchangés)** : **D5=a** coût/page · **D6=a** gold-corpus **bloquant** · **D8=a**
   déterministe-d'abord — **gate DAG `needs_llm`** = souveraineté d'ordonnancement, **DISTINCT** du containment-coût.
   Cap externe **prouvé-par-refus AVANT service** (**€50/GATE** `GATE.md:10-14`). **PAS de `CallerAuthPort`/host-side** dans A.
10. **D7=a (in-cluster) — conséquence, GATÉE plateforme.** Levier capacité cluster (98-99% CPU, board) = prérequis
    infra/plateforme, hors substance-contrat geo → **différé/gaté**. **Host-side dispo now** (Act-1 : `codex exec -m`,
    enroll host-side satisfait) ; **in-cluster (Act-2) gaté** sur ce levier + egress.

**Frontière (ce que geo NE décide PAS).** L'**emplacement physique** de la creds, la **mécanique d'enrôlement
in-pod** et le **levier capacité in-cluster** sont **plateforme (mesh/h2a/sentropic/infra)** — cet ADR **adopte** la
décision (pattern ADR-0028 : geo enregistre son adoption + ses invariants-contrat, référence la décision plateforme)
sans la re-décider. **mesh** ajuste l'enroll in-pod ; **geo-cond** fait l'attribution inter-lane. **Domicile plateforme
de la mécanique** (A⟹α, least-priv-in-pod, compte-par-lane) = `spec/DECISION_LLM_EGRESS_STANDARD_PATH.md` sur
**origin/main de sentropic** (orphelin + périmé juillet). **NE PAS y injecter la substance septembre avant que son §3
soit rafraîchi** (mesh/plateforme) — sinon 2 strates indiscernables ; **section datée autonome** quand prêt, pas
d'édition inline §3. **Jusque-là, ADR-0032 (geo-side) reste l'autorité courante** de la mécanique de containment.

**Conséquences.** Invariant gravé (**corrige/supersède la formulation plus lâche de #362** « chaque chemin *porte* son
propre cap ») : **sous A, le cap de tout chemin LLM = le quota de son COMPTE ENRÔLÉ PAR LANE (externe,
non-contournable) + la révocation-compte externe par lane** ; un **cap in-pod**, un **cap gateway**, ou un **garde
bypassable** (`assertVisionModelAllowed`) **NE SONT PAS des containments** sous A. **L'ajout d'IMPLÉMENTATION** = binder
**par lane** (aujourd'hui per-session) + **pré-provisionner** lane→compte-unique + **fail-close explicite sur le chemin
de LANCEMENT DE JOB uniquement** (`selectAccountWithFallback` ; codex-CLI-in-pod et requête-gateway sont épinglés/
fail-closed **par construction** = 2 termes) — porté **build-lane + mesh**. **gemini = in-pod-direct** (déterminé par D1=A ;
démon `:3002` = forme B écartée) → **requiert `8aee7f615`** (cause directe du mode €480 « enrôlement passe / appels échouent »)
+ **no-gateway-properties à écrire explicitement** ; containment = 429 fournisseur + compte-par-lane (0 proxy, 3e terme sans objet). Réversibilité A→B possible (backend abstrait) mais **rework** (frontière d'identité). Ce record **flip
`accepted`** sur le batch `AskUserQuestion` D1 capté (i-cond).

**Réfs.** `DOSSIER_DMOTEUR2_LLM_HOSTING.md` (options A/B, reco B, disclosure) · `DOSSIER_VISION_OCR_VALIDATION_PROTOCOL.md`
(#362 : gates D5/D6/D8 ; son invariant « chaque chemin *porte* son cap » est **corrigé ici** → cap = **compte externe par
lane**) · ADR-0024 (classe €480) · `docs/ops/gcp-3dtiles/GATE.md:10-14` + `50-test-kill.sh` (cap **externe** prouvé-par-refus)
· base D-decisions D2=a/D3=i/**D4=α**/D5=a/D6=a/**D7=a**/D8=a (adoptée, révisable owner) · pattern ADR-0028 (geo adopte une
décision plateforme + réf hors-repo) · **correction containment mesh-mesurée + i-cond-adoptée 2026-09-06** (cap = compte
enrôlé par lane EXTERNE, PAS in-pod/gateway ; kill-switch = révocation-compte, PAS drapeau in-pod) · **verdict h-runtime
(i-cond, 2026-09-06)** : codex **fail-closed-par-construction** (gateway non-anthropic ; spill = `proxy-anthropic.ts`
seul) ; le spill `account-pool.ts::selectAccountWithFallback` = **runtime job-launch (clé `job.id`), PAS gateway** → 3e terme
**job-launch-scopé** ; **sous A (in-pod-direct) le pod ne traverse AUCUN gateway → 3e terme SANS OBJET dès le
per-lane-binding** ; **per-lane-binding** (sticky per-session → per-lane : principal-de-lane + pré-provision +
contrainte-sélection) = **l'ajout** ; **gemini** = **in-pod-direct** (D1=A exclut le démon `:3002` = forme B) via
`cloud-code-transport.ts` (`buildCloudCodeRequest`), **requiert `8aee7f615`** (`provider-connections.ts:1139-1140` =
cause directe du mode €480 « enrôlement passe / appels échouent ») + no-gateway-properties.

## ADR-0033 — **Rendu des surfaces (overlays de zones) : 2 modes DISTINCTS selon le basemap — SATELLITE = transparent/contour (imagerie visible), PLAN = rempli ; principe geo-owned + boutons de switch** (amende ADR-0030) · accepted (ratifié owner, verbatim capté 1re-main i-cond) · 2026-09-06

> **⚠ Portée** : cet ADR grave la **SÉMANTIQUE** owner-attestée. Les **tokens chiffrés exacts** (fill-opacity par mode,
> contour couleur/épaisseur/opacité/halo, valeurs plan par-vue, boutons) = **DS-authoritative** (ADR-0025 §2-6). **⚠
> L'owner référence un DOSSIER VALIDÉ ANTÉRIEUR non-gité** (« on avait validé dans le dossier geo ») dont le **lien est en
> cours de récupération** (i-cond→owner) : s'il porte des valeurs/nuances plus précises, elles **RÉCONCILIENT/RAFFINENT**
> les valeurs ; la **sémantique** ci-dessous est **owner-verbatim-claire** et tient.

> **Record owner-direct** — **capturé 1re main par i-cond** (conducteur ayant porté la correction ; l'owner a répondu dans
> sa session), **relayé verbatim à geo-archi ; jugé genuine par geo-archi** (verbatim + session + date ; registre owner
> non-synthétisé ; **i-cond n'a PAS instruit le flip** = pas de laundering — le jugement de suffisance est geo-archi).
> **Décideur = l'OWNER.**
> - **Session** : `session_016HbmM38GS7JcSCWVVRaVVW` (conducteur i-cond) · **Date** : 2026-09-06.
> - **Verbatim owner** : « *on ne va pas passer en prod la merde que tu as fait sur le satellite. on a tres clairement
>   cadré j'avais validé pour que ca soit pas une merde comme ca : [capture: aplats jaune/orange opaques sur vue
>   satellite]. dans le dossier geo on avait validé d'avoir deux modes bien distinct pour le rendu des surfaces quand on
>   est en satellite vs plan. retrouve le impérativement. c geo qui doi retrouver ca. … c'est relatif au fait de pas
>   mettre des applats non transparents sur de la vue satellite. … on avait aussi spécifier les putain de bouton pour
>   switch de layer* ».
> - **Sémantique owner-attestée** : SATELLITE = surfaces **transparentes/contour** (PAS d'aplat non-transparent, imagerie
>   visible) · PLAN = **remplies** · **+ boutons de switch de layer**.

**Contexte — décision non-gitée + grounding CORRIGÉ (mesuré geo-cond).**
- **[FAIT — sweep 2026-09-06]** Non attestée en git : aucun ADR/spec/`proposed` pour le 2-mode. **ADR-0030** (`:714-715`)
  dit l'**inverse** (« couches data inchangées … pour le basemap »).
- **[FAIT — grounding corrigé]** La **vue satellite rejetée = `GeoCityMapBase.svelte`** (immo, SignauxMapView,
  **MapLibre-standalone**) : fill = couche `selected-zones-fill`, opacité via **`zoneFillOpacity=withHoverOpacityBoost`**
  (expression immo, hover min 0.55), **non conditionnée au basemap** ; elle **n'utilise PAS le moteur geo**. Le moteur geo
  (`geo-ui-svelte GeoMap.svelte:420-427`, `GeoBasemapSwitcher`) sert `GeoView` **qui n'a PAS de satellite** → le moteur
  **non plus** ne porte la règle par-mode. ⟹ **aucun des 2 chemins ne gitait le principe** = cause racine des aplats.

**Décision (propriétaire — amende ADR-0030) — PRINCIPE geo-owned.** Le rendu des **surfaces d'overlay de zones** est
**conditionné au basemap**, en 2 modes distincts, comme **principe geo-owned** (capitalisé dans le moteur geo pour
réutilisation — cohérent geo=moteur/immo=config) :
1. **PLAN** : surfaces **REMPLIES** — **valeurs par-vue existantes INCHANGÉES** (immo `GeoCityMapBase` :
   `withHoverOpacityBoost` ; moteur geo : 0.28/hover 0.55). **On n'impose PAS une valeur commune.**
2. **SATELLITE** : surfaces **TRANSPARENTES/CONTOUR** — **fill → 0** (pas d'aplat non-transparent, **imagerie visible**) ;
   la **meaning passe au CONTOUR** (couleur-famille sur le trait, contraste suffisant sur imagerie).
3. **Boutons de switch de layer** : contrôle utilisateur **spécifié**, pilote **le mode de rendu des surfaces** (pas
   seulement le type de basemap).
**Supersede** le volet « couches data inchangées quand satellite » d'**ADR-0030** (`:714-715`).

**Scope & convergence (geo-first).**
- **Fix owner IMMÉDIAT = `GeoCityMapBase.svelte`** (vue satellite immo rejetée) : garder l'expression plan immo + **ajouter
  la branche satellite** (fill → 0 + contour-famille) + les boutons.
- **Capitalisation moteur = follow-up** : le principe 2-mode se capitalise dans le moteur geo (`geo-ui-svelte GeoMap`) pour
  réutilisation.
- **⚠ DETTE geo-first (flaggée)** : la vue satellite immo **bypasse le moteur geo** (MapLibre-standalone) → c'est
  **exactement** la divergence que le cadre **geo=moteur/immo=config** adresse. **Cible de convergence** : la vue satellite
  immo devrait **utiliser/configurer le moteur geo**. Tant que non-convergé, le principe vit **aux 2 endroits** (risque de
  divergence) = dette à résorber.

**Boundary (ADR-0025).** Sémantique = wp6/owner (cet ADR) ; **tokens exacts = DS**. Proposition geo-archi interim (vues) :
satellite `fill-opacity` → **0** (ou ≤0.08 tint) + contour couleur-famille bumpé + halo ; **plan = expression existante
(inchangée)** ; boutons **Plan/Satellite**, défaut **Plan**, **host-gated GO#2**. **DS ratifie l'exact** ; le dossier validé
antérieur non-gité (lien pending) peut superséder les valeurs.

**Conséquences.** **§5 satellite HORS PROD** tant que non-conforme+vérifié : le **mini-gate wp7** (ADR-0026/0029,
« gel gagné sur preuve ») **AJOUTE** la condition « **satellite → surfaces transparentes/contour, imagerie visible, 0 aplat
opaque** » + boutons présents. **Conformité visuelle = validation owner/geo-archi** (Playwright vues bloqué). Seam immédiat :
`GeoCityMapBase` `selected-zones-fill` / `zoneFillOpacity`.

**Réfs.** ADR-0030 (`:714-715`, volet superseded) · ADR-0029/0026 (contrat v2 + gel-sur-preuve + mini-gate) · ADR-0025
(boundary sémantique-wp6 / tokens-DS) · `GeoCityMapBase.svelte` (`selected-zones-fill`, `zoneFillOpacity=withHoverOpacityBoost`
— vue rejetée) · `geo-ui-svelte GeoMap.svelte:420-427` + `GeoBasemapSwitcher` (moteur geo, sans satellite/per-mode) · dossier
validé antérieur non-gité (lien pending, i-cond→owner).

## Méthode de décision

Décisions structurantes : 2 conseillers Opus-4.8 indépendants (lecture seule) → le conductor
verrouille les accords, arbitre les désaccords et consigne l'arbitrage ici avec les `agentId` pour
audit. Décisions mineures : prises directement et consignées si elles engagent l'architecture.
