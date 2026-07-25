# Plan de migration 16 → 5 packages — `@sentropic/geo` (ADR-0017)

Branche : `refactor/packages-v2`. Monorepo **npm workspaces** (`packages/*`, `apps/*`),
`verify = build (topo) + check + test`, **352 tests** baseline (invariant). Aucune `tsconfig`
`references`, aucun path alias : résolution par symlinks workspace + `exports`. Renommer un
package = `package.json#name` + imports qui le citent + 3 listes de packages dans les workflows.

## Cible (5 packages)
- `@sentropic/geo-core` — modèle/types/licences/schéma manifeste/catalogue. Léger, browser-safe.
  **+ `FieldMap`, `DatasetManifest.fieldMap?`, `recipe?`, types `SourceRegistry`/`NormalizerFn`,
  + `featuresToCollection` déplacé ici** (casse le cycle recettes→geo).
- `@sentropic/geo` — moteur Node : fusion geo-acquire+geo-storage+geo-sources+geo-api+geo-cli.
  Sous-dossiers `src/{acquire,storage,normalize,catalog,api,cli}` + `index.ts`. `bin geo`→`dist/cli/cli.js`.
- `@sentropic/geo-ui-svelte` — `GeoMap`, **inchangé** (dep `geo-core` + `dataviz-core`).
- `@sentropic/geo-sources-americas` — CA/QC : ca, ca-postal, ca-qc(+statcan-csd+municipalities),
  ca-qc-cadastre, ca-qc-civic, ca-qc-constraints. Registre `{manifests, recipes}`.
- `@sentropic/geo-sources-europe` — FR : fr, fr-postal, fr-stat. Registre `{manifests, recipes}`.

## Décisions d'architecture (validées)
1. **`geo` NE dépend PAS des libs continent** (sinon cycle topo). L'inventaire devient **injecté** :
   `buildInventory(registries)`, `createApp(provider, inventory?)`, `buildRegistry(registries)`.
2. **`featuresToCollection` → `geo-core`** (réexport temporaire depuis `geo/acquire`) pour que les
   recettes continent ne dépendent que de `geo-core` (zéro cycle). `geo-core` ne porte QUE des types
   + helpers purs ; `Normalizer` concret reste dans `geo`.
3. **Bin `geo` charge les continents par import dynamique optionnel** (try/catch
   `import("@sentropic/geo-sources-americas")` …) → `geo fetch ca-qc/sda` marche en Docker/k8s sans
   dépendance dure. Continents déclarés `optionalDependencies`/peer-optional (non suivis par le tri topo).
4. **Contrat de registre unifié** (résout l'hétérogénéité 4-slots actuelle : `normalizers` /
   `referentialNormalizers` / `csvNormalizers` / civic sans registre) :
   `type NormalizerFn = Normalizer | CsvNormalizer | ReferentialNormalizer;`
   `interface SourceRegistry { manifests: SourceManifest[]; recipes: Record<string, NormalizerFn>; }`
   `fetch.ts` dispatch le slot d'`acquire` selon `dataset.format`/`recipe`.

## Mapping fichier → cible (résumé)
- `geo-acquire/src/*` → `geo/src/acquire/*` ; `geo-storage/src/*` → `geo/src/storage/*` ;
  `geo-api/src/*` (+`providers/`) → `geo/src/api/*` ; `geo-cli/src/*` (+`commands/`) → `geo/src/cli/*` ;
  `geo-sources/src/inventory.ts` → `geo/src/catalog/inventory.ts` (**refactor `buildInventory`**).
  Nouveau `geo/src/normalize/field-map.ts` (+test) = normaliseur générique (porte `makeSdaNormalizer`).
  Imports cross-package → relatifs (`../acquire/index.js` …). `exports` : `.`,`./acquire`,`./storage`,
  `./api`,`./api/app`,`./cli`,`./catalog`,`./normalize`. Deps union dédupliquée : geo-core,
  @aws-sdk/client-s3, hono, @hono/node-server, pg, commander ; devDeps proj4/@types/proj4/@types/pg.
- 6 sources CA/QC → `geo-sources-americas/src/{ca,ca-postal,ca-qc,ca-qc-cadastre,ca-qc-civic,ca-qc-constraints}/`
  ; 3 FR → `geo-sources-europe/src/{fr,fr-postal,fr-stat}/`. Tests suivent leur code. `index.ts` = registre.
  Imports `@sentropic/geo-acquire` → `@sentropic/geo-core` (featuresToCollection) ou `@sentropic/geo` (peer).
- **Convertir en `fieldMap` (recette supprimée)** : SDA ca-qc (régions/MRC/munis), ca-provinces,
  fr-régions/départements. **Restent recettes bespoke** : StatCan CSD name-join, FSA referential,
  cadastre, CPTAQ/BDZI/GRHQ, fr-communes(.7z), INSEE COG, La Poste CSV, terrAPI/MAMH fetchers.

## Sites de réécriture
- `apps/site/src/routes/sources/+page.ts` : `INVENTORY` n'existe plus → `buildInventory([americas,europe])`.
  `apps/site/package.json` : deps `geo-sources`/`geo-api` → `geo` + `geo-sources-americas`/`-europe`.
  Le reste du site (`geo-core`, `geo-ui-svelte`) **inchangé**.
