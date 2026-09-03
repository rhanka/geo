#!/usr/bin/env bash
# Phase 52 / runbook — BOOTSTRAP de l'exécuteur geo autonome (least-priv, project-scope).
#
# ⚠⚠ À LANCER PAR L'OWNER (seul détenteur iam-admin), UNE FOIS. Ce script ne s'exécute JAMAIS
# automatiquement, n'est JAMAIS lancé par une SA ni une CI, et n'est PAS exécuté par geo-socle
# (authoring only — committé pour être reviewable + rejouable). Il PROVISIONNE l'identité least-priv
# qui exécutera les ops quota (et, en option gatée, la création de clé) de geo en autonomie, par
# IMPERSONATION — AUCUNE clé SA téléchargée.
#
# Design mesuré (i-infra): SA dédiée + 2 custom roles SÉPARÉS project-scope (radar-3dtiles-preprod
# SEUL, JAMAIS billing-account-wide) + tokenCreator sur la SA pour l'identité de base (boundary DUR :
# la base ne peut QU'impersoner l'exécuteur least-priv, 0 permission GCP directe). Idempotent
# (create-or-update convergent = state=script) + self-verifying + fail-loud.
#
# AUTH END-TO-END keyless (design i-infra) — comment l'exécuteur s'authentifie SANS clé téléchargée :
#   Chemin prêt = GitHub Actions + Workload Identity Federation (WIF). Le workflow §5 (permissions
#   id-token:write) émet un OIDC token GitHub → google-github-actions/auth@v2 l'échange au WIF provider
#   → le principalSet WIF (principalSet://iam.googleapis.com/projects/<PROJECT_NUMBER>/locations/global/
#   workloadIdentityPools/<POOL>/attribute.repository/rhanka/geo), doté de tokenCreator sur geo-cap-executor
#   par CE script → token COURT-VÉCU impersonant geo-cap-executor (least-priv) → ops quota (+ clé si opt-in).
#   AUCUNE clé SA téléchargée ; token éphémère scopé au workflow. ⟹ BASE_IDENTITY = CE principalSet WIF
#   (PAS le geo-ci-runner k8s de #327 = un ServiceAccount KUBERNETES, PAS une identité GCP, ne s'auth pas
#   aux API GCP). PRÉREQUIS owner-bootstrap (EN PLUS de ce script) : créer le WIF Pool + Provider (trust
#   assertion.repository=='rhanka/geo' + condition environment protégé) — companion owner-run. ⚠ Le nom du
#   WIF provider (comme BASE_IDENTITY) CONTIENT le PROJECT_NUMBER → GitHub Variable/Secret, JAMAIS committé
#   (${vars.WIF_PROVIDER}, ${vars.CAP_EXECUTOR_SA}). [Alternative non-adoptée : exécuteur in-cluster OVH
#   MKS via OIDC→WIF ; le chemin actuel = GitHub Actions + WIF.]
#
# Variables :
#   PROJECT_ID       (env.sh)
#   BASE_IDENTITY    le principalSet WIF (cf AUTH ci-dessus) qui impersonera l'exécuteur, tokenCreator
#                    -ONLY sur la SA. VAR RUNTIME — contient le PROJECT_NUMBER (nom du pool WIF) → JAMAIS
#                    committée (l'owner met le principalSet réel à l'exécution), comme BILLING_ACCOUNT.
#                    REQUIS. Doit être minimal : le script grant le tokenCreator mais ne peut PAS enforcer
#                    que la base n'a rien d'autre — l'owner choisit une base minimale (le principalSet WIF
#                    scopé au repo l'est par construction).
#   GRANT_KEY_CREATION=yes  provisionne AUSSI le role de création de clé (plus gaté ; step distinct).
#                           Défaut = quota-executor SEUL (conservateur).
set -euo pipefail
source "$(dirname "$0")/env.sh"

: "${BASE_IDENTITY:?BASE_IDENTITY requis — le principalSet WIF tokenCreator-only (principalSet://.../attribute.repository/rhanka/geo). VAR RUNTIME, jamais committee (contient le PROJECT_NUMBER).}"
EXECUTOR_SA="geo-cap-executor@${PROJECT_ID}.iam.gserviceaccount.com"
ROLE_QUOTA="geoCapQuotaExecutor"
ROLE_KEY="geoCapKeyCreation"
QUOTA_PERMS="serviceusage.quotas.get,serviceusage.quotas.update"
KEY_PERMS="apikeys.keys.create,apikeys.keys.get,apikeys.keys.getKeyString,apikeys.keys.delete,apikeys.keys.list,serviceusage.services.enable,serviceusage.services.get"

