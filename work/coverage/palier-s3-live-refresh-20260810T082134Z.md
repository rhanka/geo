# Palier 20×167 — rescan S3 après Mirabel — 2026-08-10T08:21:34Z

## Dépôt S3 vérifié

Le Job Kubernetes `geo-capture-zones-20260810t082101z` a terminé `1/1`.
Le run `zones-20260810T082101Z-0-4a5b301c-105b-45ef-917f-b9c5c2052d3e`
pour `mirabel` est vérifié depuis S3 : manifeste, `run.json`, journal, CAS,
sidecar et preuve v2 sont présents. La réponse cible est HTTP 200,
1 715 247 octets, et désigne
`raw/zones-v1-proof-url/cas/48c92b70c21b3030fe8ebdc181cc83de47de4cb5e3f97f16b191cbe8dc7b2e3e.json`
(`sha256:48c92b70c21b3030fe8ebdc181cc83de47de4cb5e3f97f16b191cbe8dc7b2e3e`).
Le CAS est dédupliqué mais sa présence, son hash, son sidecar et la preuve v2
portant le `retrieved_at` de ce run sont vérifiés. Le refus robots HTTP 403
est conservé séparément dans le manifeste.

Cette donnée est un reçu brut : aucune normalisation ou norme pliée ne lui est
attribuée, donc aucun crédit Palier n'est inventé.

## Reconciliation et matrice fraîches

`coverage-reconcile.ts` a relu le S3 courant à
`2026-08-10T08:21:11.844Z`, puis
`immo-lot-zone-assignment-matrix.ts --date 20260810 --max-seconds 600` a
recalculé les 1 106 municipalités. Le générateur complet
`palier-matrix-report.mjs --date=20260810 --check` est vert.

Scoreboard S3 : pv=1064, normes=818, zones=911, cadastre=1106,
role-foncier=1106, tod=39 (aucune variation).

Résolu vérifié : **1 653 / 3 284 = 50,334957 %**.

- col. 3 : 107/163 complete ;
- col. 5 : 94/163 complete ;
- col. 12 : 24/163 complete (93 incomplete, 46 unknown) ;
- col. 13 : 4/163 complete (109 incomplete, 50 unknown).

La comparaison structurée à la matrice précédente est vide : Mirabel ne
complète aucune cellule à ce stade.
