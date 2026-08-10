# Capture zones ArcGIS — Ayers Cliff — 2026-08-10

## Portée

Cette passe dépose un reçu de capture d'octets bruts sur le cluster OVH. Elle
n'écrit aucun objet `normalized/`; aucune cellule de la matrice palier n'est
donc créditée avant un dépôt servi distinct et acceptable.

## Soumission cluster

- Cible vérifiée : cluster OVH déclaré `poc-ca`, namespace `geo`.
- Worklist mono-ville :
  `work/coverage/zones-arcgis-recapture-20260810-qa-002.json`, déposée sous
  `s3://sentropic-geo/registry/capture-worklists/zones-20260810T025647Z.json`.
- Job `geo-capture-zones-20260810t025647z`; pod
  `geo-capture-zones-20260810t025647z-0-t7z8m` Succeeded, exit 0,
  de 02:57:02 à 02:57:13 UTC.

## Reçu S3 vérifié

- Run effectif : `zones-20260810T025647Z-0-a652d0b7-f5e0-4b4b-bffd-fe8b6aa94f37`.
- Les trois objets du run existent : `manifest.jsonl`, `run.json`, `run.log`.
- La tentative `robots.txt` reçoit HTTP 403 et est préservée comme ligne de
  manifeste; elle ne transporte aucun octet et ne masque pas le résultat.
- La requête Ayers Cliff est HTTP 200, `robots=allowed`, récupérée à
  `2026-08-10T02:57:08.714Z`, 150589 octets, SHA-256
  `sha256:e29fbd4272a33c3ca47060f643a1365f22616f190e7ff644dc0375ceef71eef3`.
- Le CAS `raw/zones-v1-proof-url/cas/e29fbd4272a33c3ca47060f643a1365f22616f190e7ff644dc0375ceef71eef3.json`
  et son `.meta.json` existent et concordent. `dedup=true` est attendu : le
  CAS fut d'abord récupéré le `2026-07-28T04:05:03.508Z`; ce run dépose un
  nouveau reçu, sans réécrire le même octet.
- `_capture-e2e-probe.ts --run-prefix zones-20260810T025647Z --type arcgis --raw`
  retourne `E2E OK`: 1 run, 2 lignes, 1 tentative cible HTTP 200, 1 CAS vérifié
  et 0 anomalie; la preuve est `arcgis/natif/directe`.

## Anti-crédit

Ce reçu brut/CAS ne constitue pas une géométrie de zonage servie. Il ne peut
pas, seul, changer les colonnes 1, 10 ou les KPI Immo de la matrice palier.
