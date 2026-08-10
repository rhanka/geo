# Palier 20×167 — rescan S3 après Maricourt — 2026-08-10T07:08:23Z

Le Job `geo-capture-zones-20260810t070713z` est terminé (1/1). Le run S3
`zones-20260810T070713Z-0-12e3434b-e50b-481d-80c4-27614d0b8041` prouve
Maricourt : HTTP 200, 5 193 517 octets,
`sha256:7a0c5c212a7473c7203e96dafa3363760193f72056ae8cd7e9eae31117b28acd`.
La relecture E2E depuis S3 vérifie manifeste, `run.json`, log, CAS, sidecar et
preuve v2. La tentative `robots.txt` HTTP 403 est isolée, sans octets ni
preuve dérivable.

La réconciliation S3 fraîche (`generatedAt=2026-08-10T07:07:58.783Z`) et la
matrice lot→zone 1 106 villes ont été régénérées avec
`NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10`.
`palier-matrix-report.mjs --date=20260810 --check` réussit : 1 650/3 284
résolus (50,2436 %), col. 3 107/163, col. 5 91/163, col. 12 24/163 et
col. 13 4/163 complets. Les cellules sont inchangées par rapport à la passe
précédente.

Le CAS Maricourt est déposé sur S3 mais n'est pas encore une zone normalisée ni
une ville pliée : aucune cellule Palier ne lui est créditée.
