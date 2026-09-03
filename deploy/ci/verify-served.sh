#!/usr/bin/env bash
# Post-apply verification for the geo-jobs CI. Called AFTER the Job reaches condition=complete
# (the wait step already gated on that). Asserts the SERVED output is actually reachable, per job.
# Starting point: cptaq-serve → OGC /collections includes the ca-qc-constraints collections (needs
# PREPROD_OGC_URL = the preprod geo-api ingress). Extend per job (reindex/projections/3D-tiles) as
# they land. Fail-loud on a CONFIGURED check that fails; skip-with-note if the endpoint is not wired.
set -euo pipefail
JOB="${1:?usage: verify-served.sh <job>}"
echo "=== verify-served: ${JOB} ==="
case "$JOB" in
  cptaq-serve)
    if [ -z "${PREPROD_OGC_URL:-}" ]; then
      echo "  PREPROD_OGC_URL non défini — vérif OGC /collections sautée (le Job a déjà atteint condition=complete)."
      echo "  TODO: fournir PREPROD_OGC_URL (ingress geo-api preprod) pour asserter ca-qc-constraints servi."
      exit 0
    fi
    body=$(curl -fsS "${PREPROD_OGC_URL%/}/collections") || { echo "❌ /collections injoignable"; exit 1; }
    if printf '%s' "$body" | grep -q "ca-qc-constraints"; then
      echo "✅ ca-qc-constraints présent dans /collections."
    else
      echo "❌ ca-qc-constraints ABSENT de /collections — serve non vérifié."
      exit 1
    fi
    ;;
  *)
    echo "  pas de vérif dédiée pour '${JOB}' — le Job a atteint condition=complete (wait). Ajouter une vérif servie."
    ;;
esac
