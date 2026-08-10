# Palier 20×167 — rescan S3 après Les Hauteurs — 2026-08-10T06:57:30Z

Le Job `geo-capture-zones-20260810t065605z` est terminé (1/1). Le run S3
`zones-20260810T065605Z-0-5c1806c9-d98c-4149-86df-783ebf09ec41` prouve Les
Hauteurs : HTTP 200, 1 175 772 octets,
`sha256:8b46601a19f673c80c5c5ed09a62651e90246c153d6061bb5e9414c5b9323b60`.
La relecture E2E depuis S3 vérifie manifeste, `run.json`, log, CAS, sidecar et
preuve v2. La tentative `robots.txt` HTTP 403 reste une ligne distincte sans
octets ni preuve dérivable.

La réconciliation S3 fraîche (`generatedAt=2026-08-10T06:57:04.013Z`) et la
matrice lot→zone 1 106 villes ont été régénérées avec
`NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10`.
`palier-matrix-report.mjs --date=20260810 --check` réussit : 1 649/3 284
résolus (50,2132 %), col. 3 107/163, col. 5 90/163, col. 12 24/163 et
col. 13 4/163 complets. Toutes ces valeurs sont identiques à la passe
précédente.

Le CAS Les Hauteurs est déposé sur S3, mais il ne constitue pas encore une zone
normalisée ni une ville pliée : aucune cellule Palier ne lui est créditée.
