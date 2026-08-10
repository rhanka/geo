# Palier 20×167 — rescan S3 après Lévis et merge normes — 2026-08-10T06:59:27Z

Le Job `geo-capture-zones-20260810t065809z` est terminé (1/1). Le run S3
`zones-20260810T065809Z-0-e39d15dd-f58d-41b8-8b34-aa5392f0848b` prouve Lévis
: HTTP 200, 4 900 317 octets,
`sha256:a085b1775fec9b8bba57e12ab7d19747841c26574c3a5353620327057bfd4cc1`.
La relecture E2E depuis S3 vérifie manifeste, `run.json`, log, CAS, sidecar et
preuve v2. La tentative `robots.txt` HTTP 404 est conservée séparément, sans
octets ni preuve dérivable.

Avant la passe, `main` a intégré la campagne normes col. 13 par le merge
`ad87f153`. La réconciliation S3 fraîche
(`generatedAt=2026-08-10T06:59:05.914Z`) et la matrice lot→zone 1 106 villes
ont été régénérées avec
`NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10`.
`palier-matrix-report.mjs --date=20260810 --check` réussit : 1 649/3 284
résolus (50,2132 %), col. 3 107/163, col. 5 90/163, col. 12 24/163 et
col. 13 4/163 complets, tous inchangés.

Les configurations/captures normes ajoutées par ce merge ne sont pas encore un
artefact de normes pliées consommé par la matrice : elles ne ferment aucune
ville col. 13. De même, le CAS Lévis déposé sur S3 n'est pas encore une zone
normalisée et ne reçoit aucun crédit Palier.
