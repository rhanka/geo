# Backlog / Track — @sentropic/geo

Source de vérité du backlog (le MCP `track` étant indisponible — voir [ADR-0001](decisions.md)).
Piloté en `/loop` par le conductor ; délégation ≤4 sous-agents en parallèle.

Statuts : ⬜ todo · 🟡 in-progress · ✅ done · ⛔ blocked. Rôles : voir [`ROLES.md`](ROLES.md).

## Objectif

Capitaliser la lib `@sentropic/geo` jusqu'à **publication npm + API hébergée** (`geo.sent-tech.ca`
sur `poc-k8s`), en priorisant les **villes/municipalités du Québec** (besoin `immo`).

---

## État (2026-06-14) — backlog autonome ÉPUISÉ ✅ (352 tests, PR rhanka/geo#1)

**Livré** (tout poussé sur `scaffold/geo-v1`, CI verte) :
- **Lib** : `geo-core` (modèle/standards/licences/Source Manifest/référentiel), `geo-acquire`
  (download + gate licence + cache/checksum + GDAL bulk + `.7z` + CSV + `referentialNormalizer`),
  `geo-api` (OGC API – Features + `/sources` + provider fichier/S3 + CORS), `geo-cli`, `geo-storage`
  (S3 Scaleway), `geo-sources` (inventaire 13 sources), `geo-ui-svelte`, `apps/site`.
