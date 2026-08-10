# Palier — rescan S3 courant après #110 — 2026-08-10T04:37:43Z

## Chaîne fraîche

Après le merge de #110 dans cette branche, cette passe a exécuté, dans cet
ordre, `coverage-reconcile.ts`,
`immo-lot-zone-assignment-matrix.ts --date 20260810 --max-seconds 600`, puis
`palier-matrix-report.mjs --date=20260810` et son contrôle `--check`, tous avec
`NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10`.

Le rescan S3 s'est terminé à `2026-08-10T04:37:17.215Z` :
`pv=1064`, `normes=818`, `zones=911`, `cadastre=1106`,
`role-foncier=1106`, `tod=39`, tous sans delta depuis la passe de 04:34Z. La
matrice a été produite à `2026-08-10T04:37:43.531Z` et le check a conclu
`CHECK OK`.

## Mesure vérifiée

- Résolu total : `1642/3284 = 50.0%` (inchangé).
- Colonne 5 : `83/163` complete (inchangé).
- Colonne 12 (assignation lot-zone) : `24/163` complete (inchangé).
- Colonne 13 (normes pliées) : `4/163` complete (inchangé).

Les configurations de découverte mergées par #110 ne constituent pas, à elles
seules, une nouvelle capture normalisée sur S3 consommée par les autorités
Palier. Elles n'ont donc complété aucune ville dans cette mesure.
