# Palier 20×167 — rescan S3 après L’Ascension-de-Patapédia et L’Assomption — 2026-08-10T06:33:11Z

Les jobs Kubernetes `geo-capture-zones-20260810t063106z` et
`geo-capture-zones-20260810t063158z` sont terminés. Les preuves S3 v2 sont
valides pour L’Ascension-de-Patapédia (HTTP 200, 209840 octets,
`sha256:8a8f132d4b3e294f7ad2b26bd3f5463fe2402a3778c599d380f681a6ab9721a5`)
et L’Assomption (HTTP 200, 827157 octets,
`sha256:efbbf015e86a0d0b2e1f8da31df3f6f642d70f1a82fa42e6d3c779b63dc15b6e`).
Les deux objets sont déposés en CAS brut sur S3; leurs tentatives robots sans
octets restent distinctes.

Après réconciliation complète depuis S3 à `2026-08-10T06:32:50.068Z` et
recalcul intégral lot→zone, le rapport Palier passe `--check`: 1646/3284
(50,122 %), col. 5 87/163, col. 12 24/163, col. 13 4/163. Aucun de ces deux
dépôts bruts n’ajoute de ville complète ou de crédit KPI.
