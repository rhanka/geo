# Palier 20×167 — rescan S3 post-#140/#141/#142 et Laval — 2026-08-10T06:46:54Z

Après les merges #140, #141 et #142, la couverture est réconciliée depuis S3 à
`2026-08-10T06:46:29.941Z` avec `NODE_OPTIONS=--dns-result-order=ipv4first`
et `AWS_MAX_ATTEMPTS=10`, puis la matrice lot→zone entière et le rapport Palier
sont régénérés. `--check` réussit.

| Mesure | Avant | S3 courant |
|---|---:|---:|
| Résolu total | 1647/3284 (50,152 %) | 1648/3284 (50,183 %) |
| Col. 5 — règlement complet | 88/163 | 89/163 |
| Col. 12 — assignation lot-zone | 24/163 | 24/163 |
| Col. 13 — normes pliées | 4/163 | 4/163 |

Le gain net est Beaconsfield, règlement `incomplete`→`complete`, apporté par
le dépôt règlement #142. Aucun autre gain n’est inféré.

Le Job Kubernetes `geo-capture-zones-20260810t063552z` est terminé. Laval est
relue depuis S3: HTTP 200, 10049513 octets,
`raw/zones-v1-proof-url/cas/1ed9579ed1d17e1321d2683dc8f7e614c71f5b031edc22ecd217ac04818b9fd6.bin`,
SHA-256 et preuve v2 valides. La tentative `robots.txt` en erreur réseau est
conservée sans octets. Laval reste brute/CAS, sans `normalized/` ni crédit KPI.
