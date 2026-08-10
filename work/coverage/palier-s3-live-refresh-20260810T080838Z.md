# Palier 20×167 — rescan S3 après Milan — 2026-08-10T08:08:38Z

## Dépôt S3 vérifié

Le job Kubernetes `geo-capture-zones-20260810t080733z` a terminé `1/1`.
Le run `zones-20260810T080733Z-0-396d55af-5b01-4ea5-84f6-1037e7f2a508`
pour `milan` est vérifié de bout en bout : manifeste, `run.json`, journal,
CAS et métadonnées/proof v2 sont présents. La réponse cible est HTTP 200,
8 245 960 octets, et son contenu est déposé sous
`raw/zones-v1-proof-url/cas/b32fb0f4cb8e84e72548534daf1d59a632ff0dc6c97869e7bab866aa3cd4c226.json`
(`sha256:b32fb0f4cb8e84e72548534daf1d59a632ff0dc6c97869e7bab866aa3cd4c226`).
Le refus robots HTTP 403 est séparé de la réponse cible.

Cette capture est brute : elle n'est ni normalisée ni pliée et ne reçoit donc
aucun crédit Palier.

## Reconciliation et matrice fraîches

`coverage-reconcile.ts` a relu le S3 courant à
`2026-08-10T08:08:13.896Z`, puis
`immo-lot-zone-assignment-matrix.ts --date 20260810 --max-seconds 600` a
recalculé l'assignation complète (1 106/1 106). Le générateur complet
`palier-matrix-report.mjs --date=20260810 --check` est vert.

Scoreboard S3 : pv=1064, normes=818, zones=911, cadastre=1106,
role-foncier=1106, tod=39 (aucune variation).

Résolu vérifié : **1 653 / 3 284 = 50,334957 %**.

- col. 3 : 107/163 complete ;
- col. 5 : 94/163 complete ;
- col. 12 : 24/163 complete (93 incomplete, 46 unknown) ;
- col. 13 : 4/163 complete (109 incomplete, 50 unknown).

La comparaison structurelle au précédent rapport frais ne trouve aucune
cellule de ville modifiée. La capture Milan ne complète donc pas de ville dans
la matrice actuelle.
