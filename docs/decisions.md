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

## Méthode de décision

Décisions structurantes : 2 conseillers Opus-4.8 indépendants (lecture seule) → le conductor
verrouille les accords, arbitre les désaccords et consigne l'arbitrage ici avec les `agentId` pour
audit. Décisions mineures : prises directement et consignées si elles engagent l'architecture.
