<!--
  Gate testable §5 (satellite 2D Google). Capitalisé (principe fondateur : un gate
  qui ne vit que dans un message chat = irreproductible). Source : le runbook
  GCP_BUDGET_GUARDRAIL_3DTILES.md + les scripts per-phase de ce dossier + la Function
  cap-billing/ + le contrat d'intégration §5 (SPEC_GEO_MAP_ENGINE_V2_BASEMAP_2D, PR #301,
  ADR-0029/0030). NB : l'exécution est owner-gated (billing-link + clé = owner-direct) ;
  ce document est la DÉFINITION testable à appliquer, pas un rapport d'exécution.
-->

# §5 3D/2D Tiles — Gate testable (PASS/FAIL) avant toute clé

**But** : la dépense GCP **ne PEUT PAS** dépasser ~50 €/mois, prouvé **AVANT** d'activer la
clé Map Tiles ; et l'intégration Immo respecte la licence (attribution dynamique, pas de
rediffusion, prod intouchée).

## A) Garde-fous — PASS/FAIL AVANT TOUTE CLÉ (ordre non-négociable)

| # | Étape | PASS = | Runner |
|---|-------|--------|--------|
| 1 | Projet `radar-3dtiles-preprod` + **billing-link** (argent, **owner-direct**) | projet créé + lié | owner |
| 2 | `20-budget-pubsub` — budget 50€ + alertes 50/90/100% + topic | budget listé, **`--filter-projects=projects/radar-3dtiles-preprod`** (pas billing-account-wide) [couche 1] | k8s/owner |
| 3 | `30-cap-billing-fn` — SA custom role **project-scope** (`serviceusage.services.disable`+`.get`) + `run.invoker` + Function abonnée au topic | `describe` : state ACTIVE + eventTrigger=topic [couche 2 = le vrai hard-cap] | k8s/owner |
| 4 | `40-quota` — quota Map Tiles ~300/j (console) | quota posé [couche 3, ceinture secondaire] | k8s/owner |
| 5 | **`50-test-kill` (J) = LE GATE** — publie `{costAmount:51,budgetAmount:50}` → assert `tile.googleapis.com` **disabled** → ré-enable API (humain, project-scoped) | **API billable COUPÉE prouvée** (poll borné) | k8s/owner |
| 6 | **Clé H — EN DERNIER, seulement si J=PASS** — restreinte (`api-target=tile.googleapis.com` + `allowed-referrers=https://*.sent-tech.ca/*`, **owner-direct**), `keyString` jamais `echo` → `60-k8s-secret` (stdin→kubectl, préprod) | clé restreinte créée + secret k8s posé | owner (+ k8s pour 60 si kubectl) |

**Gate global** : **FAIL** si un de 1–5 manque **OU** si J ne prouve pas `tile.googleapis.com` disabled.
**La clé (6) ne se crée QUE sur A=PASS.**

## B) Intégration Immo — critères CI/runtime (contrat §5, PR #301 / ADR-0029-0030)

- **Attribution DYNAMIQUE** : `AttributionControl` **DOM-visible** ; `attributionControl:false` **INTERDIT** ; test = attribution dans le DOM **ET** visible.
- **Session tokens** : session Google (`create-session`) + injection session+clé via `transformRequest` + **refresh à expiration** ; clé lue **à l'activation, JAMAIS committée** ; **flag-gated OFF** par défaut.
- **Pas de cache / rediffusion** : garde committée `live-embed-only` — refuse tout octet d'imagerie d'une source `live-embed-only` → S3 (provenance via manifeste `source_policy`, pattern `assertVisionModelAllowed`) ; **test échoue si contourné**. Tuiles navigateur → Google **DIRECT**, jamais proxifiées/cachées S3.
- **Prod intouchée** : préprod-only, flag OFF, 0 owner, **0 clé/secret committé, 0 ressource cloud** ; **additivité v1** (`raster-source` ajouté ; `blank`/`raster`/`vector` INCHANGÉS ; test : aucun both-optional W5).

## C) Conditions de STOP (on ne procède pas / on arrête)

1. Un garde-fou **A** échoue — **surtout J ne coupe pas** (`tile.googleapis.com` reste enabled) → STOP, pas de clé.
2. **Parole owner-direct absente** pour billing-link ou clé (un relais ≠ autorisation) → STOP.
3. **Accès/intent GCP de l'exécutant non résolu** → STOP (exec bloquée).
4. **Un octet d'imagerie atteint S3** (garde `live-embed-only` déclenchée) → STOP (violation licence).
5. **Attribution non DOM-visible** → STOP (violation ToS).
6. Un **secret/clé serait committé** OU une **ressource cloud créée hors du flux gaté** → STOP.
7. **Prod touchée** (déploiement / bucket) → STOP.
8. **Dépense observée qui monte sans coupure** → STOP (le cap a échoué — re-tester J).

## Modèle 2 couches + owner-direct

- **CI pré-merge** : les tests committés (client-side, ex. label-length du serve-job, additivité v1, garde live-embed-only) — pas de cluster/cloud en CI.
- **Pré-apply k8s** : `kubectl apply --dry-run=server` (validation cluster-side).
- **Owner-direct** (parole directe de l'owner dans la session exécutante, jamais un relais) : **billing-link (A1)** + **création de clé (A6)**. La ré-enable de l'API après le test-kill est project-scoped/humaine (pas owner-direct billing). `${BILLING_ACCOUNT}` fourni à l'exec, **jamais committé** (repo public).

Voir : [`GCP_BUDGET_GUARDRAIL_3DTILES.md`](./GCP_BUDGET_GUARDRAIL_3DTILES.md) · [`README.md`](./README.md) · [`cap-billing/`](./cap-billing/).
