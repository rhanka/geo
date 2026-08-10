# Palier — rescan S3 courant après Drummondville — 2026-08-10T04:54:26Z

## Chaîne fraîche

Cette passe a exécuté, dans cet ordre, `coverage-reconcile.ts`,
`immo-lot-zone-assignment-matrix.ts --date 20260810 --max-seconds 600`, puis
`palier-matrix-report.mjs --date=20260810` et son contrôle `--check`, tous avec
`NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10`.

Le rescan S3 s'est terminé à `2026-08-10T04:54:04.643Z` :
`pv=1064`, `normes=818`, `zones=911`, `cadastre=1106`,
`role-foncier=1106`, `tod=39`, tous sans delta depuis la passe précédente. La
matrice a été produite à `2026-08-10T04:54:26.394Z` et le check a conclu
`CHECK OK`.

## Mesure vérifiée

- Résolu total : `1642/3284 = 50.0%` (inchangé).
- Colonne 5 : `83/163` complete (inchangé).
- Colonne 6 : `93/163` complete (inchangé).
- Colonne 12 (assignation lot-zone) : `24/163` complete (inchangé).
- Colonne 13 (normes pliées) : `4/163` complete (inchangé).

La capture Drummondville est bien déposée et prouvée sur S3, mais elle reste
brute ; faute d'objet normalisé consommé par les autorités Palier, elle ne
complète aucune ville et n'augmente donc pas le résolu.
