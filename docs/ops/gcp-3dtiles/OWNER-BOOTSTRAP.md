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

## Option A — autonomie durable (CI/CD keyless via WIF) — RECOMMANDÉE

Ordre exact, une passe. Chaque script est idempotent + self-verifying (relançable).

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

**[c] Secrets GitHub** (owner/infra ; jamais committés) — repo `rhanka/geo` → Settings → Secrets :

`KUBE_CONFIG_GEO` — kubeconfig du SA k8s `geo-ci-runner` (ns `geo-preprod`, RBAC #327), **token BORNÉ
(TokenRequest, PAS de token éternel** — boundary i-infra). Généré + poussé + shreddé par le script dédié
(token JAMAIS imprimé) :
```bash
bash docs/ops/gcp-3dtiles/54-gen-kubeconfig.sh
```
Le script mint un token borné (`TOKEN_TTL=720h` par défaut, plafonné par le max cluster), assemble un
kubeconfig minimal (token SA seul, **0 cred admin**), `gh secret set KUBE_CONFIG_GEO`, shred, self-verify
(secret posé + `auth can-i list jobs`). **Token borné ⇒ rotation** : re-lancer `54` avant expiry (la CI
échoue loud à expiry — pas de dégradation silencieuse).

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
Le couple ACCESS/SECRET = une **clé API Scaleway READ-ONLY** scopée au bucket `sentropic-geo-preprod`
(prod DENY). Mint (console Scaleway → IAM, ou `scw` CLI) : créer une Application + une Policy ObjectStorage
**read-only** sur le projet portant `sentropic-geo-preprod`, puis générer une API key. Un pattern RO existe
déjà en cluster (`geo-s3-credentials-prod-ro`) ; **i-infra possède la frontière S3-provider** et confirme
le permission-set exact. Puis pose + shred (jamais committé, jamais gardé en clair) :
```bash
gh secret set GEO_S3_ENV -R rhanka/geo < geo-s3-ro.env   # dotenv des 5 lignes ci-dessus
shred -u geo-s3-ro.env
```

**[d] GitHub Environment + Variables** — repo → Settings → Environments → `geo-preprod` :
- **required reviewer = owner** (⇒ gate owner sur chaque dispatch de job/ops, même après activation) ;
- Variables : `WIF_PROVIDER` = sortie [a] ; `CAP_EXECUTOR_SA` = sortie [a] ; `PREPROD_OGC_URL` = l'ingress geo-api preprod (pour que la vérif `verify-served.sh` soit réelle).

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
