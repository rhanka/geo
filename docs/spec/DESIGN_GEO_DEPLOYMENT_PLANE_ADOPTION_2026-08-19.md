# DESIGN — Adoption geo du plan de déploiement plateforme (CD) *(commission WP6)*

> **Statut : DESIGN pour cadrage owner — commissionné geo-cond (direction owner : gel du deploy manuel
> geo-preprod, adoption du CD plateforme).** Date : 2026-08-19. Auteur : geo-archi (`claude:archi`, WP6).
> **NON greenfield** : adoption d'un **standard RATIFIÉ** (`ARCH-17`/`BR-55`, DV2 « un tier non-prod
> main-aligned auto-CD »). Le substrat geo (ADR-0027 : manifests preprod committés + invariant same-digest +
> `PREPROD_ACCEPTANCE`) est **prêt** → adoption, **zéro rework**.
>
> **⚠ Fork de CANAL de livraison EN COURS (dossier owner s-archi, résidence Loi-25)** : **B apply-CI-push** vs
> **B-mitigé runner-in-region** vs **GitOps-pull-upgrade**. s-archi confirme : le switch push→pull ne change **QUE
> le canal** (**same-digest + base/overlays préservés → coût bas**). → **ce design est CHANNEL-AGNOSTIQUE** : les 4
> chantiers sont **partagés quel que soit le fork** ; seule la **mécanique d'apply** (C2) est isolée comme le delta
> fork-dépendant. Je ne fige pas ce delta tant que l'owner n'a pas tranché.
>
> **⚠ Anti-invention / frontière de cette étude** : les specs autoritaires du standard
> (`SPEC_DECISION_DEPLOYMENT_PLANE.md`, `deploy/k8s/README.md` sentropic, le job `deploy-preprod` de
> sentropic `ci.yml`, `SPEC_EVOL_DEPLOYMENT_PLANE.md`) sont **côté s-archi, PAS dans le repo geo** → je
> designe la **FORME d'adoption** sur le résumé autoritaire de geo-cond ; les **conventions exactes**
> (layout Kustomize, étapes du job CI, noms de cibles make, nommage `deploy/scw/NN-sealed-*.yaml`,
> contrat `release-prod`/BR-55d) sont à **confirmer contre ces specs** avant implémentation. Je suis le
> standard, je ne le ré-invente pas.

---

## 1. État actuel geo (grounded, `origin/main @f25b8c39`)

- **Manifests PLATS** `deploy/k8s/` : ligne servie = `geo-api-*.yaml` (Deployment/Service/Ingress + PostGIS, backend S3) ; **+ `deploy/k8s/preprod/`** (livrable #228 : deployment placeholder-digest + service + ingress + netpols A2 + Job de sync). Une 2e génération « librairie » (`deployment-api.yaml`…) **coexiste, non déployée** (README avertit : jamais `apply -f deploy/k8s/` en bloc).
- **Pas de Kustomize, pas de job CI de deploy, pas de cible Makefile k8s** — le déploiement est **manuel/owner** (`KUBE_CONFIG_DATA`).
- **Ownership split (README)** : ce repo = **workloads app** (Deployment/Service/Ingress/Job/PVC) ; **poc-k8s** = **tenant** (Namespace/ResourceQuota/RBAC/pull-secret). ⇒ le CD applique les workloads geo dans le ns provisionné par poc-k8s.
- **Substrat ADR-0027 prêt** : preprod committé, placeholder `REPLACE_WITH_POST_MERGE_GEO_DIGEST`, same-digest + `PREPROD_ACCEPTANCE`, gate coherence/complétude (`geo-verify-served-collections.mjs`), secrets **live-mintés** (attestation poc-k8s).

## 2. Cible (standard ARCH-17/BR-55, résumé geo-cond) & mapping

**main → deploy AUTO preprod** ; **tag → promotion prod** ; Kustomize base+overlays ; digest résolu par la CI ;
SealedSecrets committés ; same-digest prod off-main. La CD **automatise l'ADR-0027 §8** (build-avant-apply inhérent
au pipeline ; placeholder résolu ; promotion même-digest) → **zéro rework**.

