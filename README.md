# @sentropic/geo

> Acquisition, normalisation et publication de **données géographiques mondiales**, dans le respect des licences. On commence par le **Québec**, puis le **Canada**, puis le monde — à tous les niveaux administratifs.

[![CI](https://github.com/rhanka/geo/actions/workflows/ci.yml/badge.svg)](https://github.com/rhanka/geo/actions/workflows/ci.yml)

`geo` est un monorepo TypeScript qui fournit :

- une **librairie réutilisable** (`@sentropic/geo-*`) pour télécharger, normaliser et servir des données géographiques ;
- une **CLI** `geo` pour piloter l'acquisition (`geo fetch ca-qc/regions`) ;
- une **API** conforme aux standards (OGC API – Features) réutilisable par d'autres projets (ex. [radar-immobilier](https://github.com/rhanka/radar-immobilier)) ;
- un **site public** [geo.sent-tech.ca](https://geo.sent-tech.ca) pour parcourir et visualiser les jeux de données disponibles, suivant le format réutilisable du [design-system.sent-tech.ca](https://design-system.sent-tech.ca) ;
- une **chaîne d'acquisition QC** (`acquisition/`) : zonage, normes, rôle foncier, procès-verbaux, cadastre.

**Principe de licence** : chaque source déclare sa licence dans un *Source Manifest*. La lib ne (re)télécharge et ne republie que ce que la licence autorise — l'attribution amont est toujours préservée. Les fichiers bruts ne sont jamais commités ; ils restent **re-téléchargeables** à la demande.

## Principe de provenance — obligatoire

Toute donnée acquise ou servie par ce dépôt doit être fetchée avec sa preuve de
source : URL HTTP(S) d'origine, type de source, date de récupération et, quand
un fichier est téléchargé, son hash. Une copie S3 interne, un chemin local, un
libellé de méthode ou une URL de règlement ne sont pas une preuve de la
**géométrie** de zonage. Une zone sans URL de sa source géométrique réelle n'est
pas publiable dans le catalogue Immo ; elle est mise en quarantaine jusqu'à ce
que cette source soit établie sans inférence.

## Packages

| Package | Rôle |
| --- | --- |
| [`@sentropic/geo-core`](packages/geo-core) | Modèle de domaine & standards : hiérarchie administrative (ISO 3166), GeoJSON (RFC 7946), CRS, **Source Manifest** + modèle de licence. Zéro dépendance runtime. |
| [`@sentropic/geo`](packages/geo) | Moteur Node : acquisition (download/GDAL/CSV/arcgis), stockage (S3/fs, ADR-0012), API OGC API – Features, catalogue, normalisation, géoréférencement et CLI `geo` (ADR-0017). |
| [`@sentropic/geo-sources-americas`](packages/geo-sources-americas) | Manifestes + recettes des sources des Amériques (StatCan, Québec : SDA, cadastre, contraintes, civique). |
| [`@sentropic/geo-sources-europe`](packages/geo-sources-europe) | Manifestes + recettes des sources européennes. |
| [`@sentropic/geo-ui-svelte`](packages/geo-ui-svelte) | Composants Svelte (carte MapLibre + catalogue) stylés par les tokens du design-system. |
| [`@sentropic/geo-qc-sources`](packages/qc-sources) | Adaptateurs de sources québécoises + parseurs règlements/zonage/grilles (PV, normes, OCR/vision). |
| [`@sentropic/geo-qc-status-report`](packages/qc-status-report) | Générateur du rapport de statut QC (markdown + DOCX) depuis la couverture LIVE S3. |
| [`acquisition`](acquisition) | Scripts d'acquisition province-wide QC (cadastre, rôle foncier, zonage, normes, PV). 100 % TypeScript/Node. |
| [`apps/site`](apps/site) | Site SvelteKit `geo.sent-tech.ca`. |

> Convention d'extension géographique : `geo-sources-<continent>` (ADR-0017) ; les sources sont déclarées par pays/subdivision ISO 3166 (`ca-qc`, `fr`, …).

## Quickstart

```bash
npm install
npm run verify          # build + check + tests (hermétiques)

# acquisition réelle d'un jeu de données Québec (régions administratives)
npm run geo -- sources list
npm run geo -- fetch ca-qc/regions

# servir l'API OGC localement et ouvrir le site
npm run api:dev         # http://localhost:8787 (OGC API - Features)
npm run site:dev        # http://localhost:5173
```

## Architecture & rôles

Le projet est piloté en mode **conductor → agents** (voir [`docs/ROLES.md`](docs/ROLES.md)) :
construction des librairies, exécution du scraping, et publication sont des rôles distincts.
Le design produit et le plan sont dans [`PRODUCT.md`](PRODUCT.md) et [`PLAN.md`](PLAN.md).

## Déploiement

Le site statique (`apps/site`) est publié sur **GitHub Pages** sur le domaine apex
`geo.sent-tech.ca` (workflow [`.github/workflows/pages.yml`](.github/workflows/pages.yml)).
L'**API** est conçue pour le cluster partagé [`poc-k8s`](../poc-k8s) (Scaleway Kapsule) et
est exposée sur le sous-domaine `api.geo.sent-tech.ca`. Les manifests applicatifs vivent dans
[`deploy/k8s/`](deploy/k8s) ; le contrat de namespace (`requests/geo.md`, `tenants/geo/`) est
négocié côté `poc-k8s`. Ingress : `api.geo.sent-tech.ca`. Voir [`docs/deploy.md`](docs/deploy.md).

## Sécurité publique

Ce repo est **public**. Ne jamais y commiter de secret, d'URL interne privée, ni de jeu de
données dont la licence interdit la redistribution.

## Licence

Code : [MIT](LICENSE). Données : licence amont de chaque source (voir le Source Manifest).
