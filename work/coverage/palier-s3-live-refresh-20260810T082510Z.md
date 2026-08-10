# Palier 20×167 — rescan S3 après synchronisation main #165 — 2026-08-10T08:25:10Z

Après l'intégration de `origin/main` incluant #165, `coverage-reconcile.ts`
a relu le S3 courant à `2026-08-10T08:25:09.147Z`. L'assignation lot-zone
autorisée est inchangée et le générateur complet
`palier-matrix-report.mjs --date=20260810 --check` est vert.

Scoreboard S3 inchangé : pv=1064, normes=818, zones=911, cadastre=1106,
role-foncier=1106, tod=39.

Résolu vérifié : **1 653 / 3 284 = 50,334957 %**.

- col. 3 : 107/163 complete ;
- col. 5 : 94/163 complete ;
- col. 12 : 24/163 complete (93 incomplete, 46 unknown) ;
- col. 13 : 4/163 complete (109 incomplete, 50 unknown).

La comparaison de cellules à la matrice antérieure est vide. #165 indexe les
preuves de capture durablement, mais n'ajoute pas à lui seul une donnée
normalisée/pliée qui compléterait une ville.
