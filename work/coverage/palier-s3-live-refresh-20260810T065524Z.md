# Palier 20×167 — rescan S3 après Lemieux et merge règlement — 2026-08-10T06:55:24Z

Le Job `geo-capture-zones-20260810t065352z` est terminé (1/1). Le run S3
`zones-20260810T065352Z-0-aa34c267-461c-4885-88d1-974508416a2a` prouve
Lemieux : HTTP 200, 30 807 octets,
`sha256:b2d83465d4d19c6b0d0e4ebd65405503e0894bb4a0364244ccbb18185528843f`.
La relecture E2E depuis S3 vérifie manifeste, `run.json`, log, CAS, sidecar et
preuve v2. La tentative `robots.txt` HTTP 404 est une ligne distincte, sans
octets et sans preuve dérivable.

Avant la passe, `main` a intégré le règlement Léry par le merge `61ca9919`.
La réconciliation S3 fraîche (`generatedAt=2026-08-10T06:55:02.459Z`) et la
matrice lot→zone 1 106 villes ont été régénérées avec
`NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10`.
`palier-matrix-report.mjs --date=20260810 --check` réussit : 1 649/3 284
résolus (50,2132 %), soit +1. La variation vérifiée est Léry, col. 5
`incomplete` → `complete` (89 → 90/163). Col. 3 reste 107/163, col. 12
24/163 et col. 13 4/163 complets.

Le CAS Lemieux est déposé sur S3 mais ne constitue pas encore une zone
normalisée ni une ville pliée : aucun crédit Palier ne lui est attribué. Le
gain vient exclusivement de l'artefact règlement mergé.
