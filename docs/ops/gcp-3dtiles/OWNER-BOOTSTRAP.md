# OWNER-BOOTSTRAP — §5 geo autonomie + accès serve (turnkey)

**Qui** : l'**OWNER** (à la fois `iam-admin` GCP sur `radar-3dtiles-preprod` **et** admin du repo GitHub
`rhanka/geo`). Personne d'autre (ni SA, ni CI, ni geo-socle) ne lance ceci.
**Quoi** : provisionne l'**ACCÈS** least-priv qui laisse la CI/CD geo lancer les jobs et l'exécuteur §5
faire les ops quota/clé — **par impersonation keyless (WIF), 0 clé SA téléchargée**.
**Ce que ça N'active PAS** : servir des tuiles Google VISIBLES = **activation** = un GO owner SÉPARÉ
(flip licence ODbL **ADR-0030** + « GO Google » clé), APRÈS que l'adaptateur basemap est buildé. Ce
bootstrap ne fait que poser l'accès ; le DEPLOY/serve suit une fois l'adaptateur prêt (il ne bloque pas
le bootstrap access lui-même). Cap-billing prouvé + armé (garde-fou money en place).

Placeholders : `<PROJECT_NUMBER>` s'affiche au runtime (jamais committé). Toutes les valeurs qui
contiennent le project-number vont en **GitHub Variable/Secret**, jamais dans le repo.

---

## ⭐ Le bootstrap = un SPLIT (owner + poc-k8s)

Le bootstrap se SCINDE en 2 acteurs (mesuré : l'owner a GCP + GitHub mais **PAS d'accès kubectl OVH** ; le
cluster preprod = **OVH poc-ca/bhs5**, tenant poc-k8s). Split ratifié geo-archi + i-infra. « **Poser ≠
activer** ».

**A. Owner — UNE commande** (son terminal ; login iam-admin GCP + github-admin ; jamais une session agent —
geo-socle ne manie jamais les creds root) :
```bash
bash docs/ops/gcp-3dtiles/50-owner-bootstrap-all.sh
```
Prérequis one-time (le wrapper vérifie + fail-loud) : `gcloud auth login` + `gh auth login`. Le wrapper fait
la part **GCP + GitHub SEULEMENT** — [a] WIF (53) + [b] executor (52) + [c] Environment required-reviewer +
Variables (WIF_PROVIDER/CAP_EXECUTOR_SA) + GEO_S3_ENV guidé — idempotent + fail-loud + self-verify.

**B. poc-k8s — le hand-off OVH k8s** (SEUL poc-k8s a l'admin OVH ; les scripts committés sont la SOURCE,
poc-k8s exécute) : applique le §5 RBAC + pose l'identité **INERTE**. Voir **§ Hand-off poc-k8s** ci-dessous.

