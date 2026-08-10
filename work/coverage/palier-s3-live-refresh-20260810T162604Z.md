# Palier 20×167 — rescan S3 après synchronisation main #173 — 2026-08-10T16:26:04Z

Après intégration de `origin/main` jusqu'à #173 (`6188e925`, lane/lot),
`coverage-reconcile.ts` a relu le S3 courant à `2026-08-10T16:26:04.792Z`.
`palier-matrix-report.mjs --date=20260810 --check` est vert.

Scoreboard S3 inchangé : pv=1064, normes=818, zones=911, cadastre=1106,
role-foncier=1106, tod=39.

Résolu vérifié : **1 653 / 3 284 = 50,3 %** (complete 1378 + N-A 275 ;
incomplete 829, unknown 802).

- col. 12 (immo lot-zone) : 24/163 complete ;
- col. 13 (immo normes pliées) : 4/163 complete ;
- gate présence (20 KPI) : 9/163.

**Comparaison de cellules : VIDE.** Les merges lot #171→#173 (progress
`refold-force2`, `refold-lassomption`, `refold-mirabel`, `refold-hampstead-optionB`)
sont du re-fold EN COURS par-ville : aucun n'a encore complété une ville au scan S3
courant (col-12/13 au baseline). `mirabel` est coverage-bound (résidu normes), non
complétable. Les gains des 37 REAL-GAIN gatés (GATE-PASS `938535cc`) restent à
matérialiser dans un merge lot ultérieur portant l'`immo-lot-zone-assignment-matrix`
avec de nouvelles assignations complètes.
