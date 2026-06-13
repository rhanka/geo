# PLAN — implémentation V1

Exécution pilotée par le conductor (`claude:geo`), déléguée par vagues. Voir `docs/ROLES.md`.

## Phase 0 — Fondation & contrat (conductor) ✅

- Monorepo npm workspaces, `scripts/run-workspaces.mjs`, `tsconfig.base.json`, CI, docs, licence.
- `@sentropic/geo-core` **complet** : `admin`, `geojson`, `crs`, `license`, `source-manifest`,
  `feature` + tests. C'est le **contrat** des autres packages.
- Stubs `package.json` + `tsconfig.json` + `src/index.ts` pour tous les packages ; `npm install`.

## Phase 1 — Librairies (lib-build, parallèle)

- **geo-acquire** : `download()`, gate licence, cache + checksum sha256, `normalize()`.
- **geo-api** : Hono, OGC API – Features (landing/conformance/collections/items), provider
  fichier GeoJSON + squelette PostGIS, OpenAPI.
- **geo-ui-svelte + apps/site** : composants carte MapLibre + catalogue ; site SvelteKit
  (adapter-static) avec chrome design-system.

## Phase 2 — Source & CLI (lib-build)

- **geo-source-ca-qc** : Source Manifest « Découpages administratifs » (Données Québec, CC-BY 4.0),
  fetch ArcGIS REST (`SDA_WMS/MapServer` → GeoJSON), normaliseurs régions/MRC/municipalités.
- **geo-cli** : `geo sources list|show`, `geo fetch <source/dataset>`, `geo serve`, `geo build`.

## Phase 3 — Acquisition réelle (scrape-exec)

- `geo fetch ca-qc/regions` réel → vérif gate licence → `data/normalized/ca-qc/regions.geojson`
  + checksum ; fixture committée pour CI hermétique et seed API/site.

## Phase 4 — Publication (publish)

- CI : typecheck/test/pack-smoke. Publish : Trusted Publishing npm par package (tag-driven).
- Docker `geo-api` → registry Scaleway ; `deploy/k8s/` (Deployment/Service/Ingress + PostGIS).
- PR `requests/geo.md` + `tenants/geo/` sur `../poc-k8s` (ingress `geo.sent-tech.ca`).

## Phase 5 — Intégration & push (conductor)

- `npm run verify` vert, commits cohérents, **push `rhanka/geo`**, vérification finale.

## Definition of Done V1

- `npm run verify` passe (build + check + tests hermétiques).
- `geo fetch ca-qc/regions` produit un GeoJSON normalisé valide (exécution réelle vérifiée).
- `geo-api` sert les régions en OGC API – Features ; `apps/site` les affiche sur une carte.
- Repo poussé sur `rhanka/geo` ; demande de tenant ouverte sur `poc-k8s`.
