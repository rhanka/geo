# Palier 20×167 — rescan S3 après synchronisation main #164 — 2026-08-10T08:14:37Z

Après l'intégration de `origin/main` incluant #164, la réconciliation
`coverage-reconcile.ts` a relu le S3 courant à
`2026-08-10T08:14:35.984Z`. L'assignation lot-zone autoritaire 20260810,
déjà complète, est inchangée; `palier-matrix-report.mjs --date=20260810
--check` est vert.

Scoreboard S3 inchangé : pv=1064, normes=818, zones=911, cadastre=1106,
role-foncier=1106, tod=39.

Résolu vérifié : **1 653 / 3 284 = 50,334957 %**.

- col. 3 : 107/163 complete ;
- col. 5 : 94/163 complete ;
- col. 12 : 24/163 complete (93 incomplete, 46 unknown) ;
- col. 13 : 4/163 complete (109 incomplete, 50 unknown).

Aucune cellule ne diffère de la matrice fraîche précédente. #164 fournit de
la logique d'attestation de jobs de capture; il ne dépose pas à lui seul une
donnée normalisée et pliée complétant une ville dans ce scan.
