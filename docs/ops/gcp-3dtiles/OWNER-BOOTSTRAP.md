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

**[b] Exécuteur least-priv** (SA impersonation-only + 2 roles séparés + tokenCreator sur le principalSet) :
```bash
BASE_IDENTITY='<principalSet de [a]>' GRANT_KEY_CREATION=yes \
  bash docs/ops/gcp-3dtiles/52-bootstrap-geo-executor.sh
# GRANT_KEY_CREATION=yes = provisionne AUSSI le role de création de clé (option-A serve). Sans lui = quota-only.
```

**[c] Secrets GitHub** (owner/infra ; jamais committés) — repo `rhanka/geo` → Settings → Secrets :
- `KUBE_CONFIG_GEO` = kubeconfig du SA k8s `geo-ci-runner` (ns `geo-preprod`, #327) — **token borné (TokenRequest)**, pas de token éternel.
- `GEO_S3_ENV` = cred S3 **READ-ONLY** scopé bucket `sentropic-geo-preprod` (prod DENY) — le render CI lit S3.

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
