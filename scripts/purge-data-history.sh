#!/usr/bin/env bash
# purge-data-history.sh — retire de TOUT l'historique git les données dont la
# source de vérité est ailleurs et durable.
#
# POURQUOI. Mesure du 2026-07-25 sur la semaine écoulée (main, hors merges) :
# 755 644 lignes ajoutées, dont 734 253 sous `work/**` (97,2 %) et seulement
# 14 299 de code source (1,9 %). Un seul fichier — work/cadastre/saint-adelphe
# .geojson — pèse 268 394 lignes, et il est DÉJÀ servi depuis S3. Committer ces
# objets duplique la production dans le contrôle de version : le dépôt gonfle,
# les diffs deviennent illisibles et toute mesure d'activité devient fausse.
#
# CE QUI PART — la source de vérité est ailleurs, durable, ré-obtenable :
#   work/zones-recalage/**  38,8 Mio  couches qc-zonage servies (S3) + un bundle
#                                     JS aspiré de 14,7 Mio + visionneuses HTML
#   work/cadastre/**        11,0 Mio  extraits cadastre, re-téléchargeables (S3)
#   work/delegation-mass/**  3,2 Mio  scratch déclaré, DÉJÀ gitignoré (suivi par
#                                     accident — 361 fichiers)
#
# CE QUI RESTE, et pourquoi le script ne doit JAMAIS y toucher :
#   work/gcp/**, work/reads/**   2,4 Mio en 404 petits JSON. Points de calage et
#     lectures d'étiquettes par vision : du travail DISTILLÉ et COÛTEUX (appels
#     vision payants, géoréférencement), sans aucune source pérenne ailleurs. Le
#     fichier versionné EST la source.
#   work/coverage/**, work/immo-*, work/zonage-norms/**   entrées lues par du
#     code déterministe au CI (folds de provenance, générateur de rapport). Les
#     retirer rendrait le fold inexécutable sur un checkout propre — exactement
#     le défaut corrigé le 2026-07-25 (« un ENOENT en CI est un défaut de
#     capitalisation »).
#   packages/**   les fixtures de tests y vivent ; hors périmètre, intouchés.
#
# RÈGLE GÉNÉRALE, pour trancher un cas futur : on purge une donnée dont la
# source de vérité est AILLEURS et DURABLE. On garde une donnée qui EST la
# source — en particulier le fixture d'un test pérenne dont aucune source
# pérenne n'est identifiée pour le rejouer.
#
# MÉTHODE. Le travail se fait dans un CLONE MIROIR jeté après usage : le dépôt
# de travail (partagé, sale, avec des lanes actives) n'est jamais touché. Une
# branche de sauvegarde est poussée sur origin AVANT tout force-push, donc le
# retour arrière reste possible tant qu'elle existe.
#
# Usage :
#   scripts/purge-data-history.sh --dry-run   # mesure seule, n'écrit rien
#   scripts/purge-data-history.sh --apply     # réécrit et force-push
set -euo pipefail

REMOTE="${PURGE_REMOTE:-https://github.com/rhanka/geo.git}"
WORKDIR="${PURGE_WORKDIR:-${TMPDIR:-/tmp}/geo-purge-mirror}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_REF="backup/pre-data-purge-${STAMP}"

PURGE_PATHS=(
  "work/zones-recalage"
  "work/zonage-recalage"   # même nature que ci-dessus, nom voisin (piège de lecture)
  "work/cadastre"
  "work/delegation-mass"
)

# Chemins qui ne doivent JAMAIS figurer dans PURGE_PATHS. Le script s'arrête si
# l'un d'eux y apparaît : c'est le garde-fou contre une purge qui emporterait
# une source unique ou une entrée de CI.
PROTECTED=(
  "work/gcp"
  "work/reads"
  "work/coverage"
  "work/immo-audit"
  "work/immo-field-completion-matrices"
  "work/zonage-norms"
  "packages"
  "acquisition"
  "scripts"
  "docs"
)

MODE="${1:-}"
case "$MODE" in
  --dry-run|--apply) ;;
  *) echo "usage: $0 --dry-run | --apply" >&2; exit 2 ;;
esac

