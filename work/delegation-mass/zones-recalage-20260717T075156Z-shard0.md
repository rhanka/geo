# Recalage PDF — shard 0/1 — 2026-07-17T07:51:56Z

Complément de triage sur des plans archivés. Aucun dépôt : tous les parcours ont
été arrêtés par un gate explicite.

| Slug | Source locale contrôlée | Gate | Décision |
|---|---|---|---|
| sainte-marie-salome | `work/zones-recalage/shard1of2/sainte-marie-salome-official.pdf` | T1 : aucun `/VP`, `/Measure` ou `/GEO` interprétable | rejeté |
| saint-polycarpe | annexe C, page 364 du règlement 218-2025 | T2 : 12 seeds passent résidu/holdout mais aucune solution n'est isotrope ; meilleur ratio 1,201 > 1,1 | rejeté |
| gaspe | `work/zonage-plans/gaspe.pdf` | T1 : aucun `/VP`, `/Measure` ou `/GEO` interprétable | rejeté |

La page de Saint-Polycarpe a été localisée textuellement comme annexe C avant le
recalage ; elle contient 2 192 points SVG. Le rejet T2 est donc un rejet de
géoréférencement, pas une absence de plan. Les résidus bas ne compensent jamais
une anisotropie hors seuil.
