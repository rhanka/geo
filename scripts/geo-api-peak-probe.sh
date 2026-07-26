#!/usr/bin/env bash
# geo-api-peak-probe.sh — mesure le PIC memoire reel de geo-api sous requetes
# CONCURRENTES, pour dimensionner sa limite sans la deviner.
#
# Pourquoi concurrent et pas une seule requete : une mesure mono-requete donne un
# pic flatteur. La production, c'est plusieurs consommateurs (dont immo) qui
# tapent l'API en meme temps. Une limite calee sur le pic mono-requete ferait
# OOMKiller l'API servie au premier vrai trafic — et une panne d'API servie a un
# tiers coute plus cher que tout ce qu'on gagne en captures.
#
# Mesure de reference (2026-07-26, avant optimisation) :
#   repos 73 Mi · pendant 1 requete 141 Mi · apres 11,3 Mo rendus 194 Mi
#
# Lecture seule : n'ecrit rien, ne deploie rien. Echantillonne `kubectl top`
# entre les requetes plutot que d'occuper le shell dans une boucle d'attente.
#
# Usage : bash scripts/geo-api-peak-probe.sh [concurrence]
set -u
KUBECONFIG_PATH="${KUBECONFIG_PATH:-$HOME/.kube/poc.yaml}"
API="${GEO_API:-https://api.geo.sent-tech.ca}"
N="${1:-3}"

# Collections volumineuses connues : quebec sert 4785 polygones, saguenay 2836.
COLLECTIONS=(qc-zonage-quebec qc-zonage-saguenay qc-zonage-montreal)

sample() {
  printf '%-22s ' "$1"
  kubectl --kubeconfig "$KUBECONFIG_PATH" -n geo top pod 2>/dev/null \
    | awk '/^geo-api/ {print "geo-api " $3 "   postgis suit"} /^postgis/ {print "postgis " $3}' \
    | paste -sd' ' -
}

sample "avant"

pids=()
for i in $(seq 1 "$N"); do
  col="${COLLECTIONS[$(( (i - 1) % ${#COLLECTIONS[@]} ))]}"
  curl -sS --max-time 180 "$API/collections/$col/items?limit=5000" -o /dev/null \
    -w "  req$i $col HTTP %{http_code} %{size_download}o %{time_total}s\n" &
  pids+=("$!")
done

# Un echantillon pendant la charge, sans boucle d'attente : les requetes lourdes
# durent des dizaines de secondes, un seul point suffit a voir le pic monter.
sleep 12 2>/dev/null || true
sample "pendant"

for pid in "${pids[@]}"; do wait "$pid"; done

sample "apres"
