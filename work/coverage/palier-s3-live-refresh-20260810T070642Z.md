# Palier 20×167 — rescan S3 après merge normes col. 14 — 2026-08-10T07:06:42Z

`main` a intégré la campagne normes col. 14 par le merge `d854493e`. La
réconciliation S3 fraîche (`generatedAt=2026-08-10T07:06:21.161Z`) et la
matrice lot→zone 1 106 villes ont été régénérées avec
`NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10`.
`palier-matrix-report.mjs --date=20260810 --check` réussit : 1 650/3 284
résolus (50,2436 %), col. 3 107/163, col. 5 91/163, col. 12 24/163 et
col. 13 4/163 complets. Toutes les cellules sont inchangées par rapport à la
passe précédente.

Les configurations/captures normes ajoutées ne sont pas encore une source de
normes pliées consommée par la matrice. Elles ne ferment donc aucune ville, et
notamment aucune ville col. 13.
