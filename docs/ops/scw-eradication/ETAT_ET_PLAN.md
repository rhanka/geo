# Éradication SCW du périmètre GEO

Directive propriétaire du 13 septembre 2026 : **« GEO uniquement, immo fait sa
part en coordination avec toi »**. GEO utilise GHCR et OVH et doit supprimer
ses anciennes ressources SCW après préservation des données et preuves utiles.
Immo pilote sa propre décommission ; TEM, MatchID et les autres projets sont
hors de ce mandat. Les ressources partagées restent protégées tant que leur
attribution et leurs consommateurs ne sont pas établis.

## Décommission complète — en cours

Les PR #371–377 ont livré la bascule des images et du runtime, **pas la purge
complète du fournisseur**. La certification plus bas porte sur cette bascule.
L'ancienne consigne de conservation des ressources historiques est remplacée
par leur archivage vérifié sur OVH puis leur retrait, sans reprise des jobs.

Inventaire de contrôle du 13 septembre, vers 14:10 UTC :

| Ressource GEO résiduelle | État constaté / condition de retrait |
|---|---|
| Registre `sentropic-geo` (`a20a636f-968a-4ff3-bdb1-9f063dc2a51a`, fr-par) | 6 images ; les 4 images API/capture/acquisition/normes sont migrées. Publier PMTiles depuis sa source ; archiver les anciennes images zonage privées avant retrait. |
| Serverless `pmtiles-builder`, `zonage-builder`, `zonage-ocr`, `zonage-vision` | 4 définitions fr-par ; aucun run listé en fr-par, aucune définition nl-ams/pl-waw. Export des métadonnées sans secrets et vérification des schedules avant suppression. |
| Bucket SCW `sentropic-geo` | Toujours présent ; comparer son contenu actuel à OVH et préserver tout résidu utile avant suppression, y compris versions et uploads incomplets. |
| Ancien namespace SCW `geo` | Infra a constaté API/PostGIS à 0, PVC 5 Gi Bound et ancien Ingress ; sauvegarde vérifiée du PVC avant retrait. Le cluster partagé MatchID reste hors périmètre. |
| Objets historiques OVH `geo` / `geo-preprod` | 58 / 12 références rapportées par infra ; archiver les preuves utiles sur OVH puis purger les objets obsolètes. |
| IAM, DNS, autres services provider | Inventaire d'attribution restant à certifier par infra ; aucune absence n'est déduite du seul arrêt des pods. |

Coordination H2A : `thr:geo-scw-full-20260913`, avec Astra `poc-k8s` et le
conducteur Immo. Le contrat Immo `sentropic-geo/raw/pv-index/cas/` sur OVH
reste inchangé. Les identifiants S3 présents dans les anciennes définitions ne
doivent jamais figurer dans les preuves publiques.

Le bootstrap GCP recommande maintenant une clé **OVH RO dédiée préprod**, au
format base64 attendu par `geo-jobs.yml`. Le secret `GEO_S3_ENV` reste absent :
cette correction ne provisionne aucun accès et n'active pas le workflow.
La garde CI couvre désormais aussi les scripts `docs/ops`,
`acquisition/scripts` et le Dockerfile racine. Le builder PMTiles exige une
région S3 explicite, sans défaut lié à l'ancien fournisseur.

## Réalisation au 13 septembre 2026