**Découpage AGNOSTIQUE vs DELTA-de-canal** (robuste au fork owner) :
- **PARTAGÉ (valide B push OU GitOps pull)** : C1 base+overlays · C3 SealedSecrets · C4 same-digest · **la résolution
  du digest dans l'overlay** (que la CI l'`apply` ensuite, OU la commit et qu'un contrôleur réconcilie).
- **DELTA de canal (fork-dépendant, C2)** : la **mécanique d'apply** seule — job CI `kubectl apply -k` (push) **vs**
  CI `commit` du digest en git + **contrôleur** qui réconcilie (pull). s-archi : switch = **coût bas**.

## 3. Les 4 chantiers d'adoption

### C1 — Migration Kustomize (`deploy/k8s/` plats → `base` + `overlays/{preprod,prod}`)
- **`base/`** : workloads communs **geo-api serving** (S3-only) — Deployment (image via placeholder que l'overlay/CI patche), Service, Ingress (host via overlay), + les **NetworkPolicies A2** paramétrées. **Consolide** sur la ligne servie `geo-api-*.yaml` ; la génération « librairie » stale **hors CD** (retirée ou archivée).
- **`overlays/preprod/`** : ns `geo-preprod`, `GEO_DATA_URI=s3://sentropic-geo-preprod/normalized`, host `api.preprod.geo.sent-tech.ca`, secrets `geo-s3-credentials-preprod`(dest)/`geo-s3-credentials-prod-ro`(source), **Job de sync** (preprod-only), netpol egress default-deny (A2). Patch image = digest post-merge (CI).
- **`overlays/prod/`** : ns `geo`, `GEO_DATA_URI=s3://sentropic-geo/normalized`, host `api.geo.sent-tech.ca`, secrets prod, **PAS de Job de sync** (prod = la source, pas synchronisée), image = **digest PROMU** (même-digest preprod-validé). PostGIS prod conservé si le tenant prod en dépend (hors chemin serving S3-only — à trancher : le garder en base/overlay-prod ou hors CD).
- **Tenant (ns/quota/RBAC) reste poc-k8s** (ownership split) — les overlays référencent le ns, ne le créent pas.

### C2 — Résolution du digest + apply (le DELTA de canal fork-dépendant est ISOLÉ ici)

**Partie AGNOSTIQUE (valide quel que soit le fork)** — à chaque merge sur main, après le build (digest content-hash
immuable) : le digest post-merge est **résolu dans l'overlay preprod** (`kustomize edit set image
geo-api=<registry>@<digest>` → **résout `REPLACE_WITH_POST_MERGE_GEO_DIGEST`**) ; la cible preprod est amenée à
l'état voulu dans le ns `geo-preprod` ; **self-gate** `geo-verify-served-collections.mjs --completeness
--expect-coherence <id>` post-rollout (fraîcheur+complétude THROUGH l'API) = contribution geo à `PREPROD_ACCEPTANCE`.

**Partie DELTA de canal (à figer sur le verdict du fork owner — je ne la grave PAS maintenant)** :
- **B (apply-CI push)** : job CI `deploy-preprod` (`ci.yml`, sur `main`) → **kubeconfig preprod = SA least-privilege
  scopé au ns `geo-preprod` (PAS cluster-admin)**, fourni par poc-k8s, en **GH secret** → **assert image-en-registry**
  (fail-loud, anti-`ImagePullBackOff`) → `kustomize edit` → **`make k8s-deploy-preprod`** (`kubectl apply -k
  deploy/k8s/overlays/preprod`) → self-gate. *(B-mitigé : runner-in-region pour la résidence Loi-25.)*
- **GitOps (pull)** : job CI **commit** le digest résolu dans l'overlay (git) → un **contrôleur** (Argo/Flux)
  réconcilie le ns depuis le repo → self-gate en hook post-sync.
→ Les DEUX : remplacent l'apply manuel + résolvent le placeholder, sur base+overlays partagés. **Nouveau côté geo**
(commun) : la cible `make k8s-deploy-preprod` (utilisée directement en B, ou par la CI de commit en GitOps) + le
kubeconfig **OU** l'accès contrôleur (selon fork). **Le choix push↔pull ne re-fait aucun autre chantier.**

### C3 — SealedSecrets (`deploy/scw/NN-sealed-*.yaml`) — **adoptable MAINTENANT**
**Cluster (poc-k8s) : controller sealed-secrets INSTALLÉ (bitnami, déjà utilisé par sentropic)** → **adopter SealedSecrets maintenant**. **ESO NON installé** → **ESO + OVH-SM = HORS scope** (futur, **même bundle upgrade que GitOps**).
Migrer le minting poc-k8s → **SealedSecrets committés** : mint (OVH `add-user` scopé — dest **RW** `sentropic-geo-preprod`, source **RO** `sentropic-geo`) → `kubeseal` → **YAML scellé committé** → le controller déchiffre à l'apply. Secrets : `geo-s3-credentials-preprod`, `geo-s3-credentials-prod-ro`, `geo-api-preprod-tls`(si non cert-manager), `geo-registry-pull`.

**⚠ Évolution du modèle secrets (§7 A2) — shift assumé, pas une régression** : de « **éphémère minté-en-fenêtre** »
(modèle manual-apply ADR-0027) → « **minté 1× → scellé (`kubeseal`) → committé → long-vécu + rotation périodique** ».
**Le scoping A2 est PRÉSERVÉ** (poc-k8s mint RW-dest / RO-source **puis** scelle → l'attestation cred-scoping tient,
tracée par la **provenance de scellement**) et ça **ferme le gap fondateur « creds live-only »** côté secrets
(le sealed-secret chiffré EST dans le repo, reproductible ; le plaintext ne l'est jamais). Procédure de scellement +
cadence de rotation = **documentées** (poc-k8s pour la mécanique `kubeseal`/cert).

### C4 — Promotion prod same-digest + `PREPROD_ACCEPTANCE`
- **Prod off-main via `release-prod`** (tag-driven), per **BR-55d** — mécanisme **plateforme-pending** (à finir côté s-archi) → **la promotion prod geo est SÉQUENCÉE après BR-55d**.
- Sur tag : `release-prod` prend le **digest preprod-validé** (same-digest, ADR-0027 §8) → `kustomize edit set image` dans `overlays/prod` → apply prod. **Jamais de rebuild.**
- **`PREPROD_ACCEPTANCE`** = (a) **self-gate** du job deploy-preprod (gate coherence/complétude geo) + (b) **UAT owner** + (c) **gate d'orthogonalité cross-repo** (immo-preprod↔geo-preprod au **même `coherence_id`**, §6) — **AVANT** le tag prod.

## 4. ADR / évolution §8

**Évolution §8 ADDITIVE, invariant same-digest PRÉSERVÉ** (désormais enforced par la CD, plus par l'apply manuel).
**Mon call = ADR-0028** « geo adopte le plan de déploiement plateforme (ARCH-17/BR-55) » — supersede le **volet MANUEL**
de l'ADR-0027 §8 par le pipeline CD (référence ADR-0027, ne touche pas les autres invariants) ; grave aussi
l'**évolution du modèle secrets** (§7 A2 : éphémère-en-fenêtre → SealedSecrets committés long-vécus, scoping préservé).
Un simple amendement §8 sous-signalerait l'adoption d'un standard plateforme. **Channel-agnostique** : le verdict du
fork (B/GitOps) fige le delta C2, pas l'ADR.

## 5. Coût (p-jours, estimé — à confirmer contre les specs s-archi)

| Chantier | Coût geo | Note |
|---|---|---|
| C1 Kustomize base+overlays | **2–4 p-j** | restructurer plats→base+overlays (preprod+prod), consolider la ligne servie, `kubectl apply -k --dry-run` vert |
| C2 CI `deploy-preprod` + Makefile | **2–3 p-j** | job ci.yml, assert-images, kustomize-edit, cible make, test vs kubeconfig preprod |
| C3 SealedSecrets | **1–2 p-j** | kubeseal des 4 secrets + procédure de scellement documentée |
| C4 prod same-digest gate | **1–2 p-j geo** | overlay prod + hook release-prod — **gaté sur BR-55d (plateforme)** |
| **Total geo** | **~6–11 p-j** | **preprod (C1+C2+C3) drivable maintenant** ; prod (C4) attend BR-55d |

## 6. Séquence & dépendances

```
C1 Kustomize (fondation) ─┬─► C2 CI deploy-preprod ──► preprod AUTO (main→preprod) ✅ livrable geo
                          ├─► C3 SealedSecrets (requis avant 1er apply CI)
                          └─► C4 overlay prod ──► [GATE BR-55d plateforme] ──► release-prod tag→prod
```
- **Déblocable maintenant côté geo** : C1+C2+C3 → **CD preprod complet** (main→preprod auto).
- **Dépendances externes** : **kubeconfig preprod (GH secret)** = owner ; **BR-55d `release-prod`** = plateforme s-archi (prod promotion attend) ; **DNS** `api.preprod.geo…` = owner/infra ; **sealed-secrets controller** présent au cluster (poc-k8s).

## 7. Zéro-rework (ce que le substrat ADR-0027 fournit déjà)

- Manifests preprod committés (#228) → **migrent dans les overlays** (contenu préservé).
- Invariant **same-digest** (ADR-0027 §8) → **enforced par la CD** (promotion, jamais rebuild).
- **Gate coherence/complétude** (`geo-verify-served-collections.mjs`) → devient le **self-gate deploy-preprod**.
- Placeholder `REPLACE_WITH_POST_MERGE_GEO_DIGEST` → **résolu par `kustomize edit` en CI**.
- Isolation **A2** (netpol + cred-scoping) → **portée dans base/overlays** ; C3 la rend **committée** (fin du live-only).

## 8. Reste `unknown` / à confirmer (anti-invention)

- **Fork de canal (B push / B-mitigé region / GitOps pull)** = **dossier owner s-archi EN COURS** → **fige uniquement le delta C2** (mécanique d'apply) au verdict ; le reste est channel-agnostique (pas de re-design). Résidence Loi-25 = le driver du fork.
- **Conventions exactes du standard** (layout Kustomize, étapes précises du job `deploy-preprod`, noms de cibles make, nommage `deploy/scw/NN-sealed-*.yaml`, contrat `release-prod`/BR-55d) → **confirmer contre les specs s-archi** (hors repo geo) avant impl.
- **BR-55d `release-prod`** = plateforme-pending → date de la promotion prod inconnue tant que non finie.
- **ESO + OVH-SM** = **hors scope** (non installé ; futur, même bundle upgrade que GitOps) — SealedSecrets (bitnami, installé) est le modèle secrets de l'adoption.
- **Détails poc-k8s à confirmer à l'impl** (je boucle poc-k8s directement) : mécanique `kubeseal`/cert de scellement, verbes RBAC exacts du SA least-privilege `deploy-preprod`, provisioning du kubeconfig en GH secret.
- **PostGIS prod** dans/hors le périmètre CD serving (S3-only) → à trancher (garder en overlay-prod si le tenant prod en dépend, sinon hors CD).
- **kubeconfig preprod + DNS** = owner/infra.

**DESIGN pour cadrage owner — adoption d'un standard ratifié, pas greenfield. Anti-invention : forme d'adoption
groundée sur le résumé autoritaire + l'état réel geo ; conventions exactes à confirmer contre les specs s-archi ;
coûts estimés non figés ; BR-55d/kubeconfig/DNS = dépendances externes explicites.**
