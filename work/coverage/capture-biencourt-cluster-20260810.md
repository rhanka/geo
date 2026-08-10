# Capture zones ArcGIS — Biencourt — 2026-08-10

Capture brute mono-ville exécutée sur le cluster OVH déclaré (`geo`), jamais
localement. Worklist S3 :
`registry/capture-worklists/zones-20260810T031352Z.json`; Job
`geo-capture-zones-20260810t031352z`, pod Succeeded exit 0.

Le run S3 `zones-20260810T031352Z-0-c07c44f1-d317-49be-8659-75a5013e9522`
contient `manifest.jsonl`, `run.json` et `run.log`. La requête Biencourt est
HTTP 200 à `2026-08-10T03:14:17.515Z`, 7879248 octets,
`sha256:48d3d00d5e640dce7849e85a7eb1efb3984c15c9152bc2220c3380dec69a3f39`.
Le CAS et son sidecar sont vérifiés; la preuve v2 est `arcgis/natif/directe`.
`dedup=true` est cohérent avec le premier fetch du CAS (`2026-07-28`). La
ligne robots HTTP 403 est conservée dans le manifeste; le probe E2E conclut
1 run, 2 lignes, 1 HTTP 200, 1 CAS vérifié, 0 anomalie.

Aucun objet `normalized/` n'est promu : ce reçu raw/CAS ne crédite aucune
cellule palier.
