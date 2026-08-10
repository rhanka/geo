# Palier 20×167 — rescan S3 après L’Ascension — 2026-08-10T06:29:51Z

Le Job Kubernetes `geo-capture-zones-20260810t062736z` est terminé. Le run S3
`zones-20260810T062736Z-0-6a9df827-ca14-49f1-84b8-53b5f45bfccb` confirme
L’Ascension : HTTP 200, 24148392 octets,
`raw/zones-v1-proof-url/cas/25aec58cc27cd6600a25fa4d7b8c2a4b97f464844ea96bb4bf402663fce51879.bin`,
SHA-256 et preuve v2 valides. La tentative robots HTTP 404 est conservée sans
octets, distinctement du succès.

Après rescan complet depuis S3 (`NODE_OPTIONS=--dns-result-order=ipv4first`,
`AWS_MAX_ATTEMPTS=10`), la couverture est à `pv=1064`, `normes=818`,
`zones=911`, `cadastre=1106`, `role-foncier=1106`, `tod=39`, tous `+0`.
La matrice intégrale et son `--check` sont valides et restent à 1646/3284
(50,122 %): col. 5 87/163, col. 12 24/163, col. 13 4/163. L’Ascension est
brute/CAS, sans `normalized/`, et n’ajoute aucun crédit KPI.
