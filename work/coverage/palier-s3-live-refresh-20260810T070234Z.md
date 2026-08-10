# Palier 20×167 — rescan S3 après Manseau — 2026-08-10T07:02:34Z

Le Job `geo-capture-zones-20260810t070133z` est terminé (1/1). Le run S3
`zones-20260810T070133Z-0-aa93a2d6-1dd6-4965-a14b-1d580f4e4f0b` prouve
Manseau : HTTP 200, 145 316 octets,
`sha256:354f7671341d50e2209c5be1e6ce1955ed65115ab38efe292a676fbd19df43fd`.
La relecture E2E depuis S3 vérifie manifeste, `run.json`, log, CAS, sidecar et
preuve v2. La tentative `robots.txt` HTTP 404 est isolée, sans octets ni
preuve dérivable.

La réconciliation S3 fraîche (`generatedAt=2026-08-10T07:02:11.441Z`) et la
matrice lot→zone 1 106 villes ont été régénérées avec
`NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10`.
`palier-matrix-report.mjs --date=20260810 --check` réussit : 1 649/3 284
résolus (50,2132 %), col. 3 107/163, col. 5 90/163, col. 12 24/163 et
col. 13 4/163 complets. Les cellules sont inchangées par rapport à la passe
précédente.

Le CAS Manseau est déposé sur S3 mais n'est pas encore une zone normalisée ni
une ville pliée : aucune cellule Palier ne lui est créditée.