Livraison du nettoyage : [PR #376](https://github.com/rhanka/geo/pull/376),
fusionnée après #375 dans `e8a57130e9cf2655adf04d531fbc83eab22ef1c6`.
Les images finales contiennent les générateurs sans secret de registre historique ;
les références du dépôt épinglent leurs digests publics vérifiés.

La prod a ensuite été promue sous GO explicite du propriétaire via
[CD Prod 34759477904](https://github.com/rhanka/geo/actions/runs/34759477904),
réussi le 13 septembre à 13:19 UTC. Aucun tag de release n'est nécessaire :
`cd-prod.yml` promeut le digest validé en préprod, sans rebuild, derrière
l'approbation de l'Environment `geo-prod` (required reviewer `rhanka`, conservé).

| Périmètre | État et preuve |
|---|---|
| geo-api, CD prod/préprod, CPTAQ | GHCR, PR #371 à #374 fusionnées |
| geo-capture | PR #375 fusionnée (`99d4faf4`), revue Gemini demandée archivée dans `docs/reviews/scw-capture-375.md` |
| geo-acquisition et normes-job | Builds reproductibles ajoutés à `docker-publish.yml`, images publiques GHCR, références par digest |
| Secrets de registre dans les manifests et générateurs | Retirés ; option de registre privé du générateur S3-DAG conservée, sans défaut legacy |
| Réintroduction | `node scripts/check-registry-policy.mjs` exécuté en CI, couvre manifests, workflows, générateurs, pin JSON de capture et page HTML |
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

L'inventaire OVH du 13 septembre trouve deux pods actifs dans `geo` : `geo-api`
(GHCR) et `postgis` (Docker Hub). Aucun CronJob ni extraction active.

Quatre anciens Jobs du 28 juillet sont **suspendus, pas terminés**, et gardent
leur template SCW historique :

- `geo-capture-normes-20260728t144551z` : 3 réussites, 2 échecs, suspendu.
- `geo-capture-normes-20260728t144553z` : 1 réussite, 2 échecs, suspendu.
- `geo-density-l2-20260728t053153z` : suspendu, aucun pod actif.
- `geo-density-l3-20260728t053154z` : suspendu, aucun pod actif.

**Ne pas désuspendre ces anciens Jobs.** Ce sont des tentatives historiques.
Toute reprise doit relire l'état S3, puis créer de nouveaux Jobs depuis les
lanceurs actuels (`k8s-capture-run.ts`, `k8s-density-document-discovery-run.ts`)
avec leurs images GHCR épinglées. La bascule des images n'a relancé aucune
capture. Leur archivage et leur purge font maintenant partie de la décommission
décrite en tête de document.

Le secret GitHub `SCW_SECRET_KEY` a été supprimé le 13 septembre après vérification
de l'absence de consommateur dans les workflows de main et de la branche. Son
absence a été confirmée par relecture de la liste des secrets du dépôt.

Après promotion, le Deployment prod est Ready 1/1 avec `imagePullSecrets` absent.
L'Astra de `poc-k8s`, contacté via H2A, confirme indépendamment le même état en
prod et préprod, sans référence dans les pods ou comptes de service. Le compte
`system:serviceaccount:geo:ci-deployer` ne peut pas supprimer les Secrets ;
**l'Astra a supprimé `geo-registry-pull` dans les deux namespaces**, après son
inventaire et sauvegarde d'accès protégée. L'absence du secret dans `geo` a aussi
été relue par GEO. Aucun producteur de ce secret n'a été trouvé dans `poc-k8s`.

L'inventaire infra initial trouvait 58 références historiques dans `geo` et 12 dans
`geo-preprod`, dont les quatre Jobs suspendus décrits ci-dessus. Elles ne sont
pas des consommateurs actifs ; leur présence ne justifie aucune reprise
de ces templates retirés. Zéro référence active au secret est confirmé par
l'inventaire des Deployments, pods et comptes de service.

## Validation

- `npm run build` et `node scripts/run-workspaces.mjs check` réussis.
- `npm test` : 3 998 tests réussis ; 7 tests déjà marqués skipped.
- `npm run test:scripts` : 11 tests réussis, dont la garde anti-réintroduction
  et son exécution complète sur une configuration de capture régressée.
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

## Déploiement prod et certification indépendante

Le merge de #376 a déclenché automatiquement
[CD préprod 34758869105](https://github.com/rhanka/geo/actions/runs/34758869105),
réussi. La [CI main](https://github.com/rhanka/geo/actions/runs/34758869192) et
[Pages](https://github.com/rhanka/geo/actions/runs/34758869138) ont réussi aussi.
Le digest promu ensuite en prod est exactement celui validé en préprod :

`ghcr.io/rhanka/geo-api@sha256:ff25bdd58ed314f60936a7c3b0cc01b057ab7508e85681752d463c913f122f82`

Le workflow prod constate `deployment "geo-api" successfully rolled out` à
13:19:39 UTC ; la relecture du Deployment confirme ce digest, Ready 1/1 et
l'absence d'`imagePullSecrets`. `https://api.geo.sent-tech.ca/conformance`
répond HTTP 200 avec trois déclarations OGC. Le code n'expose pas de route HTTP
de SHA servi : la provenance se vérifie par le digest et la variable embarquée
`GEO_GIT_SHA` / le label OCI `org.opencontainers.image.revision`.

L'exécution est portée par GEO ; la certification indépendante et le nettoyage
du secret sont portés par l'Astra `codex:poc-k8s:373dd8474fcd`, fil H2A
`thr:geo-scw-prod-20260913`. Son constat du 13 septembre à 13:25 UTC confirme
pour prod et préprod le même digest, Ready 1/1, zéro redémarrage,
`GEO_GIT_SHA=e8a57130e9cf2655adf04d531fbc83eab22ef1c6`, HTTP 200 sur
`/conformance` et lecture anonyme GHCR HTTP 200. Les deux suppressions de secret
sont confirmées. Le registre partagé avec matchid reste en service.

Pour la coordination de capacité, les réservations actuelles dans `geo` sont
105m CPU / 288Mi mémoire (API + PostGIS), et 180m / 416Mi pendant le surge d'un
pod API. Ce sont des requests Kubernetes, pas un pic de consommation mesuré.
Les limites mémoire sont 768Mi par conteneur API/PostGIS ; aucun changement de
dimensionnement ou de placement n'est réalisé par cette promotion.
