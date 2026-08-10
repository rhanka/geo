# Palier 20×167 — rescan S3 après Marston — 2026-08-10T07:09:56Z

Le Job `geo-capture-zones-20260810t070854z` est terminé (1/1). Le run S3
`zones-20260810T070854Z-0-78ba2372-f2f4-42a6-ab04-dfc83f9d3b7f` prouve Marston
: HTTP 200, 8 245 960 octets,
`sha256:b32fb0f4cb8e84e72548534daf1d59a632ff0dc6c97869e7bab866aa3cd4c226`.
La relecture E2E depuis S3 vérifie manifeste, `run.json`, log, CAS, sidecar et
preuve v2. La tentative `robots.txt` HTTP 403 est isolée, sans octets ni
preuve dérivable.

La réconciliation S3 fraîche (`generatedAt=2026-08-10T07:09:33.975Z`) et la
matrice lot→zone 1 106 villes ont été régénérées avec
`NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10`.
`palier-matrix-report.mjs --date=20260810 --check` réussit : 1 650/3 284
résolus (50,2436 %), col. 3 107/163, col. 5 91/163, col. 12 24/163 et
col. 13 4/163 complets. Les cellules sont inchangées par rapport à la passe
précédente.

Le CAS Marston est déposé sur S3 mais n'est pas encore une zone normalisée ni
une ville pliée : aucune cellule Palier ne lui est créditée.
