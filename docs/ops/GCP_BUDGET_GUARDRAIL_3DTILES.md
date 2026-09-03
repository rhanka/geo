<!--
  CAPITALISATION : ce runbook est la copie CANONIQUE geo-side (wp7 socle exécute
  l'intégration GCP §5 3D Tiles). Origine : design + co-val i-infra (ex `lane/infra`
  `2d2db97`, radar-immobilier), capitalisé ici parce que « rien ne doit exister
  uniquement sur une machine » — le runbook que geo-socle exécute DOIT être accessible
  sur un checkout propre. rhanka/geo est PUBLIC → aucun secret / identifiant-de-compte
  n'est committé (le billing-account ID est PARAMÉTRÉ `${BILLING_ACCOUNT}`, la clé est
  créée-pas-committée à l'exécution).
-->

# Garde-fou budget hard-cap GCP — §5 3D Tiles

**But** : la dépense GCP **ne PEUT PAS** dépasser ~50 €/mois, posé **AVANT** que la clé Map Tiles soit active.

## ⚠️ GATE D'EXÉCUTION (non-négociable)

- Le `gcloud` est **authed-comme-l'owner + partagé** entre sessions → une session PEUT techniquement lancer ces commandes. **Ça n'AUTORISE PAS.** Les étapes **owner-réservées — `billing projects link` (argent) + création de clé (secret)** — ne s'exécutent QU'AVEC la **parole DIRECTE de l'owner DANS la session exécutante** (owner présent) OU un **record durable spécifique owner-ratifié**. Un relais (« l'owner a dit que geo le fasse ») **≠** cette autorisation.
- **`${BILLING_ACCOUNT}`** = fourni par l'owner **au moment de l'exec** (owner-direct), **jamais committé** (repo public).
- **i-infra co-valide CHAQUE commande** (scope **PROJET-only** : `radar-3dtiles-preprod`, rien org/billing-account-wide) AVANT exécution, et co-valide l'output. La **clé n'est JAMAIS imprimée**.
- **Ordre non-négociable** : garde-fous **A–G → TEST-KILL J → clé H EN DERNIER → secret k8s I**.

## Un « budget cap » GCP = ALERTE, pas hard-cap

4 couches ; la **(2) = le hard-cap réel** (une Cloud Function détache le billing quand la dépense atteint le seuil). Méthode = **gcloud CLI** (pas Playwright ; le deploy de la Function est trop critique).

## Étapes

- **A — projet + billing** (le `link` = **owner-direct**) :
  ```
  gcloud projects create radar-3dtiles-preprod
  gcloud config set project radar-3dtiles-preprod
  # [OWNER-DIRECT] :
  gcloud billing projects link radar-3dtiles-preprod --billing-account="${BILLING_ACCOUNT}"
  ```
- **B — APIs** :
  ```
  gcloud services enable cloudbilling.googleapis.com cloudfunctions.googleapis.com pubsub.googleapis.com cloudbuild.googleapis.com run.googleapis.com
  ```
- **C — topic Pub/Sub** : `gcloud pubsub topics create billing-guardrail`
- **D — budget + notifications** :
  ```
  gcloud billing budgets create --billing-account="${BILLING_ACCOUNT}" \
    --display-name="3dtiles-50eur-hardcap" \
    --filter-projects="projects/radar-3dtiles-preprod" \
    --budget-amount=50EUR \
    --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0 \
    --notifications-rule-pubsub-topic="projects/radar-3dtiles-preprod/topics/billing-guardrail"
  ```
- **E — service account + rôle** :
  ```
  gcloud iam service-accounts create cap-billing-sa
  gcloud projects add-iam-policy-binding radar-3dtiles-preprod \
    --member="serviceAccount:cap-billing-sa@radar-3dtiles-preprod.iam.gserviceaccount.com" \
    --role="roles/billing.projectManager"
  ```
- **F — deploy la Function** (source = [`./cap-billing/`](./cap-billing/), co-locée) **AVANT la clé** :
  ```
  cd docs/ops   # la source est docs/ops/cap-billing/
  gcloud functions deploy cap-billing --gen2 --runtime=nodejs20 --region=europe-west1 \
    --trigger-topic=billing-guardrail --entry-point=capBilling \
    --service-account=cap-billing-sa@radar-3dtiles-preprod.iam.gserviceaccount.com \
    --source=./cap-billing
  gcloud functions describe cap-billing --region=europe-west1   # vérifier abonnée
  ```
- **G — quota Map Tiles** ~300/j (Service Usage / console — vérifier au moment).
- **🔴 J — TEST-KILL, AVANT LA CLÉ** (prouve le hard-cap) :
  ```
  gcloud pubsub topics publish billing-guardrail --message='{"costAmount":51,"budgetAmount":50}'
  gcloud billing projects describe radar-3dtiles-preprod   # attendu : billingEnabled=false
  # ré-attacher (OWNER-DIRECT) :
  gcloud billing projects link radar-3dtiles-preprod --billing-account="${BILLING_ACCOUNT}"
  ```
- **H — clé, EN DERNIER (si J OK)** :
  ```
  gcloud services enable tile.googleapis.com   # vérifier le nom du service au moment
  gcloud services api-keys create --display-name="3dtiles-preprod-key" \
    --api-target=service=tile.googleapis.com \
    --allowed-referrers="https://*.sent-tech.ca/*"
  ```
- **I — secret k8s** (jamais `echo` la clé) : `get-key-string | kubectl create secret … -n <ns préprod>`.

## Source de la Function

[`./cap-billing/index.js`](./cap-billing/index.js) + [`./cap-billing/package.json`](./cap-billing/package.json) — la Function détache le billing (`updateBillingInfo` avec `billingAccountName:''`) quand `costAmount >= budgetAmount`. 0 secret dans la source.
