# Éradication SCW du périmètre GEO

Directive propriétaire : le registre partagé reste disponible pour matchid ;
geo utilise GHCR et OVH. Aucun registre partagé ni objet S3 n'est supprimé.

## Réalisation au 13 septembre 2026

| Périmètre | État et preuve |
|---|---|
| geo-api, CD prod/préprod, CPTAQ | GHCR, PR #371 à #374 fusionnées |
| geo-capture | PR #375 fusionnée (`99d4faf4`), revue Gemini demandée archivée dans `docs/reviews/scw-capture-375.md` |
| geo-acquisition et normes-job | Builds reproductibles ajoutés à `docker-publish.yml`, images publiques GHCR, références par digest |
| Secrets de registre dans les manifests et générateurs | Retirés ; option de registre privé du générateur S3-DAG conservée, sans défaut legacy |
| Réintroduction | `node scripts/check-registry-policy.mjs` exécuté en CI, couvre manifests, workflows, générateurs et page HTML |
| Stockage | OVH depuis le 29 juillet ; `acquisition/config/s3-target.json` et le garde de cible restent autoritaires |

Le premier build reproductible des images d'extraction est le run
[34757742653](https://github.com/rhanka/geo/actions/runs/34757742653).
Les deux digests publiés ont été lus anonymement avec HTTP 200 avant repoint :

- `geo-acquisition@sha256:30e5aad72ed64d3d227b22437c3d7d664a1ad92abdb5d4eb214625364b6aa820`
- `normes-job@sha256:fd14d123f090205ee25e7538cf1340514c00aa259bb572b93602df5880f81200`

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

La suppression du secret GitHub `SCW_SECRET_KEY` et du secret Kubernetes
`geo-registry-pull` se vérifie séparément du retrait de leurs références. Le
compte `system:serviceaccount:geo:ci-deployer` peut modifier le Deployment geo,
mais ne peut pas supprimer les Secrets et ne lit pas le namespace geo-preprod.
La clôture opérationnelle doit préciser les suppressions effectivement réalisées.
