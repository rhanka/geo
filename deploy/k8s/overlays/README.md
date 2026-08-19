# geo-api serving — Kustomize base + overlays (CD, ADR-0028)

Adoption du plan de déploiement plateforme (`ARCH-17`/`BR-55`, push-CI, fork O1). La **ligne
servie geo-api** est décrite **une fois** dans `../base` ; chaque environnement est un overlay.

```
deploy/k8s/base/            # Deployment + Service + Ingress geo-api (S3-only), sans namespace
deploy/k8s/overlays/
  preprod/                  # ns geo-preprod, nameSuffix -preprod, bucket preprod, host preprod, netpols A2
  prod/                     # ns geo, bucket prod, host prod
```

## Rendu / apply

```
kubectl kustomize deploy/k8s/overlays/preprod     # rendu client-side (validation)
kubectl apply -k deploy/k8s/overlays/preprod      # via le job CI deploy-preprod (C2), pas à la main
```

## Résolution du digest (jamais un tag mutable)

Le nom d'image `geo-api` est la cible du transformer. La CI `deploy-preprod` (C2) fait
`kustomize edit set image geo-api=rg.fr-par.scw.cloud/sentropic-geo/geo-api@<DIGEST>` (digest
**post-merge**, ADR-0027 §8 / ADR-0028) avant l'apply. `overlays/prod` reçoit le **digest promu**
(same-digest, `release-prod`, BR-55d).

## Ce qui N'EST PAS ici

- **SealedSecrets** (`geo-s3-credentials-preprod`, `geo-s3-credentials-prod-ro`) = C3 (poc-k8s scelle,
  ajoutés à l'overlay preprod).
- **Job de récup** `geo-preprod-sync` (§6.1) = `../preprod/geo-api-preprod-sync-job.yaml`, appliqué par
  **poc-k8s en fenêtre gatée** (coherence_id partagé), **pas** à chaque merge → hors overlay auto.
- **Tenant** (ns/quota/RBAC SA) = poc-k8s (ownership split).
- **Overlay prod** = source CD future ; la prod tourne encore depuis les manifests plats
  `deploy/k8s/geo-api-*.yaml` jusqu'à `release-prod` (C4/BR-55d) — transition documentée.