- **Données / 3 pays** : QC (SDA régions/MRC/**municipalités**, StatCan CSD, cadastre, CPTAQ/BDZI/GRHQ,
  terrAPI+MAMH), Canada (provinces, FSA postal), France (IGN ADMIN EXPRESS, INSEE COG, La Poste).
  Capitalisation **immo** complète (ADR-0013). Données → **S3** (`sentropic-geo`, ADR-0012).
- **Carte WebGL** (`GeoMap`, MapLibre v5) : MVP + choroplèthe + légende + recherche + panneau détail +
  binning délégué à `@sentropic/dataviz-core@0.4.37` (choroplèthe/hexbin/cluster/density, inc.2b/2c,
  ADR-0016 ; glue locale retirée, équivalence prouvée). Page `/carte` + `/sources`. Consensus
  dataviz/DS/immo tranché (ADR-0014/0015/0016).
- **Déploiement** : Dockerfile + `deploy/k8s/` (API S3) + workflows CI/npm-publish/docker-publish +
  **GitHub Pages** (`pages.yml`, apex) + PR poc-k8s `k8s-ops#30`.
- **Gouvernance** : ADR-0001→0015, registre de licences, ce backlog.

**Reste — dépend de TOI (user-gated)** :
- 🔑 **Publication npm** : créer le token/scope (`@sentropic`) → la CI `npm-publish.yml` (tag-driven) publie.
- 🌐 **Hébergement live** : merge `scaffold/geo-v1`→`main` (déclenche Pages + CI), DNS `geo.sent-tech.ca`→Pages
  + `api.geo.sent-tech.ca`→LB, et amender l'ingress poc-k8s (`k8s-ops#30`) sur le sous-domaine API.
- ✅ GO pour qu'immo bascule `SignauxMapView`→`GeoMap` (immo attend ton feu vert).

**Reste — polish optionnel (autonome, faible priorité)** :
- inc.4 basemap **PMTiles** auto-hébergé (le MVP marche sur fond tokenisé) ; inc.5 **projection routière**
  deck.gl (bloqué : pas de source de routes — nécessite une couche RRN/Adresses QC d'abord) ;
  variante `DatasetCard` pour le catalogue de sources. (`/sources` dans l'OpenAPI = ✅ livré.)

---

## P0 — Vertical slice : municipalités du Québec servies par l'API  🟡

But : `geo fetch ca-qc/sda#qc-municipalites` → GeoJSON normalisé WGS84 → `geo-api` (OGC Features,
collection `qc-municipalites`) → carte sur `apps/site`. Données Québec SDA, CC-BY 4.0 ([ADR-0006]).

| # | WP | Rôle | Statut |
|---|----|------|--------|
| P0.1 | `geo-core` contrat (admin, geojson, crs, licence, source-manifest, `kind`) | conductor | ✅ |
| P0.2 | `geo-acquire` (download, gate licence, arcgis, acquire/writeNormalized) | lib-build | ✅ |
| P0.3 | `geo-api` OGC Features + FileProvider **récursif** ([ADR-0005]) | lib-build | ✅ |
| P0.4 | `geo-source-ca-qc` : manifests SDA (régions, MRC, **municipalités**) + normalizers, ids `qc-*` | lib-build | ✅ |
| P0.5 | `geo-cli` : `sources`, `fetch`, `serve`, `build`, `refresh`, `licenses build` | lib-build | ✅ |
| P0.6 | `geo-ui-svelte` + `apps/site` : catalogue + carte MapLibre (chrome design-system) | lib-build | ✅ |
| P0.7 | **scrape réel** via GPKG bulk + GDAL ([ADR-0008]) : régions 18, MRC 106, **municipalités 1343** (WGS84, simplifié, ~6.7 Mo) | scrape-exec | ✅ |
| P0.8 | `data/requests/` ledger (municipalités = demande immo) + registre licences QC | conductor | ✅ |

**P0 livré** : `npm run verify` vert (geo-core 19 / geo-acquire 31 / geo-api 18 / geo-source-ca-qc 8 / geo-cli 30 tests) ; `GET /collections/qc-municipalites/items` → 1343 features GeoJSON servies par l'API. Reste : déploiement (P6) pour l'exposer publiquement.

## P-S3 — Stockage object storage (S3 Scaleway)  ⬜ **priorité haute** ([ADR-0012])
Fondation manquante : la donnée scrappée doit vivre sur **S3** (Scaleway Object Storage), pas dans git.
- `@sentropic/geo-storage` : `Store` (`get/put/list/has`) + `FsStore` (dev/CI) + `S3Store` (`@aws-sdk/client-s3`, endpoint `s3.fr-par.scw.cloud`).
- `geo-acquire`/CLI : `writeNormalized` → `Store` ; `geo fetch --out s3://sentropic-geo/normalized`.
- `geo-api` : `geo serve --data s3://…` (provider lit le bucket, cache).
- Deploy : Job `geo fetch` **écrit** S3 ; API **lit** S3 ; secret `geo-s3-credentials`. Amende PR poc-k8s #30 (bucket `sentropic-geo` fr-par).
- Migration : retirer les géométries committées (QC/FR) de git → S3 (garder au plus un échantillon CI).

## P-immo — Capitalisation du scraping immo  ⬜ **priorité haute** ([ADR-0013])
« La valeur de la lib » : reproduire le scrapping + les assets d'immo (`~/src/radar-immobilier`),
périmètre dans `/tmp/etude-geo/separation.md`. Chunks :
- **Lot 1 (immo demande)** : registre **1106 munis QC** + schéma `Municipality` + **polygones StatCan CSD**
  (name/code-join `MUS_CO_GEO`) → `geo-source-ca-qc` ; données → S3. 🟡 *(bg)*
- **Lot 2** : adapter **terrAPI adresses** + fetcher **MAMH role-evaluation** (XML) → sources geo.
- **Lot 3** : **GeoSourceInventory** + contraintes **CPTAQ/BDZI/GRHQ** (manifests/recettes).
- **Lot 4** : **StatCan census profile** + **orthophotos** + cadastre allégé SDA.
- Garde-fous : anti-PII (Loi 25), anti-invention, OSM=ODbL → recettes/URLs only. immo = consommateur.

## P-dataviz — Composant carte WebGL géo + showcase geo.sent-tech.ca  ⬜ **priorité haute** ([ADR-0014])
Pilotage Opus-4.8, **double-revue 4.8**, décisions réversibles. Phases : **spec → consensus → build →
publish (main) → deploy (GitHub Pages site + k8s API)**.
- `@sentropic/geo-ui-svelte` : composant **`GeoMap` WebGL** (classe deck.gl) remplaçant Leaflet/raster —
  basemap vectoriel + couches admin + données QC + dataviz géo (choroplèthe, projection sur routes).
  Ontologie-agnostique (catégories labellisées+colorées + schéma détail passés par le consommateur).
- `apps/site` (geo.sent-tech.ca) : showcase des composants dataviz géo + parcours des géographies,
  format design-system ; recherche en haut (graphify), légende+bulle, panneau détail dépliable, FR.
- Frontière dataviz/geo + composants DS (légende+bulle, search, chrome) : coordination h2a en cours.
- Cas d'usage immo : remplace SignauxMapView (labels FR, types lisibles, détail citation/pdf/meta).

## P1 — Durcissement API + site pour la collection municipalités  ⬜
Pagination/bbox/filtre, OpenAPI complet, états vides gracieux, attribution CC-BY affichée.

## P2 — Premier lot de données `immo` ("zones")  ⛔ bloqué (input immo)
Bloqué : nécessite le **contrat d'attributs exact** de `radar-immobilier` (zones → lots) et la
coordination immo (h2a indisponible cette session). Préparé : municipalités QC servies + entrée
ledger `data/requests/ca-qc-sda__qc-municipalites.json` (`requestedBy: immo`, [ADR-0004]).
Au déblocage : modéliser zones/lots en dataset QC avec `geoId` stable + rescrape des datasets immo.

## P3 — Provinces du Canada  🟡
`geo-source-ca` : StatCan 2021 cartographic boundaries, **OGL-Canada**. ✅ provinces+territoires (13,
PRUID→ISO 3166-2) — package + manifest + tests verts, **non seedé** (17.8 Mo > budget [ADR-0010],
reproductible via `geo fetch`). ⬜ census divisions (CD) déclaré, non produit (follow-up).
**Follow-up** : généralisation par aire (anneaux < seuil) pour une couche légère committable.

## P4 — France (data.gouv.fr / IGN)  🟡
`geo-source-fr` : **ADMIN EXPRESS COG CARTO** (IGN), **Licence Ouverte 2.0**. ✅ régions (18) +
départements (101) produits & servis. ⬜ communes (34 877) déclarées mais non produites (volume —
TopoJSON / découpage départemental / attributs réduits, voir [ADR-0009]).
**Follow-up geo-acquire** : support `.7z`/libarchive (IGN livre en `.7z`, `/vsizip/` ne lit que ZIP)
pour que `geo fetch fr/...` marche de bout en bout ([ADR-0009]).

## P5 — Référentiels statistiques & postaux  ⬜
Par pays, `kind: "statistical"` / `"postal"` ([ADR-0002]). Packages frères créés à l'implémentation :
- `geo-source-ca-stat` (Statistics Canada — DGUID/SGC, géographies de recensement)
- `geo-source-ca-postal` (FSA StatCan ouvert ; PCCF complet = **non redistribuable**, gate)
- `geo-source-fr-stat` (INSEE — COG, IRIS), `geo-source-fr-postal` (BAN / code postal↔commune)
- Postal **après** l'admin dans chaque pays (licences restrictives à vérifier d'abord).
- **Modèle décidé** ([ADR-0011]) : crosswalks/codes = features `geometry:null` (servis par l'API OGC).
  **Pré-requis lib** : `geo-acquire` doit gagner les formats **CSV** + **`.7z`** (débloque aussi
  `fr-communes`). Gate licence stricte : seulement les référentiels ouverts (OGL / Licence Ouverte).

## P6 — Publication  🟡 harnessing fait, publication "à la fin"
- ✅ Harnessing : `Dockerfile` (+gdal), `deploy/k8s/` (deployment/service/ingress/pvc/job-fetch),
  workflows `npm-publish` (Trusted Publishing) + `docker-publish` — **tag-driven, rien d'auto**.
- ✅ Demande tenant poc-k8s : PR `rhanka/k8s-ops#30` (`requests/geo.md` + `tenants/geo/`, ingress
  `geo.sent-tech.ca`).
- ⬜ Publication effective (npm publish, docker push, déploiement, site→CDN) — **à la fin**, par
  l'owner (Playwright MCP prévu pour le CDN).

---

## Registre licences (P-transverse, continu)
`licenses/registry.json` (machine) + `docs/licenses.md` (généré). Toute nouvelle source ⇒ entrée +
vérif anti-dérive vs `geo-core.LICENSES` ([ADR-0003]).

## Invariants de pilotage
- Avancer **par priorité** ; ne pas ouvrir Pn+1 tant que Pn n'est pas livrable, sauf si bloqué
  (alors prendre une tâche transverse, ex. France/registre, pour ne pas rester idle).
- Chaque itération `/loop` : déléguer → intégrer → `verify` → committer → consigner décisions.
- ≤4 sous-agents/dockers en parallèle.
