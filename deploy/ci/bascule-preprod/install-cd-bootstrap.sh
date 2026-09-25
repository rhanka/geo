#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Install one-time — bascule prod geo, CD-native. OPS-3 : rejouable + auditable.
# CLONE geo de radar-immobilier:deploy/ci/bascule-preprod/install-cd-bootstrap.sh
# (branche feat/install-cd-bootstrap-runbook, 3676f290). Exécuté UNE fois par la lane
# k8s (cluster-admin), owner-direct : cet acte est CE SCRIPT COMMITTÉ (la trace = le code).
# 0 python. Les VALEURS (tokens) ne sont JAMAIS committées : mintées in-cluster puis
# posées en GH secrets (jamais imprimées sur stdout).
#
# ÉCART geo (arbitrage i-cond) : le 1er bundle est appliqué OWNER-DIRECT par ce script
# (étape 3, mêmes pas que bascule-bundle-cd.yml, gate anti-RCE compris) — le workflow
# n'est pas encore sur main, donc pas de `gh workflow run`. Ensuite bascule-bundle-cd.yml
# ré-applique au merge (CD-native), armé à l'étape 5.
#
# 3 kubeconfigs GH dédiés (iso immo) :
#   KUBE_CONFIG_DATA_PROD             ← SA geo-ci-bascule-prod    (ns geo)         apply du bundle
#   KUBE_CONFIG_DATA_BASCULE_PREPROD  ← SA geo-ci-bascule-preprod (ns geo-preprod) pilotage du run
#   KUBE_CONFIG_DATA_PROD_TRIGGER     ← SA geo-ci-trigger-prod    (ns geo)         trigger dump (VAP)
#
# Mécanisme token = LEGACY SA token secret (kubernetes.io/service-account-token,
#   NON-expirant), identique aux déployeurs existants (0 rotation de token).
#   ⚠ ns geo : ResourceQuota `secrets: 10` — ce script y crée 2 secrets token
#   (geo-ci-bascule-prod-token, geo-ci-trigger-prod-token) + le bundle 2 SealedSecrets
#   (geo-db-ro-prod, geo-pra-writer-prod) = +4 secrets.
#
# Pré-requis : KUBECONFIG=<admin> exporté ; `gh` authentifié (repo+workflow) ;
#   geo-db-ro-prod-sealed.yaml + geo-pra-writer-prod-sealed.yaml SCELLÉS et committés ;
#   EXPECTED_DATABASE (nom littéral de la DB prod geo) renseigné dans cronjob-db-backup-prod.yaml ;
#   netpol-geo-db-backup.k8s-apply.yaml appliquée (ingress postgis, default-deny ns geo) ;
#   secrets préprod geo-backups-reader-preprod + geo-normalized-reader-preprod mintés (run) ;
#   à lancer depuis la racine d'un checkout contenant deploy/ci/bascule-preprod.
# Idempotent : apply / `gh secret set` / `gh variable set` écrasent ; delete = --ignore-not-found.
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

echo "== 0) garde : bundle prêt (SealedSecrets scellées, aucune valeur REPLACE_WITH_) =="
for f in geo-db-ro-prod-sealed.yaml geo-pra-writer-prod-sealed.yaml; do
  grep -Eq '^kind: SealedSecret' "$BUNDLE/$f" \
    || { echo "FATAL: $BUNDLE/$f est encore le placeholder commenté (à sceller + committer). Rien appliqué." >&2; exit 1; }
done
for f in geo-db-ro-prod-sealed.yaml geo-pra-writer-prod-sealed.yaml cronjob-db-backup-prod.yaml db-ro-role-provision.yaml; do
  if grep -Ev '^[[:space:]]*#' "$BUNDLE/$f" | grep -q 'REPLACE_WITH_'; then
    echo "FATAL: $BUNDLE/$f contient encore une valeur REPLACE_WITH_ (ex. EXPECTED_DATABASE fourni par k8s). Rien appliqué." >&2; exit 1
  fi
done

echo "== 1) apply RBAC des SA dédiées : geo-ci-bascule-prod (ns geo, VAP ClusterRole + impersonate) + geo-ci-bascule-preprod (ns geo-preprod) =="
kubectl apply -f "$BUNDLE/rbac-ci-bascule-prod.yaml"
kubectl apply -f "$BUNDLE/rbac-ci-bascule-preprod.yaml"

echo "== 2) mint legacy tokens -> GH secrets KUBE_CONFIG_DATA_PROD + KUBE_CONFIG_DATA_BASCULE_PREPROD (valeurs non imprimées) =="
mint_kubeconfig_b64 "$NS" geo-ci-bascule-prod | gh secret set KUBE_CONFIG_DATA_PROD --repo "$REPO"
mint_kubeconfig_b64 "$NS_PREPROD" geo-ci-bascule-preprod | gh secret set KUBE_CONFIG_DATA_BASCULE_PREPROD --repo "$REPO"

