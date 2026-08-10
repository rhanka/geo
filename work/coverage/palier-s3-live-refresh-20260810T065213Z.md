# Palier 20×167 — rescan S3 après Lejeune — 2026-08-10T06:52:13Z

Le Job `geo-capture-zones-20260810t064957z` est terminé. Le run S3
`zones-20260810T064957Z-0-84e2f4f0-e35d-4316-af82-152c2edf92a0` prouve
Lejeune : HTTP 200, 7 879 248 octets,
`sha256:48d3d00d5e640dce7849e85a7eb1efb3984c15c9152bc2220c3380dec69a3f39`.
La relecture E2E depuis S3 confirme le manifeste, `run.json`, le log, le CAS,
son sidecar et la preuve v2. La tentative `robots.txt` HTTP 403 est conservée
séparément, sans octets ni preuve dérivable.

La réconciliation S3 fraîche (`generatedAt=2026-08-10T06:51:52.913Z`) et la
matrice lot→zone 1 106 villes ont été régénérées avec
`NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10`.
`palier-matrix-report.mjs --date=20260810 --check` réussit : 1 648/3 284
résolus (50,1827 %), col. 3 107/163, col. 5 89/163, col. 12 24/163 et
col. 13 4/163 complets. Ces valeurs sont identiques à la passe précédente.

Le CAS Lejeune est bien déposé sur S3, mais il n'est pas à lui seul une zone
normalisée ni une ville pliée : cette passe ne lui attribue donc aucun crédit
Palier.
