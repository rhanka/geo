#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Install one-time — bascule prod geo, CD-native. OPS-3 : rejouable + auditable.
# CLONE geo de radar-immobilier:deploy/ci/bascule-preprod/install-cd-bootstrap.sh
# (branche feat/install-cd-bootstrap-runbook, 3676f290). Exécuté UNE fois par la lane
# k8s (cluster-admin) : cet acte est CE SCRIPT COMMITTÉ (la trace = le code), pas un ad-hoc.
# 0 python. Les VALEURS (tokens) ne sont JAMAIS committées : mintées in-cluster puis
# posées en GH secrets (jamais imprimées sur stdout).
#
# Iso immo : le bundle prod (SealedSecrets geo-pra-writer-prod + geo-db-ro-prod, Job
# db-ro-role-provision, CronJob geo-db-backup-prod dormant, VAP, RBAC T1, gate anti-RCE)
# est appliqué par le CD bascule-bundle-cd.yml (SA geo-ci-bascule-prod), DISPATCHÉ par
# l'étape 4 → à lancer APRÈS le merge sur main (workflow_dispatch exige le fichier sur main).
# Les NetworkPolicies ne font PAS partie du bundle : netpol-geo-db-backup.k8s-apply.yaml est
# appliquée par k8s (délégation) AVANT l'étape 4 (sinon le Job RO échoue : ns geo default-deny).
#
# 3 kubeconfigs GH dédiés (iso immo), posés en secrets d'ENVIRONMENT (`gh secret set … --env`) :
#   KUBE_CONFIG_DATA_PROD             ← SA geo-ci-bascule-prod    (ns geo)         apply du bundle    → coffre geo-prod-bundle
#   KUBE_CONFIG_DATA_BASCULE_PREPROD  ← SA geo-ci-bascule-preprod (ns geo-preprod) pilotage du run    → coffre geo-bascule
#   KUBE_CONFIG_DATA_PROD_TRIGGER     ← SA geo-ci-trigger-prod    (ns geo)         trigger dump (VAP) → coffre geo-bascule
#
# COFFRES « main seul » : les Environments geo-bascule / geo-prod-bundle (et geo-preprod-cd
#   pour KUBE_CONFIG_DATA_PREPROD, hors bascule) n'ont AUCUN reviewer et une deployment
#   branch policy = main SEULE → ces kubeconfigs ne sont lisibles QUE par un job lancé depuis
#   main. Jobs rattachés : bascule-preprod.yml pg + s3 (geo-bascule), bascule-bundle-cd.yml
#   apply-bundle (geo-prod-bundle). La gate owner de bascule-bundle-cd reste le job `approve`
#   (Environment geo-prod). Les secrets de DÉPÔT homonymes sont RETIRÉS (après vérification
#   d'un run vert depuis les coffres) : `gh secret delete <NOM> --repo rhanka/geo` ; ne JAMAIS
#   re-poser un de ces kubeconfigs au niveau dépôt (il redeviendrait lisible depuis toute branche).
#
# Mécanisme token = LEGACY SA token secret (kubernetes.io/service-account-token,
#   NON-expirant), identique aux déployeurs existants (0 rotation de token).
#   ⚠ ns geo : ResourceQuota `secrets: 10` — ce script y crée 2 secrets token
#   (geo-ci-bascule-prod-token, geo-ci-trigger-prod-token) + le bundle 2 SealedSecrets
#   (geo-db-ro-prod, geo-pra-writer-prod) = +4 secrets.
#
# Pré-requis : KUBECONFIG=<admin> exporté ; `gh` authentifié (repo+workflow) ;
#   bundle mergé sur main, SealedSecrets geo-db-ro-prod-sealed.yaml + geo-pra-writer-prod-sealed.yaml
#   committées (geo-cond) ; netpol-geo-db-backup.k8s-apply.yaml appliquée (k8s) ;
#   secrets préprod geo-backups-reader-preprod + geo-normalized-reader-preprod déposés (run).
# Pré-requis coffres : Environments geo-bascule + geo-prod-bundle créés (0 reviewer, branche = main).
# Idempotent : apply / `gh secret set --env` / `gh variable set` écrasent ; delete = --ignore-not-found.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
: "${KUBECONFIG:?export KUBECONFIG=<admin kubeconfig> requis}"
REPO=rhanka/geo
NS=geo
NS_PREPROD=geo-preprod
BUNDLE=deploy/ci/bascule-preprod
SERVER="$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}')"

