# Éradication SCW du périmètre GEO — état + plan (par PRs)

> Directive owner : le **registre Scaleway reste up pour matchid**, mais **geo ne doit plus en dépendre**. Mirror du cutover immo (GHCR + OVH). Audité sur `origin/main` (`4cfdb2ac`), `file:line`. **Exécution gated : merge + cutover = précondition k8s + co-val k8s/i-infra + go owner. Aucun acte cluster déclenché par un merge.**

## État mesuré (origin/main)

| Axe | Dépend de SCW ? | Preuve | Déjà migré ? |
|---|---|---|---|
| Image **geo-api** — manifests plats | OUI | `deploy/k8s/geo-api-deployment.yaml:36`, `deployment-api.yaml:42`, `job-fetch.yaml:42,123` | Non |
| Image geo-api — **overlays kustomize** (vraie source CD) | OUI | `deploy/k8s/overlays/prod/kustomization.yaml` + `overlays/preprod/kustomization.yaml` (`newName`) | Non |
| Image geo-api — **cptaq-serve** (épinglé DIGEST) | OUI | `deploy/constraints/cptaq-serve-job.yaml:38` (`geo-api@sha256:…`) | Non — bloqué tant qu'un digest GHCR équivalent n'existe pas |
| **CI** docker-publish geo-api | OUI (SCW primaire) | `.github/workflows/docker-publish.yml` (login SCW + `SCW_SECRET_KEY` + push SCW + miroir GHCR non-fatal) | Non |
| Image **geo-capture** | Partiel | `deploy/capture-job/job-capture.yaml:38`, `cronjob-capture-refresh.yaml:85` (SCW) ; CI capture déjà GHCR-only | Partiel |
| **normes-job**, **geo-acquisition** | OUI | `acquisition/src/k8s-captured-normes-run.ts:23`, `k8s-shard-run.ts:75` + `deploy/{normes-job,acquisition-job}/` | Non |
| Pull-secret `geo-registry-pull` | OUI | manifests geo-api/capture + `base/deployment.yaml:30` + overlays + `constraints/cptaq-serve-job.yaml:24` | Non (conservé jusqu'au cutover) |
| **S3** (endpoint/bucket runtime) | NON | bucket `sentropic-geo` sur OVH (`s3.bhs.io.cloud.ovh.net`, migré 2026-07-29 ; garde code throw si ≠ OVH) | **OUI — OVH** |

## Découpage en PRs (owner : « ménage complet côté geo, mais par PRs distinctes »)

- **PR 1 (celle-ci) — geo-api registry SCW→GHCR.** CI docker-publish (GHCR-primaire via `GITHUB_TOKEN`, fatal ; retrait SCW login/secret/miroir ; probe anon-200 non-bloquante), overlays prod/preprod `newName`→GHCR, manifests plats geo-api, `overlays/README`. `geo-registry-pull` **conservé**. Le merge ne redéploie pas la prod.
- **PR 2 — geo-capture** : 2 manifests SCW → GHCR (image déjà sur GHCR).
- **PR 3 — normes-job** ; **PR 4 — geo-acquisition** : idem, images à publier GHCR + manifests.
- **cptaq-serve** : re-pointer le digest SCW → digest GHCR de la MÊME image, **seulement une fois geo-api publié sur GHCR** (digest vérifiable). TODO tracé, pas de digest inventé.
- **Nettoyage docs/région** (`fr-par`, refs SCW dans READMEs, `docs/index.html` pmtiles SCW→OVH) : PR cosmétique.

## Gates / dépendances (avant merge/cutover PR 1)

1. **Visibilité GHCR** : un package user neuf est **privé par défaut** ; pas d'API de visibilité (UI-only), pas d'héritage (org-only). La probe anon-200 au 1er build **loggue le verdict** → décision owner (a) rendre public une fois / (b) PAT read:packages → pull-secret GHCR / (c) org GitHub public-par-défaut. Le pull des workloads (anon vs pull-secret GHCR) découle de ce choix.
2. **Précondition k8s** : `docker-publish.yml` documente que geo-api→GHCR doit être une PR distincte **après bascule kubeconfig geo-api verte**. À confirmer par k8s en co-val.
3. **CI deploy-preprod (C2)** : elle résout `kustomize edit set image geo-api=<registry>@<digest>` — vérifier que `<registry>` pointe bien GHCR au cutover preprod (sinon l'override CI masquerait le `newName` de l'overlay). À tracer.
4. **1er build** : ne se déclenche PAS à l'ouverture de la PR (workflow = `v*` tags / dispatch) → verdict probe au 1er build réel (acte gaté, sur go owner).
5. **Rollback** : re-pin SCW (le registre SCW reste up).