echo "=== BOOTSTRAP exécuteur geo — projet ${PROJECT_ID} (owner/iam-admin, une fois) ==="

# create-or-update convergent d'un custom role project-scope (state=script : un role existant est
# réaligné EXACTEMENT au set — pas de drift).
upsert_role() {  # $1=role-id  $2=perms  $3=title
  if gcloud iam roles describe "$1" --project "$PROJECT_ID" >/dev/null 2>&1; then
    gcloud iam roles update "$1" --project "$PROJECT_ID" --permissions="$2" --stage=GA
  else
    gcloud iam roles create "$1" --project "$PROJECT_ID" --title="$3" --permissions="$2" --stage=GA
  fi
}

# 1. SA dédiée impersonation-only (AUCUNE clé téléchargée — la base impersone via tokenCreator).
gcloud iam service-accounts create geo-cap-executor --project "$PROJECT_ID" \
  --display-name="geo autonomous cap executor (impersonation-only, no key)" 2>/dev/null || true

# 2. Role QUOTA-executor (project-scope) + binding sur la SA exécuteur.
upsert_role "$ROLE_QUOTA" "$QUOTA_PERMS" "geo cap quota executor"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${EXECUTOR_SA}" --role="projects/${PROJECT_ID}/roles/${ROLE_QUOTA}" >/dev/null

# 3. tokenCreator sur la SA exécuteur pour l'identité de BASE — boundary DUR : la base = tokenCreator
#    -only (0 permission GCP directe), elle ne peut QU'impersoner l'exécuteur least-priv.
gcloud iam service-accounts add-iam-policy-binding "$EXECUTOR_SA" --project "$PROJECT_ID" \
  --member="${BASE_IDENTITY}" --role="roles/iam.serviceAccountTokenCreator" >/dev/null

# 4. ⚠ STEP DISTINCT + PLUS GATÉ — role de CRÉATION DE CLÉ (opt-in GRANT_KEY_CREATION=yes). Séparé du
#    quota-executor par design : la création de clé (billable) est plus sensible que le cap quota.
if [ "${GRANT_KEY_CREATION:-no}" = "yes" ]; then
  echo "  [key-creation] GRANT_KEY_CREATION=yes → provisionne le role clé (plus gaté)…"
  upsert_role "$ROLE_KEY" "$KEY_PERMS" "geo cap key creation"
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${EXECUTOR_SA}" --role="projects/${PROJECT_ID}/roles/${ROLE_KEY}" >/dev/null
else
  echo "  [key-creation] GRANT_KEY_CREATION!=yes → role clé NON provisionné (défaut conservateur, step distinct)."
fi

# 5. self-verify + fail-loud (l'idempotence + la vérif = 'merged implique deployable' côté ops).
echo "vérif…"
gcloud iam service-accounts describe "$EXECUTOR_SA" --project "$PROJECT_ID" >/dev/null \
  || { echo "❌ SA exécuteur absente"; exit 1; }
gcloud iam roles describe "$ROLE_QUOTA" --project "$PROJECT_ID" --format="value(includedPermissions)" \
  | grep -q "serviceusage.quotas.update" || { echo "❌ role quota-executor incomplet"; exit 1; }
gcloud iam service-accounts get-iam-policy "$EXECUTOR_SA" --project "$PROJECT_ID" --format=json \
  | grep -q "roles/iam.serviceAccountTokenCreator" || { echo "❌ tokenCreator absent sur la SA exécuteur"; exit 1; }
if [ "${GRANT_KEY_CREATION:-no}" = "yes" ]; then
  gcloud iam roles describe "$ROLE_KEY" --project "$PROJECT_ID" --format="value(includedPermissions)" \
    | grep -q "apikeys.keys.create" || { echo "❌ role clé incomplet"; exit 1; }
fi
echo "✅ exécuteur geo provisionné (least-priv, project-scope, impersonation-only)."
echo "   SA=${EXECUTOR_SA} ; base=${BASE_IDENTITY} (tokenCreator-only) ; role quota=${ROLE_QUOTA}$([ "${GRANT_KEY_CREATION:-no}" = "yes" ] && echo " + role clé=${ROLE_KEY}")."
echo "   0 clé SA téléchargée ; 0 grant billing-account-wide ; project-scope ${PROJECT_ID} SEUL."
