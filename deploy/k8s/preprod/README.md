# geo-preprod — tier de serving preprod (DRAFT, OWNER-GATED)

Manifests du **serving geo-preprod** (SPEC `docs/spec/SPEC_GEO_PREPROD_SERVING` /
ADR-0027, ratifié owner « GO build gaté »). **socle construit ; poc-k8s applique ;
le déploiement PROD reste propriété owner (KUBE_CONFIG_DATA).**

## Ce que socle fournit ici (ce dossier)

- `geo-api-preprod-deployment.yaml` — serving **S3-only** (miroir exact du deploy prod ;
  seuls changent ns, nom/labels, `GEO_DATA_URI` source preprod, secret creds preprod).
- `geo-api-preprod-service.yaml` — ClusterIP **port 80 → targetPort http** (miroir prod ;
  le conteneur reste sur `PORT=8787`).
- `geo-api-preprod-ingress.yaml` — host `api.preprod.geo.sent-tech.ca`, traefik,
  issuer letsencrypt-prod, tls `geo-api-preprod-tls`.
- `geo-api-preprod-netpol.yaml` — netpols serving : default-deny + traefik→8787 +
  egress DNS/S3-BHS ; **ingress additif immo-preprod→8787** (ressource ns geo-preprod).
- `geo-api-preprod-sync-job.yaml` — **Job de sync** (miroir plein) + son netpol egress
  (DNS + S3-BHS + prod-API pour served_count/set_hash). Valeurs réseau/secrets = poc-k8s.

## Ce que poc-k8s possède (hors ce dossier)

Namespace `geo-preprod` + **ResourceQuota** ; bucket OVH-BHS **`sentropic-geo-preprod`** ;
Secrets **`geo-s3-credentials-preprod`** (write preprod) + **`geo-s3-credentials-prod-ro`**
(read prod, source du sync) + pull **`geo-registry-pull`** ; **DNS-A** de
`api.preprod.geo.sent-tech.ca` ; **résolution du digest image post-merge** à l'apply ;
**ordonnancement** du Job de sync (in-cluster, fenêtre gatée i-cond S00) + injection du
`COHERENCE_ID` partagé cross-repo (§6.1). L'egress **immo-side** (radar-immobilier-preprod →
geo-preprod) n'exige AUCUNE action : ce ns a un egress ouvert (vérifié poc-k8s).

## Valeurs (confirmées poc-k8s)

| clé | valeur |
|---|---|
| image (serving + Job) | `REPLACE_WITH_POST_MERGE_GEO_DIGEST` — build geo-api **POST-MERGE** (embarque CE PR : expo cohérence + runner sync). f8b152b1 (07-08) est ANTÉRIEUR → non. Minté par docker-publish depuis main (release socle), résolu à l'apply. **UNE image, deux rôles.** |
| promotion prod | **même digest post-merge** (PREPROD_ACCEPTANCE → prod ; expo conditionnelle/rétrocompat) |
| `GEO_DATA_URI` (dest) | `s3://sentropic-geo-preprod/normalized` (région bhs) |
| source sync (prod) | `s3://sentropic-geo/normalized` (OVH-BHS, cred read-only `geo-s3-credentials-prod-ro`) |
| secret creds (dest) | `geo-s3-credentials-preprod` |
| pull secret | `geo-registry-pull` |
| S3-BHS ipBlock | `54.39.60.208/32` · prod-API (Job only) `51.79.100.177/32` |

## Parité + fraîcheur (le « dernier km »)

- **Parité = miroir plein `normalized/`** prod→preprod (data-driven, PAS une whitelist :
  geo-prod sert 3885 collections dont 1088 slug-nu de ville → une whitelist sous-servirait).
  Runner : `scripts/geo-preprod-sync.mjs` (wrapper mince) sur la lib pure testée
  `@sentropic/geo/preprod` (copie cross-bucket idempotente, stampe `coherence.json =
  { coherence_id, served_count, set_hash, generated_at, prod_watermark }`).
- **Refresh** : `scripts/geo-preprod-refresh.mjs` = `kubectl rollout restart deployment/
  geo-api-preprod -n geo-preprod` → gate `scripts/geo-verify-served-collections.mjs`
  (`--completeness` + `--expect-coherence`). geo-api cache son index au démarrage : une
  couche fraîche n'est SERVIE qu'après le rollout, et la gate le PROUVE (THROUGH l'API).
- geo-api expose `coherence_id` (landing + chaque collection), `served_count` et
  `set_hash` (landing) depuis `coherence.json` (impl `packages/geo`, conditionnel/
  fail-closed). La gate vérifie **count-match ET set-match** (vrai set d'ids, pas juste
  le compte) → un slug-nu manquant/substitué échoue.
