# Palier 20×167 — rescan S3 post-merge #138 et Laurier-Station — 2026-08-10T06:35:15Z

Le merge #138 (Mirabel) est intégré avant cette passe. La réconciliation S3 à
`2026-08-10T06:34:54.338Z` et la matrice lot→zone complète sont régénérées avec
`NODE_OPTIONS=--dns-result-order=ipv4first` et `AWS_MAX_ATTEMPTS=10`; le
rapport Palier passe `--check`.

| Mesure | Avant | Après #138 |
|---|---:|---:|
| Résolu total | 1646/3284 (50,122 %) | 1647/3284 (50,152 %) |
| Col. 5 — règlement complet | 87/163 | 88/163 |
| Col. 12 — assignation lot-zone | 24/163 | 24/163 |
| Col. 13 — normes pliées | 4/163 | 4/163 |

Le gain net est la complétude règlement de Mirabel, conformément au dépôt
merge #138. Aucun autre gain n’est inféré.

Le Job Kubernetes `geo-capture-zones-20260810t063351z` est terminé. Laurier-
Station est vérifiée sur S3 (HTTP 200, 215268 octets,
`sha256:1b8574ccfe8a4773c6b4990b0def696315dfb4278efbd108994e236be491f470`,
preuve v2 valide). C’est un objet CAS brut, sans `normalized/`, sans crédit
KPI.