# ── Garde-fou : aucune intersection entre ce qu'on purge et ce qu'on protège ──
for p in "${PURGE_PATHS[@]}"; do
  for q in "${PROTECTED[@]}"; do
    case "$p" in
      "$q"|"$q"/*)
        echo "ABORT: '$p' est sous le chemin protégé '$q'." >&2
        echo "Ces données sont une source unique ou une entrée du CI." >&2
        exit 1 ;;
    esac
  done
done

echo "=== purge-data-history ($MODE) ==="
echo "remote : $REMOTE"
echo "miroir : $WORKDIR"
echo "purge  : ${PURGE_PATHS[*]}"
echo

rm -rf "$WORKDIR"
git clone --mirror "$REMOTE" "$WORKDIR"
cd "$WORKDIR"

size_before="$(git count-objects -vH | awk '/^size-pack:/ {print $2, $3}')"
commits_before="$(git rev-list --count --all)"
echo "AVANT : $commits_before commits, size-pack $size_before"

lines_before="$(git log --all --no-merges --numstat --format='' -- "${PURGE_PATHS[@]}" \
  | awk 'NF==3 && $1!="-" {t+=$1} END {print t+0}')"
echo "lignes portées par les chemins purgés : $lines_before"

if [ "$MODE" = "--dry-run" ]; then
  echo
  echo "DRY-RUN — rien réécrit, rien poussé. Miroir laissé dans $WORKDIR."
  echo "Relancer avec --apply pour réécrire ET force-pusher."
  exit 0
fi

# ── Sauvegarde distante AVANT toute réécriture ───────────────────────────────
main_sha="$(git rev-parse refs/heads/main)"
git push "$REMOTE" "${main_sha}:refs/heads/${BACKUP_REF}"
echo "SAUVEGARDE poussée : $BACKUP_REF -> $main_sha"

# ── Réécriture ───────────────────────────────────────────────────────────────
# --index-filter n'extrait aucun arbre de travail (rapide) ; --prune-empty fait
# DISPARAÎTRE les commits devenus vides, c.-à-d. ceux qui n'ajoutaient que de la
# donnée, au lieu de laisser des coquilles ; --tag-name-filter cat réécrit les
# tags pour qu'ils suivent les nouveaux SHA.
rm_args=()
for p in "${PURGE_PATHS[@]}"; do rm_args+=("$p"); done

FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch --force \
  --index-filter "git rm -r --cached --ignore-unmatch ${rm_args[*]}" \
  --prune-empty --tag-name-filter cat -- --all

# ── Compaction ───────────────────────────────────────────────────────────────
rm -rf refs/original
git reflog expire --expire=now --all
git gc --prune=now --aggressive

size_after="$(git count-objects -vH | awk '/^size-pack:/ {print $2, $3}')"
commits_after="$(git rev-list --count --all)"
echo
echo "APRÈS : $commits_after commits, size-pack $size_after"
echo "commits supprimés (devenus vides) : $((commits_before - commits_after))"

# ── Publication ──────────────────────────────────────────────────────────────
git push --force --all "$REMOTE"
git push --force --tags "$REMOTE"

echo
echo "=== TERMINÉ ==="
echo "Sauvegarde : $BACKUP_REF (à supprimer seulement après vérification)"
echo
echo "À FAIRE ENSUITE, dans le dépôt de travail :"
echo "  git fetch origin --prune"
echo "  git reset --mixed origin/<branche>"
echo
echo "  --mixed, PAS --hard. L'arbre partagé porte du travail non committé"
echo "  d'autres chantiers (48 fichiers modifiés au 2026-07-25) : --hard les"
echo "  détruirait. --mixed déplace HEAD et reconstruit l'index SANS toucher"
echo "  aux fichiers ; les modifications survivent en non-indexé, et les fichiers"
echo "  purgés redeviennent non suivis (ils restent sur le disque, désormais"
echo "  couverts par .gitignore)."
echo
echo "Les worktrees existants pointent tous sur des SHA morts : les réinitialiser."
echo
echo "LIMITE HONNÊTE : GitHub conserve les anciens objets via les refs de pull"
echo "request ; le repack côté serveur n'est pas garanti et les statistiques"
echo "distantes peuvent ne pas se recalculer. Le gain certain est local."
