# Palier 20×167 — rescan S3 après merge règlement Mercier — 2026-08-10T07:03:52Z

`main` a intégré le règlement Mercier par le merge `12051011`. La
réconciliation S3 fraîche (`generatedAt=2026-08-10T07:03:30.514Z`) et la
matrice lot→zone 1 106 villes ont été régénérées avec
`NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10`.
`palier-matrix-report.mjs --date=20260810 --check` réussit : 1 650/3 284
résolus (50,2436 %), soit +1. La variation vérifiée est Mercier, col. 5
`incomplete` → `complete` (90 → 91/163). Col. 3 reste 107/163, col. 12
24/163 et col. 13 4/163 complets.

Cette promotion vient exclusivement de l'artefact règlement Mercier mergé.
Les reçus bruts de zones précédemment consignés restent sans crédit Palier tant
qu'ils ne sont pas déposés comme zones normalisées et pliées.
