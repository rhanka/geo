# Palier 20×167 — rescan S3 après Lotbinière — 2026-08-10T07:01:03Z

Le Job `geo-capture-zones-20260810t065958z` est terminé (1/1). Le run S3
`zones-20260810T065958Z-0-b10e432e-5de7-4368-994c-8047d94b29fe` prouve
Lotbinière : HTTP 200, 445 358 octets,
`sha256:1390aad36bee6c517b58f995cc40a9e4ab7b9101e8e4b4bc950bc5ae679d9dcd`.
La relecture E2E depuis S3 vérifie manifeste, `run.json`, log, CAS, sidecar et
preuve v2. La tentative `robots.txt` HTTP 404 est une ligne distincte, sans
octets ni preuve dérivable.

La réconciliation S3 fraîche (`generatedAt=2026-08-10T07:00:39.314Z`) et la
matrice lot→zone 1 106 villes ont été régénérées avec
`NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10`.
`palier-matrix-report.mjs --date=20260810 --check` réussit : 1 649/3 284
résolus (50,2132 %), col. 3 107/163, col. 5 90/163, col. 12 24/163 et
col. 13 4/163 complets. Les cellules sont inchangées par rapport à la passe
précédente.

Le CAS Lotbinière est déposé sur S3, mais il ne constitue pas encore une zone
normalisée ni une ville pliée : aucune cellule Palier ne lui est créditée.
