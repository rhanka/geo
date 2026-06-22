# geo-api — manifestes Kubernetes (namespace `geo`)

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
kubectl apply -f deploy/k8s/ -n geo
```

(ou ressource par ressource, ex. `kubectl apply -f deploy/k8s/geo-api-deployment.yaml -n geo`).

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