echo "== 3) 1er apply du bundle OWNER-DIRECT (mêmes pas que bascule-bundle-cd.yml, gate anti-RCE inclus) =="
kubectl -n "$NS" get deploy geo-api -o name
kubectl -n "$NS" apply -f "$BUNDLE/geo-db-ro-prod-sealed.yaml"
kubectl -n "$NS" apply -f "$BUNDLE/geo-pra-writer-prod-sealed.yaml"
for ss in geo-db-ro-prod geo-pra-writer-prod; do
  for i in $(seq 1 24); do
    s="$(kubectl -n "$NS" get sealedsecret "$ss" -o 'jsonpath={.status.conditions[?(@.type=="Synced")].status}' 2>/dev/null || true)"
    [ "$s" = "True" ] && { echo "   SealedSecret ${ss}: Synced=True"; break; }
    [ "$i" -eq 24 ] && echo "   WARN: ${ss} Synced non confirmé (le Job RO ci-dessous est le garde fail-closed)" >&2
    sleep 5
  done
done
kubectl -n "$NS" delete job geo-db-ro-role-provision --ignore-not-found
kubectl -n "$NS" apply -f "$BUNDLE/db-ro-role-provision.yaml"
kubectl -n "$NS" wait --for=condition=complete job/geo-db-ro-role-provision --timeout=300s
kubectl -n "$NS" apply -f "$BUNDLE/cronjob-db-backup-prod.yaml"
[ "$(kubectl -n "$NS" get cronjob geo-db-backup-prod -o jsonpath='{.spec.suspend}')" = "true" ] \
  || { echo "FATAL: geo-db-backup-prod non dormant (spec.suspend != true)" >&2; exit 1; }
kubectl apply -f "$BUNDLE/vap-ci-trigger-suspend-only.yaml"
kubectl -n "$NS" apply -f "$BUNDLE/rbac-ci-trigger-prod.yaml"
sleep "${VAP_PROPAGATION_SEC:-20}"
SA="system:serviceaccount:${NS}:geo-ci-trigger-prod"
neutralize() { kubectl -n "$NS" patch role geo-ci-trigger-prod --type=merge -p '{"rules":[]}' || true; }
set +e
out_a="$(kubectl --as="$SA" -n "$NS" patch cronjob geo-db-backup-prod --type=merge --dry-run=server \
  -p '{"spec":{"jobTemplate":{"spec":{"template":{"spec":{"containers":[{"name":"upload","image":"evil"}]}}}}}}' 2>&1)"; rc_a=$?
out_b="$(kubectl --as="$SA" -n "$NS" patch cronjob geo-db-backup-prod --type=merge --dry-run=server \
  -p '{"spec":{"suspend":false}}' 2>&1)"; rc_b=$?
set -e
echo "   (A) jobTemplate mutation rc=${rc_a} : ${out_a}"
echo "   (B) suspend flip        rc=${rc_b} : ${out_b}"
if [ "$rc_a" -eq 0 ] || ! printf '%s' "$out_a" | grep -qi 'geo-ci-trigger-suspend-only\|jobTemplate' || [ "$rc_b" -ne 0 ]; then
  echo "FATAL: gate anti-RCE ÉCHOUÉ — Role T1 neutralisé (rules: []). NE PAS minter KUBE_CONFIG_DATA_PROD_TRIGGER." >&2
  neutralize; exit 1
fi
echo "   gate anti-RCE OK — (A) DENIED par la VAP, (B) ALLOWED."

echo "== 4) le bundle a créé la SA trigger : mint legacy token geo-ci-trigger-prod -> KUBE_CONFIG_DATA_PROD_TRIGGER =="
mint_kubeconfig_b64 "$NS" geo-ci-trigger-prod | gh secret set KUBE_CONFIG_DATA_PROD_TRIGGER --repo "$REPO"

echo "== 5) arm apply-au-merge (bascule-bundle-cd.yml, effectif une fois le workflow sur main) =="
gh variable set BASCULE_BUNDLE_CD_ENABLED --repo "$REPO" --body true

echo "== 6) arm run planifié (03:17 UTC, bascule-preprod.yml) =="
gh variable set BASCULE_SCHEDULE_ENABLED --repo "$REPO" --body true

# (7) cleanup dormants immo (radar-ci-setup-prod, radar-intratenant-executor, secrets GH superseded) : N-A côté geo
#     (aucun bootstrap v1 n'a existé pour geo).
echo "== install one-time TERMINÉE — bundle appliqué, 3 kubeconfigs posés, CD-native armé. =="
