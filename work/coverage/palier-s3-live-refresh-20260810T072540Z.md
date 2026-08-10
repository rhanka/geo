# Palier 20×167 — rescan S3 après Matapédia — 2026-08-10T07:25:40Z

Le Job `geo-capture-zones-20260810t072444z` est terminé (1/1). Le run S3
`zones-20260810T072444Z-0-e1c0ed78-1b0e-4135-a25c-46b4825ac44b` prouve
Matapédia : HTTP 200, 7 058 octets,
`sha256:774e3ec49190e10bf7096634d034095dad1f4e12a366a9b64053d9625bf11683`.
La relecture E2E depuis S3 vérifie manifeste, `run.json`, log, CAS HTML,
sidecar et preuve v2. La tentative `robots.txt` HTTP 404 est isolée.

La réconciliation S3 fraîche (`generatedAt=2026-08-10T07:25:18.347Z`) et la
matrice lot→zone 1 106 villes sont régénérées avec les variables réseau
requises. `palier-matrix-report.mjs --date=20260810 --check` réussit :
1 652/3 284 résolus (50,3045 %), col. 3 107/163, col. 5 93/163, col. 12
24/163 et col. 13 4/163 complets, tous inchangés.

Le CAS HTML Matapédia est déposé sur S3 mais n'est pas une zone normalisée ni
une ville pliée : aucun crédit Palier ne lui est attribué.
