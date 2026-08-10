# Capture zones Drummondville — reçu cluster — 2026-08-10

## Exécution de production

- Worklist : `work/coverage/zones-arcgis-recapture-20260810-qa-014.json`
  (cible unique `drummondville`).
- Préflight puis Job OVH : `geo-capture-zones-20260810t045300z`, avec
  `--kubeconfig /tmp/ovh.kubeconfig`, 1 shard et l'image
  `rg.fr-par.scw.cloud/sentropic-geo/geo-capture:0.1.1`.
- Le pod `geo-capture-zones-20260810t045300z-0-597c7` a terminé
  `Succeeded`, code de sortie `0`.

## Dépôt S3 et preuve relue

La sonde E2E a relu le run
`zones-20260810T045300Z-0-0cb8d925-f106-4bf9-9f97-9a40db2fe772` depuis S3 :

- cible ArcGIS : HTTP `200`, `robots=allowed`, récupérée le
  `2026-08-10T04:53:32.508Z` ;
- CAS : `raw/zones-v1-proof-url/cas/5620da94090975fc58f4988c3973e8d2720ad4191e7166cffe9214b7e8c923e5.json` ;
- `3282141` octets, SHA-256
  `sha256:5620da94090975fc58f4988c3973e8d2720ad4191e7166cffe9214b7e8c923e5`,
  vérifié par la sonde ;
- méta CAS et preuve v2 valides (`arcgis` / `natif` / `directe`), avec
  `dedup=false` ;
- la lecture de `robots.txt` a reçu HTTP `403`, conservé dans le manifeste
  sans octets ; elle n'affecte pas la cible autorisée.

Il s'agit d'une capture brute capitalisée dans S3. Aucun objet `normalized/`
ne lui est attribué ici : aucune ville ni cellule Palier n'est déclarée complète
par ce reçu seul.
