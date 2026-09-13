# Décommission SCW de GEO — 13 septembre 2026

Périmètre autorisé : **GEO uniquement**. Immo conduit son propre retrait ; TEM,
MatchID, les autres projets et le cluster partagé restent hors périmètre.

État à 14:54 UTC : registre, Serverless, namespace et volume historiques retirés.
Le bucket est encore en archivage ; sa suppression et la révocation IAM attendent
la comparaison intégrale des octets. Ce document ne certifie donc pas encore
l'absence totale de ressources GEO sur SCW.

## Livraison et production

La [PR #378](https://github.com/rhanka/geo/pull/378) est fusionnée dans
`35ebd09ba773ecf97bb8ec5fb1ea6de36037f296`. La CI de PR
[34763259423](https://github.com/rhanka/geo/actions/runs/34763259423) et la CI main
[34763609675](https://github.com/rhanka/geo/actions/runs/34763609675) sont réussies.
Elle capitalise les outils d'archivage et de contrôle, le bootstrap OVH protégé
par la cible cluster et le builder PMTiles public GHCR.

La [préproduction 34763683114](https://github.com/rhanka/geo/actions/runs/34763683114)
sert cette révision avec le digest
`sha256:c35801fe048f6a986aaaa6ae20c6b1fbc4fa214af0bb5694bc74ddf8bce974b0`.
Contrôles : un replica disponible, `GEO_GIT_SHA` exact et `/conformance` HTTP 200
avec les trois classes OGC attendues. La promotion finale en production reste à
faire via `cd-prod.yml`, avec le même digest et le gate `geo-prod` conservé.

## Ressources retirées

| Ressource | Retrait et vérification |
|---|---|
| Registre `sentropic-geo`, fr-par, `a20a636f-968a-4ff3-bdb1-9f063dc2a51a` | Supprimé après archivage des 6 images / 69 tags ; lecture directe : `Namespace was not found` à 14:53 UTC. |
| Serverless Jobs | Les 4 définitions `pmtiles-builder`, `zonage-builder`, `zonage-ocr`, `zonage-vision` sans run ni schedule ont été exportées puis supprimées ; liste fr-par vide. |
| Namespace SCW `geo` | Supprimé à 14:33 UTC, avec ses 95 Jobs historiques et le Job de sauvegarde achevé. Aucun Ingress GEO restant sur le cluster partagé. |
| PVC `pg-data-postgis-0` et PV `pvc-25209914-5b67-4557-b1f5-276cdeb0bad6` | Sauvegarde en lecture seule vérifiée avant suppression ; namespace et PV absents. |
| Volume bloc `fr-par-2/d921be09-385e-4168-9f03-95d269c18633` | Reclaim Delete exécuté ; lecture fournisseur : absent. |
| Historique OVH | 58 objets dans `geo`, 12 dans `geo-preprod`, tous inactifs, archivés puis retirés avec préconditions UID/resourceVersion. Aucun workload historique référençant SCW ou `geo-registry-pull` ne subsiste dans les inventaires contrôlés. |
| GitHub | `SCW_SECRET_KEY` et les 5 anciens secrets S3 de dépôt supprimés. `geo-preprod/KUBE_CONFIG_GEO` renouvelé vers le SA OVH dédié ; self-verify RBAC réussi. Aucun `GEO_S3_ENV` provisionné. |

Le contrôle des ClusterRoles, ClusterRoleBindings et PV ne trouve aucun objet
GEO ni sujet RBAC du namespace supprimé. Le load balancer Traefik, le nœud,
leurs IP et le cluster MatchID restent partagés et préservés.

## Archives conservées sur OVH

Toutes les clés ci-dessous sont relatives à
`s3://sentropic-geo/ops/decommission/20260913/`, endpoint
`https://s3.bhs.io.cloud.ovh.net`, région `bhs`. Elles ne remplacent aucun chemin
de données servies. Les identifiants secrets ne figurent pas dans ce dossier.

| Clé | Preuve |
|---|---|
| `registry-oci/` | 69 références exportées par Skopeo `--all --preserve-digests`, 736 fichiers relus depuis OVH, zéro différence (`registry-oci-proof.log`). Les 732 blobs ont aussi été recalculés : zéro SHA-256 différent de leur nom (`registry-oci-integrity.json`). |
| `registry-oci/layout/index.json` | SHA-256 `0dcd59c49e652a7495ac4ff8d87b559910149c3e1b64d37716af6c9cb199583f`. |
| `registry-oci/source-inventory.json` | SHA-256 `ad4ca205521b4eab37f4e5940fd96e9b3f6f28277675fcf792b3cb2b238cfa39`. |
| `provider/postgis-volume.tar` | 196 136 960 octets ; SHA-256 `115dd8a22ec4aa7e6980ac94af540998aae01029e5b5971be8ffea231cfbea10`, relu sur OVH et validé par `tar -tf`. |
| `provider/postgis-volume-proof.log` | Log du Job de sauvegarde et de ses deux contrôles. |
| `provider/namespace-before.json`, `provider/volume-before.json` | Métadonnées Kubernetes avant retrait, sans export de Secret. |
| `provider/serverless-definitions-redacted.json` | Paramètres des définitions, valeurs de credentials expurgées ; SHA-256 `d02f464070c8ce4a0bb9f21f06e2defdee2a2a874c463f0c73d6745b12ff6b24`. |
| `provider/object-history-before.json` | Inventaire paginé à 14:30 UTC : 45 378 versions courantes, zéro ancienne version ou marqueur de suppression, un multipart inachevé de juillet. |
| `ovh-history/geo.json` | SHA-256 `dc025d34f917cc3ebc6c149e972e6f288b6a6d2dce4b40f4282f794e29d150f2`. |
| `ovh-history/geo-preprod.json` | SHA-256 `f7ead9e202d2cc67a77d8faa9f9f7da6f5a2122bbfc39d7462e25b78821c11ca`. |
| `ovh-history/deletion.log` | Résultats de suppression des 70 objets ciblés. |
| `scw-sentropic-geo/` | Copie complète du bucket en cours, suivie de `rclone check --download` ; source attendue : 45 378 objets / 48 939 893 150 octets. |

Le Job d'archive a été repris en `v4` avec 32 contrôleurs de métadonnées et
16 lecteurs pour la comparaison des octets, avec les mêmes limites de
500 mCPU / 512 Mio et buffers de 4 Mio.
Les logs des tentatives interrompues sont conservés dans `bucket-archive-v1.log`
et `bucket-archive-v2.log` / `bucket-archive-v3.log` ; ils ne constituent pas une preuve de sauvegarde
complète. Le Job final reprend les objets existants avec `--immutable` avant
la vérification intégrale. Aucun compteur intermédiaire n'autorise la purge.

## Revue et coordination

Les revues demandées Gemini sont conservées dans `docs/reviews/`. La revue
complémentaire `scw-retirement-final-ops.md` conserve son verdict brut NO-GO et
la réfutation empirique de ses deux affirmations erronées sur kubectl et Node.
Les vérifications effectives et les 15 tests scripts réussis sont distingués
de ce verdict ; aucune attestation indépendante du cloud n'est attribuée au
relecteur statique.

H2A : `thr:geo-scw-full-20260913`, Astra `codex:poc-k8s:373dd8474fcd` et Immo
`codex:radar-immobilier:98cef8dfc274`. Immo a confirmé la répartition. Les mises
à jour finales sont livrées à Astra, mais aucun nouvel ACK n'est reçu depuis sa
certification antérieure de la bascule du runtime. L'exécution de cette
décommission et les constats ci-dessus sont ceux du conducteur GEO.
