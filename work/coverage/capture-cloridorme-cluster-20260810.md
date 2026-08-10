# Capture zones Cloridorme — reçu cluster — 2026-08-10

## Exécution de production

- Worklist : `work/coverage/zones-arcgis-recapture-20260810-qa-010.json`
  (cible unique `cloridorme`).
- Préflight puis Job OVH : `geo-capture-zones-20260810t040455z`, avec
  `--kubeconfig /tmp/ovh.kubeconfig`, 1 shard et l'image
  `rg.fr-par.scw.cloud/sentropic-geo/geo-capture:0.1.1`.
- Le pod `geo-capture-zones-20260810t040455z-0-v9f55` a terminé
  `Succeeded`, code de sortie `0`.

## Dépôt S3 et preuve relue

La sonde E2E a relu le run
`zones-20260810T040455Z-0-d6acde2d-6758-4d22-9fac-9570473b415b` depuis S3 :

- cible ArcGIS : HTTP `200`, `robots=allowed`, récupérée le
  `2026-08-10T04:12:02.309Z` ;
- CAS : `raw/zones-v1-proof-url/cas/4a369802992929f8d198d37f627c3fd2ccdad1bbe494e26774cf9432cb3d95a0.bin` ;
- `932579` octets, SHA-256
  `sha256:4a369802992929f8d198d37f627c3fd2ccdad1bbe494e26774cf9432cb3d95a0`,
  vérifié par la sonde ;
- méta CAS et preuve v2 valides (`arcgis` / `natif` / `directe`), avec
  `dedup=true` ;
- la lecture de `robots.txt` a reçu HTTP `404`, conservé dans le manifeste
  sans octets ; elle n'affecte pas la cible autorisée.

Il s'agit d'une capture brute capitalisée dans S3. Aucun objet `normalized/`
ne lui est attribué ici : aucune ville ni cellule Palier n'est déclarée complète
par ce reçu seul.