**Après A + B** (l'identité posée, inerte), TOUT le reste = **GO-pur owner** : GO#1 = merge la PR ODbL #335
(flip flag) ; GO#2 = approuve le dispatch activate-serve #334 (mint clé + secret + restart). **0 terminal
owner** au-delà de la commande A. Le 1er grant (A : iam-admin GCP + github-admin ; B : admin OVH poc-k8s) =
la racine de confiance non-auto-grantable.

---

## § Hand-off poc-k8s (OVH k8s — pose l'identité §5 INERTE)

poc-k8s (admin OVH poc-ca/bhs5, tenant geo-preprod) exécute, dans SA session (contexte OVH) :
1. **RBAC §5** : `kubectl apply -f deploy/ci/geo-ci-rbac.yaml` — SA `geo-ci-runner` + Role job-launcher (#327)
   + **Role activation** (secrets{get,patch} resourceNames:[geo-tile-key] + deployments{get,patch}
   resourceNames:[geo-api], ns geo-preprod ; **0 all-secrets/create**).
2. **KUBE_CONFIG_GEO (ATOMIQUE, no-leak)** : `bash docs/ops/gcp-3dtiles/54-gen-kubeconfig.sh` — mint un token
   BORNÉ du SA geo-ci-runner **ET** `gh secret set KUBE_CONFIG_GEO --env geo-preprod` **dans la MÊME session**
   (le token borné ne quitte JAMAIS la session poc-k8s = pas de handoff = pas de fuite ; i-infra). Env-scopé
   `geo-preprod` = derrière required-reviewer → le SA n'est utilisable QUE via le dispatch owner-approuvé #334.
3. **Secret geo-tile-key VIDE** (placeholder) : `kubectl create secret generic geo-tile-key -n geo-preprod
   --dry-run=client -o yaml | kubectl apply -f -`. VIDE ⇒ /basemap/2d/session = **503 fail-closed** jusqu'à ce
   que #334 (owner-GO#2) écrive la vraie clé. **poc-k8s N'écrit JAMAIS la vraie clé** (poser ≠ activer).

⚠ poc-k8s pose la **CAPACITÉ INERTE**. L'**ACTIVATION** (vraie clé + flag-ON) = **owner-GO uniquement**
(#335 merge + #334 dispatch approuvé qui asserte ADR-0030=accepted). i-infra certifie le scope RBAC runtime
(`can-i`) avec un kubeconfig OVH read-only (à provisionner par poc-k8s/i-cond).

---

## Option A — détail des étapes [a]→[d] (référence)

Ordre exact, une passe. Chaque script est idempotent + self-verifying (relançable). ⚠ **Répartition SPLIT** :
[a] WIF + [b] executor = **owner/50** (GCP) ; [c] Environment + Variables + GEO_S3_ENV = **owner/50** (GitHub) ;
`KUBE_CONFIG_GEO` (via 54) + le RBAC §5 + le secret `geo-tile-key` VIDE = **poc-k8s** (OVH — cf § Hand-off poc-k8s ci-dessus). Le wrapper 50 ne fait QUE la part owner (GCP+GitHub).

**[a] WIF Pool + Provider** (produit `BASE_IDENTITY`) :
```bash
bash docs/ops/gcp-3dtiles/53-bootstrap-wif.sh
# → note les 3 sorties : BASE_IDENTITY (principalSet), WIF_PROVIDER, CAP_EXECUTOR_SA
```
> ⚠ **Sécurité — ne PAS "simplifier" plus tard** (i-infra N1) : la garde `environment` vient de
> l'**attribute-condition** du provider (sur les claims bruts `assertion.*`), PAS du principalSet. Le
> principalSet est repo-scopé (`attribute.repository/rhanka/geo`) ; le set admis effectif = **repo ∩
> environment**, l'intersection étant imposée à l'échange de token par la condition. Ne jamais réduire la
> condition à repo-only en croyant que le principalSet couvre l'`environment` — il ne le couvre PAS.

**[b] Exécuteur least-priv** (SA impersonation-only + 2 roles séparés + tokenCreator sur le principalSet) :
```bash
BASE_IDENTITY='<principalSet de [a]>' GRANT_KEY_CREATION=yes \
  bash docs/ops/gcp-3dtiles/52-bootstrap-geo-executor.sh
# GRANT_KEY_CREATION=yes = provisionne AUSSI le role de création de clé (option-A serve). Sans lui = quota-only.
```
> ⚠ **Frontière** (i-infra) : `GRANT_KEY_CREATION=yes` provisionne le **RÔLE** (la *capacité* de créer une
> clé), PAS la clé, PAS l'activation — **0 dépense ouverte**. Le mint réel de la clé reste money-gated
> derrière le GO activation séparé + la cert i-infra POST-run (ré-attach + cap-billing Function armée,
> finding #329). Lire « **armer la capacité** », pas « créer la clé ».

**[c] GitHub Environment + Variables** — repo → Settings → Environments → `geo-preprod`. **À FAIRE AVANT
[d]** : les secrets sont ENV-scopés (derrière le gate) → l'Environment doit exister d'abord.
- **required reviewer = owner** (⇒ gate owner sur chaque dispatch de job/ops, même après activation) ;
- Variables (env-scopées) : `WIF_PROVIDER` = sortie [a] ; `CAP_EXECUTOR_SA` = sortie [a] ; `PREPROD_OGC_URL`
  = l'ingress geo-api preprod (pour que `verify-served.sh` soit réelle).

**[d] Secrets GitHub — ENV-scopés `geo-preprod`** (owner/infra ; jamais committés). ⚠ **ENV-scopés =
derrière le gate required-reviewer, PAS repo-scopés** : un secret repo-scopé serait lisible par TOUT
workflow (hors gate) sur ce repo public → une cred cluster contournerait le gate owner (MUST i-infra).

`KUBE_CONFIG_GEO` — kubeconfig du SA k8s `geo-ci-runner` (ns `geo-preprod`, RBAC #327), **token BORNÉ
(TokenRequest, PAS de token éternel** — boundary i-infra). Généré + poussé (env-scopé) + shreddé par le
script dédié (token JAMAIS imprimé) :
```bash
bash docs/ops/gcp-3dtiles/54-gen-kubeconfig.sh   # pose KUBE_CONFIG_GEO --env geo-preprod (exige l'Environment [c])
```
Le script mint un token borné (`TOKEN_TTL=720h` demandé, **plafonné par le max cluster** — il émet l'expiry
ACCORDÉ pour la rotation), assemble un kubeconfig minimal (token SA seul, **0 cred admin**),
`gh secret set KUBE_CONFIG_GEO --env geo-preprod`, shred, self-verify (secret env-scopé + `auth can-i list
jobs`). **Token borné ⇒ rotation** : re-lancer `54` avant l'expiry accordé (la CI échoue loud à expiry).

`GEO_S3_ENV` — cred S3 **READ-ONLY** pour que le render CI lise S3 (`render-cptaq-serve.ts` lit le
manifeste de capture). Provider = **Scaleway Object Storage** ; le secret = un blob dotenv des 5 variables
(mesurées sur `geo-s3-credentials`) :
```
S3_ENDPOINT=<endpoint Scaleway, ex. https://s3.fr-par.scw.cloud>
S3_REGION=<region, ex. fr-par>
S3_BUCKET=sentropic-geo-preprod
S3_ACCESS_KEY=<access key RO>
S3_SECRET_KEY=<secret key RO>
```
Le couple ACCESS/SECRET = une **clé API Scaleway READ-ONLY**. Recette autoritative (i-infra, frontière
S3-provider), 2 couches :
- **Couche 1 — Scaleway IAM (contrôle primaire)** : une **IAM Application DÉDIÉE** (identité machine, PAS
  un user) → l'API key s'y attache. UNE Policy sur cette Application : SCOPE = le **PROJET preprod
  UNIQUEMENT** (celui portant `sentropic-geo-preprod` ; PAS org-wide — c'est ce scope-projet qui rend la
  prod DENY, le bucket prod étant hors du projet policé) ; PERMISSION SET = `ObjectStorageReadOnly`
  (built-in ; granulaire équivalent `ObjectStorageObjectRead` + `ObjectStorageBucketRead`) ; **JAMAIS**
  `ObjectStorageFullAccess` / `ObjectStorageObjectWrite` / aucun set write/delete. Générer l'API key SOUS
  cette Application (Preferred Project = preprod) → `ACCESS_KEY` (SCW…) + `SECRET_KEY`.
- **Couche 2 — bucket policy S3 (défense-en-profondeur ; IAM reste l'autorité)** : Allow au principal de
  l'Application UNIQUEMENT `s3:GetObject` + `s3:ListBucket` (+ option `s3:GetBucketLocation`) sur
  `sentropic-geo-preprod` et `/*`. Aucun `s3:PutObject` / `s3:DeleteObject` / `s3:PutBucketPolicy`.

i-infra **certifie le scope au provisioning** (5 probes RO : ListBucket preprod OK · GetObject OK ·
PutObject 403 · DeleteObject 403 · toute op bucket PROD DENIED). **GUARDRAIL** : GEO_S3_ENV = RO pour le
chemin render-lit-S3 ; un job SERVE qui écrit S3 = une cred **SÉPARÉE scopée-write**, JAMAIS élargir
GEO_S3_ENV en RW (deux chemins = deux creds). Puis pose (env-scopé) + shred (jamais committé) :
```bash
gh secret set GEO_S3_ENV -R rhanka/geo --env geo-preprod < geo-s3-ro.env   # dotenv des 5 lignes ci-dessus
shred -u geo-s3-ro.env
```

➡ Résultat : la CI/CD geo (workflow `geo-jobs.yml`, #327) peut lancer les jobs preprod, et l'exécuteur §5
peut faire les ops quota/clé — **keyless, owner-gated par dispatch, least-priv**. Le DEPLOY de l'adaptateur
+ le serve suivent une fois l'adaptateur buildé + le GO activation (ci-dessous).

---

## Option B — bring-up direct rapide (repli, terminal owner, sans WIF)

Si tu préfères tout faire dans TON terminal avec TON login (owner-full), sans CI/WIF — le plus court
vers la carte une fois l'adaptateur déployé :
```bash
# (le cap-test doit rester en place ; le ré-attach + la clé se lancent quand l'adaptateur a un secret-target réel)
KEY_SECRET_NS=<ns adaptateur> KEY_SECRET_NAME=<secret clé adaptateur> \
  bash docs/ops/gcp-3dtiles/60-owner-finish-serve.sh
# 60 = reattach quota → clé RESTREINTE (tile-only + referrer sent-tech.ca) → wire le secret (keyString jamais imprimé) → test-A (≤2 requêtes)
```
Option B n'a besoin NI de WIF NI de l'exécuteur #328 (tu es owner-full). Le keyString n'est jamais
imprimé. i-infra certifie le résultat POST-run (override=none×4 + Function armée + clé restreinte + secret).

---

## Gate d'ACTIVATION (serve live) — SÉPARÉ, après l'adaptateur

Servir des tuiles Google visibles n'est PAS déclenché par ce bootstrap. Ordre du serve :
`prep (adaptateur + mint, flag-OFF)` → `budget re-test-kill` → **`GO owner : flip ODbL (ADR-0030) + clé`**
→ `mini-gate` → `GEL v2 (owner-gated)` → `serve live`. Tant que le GO owner n'est pas donné, l'adaptateur
reste **flag-OFF/inerte** (refus loud, jamais un blanc silencieux — cf #313).
</content>