- `package.json` racine : scripts `geo`/`api:dev` → `@sentropic/geo`. `workspaces` glob inchangé.
- `scripts/run-workspaces.mjs`, `ci.yml`, `docker-publish.yml`, `tsconfig` : **inchangés** (génériques).
- `npm-publish.yml` : 2 listes 8→**5** en ordre deps (geo-core→geo→geo-sources-americas/-europe/geo-ui-svelte)
  + release-guard `publishable[]` (5 package.json) + 5 lignes `npm publish`.
- `pages.yml` : `paths` `packages/geo-sources/**` → `packages/geo/**` + `geo-sources-americas/**` + `geo-sources-europe/**`.
- `Dockerfile` : symlink → `packages/geo/dist/cli/cli.js` ; CMD → `packages/geo/dist/api/server.js`.
  `deploy/docker-entrypoint.sh` : ajuster la résolution du dossier data (server.js +1 niveau profond).
  `deploy/k8s/job-fetch.yaml` : invocation `geo fetch …` inchangée (bin name conservé).

## Phases (verify EXIT=0 + 352 tests à chaque borne ; commit par phase)
- **A — geo-core types** : A1 `FieldMap`/`fieldMap?`/`recipe?`/`SourceRegistry`/`NormalizerFn` + validate + tests ;
  A2 déplacer `featuresToCollection` vers geo-core (réexport rétro-compat). Checkpoint verify.
- **B — créer `geo`, acquire+storage** : scaffold `packages/geo` ; déplacer acquire+storage (+tests),
  imports→relatifs, barrels + exports ; supprimer geo-acquire/geo-storage ; pointer geo-api/geo-cli vers
  `@sentropic/geo/acquire|/storage` (même commit). Checkpoint verify.
- **C — api+cli+catalog+fieldMap dans `geo`** : déplacer api/* (exports `./api`,`./api/app`) ; cli/*
  (bin `dist/cli/cli.js`, scripts dev/start) ; inventory→catalog + `buildInventory(registries)` +
  `createApp(provider,inventory?)` ; créer `normalize/field-map.ts`+tests ; unifier `buildRegistry` +
  dispatch slot dans `fetch.ts` ; supprimer geo-api/geo-cli/geo-sources. Checkpoint verify (registres mock/injectés dans tests).
- **D — libs continent** : scaffold americas+europe ; déplacer 6 CA/QC + 3 FR (tests suivent) ;
  imports→geo-core/geo ; `index.ts` registres (`manifests`/`recipes` + ré-exports nommés conservés :
  QC_MUNICIPALITIES, fetchQcCivicAddresses, parseQcCivicAddresses, fetchRoleXml) ; convertir simples en
  fieldMap ; supprimer 9 anciens geo-source-* ; bin `geo` import dynamique optionnel des 2 continents.
  Checkpoint verify + `geo fetch ca-qc/sda qc-regions` OK.
- **E — site+workflows+deploy+docs** : apps/site (+page.ts + package.json) ; npm-publish/pages/root scripts ;
  Dockerfile+entrypoint+job-fetch ; README/backlog + ADR-0018 « migration exécutée ». Checkpoint final verify.

## Risques (garde-fous)
1. **Cycle de deps** : `featuresToCollection`→geo-core + import dynamique des continents (pas dep dure). Vérifier `run-workspaces.mjs` ne lève pas `dependency cycle`.
2. **`verbatimModuleSyntax`/`isolatedModules`** : ré-exports de types en `export type`. Préserver `import type { Store }` (acquire ne tire pas @aws-sdk au runtime).
3. **`exactOptionalPropertyTypes`** : construire les props optionnelles par assignation conditionnelle (style existant). Le normaliseur fieldMap doit suivre.
4. **Bin/CMD** : nom `geo` conservé ; chemins `dist/cli/cli.js` + `dist/api/server.js` changent → MAJ Dockerfile + entrypoint (sinon job-fetch prod cassé).
5. **Résolution recette** : `recipe:"<id>"`→`recipes[id]` ; valider au `buildRegistry` (clé présente, bon slot selon format).
6. **Fixtures/ADR-0007** : cacheDir temp isolé préservé ; `municipalities.qc.json`/`fixtures.ts` importés en module.
7. **Inventaire injecté** : ne pas oublier d'injecter dans `serve` (sinon `/sources` vide) → test de régression.
8. **Stabilité S3** : les `sourceSlug`/`datasetId` (clés bucket `sentropic-geo`) NE doivent PAS changer (manifestes déplacés tels quels) → test sur ids inchangés.
9. **Ordre/versions publish** : 5 versions identiques (release-guard) ; peer `geo` des continents ne crée pas de cycle de publication.

## Fichiers critiques
- `packages/geo-core/src/source-manifest.ts` (fieldMap/recipe/types registre)
- `packages/geo-cli/src/registry.ts` (buildRegistry injecté)
- `packages/geo-sources/src/inventory.ts` (buildInventory(registries))
- `packages/geo-acquire/src/acquire.ts` (dispatch slots + base fieldMap)
- `.github/workflows/npm-publish.yml` (8→5 + release-guard)
