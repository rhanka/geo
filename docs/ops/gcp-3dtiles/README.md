<!--
  Scripts committés per-phase qui capitalisent l'exécution du runbook
  docs/ops/GCP_BUDGET_GUARDRAIL_3DTILES.md (§5 3D Tiles). Paramétrés, 0 secret /
  identifiant-de-compte committé (repo public). L'exécution passe par ces scripts
  committés (pas d'ad-hoc gcloud) ; author/gate = geo-socle, design + co-val
  PROJET-scope = i-infra, runner = voir le tableau des rôles.
-->

# §5 3D-Tiles GCP — scripts d'exécution per-phase

Capitalisation exécutable du runbook [`../GCP_BUDGET_GUARDRAIL_3DTILES.md`](../GCP_BUDGET_GUARDRAIL_3DTILES.md).
**But** : poser un hard-cap budget **avant** d'activer la clé Map Tiles, de sorte que la
dépense GCP **ne PEUT PAS** dépasser ~50 €/mois.

## Principe de sûreté

- **`env.sh` = un seul `${PROJECT_ID}`** sourcé par tous → garde-fou ET dépense = le
  **même projet par construction** (aucun littéral prod/préprod divergent).
- **`${BILLING_ACCOUNT}` = owner-direct à l'exec, JAMAIS committé** (repo public).
- **La clé (H) n'est PAS un script** — création owner-direct inline, `keyString` jamais `echo`.
- **`50-test-kill` PROUVE le cap AVANT toute clé** : si le quota billable n'est pas mis à 0 → `exit 1`, on ne crée pas la clé.
- **Rôle SA = custom role project-scope (`serviceusage.quotas.update` + `.get`)** : la Function pose un quota-override=0 sur les métriques billables ; kill-only est enforced au **CODE** (`overrideValue:"0"` hardcodé ; `quotas.update` est bidirectionnel = grain minimal GCP) → remonter le quota = humain (0 permission billing, 0 grant billing-account).

## Ordre (non-négociable)

```
owner A (billing-link, argent)  →  10 enable-apis  →  20 budget+topic [couche1]
  →  30 cap-billing Function [couche2]  →  40 quota [couche3]
  →  50 TEST-KILL (prouve le hard-cap)  →  remonter le quota (humain, project-scoped)
  →  owner H (clé, secret)  →  60 k8s-secret
```

## Rôles

**Décidé** : **owner / k8s-domain exécutent ; i-infra = design + co-val strict (PAS
exécutant)**. « Committé ≠ ad-hoc » et « 10–50 = 0 € » sont exacts, mais *qui-exécute-
l'infra* (deploy / billing / secret / cluster) est une frontière **distincte** : elle ne
s'élargit que sur **parole owner-DIRECT**, jamais sur accord de pair. i-infra ne peut
prendre que **10 / 20 / 40** et **seulement** si l'owner-direct le dit ; **30 (deploy) ·
50 (quota-cap) · 60 (secret) · A · H = owner/k8s dans TOUS les cas**.
**geo-socle gate partout ; author (geo-socle) ≠ executor (owner/k8s) ≠ co-val (i-infra).**

| Phase | Fait quoi | Dépense ? | Runner | Gate / co-val |
|------|-----------|-----------|--------|----------------|
| `00-preflight.sh` | check gcloud (read-only) | non | owner / k8s | — |
| **A** (inline) | `projects create` + `config set` + **`billing projects link`** | **owner-direct** | **owner** | i-infra co-val |
| `10-enable-apis.sh` | enable APIs | non | owner *(i-infra si owner-direct)* | geo-socle gate |
| `20-budget-pubsub.sh` | topic + budget 50€ | non (cap) | owner *(i-infra si owner-direct)* | geo-socle gate |
| `30-cap-billing-fn.sh` | SA least-priv + Function | ~0 (free-tier, sous budget) | **owner / k8s** (jamais i-infra : deploy) | geo-socle gate |
| `40-quota-maptiles.sh` | pointeur quota (console) | non | owner *(i-infra si owner-direct)* | — |
| `50-test-kill.sh` | prouve le kill | non (quota→0) | **owner / k8s** | i-infra co-val = **J prouve quota=0 sur les 4 métriques tile** |
| **ré-enable quota** (inline) | **`gcloud alpha services quota update … --value=<défaut>`** | non (project-scoped) | **owner / k8s** (humain) | i-infra co-val |
| **H** (inline) | `api-keys create` (secret) | ouvre la dépense | **owner-direct** | i-infra co-val |
| `60-k8s-secret.sh` | clé → secret k8s (no-echo) | non | **owner (kubectl) / k8s-domain** — jamais i-infra | geo-socle gate |

## Commandes owner-direct inline (PAS de script)

```bash
# A — projet + billing-link (argent)
gcloud projects create radar-3dtiles-preprod
gcloud config set project radar-3dtiles-preprod
gcloud billing projects link radar-3dtiles-preprod --billing-account=<BILLING_ACCOUNT>

# remonter le quota — APRÈS 50-test-kill (project-scoped, humain ; la SA ne pose que 0)
gcloud alpha services quota update --service=tile.googleapis.com --consumer=projects/radar-3dtiles-preprod \
  --metric=tile.googleapis.com/twodtiles --unit="1/min/{project}" --value=6000  # par métrique

# H — clé, EN DERNIER, seulement si 50 a prouvé le cap (secret ; keyString jamais echo)
gcloud services enable tile.googleapis.com --project radar-3dtiles-preprod
gcloud services api-keys create --project radar-3dtiles-preprod \
  --display-name="3dtiles-preprod-key" --api-target=service=tile.googleapis.com \
  --allowed-referrers="https://*.sent-tech.ca/*"
```

## Checkpoints co-val i-infra (PROJET-scope)

1. un seul `${PROJECT_ID}` partout — 0 littéral divergent ;
2. budget `--filter-projects=projects/${PROJECT_ID}` (pas billing-account-wide) ;
3. rôle SA = custom **project-scope** (`serviceusage.quotas.update` + `.get` — 0 permission billing ; kill-only-code) + `run.invoker` (post-deploy) ;
4. `50` prouve **quota=0** sur les 4 métriques billables de `tile.googleapis.com` **AVANT** toute clé ;
5. `60` no-echo (stdin→kubectl) + le déploiement lit bien `MAPTILES_API_KEY` du secret.

## Contrat d'injection `60` (render lane)

- **env `MAPTILES_API_KEY` ← secret k8s `maptiles-3dtiles-key`** = le contrat que l'app UI
  consomme (render lane geo-socle). N'est PLUS un placeholder.
- **Consumer réel = l'adapter raster basemap §5, v2-HELD** (n'existe pas encore) → `60`
  **provisionne en avance** ; le mount `secret→env` = **CD (geo-archi)**, câblé au §5-land.
- **Gate SEULEMENT `60`** (dernier step) — n'impacte pas 10-50 / A / test-kill / H.