# Minte un legacy SA token secret pour la SA $2 (ns $1), construit le kubeconfig et
# l'imprime en base64 sur STDOUT (à piper dans `gh secret set` — jamais affiché).
mint_kubeconfig_b64() {
  local ns="$1" sa="$2" sec="${2}-token"
  kubectl -n "$ns" apply -f - >&2 <<YAML
apiVersion: v1
kind: Secret
metadata: { name: ${sec}, namespace: ${ns}, annotations: { kubernetes.io/service-account.name: ${sa} } }
type: kubernetes.io/service-account-token
YAML
  local i tok=""
  for i in $(seq 1 30); do
    tok="$(kubectl -n "$ns" get secret "$sec" -o jsonpath='{.data.token}' 2>/dev/null || true)"
    [ -n "$tok" ] && break; sleep 2
  done
  [ -n "$tok" ] || { echo "FATAL: token ${sec} non peuplé" >&2; return 1; }
  local ca; ca="$(kubectl -n "$ns" get secret "$sec" -o jsonpath='{.data.ca\.crt}')"
  printf 'apiVersion: v1\nkind: Config\nclusters:\n- name: ovh\n  cluster: { server: %s, certificate-authority-data: %s }\ncontexts:\n- name: c\n  context: { cluster: ovh, user: u, namespace: %s }\ncurrent-context: c\nusers:\n- name: u\n  user: { token: %s }\n' \
    "$SERVER" "$ca" "$ns" "$(printf %s "$tok" | base64 -d)" | base64 -w0
}

echo "== 0) garde : SealedSecrets committées + netpol postgis appliquée (délégation k8s) =="
for f in geo-db-ro-prod-sealed.yaml geo-pra-writer-prod-sealed.yaml; do
  grep -Eq '^kind: SealedSecret' "$BUNDLE/$f" 2>/dev/null \
    || { echo "FATAL: $BUNDLE/$f absent ou non scellé (SealedSecret committée par geo-cond)." >&2; exit 1; }
done
kubectl -n "$NS" get networkpolicy allow-geo-db-backup-to-postgis -o name \
  || { echo "FATAL: netpol allow-geo-db-backup-to-postgis absente (appliquer $BUNDLE/netpol-geo-db-backup.k8s-apply.yaml)." >&2; exit 1; }

echo "== 1) apply RBAC des SA dédiées : geo-ci-bascule-prod (ns geo, VAP ClusterRole + impersonate) + geo-ci-bascule-preprod (ns geo-preprod) =="
kubectl apply -f "$BUNDLE/rbac-ci-bascule-prod.yaml"
kubectl apply -f "$BUNDLE/rbac-ci-bascule-preprod.yaml"

echo "== 2) mint legacy tokens -> GH env secrets KUBE_CONFIG_DATA_PROD (geo-prod-bundle) + KUBE_CONFIG_DATA_BASCULE_PREPROD (geo-bascule) (valeurs non imprimées) =="
mint_kubeconfig_b64 "$NS" geo-ci-bascule-prod | gh secret set KUBE_CONFIG_DATA_PROD --repo "$REPO" --env geo-prod-bundle
mint_kubeconfig_b64 "$NS_PREPROD" geo-ci-bascule-preprod | gh secret set KUBE_CONFIG_DATA_BASCULE_PREPROD --repo "$REPO" --env geo-bascule

echo "== 3) arm apply-au-merge =="
gh variable set BASCULE_BUNDLE_CD_ENABLED --repo "$REPO" --body true

echo "== 4) dispatch bascule-bundle-cd (applique le bundle en prod) + attente (gate anti-RCE inclus) =="
# Un dispatch de bascule-bundle-cd attend l'approbation owner (job `approve`, Environment
# geo-prod) : le `gh run watch` ci-dessous reste en attente tant que l'owner n'a pas approuvé.
gh workflow run bascule-bundle-cd.yml --repo "$REPO"
sleep 6
RID="$(gh run list --repo "$REPO" --workflow bascule-bundle-cd.yml -L1 --json databaseId --jq '.[0].databaseId')"
echo "   run id=$RID"
gh run watch "$RID" --repo "$REPO" --exit-status   # échoue (set -e) si l'apply/gate échoue

echo "== 5) le bundle a créé la SA trigger : mint legacy token geo-ci-trigger-prod -> KUBE_CONFIG_DATA_PROD_TRIGGER (env geo-bascule) =="
mint_kubeconfig_b64 "$NS" geo-ci-trigger-prod | gh secret set KUBE_CONFIG_DATA_PROD_TRIGGER --repo "$REPO" --env geo-bascule

echo "== 6) arm run planifié (03:17 UTC) =="
gh variable set BASCULE_SCHEDULE_ENABLED --repo "$REPO" --body true

# (7) cleanup dormants immo (radar-ci-setup-prod, radar-intratenant-executor, GH secrets superseded) :
#     N-A côté geo (aucun bootstrap v1 n'a existé pour geo).
echo "== install one-time TERMINÉE — CD-native armé (apply-au-merge + run planifié). =="
