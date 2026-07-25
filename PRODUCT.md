# PRODUCT — @sentropic/geo

## Vision

Une plateforme ouverte d'**acquisition, normalisation et publication de données géographiques
mondiales**, à tous les niveaux administratifs (monde → pays → région/province → MRC/comté →
municipalité → localité), dans le strict respect des licences amont.

Démarrage : **Québec**, puis **Canada**, puis extension par juridiction.

## Utilisateurs & cas d'usage

- **Développeurs/projets tiers** (ex. `radar-immobilier`/immo) : consommer une **API standard**
  (OGC API – Features, GeoJSON) ou les packages npm pour obtenir des découpages administratifs
  fiables, versionnés et attribués.
- **Public** : parcourir et visualiser sur `geo.sent-tech.ca` le catalogue des jeux de données
  disponibles et déjà acquis, avec leur licence et leur provenance.
- **Mainteneurs de données** : ajouter une source en déclarant un *Source Manifest* ; la CLI
  rejoue l'acquisition de façon reproductible.

## Principes directeurs

1. **Standards d'abord** : GeoJSON (RFC 7946), CRS EPSG, ISO 3166-1/-2 pour l'identité
   administrative, OGC API – Features pour le service.
2. **Licence comme citoyen de première classe** : chaque source porte une licence ;
   l'acquisition est *gated* — on ne re-télécharge / ne republie que si la licence l'autorise.
   L'attribution amont est conservée et exposée.
3. **Reproductible & re-téléchargeable** : aucun binaire/raw lourd commité ; checksums et
   manifests permettent de tout reconstruire.
4. **Réutilisable** : un cœur agnostique, des packages composables, une API et des ports UI
   (Svelte d'abord ; React/Vue ensuite) calqués sur le design-system Sent Tech.

## Périmètre V1 (ce repo, premier lot)

- Monorepo + harnessing (CI, typecheck, tests, publish).
- `geo-core` : modèle complet (admin, geojson, crs, source-manifest, licence).
- `geo-acquire` : download + gate licence + cache/checksum + normalisation.
- `geo-source-ca-qc` : source **Découpages administratifs** (Données Québec, CC-BY 4.0).
- `geo-cli` : `sources | fetch | serve | build`.
- `geo-api` : OGC API – Features (provider fichier + squelette PostGIS).
- `geo-ui-svelte` + `apps/site` : catalogue + visionneuse carte.
- **Vertical slice réel** : `geo fetch ca-qc/regions` → GeoJSON normalisé → API → carte.
- `deploy/k8s/` + demande de tenant `poc-k8s` (ingress `geo.sent-tech.ca`).

## Hors périmètre V1 (backlog)

- Ports `geo-ui-react` / `geo-ui-vue`.
- Sources Canada complet, autres pays.
- Reprojection avancée / tuiles vectorielles (PMTiles).
- Mises à jour incrémentales planifiées.

## Standards de référence

- **GeoJSON** : RFC 7946 (CRS implicite WGS84 / EPSG:4326).
- **Identité administrative** : ISO 3166-1 alpha-2 (pays), ISO 3166-2 (subdivisions).
- **Service** : OGC API – Features (Part 1: Core), réponses GeoJSON.
- **Données Québec** : licence CC-BY 4.0 (redistribution autorisée, attribution requise).
