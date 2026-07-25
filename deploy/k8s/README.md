# geo — Kubernetes workload manifests (namespace `geo`)

App-owned workload manifests for deploying **geo-api** (the OGC API – Features
server for `api.geo.sent-tech.ca`) onto the shared single-node cluster.

> **Deux générations de manifestes coexistent dans ce répertoire.** La ligne
> `deployment-api.yaml` / `service-api.yaml` / `ingress.yaml` / `pvc-data.yaml` /
> `job-fetch.yaml` vient de la ligne « librairie » (PVC + Job de peuplement). La
> ligne `geo-api-*.yaml` (`geo-api-deployment.yaml`, `geo-api-service.yaml`,
> `geo-api-ingress.yaml`, `geo-postgis-service.yaml`) est celle **actuellement
> déployée** par la chaîne d'acquisition (backend S3 + PostGIS, pas de PVC).
> Les deux sections ci-dessous sont conservées telles quelles ; n'appliquer
> qu'**une** des deux lignes, jamais `kubectl apply -f deploy/k8s/` en bloc.

> **Domain split:** the apex `geo.sent-tech.ca` is the **static site**, served
> by **GitHub Pages** (`.github/workflows/pages.yml`, see `docs/deploy.md`). The
> **API** lives on the `api.` subdomain, `api.geo.sent-tech.ca`, exposed by the
> Ingress below. The site is built with `PUBLIC_GEO_API_URL=https://api.geo.sent-tech.ca`.

## Ownership split (app vs. poc-k8s)

This directory contains **only the app's workloads**. The tenant contract is
owned by **poc-k8s**, not here:

| Owned by **this repo** (`deploy/k8s/`)        | Owned by **poc-k8s** (tenant `geo`)                    |
| --------------------------------------------- | ------------------------------------------------------ |
| Deployment, Service, Ingress                  | Namespace `geo` + ResourceQuota / LimitRange           |
| PVC (`geo-data`)                              | StorageClass / default class for the namespace         |
| Job / CronJob (`geo-fetch`)                   | RBAC for the tenant                                     |
| —                                             | Image-pull secret for `rg.fr-par.scw.cloud/geo/*`      |
| —                                             | Traefik v3 controller + cert-manager `letsencrypt-prod`|
| —                                             | DNS `api.geo.sent-tech.ca` → shared LB                  |

Do not add Namespace/quota/RBAC objects here — they belong in poc-k8s.

---

# Ligne A — manifestes `geo-api-*` (déploiement courant, backend S3 + PostGIS)

Manifestes versionnés de l'infra `geo-api`, pour remplacer le déploiement à la
main. Tout est ré-appliquable de façon idempotente avec `kubectl apply`.

## Contenu

| Fichier | Ressource |
| --- | --- |
| `geo-api-deployment.yaml` | `Deployment/geo-api` (image, env, probes, resources) |
| `geo-api-service.yaml` | `Service/geo-api` (ClusterIP, port 80 → `http`) |
| `geo-postgis-service.yaml` | `Service/geo-postgis` (ClusterIP, port 5432 → `postgresql`) |
| `geo-api-ingress.yaml` | `Ingress/geo-api` (Traefik + cert-manager) |

> Note : ces manifestes décrivent les ressources `geo-api`. Le **Pod/Statefulset
> PostGIS** lui-même n'est pas versionné ici — seul le `Service` qui pointe vers
> lui (sélecteur `app.kubernetes.io/name: postgis`) l'est.

## Appliquer

```bash
kubectl apply -f deploy/k8s/geo-api-deployment.yaml \
              -f deploy/k8s/geo-api-service.yaml \
              -f deploy/k8s/geo-postgis-service.yaml \
              -f deploy/k8s/geo-api-ingress.yaml -n geo
```

## Prérequis — secrets hors-repo (NON versionnés)

Le `Deployment` dépend de **deux** Secrets qui doivent exister dans le namespace
`geo` AVANT le `kubectl apply`. Ces secrets ne sont jamais commités.

### 1. `geo-s3-credentials` (credentials S3)

Injecté en entier dans le conteneur via `envFrom.secretRef` (chaque clé devient
une variable d'environnement). Type `Opaque`. **Clés attendues (noms uniquement,
aucune valeur ici) :**

- `S3_ACCESS_KEY`
- `S3_SECRET_KEY`
- `S3_BUCKET`
- `S3_ENDPOINT`
- `S3_REGION`

Vérifier les noms de clés présents (sans révéler les valeurs) :

```bash
kubectl get secret geo-s3-credentials -n geo -o jsonpath='{.data}' | jq 'keys'
```

Créer / mettre à jour le secret (remplir les valeurs hors-repo) :

```bash
kubectl create secret generic geo-s3-credentials -n geo \
  --from-literal=S3_ACCESS_KEY=<valeur-hors-repo> \
  --from-literal=S3_SECRET_KEY=<valeur-hors-repo> \
  --from-literal=S3_BUCKET=<valeur-hors-repo> \
  --from-literal=S3_ENDPOINT=<valeur-hors-repo> \
  --from-literal=S3_REGION=<valeur-hors-repo>
```

### 2. `geo-registry-pull` (imagePullSecret du registre Scaleway)

Permet de tirer l'image depuis le registre privé Scaleway. Type
`kubernetes.io/dockerconfigjson` :

