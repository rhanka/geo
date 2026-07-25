# ROLES — pilotage conductor → agents

Ce projet est piloté en mode **conductor / agents** (modèle h2a). Le conductor possède
l'architecture et le contrat ; il **délègue** l'exécution à des agents mandatés par fonction.

## Conductor

- **Instance h2a** : `claude:geo` (canal), bus partagé `~/h2a-workspace/.h2a`.
- **Possède** : l'architecture, le **contrat monorepo** (config racine, frontières de packages,
  interfaces de `@sentropic/geo-core`), le séquencement, l'intégration, et le **push GitHub**.
- **Ne fait pas** lui-même le gros de l'implémentation : il définit les interfaces, délègue,
  puis intègre et vérifie (`npm run verify`).

## Rôles délégués (mandats)

| Rôle | Mandat | Périmètre / outputs | Frontière |
| --- | --- | --- | --- |
| **lib-build** (construction des librairies) | Implémenter les packages TypeScript contre les interfaces `geo-core`. | `geo-acquire`, `geo-source-ca-qc`, `geo-cli`, `geo-api`, `geo-ui-svelte`, `apps/site` + tests unitaires. | N'édite que le sous-arbre de son package ; ne lance pas `npm install` (lockfile détenu par le conductor). |
| **scrape-exec** (exécution du scraping) | Faire tourner l'acquisition réelle et produire les données. | `geo fetch` réel sur les sources, vérification de la **gate licence**, GeoJSON normalisé + checksums + fixtures committées pour CI. | Ne modifie pas le code des libs ; signale les bugs au conductor/lib-build. |
| **publish** (publication) | Release & déploiement. | Workflows npm (Trusted Publishing par package), Docker `geo-api`, manifests `deploy/k8s/`, PR `requests/geo.md` sur `poc-k8s`. | Ne publie pas sans `verify` vert ; ne crée pas de secret en clair. |

## Invariants (h2a)

- Un **scope** ne signe pas ; une **instance mandatée** signe pour un scope.
- Les agents délégués sont en **exécution seule** par défaut (non-signataires) ; le conductor
  intègre et engage le push.
- Toute troncature de périmètre (top-N, échantillon, retry désactivé) doit être **journalisée**.

## Contrat de délégation lib-build

Chaque agent lib-build reçoit : (1) le chemin exact de son package, (2) l'interface publique de
`@sentropic/geo-core` à respecter, (3) la consigne « édite uniquement ton sous-arbre, n'exécute
pas `npm install`, fais passer `npm run check` et `npm test` dans ton package ». Les dépendances
inter-packages passent **toujours** par les exports publics de `geo-core` (jamais d'import de
chemin interne).
