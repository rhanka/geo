# geo — Kubernetes workload manifests

App-owned workload manifests for deploying **geo-api** (the OGC API – Features
server for `geo.sent-tech.ca`) onto the shared single-node cluster.

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
| —                                             | DNS `geo.sent-tech.ca` → shared LB                      |

Do not add Namespace/quota/RBAC objects here — they belong in poc-k8s.

## Files

| File                  | Kind                | Purpose                                            |
| --------------------- | ------------------- | -------------------------------------------------- |
| `deployment-api.yaml` | Deployment          | geo-api server, 1 replica, data PVC mounted RO     |
| `service-api.yaml`    | Service (ClusterIP) | Stable in-cluster address for geo-api              |
| `ingress.yaml`        | Ingress (Traefik)   | `geo.sent-tech.ca` + TLS via cert-manager          |
| `pvc-data.yaml`       | PVC (`geo-data`)    | Normalized GeoJSON, 1Gi RWO                         |
| `job-fetch.yaml`      | Job + CronJob       | Populate / refresh the served data (`geo fetch`)   |

All manifests target namespace **`geo`**, are plain YAML, and are
Kustomize-friendly (consistent labels, no hard-coded cross-references beyond
names). Add a `kustomization.yaml` listing these files if you adopt Kustomize.

## Image

```
rg.fr-par.scw.cloud/geo/geo-api:<tag>
```

Built and pushed by `.github/workflows/docker-publish.yml` (tag-/manual-driven).
The manifests use `:latest` as a placeholder — pin a real tag at deploy time
(e.g. `kubectl -n geo set image deployment/geo-api geo-api=rg.fr-par.scw.cloud/geo/geo-api:v0.1.0`,
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

# Or apply the whole directory at once (the Job tolerates an empty PVC and
# populates it; the Deployment becomes Ready once data is present):
kubectl -n geo apply -f .
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
  for `geo.sent-tech.ca` pointing at the shared LB.