```bash
kubectl create secret docker-registry geo-registry-pull -n geo \
  --docker-server=rg.fr-par.scw.cloud \
  --docker-username=<valeur-hors-repo> \
  --docker-password=<valeur-hors-repo>
```

### TLS (`geo-api-tls`)

Le `Secret/geo-api-tls` référencé par l'Ingress est **généré automatiquement par
cert-manager** (annotation `cert-manager.io/cluster-issuer: letsencrypt-prod`).
Rien à créer à la main : cert-manager doit simplement être installé dans le
cluster.

## Image

L'image vit dans le registre Scaleway :

```
rg.fr-par.scw.cloud/sentropic-geo/geo-api:<tag>
```

Tag actuellement déployé : `0.1.4`. **Le build et le push de l'image ne sont pas
gérés ici** ; bumper le `image:` du Deployment puis ré-appliquer pour livrer une
nouvelle version.

## Ingress

- Host : `api.geo.sent-tech.ca`
- Entrypoint Traefik : `websecure` (TLS), certificat Let's Encrypt via cert-manager.

---

# Ligne B — manifestes `*-api.yaml` (ligne librairie, PVC + Job de peuplement)

## Files

| File                  | Kind                | Purpose                                            |
| --------------------- | ------------------- | -------------------------------------------------- |
| `deployment-api.yaml` | Deployment          | geo-api server, 1 replica, data PVC mounted RO     |
| `service-api.yaml`    | Service (ClusterIP) | Stable in-cluster address for geo-api              |
| `ingress.yaml`        | Ingress (Traefik)   | `api.geo.sent-tech.ca` + TLS via cert-manager      |
| `pvc-data.yaml`       | PVC (`geo-data`)    | Normalized GeoJSON, 1Gi RWO                         |
| `job-fetch.yaml`      | Job + CronJob       | Populate / refresh the served data (`geo fetch`)   |

All manifests target namespace **`geo`**, are plain YAML, and are
Kustomize-friendly (consistent labels, no hard-coded cross-references beyond
names). Add a `kustomization.yaml` listing these files if you adopt Kustomize.

## Image

```
rg.fr-par.scw.cloud/sentropic-geo/geo-api:<tag>
```

Built and pushed by `.github/workflows/docker-publish.yml` (tag-/manual-driven).
The manifests use `:latest` as a placeholder — pin a real tag at deploy time
(e.g. `kubectl -n geo set image deployment/geo-api geo-api=rg.fr-par.scw.cloud/sentropic-geo/geo-api:v0.1.0`,
or `kustomize edit set image`). The same image runs both the API server and the
`geo-fetch` data-population Job (it bundles `gdal-bin`).

## Deploy

```sh
# 1. Storage first.
kubectl -n geo apply -f pvc-data.yaml

# 2. Populate the data (runs `geo fetch …` + `geo licenses build`).
kubectl -n geo apply -f job-fetch.yaml
kubectl -n geo wait --for=condition=complete job/geo-fetch --timeout=20m

# 3. App + routing.
kubectl -n geo apply -f deployment-api.yaml -f service-api.yaml -f ingress.yaml
```

Re-running the fetch (the Job has `ttlSecondsAfterFinished`, but delete it first
if it still exists):

```sh
kubectl -n geo delete job geo-fetch --ignore-not-found
kubectl -n geo apply -f job-fetch.yaml
```

The bundled **CronJob** (also named `geo-fetch`) is `suspend: true` by default.
Flip it to `false` to enable scheduled monthly refreshes once the one-shot Job
has succeeded.

## Environment & secrets

The geo-api container is configured purely by env (no app secrets required):

| Var            | Default            | Meaning                                  |
| -------------- | ------------------ | ---------------------------------------- |
| `PORT`         | `8787`             | Listen port (also the Service target)    |
| `GEO_DATA_DIR` | `/data/normalized` | Normalized-data dir read by the server   |
| `NODE_ENV`     | `production`       | Standard Node runtime mode               |

The only secret involved is the **image-pull secret** for the Scaleway registry,
which the **poc-k8s** tenant contract must provide in the `geo` namespace
(referenced via the namespace's default ServiceAccount `imagePullSecrets`, or add
`imagePullSecrets` to the pod specs once its name is known).

## Probes

Readiness/liveness use `GET /conformance`, which returns a static `200` (the OGC
conformance class list) independent of whether data is loaded — a safe health
signal during startup and data refreshes.

## Resource footprint (DEV1-M node: 4GB / 3vCPU)

- geo-api: requests `75m` / `256Mi`, limits `300m` / `384Mi`.
- geo-fetch Job/CronJob: requests `100m` / `384Mi`, limits `1000m` / `1Gi`
  (gdal/ogr2ogr spikes on the municipal layer). The Job is short-lived.

## What poc-k8s must provide for the `geo` tenant

- Namespace `geo` with a ResourceQuota that covers the above
  (≈ `175m`/`640Mi` steady-state requests with the Job idle; allow the Job's
  `1000m`/`1Gi` burst).
- A default StorageClass (or one pinned for `geo`) satisfying a `1Gi` RWO PVC.
- An **image-pull secret** for `rg.fr-par.scw.cloud/geo/*` wired into the
  namespace (default ServiceAccount or referenced by name in the pods).
- Traefik v3 ingress + cert-manager `letsencrypt-prod` ClusterIssuer, and DNS
  for `api.geo.sent-tech.ca` pointing at the shared LB. (The apex
  `geo.sent-tech.ca` is the GitHub Pages site, not this cluster.)
