#!/usr/bin/env bash
# cd-prod setup — PART OWNER (une seule commande, GitHub-admin). Pose le GATE du deploy prod :
# l'Environment GitHub `geo-prod` AVEC required-reviewer=owner. Après ça, TOUS les deploys prod = un
# GO owner (dispatch cd-prod + approuver l'environment), plus jamais de kubeconfig manuel.
#
# ⚠ SPLIT (comme le bootstrap §5) : le cluster prod = hlhedx (OVH), et l'owner N'A PAS de kubectl OVH.
# Donc ce wrapper pose UNIQUEMENT la part GitHub (Environment). La part `KUBE_CONFIG_DATA` (kubeconfig
# SA ns geo, env-scopé) = hand-off poc-k8s (docs/ops/cd-prod/cd-prod-kubeconfig.sh, exécuté sur OVH) —
# jamais capturée ici. Les deux sont ONE-TIME ; ensuite tout deploy = GO.
#
# Idempotent + self-verify + fail-loud. Variables : GH_REPO (défaut rhanka/geo), SECRET_ENV (défaut
# geo-prod), EXPECT_OWNER (défaut rhanka).
set -euo pipefail
GH_REPO="${GH_REPO:-rhanka/geo}"
SECRET_ENV="${SECRET_ENV:-geo-prod}"
EXPECT_OWNER="${EXPECT_OWNER:-rhanka}"

command -v gh >/dev/null || { echo "❌ gh CLI absent"; exit 1; }
gh auth status >/dev/null 2>&1 \
  || { echo "❌ gh non authentifié. Lance d'abord (UNE fois, ton login github-admin) : gh auth login"; exit 1; }

# Assert que le login gh EST l'owner attendu (le wrapper POSE le gate — ne pas viser la mauvaise personne).
AUTHED_LOGIN="$(gh api user --jq '.login')"
[ "$AUTHED_LOGIN" = "$EXPECT_OWNER" ] \
  || { echo "❌ gh authentifié comme '${AUTHED_LOGIN}', attendu '${EXPECT_OWNER}' — refus (le reviewer pointerait la mauvaise personne)"; exit 1; }
OWNER_ID="$(gh api user --jq '.id')"

# ── Environment geo-prod : required-reviewer=owner (LE GATE du deploy prod). ──
gh api --method PUT "repos/${GH_REPO}/environments/${SECRET_ENV}" --input - >/dev/null <<EOF
{"reviewers":[{"type":"User","id":${OWNER_ID}}]}
EOF

# ── Self-verify (fail-loud) : le GATE lui-même est en place. ──
gh api "repos/${GH_REPO}/environments/${SECRET_ENV}" --jq '.protection_rules[].reviewers[].reviewer.id' | grep -qx "$OWNER_ID" \
  || { echo "❌ required-reviewer=owner ABSENT sur l'Environment ${SECRET_ENV} — le GATE n'est pas en place"; exit 1; }

echo "✅ Environment ${SECRET_ENV} : required-reviewer=owner (gate du deploy prod) — posé + re-lu + confirmé."
echo ""
echo "   RESTE (hand-off poc-k8s, OVH — one-time, l'owner n'a pas d'accès OVH) :"
echo "   • poc-k8s exécute docs/ops/cd-prod/cd-prod-kubeconfig.sh → pose le secret KUBE_CONFIG_DATA"
echo "     (kubeconfig SA least-priv ns geo, hlhedx) ENV-scopé à ${SECRET_ENV} (derrière ce reviewer)."
echo "   Après ces 2 (Environment + KUBE_CONFIG_DATA) : tout deploy prod = un GO owner"
echo "   (Actions → CD Prod → Run workflow avec le digest → approuver l'environment ${SECRET_ENV})."
