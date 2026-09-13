# Éradication SCW du périmètre GEO

Directive propriétaire : le registre partagé reste disponible pour matchid ;
geo utilise GHCR et OVH. Aucun registre partagé ni objet S3 n'est supprimé.

## Réalisation au 13 septembre 2026

Livraison du nettoyage : [PR #376](https://github.com/rhanka/geo/pull/376),
après la fusion de #375. Les images finales contiennent les générateurs sans
secret de registre historique ; les références du dépôt épinglent leurs digests
publics vérifiés. L'état du merge et du rollout préprod est consultable dans la
PR et ses workflows ; cette modification ne déclenche pas de déploiement prod.

| Périmètre | État et preuve |
|---|---|
| geo-api, CD prod/préprod, CPTAQ | GHCR, PR #371 à #374 fusionnées |
| geo-capture | PR #375 fusionnée (`99d4faf4`), revue Gemini demandée archivée dans `docs/reviews/scw-capture-375.md` |
| geo-acquisition et normes-job | Builds reproductibles ajoutés à `docker-publish.yml`, images publiques GHCR, références par digest |
| Secrets de registre dans les manifests et générateurs | Retirés ; option de registre privé du générateur S3-DAG conservée, sans défaut legacy |
| Réintroduction | `node scripts/check-registry-policy.mjs` exécuté en CI, couvre manifests, workflows, générateurs et page HTML |
| Stockage | OVH depuis le 29 juillet ; `acquisition/config/s3-target.json` et le garde de cible restent autoritaires |

Le build final est le run
[34758292002](https://github.com/rhanka/geo/actions/runs/34758292002), réussi
sur `1208030953417d9ce531719d8994670e882732b0`, tag `registry-clean-20260913`.
Les trois digests ont été lus anonymement avec HTTP 200 avant repoint :

- `ghcr.io/rhanka/geo-capture@sha256:8ea20a8f1709d6251f7758c3697a79532bc36cb75a567fbbff11dd87d0baac53`
- `ghcr.io/rhanka/geo-acquisition@sha256:ef583941503667f6ff0ccf3dd8fbc978f658a228bafc7c8731554dc0706ff785`
- `ghcr.io/rhanka/normes-job@sha256:057bb84cf94e9efb52d09e81fc4560696ce54410d0be3cdeec54a33e861d9a0b`

## Capacités préservées

Le dossier `deploy/normes-job/` est nécessaire : il fournit le mode Kubernetes
`captured`, les PDF pré-stagés (`extract`) et `full`. L'investigation du
12 septembre ne trouvait aucune définition Serverless `normes-job` ni run actif,
mais confirmait des reçus d'extraction Kubernetes d'août. Supprimer le dossier
retirerait cette capacité. Son image est donc migrée, ses instructions Serverless
retirées. Aucune campagne d'extraction payante n'est déclenchée par cette migration.

Les Dockerfiles embarquent les sources du package geo, les contrats de cible et
la résolution ESM des dépendances. Un import du véritable module d'extraction
pendant le build empêche une image verte mais incapable de démarrer.

La page `docs/index.html` était une ancienne démonstration utilisant un endpoint
PMTiles SCW. Pages publie maintenant `apps/site/build` (`pages.yml`). L'ancienne
page redirige vers ce site courant : la remplacer par une URL OVH privée (HTTP
403 mesuré) aurait simplement introduit un lien inutilisable.

Les rapports datés, décisions historiques et tests négatifs anti-SCW ne sont pas
réécrits : ils ne constituent pas une dépendance d'exécution.

## Vérification opérationnelle

L'inventaire OVH du 13 septembre trouve deux pods actifs : `geo-api` (GHCR) et
`postgis` (Docker Hub). Aucun CronJob ni extraction active. D'anciens Jobs de
juillet contiennent encore des références historiques SCW ; leur historique
n'est pas relancé ni supprimé par la migration.

Le secret GitHub `SCW_SECRET_KEY` a été supprimé le 13 septembre après vérification
de l'absence de consommateur dans les workflows de main et de la branche. Son
absence a été confirmée par relecture de la liste des secrets du dépôt.

Le secret Kubernetes `geo-registry-pull` reste présent dans `geo`, avec une
référence dans le Deployment prod encore déployé. Son image est déjà publique
sur GHCR. Le compte `system:serviceaccount:geo:ci-deployer` ne peut pas supprimer
les Secrets et ne lit pas le namespace geo-preprod. Le retrait dans le dépôt
ne constitue donc pas une suppression de ce secret sur le cluster.

## Validation

- `npm run build` et `node scripts/run-workspaces.mjs check` réussis.
- `npm test` : 3 998 tests réussis ; 7 tests déjà marqués skipped.
- `npm run test:scripts` : 10 tests réussis, dont la garde anti-réintroduction.
- `npm run test:mount-e2e --workspace @sentropic/geo-map-engine` : réussi
  après installation du Chromium requis dans le cache Playwright.
- Trois builds Docker locaux réussis : capture, acquisition et normes.
- Import des véritables modules de capture/extraction dans ces trois images,
  avec `--network none` : réussi, aucune capture et aucune écriture S3.
- 45 tests ciblés réussis après mise à jour des digests finaux (pin de capture,
  lanceurs Kubernetes, backlog PV et générateur S3-DAG).
- CI de la PR sur `12080309` : réussie, run
  [34758310847](https://github.com/rhanka/geo/actions/runs/34758310847).
  Les contrôles de la tête finale sont attachés à la PR #376.
- Revue statique Gemini 3.8 high : **GO**, archivée dans
  [scw-finalize-376-diff.md](../../reviews/scw-finalize-376-diff.md), avec
  réconciliation des observations et limites. La tentative antérieure sans
  verdict reste documentée séparément et ne compte pas comme approbation.
- Aucun changement de `.track` ; checkout partagé `feat/cadre-acquisition`
  préservé. Travail isolé dans `tmp/worktrees/scw-finalize`.

## Suivi du déploiement et solde infrastructure

Le merge de #376 déclenche automatiquement CD préprod par la modification du
Deployment de base. Le workflow construit geo-api, épingle son digest, applique
l'overlay et vérifie le rollout. La prod suit son déploiement explicite habituel.

Le compte d'infrastructure OVH doit retirer `geo-registry-pull` après retrait de
ses références dans les workloads des namespaces geo et geo-preprod. Le compte
de cette reprise n'a pas le droit de supprimer ce Secret. Les Jobs terminés
conservent leur historique ; le registre partagé avec matchid reste en service.
