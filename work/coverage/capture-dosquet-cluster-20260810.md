# Capture zones Dosquet — reçu cluster — 2026-08-10

## Exécution de production

- Worklist : `work/coverage/zones-arcgis-recapture-20260810-qa-013.json`
  (cible unique `dosquet`).
- Préflight puis Job OVH : `geo-capture-zones-20260810t044500z`, avec
  `--kubeconfig /tmp/ovh.kubeconfig`, 1 shard et l'image
  `rg.fr-par.scw.cloud/sentropic-geo/geo-capture:0.1.1`.
- Le pod `geo-capture-zones-20260810t044500z-0-p8fv5` a terminé
  `Succeeded`, code de sortie `0`.

## Dépôt S3 et preuve relue

La sonde E2E a relu le run
`zones-20260810T044500Z-0-05d8c0f1-dd5c-4abd-a944-c45d8021f16a` depuis S3 :

- cible ArcGIS : HTTP `200`, `robots=allowed`, récupérée le
  `2026-08-10T04:45:18.285Z` ;
- CAS : `raw/zones-v1-proof-url/cas/3279839d42b0743c909033effb5a27b6d2e76dcb9d923b8179f2e9c8986f6a81.bin` ;
- `158760` octets, SHA-256
  `sha256:3279839d42b0743c909033effb5a27b6d2e76dcb9d923b8179f2e9c8986f6a81`,
  vérifié par la sonde ;
- méta CAS et preuve v2 valides (`arcgis` / `natif` / `directe`), avec
  `dedup=true` ;
- la lecture de `robots.txt` a reçu HTTP `404`, conservé dans le manifeste
  sans octets ; elle n'affecte pas la cible autorisée.

Il s'agit d'une capture brute capitalisée dans S3. Aucun objet `normalized/`
ne lui est attribué ici : aucune ville ni cellule Palier n'est déclarée complète
par ce reçu seul.
